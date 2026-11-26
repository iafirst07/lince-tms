/* Local appointment simulation; timezone metadata never infers physical presence. */
const ACTIVE=new Set(['RESERVED','CHECKED_IN']);
function instant(value,check){
  check(typeof value==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value),'TIMEZONE_REQUIRED');
  const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/),[y,m,d,h,min,sec]=parts.slice(1).map(x=>Number(x||0));
  const maxDay=new Date(Date.UTC(y,m,0)).getUTCDate();
  check(m>=1&&m<=12&&d>=1&&d<=maxDay&&h<24&&min<60&&sec<60&&Number.isFinite(Date.parse(value)),'INVALID_DOCK_TIME');
  return new Date(value).toISOString();
}
export function calcOverlapCapacity(rows,start,end,units,excludeId=null){
  const a=Date.parse(start),b=Date.parse(end);if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b||!Number.isInteger(units)||units<1)throw new Error('INVALID_DOCK_INTERVAL');
  const events=[[a,units],[b,-units]];
  for(const row of rows){if(row.id===excludeId||!ACTIVE.has(row.status))continue;const x=Math.max(a,Date.parse(row.start)),y=Math.min(b,Date.parse(row.end));if(x<y)events.push([x,row.units],[y,-row.units]);}
  let current=0,peak=0;for(const[,delta]of events.sort((x,y)=>x[0]-y[0]||x[1]-y[1])){current+=delta;peak=Math.max(peak,current);}return peak;
}
export function createDockHandlers({get,list,add,check,text,copy}){
  const integer=(v,min,max,code)=>{check(Number.isInteger(v)&&v>=min&&v<=max,code);return v;};
  const label=v=>{check(typeof v==='string'&&v.length<=128&&v.trim().length,'INVALID_DOCK_TEXT');return text(v);};
  const interval=(a,b)=>{a=instant(a,check);b=instant(b,check);check(Date.parse(a)<Date.parse(b),'INVALID_DOCK_INTERVAL');return[a,b];};
  const own=(w,p,id,kind)=>{const row=get(w,id,kind);check(row.org===p.org,'OWNER_REQUIRED',403);return row;};
  const capacity=(w,dock,start,end,units,id)=>check(calcOverlapCapacity(list(w,'dockReservation').filter(r=>r.dockId===dock.id),start,end,units,id)<=dock.capacity,'DOCK_CAPACITY_CONFLICT',409);
  const transact=(w,fn)=>{const draft=copy(w),result=fn(draft);w.objects=draft.objects;return result;};
  return {
    dock_create:(w,p,d)=>transact(w,draft=>{const location=own(draft,p,d.locationId,'location');return add(draft,p,'dock',{locationId:location.id,locationSnapshot:copy(location),name:label(d.name),capacity:integer(d.capacity,1,20,'INVALID_DOCK_CAPACITY'),timezone:label(d.timezone),timezoneRole:'METADATA_ONLY_OFFSET_IS_AUTHORITATIVE',simulation:true});}),
    dock_reserve:(w,p,d)=>transact(w,draft=>{const dock=own(draft,p,d.dockId,'dock'),[start,end]=interval(d.start,d.end),units=integer(d.units,1,dock.capacity,'INVALID_DOCK_UNITS'),reference=label(d.reference),shipment=d.shipmentId===undefined||d.shipmentId===null?null:own(draft,p,d.shipmentId,'shipment');capacity(draft,dock,start,end,units);return add(draft,p,'dockReservation',{dockId:dock.id,dockSnapshot:copy(dock),locationSnapshot:copy(dock.locationSnapshot),shipmentId:shipment?.id||null,reference,start,end,units,status:'RESERVED',simulation:true,history:[{status:'RESERVED',start,end,at:draft.clock,actor:p.id}]});}),
    dock_reschedule:(w,p,d)=>transact(w,draft=>{const row=own(draft,p,d.id,'dockReservation');check(d.version===row.version,'VERSION_CONFLICT',409);check(row.status==='RESERVED','DOCK_RESCHEDULE_BLOCKED',409);const reason=label(d.reason),[start,end]=interval(d.start,d.end),dock=own(draft,p,row.dockId,'dock');capacity(draft,dock,start,end,row.units,row.id);row.history.push({status:'RESCHEDULED',previousStart:row.start,previousEnd:row.end,start,end,reason,actor:p.id,at:draft.clock});Object.assign(row,{start,end,version:row.version+1});return row;}),
    dock_progress:(w,p,d)=>transact(w,draft=>{const row=own(draft,p,d.id,'dockReservation');check(d.version===row.version,'VERSION_CONFLICT',409);const reason=label(d.reason),allowed={RESERVED:['CHECKED_IN','CANCELLED','NO_SHOW'],CHECKED_IN:['CHECKED_OUT']};check(allowed[row.status]?.includes(d.status),'INVALID_DOCK_TRANSITION',409);if(d.status==='NO_SHOW')check(Date.parse(draft.clock)>=Date.parse(row.end),'DOCK_NO_SHOW_TOO_EARLY',409);row.history.push({status:d.status,previousStatus:row.status,reason,actor:p.id,at:draft.clock});Object.assign(row,{status:d.status,version:row.version+1});return row;})
  };
}
