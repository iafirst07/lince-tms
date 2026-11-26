"""L5 local task bridge. Engine owns session, transaction, idempotency and registration.
No provider, physical scan, fiscal release, original delivery mutation or new store.
"""
import copy
from core import action,require,ident,sha,moment

def _keys(values):
    require(isinstance(values,list) and values and all(isinstance(x,str) and x for x in values) and len(values)==len(set(values)),'INVALID_PACKAGES')
    return set(values)
def _point(source):
    require(isinstance(source,dict) and isinstance(source.get('postalCode'),str) and len(source['postalCode'])==8 and source['postalCode'].isdigit(),'POINT_UNKNOWN',409)
    fields=['name','postalCode','lat','lon','addressLine','number','complement','district','city','uf','deliveryInstructions']
    return {k:copy.deepcopy(source[k]) for k in fields if k in source}
def _assigned_actor(s,p):
    require(p['org'] in [s.get('carrierOrg'),s.get('subcontractorOrg')],'ASSIGNED_CARRIER_REQUIRED',403)
    if 'driver' in p.get('roles',[]):require(s.get('driverUserId')==p['id'],'TASK_ASSIGNMENT_CHANGED',409)

class DriverTasks:
    @action('admin','operator','driver')
    def cmd_pickup_confirm(self,db,p,d):
        s=copy.deepcopy(self.assigned(db,p,d));_assigned_actor(s,p);eid=ident(d.get('eventId'))
        require(d.get('planVersion')==s['planVersion'] and d.get('assignmentId')==s.get('assignmentId'),'TASK_CONTEXT_CHANGED',409)
        stops=[x for x in s.get('pickupStops',[]) if x.get('stopId')==d.get('stopId')]
        require(len(stops)==1 and stops[0].get('type')=='PICKUP','PICKUP_STOP_UNKNOWN',409);stop=stops[0];_point(stop.get('originSnapshot'))
        require(_keys(d.get('packageKeys'))==_keys(stop.get('packageKeys')),'PICKUP_VOLUMES_MISMATCH',409)
        require(all(any(pac['key']==key and pac.get('orderId')==stop.get('orderId') for pac in s['packages']) for key in d['packageKeys']),'PICKUP_VOLUMES_MISMATCH',409)
        old=next((x for x in s.get('pickupReceipts',[]) if x['eventId']==eid),None)
        if old:require(old['hash']==sha(d) and old['actor']==p['id'],'TASK_EVENT_CONFLICT',409);return old
        self.version(s,d);require(s['status']=='ASSIGNED','PICKUP_ALREADY_STARTED',409)
        require(not any(x.get('planVersion')==s['planVersion'] and x.get('assignmentId')==s['assignmentId'] and set(x['packageKeys'])&set(d['packageKeys']) for x in s.get('pickupReceipts',[])),'PICKUP_ALREADY_CONFIRMED',409)
        receipt={'eventId':eid,'hash':sha(d),'stopId':stop['stopId'],'orderId':stop['orderId'],'packageKeys':copy.deepcopy(d['packageKeys']),'planVersion':s['planVersion'],'assignmentId':s['assignmentId'],'actor':p['id'],'receivedAt':self.now().isoformat(),'status':'CONFIRMED','evidence':'DECLARED_LOCAL_NOT_PHYSICAL'}
        s.setdefault('pickupReceipts',[]).append(receipt);self.save(db,s);return receipt

    @action('admin','operator')
    def cmd_return_assign(self,db,p,d):
        r=copy.deepcopy(self.get(db,p,d.get('id'),'return',True));self.version(r,d);require(r['org']==p['org'],'RETURN_OWNER_REQUIRED',403);require(r['status']=='AUTHORIZED','RETURN_ASSIGNMENT_CLOSED',409)
        s=self.get(db,p,r['shipmentId'],'shipment');require(s['org']==r['org'],'RETURN_PARENT_MISMATCH',409);driver=ident(s.get('driverUserId'));keys=_keys(r['packageKeys']);orders={pac.get('orderId') for pac in s['packages'] if pac['key'] in keys}
        require(len(orders)==1 and None not in orders and len([pac for pac in s['packages'] if pac['key'] in keys])==len(keys),'RETURN_ORDER_AMBIGUOUS',409)
        order_id=next(iter(orders));o=self.get(db,p,order_id,'order');source=_point(o.get('destinationSnapshot'));reason=ident(d.get('reason'))
        start=moment(d.get('windowStart'));end=moment(d.get('windowEnd'));require(start<end,'INVALID_WINDOW')
        if d.get('destinationLocationId'):
            loc=self.get(db,p,d['destinationLocationId'],'location',True);destination=_point(loc);destination_ref=loc['id']
        else:
            stops=[x for x in s.get('pickupStops',[]) if x.get('orderId')==order_id and x.get('type')=='PICKUP']
            require(len(stops)==1,'RETURN_DESTINATION_UNKNOWN',409);destination=_point(stops[0].get('originSnapshot'));destination_ref=stops[0]['stopId']
        previous={k:copy.deepcopy(r[k]) for k in ['taskId','taskVersion','driverUserId','sourceSnapshot','destinationSnapshot','windowStart','windowEnd'] if k in r}
        task_id=r.get('taskId') or 'return-task-'+r['id'];task_version=r.get('taskVersion',0)+1
        r.update(taskId=task_id,taskVersion=task_version,driverUserId=driver,orderId=order_id,sourceSnapshot=source,destinationSnapshot=destination,destinationReference=destination_ref,windowStart=start.isoformat(),windowEnd=end.isoformat(),taskReason=reason)
        r.setdefault('history',[]).append({'event':'TASK_ASSIGNED','taskId':task_id,'taskVersion':task_version,'previous':previous,'actor':p['id'],'at':self.now().isoformat()});return self.save(db,r)

    @action('admin','operator','driver')
    def cmd_driver_return_collect(self,db,p,d):
        r=copy.deepcopy(self.get(db,p,d.get('id'),'return'));s=self.get(db,p,r['shipmentId'],'shipment');_assigned_actor(s,p)
        require(r.get('driverUserId')==s.get('driverUserId') and r.get('driverUserId'),'TASK_ASSIGNMENT_CHANGED',409)
        require(d.get('taskId')==r.get('taskId') and r.get('taskId'),'TASK_CONTEXT_CHANGED',409);eid=ident(d.get('eventId'))
        require(_keys(d.get('packageKeys'))==_keys(r['packageKeys']),'RETURN_VOLUMES_MISMATCH',409);_point(r.get('sourceSnapshot'));_point(r.get('destinationSnapshot'))
        old=next((x for x in r.get('collectionReceipts',[]) if x['eventId']==eid),None)
        if old:require(old['hash']==sha(d) and old['actor']==p['id'],'TASK_EVENT_CONFLICT',409);return old
        self.version(r,d);require(r['status']=='AUTHORIZED','INVALID_RETURN_TRANSITION',409)
        receipt={'eventId':eid,'hash':sha(d),'taskId':r['taskId'],'taskVersion':r['taskVersion'],'packageKeys':copy.deepcopy(d['packageKeys']),'actor':p['id'],'receivedAt':self.now().isoformat(),'status':'CONFIRMED','evidence':'DECLARED_LOCAL_NOT_PHYSICAL'}
        r.setdefault('collectionReceipts',[]).append(receipt);r.setdefault('history',[]).append({'from':'AUTHORIZED','to':'COLLECTED','at':self.now().isoformat(),'user':p['id'],'eventId':eid});r['status']='COLLECTED';self.save(db,r);return receipt
