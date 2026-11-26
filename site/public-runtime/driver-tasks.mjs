/** Public fictional simulation bridge. Dependencies are the EXISTING domain helpers.
 * No authentication or external provider equivalence is asserted. */
export function createDriverTaskHandlers({get,update,check,text,copy,canonical}) {
 const keys=value=>{check(Array.isArray(value)&&value.length&&value.every(x=>typeof x==='string'&&x)&&new Set(value).size===value.length,'INVALID_PACKAGES');return [...value].sort();};
 const same=(a,b)=>canonical(keys(a))===canonical(keys(b));
 const point=value=>{check(value&&typeof value==='object'&&typeof value.postalCode==='string'&&/^\d{8}$/.test(value.postalCode),'POINT_UNKNOWN',409);return Object.fromEntries(['name','postalCode','lat','lon','addressLine','number','complement','district','city','uf','deliveryInstructions'].filter(k=>value[k]!==undefined).map(k=>[k,copy(value[k])]));};
 const assigned=(s,p)=>{check([s.carrierOrg,s.subcontractorOrg].includes(p.org),'ASSIGNED_CARRIER_REQUIRED',403);if(p.roles.includes('driver'))check(s.driverUserId===p.id,'TASK_ASSIGNMENT_CHANGED',409);};
 const version=(object,d)=>check(Number.isSafeInteger(d.version)&&d.version===object.version,'VERSION_CONFLICT',409);
 return {
  pickup_confirm(w,p,d){
   const s=get(w,d.shipmentId,'shipment');assigned(s,p);text(d.eventId);check(d.planVersion===s.planVersion&&d.assignmentId===s.assignmentId,'TASK_CONTEXT_CHANGED',409);
   const matches=(s.pickupStops||[]).filter(x=>x.stopId===d.stopId);check(matches.length===1&&matches[0].type==='PICKUP','PICKUP_STOP_UNKNOWN',409);const stop=matches[0];point(stop.originSnapshot);check(same(d.packageKeys,stop.packageKeys),'PICKUP_VOLUMES_MISMATCH',409);
   check(d.packageKeys.every(key=>s.packages.some(pack=>pack.key===key&&pack.orderId===stop.orderId)),'PICKUP_VOLUMES_MISMATCH',409);
   const old=(s.pickupReceipts||[]).find(x=>x.eventId===d.eventId);if(old){check(old.hash===canonical(d)&&old.actor===p.id,'TASK_EVENT_CONFLICT',409);return copy(old);}
   version(s,d);check(s.status==='ASSIGNED','PICKUP_ALREADY_STARTED',409);check(!(s.pickupReceipts||[]).some(x=>x.planVersion===s.planVersion&&x.assignmentId===s.assignmentId&&x.packageKeys.some(key=>d.packageKeys.includes(key))),'PICKUP_ALREADY_CONFIRMED',409);
   const receipt={eventId:d.eventId,hash:canonical(d),stopId:stop.stopId,orderId:stop.orderId,packageKeys:copy(d.packageKeys),planVersion:s.planVersion,assignmentId:s.assignmentId,actor:p.id,receivedAt:w.clock,status:'CONFIRMED',evidence:'DECLARED_LOCAL_NOT_PHYSICAL'};
   update(s,{pickupReceipts:[...(s.pickupReceipts||[]),receipt]});return copy(receipt);
  },
  return_assign(w,p,d){
   const r=get(w,d.id,'return');check(r.org===p.org,'RETURN_OWNER_REQUIRED',403);version(r,d);check(r.status==='AUTHORIZED','RETURN_ASSIGNMENT_CLOSED',409);
   const s=get(w,r.shipmentId,'shipment');check(s.org===r.org,'RETURN_PARENT_MISMATCH',409);const driver=text(s.driverUserId),selected=s.packages.filter(pack=>keys(r.packageKeys).includes(pack.key)),orders=[...new Set(selected.map(pack=>pack.orderId))];
   check(orders.length===1&&orders[0]&&selected.length===r.packageKeys.length,'RETURN_ORDER_AMBIGUOUS',409);const o=get(w,orders[0],'order'),source=point(o.destinationSnapshot),reason=text(d.reason),start=new Date(d.windowStart),end=new Date(d.windowEnd);
   check(Number.isFinite(+start)&&Number.isFinite(+end)&&/([zZ]|[+-]\d{2}:\d{2})$/.test(d.windowStart)&&/([zZ]|[+-]\d{2}:\d{2})$/.test(d.windowEnd)&&start<end,'INVALID_WINDOW');
   let destination,reference;
   if(d.destinationLocationId){const loc=get(w,d.destinationLocationId,'location');check(loc.org===p.org,'RETURN_OWNER_REQUIRED',403);destination=point(loc);reference=loc.id;}
   else{const stops=(s.pickupStops||[]).filter(stop=>stop.orderId===orders[0]&&stop.type==='PICKUP');check(stops.length===1,'RETURN_DESTINATION_UNKNOWN',409);destination=point(stops[0].originSnapshot);reference=stops[0].stopId;}
   const previous=Object.fromEntries(['taskId','taskVersion','driverUserId','sourceSnapshot','destinationSnapshot','windowStart','windowEnd'].filter(k=>r[k]!==undefined).map(k=>[k,copy(r[k])])),taskId=r.taskId||`return-task-${r.id}`,taskVersion=(r.taskVersion||0)+1;
   return update(r,{taskId,taskVersion,driverUserId:driver,orderId:orders[0],sourceSnapshot:source,destinationSnapshot:destination,destinationReference:reference,windowStart:start.toISOString(),windowEnd:end.toISOString(),taskReason:reason,history:[...(r.history||[]),{event:'TASK_ASSIGNED',taskId,taskVersion,previous,actor:p.id,at:w.clock}]});
  },
  driver_return_collect(w,p,d){
   const r=get(w,d.id,'return'),s=get(w,r.shipmentId,'shipment');assigned(s,p);check(r.driverUserId&&r.driverUserId===s.driverUserId,'TASK_ASSIGNMENT_CHANGED',409);check(r.taskId&&d.taskId===r.taskId,'TASK_CONTEXT_CHANGED',409);text(d.eventId);
   check(same(d.packageKeys,r.packageKeys),'RETURN_VOLUMES_MISMATCH',409);point(r.sourceSnapshot);point(r.destinationSnapshot);
   const old=(r.collectionReceipts||[]).find(x=>x.eventId===d.eventId);if(old){check(old.hash===canonical(d)&&old.actor===p.id,'TASK_EVENT_CONFLICT',409);return copy(old);}
   version(r,d);check(r.status==='AUTHORIZED','INVALID_RETURN_TRANSITION',409);
   const receipt={eventId:d.eventId,hash:canonical(d),taskId:r.taskId,taskVersion:r.taskVersion,packageKeys:copy(d.packageKeys),actor:p.id,receivedAt:w.clock,status:'CONFIRMED',evidence:'DECLARED_LOCAL_NOT_PHYSICAL'};
   update(r,{status:'COLLECTED',collectionReceipts:[...(r.collectionReceipts||[]),receipt],history:[...(r.history||[]),{from:'AUTHORIZED',to:'COLLECTED',at:w.clock,user:p.id,eventId:d.eventId}]});return copy(receipt);
  }
 };
}
