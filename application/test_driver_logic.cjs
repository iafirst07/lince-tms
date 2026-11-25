'use strict';
// Pure client functional tests. No server, runtime database, credentials or permission probes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {namespace, contextFor, selectTrips, snapshotView, makeRecord, synchronize, sendPendingClaim} = require('./driver.js');
const user = {id: 'driver-demo', org: 'carrier-demo', username: 'motorista.demo'};
const trip = {id: 'shipment-demo', kind: 'shipment', version: 8, planVersion: 2, assignmentId: 'assignment-demo', driverUserId: user.id, status: 'IN_TRANSIT', stage: 'DELIVERY', start: '2026-11-25T10:00:00Z', delivered: [], packages: [{key: 'ORDER:P1', id: 'P1', weightKg: '2'}, {key: 'ORDER:P2', id: 'P2', weightKg: '3'}], stops: [{arrival: '2026-11-25T11:00:00Z', destination: {name: 'Destino fictício', postalCode: '01001000', lat: -23.5, lon: -46.6, privateField: 'not-for-client'}, orderReference: 'PEDIDO-DEMO'}], cost: '100.00', margin: 'secret'};
const payload = index => ({shipmentId: trip.id, version: 8, proofId: `PROOF-${index}`, packageKeys: [`ORDER:P${index}`], outcome: 'DELIVERED', reason: 'Recebido no cenário fictício', occurredAt: '2026-11-25T11:00:00Z'});
const cp = value => JSON.parse(JSON.stringify(value));
function memoryStore(items) {
  const records = new Map(items.map(item => [item.id, cp(item)])), trace = [];
  return {records, trace,
    async list(owner) { return [...records.values()].filter(item => item.owner === owner).map(cp); },
    async put(item) { trace.push(`put:${item.id}:${item.attemptedAt ? 'attempted' : item.uploadAttemptedAt ? 'upload-attempted' : 'saved'}`); records.set(item.id, cp(item)); },
    async remove(owner, id) { assert.equal(records.get(id)?.owner, owner); trace.push(`remove:${id}`); records.delete(id); }
  };
}
function options(store, send, currentUser = () => user) {
  return {user, currentUser, store, send, fetchSession: async () => ({user, csrf: 'not-persisted'}), sessionReady: () => {}};
}
const tests = [];
const test = (name, run) => tests.push({name, run});

test('view contains only assigned operational trips and minimal destination fields', () => {
  const data = {objects: [trip, {...trip, id: 'other', driverUserId: 'other'}, {id: 'invoice', kind: 'invoice', amount: '100'}], commands: ['pod', 'tracking', 'invoice_create']};
  assert.equal(selectTrips(data, user).length, 1);
  const view = snapshotView(data, user);
  assert.equal(view.trips.length, 1); assert.equal(view.trips[0].cost, undefined); assert.equal(view.trips[0].margin, undefined);
  assert.equal(view.trips[0].stops[0].destination.privateField, undefined); assert.equal(view.trips[0].stops[0].destination.name, 'Destino fictício');
  assert.deepEqual(view.commands, ['pod', 'tracking']); assert.equal(JSON.stringify(view).includes('csrf'), false);
  data.objects[0].packages[0].id = 'CHANGED'; assert.equal(view.trips[0].packages[0].id, 'P1'); trip.packages[0].id = 'P1';
});

test('queue record preserves original context and payload independently of later source edits', () => {
  const source = cp(trip), body = payload(1), record = makeRecord(user, source, 'pod', body, null, 'one');
  source.packages[0].key = 'CHANGED'; body.reason = 'CHANGED';
  assert.deepEqual(record.context, contextFor(trip)); assert.equal(record.payload.reason, 'Recebido no cenário fictício');
  assert.equal(record.owner, namespace(user)); assert.equal(record.status, 'PENDING');
  assert.throws(() => makeRecord(user, trip, 'stage', {}, null, 'bad'), /Somente/);
});

test('two queued PODs keep same original version/context and distinct stable identities', async () => {
  const one = makeRecord(user, trip, 'pod', payload(1), null, 'one'), two = makeRecord(user, trip, 'pod', payload(2), null, 'two');
  const store = memoryStore([one, two]), sent = [];
  const count = await synchronize(options(store, async (command, body, key) => {
    assert.equal(command, 'offline_sync'); assert.equal(store.records.get(body.payload.proofId === 'PROOF-1' ? 'one' : 'two').attemptedAt !== undefined, true);
    assert.equal(body.payload.version, 8); assert.deepEqual(body.context, contextFor(trip)); sent.push({body: cp(body), key}); return {status: 'ok'};
  }));
  assert.equal(count, 2); assert.equal(store.records.size, 0); assert.notEqual(sent[0].key, sent[1].key);
});

test('lost POD response reopens queue with exact payload/key and no second logical effect', async () => {
  const store = memoryStore([makeRecord(user, trip, 'pod', payload(1), null, 'one')]);
  let attempts = 0, effects = 0, original;
  const send = async (command, body, key) => {
    const serialized = JSON.stringify({command, body, key});
    if (!original) { original = serialized; effects++; } else assert.equal(serialized, original);
    if (++attempts === 1) throw new TypeError('Response lost'); return {status: 'same-result'};
  };
  await assert.rejects(synchronize(options(store, send)), TypeError);
  const reopened = memoryStore([...store.records.values()]);
  await synchronize(options(reopened, send)); assert.equal(effects, 1); assert.equal(attempts, 2); assert.equal(reopened.records.size, 0);
});

test('lost upload response uses stable upload key then persists file reference before POD', async () => {
  const store = memoryStore([makeRecord(user, trip, 'pod', payload(1), 'FAKE-BASE64', 'photo')]);
  const keys = [], podKeys = []; let uploadCalls = 0;
  const send = async (command, body, key) => {
    if (command === 'upload_pod') { keys.push(key); assert.equal(body.base64, 'FAKE-BASE64'); if (++uploadCalls === 1) throw new TypeError('Upload response lost'); return {id: 'file-demo'}; }
    assert.equal(command, 'offline_sync'); assert.equal(body.payload.fileId, 'file-demo'); assert.equal(store.records.get('photo').payload.fileId, 'file-demo'); assert.equal(store.records.get('photo').photo, null); podKeys.push(key); return {status: 'ok'};
  };
  await assert.rejects(synchronize(options(store, send)), TypeError);
  await synchronize(options(store, send)); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(podKeys.length, 1);
});

test('changed operational context preserves blocked record and does not blindly repeat it', async () => {
  const store = memoryStore([makeRecord(user, trip, 'pod', payload(1), null, 'one')]); let calls = 0;
  const send = async () => { calls++; const error = new Error('Operational context changed'); error.code = 'OFFLINE_CONTEXT_CHANGED'; error.status = 409; throw error; };
  await assert.rejects(synchronize(options(store, send)), /Operational context/);
  assert.equal(store.records.get('one').status, 'BLOCKED'); assert.equal(store.records.get('one').payload.proofId, 'PROOF-1');
  await assert.rejects(synchronize(options(store, send)), /conferência/); assert.equal(calls, 1);
});

test('local signout while awaiting upload stops the remaining POD send', async () => {
  const store = memoryStore([makeRecord(user, trip, 'pod', payload(1), 'FAKE-BASE64', 'one')]); let current = user, calls = 0;
  const send = async command => { calls++; assert.equal(command, 'upload_pod'); current = null; return {id: 'file-demo'}; };
  await assert.rejects(synchronize(options(store, send, () => current)), /Entre novamente/);
  assert.equal(calls, 1); assert.equal(store.records.size, 1); assert.equal(store.records.get('one').payload.fileId, 'file-demo');
});

test('online occurrence keeps its durable identity after a lost response', async () => {
  const record = {owner: namespace(user), key: 'driver-claim-stable', payload: {shipmentId: trip.id, packageKeys: ['ORDER:P1'], type: 'DAMAGE', description: 'Avaria fictícia'}};
  let stored = cp(record), calls = 0, confirmations = 0, first;
  const send = async (command, body, key) => { const serialized = JSON.stringify({command, body, key}); if (!first) first = serialized; else assert.equal(serialized, first); if (++calls === 1) throw new TypeError('Lost claim response'); return {id: 'claim-demo'}; };
  const opts = () => ({user, currentUser: () => user, record: cp(stored), fetchSession: async () => ({user}), sessionReady() {}, send, confirmed: async () => { confirmations++; stored = null; }});
  await assert.rejects(sendPendingClaim(opts()), TypeError); assert.notEqual(stored, null); assert.equal(confirmations, 0);
  await sendPendingClaim(opts()); assert.equal(stored, null); assert.equal(confirmations, 1); assert.equal(calls, 2);
});

test('service worker handles only named static shell resources', () => {
  const listeners = {}, requests = [];
  const sandbox = {URL, self: {location: {origin: 'https://example.test'}, addEventListener: (name, fn) => { listeners[name] = fn; }}, caches: {}, Response: {error() {}}, fetch() { requests.push(1); return Promise.resolve({ok: false}); }};
  vm.runInNewContext(fs.readFileSync(require.resolve('./driver-sw.js'), 'utf8'), sandbox);
  let responses = 0;
  for (const path of ['/api/state', '/api/login', '/api/file?id=file-demo', '/driver/unknown', '/driver/?session=anything']) listeners.fetch({request: {method: 'GET', url: `https://example.test${path}`}, respondWith() { responses++; }});
  assert.equal(responses, 0); assert.equal(requests.length, 0);
  listeners.fetch({request: {method: 'GET', url: 'https://example.test/driver/driver.css'}, respondWith() { responses++; }});
  assert.equal(responses, 1);
});

(async () => {
  const result = {scope: 'Pure functional client logic and static shell routing; no browser/IndexedDB/server/permissions audit', tests: []};
  for (const item of tests) { try { await item.run(); result.tests.push({name: item.name, pass: true}); } catch (error) { result.tests.push({name: item.name, pass: false, error: error.stack}); } }
  result.passed = result.tests.filter(t => t.pass).length; result.total = result.tests.length;
  console.log(JSON.stringify(result, null, 2)); if (result.passed !== result.total) process.exitCode = 1;
})();
