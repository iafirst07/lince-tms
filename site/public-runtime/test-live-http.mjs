import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createWorker} from './worker.mjs';
import {FakeD1} from './test-memory-db.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
const compiled=process.argv.includes('--compiled');
const worker=compiled?(await import('../distribution/public-site/dist/server/index.js')).default:createWorker({seed,assets:{},exploration:true});
const DB=new FakeD1(),wid=crypto.randomUUID();let requests=0;
async function request(path,body,key=crypto.randomUUID()){
 const headers={'X-Lince-Workspace':wid,'X-Lince-Persona':'loja.admin'};
 if(body){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
 const res=await worker.fetch(new Request('https://lince.example'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),{DB});requests++;
 return{status:res.status,headers:res.headers,body:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text()};
}
const call=(action,payload,key)=>request('/api/live-command',{action,payload},key);
const initial=await request('/api/live-state');assert.equal(initial.status,200);assert.equal(initial.body.simulation,true);
const before=DB.rows.get(wid).data;
const broken=await call('session_create',{shipmentId:'does-not-exist'});assert.notEqual(broken.status,200);assert.equal(DB.rows.get(wid).data,before);
// A passive API intake creates a genuine domain order, then plans that exact order.
const state=(await request('/api/state')).body;
const sourceOrder=state.objects.find(o=>o.kind==='order'&&o.packages?.length);
assert.ok(sourceOrder);
const q=await request('/api/command',{command:'quote',payload:{originCep:sourceOrder.originCep,destinationCep:sourceOrder.destinationCep,packages:sourceOrder.packages}});assert.equal(q.status,200);
const orderPayload={externalId:'SIM-HTTP-NEW-'+crypto.randomUUID(),quoteId:q.body.id,candidate:0,packages:q.body.packages,consumerCharge:'5.40',locationId:sourceOrder.locationId,windowStart:new Date(Date.now()+3600000).toISOString(),windowEnd:new Date(Date.now()+86400000).toISOString()};
const intake=await call('passive_order',{messageId:'SIM-NEW-ORDER',orderPayload});assert.equal(intake.status,200);
const exactOrder=(await request('/api/state')).body.objects.find(o=>o.id===intake.body.orderId);assert.equal(exactOrder.externalId,orderPayload.externalId);assert.equal(exactOrder.status,'VALIDATED');
const release=await request('/api/command',{command:'order_release',payload:{id:exactOrder.id,version:exactOrder.version}});assert.equal(release.status,200);
const origin=state.objects.find(o=>o.kind==='location'&&o.postalCode===sourceOrder.originCep);assert.ok(origin);
const plan=await request('/api/command',{command:'plan',payload:{orderIds:[exactOrder.id],originLocationId:origin.id,start:orderPayload.windowStart,capacityKg:'100',speedKmh:'40'}});assert.equal(plan.status,200);assert.equal(plan.body.status,'FEASIBLE');
const commit=await request('/api/command',{command:'plan_commit',payload:{id:plan.body.id,version:plan.body.version}});assert.equal(commit.status,200);assert.ok(commit.body.orderIds.includes(exactOrder.id));
const ship=initial.body.catalog.shipments.find(x=>['IN_TRANSIT','PARTIAL'].includes(x.status)&&x.stage==='DELIVERY'&&(x.delivered||[]).length<x.packages.length);assert.ok(ship,'delivery-stage fixture');
const key=crypto.randomUUID(),created=await call('session_create',{shipmentId:ship.id},key);assert.equal(created.status,200);const sid=created.body.id;
const replay=await call('session_create',{shipmentId:ship.id},key);assert.deepEqual(replay.body,created.body);
const conflict=await call('session_create',{shipmentId:'other'},key);assert.equal(conflict.status,409);
assert.equal((await call('start',{id:sid})).status,409,'documents gate');
let cte;
for(const type of ['NFE_REFERENCE','CTE','MDFE']){
 const doc=await call('document_prepare',{id:sid,type,reference:'SIM-HTTP-'+type});assert.equal(doc.status,200);if(type==='CTE')cte=doc.body;
 const submitted=await call('document_submit',{documentId:doc.body.id,mode:'GOOD'});assert.equal(submitted.status,200);
}
assert.equal((await call('start',{id:sid})).status,200);
const advanced=await call('advance',{id:sid});assert.equal(advanced.status,200);
const visible=await request('/api/live-state');assert.equal(visible.body.liveOperations.sessions.find(s=>s.id===sid).positions.length,1);
assert.equal((await call('offline',{id:sid})).status,200);
const offline=await request('/api/live-state');assert.equal(offline.body.liveOperations.sessions.find(s=>s.id===sid).position.stale,true);
const unchanged=DB.rows.get(wid).data;assert.equal((await call('advance',{id:sid})).status,409);assert.equal(DB.rows.get(wid).data,unchanged);
assert.equal((await call('resume',{id:sid})).status,200);
const xml=await request('/api/live-document?id='+encodeURIComponent(cte.id)+'&format=xml');assert.equal(xml.status,200);assert.match(xml.body,/SEM VALIDADE/);assert.match(xml.body,/realFiscalValidity="false"/);assert.ok(xml.headers.get('content-security-policy'));
const html=await request('/api/live-document?id='+encodeURIComponent(cte.id)+'&format=html');assert.equal(html.status,200);assert.match(html.body,/SEM VALIDADE/);
const hooked=await call('webhook_enqueue',{id:sid,event:'POSITION',target:'LOCAL_SANDBOX'});assert.equal(hooked.status,200);
const msg=hooked.body.id;assert.equal((await call('webhook_process',{messageId:msg,mode:'LOST_RESPONSE'})).status,200);
assert.equal((await call('webhook_retry',{messageId:msg})).status,409);
assert.equal((await call('webhook_query',{messageId:msg})).body.status,'DONE');
const order=initial.body.catalog.orders[0];const passive=await call('passive_order',{messageId:'HTTP-IN-1',orderId:order.id});assert.equal(passive.status,200);const duplicate=await call('passive_order',{messageId:'HTTP-IN-1',orderId:order.id});assert.deepEqual(duplicate.body,passive.body);
// CAS conflict must not claim a mutation was committed. Retry same key after readback.
const casKey=crypto.randomUUID();DB.forceConflict=true;assert.equal((await call('pause',{id:sid},casKey)).status,409);assert.equal((await call('pause',{id:sid},casKey)).status,200);
console.log(JSON.stringify({scope:compiled?'compiled HTTP + FakeD1':'source HTTP + FakeD1',requests,pass:true,proof:'session/doccuments/gates/replay/offline/unknown local webhook/CAS; no hosted/device proof'}));
