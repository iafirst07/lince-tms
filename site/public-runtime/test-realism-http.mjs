import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createWorker} from './worker.mjs';
import {FakeD1} from './test-memory-db.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
const compiled=process.argv.includes('--compiled');const worker=compiled?(await import('../distribution/public-site/dist/server/index.js')).default:createWorker({seed,assets:{},exploration:true});
const DB=new FakeD1(),workspace=crypto.randomUUID();let requests=0;
async function call(command,payload,persona='loja.admin',key=crypto.randomUUID()){
 const headers={'X-Lince-Workspace':workspace,'X-Lince-Persona':persona};if(command){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
 const response=await worker.fetch(new Request('https://lince.example'+(command?'/api/command':'/api/state'),{method:command?'POST':'GET',headers,body:command?JSON.stringify({command,payload}):undefined}),{DB});requests++;return{status:response.status,body:await response.json()};
}
const before=(await call()).body;
assert.deepEqual(before.organizations.map(x=>x.name),['Lince Pet','Vértice Transportes','Via Norte Logística']);
assert.ok(before.objects.some(x=>x.kind==='location'&&x.name==='Carla Mendes'));
const values={name:'Unidade Mooca',postalCode:'01310100',lat:-23.55,lon:-46.65,addressLine:'Rua da Paz',number:'220',city:'São Paulo',uf:'SP',deliveryInstructions:'Receber na portaria'};
const created=await call('master_create',{kind:'location',values});assert.equal(created.status,200);
const edited=await call('master_update',{id:created.body.id,version:created.body.version,values:{...values,name:'Unidade Mooca — Expedição'}});assert.equal(edited.status,200);
const raw=DB.rows.get(workspace).data;
assert.equal((await call('master_update',{id:edited.body.id,version:edited.body.version,values:{status:'INACTIVE'}})).status,400);assert.equal(DB.rows.get(workspace).data,raw);
const quote=await call('quote',{originCep:'01001000',destinationCep:'01310100',packages:[{id:'V1',weightKg:'2',lengthCm:'20',widthCm:'10',heightCm:'10'}]});assert.equal(quote.status,200);
const key=crypto.randomUUID(),retire={id:edited.body.id,version:edited.body.version,values:{status:'INACTIVE'},reason:'Unidade em reforma'};
const inactive=await call('master_update',retire,'loja.admin',key);assert.equal(inactive.status,200);assert.equal(inactive.body.status,'INACTIVE');
assert.deepEqual((await call('master_update',retire,'loja.admin',key)).body,inactive.body);
const candidate={externalId:'PEDIDO-REALISMO-01',quoteId:quote.body.id,candidate:0,packages:quote.body.packages,locationId:created.body.id,consumerCharge:'5.40',windowStart:new Date(Date.now()+3600000).toISOString(),windowEnd:new Date(Date.now()+86400000).toISOString()};
const rejection=await call('order_create',candidate);assert.equal(rejection.status,409);assert.equal(rejection.body.error.code,'MASTER_INACTIVE');
const active=await call('master_update',{id:inactive.body.id,version:inactive.body.version,values:{status:'ACTIVE'},reason:'Reforma concluída'});assert.equal(active.status,200);
const order=await call('order_create',candidate);assert.equal(order.status,200);assert.equal(order.body.locationId,created.body.id);
const vehicle=await call('fleet_create',{name:'Van 08 — Distribuição',type:'VEHICLE',fleetMode:'OWN',capacityKg:'750'},'carrier1.admin');assert.equal(vehicle.status,200);
const parked=await call('fleet_update',{id:vehicle.body.id,version:vehicle.body.version,values:{status:'INACTIVE'},reason:'Veículo fora da operação'},'carrier1.admin');assert.equal(parked.status,200);assert.equal(parked.body.status,'INACTIVE');
const returned=await call('fleet_update',{id:parked.body.id,version:parked.body.version,values:{status:'ACTIVE'},reason:'Veículo disponível'},'carrier1.admin');assert.equal(returned.status,200);
const current=(await call()).body;for(const old of before.objects)assert.deepEqual(current.objects.find(x=>x.id===old.id),old,'Original snapshot changed: '+old.id);
const newLocation=current.objects.find(x=>x.id===created.body.id);assert.equal(newLocation.name,'Unidade Mooca — Expedição');assert.equal(newLocation.status,'ACTIVE');assert.ok(newLocation.history.length>=3);
console.log(JSON.stringify({scope:compiled?'Compiled HTTP + FakeD1':'Source HTTP + FakeD1',requests,pass:true,flow:'create/edit/retire/replay/reject inactive use/reactivate/order/resource lifecycle; original objects preserved',not:'hosted/browser/device or universal CRUD'}));
