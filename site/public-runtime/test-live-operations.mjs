import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWorkspace,choosePersona,executeCommand,ApiError} from './domain.mjs';
import {createLiveOperations} from './live-operations.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json',import.meta.url),'utf8')),copy=x=>JSON.parse(JSON.stringify(x)),time='2026-11-26T10:00:00.000Z';
const api=createLiveOperations({executeCommand,choosePersona,ApiError}),results=[];
function fixture(){let w=createWorkspace(seed,time);const p=choosePersona(w,'loja.admin');let count=0;return{get w(){return w;},p,run(action,payload,at=time,key=`request-${++count}`){const out=api.command(w,p,action,payload,key,at);w=out.workspace;return out;},set(v){w=v;}};}
function reject(f,code,action,payload,at=time,key){const before=copy(f.w);assert.throws(()=>f.run(action,payload,at,key),e=>e.code===code);assert.deepEqual(f.w,before);}
function session(f,requiredDocuments=[]){const ship=f.w.objects.find(o=>o.kind==='shipment'&&['IN_TRANSIT','PARTIAL'].includes(o.status)&&o.stage==='DELIVERY'&&(o.delivered||[]).length<o.packages.length);assert.ok(ship);return f.run('session_create',{shipmentId:ship.id,requiredDocuments}).result;}
function prepare(f,s,type,reference){return f.run('document_prepare',{id:s.id,type,...(reference?{reference}:{})}).result;}
function auth(f,s,type){const doc=prepare(f,s,type,type==='NFE_REFERENCE'?'SIM-NFE-REFERENCE':undefined);return f.run('document_submit',{documentId:doc.id,mode:'GOOD'}).result;}
const test=(name,run)=>{try{run();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.stack});}};
test('readonly GET exposes coherent quote example; fresh quote creates actual domain order through passive API',()=>{
 const f=fixture(),before=copy(f.w),view=api.read(f.w,f.p,{now:time}),example=view.catalog.apiExample;assert.ok(example);assert.deepEqual(f.w,before);
 const quote=f.run('order_quote',example.quoteInput).result;assert.ok(quote.candidates.length);
 const orderPayload={externalId:'LIVE-API-NEW',quoteId:quote.id,candidate:0,packages:quote.packages,locationId:example.locationId,windowStart:example.windowStart,windowEnd:example.windowEnd,consumerCharge:'5.40'};
 const received=f.run('passive_order',{messageId:'message-1',orderPayload}).result;const order=f.w.objects.find(x=>x.id===received.orderId);assert.equal(order.kind,'order');assert.equal(order.status,'VALIDATED');assert.equal(order.quoteId,quote.id);assert.equal(order.shipmentIds.length,0);
 const again=f.run('passive_order',{messageId:'message-1',orderPayload},time,'new-http-key').result;assert.equal(again.orderId,order.id);const third=f.run('passive_order',{messageId:'different-message',orderPayload}).result;assert.equal(third.orderId,order.id);assert.equal(f.w.objects.filter(x=>x.kind==='order'&&x.externalId==='LIVE-API-NEW').length,1);
 reject(f,'LIVE_INBOX_CONFLICT','passive_order',{messageId:'message-1',orderPayload:{...orderPayload,consumerCharge:'6.00'}});
 reject(f,'LIVE_ORDER_EXTERNAL_CONFLICT','order_create',{orderPayload:{...orderPayload,consumerCharge:'6.00'}});
});
test('invalid intake rolls back both addon and domain objects; identity reuse conflicts',()=>{
 const f=fixture();reject(f,'REQUIRED_TEXT','order_create',{orderPayload:{}});const order=f.w.objects.find(x=>x.kind==='order');const payload={orderId:order.id},first=f.run('order_link',payload,time,'same');assert.equal(f.run('order_link',payload,time,'same').replayed,true);assert.equal(f.w.liveOperations.orders.length,1);reject(f,'LIVE_IDEMPOTENCY_CONFLICT','order_link',{orderId:'different'},time,'same');assert.ok(first.result.orderId);
});
test('required docs block start; reject/correct/resend keeps prior history, auxiliary docs and print XML explicit synthetic',()=>{
 const f=fixture(),s=session(f,['NFE_REFERENCE','CTE','MDFE']);reject(f,'LIVE_REQUIRED_DOCUMENTS_MISSING','start',{id:s.id});
 const doc=prepare(f,s,'CTE');f.run('document_submit',{documentId:doc.id,mode:'REJECT'});reject(f,'LIVE_REQUIRED_DOCUMENTS_MISSING','start',{id:s.id});f.run('document_correct',{documentId:doc.id,reference:'SIM-REF-<script>alert(1)</script>',reason:'Synthetic correction'});const good=f.run('document_submit',{documentId:doc.id,mode:'GOOD'}).result;assert.equal(good.status,'DEMO_AUTHORIZED');assert.ok(good.history.some(x=>x.status==='REJECTED'));assert.ok(good.history.some(x=>x.reference===doc.reference));
 auth(f,s,'NFE_REFERENCE');const mdfe=auth(f,s,'MDFE');for(const type of ['DACTE','DAMDFE','MANIFEST','LABEL'])auth(f,s,type);
 const xml=api.document(f.w,f.p,doc.id,'xml'),html=api.document(f.w,f.p,doc.id,'html');assert.match(xml.body,/<LinceSyntheticDocument/);assert.ok(!xml.body.includes('<NFe'));assert.match(xml.body,/SEM VALIDADE FISCAL/);assert.match(html.body,/&lt;script&gt;/);assert.ok(!html.body.includes('<script>'));
 f.run('start',{id:s.id});reject(f,'LIVE_DOCUMENT_TRIP_STARTED','document_prepare',{id:s.id,type:'LABEL'});reject(f,'LIVE_DOCUMENT_CANCEL_BLOCKED','document_cancel',{documentId:mdfe.id,reason:'No live cancellation'});reject(f,'LIVE_DOCUMENT_CLOSE_BLOCKED','document_close',{documentId:mdfe.id});
});
test('cancel before departure keeps cancelled history and required gate remains closed',()=>{
 const f=fixture(),s=session(f,['CTE']),d=auth(f,s,'CTE');f.run('document_cancel',{documentId:d.id,reason:'Synthetic cancel'});reject(f,'LIVE_REQUIRED_DOCUMENTS_MISSING','start',{id:s.id});assert.equal(f.w.liveOperations.documents[0].status,'CANCELLED');const replacement=auth(f,s,'CTE');assert.notEqual(replacement.id,d.id);f.run('start',{id:s.id});
});
test('GPS stale is observation age not reception; pause/offline/resume never fabricate fresh location',()=>{
 const f=fixture(),s=session(f);f.run('start',{id:s.id});const d={id:s.id,sequence:1,lat:-23.5,lon:-46.6,accuracyM:5,occurredAt:'2026-11-26T09:58:30.000Z'};f.run('gps',d);let read=api.read(f.w,f.p,{now:time}).liveOperations.sessions[0];assert.equal(read.position.ageSeconds,90);assert.equal(read.position.communicationAgeSeconds,0);assert.equal(read.position.stale,true);
 f.run('offline',{id:s.id});assert.equal(api.read(f.w,f.p,{now:time}).liveOperations.sessions[0].position.stale,true);reject(f,'LIVE_SESSION_NOT_MOVING','gps',{...d,sequence:2,occurredAt:time});f.run('resume',{id:s.id});read=api.read(f.w,f.p,{now:time}).liveOperations.sessions[0];assert.equal(read.position.stale,true);assert.equal(read.positions.length,1);
 f.run('gps',{...d,sequence:2,occurredAt:time});assert.equal(api.read(f.w,f.p,{now:time}).liveOperations.sessions[0].position.stale,false);f.run('pause',{id:s.id});assert.equal(api.read(f.w,f.p,{now:time}).liveOperations.sessions[0].position.etaAt,null);
});
test('UTC calendar/future/maxAge/coords/speed/sequence guards reject with no mutation; duplicate GPS across newkey dedups',()=>{
 const f=fixture(),s=session(f);f.run('start',{id:s.id});const d={id:s.id,sequence:1,lat:0,lon:0,accuracyM:5,occurredAt:time};
 for(const [delta,code]of [[{occurredAt:'2026-02-30T10:00:00.000Z'},'LIVE_INVALID_TIME'],[{occurredAt:'2026-11-26T10:00:01.000Z'},'LIVE_GPS_FUTURE'],[{occurredAt:'2026-11-26T09:57:59.999Z'},'LIVE_GPS_TOO_OLD'],[{lat:91},'LIVE_GPS_INVALID'],[{sequence:2},'LIVE_GPS_SEQUENCE']])reject(f,code,'gps',{...d,...delta});
 f.run('gps',d);f.run('gps',d,time,'new-http-gps-key');assert.equal(f.w.liveOperations.sessions[0].positions.length,1);reject(f,'LIVE_GPS_EVENT_CONFLICT','gps',{...d,lat:1});reject(f,'LIVE_GPS_SPEED_IMPLAUSIBLE','gps',{...d,sequence:2,lat:1,occurredAt:'2026-11-26T10:00:01.000Z'},'2026-11-26T10:00:01.000Z');
});
test('advance produces explicit route-synthetic position and preserves event-clock plausibility',()=>{
 const f=fixture(),s=session(f);f.run('start',{id:s.id});f.run('advance',{id:s.id});const first=copy(f.w.liveOperations.sessions[0].positions[0]);assert.equal(first.source,'SIMULATED_ROUTE');if(s.routePoints.length>1){f.run('advance',{id:s.id},'2026-11-26T10:01:00.000Z');assert.equal(f.w.liveOperations.sessions[0].positions.length,2);}
});
test('occurrence/failure/partial/full POD affect only linked shipment packages, dedup business event and close MDFE after completed',()=>{
 const f=fixture(),s=session(f),mdfe=auth(f,s,'MDFE');f.run('start',{id:s.id});const ship=f.w.objects.find(x=>x.id===s.shipmentId),remaining=ship.packages.map(x=>x.key).filter(x=>!ship.delivered.includes(x)),beforeOrder=copy(f.w.objects.find(x=>x.id===s.orderIds[0]));
 reject(f,'LIVE_PACKAGE_SCOPE','delivery',{id:s.id,packageKeys:['foreign:1'],outcome:'DELIVERED',reason:'Synthetic'});
 const occurrence={id:s.id,eventId:'occurrence-1',type:'DAMAGE',description:'Synthetic damage',packageKeys:[remaining[0]]};f.run('occurrence',occurrence);f.run('occurrence',occurrence,time,'new-http-occurrence');assert.equal(f.w.objects.filter(x=>x.kind==='claim'&&x.shipmentId===ship.id&&x.description==='Synthetic damage').length,1);
 const failed={id:s.id,eventId:'failed-1',packageKeys:[remaining[0]],outcome:'FAILED',reason:'Synthetic attempt'};f.run('delivery',failed);assert.ok(!f.w.objects.find(x=>x.id===ship.id).delivered.includes(remaining[0]));
 const delivered={id:s.id,eventId:'delivered-1',packageKeys:[remaining[0]],outcome:'DELIVERED',reason:'Synthetic delivered'};f.run('delivery',delivered);f.run('delivery',delivered,time,'new-http-delivery');assert.equal(f.w.objects.filter(x=>x.kind==='pod'&&x.shipmentId===ship.id&&x.reason==='Synthetic delivered').length,1);
 if(remaining.length>1)f.run('delivery',{...delivered,eventId:'delivered-rest',packageKeys:remaining.slice(1)});assert.equal(f.w.liveOperations.sessions[0].status,'COMPLETE');f.run('document_close',{documentId:mdfe.id});assert.equal(f.w.liveOperations.documents.find(x=>x.id===mdfe.id).status,'CLOSED_DEMO');assert.deepEqual(f.w.objects.find(x=>x.id===beforeOrder.id),beforeOrder);
});
test('local webhook failure retry/unknown query preserves one effect and no external URL allowed',()=>{
 const f=fixture(),s=session(f);reject(f,'LIVE_LOCAL_WEBHOOK_ONLY','webhook_enqueue',{id:s.id,event:'DELIVERY',target:'https://example.test'});const m=f.run('webhook_enqueue',{id:s.id,event:'DELIVERY',target:'LOCAL_SANDBOX'}).result;f.run('webhook_process',{messageId:m.id,mode:'FAIL'});f.run('webhook_retry',{messageId:m.id});f.run('webhook_process',{messageId:m.id,mode:'LOST_RESPONSE'});reject(f,'LIVE_WEBHOOK_QUERY_REQUIRED','webhook_retry',{messageId:m.id});const done=f.run('webhook_query',{messageId:m.id}).result;assert.equal(done.status,'DONE');assert.equal(f.w.liveOperations.effects[m.id].count,1);assert.equal(f.run('webhook_query',{messageId:m.id}).result.protocol,done.protocol);
 const reopened=JSON.parse(JSON.stringify(f.w));assert.equal(api.read(reopened,f.p,{now:time}).liveOperations.webhooks[0].status,'DONE');
});
test('accepted GPS and domain events atomically enqueue stable local API notifications without duplicate replay',()=>{
 const f=fixture(),s=session(f);f.run('start',{id:s.id});const gps={id:s.id,sequence:1,lat:0,lon:0,accuracyM:1,occurredAt:time};f.run('gps',gps);f.run('gps',gps,time,'new-gps-key');assert.equal(f.w.liveOperations.webhooks.length,1);const first=f.w.liveOperations.webhooks[0];assert.equal(first.automatic,true);assert.equal(first.target,'LOCAL_SANDBOX');assert.equal(first.payload.position.sequence,1);assert.equal(first.correlationId,s.id);
 const key=s.packageKeys.find(k=>!f.w.objects.find(x=>x.id===s.shipmentId).delivered.includes(k)),event={id:s.id,eventId:'notify-claim',type:'DAMAGE',description:'Synthetic notify',packageKeys:[key]};f.run('occurrence',event);f.run('occurrence',event,time,'new-occurrence-key');assert.equal(f.w.liveOperations.webhooks.length,2);assert.equal(f.w.liveOperations.webhooks[1].event,'OCCURRENCE');assert.ok(f.w.objects.some(x=>x.id===f.w.liveOperations.webhooks[1].payload.domainObjectId&&x.kind==='claim'));
 const original=copy(f.w);const saturated=copy(f.w);while(saturated.liveOperations.webhooks.length<100)saturated.liveOperations.webhooks.push({...first,id:'filler-'+saturated.liveOperations.webhooks.length,eventId:'filler-'+saturated.liveOperations.webhooks.length});f.set(saturated);reject(f,'LIVE_WEBHOOK_LIMIT','occurrence',{...event,eventId:'must-rollback',description:'No partial claim'});assert.equal(f.w.objects.filter(x=>x.kind==='claim').length,original.objects.filter(x=>x.kind==='claim').length);
});
test('document useful snapshot preserves packages, weight, parties/cost and order destinations independently of later source edits',()=>{
 const f=fixture(),s=session(f),d=prepare(f,s,'MANIFEST'),saved=copy(d.summary);assert.equal(d.summary.shipmentId,s.shipmentId);assert.equal(d.summary.packages.length,s.packageKeys.length);assert.equal(d.summary.orders[0].orderId,s.orderIds[0]);assert.ok(d.summary.totalWeightKg);assert.ok(d.summary.transportCost);assert.equal(d.summary.parties[0].role,'SHIPPER');
 const draft=copy(f.w);draft.objects.find(x=>x.id===s.shipmentId).cost='99999.00';draft.objects.find(x=>x.id===s.orderIds[0]).destinationSnapshot.name='Changed source';f.set(draft);
 const html=api.document(f.w,f.p,d.id,'html'),xml=api.document(f.w,f.p,d.id,'xml');assert.ok(html.body.includes('Volumes vinculados'));assert.ok(html.body.includes(saved.packages[0].key));assert.ok(!html.body.includes('99999.00'));assert.ok(xml.body.includes('SyntheticSnapshotJson'));assert.deepEqual(f.w.liveOperations.documents.find(x=>x.id===d.id).summary,saved);
});
console.log(JSON.stringify({scope:'Autonomous synthetic module plus existing domain executeCommand; no HTTP/DB/browser/provider',passed:results.filter(x=>x.pass).length,total:results.length,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;
