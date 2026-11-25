import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createWorkspace,choosePersona,stateFor,executeCommand,allocate,calculate,simulate,COMMANDS,handlers} from './domain.mjs';
import {createWorker} from './worker.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
const BASE='2026-11-25T20:00:00.000Z';
const tests=[];const test=(name,fn)=>tests.push({name,fn});
function scenario(){let w=createWorkspace(seed,BASE),counter=0;return{get w(){return w;},p:name=>choosePersona(w,name),find:(kind,predicate=()=>true)=>w.objects.find(x=>x.kind===kind&&predicate(x)),run(name,command,payload,key){const r=executeCommand(w,choosePersona(w,name),command,payload,key||`op-${++counter}`,BASE);w=r.workspace;return r.result;}};}
function versioned(s,o){return{id:o.id,version:s.w.objects.find(x=>x.id===o.id).version};}
function quoteInput(){return{originCep:'01001000',destinationCep:'01310100',packages:[{id:'PUBLIC-P1',weightKg:'2',lengthCm:'20',widthCm:'10',heightCm:'10',cargoClass:'GENERAL'},{id:'PUBLIC-P2',weightKg:'3',lengthCm:'20',widthCm:'10',heightCm:'10',cargoClass:'GENERAL'}]};}
function planned(s){
  const p=s.p('loja.admin'),locations=s.w.objects.filter(x=>x.kind==='location'&&x.org===p.org),q=s.run('loja.admin','quote',quoteInput());
  const order=s.run('loja.admin','order_create',{externalId:'PUBLIC-NEW-ORDER',quoteId:q.id,candidate:0,consumerCharge:'5.00',locationId:locations[1]?.id||locations[0].id,windowStart:'2026-11-26T20:00:00Z',windowEnd:'2026-11-28T20:00:00Z'});
  s.run('loja.admin','order_release',versioned(s,order));
  const plan=s.run('loja.admin','plan',{orderIds:[order.id],originLocationId:locations[0].id,start:'2026-11-26T20:00:00Z',capacityKg:'100',speedKmh:'40'});
  assert.equal(plan.status,'FEASIBLE');const ship=s.run('loja.admin','plan_commit',versioned(s,plan));return{order,ship,q,locations};
}
function assigned(s){const setup=planned(s),carrier=s.p('carrier1.admin'),v=s.run('carrier1.admin','fleet_create',{name:'Veículo público novo',type:'VEHICLE',fleetMode:'OWN',capacityKg:'100'}),dr=s.run('carrier1.admin','fleet_create',{name:'Motorista público novo',type:'DRIVER',fleetMode:'OWN',licenseValidTo:'2031-01-01T00:00:00Z',userId:s.p('lince.motorista').id});const t=s.run('loja.admin','tender',{shipmentId:setup.ship.id,version:setup.ship.version,carriers:[carrier.org],expiresAt:'2026-11-26T20:00:00Z'});const a=s.run('carrier1.admin','offer_respond',{...versioned(s,t),decision:'ACCEPT',vehicleId:v.id,driverId:dr.id});return{...setup,assignment:a};}

test('every visible desktop action has an explicit handler, including fiscal and driver contracts',()=>{
  const source=fs.readFileSync(new URL('../source-assets/app.js',import.meta.url),'utf8');
  const names=[...source.matchAll(/^([a-z_]+):\[/gm),...source.matchAll(/definitions\.([a-z_]+)\s*=/g)].map(x=>x[1]);
  for(const name of new Set(names)){assert.ok(COMMANDS.includes(name),name);assert.equal(typeof handlers[name],'function',name);}
  assert.ok(COMMANDS.includes('offline_sync'));assert.ok(COMMANDS.includes('inbox_receive'));
});
test('canonical seed rebases timestamps and normalizes four real fictional image payloads',()=>{
  const w=createWorkspace(seed,BASE);assert.equal(w.users.length,7);assert.equal(Object.keys(w.files).length,4);assert.ok(Object.values(w.files).every(x=>x.shipmentId&&x.base64));
  assert.equal(w.simulation,true);assert.equal(JSON.stringify(w.users).includes('password'),false);assert.notEqual(w.objects[0].createdAt,seed.objects[0].createdAt);
});
test('new workspaces remap users, organizations, entities, files and package-key references',()=>{
  const a=createWorkspace(seed,BASE),b=createWorkspace(seed,BASE),ua=choosePersona(a,'lince.motorista'),ub=choosePersona(b,'lince.motorista');assert.notEqual(ua.id,ub.id);assert.notEqual(ua.org,ub.org);
  const sa=a.objects.find(x=>x.kind==='shipment'&&x.driverUserId===ua.id),sb=b.objects.find(x=>x.kind==='shipment'&&x.driverUserId===ub.id);assert.notEqual(sa.id,sb.id);assert.notEqual(sa.assignmentId,sb.assignmentId);assert.notEqual(sa.packages[0].key,sb.packages[0].key);
  for(const ship of a.objects.filter(x=>x.kind==='shipment'))for(const pack of ship.packages)assert.ok(a.objects.some(o=>o.id===pack.orderId&&pack.key.startsWith(o.id+':')));
  for(const file of Object.values(a.files))assert.ok(a.objects.some(x=>x.kind==='shipment'&&x.id===file.shipmentId));
  assert.ok(!b.users.some(u=>`${u.org}:${u.id}`===`${ua.org}:${ua.id}`));
});
test('workspace remapping preserves scenario IDs and external package IDs with exact key consistency',()=>{
  const w=createWorkspace(seed,BASE);assert.deepEqual(w.manifest.scenarios.map(x=>x.id),seed.manifest.scenarios.map(x=>x.id));
  const before=seed.objects.filter(x=>x.kind==='shipment'),after=w.objects.filter(x=>x.kind==='shipment');assert.equal(after.length,before.length);
  for(let i=0;i<after.length;i++){
    assert.deepEqual(after[i].packages.map(p=>p.id),before[i].packages.map(p=>p.id));
    for(const pack of after[i].packages)assert.equal(pack.key,pack.orderId+':'+pack.id);
  }
  const manifest=w.objects.find(x=>x.kind==='simulationManifest');assert.deepEqual(manifest.scenarios.map(x=>x.id),seed.manifest.scenarios.map(x=>x.id));assert.ok(manifest.scenarios.every(s=>!s.orderId||w.objects.some(o=>o.id===s.orderId)));
});
test('quote comparison preserves historic snapshots and simulation does not write',()=>{
  const s=scenario(),q=s.run('loja.admin','quote',quoteInput());assert.ok(q.candidates.length>=2);assert.ok(q.candidates[0].cost);const before=JSON.stringify(s.w);simulate(s.w,s.p('loja.admin'),quoteInput());assert.equal(JSON.stringify(s.w),before);
  const rate=s.find('rate',x=>x.id===q.candidates[0].rateId);assert.throws(()=>s.run('loja.admin','rate_publish',versioned(s,rate)),/RATE_IMMUTABLE/);assert.deepEqual(s.find('quote',x=>x.id===q.id).candidates,q.candidates);
});
test('new order, plan and assignment conserve packages and reserve real simulation resources',()=>{
  const s=scenario(),{ship,assignment}=assigned(s),stored=s.find('shipment',x=>x.id===ship.id);assert.equal(stored.status,'ASSIGNED');assert.equal(stored.packages.length,2);assert.equal(stored.assignmentId,assignment.id);assert.equal(s.find('reservation',r=>r.shipmentId===ship.id).resourceIds.length,2);
  const change=s.run('loja.admin','replan',{...versioned(s,stored),reason:'Capacity contraprova',plan:{originLocationId:s.find('location').id,start:'2026-11-26T20:00:00Z',capacityKg:'1',speedKmh:'40'}});
  // Assigned replans create an approval request first; infeasibility is checked at approval.
  assert.equal(change.status,'PENDING');assert.equal(s.find('assignment',x=>x.id===assignment.id).status,'ACTIVE');
});
test('infeasible replan approval rolls back completely and keeps original assignment active',()=>{
  const s=scenario(),{ship,locations,assignment}=assigned(s),current=s.find('shipment',x=>x.id===ship.id);
  const change=s.run('loja.admin','replan',{...versioned(s,current),reason:'Teste de capacidade',plan:{originLocationId:locations[0].id,start:'2026-11-26T20:00:00Z',capacityKg:'1',speedKmh:'40'}});
  const before=JSON.stringify(s.w);assert.throws(()=>s.run('loja.admin','replan_approve',{...versioned(s,change),reason:'Conferência'}),/PLAN_NOT_FEASIBLE/);assert.equal(JSON.stringify(s.w),before);assert.equal(s.find('assignment',x=>x.id===assignment.id).status,'ACTIVE');
});
test('two-destination nearest-next route keeps snapshot order, legs and positions after live address changes',()=>{
  const s=scenario(),origin=s.run('loja.admin','master_create',{kind:'location',values:{name:'Origem sintética congelada',postalCode:'01001000',lat:-23.54,lon:-46.64}}),orders=[],locations=[];
  for(const[i,lat]of [-23.541,-23.56].entries()){
    const values={name:`Destino sintético ${i}`,postalCode:'01310100',lat,lon:-46.64},loc=s.run('loja.admin','master_create',{kind:'location',values}),q=s.run('loja.admin','quote',quoteInput());locations.push({loc,values});
    const order=s.run('loja.admin','order_create',{externalId:`SNAPSHOT-ROUTE-${i}`,quoteId:q.id,candidate:0,consumerCharge:'5',locationId:loc.id,windowStart:'2026-11-26T20:00:00Z',windowEnd:'2026-11-27T20:00:00Z'});s.run('loja.admin','order_release',versioned(s,order));orders.push(order);
  }
  const input={orderIds:orders.map(x=>x.id),originLocationId:origin.id,start:'2026-11-26T20:00:00Z',capacityKg:'100',speedKmh:'40'},before=s.run('loja.admin','plan',input);
  const{loc,values}=locations[0];s.run('loja.admin','master_update',{...versioned(s,loc),values:{...values,lat:-24.5}});
  const after=s.run('loja.admin','plan',input);assert.equal(before.stops[0].orderId,orders[0].id);assert.deepEqual(after.stops,before.stops);assert.equal(after.distanceKm,before.distanceKm);assert.equal(after.end,before.end);
  // Legacy orders without a snapshot retain an explicit live-location fallback.
  const legacy=s.w.objects.find(x=>x.id===orders[1].id);delete legacy.destinationSnapshot;const fallback=s.run('loja.admin','plan',input);assert.equal(fallback.status,'FEASIBLE');assert.equal(fallback.stops.find(x=>x.orderId===legacy.id).destination.id,legacy.locationId);
});
test('UNKNOWN records a single simulated effect and query materializes label once',()=>{
  const s=scenario(),initialEffects=Object.keys(s.w.mockEffects).length,{ship}=assigned(s),stored=s.find('shipment',x=>x.id===ship.id),message=s.run('carrier1.admin','label_request',{shipmentId:ship.id,version:stored.version,mode:'LOST_RESPONSE'});
  const uncertain=s.run('carrier1.admin','outbox_process',versioned(s,message));assert.equal(uncertain.status,'UNKNOWN');assert.equal(Object.keys(s.w.mockEffects).length,initialEffects+1);const before=JSON.stringify(s.w);assert.throws(()=>s.run('carrier1.admin','outbox_process',versioned(s,uncertain)),/RECONCILE_OR_DLQ_REQUIRED/);assert.equal(JSON.stringify(s.w),before);
  const resolved=s.run('carrier1.admin','outbox_query',versioned(s,uncertain));assert.equal(resolved.status,'DONE');assert.equal(s.find('shipment',x=>x.id===ship.id).labelStatus,'READY');assert.equal(Object.keys(s.w.mockEffects).length,initialEffects+1);
});
test('seeded UNKNOWN reconciles its already accepted fictional response with the same protocol and no repeated effect',()=>{
  const s=scenario(),message=s.find('outbox',o=>o.status==='UNKNOWN');assert.ok(message,'Seed requires an UNKNOWN scenario');
  const accepted=s.w.mockEffects[message.messageId];assert.ok(accepted,'Accepted fixture response must be present');assert.equal(accepted.real,false);
  const effectCount=Object.keys(s.w.mockEffects).length,matricesBefore=s.w.objects.filter(o=>o.kind==='routeMatrix').length,input=versioned(s,message),resolved=s.run('loja.admin','outbox_query',input,'seed-unknown-reconcile');
  assert.equal(resolved.status,'DONE');assert.equal(resolved.protocol,accepted.protocol);assert.equal(Object.keys(s.w.mockEffects).length,effectCount);assert.equal(s.w.objects.filter(o=>o.kind==='routeMatrix').length,matricesBefore+1);
  const replay=s.run('loja.admin','outbox_query',input,'seed-unknown-reconcile');assert.equal(replay.id,resolved.id);assert.equal(replay.protocol,accepted.protocol);assert.equal(s.w.objects.filter(o=>o.kind==='routeMatrix').length,matricesBefore+1);assert.equal(Object.keys(s.w.mockEffects).length,effectCount);
});
test('driver two PODs with one cached version reconcile to desktop and preserve late tracking',()=>{
  const s=scenario(),p=s.p('lince.motorista'),ship=s.find('shipment',x=>x.driverUserId===p.id&&x.stage==='DELIVERY'&&x.status==='IN_TRANSIT'),context={planVersion:ship.planVersion,assignmentId:ship.assignmentId,packageKeys:ship.packages.map(x=>x.key)};
  for(const [i,pack]of ship.packages.entries())s.run('lince.motorista','offline_sync',{command:'pod',context,payload:{shipmentId:ship.id,version:ship.version,proofId:`PUBLIC-PROOF-${i}`,packageKeys:[pack.key],outcome:'DELIVERED',reason:'Recebimento fictício',occurredAt:BASE}},`proof-${i}`);
  const done=s.find('shipment',x=>x.id===ship.id);assert.equal(done.status,'DELIVERED');assert.equal(done.delivered.length,3);
  s.run('lince.motorista','offline_sync',{command:'tracking',context,payload:{shipmentId:ship.id,eventId:'late-public',type:'IN_TRANSIT',occurredAt:'2026-11-25T19:59:00Z',planVersion:ship.planVersion}});
  assert.equal(s.find('shipment',x=>x.id===ship.id).status,'DELIVERED');assert.ok(stateFor(s.w,s.p('loja.admin')).objects.some(x=>x.kind==='pod'&&x.proofId==='PUBLIC-PROOF-0'));
});
test('largest remainder allocation is exact and nonnegative for tiny totals',()=>{
  for(const total of ['0.00','0.01','0.02','1.01','20.00'])for(const size of [1,2,4,10,100]){const weights=Object.fromEntries(Array.from({length:size},(_,i)=>[`P${i}`,String(i+1)])),a=allocate(total,weights);assert.equal(Object.values(a).reduce((n,x)=>n+Math.round(Number(x)*100),0),Math.round(Number(total)*100));assert.ok(Object.values(a).every(x=>Number(x)>=0));}
});
test('invoice dispute and approval create two simulation ledger entries without paying',()=>{
  const s=scenario(),dispute=s.find('dispute',x=>x.status==='OPEN');s.run('loja.admin','dispute_resolve',{...versioned(s,dispute),decision:'ADJUST_TO_EXPECTED',reason:'Conferência fictícia'});const invoice=s.find('invoice',x=>x.id===dispute.invoiceId),a=s.run('loja.admin','approval_request',{invoiceId:invoice.id,version:invoice.version});
  const result=s.run('loja.aprovador','approval_decide',{...versioned(s,a),decision:'APPROVE'});assert.equal(result.entryIds.length,2);assert.ok(result.entryIds.every(e=>s.find('ledger',x=>x.id===e).realPayment===false));assert.equal(s.find('invoice',x=>x.id===invoice.id).status,'POSTED_LOCAL');
});
test('fiscal future profile preflight remains externally blocked rather than issuing anything',()=>{
  const s=scenario(),profile=s.run('loja.admin','fiscal_profile_create',{name:'Contrato público a preparar',route:'DIRECT',environment:'HOMOLOGATION',documents:['CTE'],ufs:['SP'],issuerRef:'issuer:public',scenarioApprovalRef:'review:public',certificateRef:'certificate:declared',registrationRef:'registration:declared',endpointCatalogRef:'catalog:declared',retentionPolicyRef:'policy:declared',schemaRefs:{CTE:'schema:candidate'}});const r=s.run('loja.admin','fiscal_local_preflight',{profileId:profile.id,document:'CTE',operation:'QUERY',businessReference:'PUBLIC-DEMO',requestReference:'PUBLIC-REQ-1'});assert.equal(r.status,'PREPARED_EXTERNAL_BLOCKED');assert.equal(r.realConnectionEnabled,false);assert.equal(r.protocol,null);
});
test('fiscal incomplete profile and incompatible document operations fail without false preparation',()=>{
  const s=scenario(),empty=s.run('loja.admin','fiscal_profile_create',{name:'Perfil incompleto',route:'LOCAL_MOCK',environment:'LOCAL_TEST',ufs:[],documents:[]}),assessment=s.run('loja.admin','fiscal_readiness_assess',{profileId:empty.id});assert.equal(assessment.status,'PENDING_DATA');assert.ok(assessment.missing.some(x=>x.field==='ufs'));assert.ok(assessment.missing.some(x=>x.field==='documents'));
  assert.throws(()=>s.run('loja.admin','fiscal_local_preflight',{profileId:empty.id,document:'CTE',operation:'QUERY',businessReference:'X',requestReference:'empty'}),/FISCAL_PROFILE_INCOMPLETE/);
  const values={name:'Contrato local completo',route:'LOCAL_MOCK',environment:'LOCAL_TEST',ufs:['SP'],documents:['CTE','NFE_REFERENCE'],issuerRef:'issuer:public',scenarioApprovalRef:'review:public',schemaRefs:{CTE:'schema:cte',NFE_REFERENCE:'schema:nfe-reference'}},profile=s.run('loja.admin','fiscal_profile_create',values);
  for(const[document,operation,error]of [['NFE_REFERENCE','ISSUE','NFE_IS_EXTERNAL_REFERENCE'],['CTE','CLOSE','FISCAL_CLOSE_NOT_APPLICABLE']])assert.throws(()=>s.run('loja.admin','fiscal_local_preflight',{profileId:profile.id,document,operation,businessReference:'X',requestReference:document+operation}),new RegExp(error));
  const ok=s.run('loja.admin','fiscal_local_preflight',{profileId:profile.id,document:'NFE_REFERENCE',operation:'QUERY',businessReference:'X',requestReference:'valid-query'});assert.equal(ok.status,'DEMO_PREPARED');
  s.run('loja.admin','fiscal_profile_revise',{...versioned(s,profile),values:{...values,name:'Revisão única'},reason:'Ajuste candidato'});
  assert.throws(()=>s.run('loja.admin','fiscal_profile_revise',{...versioned(s,profile),values,reason:'Segundo sucessor'}),/FISCAL_REVISION_EXISTS/);
});
test('DLQ explicit triage and passive inbox events preserve identities and dedup',()=>{
  const s=scenario(),ship=s.find('shipment',x=>x.status==='IN_TRANSIT'),m=s.run('loja.admin','adapter_enqueue',{adapter:'WMS',mode:'BEFORE_FAILURE',payload:{shipmentId:ship.id,custody:'READY'}});let r=m;for(let i=0;i<3;i++)r=s.run('loja.admin','outbox_process',versioned(s,r));assert.equal(r.status,'DLQ');r=s.run('loja.admin','outbox_requeue',{...versioned(s,r),reason:'Condição corrigida',mode:'GOOD'});r=s.run('loja.admin','outbox_process',versioned(s,r));assert.equal(r.status,'DONE');assert.equal(r.messageId,m.messageId);assert.equal(r.attempts,4);
  const event={eventId:'PUBLIC-INBOX-1',type:'WMS',payload:{shipmentId:ship.id,custody:'HANDED_OVER'}},one=s.run('loja.admin','inbox_receive',event),two=s.run('loja.admin','inbox_receive',event);assert.equal(one.id,two.id);assert.equal(s.w.inbox.length,1);
});

class FakeD1{
  rows=new Map();chunks=new Map();forceConflict=false;queries=[];
  prepare(sql){this.queries.push(sql);const db=this;return{bind(...params){return{
    async first(){if(sql.startsWith('SELECT version,data'))return db.rows.get(params[0])||null;throw new Error('Unexpected first '+sql);},
    async all(){if(sql.startsWith('SELECT chunk_index,body'))return{results:[...db.chunks.entries()].filter(([k])=>k.startsWith(params[0]+':'+params[1]+':')).map(([k,body])=>({chunk_index:Number(k.split(':').at(-1)),body})).sort((a,b)=>a.chunk_index-b.chunk_index)};throw new Error('Unexpected all '+sql);},
    async run(){
      if(sql.startsWith('INSERT OR REPLACE INTO simulation_file_chunks')){db.chunks.set(`${params[0]}:${params[1]}:${params[2]}`,params[3]);return{meta:{changes:1}};}
      if(sql.startsWith('INSERT OR IGNORE INTO simulation_workspaces')){if(db.rows.has(params[0]))return{meta:{changes:0}};db.rows.set(params[0],{version:1,data:params[1]});return{meta:{changes:1}};}
      if(sql.startsWith('UPDATE simulation_workspaces')){if(db.forceConflict){db.forceConflict=false;return{meta:{changes:0}};}const row=db.rows.get(params[2]);if(!row||row.version!==params[3])return{meta:{changes:0}};db.rows.set(params[2],{version:row.version+1,data:params[0]});return{meta:{changes:1}};}
      throw new Error('Unexpected run '+sql);
    }
  };}};}
}
const W1='11111111-1111-4111-8111-111111111111',W2='22222222-2222-4222-8222-222222222222';
test('HTTP worker persists scenario by workspace and command retry does not duplicate effect',async()=>{
  const db=new FakeD1(),worker=createWorker({seed,assets:{'/':{bodyBase64:btoa('<h1>Lince demo</h1>'),mime:'text/html'}}});
  async function call(path,{workspace=W1,persona='loja.admin',method='GET',body,key}={}){const headers={'X-Lince-Workspace':workspace,'X-Lince-Persona':persona};if(body!==undefined)headers['Content-Type']='application/json';if(key)headers['Idempotency-Key']=key;return worker.fetch(new Request('https://example.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{DB:db});}
  assert.equal((await call('/')).status,200);const first=await(await call('/api/state')).json();assert.equal(first.workspaceVersion,1);
  const payload={name:'Cenário persistido no Worker',input:quoteInput()},response=await call('/api/command',{method:'POST',body:{command:'scenario_save',payload},key:'same-operation'});assert.equal(response.status,200);const result=await response.json();
  const retry=await call('/api/command',{method:'POST',body:{command:'scenario_save',payload},key:'same-operation'});assert.equal((await retry.json()).id,result.id);
  const read=await(await call('/api/state')).json();assert.equal(read.objects.filter(o=>o.id===result.id).length,1);assert.equal(read.workspaceVersion,2);
  const independent=await(await call('/api/state',{workspace:W2})).json();assert.equal(independent.objects.some(o=>o.id===result.id),false);assert.ok(db.queries.every(q=>!q.includes('CREATE TABLE')));
});
test('HTTP simulation manifest endpoint reflects the current persona view and stays fictional',async()=>{
  const db=new FakeD1(),worker=createWorker({seed,assets:{}}),headers={'X-Lince-Workspace':W1,'X-Lince-Persona':'loja.admin'};
  const response=await worker.fetch(new Request('https://example.test/api/simulation',{headers}),{DB:db});assert.equal(response.status,200);const data=await response.json();assert.equal(data.enabled,true);assert.equal(data.manifest.kind,'simulationManifest');assert.equal(data.realOperationAllowed,false);assert.deepEqual(data.manifest.scenarios.map(x=>x.id),seed.manifest.scenarios.map(x=>x.id));
  const driverResponse=await worker.fetch(new Request('https://example.test/api/simulation',{headers:{...headers,'X-Lince-Persona':'lince.motorista'}}),{DB:db});const driver=await driverResponse.json();assert.equal(driver.enabled,false);assert.equal(driver.manifest,null);assert.equal(driver.realOperationAllowed,false);
});
test('HTTP CAS conflict has no committed domain mutation and same operation can be retried',async()=>{
  const db=new FakeD1(),worker=createWorker({seed,assets:{}}),headers={'X-Lince-Workspace':W1,'X-Lince-Persona':'loja.admin','Content-Type':'application/json','Idempotency-Key':'cas-op'};
  await worker.fetch(new Request('https://example.test/api/state',{headers}),{DB:db});const before=db.rows.get(W1).data;db.forceConflict=true;
  const request=()=>new Request('https://example.test/api/command',{method:'POST',headers,body:JSON.stringify({command:'scenario_save',payload:{name:'CAS scenario',input:quoteInput()}})});
  const failed=await worker.fetch(request(),{DB:db});assert.equal(failed.status,409);assert.equal(db.rows.get(W1).data,before);
  const next=await worker.fetch(request(),{DB:db});assert.equal(next.status,200);assert.equal(db.rows.get(W1).version,2);
});
test('HTTP fictional image chunks roundtrip and backup is an actual ZIP container',async()=>{
  const db=new FakeD1(),worker=createWorker({seed,assets:{}}),headers={'X-Lince-Workspace':W1,'X-Lince-Persona':'loja.admin'};
  await worker.fetch(new Request('https://example.test/api/state',{headers}),{DB:db});const metadata=Object.values(JSON.parse(db.rows.get(W1).data).files)[0],file=seed.files[0],response=await worker.fetch(new Request(`https://example.test/api/file?id=${metadata.id}`,{headers}),{DB:db});assert.equal(response.status,200);const received=Buffer.from(await response.arrayBuffer());assert.equal(received.toString('base64'),file.base64);assert.equal(JSON.stringify(JSON.parse(db.rows.get(W1).data).files).includes('base64'),false);
  const backup=await worker.fetch(new Request('https://example.test/api/backup',{method:'POST',headers}),{DB:db});assert.equal(backup.status,200);const body=new Uint8Array(await backup.arrayBuffer());assert.deepEqual([...body.slice(0,4)],[0x50,0x4b,3,4]);assert.equal(backup.headers.get('Content-Type'),'application/zip');
});
test('HTTP two-MiB binary transport is chunked without retaining base64 in the D1 JSON row',async()=>{
  const db=new FakeD1(),worker=createWorker({seed,assets:{}}),headers={'X-Lince-Workspace':W1,'X-Lince-Persona':'carrier1.admin','Content-Type':'application/json','Idempotency-Key':'max-photo'};
  const initial=await(await worker.fetch(new Request('https://example.test/api/state',{headers}),{DB:db})).json(),ship=initial.objects.find(x=>x.kind==='shipment'&&x.status==='IN_TRANSIT');
  // Signature-shaped synthetic bytes exercise capacity/roundtrip, not image decoding.
  const bytes=Buffer.alloc(2*1024*1024,0);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);const base64=bytes.toString('base64'),request=()=>new Request('https://example.test/api/command',{method:'POST',headers,body:JSON.stringify({command:'upload_pod',payload:{shipmentId:ship.id,base64}})});
  const first=await worker.fetch(request(),{DB:db});assert.equal(first.status,200);const file=await first.json();assert.equal(file.bytes,2*1024*1024);assert.ok(Buffer.byteLength(db.rows.get(W1).data)<900000);assert.equal(db.rows.get(W1).data.includes(base64.slice(0,1000)),false);
  const replay=await(await worker.fetch(request(),{DB:db})).json();assert.equal(replay.id,file.id);
  const retrieved=await worker.fetch(new Request(`https://example.test/api/file?id=${file.id}`,{headers}),{DB:db});assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()),bytes);
});
test('public context recovers bootstrap offline-to-online in the same page with one shared retry',async()=>{
  const state={online:false,bootstrapCalls:0,sessionCalls:0,stateCalls:0},storage=()=>{const values=new Map();return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
  const sessionStorage=storage(),localStorage=storage();sessionStorage.setItem('lince-demo-workspace',W1);
  const persona={id:'public-persona',org:'public-org',username:'loja.admin',roles:['admin']},nativeFetch=async(input,init={})=>{
    const path=new URL(typeof input==='string'?input:input.url,'https://example.test').pathname;
    if(path==='/api/personas'){state.bootstrapCalls++;if(!state.online)throw new TypeError('Network offline');await Promise.resolve();return Response.json({personas:[persona]});}
    if(path==='/api/session'){state.sessionCalls++;assert.equal(new Headers(init.headers).get('X-Lince-Workspace'),W1);assert.equal(new Headers(init.headers).get('X-Lince-Persona'),persona.id);return Response.json({user:persona,simulation:true});}
    if(path==='/api/state'){state.stateCalls++;return Response.json({objects:[]});}
    throw new Error('Unexpected network request '+path);
  };
  const sandbox={URL,Request,Response,Headers,crypto,Promise,TypeError,Error,console,sessionStorage,localStorage,location:{href:`https://example.test/?workspace=${W1}`,pathname:'/',origin:'https://example.test'},history:{replaceState(){}},document:{readyState:'loading',addEventListener(){},querySelectorAll(){return[];}},navigator:{get onLine(){return state.online;}},fetch:nativeFetch};sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('./demo-context.js',import.meta.url),'utf8'),sandbox);
  await assert.rejects(sandbox.LincePublicContext.ready,/Network offline/);assert.equal(state.bootstrapCalls,1);assert.equal(sandbox.LincePublicContext.status,'failed');
  await assert.rejects(sandbox.fetch('/api/session'),/Network offline/);assert.equal(state.bootstrapCalls,1);assert.equal(state.sessionCalls,0);
  state.online=true;
  const [sessionResponse,stateResponse]=await Promise.all([sandbox.fetch('/api/session'),sandbox.fetch('/api/state')]);assert.equal((await sessionResponse.json()).user.id,persona.id);assert.equal(stateResponse.status,200);assert.equal(state.bootstrapCalls,2);assert.equal(state.sessionCalls,1);assert.equal(state.stateCalls,1);assert.equal(sandbox.LincePublicContext.status,'ready');
});
test('driver public entry selects the dedicated seeded driver with assigned trips',async()=>{
  const w=createWorkspace(seed,BASE),catalog=w.users,values=new Map([['lince-demo-workspace',W1]]),sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},localStorage={getItem(){return null;},setItem(){},removeItem(){}},sandbox={URL,Request,Response,Headers,crypto,Promise,TypeError,Error,console,sessionStorage,localStorage,location:{href:`https://example.test/driver/?workspace=${W1}`,pathname:'/driver/',origin:'https://example.test'},history:{replaceState(){}},document:{readyState:'loading',addEventListener(){},querySelectorAll(){return[];}},navigator:{onLine:true},fetch:async input=>{assert.equal(new URL(typeof input==='string'?input:input.url,'https://example.test').pathname,'/api/personas');return Response.json({personas:catalog});}};sandbox.window=sandbox;
  assert.ok(catalog.findIndex(p=>p.username==='carrier1.admin')<catalog.findIndex(p=>p.username==='lince.motorista'));
  vm.runInNewContext(fs.readFileSync(new URL('./demo-context.js',import.meta.url),'utf8'),sandbox);await sandbox.LincePublicContext.ready;
  const selected=choosePersona(w,sandbox.LincePublicContext.persona);assert.equal(selected.username,'lince.motorista');assert.ok(stateFor(w,selected).objects.some(o=>o.kind==='shipment'&&o.driverUserId===selected.id));
});

const result={scope:'Public fictional JS simulation domain and HTTP Worker using an in-memory D1 adapter; no actual Cloudflare deployment, browser, production equivalence or permissions audit',tests:[]};
for(const item of tests){try{await item.fn();result.tests.push({name:item.name,pass:true});}catch(error){result.tests.push({name:item.name,pass:false,error:error.stack});}}
result.passed=result.tests.filter(x=>x.pass).length;result.total=result.tests.length;console.log(JSON.stringify(result,null,2));if(result.passed!==result.total)process.exitCode=1;
