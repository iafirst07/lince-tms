/* Public fictional simulation engine. This is not the canonical Python engine,
   authentication, fiscal validation, a payment system, or production authorization. */
export class ApiError extends Error {
  constructor(code, status = 400, message = code) { super(message); this.code = code; this.status = status; }
}
const check = (condition, code, status = 400) => { if (!condition) throw new ApiError(code, status); };
const copy = x => JSON.parse(JSON.stringify(x));
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const text = x => { check(typeof x === 'string' && x.trim().length > 0 && x.length <= 2000, 'REQUIRED_TEXT'); return x.trim(); };
const number = (x, min = 0) => { const n = Number(x); check(Number.isFinite(n) && n >= min, 'INVALID_NUMBER'); return n; };
const cash = x => (Math.round((Number(x) + Number.EPSILON) * 100) / 100).toFixed(2);
const cents = x => { check(/^-?\d+(\.\d{1,2})?$/.test(String(x)), 'INVALID_MONEY'); return Math.round(Number(x) * 100); };
const money = x => cash(number(x));
const timestamp = x => { const t = new Date(x); check(Number.isFinite(t.valueOf()), 'INVALID_DATE'); return t.toISOString(); };
const canonical = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const list = (w, kind) => w.objects.filter(o => o.kind === kind);
const get = (w, oid, kind) => { const o = w.objects.find(x => x.id === oid && (!kind || x.kind === kind)); check(o, 'NOT_FOUND', 404); return o; };
const version = (o, d) => check(Number(d.version) === o.version, 'VERSION_CONFLICT', 409);
const update = (o, fields = {}) => { Object.assign(o, copy(fields)); o.version = (o.version || 0) + 1; return o; };
const add = (w, p, kind, data, shared = []) => {
  const o = {...copy(data), id: id(kind), kind, org: p.org, version: 1, createdBy: p.id, createdAt: w.clock, shared};
  w.objects.push(o); check(w.objects.length <= 3000, 'SIMULATION_OBJECT_LIMIT', 413); return o;
};
const sameSet = (a, b) => Array.isArray(a) && new Set(a).size === a.length && a.length === b.length && a.every(x => b.includes(x));
const current = (w, p, d) => get(w, d.shipmentId, 'shipment');
const postalCode=value=>{check(typeof value==='string'&&/^\d{5}-?\d{3}$/.test(value),'INVALID_CEP');return value.replace('-','');};
function parcelSnapshot(values){
  check(Array.isArray(values)&&values.length>0&&values.length<=200,'INVALID_PACKAGES');const seen=new Set();
  return values.map(value=>{
    check(value&&typeof value.id==='string'&&value.id.length>0&&value.id.length<=128,'INVALID_TEXT');check(!seen.has(value.id),'DUPLICATE_PACKAGE');seen.add(value.id);
    const parcel={id:value.id};for(const key of ['weightKg','lengthCm','widthCm','heightCm']){
      const input=value[key];check(typeof input==='string'&&/^\d{1,10}(\.\d{1,6})?$/.test(input)&&Number(input)>=.000001,'INVALID_DECIMAL');
      const[whole,fraction='']=input.split('.'),tail=fraction.replace(/0+$/,'');parcel[key]=whole.replace(/^0+(?=\d)/,'')+(tail?'.'+tail:'');
    }parcel.cargoClass=value.cargoClass===undefined?'GENERAL':value.cargoClass;return parcel;
  }).sort((a,b)=>a.id.localeCompare(b.id));
}
const quoteContent=quote=>canonical([postalCode(quote.originCep),postalCode(quote.destinationCep),parcelSnapshot(quote.packages)]);
function orderQuoteCurrent(w,order){
  const quote=get(w,order.quoteId,'quote');check(new Date(w.clock)<new Date(quote.expiresAt),'QUOTE_STALE',409);
  if(order.quoteContentSignature)check(quoteContent(quote)===order.quoteContentSignature,'QUOTE_STALE',409);
  else check(canonical(parcelSnapshot(quote.packages))===canonical(parcelSnapshot(order.packages))&&postalCode(quote.destinationCep)===postalCode(order.destinationCep||order.destinationSnapshot?.postalCode),'QUOTE_STALE',409);
  return quote;
}
function masterValues(w,p,kind,input,exclude){
  const fields={location:['name','postalCode','lat','lon'],zone:['name','from','to','priority'],calendar:['name','timezone','cutoff','holidays','weekdays'],service:['name','calendarId','transitDays','maxPackageKg','maxShipmentKg']},optional=kind==='location'?['addressLine','number','complement','district','city','uf','deliveryInstructions']:[];
  check(fields[kind]&&input&&typeof input==='object'&&!Array.isArray(input),'INVALID_MASTER');check(fields[kind].every(k=>Object.hasOwn(input,k))&&Object.keys(input).every(k=>fields[kind].includes(k)||optional.includes(k)),'MASTER_FIELDS_INVALID');const value=copy(input);value.name=text(value.name);
  for(const key of optional)if(Object.hasOwn(value,key))check(typeof value[key]==='string'&&value[key].length<=(key==='deliveryInstructions'?1000:200),'INVALID_DELIVERY_ADDRESS');
  if(kind==='location'){
    value.postalCode=postalCode(value.postalCode);for(const[key,limit]of [['lat',90],['lon',180]])check(typeof value[key]==='number'&&Number.isFinite(value[key])&&Math.abs(value[key])<=limit,'INVALID_COORDINATE');
    if(value.uf)check('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(value.uf),'INVALID_UF');
  }else if(kind==='zone'){
    value.from=postalCode(value.from);value.to=postalCode(value.to);check(value.from<=value.to,'INVALID_RANGE');check(Number.isInteger(value.priority),'INVALID_PRIORITY');check(!list(w,'zone').some(z=>z.org===p.org&&z.id!==exclude&&z.priority===value.priority&&z.from===value.from&&z.to===value.to),'AMBIGUOUS_ZONE');
  }else if(kind==='calendar'){
    check(typeof value.cutoff==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.cutoff),'INVALID_CUTOFF');
    try{new Intl.DateTimeFormat('pt-BR',{timeZone:value.timezone}).format(new Date());}catch{throw new ApiError('INVALID_TIMEZONE');}
    check(typeof value.timezone==='string'&&value.timezone,'INVALID_TIMEZONE');check(Array.isArray(value.holidays)&&value.holidays.every(day=>{if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day))return false;const date=new Date(day+'T00:00:00Z');return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===day;}),'INVALID_CALENDAR');check(Array.isArray(value.weekdays)&&value.weekdays.length&&value.weekdays.every(day=>Number.isInteger(day)&&day>=0&&day<=6),'INVALID_WEEKDAYS');
  }else{get(w,value.calendarId,'calendar');check(Number.isInteger(value.transitDays)&&value.transitDays>=0&&value.transitDays<=60,'INVALID_TRANSIT');number(value.maxPackageKg,.001);number(value.maxShipmentKg,.001);}
  return value;
}
const roles = {
  quote:['admin','planner'], order_create:['admin','planner'], import_preview:['admin','planner'], import_commit:['admin','planner'], order_release:['admin','planner'], order_change:['admin','planner'], change_resolve:['admin','planner'], plan:['admin','planner'], plan_commit:['admin','planner'], replan:['admin','planner'], replan_approve:['admin','planner'], tender:['admin','planner'], offer_respond:['admin','planner','operator'], counter_accept:['admin','planner'], expire_offers:['admin','planner'], rfq_create:['admin','planner'], rfq_bid:['admin','planner'], rfq_select:['admin','planner'], fleet_create:['admin','planner'], fleet_update:['admin','planner'], maintenance:['admin','operator'], maintenance_finish:['admin','operator'], aggregate_contract:['admin','planner'], expense:['admin','operator','driver'], expense_reconcile:['admin','auditor'], expense_close:['admin','auditor'], subcontract:['admin','planner'], label_request:['admin','operator'], stage:['admin','operator','driver'], tracking:['admin','operator','driver'], pod:['admin','operator','driver'], offline_sync:['admin','operator','driver'], upload_pod:['admin','operator','driver'], claim_create:['admin','operator','driver'], claim_resolve:['admin','operator'], return_create:['admin','operator'], return_progress:['admin','operator'], tolerance:['admin','auditor'], invoice_create:['admin','operator'], invoice_audit:['admin','auditor'], dispute_resolve:['admin','auditor'], approval_request:['admin','auditor'], approval_decide:['approver'], reverse_request:['admin','auditor'], settlement_request:['admin','auditor'], settlement_reverse_request:['admin','auditor'], master_create:['admin','planner'], master_update:['admin','planner'], rate_create:['admin','planner'], rate_publish:['admin','planner'], org_create:['admin','platform_admin'], user_create:['admin','platform_admin'], user_roles:['admin','platform_admin'], user_revoke:['admin','platform_admin'], relationship:['admin'], relationship_respond:['admin'], adapter_config_create:['admin'], adapter_enqueue:['admin','operator'], outbox_process:['admin','operator'], outbox_query:['admin','operator'], outbox_requeue:['admin','operator'], fiscal_policy:['admin'], fiscal_evaluate:['admin','operator'], fiscal_cancel:['admin','operator'], fiscal_profile_create:['admin','planner'], fiscal_profile_revise:['admin','planner'], fiscal_readiness_assess:['admin','planner'], fiscal_local_preflight:['admin','operator'], scenario_save:['admin','planner'], backup:['admin','platform_admin'], simulation_reset:['admin','platform_admin'], inbox_receive:['admin','operator']
};
export const COMMANDS = Object.freeze(Object.keys(roles));
function cleanUser(u) {
  let r = u.roles || ['operator']; if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = [r]; } }
  return {id: u.id || id('persona'), org: u.org || u.orgId, username: u.username || u.name || u.id, roles: r, active: u.active !== false && u.active !== 0};
}
export function createWorkspace(seed, now = new Date().toISOString()) {
  const s = seed.state || seed;
  const users = (s.users || seed.users || seed.accounts || []).map(cleanUser);
  const base = seed.manifest?.baseClock || seed.baseClock || seed.clock || seed.generatedAt, delta = base && Number.isFinite(new Date(base).valueOf()) ? new Date(now).valueOf() - new Date(base).valueOf() : 0;
  const rebase = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x) && Number.isFinite(new Date(x).valueOf()) ? new Date(new Date(x).valueOf()+delta).toISOString() : Array.isArray(x) ? x.map(rebase) : x && typeof x==='object' ? Object.fromEntries(Object.entries(x).map(([k,v])=>[k,rebase(v)])) : x;
  const sourceFiles=Array.isArray(seed.files)?seed.files:Object.values(seed.files||{}), files=Object.fromEntries(sourceFiles.map(f=>[f.id,{...copy(f),shipmentId:f.shipmentId||f.object,bytes:f.bytes||Math.floor((f.base64||'').length*3/4)}]));
  const prototype={objects:rebase(copy(s.objects||seed.objects||[])),organizations:copy(s.organizations||seed.organizations||seed.orgs||[]),users,files,manifest:rebase(copy(seed.manifest||{})),audit:rebase(copy(seed.audit||[])),mockEffects:rebase(copy(seed.mockEffects||{}))},identities=new Map();
  // Only primary domain entities receive new identities. Nested package IDs and
  // scenario IDs are business identifiers, not an entity registry.
  for(const entity of [...prototype.objects,...prototype.organizations,...prototype.users,...Object.values(prototype.files)])if(typeof entity.id==='string'&&!identities.has(entity.id))identities.set(entity.id,id(entity.id.split('-')[0]||'record'));
  const remapString=value=>{if(identities.has(value))return identities.get(value);for(const[from,to]of identities)if(value.startsWith(from+':'))return to+value.slice(from.length);if(value.startsWith('{')||value.startsWith('[')){try{return JSON.stringify(remap(JSON.parse(value)));}catch{}}return value;};
  const remap=(value,context='')=>typeof value==='string'?remapString(value):Array.isArray(value)?value.map(item=>remap(item,context)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,val])=>[remapString(key),key==='id'&&['packages','scenarios'].includes(context)?copy(val):remap(val,key)])):value;
  const scoped=remap(prototype);
  return {schema: 1, simulation: true, clock: timestamp(now), createdAt: timestamp(now), ...scoped, idempotency: {}, inbox: [], notices: ['Ambiente público com dados fictícios. Personas não são autenticação.'], limits: ['Motor JS de simulação; não equivalência integral com backend Python.', 'Sem emissão fiscal, pagamento, comunicação ou integração real.', 'Uploads públicos verificam assinatura de formato; não fazem decode/reencode, antivírus ou homologação de arquivos.']};
}
export function choosePersona(w, identifier) {
  const p = w.users.find(u => (u.id === identifier || u.username === identifier) && u.active);
  check(p, 'SIMULATION_PERSONA_REQUIRED', 401); return copy(p);
}
export function personas(w) { return w.users.filter(u => u.active).map(copy); }
export function stateFor(w, p, oid) {
  let objects = w.objects;
  if (p.roles.length === 1 && p.roles[0] === 'driver') objects = objects.filter(o => o.kind === 'shipment' ? o.driverUserId === p.id : ['pod','tracking','claim','return'].includes(o.kind) && w.objects.some(s => s.kind === 'shipment' && s.id === o.shipmentId && s.driverUserId === p.id));
  // All non-driver personas inspect fictional workspace objects. This is a demo,
  // not tenant access control: the public persona selector intentionally switches roles.
  if (oid) { const o = objects.find(x => x.id === oid); check(o, 'NOT_FOUND', 404); return copy(o); }
  return {user: copy(p), objects: copy(objects), organizations: copy(w.organizations), users: personas(w), commands: COMMANDS.filter(c => roles[c].some(r => p.roles.includes(r))), simulation: true, limits: w.limits};
}
function businessDate(w, calendar, days) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: calendar.timezone || 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date(w.clock)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`), holidays = calendar.holidays || [], weekdays = (calendar.weekdays || [0,1,2,3,4]).map(Number);
  const valid = d => weekdays.includes((d.getUTCDay() + 6) % 7) && !holidays.includes(d.toISOString().slice(0,10));
  if (`${parts.hour}:${parts.minute}` >= (calendar.cutoff || '14:00')) date.setUTCDate(date.getUTCDate() + 1);
  let guard = 0; while (!valid(date)) { date.setUTCDate(date.getUTCDate() + 1); check(++guard < 370, 'INVALID_CALENDAR'); }
  const pickup = date.toISOString().slice(0,10);
  while (days > 0) { date.setUTCDate(date.getUTCDate() + 1); if (valid(date)) days--; check(++guard < 1000, 'INVALID_CALENDAR'); }
  return {pickup, delivery: date.toISOString().slice(0,10)};
}
export function calculate(w, p, d) {
  const originCep=postalCode(d.originCep),destinationCep=postalCode(d.destinationCep),packages=parcelSnapshot(d.packages);
  const weight = packages.reduce((a,x) => a + Number(x.weightKg), 0), candidates = [];
  const zones = list(w, 'zone').filter(z => destinationCep >= z.from && destinationCep <= z.to);
  const rates = list(w, 'rate').filter(r => r.org === p.org && r.side === 'BUY' && r.status === 'PUBLISHED' && new Date(r.validFrom) <= new Date(w.clock) && new Date(w.clock) < new Date(r.validTo) && weight >= Number(r.minKg) && weight < Number(r.maxKg) && zones.some(z => z.id === r.zoneId));
  const groups = new Map(); for (const rate of rates) { const key = `${rate.carrierOrg}:${rate.serviceId}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(rate); }
  for (const group of groups.values()) {
    const priority = r => { const z = get(w,r.zoneId,'zone'); return [Number(z.priority || 0), -(Number(z.to)-Number(z.from)), Number(r.priority || 0)]; };
    group.sort((a,b) => { const x=priority(a),y=priority(b); return y[0]-x[0] || y[1]-x[1] || y[2]-x[2]; });
    if (group.length > 1) check(canonical(priority(group[0])) !== canonical(priority(group[1])), 'AMBIGUOUS_RATE');
    const r = group[0], service = get(w, r.serviceId, 'service'), calendar = get(w, service.calendarId, 'calendar');
    if (weight > Number(service.maxShipmentKg) || packages.some(x => Number(x.weightKg) > Number(service.maxPackageKg))) continue;
    const base = Number(r.base) + Number(r.perKg) * weight, lines = [{name:'BASE',amount:cash(r.base)},{name:'WEIGHT',amount:cash(Number(r.perKg)*weight)}];
    for (const a of r.additions || []) lines.push({name:a.name,amount:cash(a.type === 'PERCENT' ? base * Number(a.value) / 100 : a.value)});
    candidates.push({carrierOrg:r.carrierOrg,serviceId:r.serviceId,rateId:r.id,rateSnapshot:copy(r),calendarSnapshot:copy(calendar),lines,cost:cash(lines.reduce((a,x)=>a+Number(x.amount),0)),...businessDate(w,calendar,Number(service.transitDays || 0))});
  }
  check(candidates.length, 'NO_ELIGIBLE_COVERAGE'); candidates.sort((a,b)=>Number(a.cost)-Number(b.cost)||a.carrierOrg.localeCompare(b.carrierOrg));
  return {originCep,destinationCep,packages,weightKg:String(weight),candidates,expiresAt:new Date(new Date(w.clock).valueOf()+15*60000).toISOString(),simulation:true};
}
export function simulate(w,p,d) { return {status:'SIMULATION_ONLY',result:calculate(w,p,d),automaticAction:false}; }
function orderValues(w,p,d) {
  const quote=get(w,d.quoteId,'quote');check(new Date(w.clock)<new Date(quote.expiresAt),'QUOTE_EXPIRED',409);
  const index=d.candidate===undefined?0:d.candidate;check(Number.isInteger(index)&&index>=0&&index<quote.candidates.length,'INVALID_CANDIDATE');const candidate=quote.candidates[index],location=get(w,d.locationId,'location');
  const packages=parcelSnapshot(d.packages);check(canonical(packages)===canonical(parcelSnapshot(quote.packages)),'QUOTE_CONTENT_MISMATCH',409);check(postalCode(location.postalCode)===postalCode(quote.destinationCep),'DESTINATION_MISMATCH');
  const from=timestamp(d.windowStart),to=timestamp(d.windowEnd);check(from<to,'INVALID_WINDOW');
  return {quoteId:quote.id,candidate:copy(candidate),packages,originCep:postalCode(quote.originCep),destinationCep:postalCode(quote.destinationCep),quoteContentSignature:quoteContent(quote),consumerCharge:money(d.consumerCharge),subsidy:cash(Number(candidate.cost)-Number(d.consumerCharge)),locationId:location.id,destinationSnapshot:copy(location),windowStart:from,windowEnd:to};
}
function pendingEditValues(w,p,input){
  check(input&&typeof input==='object'&&!Array.isArray(input),'RECOTATION_REQUIRED');const values=copy(input);
  if(values.candidate&&typeof values.candidate==='object'&&!Array.isArray(values.candidate)){
    // Earlier public versions persisted the exact candidate snapshot, not its
    // index. Resolve it only by full equality; never guess candidate zero.
    const quote=get(w,values.quoteId,'quote');check(new Date(w.clock)<new Date(quote.expiresAt),'QUOTE_EXPIRED',409);
    const matches=quote.candidates.map((candidate,index)=>({candidate,index})).filter(x=>canonical(x.candidate)===canonical(values.candidate));check(matches.length===1,'QUOTE_CONTENT_MISMATCH',409);
    if(values.originCep!==undefined)check(postalCode(values.originCep)===postalCode(quote.originCep),'QUOTE_CONTENT_MISMATCH',409);
    if(values.destinationCep!==undefined)check(postalCode(values.destinationCep)===postalCode(quote.destinationCep),'DESTINATION_MISMATCH',409);
    if(values.destinationSnapshot!==undefined){check(values.destinationSnapshot&&typeof values.destinationSnapshot==='object'&&!Array.isArray(values.destinationSnapshot),'DESTINATION_MISMATCH',409);check(postalCode(values.destinationSnapshot.postalCode)===postalCode(quote.destinationCep),'DESTINATION_MISMATCH',409);}
    values.candidate=matches[0].index;
  }
  return orderValues(w,p,values);
}
function releaseReservations(w,s) { for (const r of list(w,'reservation').filter(r=>r.shipmentId===s.id&&r.status==='ACTIVE')) update(r,{status:'RELEASED'}); }
function cancelShipment(w,s) { update(s,{status:'CANCELLED'});releaseReservations(w,s);if(s.assignmentId)update(get(w,s.assignmentId,'assignment'),{status:'CANCELLED'});for(const tender of list(w,'tender').filter(t=>t.shipmentId===s.id&&t.status==='OPEN')){for(const offer of Object.values(tender.offers||{}))if(['PENDING','COUNTER'].includes(offer.status))offer.status='CANCELLED';update(tender,{status:'CANCELLED'});}for(const oid of s.orderIds){const o=get(w,oid,'order');if(o.status!=='CANCELLED'){const ids=(o.shipmentIds||[]).filter(x=>x!==s.id);update(o,{status:ids.length?'PLANNED':'RELEASED',shipmentIds:ids});}} }
function planValues(w,p,d) {
  check(Array.isArray(d.orderIds)&&d.orderIds.length&&new Set(d.orderIds).size===d.orderIds.length,'INVALID_ORDERS');
  const orders=d.orderIds.map(x=>get(w,x,'order'));check(orders.every(o=>o.status==='RELEASED'),'ORDER_NOT_RELEASED');
  for(const order of orders)orderQuoteCurrent(w,order);
  const packages=orders.flatMap(o=>o.packages.map(x=>({...copy(x),orderId:o.id,key:`${o.id}:${x.id}`}))), weight=packages.reduce((a,x)=>a+Number(x.weightKg),0), capacity=number(d.capacityKg,.001), reasons=[];
  if(weight>capacity)reasons.push('CAPACITY_EXCEEDED');if(new Set(packages.map(x=>x.cargoClass)).size>1)reasons.push('CARGO_INCOMPATIBLE');
  let pos=get(w,d.originLocationId,'location'),time=new Date(timestamp(d.start)).valueOf(),kmTotal=0;const speed=number(d.speedKmh,1),remaining=[...orders],stops=[];
  const distance=(a,b)=>Math.hypot((Number(a.lat)-Number(b.lat))*111,(Number(a.lon)-Number(b.lon))*111*Math.cos(Number(a.lat)*Math.PI/180));
  const destination=o=>o.destinationSnapshot||get(w,o.locationId,'location');
  while(remaining.length){remaining.sort((a,b)=>distance(pos,destination(a))-distance(pos,destination(b))||a.id.localeCompare(b.id));const o=remaining.shift(),loc=destination(o),km=distance(pos,loc);kmTotal+=km;time+=km/speed*3600000;time=Math.max(time,new Date(o.windowStart).valueOf());if(time>=new Date(o.windowEnd).valueOf())reasons.push(`WINDOW_INFEASIBLE:${o.id}`);stops.push({orderId:o.id,orderReference:o.externalId,locationId:o.locationId,destination:copy(loc),arrival:new Date(time).toISOString(),windowStart:o.windowStart,windowEnd:o.windowEnd,km:Number(km.toFixed(3))});time+=300000;pos=loc;}
  return {orderIds:orders.map(o=>o.id),orderVersions:Object.fromEntries(orders.map(o=>[o.id,o.version])),packages,weightKg:String(weight),capacityKg:String(capacity),start:timestamp(d.start),end:new Date(time).toISOString(),stops,distanceKm:Number(kmTotal.toFixed(3)),cost:cash(orders.reduce((a,o)=>a+Number(o.candidate.cost),0)),reasons,status:reasons.length?'INFEASIBLE':'FEASIBLE',heuristic:'SIMULATED_NEAREST_NEXT'};
}
function reserve(w,p,t,carrier,vehicleId,driverId,price) {
  const s=get(w,t.shipmentId,'shipment');check(t.status==='OPEN'&&new Date(w.clock)<new Date(t.expiresAt),'OFFER_EXPIRED',409);check(!s.assignmentId,'ALREADY_ASSIGNED',409);
  check(s.status==='OFFERED','SHIPMENT_NOT_OFFERED',409);check(s.orderIds.every(oid=>get(w,oid,'order').status==='PLANNED'),'ORDER_NOT_PLANNED',409);
  const v=get(w,vehicleId,'resource'),driver=get(w,driverId,'resource');check(v.type==='VEHICLE'&&driver.type==='DRIVER'&&v.org===carrier&&driver.org===carrier,'INVALID_RESOURCES');check(Number(v.capacityKg)>=Number(s.weightKg),'CAPACITY_EXCEEDED');check(new Date(driver.licenseValidTo)>new Date(s.end),'LICENSE_EXPIRED');
  const overlap=x=>new Date(x.start)<new Date(s.end)&&new Date(s.start)<new Date(x.end);
  check(!list(w,'maintenance').some(m=>m.status==='SCHEDULED'&&[v.id,driver.id].includes(m.resourceId)&&overlap(m)),'RESOURCE_MAINTENANCE',409);
  check(!list(w,'reservation').some(r=>r.status==='ACTIVE'&&r.resourceIds.some(x=>[v.id,driver.id].includes(x))&&overlap(r)),'RESOURCE_CONFLICT',409);
  const a=add(w,{...p,org:s.org},'assignment',{shipmentId:s.id,carrierOrg:carrier,vehicleId:v.id,driverId:driver.id,price:money(price),status:'ACTIVE'},[carrier]);
  add(w,{...p,org:carrier},'reservation',{shipmentId:s.id,assignmentId:a.id,resourceIds:[v.id,driver.id],start:s.start,end:s.end,status:'ACTIVE'});
  update(t,{status:'AWARDED',assignmentId:a.id,carrierOrg:carrier});for(const [cid,offer]of Object.entries(t.offers))offer.status=cid===carrier?'ACCEPTED':'CANCELLED';
  update(s,{status:'ASSIGNED',assignmentId:a.id,carrierOrg:carrier,driverUserId:driver.userId||null,cost:money(price),shared:[carrier]});return a;
}
function enqueue(w,p,d) {
  check(['OMS','WMS','ERP','CARRIER','MAPS','FISCAL'].includes(d.adapter),'INVALID_ADAPTER');check(['GOOD','BEFORE_FAILURE','LOST_RESPONSE','REJECT','UNAVAILABLE'].includes(d.mode||'GOOD'),'INVALID_MODE');
  const payload=d.payload;check(payload&&typeof payload==='object'&&!Array.isArray(payload),'ADAPTER_PAYLOAD');
  if(d.adapter==='OMS'){check(payload.order&&typeof payload.order==='object','OMS_ORDER_SCHEMA');text(payload.order.externalId);}
  if(d.adapter==='WMS'){text(payload.shipmentId);check(['READY','HANDED_OVER'].includes(payload.custody),'WMS_CUSTODY');}
  if(d.adapter==='ERP'){check(Array.isArray(payload.entryIds)&&payload.entryIds.length&&new Set(payload.entryIds).size===payload.entryIds.length,'ERP_ENTRIES');text(payload.reference);}
  if(d.adapter==='CARRIER')check(payload.demo===true&&Array.isArray(payload.packages)&&payload.packages.length&&payload.shipmentId,'CARRIER_SCHEMA');
  if(d.adapter==='MAPS'){check(Array.isArray(payload.locations)&&payload.locations.length>=2&&payload.locations.length<=100,'MAPS_LOCATIONS');check(payload.locations.every(x=>typeof x.lat==='number'&&Number.isFinite(x.lat)&&Math.abs(x.lat)<=90&&typeof x.lon==='number'&&Number.isFinite(x.lon)&&Math.abs(x.lon)<=180),'MAPS_COORDINATES');}
  if(d.adapter==='FISCAL'){check(payload.schema==='DEMO_ENVELOPE_1'&&payload.documentId&&payload.scenario,'FISCAL_DEMO_SCHEMA_ONLY');}
  return add(w,p,'outbox',{adapter:d.adapter,payload:copy(d.payload||{}),mode:d.mode||'GOOD',messageId:id('message'),targetId:d.targetId||null,purpose:d.purpose||null,status:'PENDING',attempts:0,effect:'NONE',contractVersion:1,provider:'PUBLIC_SIMULATOR',real:false});
}
function applyEffect(w,p,m,result){
  if(m.effect==='APPLIED'||m.effect==='REJECTED')return m;
  m.result=copy(result);m.protocol=result.protocol; m.status=result.status==='REJECTED'?'REJECTED':'DONE';m.effect=result.status;
  if(m.targetId){const target=get(w,m.targetId);if(m.purpose==='LABEL')update(target,{labelStatus:m.status==='DONE'?'READY':'REJECTED'});if(m.purpose==='FISCAL'){update(target,{status:m.status==='DONE'?'DEMO_AUTHORIZED':'DEMO_REJECTED',protocol:m.protocol});update(get(w,target.shipmentId,'shipment'),{fiscalStatus:target.status});}}
  if(m.status==='DONE'&&m.adapter==='OMS')m.importedOrderId=handlers.order_create(w,p,m.payload.order).id;
  if(m.status==='DONE'&&m.adapter==='ERP')add(w,p,'reconciliation',{entryIds:m.payload.entryIds,protocol:m.protocol,status:'CONFIRMED_MOCK_ONLY'});
  if(m.status==='DONE'&&m.adapter==='WMS')update(get(w,m.payload.shipmentId,'shipment'),{wmsCustody:m.payload.custody});
  if(m.status==='DONE'&&m.adapter==='MAPS')add(w,p,'routeMatrix',{locations:m.payload.locations,distanceKm:(m.payload.locations||[]).map(a=>(m.payload.locations||[]).map(b=>Number(Math.hypot((a.lat-b.lat)*111,(a.lon-b.lon)*111).toFixed(3)))),provider:'SYNTHETIC_EUCLIDEAN',status:'READY'});
  return update(m);
}
export const handlers={
  quote:(w,p,d)=>add(w,p,'quote',calculate(w,p,d)),
  scenario_save:(w,p,d)=>add(w,p,'scenario',{name:text(d.name),input:copy(d.input||d),mode:'SIMULATION_ONLY'}),
  master_create:(w,p,d)=>add(w,p,d.kind,{...masterValues(w,p,d.kind,d.values),status:'ACTIVE',history:[]}),
  master_update:(w,p,d)=>{const o=get(w,d.id);version(o,d);const values=masterValues(w,p,o.kind,d.values,o.id),previous=copy(o);delete previous.history;o.history||=[];o.history.push({at:w.clock,values:previous});return update(o,values);},
  rate_create:(w,p,d)=>{check(['BUY','SELL'].includes(d.side),'INVALID_RATE_SIDE');get(w,d.zoneId,'zone');get(w,d.serviceId,'service');check(timestamp(d.validFrom)<timestamp(d.validTo)&&number(d.minKg)<number(d.maxKg),'INVALID_RATE');return add(w,p,'rate',{...copy(d),base:money(d.base),perKg:String(number(d.perKg)),status:'DRAFT'});},
  rate_publish:(w,p,d)=>{const r=get(w,d.id,'rate');version(r,d);check(r.status==='DRAFT','RATE_IMMUTABLE',409);check(!list(w,'rate').some(x=>x.id!==r.id&&x.org===r.org&&x.carrierOrg===r.carrierOrg&&x.zoneId===r.zoneId&&x.serviceId===r.serviceId&&x.side===r.side&&x.status==='PUBLISHED'&&Number(x.priority)===Number(r.priority)&&new Date(x.validFrom)<new Date(r.validTo)&&new Date(r.validFrom)<new Date(x.validTo)&&Number(x.minKg)<Number(r.maxKg)&&Number(r.minKg)<Number(x.maxKg)),'AMBIGUOUS_RATE',409);return update(r,{status:'PUBLISHED'});},
  order_create:(w,p,d)=>{text(d.externalId);check(!list(w,'order').some(o=>o.org===p.org&&o.externalId===d.externalId&&o.status!=='CANCELLED'),'DUPLICATE_ORDER',409);return add(w,p,'order',{externalId:d.externalId,...orderValues(w,p,d),status:'VALIDATED',shipmentIds:[],revisions:[]});},
  import_preview:(w,p,d)=>{check(Array.isArray(d.rows)&&d.rows.length,'INVALID_ROWS');const seen=new Set();const rows=d.rows.map((row,i)=>{const input={...copy(d.defaults||{}),...copy(row)};let error=null;try{orderValues(w,p,input);text(input.externalId);check(!seen.has(input.externalId)&&!list(w,'order').some(o=>o.externalId===input.externalId&&o.org===p.org&&o.status!=='CANCELLED'),'DUPLICATE_ORDER');}catch(e){error=e.code||'INVALID_ROW';}seen.add(input.externalId);return {line:i+1,input,valid:!error,error};});return add(w,p,'import',{rows,valid:rows.filter(x=>x.valid).length,errors:rows.filter(x=>!x.valid).length,status:'PREVIEW'});},
  import_commit:(w,p,d)=>{const batch=get(w,d.id,'import');version(batch,d);check(batch.status==='PREVIEW','IMPORT_ALREADY_COMMITTED');check(!batch.errors||d.validOnly,'IMPORT_HAS_ERRORS');const ids=batch.rows.filter(x=>x.valid).map(x=>handlers.order_create(w,p,x.input).id);return update(batch,{status:'COMMITTED',orderIds:ids});},
  order_release:(w,p,d)=>{const o=get(w,d.id,'order');version(o,d);check(o.status==='VALIDATED','INVALID_STATE');orderQuoteCurrent(w,o);return update(o,{status:'RELEASED'});},
  order_change:(w,p,d)=>{
    const o=get(w,d.id,'order');version(o,d);check(['CANCEL','EDIT'].includes(d.operation),'INVALID_OPERATION');text(d.reason);check(o.status!=='CANCELLED','INVALID_STATE');const ships=list(w,'shipment').filter(s=>s.status!=='CANCELLED'&&s.orderIds.includes(o.id));
    if(ships.some(s=>s.assignmentId||['IN_TRANSIT','PARTIAL','DELIVERED'].includes(s.status)))return add(w,p,'change',{orderId:o.id,orderVersion:o.version,operation:d.operation,newValues:copy(d.values||{}),reason:d.reason,affectedShipments:ships.map(s=>s.id),status:ships.some(s=>['IN_TRANSIT','PARTIAL','DELIVERED'].includes(s.status))?'COMPENSATION_REQUIRED':'APPROVAL_REQUIRED'});
    const replacement=d.operation==='EDIT'?orderValues(w,p,d.values):null,previous=copy(o);delete previous.revisions;for(const shipment of ships)cancelShipment(w,shipment);o.revisions||=[];o.revisions.push(previous);
    return update(o,d.operation==='CANCEL'?{status:'CANCELLED',shipmentIds:[]}:{...replacement,status:'VALIDATED',shipmentIds:[]});
  },
  change_resolve:(w,p,d)=>{
    const c=get(w,d.id,'change');version(c,d);check(['APPROVAL_REQUIRED','COMPENSATION_REQUIRED'].includes(c.status),'INVALID_STATE');text(d.resolution);const o=get(w,c.orderId,'order');check(o.version===c.orderVersion,'ORDER_CHANGED');
    if(c.status==='COMPENSATION_REQUIRED'){add(w,p,'compensation',{changeId:c.id,resolution:d.resolution,realPayment:false});return update(c,{status:'COMPENSATED_HISTORY_PRESERVED',resolution:d.resolution});}
    const replacement=c.operation==='EDIT'?pendingEditValues(w,p,c.newValues):null,previous=copy(o);delete previous.revisions;
    for(const sid of c.affectedShipments){const shipment=get(w,sid,'shipment');check(!['IN_TRANSIT','PARTIAL','DELIVERED'].includes(shipment.status),'EXECUTION_STARTED');cancelShipment(w,shipment);}o.revisions||=[];o.revisions.push(previous);
    update(o,c.operation==='CANCEL'?{status:'CANCELLED',shipmentIds:[]}:{...replacement,status:'VALIDATED',shipmentIds:[]});return update(c,{status:'APPLIED',resolution:d.resolution});
  },
  plan:(w,p,d)=>add(w,p,'plan',planValues(w,p,d)),
  plan_commit:(w,p,d)=>{const plan=get(w,d.id,'plan');version(plan,d);check(plan.status==='FEASIBLE','PLAN_NOT_FEASIBLE');for(const oid of plan.orderIds){const o=get(w,oid,'order');check(o.status==='RELEASED'&&o.version===plan.orderVersions[oid],'PLAN_STALE',409);orderQuoteCurrent(w,o);}check(!list(w,'shipment').some(s=>s.status!=='CANCELLED'&&s.packages.some(x=>plan.packages.some(y=>y.key===x.key))),'ALREADY_ALLOCATED');const s=add(w,p,'shipment',{...copy(plan),status:'PLANNED',planId:plan.id,planVersion:1,assignmentId:null,delivered:[],lastEventAt:null,tracking:'PLANNED',stage:'PICKUP',labelStatus:'NONE',fiscalStatus:'NOT_EVALUATED',promisedAt:plan.orderIds.map(x=>get(w,x,'order').windowEnd).sort().at(-1),completedAt:null});for(const oid of plan.orderIds)update(get(w,oid,'order'),{status:'PLANNED',shipmentIds:[s.id]});update(plan,{status:'COMMITTED',shipmentId:s.id});return s;},
  replan:(w,p,d)=>{const s=get(w,d.id,'shipment');version(s,d);text(d.reason);check(!['IN_TRANSIT','PARTIAL','DELIVERED'].includes(s.status),'EXECUTION_STARTED');if(s.assignmentId)return add(w,p,'replanChange',{shipmentId:s.id,shipmentVersion:s.version,plan:copy(d.plan),reason:d.reason,status:'PENDING'});const orders=s.orderIds.map(x=>get(w,x,'order'));const old=orders.map(o=>o.status);orders.forEach(o=>o.status='RELEASED');const computed=planValues(w,p,{...d.plan,orderIds:s.orderIds});orders.forEach((o,i)=>o.status=old[i]);check(computed.status==='FEASIBLE','PLAN_NOT_FEASIBLE');cancelShipment(w,s);return add(w,p,'plan',planValues(w,p,{...d.plan,orderIds:s.orderIds}));},
  replan_approve:(w,p,d)=>{const c=get(w,d.id,'replanChange');version(c,d);check(c.status==='PENDING','INVALID_STATE');const s=get(w,c.shipmentId,'shipment');check(s.version===c.shipmentVersion,'VERSION_CONFLICT',409);const orders=s.orderIds.map(x=>get(w,x,'order')),old=orders.map(o=>o.status);orders.forEach(o=>o.status='RELEASED');const computed=planValues(w,p,{...c.plan,orderIds:s.orderIds});orders.forEach((o,i)=>o.status=old[i]);check(computed.status==='FEASIBLE','PLAN_NOT_FEASIBLE');cancelShipment(w,s);update(c,{status:'APPROVED',reason:text(d.reason)});return add(w,p,'plan',planValues(w,p,{...c.plan,orderIds:s.orderIds}));},
  tender:(w,p,d)=>{const s=current(w,p,d);version(s,d);check(['PLANNED','OFFERED'].includes(s.status)&&!s.assignmentId,'INVALID_STATE');check(Array.isArray(d.carriers)&&d.carriers.length,'INVALID_CARRIERS');check(timestamp(d.expiresAt)>w.clock,'INVALID_EXPIRY');for(const t of list(w,'tender').filter(t=>t.shipmentId===s.id&&t.status==='OPEN'))update(t,{status:'CANCELLED'});const t=add(w,p,'tender',{shipmentId:s.id,expiresAt:timestamp(d.expiresAt),offers:Object.fromEntries(d.carriers.map(c=>[c,{status:'PENDING',price:s.cost}])),status:'OPEN'},d.carriers);update(s,{status:'OFFERED'});return t;},
  offer_respond:(w,p,d)=>{const t=get(w,d.id,'tender');version(t,d);check(t.status==='OPEN'&&new Date(w.clock)<new Date(t.expiresAt),'OFFER_EXPIRED');const offer=t.offers[p.org];check(offer&&offer.status==='PENDING','INVALID_OFFER');check(['ACCEPT','REJECT','COUNTER'].includes(d.decision),'INVALID_DECISION');if(d.decision==='ACCEPT')return reserve(w,p,t,p.org,d.vehicleId,d.driverId,offer.price);Object.assign(offer,{status:d.decision==='REJECT'?'REJECTED':'COUNTER',price:d.decision==='COUNTER'?money(d.price):offer.price,vehicleId:d.vehicleId,driverId:d.driverId,reason:d.reason});if(Object.values(t.offers).every(x=>x.status==='REJECTED'))t.status='REJECTED';return update(t);},
  counter_accept:(w,p,d)=>{const t=get(w,d.id,'tender');version(t,d);const offer=t.offers[d.carrierOrg];check(offer&&offer.status==='COUNTER','COUNTER_REQUIRED');return reserve(w,p,t,d.carrierOrg,offer.vehicleId,offer.driverId,offer.price);},
  expire_offers:(w,p,d)=>{let count=0;for(const t of list(w,'tender').filter(t=>t.status==='OPEN'&&t.expiresAt<=w.clock)){update(t,{status:'EXPIRED'});count++;}return {status:'EXPIRED',count};},
  rfq_create:(w,p,d)=>{check(Array.isArray(d.carriers)&&d.carriers.length,'INVALID_CARRIERS');check(timestamp(d.expiresAt)>w.clock,'INVALID_EXPIRY');return add(w,p,'rfq',{name:text(d.name),scope:text(d.scope),carriers:d.carriers,expiresAt:timestamp(d.expiresAt),status:'OPEN',bids:{}},d.carriers);},
  rfq_bid:(w,p,d)=>{const r=get(w,d.id,'rfq');version(r,d);check(r.status==='OPEN'&&r.expiresAt>w.clock&&r.carriers.includes(p.org),'INVALID_BID');r.bids[p.org]={base:money(d.base),perKg:String(number(d.perKg))};return update(r);},
  rfq_select:(w,p,d)=>{const r=get(w,d.id,'rfq');version(r,d);check(r.status==='OPEN'&&r.expiresAt>w.clock&&r.bids[d.carrierOrg],'INVALID_BID');const draft=handlers.rate_create(w,p,{...d.rate,...r.bids[d.carrierOrg],carrierOrg:d.carrierOrg});update(r,{status:'SELECTED',draftRateId:draft.id});return draft;},
  fleet_create:(w,p,d)=>{check(['VEHICLE','DRIVER'].includes(d.type),'INVALID_RESOURCE');if(d.fleetMode==='AGGREGATE'){const c=get(w,d.aggregateContractId,'aggregateContract');check(c.validFrom<=w.clock&&c.validTo>w.clock,'AGGREGATE_CONTRACT_EXPIRED');}return add(w,p,'resource',{...copy(d),name:text(d.name),status:'ACTIVE',capacityKg:d.type==='VEHICLE'?String(number(d.capacityKg,.001)):undefined,licenseValidTo:d.type==='DRIVER'?timestamp(d.licenseValidTo):undefined});},
  fleet_update:(w,p,d)=>{
    check(Object.keys(d).every(k=>['id','version','values'].includes(k)),'INVALID_RESOURCE_UPDATE_FIELDS');
    const resource=get(w,d.id,'resource');version(resource,d);
    check(d.values&&typeof d.values==='object'&&!Array.isArray(d.values)&&Object.keys(d.values).length,'RESOURCE_VALUES_REQUIRED');
    const allowed=resource.type==='VEHICLE'?['name','capacityKg']:resource.type==='DRIVER'?['name','licenseValidTo']:[];
    check(Object.keys(d.values).every(k=>allowed.includes(k)),'IMMUTABLE_RESOURCE_FIELDS');
    check(!list(w,'reservation').some(r=>r.status==='ACTIVE'&&(r.resourceIds||[]).includes(resource.id)),'RESOURCE_RESERVED',409);
    check(!list(w,'maintenance').some(m=>m.status==='SCHEDULED'&&m.resourceId===resource.id),'RESOURCE_MAINTENANCE',409);
    const values=copy(d.values);
    if(values.name!==undefined)values.name=text(values.name);
    if(values.capacityKg!==undefined){check(['number','string'].includes(typeof values.capacityKg),'INVALID_NUMBER');values.capacityKg=String(number(values.capacityKg,.001));}
    if(values.licenseValidTo!==undefined){values.licenseValidTo=timestamp(values.licenseValidTo);check(values.licenseValidTo>w.clock,'LICENSE_EXPIRED');}
    return update(resource,values);
  },
  aggregate_contract:(w,p,d)=>{check(timestamp(d.validFrom)<timestamp(d.validTo),'INVALID_INTERVAL');return add(w,p,'aggregateContract',{...copy(d),name:text(d.name),reference:text(d.reference),status:'PUBLISHED_IMMUTABLE'});},
  maintenance:(w,p,d)=>{get(w,d.resourceId,'resource');check(timestamp(d.start)<timestamp(d.end),'INVALID_INTERVAL');return add(w,p,'maintenance',{resourceId:d.resourceId,start:timestamp(d.start),end:timestamp(d.end),reason:text(d.reason),status:'SCHEDULED'});},
  maintenance_finish:(w,p,d)=>{const m=get(w,d.id,'maintenance');version(m,d);check(m.status==='SCHEDULED'&&['COMPLETED','CANCELLED'].includes(d.result),'INVALID_STATE');if(d.result==='COMPLETED')check(m.end<=w.clock,'MAINTENANCE_NOT_ENDED');return update(m,{status:d.result,reason:text(d.reason)});},
  expense:(w,p,d)=>{const s=current(w,p,d);return add(w,p,'expense',{shipmentId:s.id,category:d.category,amount:money(d.amount),advanceAmount:money(d.advanceAmount||0),status:'RECORDED'});},
  expense_reconcile:(w,p,d)=>{const e=get(w,d.id,'expense');version(e,d);check(e.status==='RECORDED','INVALID_STATE');const balance=cents(money(d.approvedAmount))-cents(e.advanceAmount||'0.00');const a=add(w,p,'expenseAdjustment',{expenseId:e.id,approvedAmount:money(d.approvedAmount),amount:cash(Math.abs(balance)/100),signedBalance:cash(balance/100),direction:balance>0?'REIMBURSE':balance<0?'RETURN_ADVANCE':'ZERO',reason:text(d.reason),status:'OPEN_LOCAL',realPayment:false});update(e,{status:'RECONCILED',approvedAmount:money(d.approvedAmount),adjustmentId:a.id});return a;},
  expense_close:(w,p,d)=>{const a=get(w,d.id,'expenseAdjustment');version(a,d);check(a.status==='OPEN_LOCAL'&&cents(money(d.amount))===cents(a.amount),'EXPENSE_BALANCE_MISMATCH');return update(a,{status:'CLOSED_LOCAL',reference:text(d.reference),realPayment:false});},
  subcontract:(w,p,d)=>{const s=current(w,p,d);version(s,d);check(s.status==='ASSIGNED','INVALID_STATE');check(d.targetOrg!==s.carrierOrg,'INVALID_SUBCONTRACTOR');update(s,{subcontractorOrg:d.targetOrg});return add(w,p,'subcontract',{shipmentId:s.id,targetOrg:d.targetOrg,price:money(d.price),status:'AUTHORIZED'},[d.targetOrg]);},
  label_request:(w,p,d)=>{const s=current(w,p,d);version(s,d);check(s.status==='ASSIGNED'&&s.labelStatus==='NONE','INVALID_STATE');update(s,{labelStatus:'PENDING'});return enqueue(w,p,{adapter:'CARRIER',payload:{shipmentId:s.id,packages:s.packages,demo:true},mode:d.mode,targetId:s.id,purpose:'LABEL'});},
  stage:(w,p,d)=>{const s=current(w,p,d);version(s,d);const seq=['PICKUP','HUB','TRANSFER','LAST_MILE','DELIVERY'];check(seq.includes(d.stage),'INVALID_STAGE');check(sameSet(d.packageKeys,s.packages.map(x=>x.key)),'CUSTODY_VOLUMES_MISMATCH');if(s.status==='ASSIGNED'){check(s.labelStatus==='READY'&&['DEMO_AUTHORIZED','DEMO_NOT_REQUIRED'].includes(s.fiscalStatus),'DISPATCH_BLOCKED');check(d.stage==='PICKUP','PICKUP_REQUIRED');s.status='IN_TRANSIT';}else check(['IN_TRANSIT','PARTIAL'].includes(s.status)&&seq.indexOf(d.stage)===seq.indexOf(s.stage)+1,'INVALID_STAGE_TRANSITION');s.custody||=[];s.custody.push({stage:d.stage,packageKeys:copy(d.packageKeys),quantity:d.packageKeys.length,actor:p.id,at:w.clock});return update(s,{stage:d.stage,lastEventAt:w.clock});},
  tracking:(w,p,d)=>{const s=current(w,p,d),old=list(w,'tracking').find(x=>x.shipmentId===s.id&&x.eventId===d.eventId);if(old){check(old.requestHash===canonical(d),'EVENT_CONFLICT',409);return old;}check(new Date(timestamp(d.occurredAt)).valueOf()<=new Date(w.clock).valueOf()+300000,'FUTURE_EVENT');check(Number.isInteger(d.planVersion)&&d.planVersion>=1&&d.planVersion<=s.planVersion,'INVALID_PLAN_VERSION');const projected=d.planVersion===s.planVersion&&s.status==='IN_TRANSIT'&&(!s.lastEventAt||timestamp(d.occurredAt)>s.lastEventAt);if(projected)update(s,{tracking:text(d.type),lastEventAt:timestamp(d.occurredAt)});return add(w,{...p,org:s.org},'tracking',{shipmentId:s.id,eventId:text(d.eventId),type:text(d.type),occurredAt:timestamp(d.occurredAt),requestHash:canonical(d),projectionUpdated:projected,status:d.planVersion===s.planVersion?'RECORDED':'QUARANTINED'},[s.carrierOrg]);},
  pod:(w,p,d)=>{const s=current(w,p,d),old=list(w,'pod').find(x=>x.shipmentId===s.id&&x.proofId===d.proofId);if(old){check(old.requestHash===canonical(d),'PROOF_CONFLICT',409);return old;}version(s,d);check(['IN_TRANSIT','PARTIAL'].includes(s.status)&&s.stage==='DELIVERY','NOT_AT_DELIVERY');check(Array.isArray(d.packageKeys)&&d.packageKeys.length&&new Set(d.packageKeys).size===d.packageKeys.length&&d.packageKeys.every(k=>s.packages.some(x=>x.key===k)),'INVALID_PACKAGES');check(!d.packageKeys.some(k=>s.delivered.includes(k)),'ALREADY_DELIVERED',409);check(['DELIVERED','FAILED'].includes(d.outcome),'INVALID_OUTCOME');text(d.reason);const at=timestamp(d.occurredAt);check(new Date(at).valueOf()<=new Date(w.clock).valueOf()+300000,'FUTURE_EVENT');if(d.fileId)check(w.files[d.fileId]?.shipmentId===s.id,'FILE_SCOPE');if(d.outcome==='DELIVERED'){s.delivered=[...new Set([...s.delivered,...d.packageKeys])].sort();s.status=s.delivered.length===s.packages.length?'DELIVERED':'PARTIAL';s.tracking=s.status;if(s.status==='DELIVERED'){s.completedAt=at;releaseReservations(w,s);}}update(s,{lastEventAt:!s.lastEventAt||at>s.lastEventAt?at:s.lastEventAt});return add(w,{...p,org:s.org},'pod',{shipmentId:s.id,proofId:text(d.proofId),packageKeys:copy(d.packageKeys),outcome:d.outcome,reason:d.reason,fileId:d.fileId||null,occurredAt:at,requestHash:canonical(d)},[s.carrierOrg]);},
  offline_sync:(w,p,d)=>{check(['pod','tracking'].includes(d.command),'OFFLINE_COMMAND_NOT_ALLOWED');const s=current(w,p,d.payload);check(d.context&&d.context.planVersion===s.planVersion&&d.context.assignmentId===s.assignmentId&&sameSet(d.context.packageKeys,s.packages.map(x=>x.key)),'OFFLINE_CONTEXT_CHANGED',409);const field=d.command==='pod'?'proofId':'eventId',old=list(w,d.command).find(x=>x.shipmentId===s.id&&x[field]===d.payload[field]);if(old){check(old.offlineHash===canonical(d)||old.requestHash===canonical(d.payload),'OFFLINE_EVENT_CONFLICT',409);return old;}const effective=copy(d.payload);if(d.command==='pod')effective.version=s.version;const result=handlers[d.command](w,p,effective);result.offlineHash=canonical(d);return result;},
  upload_pod:(w,p,d)=>{const s=current(w,p,d);check(['IN_TRANSIT','PARTIAL'].includes(s.status),'EXECUTION_REQUIRED');check(typeof d.base64==='string'&&d.base64.length<=2796204&&/^[A-Za-z0-9+/]*={0,2}$/.test(d.base64),'FILE_SIZE');let bytes;try{bytes=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0));}catch{throw new ApiError('INVALID_BASE64');}check(bytes.length&&bytes.length<=2*1024*1024,'FILE_SIZE');const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;check(png||jpeg,'UNSUPPORTED_FILE_TYPE');const fid=id('file');w.files[fid]={id:fid,shipmentId:s.id,base64:d.base64,mime:png?'image/png':'image/jpeg',bytes:bytes.length};return{id:fid,shipmentId:s.id,mime:w.files[fid].mime,bytes:bytes.length,status:'DEMO_STORED_SIGNATURE_ONLY',simulation:true,antivirus:false};},
  claim_create:(w,p,d)=>{const s=current(w,p,d);check(['DAMAGE','LOSS','DELAY','REFUSAL'].includes(d.type),'INVALID_CLAIM');check(Array.isArray(d.packageKeys)&&d.packageKeys.length&&new Set(d.packageKeys).size===d.packageKeys.length&&d.packageKeys.every(k=>s.packages.some(x=>x.key===k)),'INVALID_CLAIM_PACKAGES');return add(w,{...p,org:s.org},'claim',{shipmentId:s.id,type:d.type,description:text(d.description),packageKeys:copy(d.packageKeys),quantity:d.packageKeys.length,status:'OPEN',history:[{status:'OPEN',at:w.clock}],realIndemnity:false},[s.carrierOrg]);},
  claim_resolve:(w,p,d)=>{const c=get(w,d.id,'claim');version(c,d);check(c.status==='OPEN','INVALID_STATE');c.history.push({status:'RESOLVED',at:w.clock});return update(c,{status:'RESOLVED',resolution:text(d.resolution)});},
  return_create:(w,p,d)=>{const s=current(w,p,d);check(Array.isArray(d.packageKeys)&&d.packageKeys.length&&new Set(d.packageKeys).size===d.packageKeys.length&&d.packageKeys.every(x=>s.delivered.includes(x)),'RETURN_REQUIRES_DELIVERY');check(!list(w,'return').some(r=>r.shipmentId===s.id&&r.packageKeys.some(x=>d.packageKeys.includes(x))),'RETURN_DUPLICATE');return add(w,p,'return',{shipmentId:s.id,packageKeys:copy(d.packageKeys),reason:text(d.reason),carrierOrg:s.carrierOrg,status:'AUTHORIZED',history:[]},[s.carrierOrg]);},
  return_progress:(w,p,d)=>{const r=get(w,d.id,'return');version(r,d);const seq=['AUTHORIZED','COLLECTED','RECEIVED','CLOSED'];check(seq.indexOf(d.status)===seq.indexOf(r.status)+1,'INVALID_RETURN_TRANSITION');r.history.push({from:r.status,to:d.status,at:w.clock});return update(r,{status:d.status});}
};


export function allocate(total, weights) {
  const value=cents(money(total)), entries=Object.entries(weights);check(entries.length,'INVALID_ALLOCATION');
  const weighted=entries.map(([k,v])=>[k,BigInt(Math.round(number(v,.000001)*1000000))]);check(weighted.every(([,v])=>v>0n),'INVALID_ALLOCATION');
  const sum=weighted.reduce((a,[,v])=>a+v,0n), parts=weighted.map(([k,v])=>({k,floor:BigInt(value)*v/sum,rem:BigInt(value)*v%sum}));
  let remaining=BigInt(value)-parts.reduce((a,x)=>a+x.floor,0n);parts.sort((a,b)=>a.rem===b.rem?a.k.localeCompare(b.k):a.rem>b.rem?-1:1);
  for(const part of parts){if(remaining<=0n)break;part.floor++;remaining--;}
  return Object.fromEntries(parts.map(x=>[x.k,cash(Number(x.floor)/100)]));
}
function ledgerPair(w,p,approval,kind,amount) {
  const invoice=get(w,approval.invoiceId,'invoice'),entries=[];
  for(const [org,side]of [[invoice.org,'AP'],[invoice.issuerOrg,'AR']]){
    let original=null;if(kind==='REVERSE'){original=list(w,'ledger').find(e=>e.invoiceId===invoice.id&&e.org===org&&e.side===side&&e.type==='POST');check(original,'ORIGINAL_LEDGER_AMBIGUOUS');}
    entries.push(add(w,{...p,org},'ledger',{invoiceId:invoice.id,approvalId:approval.id,amount:cash(amount),side,type:kind,reverses:original?.id||null,status:'POSTED_LOCAL_ONLY',realPayment:false}).id);
  }
  update(invoice,{status:kind==='POST'?'POSTED_LOCAL':'REVERSED_LOCAL'});return entries;
}
function settlementPair(w,p,a,reverse=false){
  const invoice=get(w,a.invoiceId,'invoice'),ids=[];
  for(const [org,side]of [[invoice.org,'AP'],[invoice.issuerOrg,'AR']]){
    const entry=list(w,'ledger').find(e=>e.invoiceId===invoice.id&&e.org===org&&e.side===side&&e.type==='POST');check(entry,'ORIGINAL_LEDGER_AMBIGUOUS');
    const prior=list(w,'settlement').filter(s=>s.entryId===entry.id).reduce((n,s)=>n+cents(s.amount),0),original=reverse?list(w,'settlement').find(s=>s.approvalId===a.sourceApprovalId&&s.side===side):null;
    if(reverse)check(original,'SETTLEMENT_PAIR_REQUIRED');const value=reverse?-cents(original.amount):cents(a.amount);check(prior+value>=0&&prior+value<=cents(entry.amount),'SETTLEMENT_EXCEEDS_BALANCE');
    ids.push(add(w,{...p,org},'settlement',{entryId:entry.id,invoiceId:invoice.id,approvalId:a.id,side,amount:cash(value/100),reverses:original?.id||null,remainingBalance:cash((cents(entry.amount)-prior-value)/100),status:reverse?'REVERSED_LOCAL_ONLY':'SETTLED_LOCAL_ONLY',realPayment:false}).id);
  }return ids;
}
function profileValues(d){
  check(['LOCAL_TEST','HOMOLOGATION','PRODUCTION'].includes(d.environment),'FISCAL_ENVIRONMENT');check(['LOCAL_MOCK','DIRECT','PROVIDER'].includes(d.route),'FISCAL_ROUTE');check((d.route==='LOCAL_MOCK')===(d.environment==='LOCAL_TEST'),'FISCAL_ROUTE_ENVIRONMENT');
  const ufs='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  for(const[field,values]of [['ufs',ufs],['documents',['CTE','MDFE','NFE_REFERENCE','CIOT']]]){const items=d[field]||[];check(Array.isArray(items)&&new Set(items).size===items.length&&items.every(x=>values.includes(x)),`FISCAL_${field.toUpperCase()}`);}
  const allowed=['name','issuerRef','ufs','documents','environment','route','providerRef','certificateRef','registrationRef','contractRef','scenarioApprovalRef','endpointCatalogRef','retentionPolicyRef','schemaRefs'];
  check(Object.keys(d).every(x=>allowed.includes(x)),'FISCAL_PROFILE_FIELDS');
  const metadata=value=>check(typeof value==='string'&&/^[a-z][a-z0-9+.-]{1,23}:[A-Za-z0-9_./:@+-]{1,100}$/.test(value),'FISCAL_METADATA_REFERENCE');
  for(const field of ['issuerRef','providerRef','certificateRef','registrationRef','contractRef','scenarioApprovalRef','endpointCatalogRef','retentionPolicyRef'])if(d[field]!==undefined&&d[field]!==null)metadata(d[field]);
  const refs=d.schemaRefs||{};check(refs&&typeof refs==='object'&&!Array.isArray(refs)&&Object.keys(refs).every(x=>(d.documents||[]).includes(x)),'FISCAL_SCHEMA_REFS');for(const value of Object.values(refs))metadata(value);
  return {...copy(d),name:text(d.name),ufs:[...(d.ufs||[])].sort(),documents:[...(d.documents||[])].sort(),schemaRefs:copy(refs),status:'IMMUTABLE_CONFIGURATION',realConnectionEnabled:false,realOperationAllowed:false,liveTransmissionEnabled:false,productionReady:false};
}
function assessProfile(profile){
  const missing=[],needed=(field,code,reason)=>{if(!profile[field]||(Array.isArray(profile[field])&&!profile[field].length))missing.push({field,code,reason});};
  needed('issuerRef','ISSUER_UNDEFINED','Identificar o estabelecimento emitente e sua responsabilidade.');needed('ufs','UF_UNDEFINED','Definir as UFs do estabelecimento e do cenário aplicável.');needed('documents','DOCUMENT_SCOPE_UNDEFINED','Definir documentos e responsabilidades após avaliação do cenário.');needed('scenarioApprovalRef','SCENARIO_REVIEW_PENDING','Vincular avaliação competente de aplicabilidade; o sistema não conclui dispensa.');
  for(const doc of profile.documents||[])if(!profile.schemaRefs?.[doc])missing.push({field:`schemaRefs.${doc}`,code:'SCHEMA_CONTRACT_PENDING',reason:`Registrar versão e vigência do contrato de ${doc}.`});
  if(profile.route!=='LOCAL_MOCK'){for(const[field,code]of [['certificateRef','CERTIFICATE_CUSTODY_PENDING'],['registrationRef','ISSUER_REGISTRATION_PENDING'],['endpointCatalogRef','ENDPOINT_CATALOG_PENDING'],['retentionPolicyRef','RETENTION_POLICY_PENDING']])needed(field,code,`Referência declarada ainda ausente: ${field}`);if(profile.route==='PROVIDER'){needed('providerRef','PROVIDER_UNDEFINED','Selecionar fornecedor.');needed('contractRef','PROVIDER_CONTRACT_PENDING','Definir o contrato e as responsabilidades do fornecedor.');}}
  const externalGates=profile.route==='LOCAL_MOCK'?[]:[{code:'LIVE_ADAPTER_NOT_IMPLEMENTED',reason:'Conector específico, assinatura e transmissão reais não implementados.'},{code:'EXTERNAL_ACCEPTANCE_NOT_VERIFIED',reason:'Referências declaradas; nenhum credenciamento ou retorno oficial verificado.'},{code:'HOMOLOGATION_PENDING',reason:'Homologação externa permanece pendente.'}];
  if(profile.environment==='PRODUCTION')externalGates.push({code:'PRODUCTION_RELEASE_PENDING',reason:'Configuração não habilita produção.'});
  return{status:missing.length?'PENDING_DATA':'LOCAL_CONTRACT_READY',missing,externalGates,readyForLocalTest:!missing.length,metadataReferencesAreDeclared:true,externalHomologationAccepted:false,productionReady:false,realOperationAllowed:false,liveTransmissionEnabled:false,realConnectionEnabled:false};
}
Object.assign(handlers,{
  tolerance:(w,p,d)=>add(w,p,'tolerance',{name:text(d.name),fixed:money(d.fixed),percent:String(number(d.percent)),status:'PUBLISHED_IMMUTABLE'}),
  invoice_create:(w,p,d)=>{check(Array.isArray(d.assignments)&&d.assignments.length&&new Set(d.assignments).size===d.assignments.length,'INVALID_ASSIGNMENTS');const refs=d.assignments.map(x=>get(w,x,'assignment'));check(refs.every(a=>a.carrierOrg===p.org),'CARRIER_SCOPE');const owner=refs[0].org;check(refs.every(a=>a.org===owner),'MIXED_CUSTOMERS');check(refs.every(a=>get(w,a.shipmentId,'shipment').status==='DELIVERED'),'DELIVERY_REQUIRED');text(d.number);check(!list(w,'invoice').some(i=>i.issuerOrg===p.org&&(i.number===d.number||i.assignmentIds.some(x=>d.assignments.includes(x)))),'INVOICE_DUPLICATE',409);return add(w,{...p,org:owner},'invoice',{issuerOrg:p.org,assignmentIds:copy(d.assignments),assignmentVersions:Object.fromEntries(refs.map(a=>[a.id,a.version])),number:d.number,amount:money(d.amount),currency:'BRL',status:'RECEIVED',payment:'NOT_EXECUTED'},[p.org]);},
  invoice_audit:(w,p,d)=>{const i=get(w,d.id,'invoice');version(i,d);check(i.status==='RECEIVED','INVALID_STATE');const tol=get(w,d.toleranceId,'tolerance'),refs=i.assignmentIds.map(x=>get(w,x,'assignment'));check(refs.every(a=>a.version===i.assignmentVersions[a.id]),'ASSIGNMENT_VERSION_CONFLICT');const expected=refs.reduce((n,a)=>n+cents(a.price),0),difference=cents(i.amount)-expected,limit=cents(tol.fixed)+expected*Number(tol.percent)/100,weights={};for(const a of refs){const s=get(w,a.shipmentId,'shipment');check(s.status==='DELIVERED','REALIZED_MISMATCH');for(const pack of s.packages)weights[pack.orderId]=(weights[pack.orderId]||0)+Number(pack.weightKg);}update(i,{expected:cash(expected/100),difference:cash(difference/100),allocationWeightsSnapshot:weights,allocation:allocate(i.amount,weights),toleranceSnapshot:copy(tol),status:Math.abs(difference)<=limit?'AUDITED':'DISPUTED'});if(i.status==='DISPUTED')i.disputeId=add(w,p,'dispute',{invoiceId:i.id,difference:i.difference,status:'OPEN'},[i.issuerOrg]).id;return i;},
  dispute_resolve:(w,p,d)=>{const dispute=get(w,d.id,'dispute');version(dispute,d);check(dispute.status==='OPEN','INVALID_STATE');check(['ADJUST_TO_EXPECTED','ACCEPT_DIFFERENCE'].includes(d.decision),'INVALID_DECISION');const i=get(w,dispute.invoiceId,'invoice');if(d.decision==='ADJUST_TO_EXPECTED')update(i,{originalAmount:i.amount,originalDifference:i.difference,amount:i.expected,difference:'0.00',allocation:allocate(i.expected,i.allocationWeightsSnapshot),status:'AUDITED'});else update(i,{status:'AUDITED'});return update(dispute,{status:'RESOLVED',decision:d.decision,reason:text(d.reason)});},
  approval_request:(w,p,d)=>{const i=get(w,d.invoiceId,'invoice');version(i,d);check(i.status==='AUDITED','AUDIT_REQUIRED');update(i,{status:'PENDING_APPROVAL'});return add(w,p,'approval',{type:'POST',invoiceId:i.id,issuerOrg:i.issuerOrg,amount:i.amount,requestedBy:p.id,status:'PENDING'});},
  approval_decide:(w,p,d)=>{const a=get(w,d.id,'approval');version(a,d);check(a.status==='PENDING','ALREADY_DECIDED',409);check(a.requestedBy!==p.id,'SEGREGATION_REQUIRED',409);check(['APPROVE','REJECT'].includes(d.decision),'INVALID_DECISION');update(a,{status:d.decision==='APPROVE'?'APPROVED':'REJECTED',approvedBy:p.id});if(d.decision==='REJECT'){if(a.type==='POST')update(get(w,a.invoiceId,'invoice'),{status:'AUDITED'});return a;}if(a.type==='SETTLEMENT'||a.type==='SETTLEMENT_REVERSE')a.settlementIds=settlementPair(w,p,a,a.type==='SETTLEMENT_REVERSE');else a.entryIds=ledgerPair(w,p,a,a.type,a.type==='REVERSE'?-Number(a.amount):Number(a.amount));return a;},
  settlement_request:(w,p,d)=>{const e=get(w,d.entryId,'ledger'),i=get(w,e.invoiceId,'invoice');check(e.side==='AP'&&e.type==='POST'&&i.status==='POSTED_LOCAL','INVALID_SETTLEMENT');check(!list(w,'approval').some(a=>a.originalEntryId===e.id&&a.type==='REVERSE'&&a.status==='PENDING'),'REVERSAL_PENDING');const amount=cents(money(d.amount));check(amount>0,'POSITIVE_AMOUNT_REQUIRED');const committed=list(w,'settlement').filter(s=>s.entryId===e.id).reduce((n,s)=>n+cents(s.amount),0)+list(w,'approval').filter(a=>a.originalEntryId===e.id&&a.type==='SETTLEMENT'&&a.status==='PENDING').reduce((n,a)=>n+cents(a.amount),0);check(committed+amount<=cents(e.amount),'SETTLEMENT_EXCEEDS_BALANCE');return add(w,p,'approval',{type:'SETTLEMENT',originalEntryId:e.id,invoiceId:i.id,issuerOrg:i.issuerOrg,amount:cash(amount/100),reason:text(d.reason),requestedBy:p.id,status:'PENDING'});},
  settlement_reverse_request:(w,p,d)=>{const s=get(w,d.settlementId,'settlement'),i=get(w,s.invoiceId,'invoice');check(s.side==='AP'&&cents(s.amount)>0,'INVALID_SETTLEMENT_REVERSAL');check(!list(w,'approval').some(a=>a.originalSettlementId===s.id&&['PENDING','APPROVED'].includes(a.status)),'SETTLEMENT_REVERSAL_EXISTS');return add(w,p,'approval',{type:'SETTLEMENT_REVERSE',originalSettlementId:s.id,sourceApprovalId:s.approvalId,invoiceId:i.id,issuerOrg:i.issuerOrg,amount:s.amount,reason:text(d.reason),requestedBy:p.id,status:'PENDING'});},
  reverse_request:(w,p,d)=>{const e=get(w,d.entryId,'ledger'),i=get(w,e.invoiceId,'invoice');check(e.side==='AP'&&e.type==='POST'&&i.status==='POSTED_LOCAL','INVALID_REVERSAL');check(!list(w,'approval').some(a=>a.originalEntryId===e.id&&a.type==='REVERSE'&&['PENDING','APPROVED'].includes(a.status)),'REVERSAL_EXISTS');check(list(w,'settlement').filter(s=>s.entryId===e.id).reduce((n,s)=>n+cents(s.amount),0)===0&&!list(w,'approval').some(a=>a.originalEntryId===e.id&&a.type==='SETTLEMENT'&&a.status==='PENDING'),'REVERSE_SETTLEMENT_FIRST');return add(w,p,'approval',{type:'REVERSE',originalEntryId:e.id,invoiceId:i.id,issuerOrg:i.issuerOrg,amount:e.amount,reason:text(d.reason),requestedBy:p.id,status:'PENDING'});},
  org_create:(w,p,d)=>{check(['SHIPPER','CARRIER','BOTH'].includes(d.profile),'INVALID_PROFILE');const o={id:id('org'),name:text(d.name),profile:d.profile};w.organizations.push(o);return o;},
  user_create:(w,p,d)=>{check(!w.users.some(u=>u.username===d.username),'USERNAME_EXISTS');check(w.organizations.some(o=>o.id===d.org),'ORGANIZATION_NOT_FOUND');check(Array.isArray(d.roles)&&d.roles.length,'ROLES_REQUIRED');const u=cleanUser({id:id('persona'),org:d.org,username:text(d.username),roles:d.roles,active:true});w.users.push(u);return {...u,simulation:true,passwordIgnored:true};},
  user_roles:(w,p,d)=>{const u=w.users.find(u=>u.id===d.userId);check(u,'NOT_FOUND',404);check(Array.isArray(d.roles)&&d.roles.length,'ROLES_REQUIRED');u.roles=copy(d.roles);return copy(u);},
  user_revoke:(w,p,d)=>{const u=w.users.find(u=>u.id===d.userId);check(u,'NOT_FOUND',404);u.active=false;return copy(u);},
  relationship:(w,p,d)=>{check(w.organizations.some(o=>o.id===d.targetOrg)&&d.targetOrg!==p.org,'INVALID_PARTNER');check(!list(w,'relationship').some(r=>sameSet(r.parties,[p.org,d.targetOrg])&&['PENDING','ACTIVE'].includes(r.status)),'RELATIONSHIP_EXISTS');return add(w,p,'relationship',{parties:[p.org,d.targetOrg],status:'PENDING'},[d.targetOrg]);},
  relationship_respond:(w,p,d)=>{const r=get(w,d.id,'relationship');version(r,d);check(['ACCEPT','REVOKE'].includes(d.decision),'INVALID_DECISION');check(d.decision==='REVOKE'||r.status==='PENDING','INVALID_STATE');return update(r,{status:d.decision==='ACCEPT'?'ACTIVE':'REVOKED'});},
  adapter_config_create:(w,p,d)=>{check(d.mode==='LOCAL_MOCK'&&d.contractVersion===1,'SIMULATOR_ONLY');check(['OMS','WMS','ERP','CARRIER','MAPS','FISCAL'].includes(d.adapter),'INVALID_ADAPTER');return add(w,p,'adapterConfig',{name:text(d.name),adapter:d.adapter,mode:'LOCAL_MOCK',contractVersion:1,status:'PUBLISHED_IMMUTABLE'});},
  adapter_enqueue:(w,p,d)=>{check(!['CARRIER','FISCAL'].includes(d.adapter),'DEDICATED_WORKFLOW_REQUIRED');if(d.adapter==='OMS')orderValues(w,p,d.payload.order);if(d.adapter==='WMS')get(w,d.payload.shipmentId,'shipment');if(d.adapter==='ERP')check(Array.isArray(d.payload.entryIds)&&d.payload.entryIds.every(x=>get(w,x,'ledger')),'INVALID_ENTRIES');if(d.adapter==='MAPS')check(Array.isArray(d.payload.locations)&&d.payload.locations.length,'INVALID_LOCATIONS');return enqueue(w,p,d);},
  outbox_process:(w,p,d)=>{const m=get(w,d.id,'outbox');version(m,d);check(['PENDING','RETRY'].includes(m.status),'RECONCILE_OR_DLQ_REQUIRED',409);m.attempts++;if(['BEFORE_FAILURE','UNAVAILABLE'].includes(m.mode))return update(m,{status:m.attempts>=3?'DLQ':'RETRY',effect:'NONE'});const result={status:m.mode==='REJECT'?'REJECTED':'APPLIED',messageId:m.messageId,protocol:`SIM-${m.messageId}`,adapter:m.adapter,real:false};w.mockEffects[m.messageId]||=result;if(m.mode==='LOST_RESPONSE')return update(m,{status:'UNKNOWN',effect:'UNKNOWN'});return applyEffect(w,p,m,w.mockEffects[m.messageId]);},
  outbox_query:(w,p,d)=>{const m=get(w,d.id,'outbox');version(m,d);check(m.status==='UNKNOWN','UNKNOWN_REQUIRED');const result=w.mockEffects[m.messageId];check(result,'EFFECT_NOT_RECONCILED',409);return applyEffect(w,p,m,result);},
  outbox_requeue:(w,p,d)=>{const m=get(w,d.id,'outbox');version(m,d);check(m.status==='DLQ'&&m.effect==='NONE','PROVEN_NO_EFFECT_REQUIRED');check(['GOOD','BEFORE_FAILURE','UNAVAILABLE'].includes(d.mode),'INVALID_MODE');m.history||=[];m.history.push({at:w.clock,from:'DLQ',reason:text(d.reason),attempts:m.attempts});return update(m,{status:'PENDING',mode:d.mode});},
  inbox_receive:(w,p,d)=>{const eventId=text(d.eventId),prior=w.inbox.find(x=>x.eventId===eventId);if(prior){check(prior.requestHash===canonical(d),'INBOX_EVENT_CONFLICT',409);return prior;}check(['TRACKING','WMS','ERP_ACK'].includes(d.type),'INVALID_INBOX_TYPE');let result;if(d.type==='TRACKING')result=handlers.tracking(w,p,d.payload);else if(d.type==='WMS'){const s=get(w,d.payload.shipmentId,'shipment');result=update(s,{wmsCustody:d.payload.custody});}else result=add(w,p,'reconciliation',{entryIds:d.payload.entryIds||[],reference:d.payload.reference,status:'CONFIRMED_MOCK_ONLY'});const event={id:id('inbox'),eventId,type:d.type,requestHash:canonical(d),receivedAt:w.clock,resultId:result.id,status:'APPLIED_SIMULATION',simulation:true};w.inbox.push(event);add(w,p,'inboxEvent',event);return event;},
  fiscal_policy:(w,p,d)=>{check(d.mode==='DEMO_ONLY','SIMULATOR_ONLY');return add(w,p,'fiscalPolicy',{name:text(d.name),scenario:text(d.scenario),requirements:copy(d.requirements||[]),mode:'DEMO_ONLY',status:'PUBLISHED_IMMUTABLE'});},
  fiscal_evaluate:(w,p,d)=>{const s=current(w,p,d);version(s,d);check(s.status==='ASSIGNED','INVALID_STATE');if(!d.policyId||!d.scenario)return{status:'PENDING_DATA',missing:['policyId','scenario']};const policy=get(w,d.policyId,'fiscalPolicy');check(policy.scenario===d.scenario,'FISCAL_SCENARIO_MISMATCH');if(!(policy.requirements||[]).length){update(s,{fiscalStatus:'DEMO_NOT_REQUIRED'});return{status:'DEMO_NOT_REQUIRED',real:false};}const doc=add(w,p,'fiscalDocument',{shipmentId:s.id,policySnapshot:copy(policy),scenario:d.scenario,status:'PENDING',real:false});update(s,{fiscalStatus:'PENDING'});doc.outboxId=enqueue(w,p,{adapter:'FISCAL',payload:{shipmentId:s.id,documentId:doc.id,schema:'DEMO_ENVELOPE_1',scenario:d.scenario},mode:d.mode||'GOOD',targetId:doc.id,purpose:'FISCAL'}).id;return doc;},
  fiscal_cancel:(w,p,d)=>{const f=get(w,d.id,'fiscalDocument');version(f,d);const s=get(w,f.shipmentId,'shipment');check(f.status==='DEMO_AUTHORIZED'&&s.status==='ASSIGNED','FISCAL_CANCEL_BLOCKED');update(s,{fiscalStatus:'DEMO_CANCELLED'});return update(f,{status:'DEMO_CANCELLED',reason:text(d.reason)});},
  fiscal_profile_create:(w,p,d)=>add(w,p,'fiscalProfile',{...profileValues(d),profileRevision:1}),
  fiscal_profile_revise:(w,p,d)=>{check(Object.keys(d).every(x=>['id','version','values','reason'].includes(x)),'FISCAL_REVISION_FIELDS');const old=get(w,d.id,'fiscalProfile');version(old,d);check(!list(w,'fiscalProfile').some(x=>x.supersedes===old.id),'FISCAL_REVISION_EXISTS',409);return add(w,p,'fiscalProfile',{...profileValues(d.values),profileRevision:(old.profileRevision||1)+1,supersedes:old.id,revisionReason:text(d.reason)});},
  fiscal_readiness_assess:(w,p,d)=>{check(Object.keys(d).every(x=>x==='profileId'),'FISCAL_ASSESSMENT_FIELDS');const profile=get(w,d.profileId,'fiscalProfile');return add(w,p,'fiscalReadiness',{profileId:profile.id,profileRevision:profile.profileRevision,profileSnapshot:copy(profile),...assessProfile(profile)});},
  fiscal_local_preflight:(w,p,d)=>{check(Object.keys(d).every(x=>['profileId','document','operation','businessReference','requestReference'].includes(x)),'FISCAL_PREFLIGHT_FIELDS');const profile=get(w,d.profileId,'fiscalProfile'),assessment=assessProfile(profile);check(assessment.readyForLocalTest,'FISCAL_PROFILE_INCOMPLETE',409);check(profile.documents.includes(d.document),'FISCAL_DOCUMENT_NOT_CONFIGURED');check(['QUERY','ISSUE','CANCEL','CLOSE'].includes(d.operation),'FISCAL_OPERATION');check(d.operation!=='CLOSE'||['MDFE','CIOT'].includes(d.document),'FISCAL_CLOSE_NOT_APPLICABLE');check(d.document!=='NFE_REFERENCE'||d.operation==='QUERY','NFE_IS_EXTERNAL_REFERENCE');text(d.businessReference);text(d.requestReference);check(!list(w,'fiscalPreflight').some(x=>x.requestReference===d.requestReference),'FISCAL_REQUEST_EXISTS');const envelope={contract:'FISCAL_PREPARATION_1',profileId:profile.id,profileRevision:profile.profileRevision,profileSnapshot:copy(profile),document:d.document,operation:d.operation,businessReference:d.businessReference,requestReference:d.requestReference,environment:profile.environment,route:profile.route,format:'LOCAL_PREPARATION_ENVELOPE_NOT_OFFICIAL_XML',realOperationAllowed:false};return add(w,p,'fiscalPreflight',{profileId:profile.id,profileRevision:profile.profileRevision,profileSnapshot:copy(profile),requestReference:d.requestReference,envelope,status:profile.route==='LOCAL_MOCK'?'DEMO_PREPARED':'PREPARED_EXTERNAL_BLOCKED',protocol:profile.route==='LOCAL_MOCK'?id('SIM-FISCAL'):null,realConnectionEnabled:false,realOperationAllowed:false,liveTransmissionEnabled:false,productionReady:false,externalGates:assessment.externalGates});},
  backup:(w,p,d)=>({status:'SIMULATION_EXPORT_READY',format:'ZIP',href:'/api/backup',simulation:true}),
  simulation_reset:(w,p,d)=>{throw new ApiError('CREATE_NEW_WORKSPACE_INSTEAD',409,'Crie outro cenário pelo seletor público; o cenário atual não foi apagado.');}
});
export async function fingerprintRequest(command,payload){
  const bytes=new TextEncoder().encode(canonical({command,payload})),digest=await crypto.subtle.digest('SHA-256',bytes);return 'sha256:'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
export function executeCommand(workspace, persona, command, payload, key, now = new Date().toISOString(), requestFingerprint) {
  check(COMMANDS.includes(command)&&typeof handlers[command]==='function','COMMAND_NOT_FOUND',404);check(payload&&typeof payload==='object'&&!Array.isArray(payload),'JSON_OBJECT_REQUIRED');text(key);
  const p=choosePersona(workspace,typeof persona==='string'?persona:persona.id);check(roles[command].some(r=>p.roles.includes(r)),'SIMULATION_ROLE_NOT_AVAILABLE',409);
  const fingerprint=requestFingerprint||canonical({command,payload}),cacheKey=`${p.id}:${key}`,old=workspace.idempotency[cacheKey];if(old){check(old.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT',409);return{workspace:copy(workspace),result:copy(old.result),replayed:true};}
  check(Object.keys(workspace.idempotency).length<600,'SIMULATION_OPERATION_LIMIT',413);
  const draft=copy(workspace);draft.clock=timestamp(now);const result=handlers[command](draft,p,copy(payload));
  draft.audit.push({id:id('audit'),at:draft.clock,persona:p.username,command,resultId:result?.id||null,simulation:true});draft.idempotency[cacheKey]={fingerprint,result:copy(result)};
  return {workspace:draft,result:copy(result),replayed:false};
}
export function kpis(w,p){
  const ships=stateFor(w,p).objects.filter(x=>x.kind==='shipment'&&x.status!=='CANCELLED'),orders=list(w,'order').filter(x=>x.org===p.org&&x.status!=='CANCELLED'),done=ships.filter(s=>s.status==='DELIVERED'),evaluated=done.filter(s=>s.completedAt&&s.promisedAt),onTime=evaluated.filter(s=>new Date(s.completedAt)<=new Date(s.promisedAt)),late=evaluated.filter(s=>!onTime.includes(s)),paired=orders.filter(o=>o.candidate?.cost!==undefined&&o.consumerCharge!==undefined),costs=orders.filter(o=>o.candidate?.cost!==undefined),charges=orders.filter(o=>o.consumerCharge!==undefined);
  return{scopeOrg:p.org,shipments:{delivered:done.length,total:ships.length,ids:ships.map(s=>s.id)},packages:{delivered:ships.reduce((n,s)=>n+(s.delivered||[]).length,0),total:ships.reduce((n,s)=>n+s.packages.length,0)},onTime:{numerator:onTime.length,denominator:evaluated.length,deliveredMissingPromiseOrActual:done.length-evaluated.length,ids:evaluated.map(x=>x.id),onTimeIds:onTime.map(x=>x.id),lateIds:late.map(x=>x.id),missingIds:done.filter(x=>!evaluated.includes(x)).map(x=>x.id)},commercial:{cost:costs.length?cash(costs.reduce((n,o)=>n+Number(o.candidate.cost),0)):null,costCoverage:costs.length,charge:charges.length?cash(charges.reduce((n,o)=>n+Number(o.consumerCharge),0)):null,chargeCoverage:charges.length,orderDenominator:orders.length,subsidyPaired:paired.length?cash(paired.reduce((n,o)=>n+Number(o.candidate.cost)-Number(o.consumerCharge),0)):null,pairedCoverage:paired.length},definitionsVersion:'PUBLIC_SIMULATION_1',assistance:{mode:'DETERMINISTIC_NO_ACTION',suggestions:done.length>evaluated.length?['Verificar entregas sem promessa']:['Sem lacuna de promessa nas entregas avaliadas']}};
}
