/* QA-TMS-20261125-JS. New business journeys over Worker HTTP + in-memory D1.
   No live service, browser, permission campaign, credentials or publication. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createWorker} from './worker.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const EVIDENCE=fileURLToPath(new URL('../evidencias/qa-tms-20261125/public-runtime/',import.meta.url));
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url),'utf8'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(new URL(file,import.meta.url))).digest('hex');
const sourceFiles=['domain.mjs','worker.mjs','seed.json','../application/operations.py','../application/catalog.py','../PRD.md','../ECOMMERCE.md'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,digest(file)]));
const cases=[];const test=(id,title,expected,run)=>cases.push({id,title,expected,run});
const cp=x=>JSON.parse(JSON.stringify(x));
const future=days=>new Date(Date.now()+days*86400000).toISOString();
const cents=x=>Math.round(Number(x)*100);
class MemoryD1{
  rows=new Map();chunks=new Map();
  prepare(sql){const db=this;return{bind(...args){return{
    async first(){if(sql.startsWith('SELECT version,data'))return db.rows.get(args[0])||null;throw Error('Unexpected SELECT '+sql);},
    async all(){if(sql.startsWith('SELECT chunk_index,body'))return{results:[...db.chunks.entries()].filter(([key])=>key.startsWith(args[0]+':'+args[1]+':')).map(([key,body])=>({chunk_index:Number(key.split(':').at(-1)),body})).sort((a,b)=>a.chunk_index-b.chunk_index)};throw Error('Unexpected query '+sql);},
    async run(){
      if(sql.startsWith('INSERT OR REPLACE INTO simulation_file_chunks')){db.chunks.set(`${args[0]}:${args[1]}:${args[2]}`,args[3]);return{meta:{changes:1}};}
      if(sql.startsWith('INSERT OR IGNORE INTO simulation_workspaces')){if(db.rows.has(args[0]))return{meta:{changes:0}};db.rows.set(args[0],{version:1,data:args[1]});return{meta:{changes:1}};}
      if(sql.startsWith('UPDATE simulation_workspaces')){const old=db.rows.get(args[2]);if(!old||old.version!==args[3])return{meta:{changes:0}};db.rows.set(args[2],{version:old.version+1,data:args[0]});return{meta:{changes:1}};}
      throw Error('Unexpected write '+sql);
    }
  };}};}
}
class Journey{
  constructor(label){this.label=label;this.db=new MemoryD1();this.workspace=crypto.randomUUID();this.worker=createWorker({seed,assets:{}});this.trace=[];this.sequence=0;}
  async request(path,{persona='loja.admin',method='GET',body,key}={}){
    const headers={'X-Lince-Workspace':this.workspace,'X-Lince-Persona':persona};if(body!==undefined)headers['Content-Type']='application/json';if(key)headers['Idempotency-Key']=key;
    const response=await this.worker.fetch(new Request('https://qa.invalid'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{DB:this.db});
    const type=response.headers.get('Content-Type')||'',data=type.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer());
    this.trace.push({step:++this.sequence,path,method,persona,key:key||null,input:body===undefined?null:cp(body),http:response.status,observed:data instanceof Uint8Array?{bytes:data.length,signature:[...data.slice(0,8)]}:{id:data.id,kind:data.kind,status:data.status,error:data.error||null,version:data.version,workspaceVersion:data.workspaceVersion}});
    return{status:response.status,data};
  }
  async state(){const r=await this.request('/api/state');assert.equal(r.status,200);return r.data;}
  async object(id){const r=await this.request('/api/state?id='+encodeURIComponent(id));assert.equal(r.status,200);return r.data;}
  async command(command,payload,{persona='loja.admin',key}={}){const operation=key||`${this.label}-${crypto.randomUUID()}`,r=await this.request('/api/command',{method:'POST',persona,key:operation,body:{command,payload}});assert.equal(r.status,200,`${command}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
  async attempt(command,payload,{persona='loja.admin',key}={}){return this.request('/api/command',{method:'POST',persona,key:key||`${this.label}-${crypto.randomUUID()}`,body:{command,payload}});}
  raw(){return this.db.rows.get(this.workspace)?.data||null;}
  async version(id){const o=await this.object(id);return{id:o.id,version:o.version};}
  restart(){this.worker=createWorker({seed,assets:{}});}
}
const packages=(a='2',b='3')=>[{id:'QA-V1',weightKg:a,lengthCm:'20',widthCm:'10',heightCm:'10',cargoClass:'GENERAL'},{id:'QA-V2',weightKg:b,lengthCm:'20',widthCm:'10',heightCm:'10',cargoClass:'GENERAL'}];
async function fixture(j){
  const state=await j.state(),carrier=state.users.find(x=>x.username==='carrier1.admin'),driver=state.users.find(x=>x.username==='lince.motorista');
  const calendar=await j.command('master_create',{kind:'calendar',values:{name:'QA calendário editável',timezone:'America/Sao_Paulo',cutoff:'14:00',weekdays:[0,1,2,3,4],holidays:[]}});
  const service=await j.command('master_create',{kind:'service',values:{name:'QA serviço de referência',calendarId:calendar.id,transitDays:2,maxPackageKg:'30',maxShipmentKg:'100'}});
  const zone=await j.command('master_create',{kind:'zone',values:{name:'QA zona de referência',from:'01310100',to:'01310100',priority:999}});
  const rate=await j.command('rate_create',{name:'QA tarifa 10 + 2/kg',side:'BUY',carrierOrg:carrier.org,zoneId:zone.id,serviceId:service.id,validFrom:future(-365),validTo:future(365),minKg:'0',maxKg:'101',base:'10',perKg:'2',priority:999,additions:[]});await j.command('rate_publish',await j.version(rate.id));
  const origin=await j.command('master_create',{kind:'location',values:{name:'QA CD fictício',postalCode:'01001000',lat:-23.54,lon:-46.64,addressLine:'Rua de teste',number:'10',city:'São Paulo',uf:'SP'}});
  const destination=await j.command('master_create',{kind:'location',values:{name:'QA destino original',postalCode:'01310100',lat:-23.541,lon:-46.64,addressLine:'Destino sintético',number:'20',city:'São Paulo',uf:'SP'}});
  return{carrier,driver,origin,destination,calendar,service,zone,rate,start:future(1),end:future(3)};
}
async function quotation(j,f,packs=packages(),ceps={}){const q=await j.command('quote',{originCep:'01001000',destinationCep:'01310100',packages:packs,...ceps});const candidate=q.candidates.findIndex(x=>x.carrierOrg===f.carrier.org&&x.serviceId===f.service.id);assert.ok(candidate>=0);return{q,candidate};}
async function order(j,f,reference,packs=packages()){const{q,candidate}=await quotation(j,f,packs),input={externalId:reference,quoteId:q.id,candidate,packages:packs,consumerCharge:'5.00',locationId:f.destination.id,windowStart:f.start,windowEnd:f.end};const o=await j.command('order_create',input);return{o,q,input,candidate};}
async function planned(j,f,o){await j.command('order_release',await j.version(o.id));const input={orderIds:[o.id],originLocationId:f.origin.id,start:f.start,capacityKg:'100',speedKmh:'40'},plan=await j.command('plan',input);assert.equal(plan.status,'FEASIBLE');return{ship:await j.command('plan_commit',await j.version(plan.id)),plan,input};}
async function offered(j,f,ship){const s=await j.object(ship.id);return j.command('tender',{shipmentId:s.id,version:s.version,carriers:[f.carrier.org],expiresAt:future(1)});}
async function resources(j,f){const vehicle=await j.command('fleet_create',{name:'QA veículo editável',type:'VEHICLE',fleetMode:'OWN',capacityKg:'100'},{persona:'carrier1.admin'}),driver=await j.command('fleet_create',{name:'QA recurso motorista',type:'DRIVER',fleetMode:'OWN',licenseValidTo:future(365),userId:f.driver.id},{persona:'carrier1.admin'});return{vehicle,driver};}
async function awarded(j,f,ship){const res=await resources(j,f),tender=await offered(j,f,ship),a=await j.command('offer_respond',{...await j.version(tender.id),decision:'ACCEPT',vehicleId:res.vehicle.id,driverId:res.driver.id},{persona:'carrier1.admin'});return{...res,tender,assignment:a};}
async function dispatch(j,f,ship){
  const s=await j.object(ship.id),label=await j.command('label_request',{shipmentId:s.id,version:s.version,mode:'GOOD'},{persona:'carrier1.admin'});await j.command('outbox_process',await j.version(label.id),{persona:'carrier1.admin'});
  const policy=await j.command('fiscal_policy',{name:'QA documento somente fictício',scenario:'QA_TMS_JOURNEY',mode:'DEMO_ONLY',requirements:['DEMO_DOCUMENT']},{persona:'carrier1.admin'});
  const now=await j.object(ship.id),doc=await j.command('fiscal_evaluate',{shipmentId:now.id,version:now.version,policyId:policy.id,scenario:'QA_TMS_JOURNEY'},{persona:'carrier1.admin'});await j.command('outbox_process',await j.version(doc.outboxId),{persona:'carrier1.admin'});
  for(const stage of ['PICKUP','HUB','TRANSFER','LAST_MILE','DELIVERY']){const latest=await j.object(ship.id);await j.command('stage',{shipmentId:latest.id,version:latest.version,stage,packageKeys:latest.packages.map(x=>x.key)},{persona:'lince.motorista'});}
  return j.object(ship.id);
}
async function rejectWithoutMutation(j,command,payload,options={}){const before=j.raw(),r=await j.attempt(command,payload,options);assert.ok(r.status>=400&&r.status<500,`Expected business refusal, got ${r.status}: ${JSON.stringify(r.data)}`);assert.equal(j.raw(),before,'Refused business command changed the persisted workspace');return r.data.error.code;}

test('QA-JS-01','Editar pedido antes do planejamento com nova cotação e conflito de versão','Cotação original20/cobrança5/subsídio15 preservada; edição para7kg custa24, cobrança6/subsídio18; staleversion recusa sem mutação.',async j=>{
  const f=await fixture(j),{o,q}=await order(j,f,'QA-EDIT-BEFORE');assert.equal(o.candidate.cost,'20.00');assert.equal(o.consumerCharge,'5.00');assert.equal(o.subsidy,'15.00');const original=cp(q),replacement=await quotation(j,f,packages('4','3'));
  const edited=await j.command('order_change',{...await j.version(o.id),operation:'EDIT',reason:'Peso corrigido após conferência',values:{quoteId:replacement.q.id,candidate:replacement.candidate,packages:packages('4','3'),consumerCharge:'6.00',locationId:f.destination.id,windowStart:f.start,windowEnd:f.end}});
  assert.equal(edited.candidate.cost,'24.00');assert.equal(edited.subsidy,'18.00');assert.equal(edited.packages.reduce((n,p)=>n+Number(p.weightKg),0),7);assert.deepEqual((await j.object(q.id)).candidates,original.candidates);assert.ok(edited.revisions.some(x=>x.consumerCharge==='5.00'));
  assert.equal(await rejectWithoutMutation(j,'order_change',{id:o.id,version:o.version,operation:'CANCEL',reason:'Versão antiga'}),'VERSION_CONFLICT');j.restart();assert.equal((await j.object(o.id)).consumerCharge,'6.00');
});
test('QA-JS-02','Editar pedido contratado preservando revisão anterior','EDIT contratado gera proposta sem alterar operação; resolver cancela assignment/reserva anteriores, recota e conserva snapshot anterior em revisions.',async j=>{
  const f=await fixture(j),{o}=await order(j,f,'QA-EDIT-AFTER-AWARD'),{ship}=await planned(j,f,o),award=await awarded(j,f,ship),before=await j.object(o.id),q=await quotation(j,f,packages('3','3'));
  const c=await j.command('order_change',{...await j.version(o.id),operation:'EDIT',reason:'Correção acordada',values:{quoteId:q.q.id,candidate:q.candidate,packages:packages('3','3'),consumerCharge:'7.00',locationId:f.destination.id,windowStart:f.start,windowEnd:f.end}});assert.equal(c.status,'APPROVAL_REQUIRED');assert.equal((await j.object(o.id)).consumerCharge,'5.00');
  await j.command('change_resolve',{...await j.version(c.id),resolution:'Recontratar com nova massa'});const changed=await j.object(o.id);assert.equal(changed.status,'VALIDATED');assert.equal(changed.consumerCharge,'7.00');assert.equal((await j.object(ship.id)).status,'CANCELLED');assert.equal((await j.object(award.assignment.id)).status,'CANCELLED');const state=await j.state();assert.ok(state.objects.filter(x=>x.kind==='reservation'&&x.shipmentId===ship.id).every(x=>x.status==='RELEASED'));
  assert.ok(changed.revisions.some(x=>x.quoteId===before.quoteId&&x.consumerCharge===before.consumerCharge),'Accepted post-award edit lost the prior order revision');
});
test('QA-JS-03','Cancelar pedido em oferta e impedir aceite de oferta antiga','CANCEL cancela pedido/viagem/oferta aberta; responder oferta antiga falha e não cria assignment ou reserva.',async j=>{
  const f=await fixture(j),{o}=await order(j,f,'QA-CANCEL-OFFERED'),{ship}=await planned(j,f,o),tender=await offered(j,f,ship),res=await resources(j,f);
  await j.command('order_change',{...await j.version(o.id),operation:'CANCEL',reason:'Cancelamento antes do aceite'});assert.equal((await j.object(o.id)).status,'CANCELLED');assert.equal((await j.object(ship.id)).status,'CANCELLED');
  const old=await j.object(tender.id),before=j.raw(),attempt=await j.attempt('offer_respond',{id:old.id,version:old.version,decision:'ACCEPT',vehicleId:res.vehicle.id,driverId:res.driver.id},{persona:'carrier1.admin'});
  assert.ok(attempt.status>=400&&attempt.status<500,`Stale offer accepted after order cancellation: ${attempt.status}`);assert.equal(j.raw(),before);assert.equal((await j.object(tender.id)).status,'CANCELLED');
});
test('QA-JS-04','Não aceitar destino diferente do CEP cotado','Pedido com local01001000 e quote01310100 é recusado por divergência de destino, sem criar pedido.',async j=>{
  const f=await fixture(j),{q,candidate}=await quotation(j,f);const code=await rejectWithoutMutation(j,'order_create',{externalId:'QA-WRONG-DESTINATION',quoteId:q.id,candidate,packages:packages(),consumerCharge:'5.00',locationId:f.origin.id,windowStart:f.start,windowEnd:f.end});assert.ok(['DESTINATION_MISMATCH','QUOTE_CONTENT_MISMATCH'].includes(code),code);
});
test('QA-JS-05','Não ignorar alteração de volumes enviada com quote antigo','Pacote solicitado com peso/dimensões diferentes do quote exige recotação e não é silenciosamente substituído pelo snapshot.',async j=>{
  const f=await fixture(j),{q,candidate}=await quotation(j,f);await rejectWithoutMutation(j,'order_create',{externalId:'QA-MISMATCHED-PACKAGES',quoteId:q.id,candidate,packages:packages('9','3'),consumerCharge:'5.00',locationId:f.destination.id,windowStart:f.start,windowEnd:f.end});
});
test('QA-JS-06','Editar veículo/motorista e respeitar reserva/manutenção/versão','fleet_update edita nome/capacidade/licença; rejeita staleversion, valores inválidos, mudança de tipo, recurso reservado ou em manutenção, preservando vínculos.',async j=>{
  const f=await fixture(j),res=await resources(j,f),v=await j.command('fleet_update',{...await j.version(res.vehicle.id),values:{name:'QA van revisada',capacityKg:'80'}},{persona:'carrier1.admin'});assert.equal(v.name,'QA van revisada');assert.equal(v.capacityKg,'80');assert.equal(v.type,'VEHICLE');assert.equal(v.org,f.carrier.org);assert.equal(v.fleetMode,'OWN');
  const license=future(500),dr=await j.command('fleet_update',{...await j.version(res.driver.id),values:{name:'QA motorista revisado',licenseValidTo:license}},{persona:'carrier1.admin'});assert.equal(dr.userId,f.driver.id);assert.equal(dr.licenseValidTo,license);
  await rejectWithoutMutation(j,'fleet_update',{id:res.vehicle.id,version:res.vehicle.version,values:{name:'Stale'}},{persona:'carrier1.admin'});
  for(const values of [{},{capacityKg:'0'},{capacityKg:'-1'},{type:'DRIVER'}])await rejectWithoutMutation(j,'fleet_update',{...await j.version(v.id),values},{persona:'carrier1.admin'});
  await rejectWithoutMutation(j,'fleet_update',{...await j.version(dr.id),values:{licenseValidTo:future(-1)}},{persona:'carrier1.admin'});
  const m=await j.command('maintenance',{resourceId:v.id,start:f.start,end:f.end,reason:'Revisão programada'},{persona:'carrier1.admin'});await rejectWithoutMutation(j,'fleet_update',{...await j.version(v.id),values:{name:'Durante manutenção'}},{persona:'carrier1.admin'});await j.command('maintenance_finish',{...await j.version(m.id),result:'CANCELLED',reason:'Teste de elegibilidade'},{persona:'carrier1.admin'});
  const{o}=await order(j,f,'QA-RESERVED-RESOURCE'),{ship}=await planned(j,f,o),t=await offered(j,f,ship);await j.command('offer_respond',{...await j.version(t.id),decision:'ACCEPT',vehicleId:v.id,driverId:dr.id},{persona:'carrier1.admin'});await rejectWithoutMutation(j,'fleet_update',{...await j.version(v.id),values:{capacityKg:'90'}},{persona:'carrier1.admin'});j.restart();assert.equal((await j.object(v.id)).capacityKg,'80');
});
test('QA-JS-07','Jornada nova completa, entrega parcial, disputa, baixa e estorno','Volumes2/3kg e contratação20; tentativaFAILED não entrega; parcial1/2→completa2/2; fatura22 disputa2 e ajusta20; AP/AR20, baixa0.004 recusa sem approvalzero, baixa7/saldo13, compensação e estorno zeram saldos. Reversa não altera frete5.',async j=>{
  const f=await fixture(j),{o}=await order(j,f,'QA-COMPLETE-JOURNEY'),{ship}=await planned(j,f,o),award=await awarded(j,f,ship);let s=await dispatch(j,f,ship);assert.equal(s.custody.length,5);
  const image=seed.files[0].base64,file=await j.command('upload_pod',{shipmentId:s.id,base64:image},{persona:'lince.motorista'}),keys=s.packages.map(x=>x.key),at=new Date().toISOString();
  await j.command('pod',{shipmentId:s.id,version:s.version,proofId:'QA-FAILED',packageKeys:[keys[0]],outcome:'FAILED',reason:'Destinatário ausente na simulação',occurredAt:at},{persona:'lince.motorista'});s=await j.object(s.id);assert.equal(s.delivered.length,0);
  await j.command('pod',{shipmentId:s.id,version:s.version,proofId:'QA-PARTIAL',packageKeys:[keys[0]],outcome:'DELIVERED',reason:'Recebimento parcial fictício',occurredAt:at,fileId:file.id},{persona:'lince.motorista'});s=await j.object(s.id);assert.equal(s.status,'PARTIAL');assert.equal(s.delivered.length,1);
  const lastPayload={shipmentId:s.id,version:s.version,proofId:'QA-COMPLETE',packageKeys:[keys[1]],outcome:'DELIVERED',reason:'Recebimento final fictício',occurredAt:at},proof=await j.command('pod',lastPayload,{persona:'lince.motorista',key:'qa-last-proof'});const replay=await j.command('pod',lastPayload,{persona:'lince.motorista',key:'qa-last-proof'});assert.equal(proof.id,replay.id);assert.equal((await j.object(s.id)).status,'DELIVERED');
  const imageRead=await j.request('/api/file?id='+file.id,{persona:'lince.motorista'});assert.equal(imageRead.status,200);assert.deepEqual([...imageRead.data.slice(0,4)],[137,80,78,71]);
  const tolerance=await j.command('tolerance',{name:'QA tolerância zero',fixed:'0',percent:'0'}),invoice=await j.command('invoice_create',{assignments:[award.assignment.id],number:'QA-FAT-COMPLETE',amount:'22.00'},{persona:'carrier1.admin'});await rejectWithoutMutation(j,'approval_request',{invoiceId:invoice.id,version:invoice.version});
  const audited=await j.command('invoice_audit',{...await j.version(invoice.id),toleranceId:tolerance.id});assert.equal(audited.status,'DISPUTED');assert.equal(audited.expected,'20.00');assert.equal(audited.difference,'2.00');
  await j.command('dispute_resolve',{...await j.version(audited.disputeId),decision:'ADJUST_TO_EXPECTED',reason:'Ajuste ao contratado'});const adjusted=await j.object(invoice.id);assert.equal(adjusted.amount,'20.00');assert.equal(adjusted.originalAmount,'22.00');assert.equal(Object.values(adjusted.allocation).reduce((n,v)=>n+cents(v),0),2000);
  const approval=await j.command('approval_request',{invoiceId:adjusted.id,version:adjusted.version}),posted=await j.command('approval_decide',{...await j.version(approval.id),decision:'APPROVE'},{persona:'loja.aprovador'});assert.equal(posted.entryIds.length,2);let state=await j.state();const ap=state.objects.find(x=>x.kind==='ledger'&&x.invoiceId===invoice.id&&x.side==='AP'&&x.type==='POST');assert.equal(ap.amount,'20.00');
  await rejectWithoutMutation(j,'settlement_request',{entryId:ap.id,amount:'0.004',reason:'Não gerar aprovação de zero centavos'});
  const req=await j.command('settlement_request',{entryId:ap.id,amount:'7.00',reason:'Baixa fictícia parcial'}),settled=await j.command('approval_decide',{...await j.version(req.id),decision:'APPROVE'},{persona:'loja.aprovador'});state=await j.state();const settlement=state.objects.find(x=>x.id===settled.settlementIds[0]&&x.side==='AP')||state.objects.find(x=>x.kind==='settlement'&&x.approvalId===req.id&&x.side==='AP');assert.equal(settlement.remainingBalance,'13.00');await rejectWithoutMutation(j,'reverse_request',{entryId:ap.id,reason:'Exige compensar baixa'});
  const compensate=await j.command('settlement_reverse_request',{settlementId:settlement.id,reason:'Compensação fictícia'});await j.command('approval_decide',{...await j.version(compensate.id),decision:'APPROVE'},{persona:'loja.aprovador'});
  const reversal=await j.command('reverse_request',{entryId:ap.id,reason:'Estorno de teste'});await j.command('approval_decide',{...await j.version(reversal.id),decision:'APPROVE'},{persona:'loja.aprovador'});state=await j.state();for(const side of ['AP','AR'])assert.equal(state.objects.filter(x=>x.kind==='ledger'&&x.invoiceId===invoice.id&&x.side===side).reduce((n,x)=>n+cents(x.amount),0),0);
  const back=await j.command('return_create',{shipmentId:s.id,packageKeys:[keys[0]],reason:'Devolução fictícia'});for(const status of ['COLLECTED','RECEIVED','CLOSED'])await j.command('return_progress',{...await j.version(back.id),status});assert.equal((await j.object(o.id)).consumerCharge,'5.00');j.restart();assert.equal((await j.object(invoice.id)).status,'REVERSED_LOCAL');assert.equal((await j.object(back.id)).status,'CLOSED');
});
test('QA-JS-08','Replanejamento impossível preserva operação e cancelamento após execução vira compensação','Aprovar plano de capacidade1 para carga5 recusa sem cancelar assignment/reservas; após coleta, cancelamento não apaga operação e exige compensação.',async j=>{
  const f=await fixture(j),{o}=await order(j,f,'QA-REPLAN-GATES'),{ship}=await planned(j,f,o),award=await awarded(j,f,ship),change=await j.command('replan',{...await j.version(ship.id),reason:'Capacidade insuficiente de teste',plan:{originLocationId:f.origin.id,start:f.start,capacityKg:'1',speedKmh:'40'}});
  await rejectWithoutMutation(j,'replan_approve',{...await j.version(change.id),reason:'Não pode destruir original'});assert.equal((await j.object(award.assignment.id)).status,'ACTIVE');assert.equal((await j.object(ship.id)).status,'ASSIGNED');
  await dispatch(j,f,ship);const before=await j.object(ship.id),compensation=await j.command('order_change',{...await j.version(o.id),operation:'CANCEL',reason:'Não apagar carga em execução'});assert.equal(compensation.status,'COMPENSATION_REQUIRED');await j.command('change_resolve',{...await j.version(compensation.id),resolution:'Conferência operacional sem apagar histórico'});assert.deepEqual((await j.object(ship.id)).packages,before.packages);assert.equal((await j.object(ship.id)).status,before.status);
});
test('QA-JS-09','Eventos passivos e resposta perdida de envio após criação de massa nova','WMS com resposta perdida ficaUNKNOWN e consulta mantémprotocolo; entradaWMS deduplica; evento atrasado não regride uma viagemconcluída e permanece consultável.',async j=>{
  const f=await fixture(j),{o}=await order(j,f,'QA-ACTIVE-PASSIVE'),{ship}=await planned(j,f,o),message=await j.command('adapter_enqueue',{adapter:'WMS',mode:'LOST_RESPONSE',payload:{shipmentId:ship.id,custody:'READY'}}),uncertain=await j.command('outbox_process',await j.version(message.id));assert.equal(uncertain.status,'UNKNOWN');const resolved=await j.command('outbox_query',await j.version(message.id));assert.equal(resolved.status,'DONE');assert.ok(resolved.protocol);
  const event={eventId:'QA-PASSIVE-WMS',type:'WMS',payload:{shipmentId:ship.id,custody:'HANDED_OVER'}},one=await j.request('/api/inbox',{method:'POST',body:event,key:'qa-passive-wms'}),two=await j.request('/api/inbox',{method:'POST',body:event,key:'qa-passive-wms'});assert.equal(one.status,200);assert.equal(two.data.id,one.data.id);assert.equal((await j.object(ship.id)).wmsCustody,'HANDED_OVER');j.restart();assert.equal((await j.object(message.id)).protocol,resolved.protocol);
});
test('QA-JS-10','Validar coordenadas e alterações de cadastro antes de planejar','Latitude191 e alteração de CEP para texto não são aceitas; erro não deixa cadastro inválido persistido.',async j=>{
  const f=await fixture(j);await rejectWithoutMutation(j,'master_create',{kind:'location',values:{name:'Coordenada inválida de teste',postalCode:'01310100',lat:191,lon:-46.64}});await rejectWithoutMutation(j,'master_update',{...await j.version(f.destination.id),values:{name:'CEP inválido de teste',postalCode:'ABCDE',lat:-23.54,lon:-46.64}});
});
test('QA-JS-11','Aceitar formato humano de CEP mantendo os oito dígitos','Quote01001-000→01310-100 normaliza para01001000→01310100 e mantém preço20 no serviço de teste.',async j=>{
  const f=await fixture(j),{q,candidate}=await quotation(j,f,packages(),{originCep:'01001-000',destinationCep:'01310-100'});assert.equal(q.originCep,'01001000');assert.equal(q.destinationCep,'01310100');assert.equal(q.candidates[candidate].cost,'20.00');
});
test('QA-JS-12','Cotação expirada não libera pedido para planejamento','Fixture temporal controlada representa expiração após criação do pedido; liberar exige recotação e não altera statusVALIDATED.',async j=>{
  const f=await fixture(j),{o,q}=await order(j,f,'QA-EXPIRED-QUOTE');const row=j.db.rows.get(j.workspace),w=JSON.parse(row.data);w.objects.find(x=>x.id===q.id).expiresAt=new Date(Date.now()-60000).toISOString();j.db.rows.set(j.workspace,{...row,data:JSON.stringify(w)});j.trace.push({setup:'Temporal fixture only: quoted expiresAt moved to one minute before current clock; not a product API edit.'});
  await rejectWithoutMutation(j,'order_release',await j.version(o.id));assert.equal((await j.object(o.id)).status,'VALIDATED');
});
test('QA-JS-13','Cotação expirada depois de calcular plano não confirma embarque','Se quote expira entre plan e plan_commit, confirmação recusa QUOTE_STALE antes de gerar shipment/alterar order/plan.',async j=>{
  const f=await fixture(j),{o,q}=await order(j,f,'QA-EXPIRED-AFTER-PLAN');await j.command('order_release',await j.version(o.id));const plan=await j.command('plan',{orderIds:[o.id],originLocationId:f.origin.id,start:f.start,capacityKg:'100',speedKmh:'40'});assert.equal(plan.status,'FEASIBLE');
  const row=j.db.rows.get(j.workspace),w=JSON.parse(row.data);w.objects.find(x=>x.id===q.id).expiresAt=new Date(Date.now()-60000).toISOString();j.db.rows.set(j.workspace,{...row,data:JSON.stringify(w)});j.trace.push({setup:'Temporal fixture only: quote expired after planning, before plan_commit.'});
  const code=await rejectWithoutMutation(j,'plan_commit',await j.version(plan.id));assert.equal(code,'QUOTE_STALE');assert.equal((await j.object(plan.id)).status,'FEASIBLE');assert.equal((await j.object(o.id)).status,'RELEASED');assert.equal((await j.state()).objects.filter(x=>x.kind==='shipment'&&x.orderIds.includes(o.id)).length,0);
});
test('QA-JS-14','Contraproposta antiga não reabre pedido/viagem cancelados','Oferta com COUNTER é cancelada junto da viagem; counter_accept antigo recusa e não cria assignment/reserva.',async j=>{
  const f=await fixture(j),{o}=await order(j,f,'QA-CANCEL-COUNTER'),{ship}=await planned(j,f,o),t=await offered(j,f,ship),res=await resources(j,f);await j.command('offer_respond',{...await j.version(t.id),decision:'COUNTER',price:'25',vehicleId:res.vehicle.id,driverId:res.driver.id},{persona:'carrier1.admin'});
  await j.command('order_change',{...await j.version(o.id),operation:'CANCEL',reason:'Cancelar negociação sem aceite'});await rejectWithoutMutation(j,'counter_accept',{...await j.version(t.id),carrierOrg:f.carrier.org});assert.equal((await j.object(ship.id)).status,'CANCELLED');assert.equal((await j.object(t.id)).status,'CANCELLED');assert.equal((await j.state()).objects.filter(x=>x.kind==='assignment'&&x.shipmentId===ship.id).length,0);
});
test('QA-JS-15','Proposta legada com candidate objeto só resolve por correspondência exata','Formato antigo normalizado permanece utilizável quando candidate/packages/CEP/quoteválido coincidem; mismatchcandidate/pacotes/CEP e quoteexpirado recusam sem mudar o registro nem operação. Nunca fallback para índice0.',async j=>{
  const f=await fixture(j),{o}=await order(j,f,'QA-LEGACY-CHANGE'),{ship}=await planned(j,f,o),award=await awarded(j,f,ship),replacement=await quotation(j,f,packages('3','3'));
  const proposal=await j.command('order_change',{...await j.version(o.id),operation:'EDIT',reason:'Proposta a recuperar sem reset',values:{quoteId:replacement.q.id,candidate:replacement.candidate,packages:packages('3','3'),consumerCharge:'7.00',locationId:f.destination.id,windowStart:f.start,windowEnd:f.end}});
  const row=j.db.rows.get(j.workspace),w=JSON.parse(row.data),pending=w.objects.find(x=>x.id===proposal.id),quote=w.objects.find(x=>x.id===replacement.q.id),destination=w.objects.find(x=>x.id===f.destination.id);
  pending.newValues={...pending.newValues,candidate:cp(quote.candidates[replacement.candidate]),destinationSnapshot:cp(destination),subsidy:'15.00'};
  j.db.rows.set(j.workspace,{...row,data:JSON.stringify(w)});const baseline=j.raw();j.trace.push({setup:'Controlled legacy fixture: existing pending proposal newValues converted to the prior normalized candidate-object format, without a migration or live write.'});
  for(const mode of ['candidate','packages','destination','expired']){
    const fixture=JSON.parse(baseline),c=fixture.objects.find(x=>x.id===proposal.id),q=fixture.objects.find(x=>x.id===replacement.q.id);
    if(mode==='candidate')c.newValues.candidate.cost='999.99';if(mode==='packages')c.newValues.packages[0].weightKg='9';if(mode==='destination')c.newValues.destinationSnapshot.postalCode='01001000';if(mode==='expired')q.expiresAt=new Date(Date.now()-60000).toISOString();
    j.db.rows.set(j.workspace,{...row,data:JSON.stringify(fixture)});j.trace.push({setup:`Independent in-memory legacy negative: ${mode}. Original valid legacy baseline is restored only by the test fixture between negatives.`});
    const code=await rejectWithoutMutation(j,'change_resolve', {...await j.version(proposal.id),resolution:'Não adivinhar candidate0'});assert.equal(code,mode==='expired'?'QUOTE_EXPIRED':mode==='destination'?'DESTINATION_MISMATCH':'QUOTE_CONTENT_MISMATCH');assert.equal((await j.object(proposal.id)).status,'APPROVAL_REQUIRED');assert.equal((await j.object(award.assignment.id)).status,'ACTIVE');assert.equal((await j.object(ship.id)).status,'ASSIGNED');
  }
  j.db.rows.set(j.workspace,{...row,data:baseline});await j.command('change_resolve',{...await j.version(proposal.id),resolution:'Snapshot legado corresponde ao quote declarado'});
  const changed=await j.object(o.id);assert.equal(changed.quoteId,replacement.q.id);assert.equal(changed.candidate.cost,'22.00');assert.equal(changed.consumerCharge,'7.00');assert.ok(changed.revisions.some(x=>x.consumerCharge==='5.00'));assert.equal((await j.object(proposal.id)).status,'APPLIED');
});

const started=new Date().toISOString(),runId='run-'+started.replace(/[-:.]/g,'').replace('Z','Z');fs.mkdirSync(EVIDENCE,{recursive:true});
const plan={id:'QA-TMS-20261125-JS',mode:'Teste funcional local sintético via WorkerHTTP+D1fake',preparedAt:started,humanSource:'Pedido direto de Rafael em25/11/2026 para bateria front/back e dados simuláveis editáveis; transcrição recuperada pelo coordenador, sem ID inventado.',writer:'/root/tms_motorista',independence:'Executor foi autor prévio do runtime; esta contribuição não substitui revisão distinta.',scope:'Novos dados e novas jornadas editáveis; não repetição da suíte23 por rotina.',exclusions:['Sem UI/browsers','Sem serviço público/produção','Sem credenciais/bypass','Sem campanha de permissões/isolamento','Sem publicação/instalações','Sem correções de domínio além dos deltas explicitamente atribuídos pelo coordenador'],expectedBeforeRun:cases.map(({id,title,expected})=>({id,title,expected})),sourceHashes};
fs.writeFileSync(EVIDENCE+runId+'-plan.json',JSON.stringify(plan,null,2));
const results=[],traces=[];
for(const c of cases){const j=new Journey(c.id);try{await c.run(j);results.push({id:c.id,title:c.title,expected:c.expected,status:'PASS',httpSteps:j.trace.length});}catch(error){results.push({id:c.id,title:c.title,expected:c.expected,status:'FAIL',error:error.stack,httpSteps:j.trace.length});}traces.push({case:c.id,workspace:j.workspace,steps:j.trace,finalWorkspaceVersion:j.db.rows.get(j.workspace)?.version||null});}
const finalHashes=Object.fromEntries(sourceFiles.map(file=>[file,digest(file)])),stable=Object.entries(sourceHashes).every(([file,hash])=>finalHashes[file]===hash),report={id:plan.id,runId,started,finished:new Date().toISOString(),sourceStable:stable,sourceHashes,finalHashes,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,total:results.length,independence:plan.independence,results,scope:plan.scope,exclusions:plan.exclusions};
fs.writeFileSync(EVIDENCE+runId+'-results.json',JSON.stringify(report,null,2));fs.writeFileSync(EVIDENCE+runId+'-trace.json',JSON.stringify(traces,null,2));
console.log(JSON.stringify({runId,sourceStable:stable,passed:report.passed,failed:report.failed,total:report.total,results:results.map(({id,status,error,httpSteps})=>({id,status,error,httpSteps})),evidence:EVIDENCE},null,2));if(report.failed||!stable)process.exitCode=1;
