import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createWorker} from './worker.mjs';
import {FakeD1} from './test-memory-db.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
const compiled=process.argv.includes('--compiled'),worker=compiled?(await import('../distribution/public-site/dist/server/index.js')).default:createWorker({seed,assets:{},exploration:true});
const db=new FakeD1(),wid=crypto.randomUUID();let count=0;
async function call(path,persona='loja.admin',command=null,payload=null,key=crypto.randomUUID(),workspace=wid,target=worker){const headers={'X-Lince-Workspace':workspace,'X-Lince-Persona':persona};if(command){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}const res=await target.fetch(new Request('https://lince.test'+path,{method:command?'POST':'GET',headers,body:command?JSON.stringify({command,payload}):undefined}),{DB:db});count++;return{status:res.status,body:await res.json()};}
const catalog=await call('/api/personas');assert.equal(catalog.status,200);
const guide=await call('/api/exploration');assert.equal(guide.body.enabled,true);assert.equal(guide.body.routes.length,4);
const oldManifest=await call('/api/simulation');assert.equal(oldManifest.body.manifest.scenarios.length,18);
const pickupRoute=guide.body.routes.find(r=>r.id==='EXP-PICKUP');const state=await call('/api/state',pickupRoute.actor);const ship=state.body.objects.find(o=>o.id===pickupRoute.objectId);assert.equal(ship.pickupStops.length,2);assert.equal(ship.pickupReceipts.length,1);
const pending=ship.pickupStops.find(s=>!ship.pickupReceipts.some(r=>r.stopId===s.stopId));const payload={shipmentId:ship.id,version:ship.version,planVersion:ship.planVersion,assignmentId:ship.assignmentId,stopId:pending.stopId,packageKeys:pending.packageKeys,eventId:'EXP-HTTP-PICKUP'};
const before=db.rows.get(wid).data;const wrong=await call('/api/command',pickupRoute.actor,'pickup_confirm',{...payload,packageKeys:['other:V1']});assert.equal(wrong.status,409);assert.equal(db.rows.get(wid).data,before);
const key=crypto.randomUUID(),receipt=await call('/api/command',pickupRoute.actor,'pickup_confirm',payload,key);assert.equal(receipt.status,200);const retry=await call('/api/command',pickupRoute.actor,'pickup_confirm',payload,key);assert.deepEqual(retry.body,receipt.body);
const updated=(await call('/api/state',pickupRoute.actor)).body.objects.find(o=>o.id===ship.id);assert.equal(updated.pickupReceipts.length,2);
const stage=await call('/api/command',pickupRoute.actor,'stage',{shipmentId:ship.id,version:updated.version,stage:'PICKUP',packageKeys:ship.packages.map(p=>p.key)});assert.equal(stage.status,200);assert.equal(stage.body.status,'IN_TRANSIT');
const desktop=(await call('/api/state')).body;assert.equal(desktop.objects.find(o=>o.id===ship.id).status,'IN_TRANSIT');
const checkout=desktop.objects.find(o=>o.externalId==='EXPLORAR-FRETE-UNICO');assert.equal(checkout.consumerCharge,'5.40');assert.equal(checkout.allocations.reduce((n,x)=>n+Math.round(Number(x.consumerCharge)*100),0),540);
// A stored pre-exploration scenario is read unchanged; no migration/reset is implicit.
const old=crypto.randomUUID(),legacy=createWorker({seed,assets:{}});await call('/api/personas','loja.admin',null,null,null,old,legacy);const stored=db.rows.get(old).data;const legacyGuide=await call('/api/exploration','loja.admin',null,null,null,old);assert.equal(legacyGuide.body.enabled,false);assert.equal(db.rows.get(old).data,stored);
assert.ok(new TextEncoder().encode(db.rows.get(wid).data).length<900000);
console.log(JSON.stringify({scope:compiled?'Compiled HTTP with FakeD1, not hosted infrastructure':'Source HTTP with FakeD1',requests:count,newScenario:true,legacyPreserved:true,pickupReplay:true,desktopReadback:true,singleCharge:true,bytes:db.rows.get(wid).data.length,pass:true},null,2));
