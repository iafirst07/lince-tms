"""Order, routing, procurement, resources and execution workflows."""
import copy,math
from datetime import timedelta
from decimal import Decimal
from core import action,require,Error,ident,dec,cash,moment,sha
from catalog import packages,cep

def overlap(a,b,c,d):return moment(a)<moment(d) and moment(c)<moment(b)

def delivery_snapshot(location):
    keys=['name','postalCode','lat','lon','addressLine','number','complement','district','city','uf','deliveryInstructions']
    return {k:copy.deepcopy(location[k]) for k in keys if k in location}

class Operations:
    def order_values(self,db,p,d):
        q=self.get(db,p,d.get('quoteId'),'quote',True);require(self.now()<moment(q['expiresAt']),'QUOTE_EXPIRED',409)
        index=d.get('candidate',0);require(isinstance(index,int) and 0<=index<len(q['candidates']),'INVALID_CANDIDATE');candidate=q['candidates'][index]
        packs=packages(d.get('packages'));require(packs==q['packages'],'QUOTE_CONTENT_MISMATCH',409)
        require(not any(x['org']==p['org'] and x['externalId']==d.get('externalId') and x['status']!='CANCELLED' for x in self.all(db,'order')),'DUPLICATE_ORDER',409)
        location=self.get(db,p,d.get('locationId'),'location',True);require(location['postalCode']==q['destinationCep'],'DESTINATION_MISMATCH')
        require(moment(d.get('windowStart'))<moment(d.get('windowEnd')),'INVALID_WINDOW')
        cost=candidate['cost'];charge=cash(dec(d.get('consumerCharge')))
        return {'externalId':ident(d.get('externalId')),'quoteId':q['id'],'candidate':candidate,'packages':packs,'originCep':q['originCep'],'destinationCep':q['destinationCep'],'locationId':location['id'],'destinationSnapshot':delivery_snapshot(location),'windowStart':d['windowStart'],'windowEnd':d['windowEnd'],'consumerCharge':charge,'subsidy':cash(Decimal(cost)-Decimal(charge)),'snapshotHash':q['snapshotHash'],'contentVersion':1,'status':'VALIDATED','shipmentIds':[],'revisions':[]}
    @action('admin','planner','operator')
    def cmd_order_create(self,db,p,d):return self.add(db,p,'order',self.order_values(db,p,d))
    @action('admin','planner','operator')
    def cmd_import_preview(self,db,p,d):
        rows=d.get('rows');require(isinstance(rows,list) and 0<len(rows)<=200,'INVALID_ROWS');out=[];seen=set()
        for i,row in enumerate(rows):
            try:
                val=self.order_values(db,p,row);require(val['externalId'] not in seen,'DUPLICATE_IN_IMPORT');seen.add(val['externalId']);out.append({'line':i+1,'valid':True,'input':row})
            except (Error,KeyError,TypeError) as e:out.append({'line':i+1,'valid':False,'error':getattr(e,'code','INVALID_ROW'),'input':row})
        return self.add(db,p,'import',{'rows':out,'status':'PREVIEW','valid':sum(x['valid'] for x in out),'errors':sum(not x['valid'] for x in out)})
    @action('admin','planner','operator')
    def cmd_import_commit(self,db,p,d):
        imp=self.get(db,p,d.get('id'),'import',True);self.version(imp,d);require(imp['status']=='PREVIEW','ALREADY_COMMITTED',409)
        require(not imp['errors'] or d.get('validOnly') is True,'IMPORT_HAS_ERRORS')
        ids=[]
        for row in imp['rows']:
            if row['valid']:ids.append(self.cmd_order_create(db,p,row['input'])['id'])
        imp.update(status='COMMITTED',orderIds=ids);return self.save(db,imp)
    @action('admin','planner')
    def cmd_order_release(self,db,p,d):
        o=self.get(db,p,d.get('id'),'order',True);self.version(o,d);require(o['status']=='VALIDATED','INVALID_STATE',409)
        q=self.get(db,p,o['quoteId'],'quote',True);require(self.now()<moment(q['expiresAt']) and q['snapshotHash']==o['snapshotHash'],'QUOTE_STALE',409)
        o['status']='RELEASED';return self.save(db,o)
    @action('admin','planner')
    def cmd_order_change(self,db,p,d):
        o=self.get(db,p,d.get('id'),'order',True);self.version(o,d)
        require(d.get('operation') in ['EDIT','CANCEL'],'INVALID_OPERATION')
        active=[s for s in self.all(db,'shipment') if o['id'] in s['orderIds'] and s['status']!='CANCELLED']
        executed=any(s['status'] in ['IN_TRANSIT','PARTIAL','DELIVERED'] for s in active)
        if executed or any(s.get('assignmentId') for s in active):
            return self.add(db,p,'change',{'orderId':o['id'],'orderVersion':o['version'],'operation':d['operation'],'newValues':d.get('values',{}),'status':'COMPENSATION_REQUIRED' if executed else 'APPROVAL_REQUIRED','affectedShipments':[s['id'] for s in active],'reason':ident(d.get('reason'))})
        return self.apply_order_change(db,p,o,d['operation'],d.get('values',{}),active)
    def apply_order_change(self,db,p,o,operation,values,ships):
        before=copy.deepcopy(o);before.pop('revisions',None)
        for s in ships:
            s['status']='CANCELLED';self.save(db,s)
            if s.get('assignmentId'):
                assignment=self.get(db,p,s['assignmentId'],'assignment',True);assignment['status']='CANCELLED';self.save(db,assignment)
            for sibling_id in s['orderIds']:
                if sibling_id==o['id']:continue
                sibling=self.get(db,p,sibling_id,'order',True)
                sibling['shipmentIds']=[sid for sid in sibling['shipmentIds'] if sid!=s['id']]
                sibling['status']='PLANNED' if sibling['shipmentIds'] else 'RELEASED'
                self.save(db,sibling)
            for t in self.all(db,'tender'):
                if t['shipmentId']==s['id'] and t['status']=='OPEN':t['status']='CANCELLED';self.save(db,t)
            for r in self.all(db,'reservation'):
                if r['shipmentId']==s['id'] and r['status']=='ACTIVE':r['status']='RELEASED';self.save(db,r)
        o['revisions'].append(before);o['contentVersion']+=1;o['shipmentIds']=[]
        if operation=='CANCEL':o['status']='CANCELLED'
        else:
            require('quoteId' in values,'RECOTATION_REQUIRED')
            # Exclude this identity from duplicate checking while validating its replacement.
            oldstatus=o['status'];o['status']='CANCELLED';db.execute('UPDATE objects SET data=? WHERE id=?',(__import__('core').canonical(o),o['id']))
            nv=self.order_values(db,p,{**values,'externalId':o['externalId']});o.update({k:v for k,v in nv.items() if k not in ['revisions','contentVersion']})
        return self.save(db,o)
    @action('admin','planner')
    def cmd_change_resolve(self,db,p,d):
        c=self.get(db,p,d.get('id'),'change',True);self.version(c,d);require(c['status'] in ['APPROVAL_REQUIRED','COMPENSATION_REQUIRED'],'INVALID_STATE')
        o=self.get(db,p,c['orderId'],'order',True);require(o['version']==c['orderVersion'],'ORDER_CHANGED',409)
        if c['status']=='COMPENSATION_REQUIRED':
            c['resolution']=ident(d.get('resolution'));c['status']='COMPENSATED_HISTORY_PRESERVED';self.add(db,p,'compensation',{'changeId':c['id'],'orderId':o['id'],'resolution':c['resolution'],'originalPreserved':True})
        else:
            ships=[self.get(db,p,s,'shipment',True) for s in c['affectedShipments']];require(all(s['status'] not in ['IN_TRANSIT','PARTIAL','DELIVERED'] for s in ships),'EXECUTION_STARTED',409)
            self.apply_order_change(db,p,o,c['operation'],c['newValues'],ships);c['status']='APPLIED'
        return self.save(db,c)
    def plan_calculate(self,db,p,d):
        ids=d.get('orderIds');require(isinstance(ids,list) and ids and len(ids)==len(set(ids)),'INVALID_ORDERS')
        orders=[self.get(db,p,i,'order',True) for i in ids];require(all(o['status']=='RELEASED' for o in orders),'ORDER_NOT_RELEASED')
        for o in orders:require(self.now()<moment(self.get(db,p,o['quoteId'],'quote',True)['expiresAt']),'QUOTE_EXPIRED',409)
        packs=[{**x,'orderId':o['id'],'key':o['id']+':'+x['id']} for o in orders for x in o['packages']];weight=sum(dec(x['weightKg']) for x in packs)
        capacity=dec(d.get('capacityKg','100'),Decimal('.001'));reasons=[]
        if weight>capacity:reasons.append('CAPACITY_EXCEEDED')
        if len({x['cargoClass'] for x in packs})>1:reasons.append('CARGO_INCOMPATIBLE')
        start=moment(d.get('start'));speed=dec(d.get('speedKmh','40'),Decimal('1'));origin=self.get(db,p,d.get('originLocationId'),'location',True)
        pos=origin;clock=start;remaining=list(orders);stops=[];distance=0.0
        def km(a,b):return math.hypot((a['lat']-b['lat'])*111,(a['lon']-b['lon'])*111*math.cos(math.radians(a['lat'])))
        while remaining:
            selected=min(remaining,key=lambda o:(km(pos,o.get('destinationSnapshot') or self.get(db,p,o['locationId'],'location',True)),o['id']));loc=selected.get('destinationSnapshot') or self.get(db,p,selected['locationId'],'location',True);leg=km(pos,loc);distance+=leg;clock+=timedelta(hours=leg/float(speed));arrival=max(clock,moment(selected['windowStart']))
            if arrival>=moment(selected['windowEnd']):reasons.append('WINDOW_INFEASIBLE:'+selected['id'])
            stops.append({'orderId':selected['id'],'orderReference':selected['externalId'],'locationId':selected['locationId'],'destination':delivery_snapshot(loc),'windowStart':selected['windowStart'],'windowEnd':selected['windowEnd'],'arrival':arrival.isoformat(),'km':round(leg,3)});clock=arrival+timedelta(minutes=5);pos=loc;remaining.remove(selected)
        return {'orderIds':ids,'orderVersions':{o['id']:o['version'] for o in orders},'packages':packs,'weightKg':str(weight),'capacityKg':str(capacity),'start':start.isoformat(),'end':clock.isoformat(),'stops':stops,'distanceKm':round(distance,3),'reasons':reasons,'status':'INFEASIBLE' if reasons else 'FEASIBLE','cost':cash(sum(Decimal(o['candidate']['cost']) for o in orders)),'heuristic':'NEAREST_NEXT_SYNTHETIC_COORDINATES'}
    @action('admin','planner')
    def cmd_plan(self,db,p,d):return self.add(db,p,'plan',self.plan_calculate(db,p,d))
    @action('admin','planner')
    def cmd_plan_commit(self,db,p,d):
        plan=self.get(db,p,d.get('id'),'plan',True);self.version(plan,d);require(plan['status']=='FEASIBLE','PLAN_NOT_FEASIBLE',409)
        orders=[self.get(db,p,oid,'order',True) for oid in plan['orderIds']]
        require(all(o['status']=='RELEASED' and o['version']==plan['orderVersions'][o['id']] for o in orders),'PLAN_STALE',409)
        existing={x['key'] for s in self.all(db,'shipment') if s['status']!='CANCELLED' for x in s['packages']}
        require(not existing & {x['key'] for x in plan['packages']},'ALREADY_ALLOCATED',409)
        s=self.add(db,p,'shipment',{k:copy.deepcopy(plan[k]) for k in ['orderIds','packages','weightKg','start','end','stops','cost','distanceKm']}|{'status':'PLANNED','planId':plan['id'],'planVersion':1,'assignmentId':None,'delivered':[],'lastEventAt':None,'tracking':'PLANNED','stage':'PICKUP','labelStatus':'NONE','fiscalStatus':'NOT_EVALUATED','promisedAt':max(o['windowEnd'] for o in orders),'completedAt':None})
        for o in orders:o['status']='PLANNED';o['shipmentIds'].append(s['id']);self.save(db,o)
        plan.update(status='COMMITTED',shipmentId=s['id']);self.save(db,plan);return s
    @action('admin','planner')
    def cmd_replan(self,db,p,d):
        s=self.get(db,p,d.get('id'),'shipment',True);self.version(s,d);require(s['status'] in ['PLANNED','OFFERED','ASSIGNED'],'COMPENSATION_REQUIRED',409)
        if s['status']=='ASSIGNED':return self.add(db,p,'replanChange',{'shipmentId':s['id'],'shipmentVersion':s['version'],'plan':copy.deepcopy(d['plan']),'status':'APPROVAL_REQUIRED','reason':ident(d.get('reason'))})
        return self.replan_apply(db,p,s,d['plan'])
    @action('admin','planner')
    def cmd_replan_approve(self,db,p,d):
        change=self.get(db,p,d.get('id'),'replanChange',True);self.version(change,d);require(change['status']=='APPROVAL_REQUIRED','INVALID_STATE')
        s=self.get(db,p,change['shipmentId'],'shipment',True);require(s['version']==change['shipmentVersion'] and s['status']=='ASSIGNED','REPLAN_CONTEXT_CHANGED',409)
        result=self.replan_apply(db,p,s,change['plan']);change.update(status='APPLIED' if result['status']=='FEASIBLE' else 'INFEASIBLE_ORIGINAL_PRESERVED',planId=result['id'],resolution=ident(d.get('reason')));self.save(db,change);return result
    def replan_apply(self,db,p,s,values):
        db.execute('SAVEPOINT replan_preview')
        for oid in s['orderIds']:
            o=self.get(db,p,oid,'order',True);o['status']='RELEASED';self.save(db,o)
        candidate=self.plan_calculate(db,p,{**values,'orderIds':s['orderIds']})
        db.execute('ROLLBACK TO replan_preview');db.execute('RELEASE replan_preview')
        if candidate['status']=='INFEASIBLE':
            candidate['supersedes']=s['planId'];candidate['originalPreserved']=True
            return self.add(db,p,'plan',candidate)
        for t in self.all(db,'tender'):
            if t['shipmentId']==s['id'] and t['status']=='OPEN':t['status']='CANCELLED';self.save(db,t)
        s['status']='CANCELLED';self.save(db,s)
        if s.get('assignmentId'):
            assignment=self.get(db,p,s['assignmentId'],'assignment',True);assignment['status']='CANCELLED';self.save(db,assignment)
            for reservation in self.all(db,'reservation'):
                if reservation['assignmentId']==assignment['id'] and reservation['status']=='ACTIVE':reservation['status']='RELEASED';self.save(db,reservation)
        for oid in s['orderIds']:
            o=self.get(db,p,oid,'order',True);o['status']='RELEASED';o['shipmentIds']=[sid for sid in o['shipmentIds'] if sid!=s['id']];self.save(db,o)
        candidate['supersedes']=s['planId'];return self.add(db,p,'plan',candidate)
    @action('admin','planner')
    def cmd_aggregate_contract(self,db,p,d):
        provider=ident(d.get('providerOrg'));require(self.linked(db,p['org'],provider),'RELATION_REQUIRED');require(moment(d.get('validFrom'))<moment(d.get('validTo')),'INVALID_VALIDITY')
        return self.add(db,p,'aggregateContract',{'name':ident(d.get('name')),'providerOrg':provider,'validFrom':d['validFrom'],'validTo':d['validTo'],'reference':ident(d.get('reference')),'status':'ACTIVE_IMMUTABLE'})
    @action('admin','planner')
    def cmd_fleet_create(self,db,p,d):
        require(d.get('type') in ['VEHICLE','DRIVER'],'INVALID_RESOURCE');ident(d.get('name'))
        require(d.get('fleetMode','OWN') in ['OWN','AGGREGATE'],'INVALID_FLEET_MODE')
        if d.get('fleetMode')=='AGGREGATE':self.get(db,p,d.get('aggregateContractId'),'aggregateContract',True)
        if d['type']=='VEHICLE':dec(d.get('capacityKg'),Decimal('.001'))
        else:
            moment(d.get('licenseValidTo'))
            if d.get('userId'):
                u=db.execute('SELECT * FROM users WHERE id=?',(d['userId'],)).fetchone();require(u and u['org']==p['org'] and u['active'] and 'driver' in __import__('json').loads(u['roles']),'INVALID_DRIVER_USER')
        return self.add(db,p,'resource',dict(d,status='ACTIVE'))
    @action('admin','planner')
    def cmd_maintenance(self,db,p,d):
        r=self.get(db,p,d.get('resourceId'),'resource',True);require(moment(d.get('start'))<moment(d.get('end')),'INVALID_INTERVAL')
        require(not any(x['status']=='ACTIVE' and r['id'] in x['resourceIds'] and overlap(x['start'],x['end'],d['start'],d['end']) for x in self.all(db,'reservation')),'RESOURCE_RESERVED',409)
        return self.add(db,p,'maintenance',{'resourceId':r['id'],'start':d['start'],'end':d['end'],'reason':ident(d.get('reason')),'status':'SCHEDULED'})
    @action('admin','planner')
    def cmd_maintenance_finish(self,db,p,d):
        m=self.get(db,p,d.get('id'),'maintenance',True);self.version(m,d);require(m['status']=='SCHEDULED','MAINTENANCE_ALREADY_CLOSED',409)
        require(d.get('result') in ['COMPLETED','CANCELLED'],'INVALID_MAINTENANCE_RESULT')
        if d['result']=='COMPLETED':require(self.now()>=moment(m['end']),'MAINTENANCE_NOT_ENDED',409)
        m.update(status=d['result'],resolution=ident(d.get('reason')),closedAt=self.now().isoformat(),closedBy=p['id']);return self.save(db,m)
    @action('admin','planner','operator')
    def cmd_expense(self,db,p,d):
        s=self.get(db,p,d.get('shipmentId'),'shipment');require(s.get('carrierOrg')==p['org'],'ASSIGNED_CARRIER_REQUIRED',403)
        return self.add(db,p,'expense',{'shipmentId':s['id'],'amount':cash(dec(d.get('amount'))),'advanceAmount':cash(dec(d.get('advanceAmount','0'))),'category':ident(d.get('category')),'status':'RECORDED','realPayment':False})
    @action('admin','auditor')
    def cmd_expense_reconcile(self,db,p,d):
        expense=self.get(db,p,d.get('id'),'expense',True);self.version(expense,d);require(expense['status']=='RECORDED','EXPENSE_ALREADY_RECONCILED',409)
        approved=dec(d.get('approvedAmount'));require(approved<=Decimal(expense['amount']),'EXPENSE_EXCEEDS_REPORTED');difference=approved-Decimal(expense['advanceAmount'])
        expense.update(approvedAmount=cash(approved),difference=cash(difference),resolution=ident(d.get('reason')),reviewedBy=p['id'],status='RECONCILED_LOCAL');self.save(db,expense)
        self.add(db,p,'expenseAdjustment',{'expenseId':expense['id'],'shipmentId':expense['shipmentId'],'reportedAmount':expense['amount'],'approvedAmount':cash(approved),'advanceAmount':expense['advanceAmount'],'difference':cash(difference),'direction':'REIMBURSEMENT_DUE' if difference>0 else 'REFUND_DUE' if difference<0 else 'BALANCED','status':'OPEN_LOCAL' if difference else 'CLOSED_LOCAL','realPayment':False})
        return expense
    @action('admin','auditor')
    def cmd_expense_close(self,db,p,d):
        adjustment=self.get(db,p,d.get('id'),'expenseAdjustment',True);self.version(adjustment,d);require(adjustment['status']=='OPEN_LOCAL','ADJUSTMENT_ALREADY_CLOSED',409)
        require(dec(d.get('amount'))==abs(Decimal(adjustment['difference'])),'ADJUSTMENT_AMOUNT_MISMATCH')
        adjustment.update(status='CLOSED_LOCAL',reference=ident(d.get('reference')),closedBy=p['id'],closedAt=self.now().isoformat());return self.save(db,adjustment)
    @action('admin','planner')
    def cmd_tender(self,db,p,d):
        s=self.get(db,p,d.get('shipmentId'),'shipment',True);self.version(s,d);require(s['status'] in ['PLANNED','OFFERED'],'INVALID_STATE')
        carriers=d.get('carriers');require(isinstance(carriers,list) and carriers and len(set(carriers))==len(carriers),'INVALID_CARRIERS')
        for c in carriers:require(self.linked(db,p['org'],c),'RELATION_REQUIRED',403)
        require(moment(d.get('expiresAt'))>self.now(),'EXPIRED')
        for old in self.all(db,'tender'):
            if old['shipmentId']==s['id'] and old['status']=='OPEN':old['status']='CANCELLED';self.save(db,old)
        t=self.add(db,p,'tender',{'shipmentId':s['id'],'carriers':carriers,'offers':{c:{'status':'PENDING','price':s['cost']} for c in carriers},'expiresAt':d['expiresAt'],'status':'OPEN'},carriers)
        s['status']='OFFERED';self.save(db,s);self.share(db,s,carriers)
        for oid in s['orderIds']:self.share(db,self.get(db,p,oid,'order',True),carriers)
        return t
    def reserve_award(self,db,p,t,carrier,offer):
        s=self.get(db,p,t['shipmentId'],'shipment');resources=[];driver_user=None
        for rid,typ in [(offer.get('vehicleId'),'VEHICLE'),(offer.get('driverId'),'DRIVER')]:
            row=db.execute('SELECT data FROM objects WHERE id=?',(ident(rid),)).fetchone();require(row,'RESOURCE_NOT_FOUND');r=__import__('json').loads(row[0]);require(r['kind']=='resource' and r['org']==carrier and r['type']==typ and r['status']=='ACTIVE','INVALID_RESOURCE')
            if r.get('fleetMode')=='AGGREGATE':
                contract=next((x for x in self.all(db,'aggregateContract') if x['id']==r['aggregateContractId'] and x['org']==carrier),None)
                require(contract and self.linked(db,carrier,contract['providerOrg']) and moment(contract['validFrom'])<=moment(s['start']) and moment(s['end'])<=moment(contract['validTo']),'AGGREGATE_CONTRACT_INELIGIBLE',409)
            if typ=='VEHICLE':require(dec(r['capacityKg'])>=dec(s['weightKg']),'CAPACITY_EXCEEDED')
            else:require(moment(r['licenseValidTo'])>=moment(s['end']),'LICENSE_EXPIRED');driver_user=r.get('userId')
            require(not any(m['resourceId']==rid and m['status']=='SCHEDULED' and overlap(m['start'],m['end'],s['start'],s['end']) for m in self.all(db,'maintenance')),'RESOURCE_MAINTENANCE',409)
            require(not any(rid in x['resourceIds'] and x['status']=='ACTIVE' and overlap(x['start'],x['end'],s['start'],s['end']) for x in self.all(db,'reservation')),'RESOURCE_CONFLICT',409);resources.append(rid)
        a=self.add(db,{'id':p['id'],'org':s['org']},'assignment',{'shipmentId':s['id'],'carrierOrg':carrier,'price':offer['price'],'status':'ACTIVE','tenderId':t['id']},[carrier])
        self.add(db,{'id':p['id'],'org':carrier},'reservation',{'shipmentId':s['id'],'assignmentId':a['id'],'resourceIds':resources,'start':s['start'],'end':s['end'],'status':'ACTIVE'})
        t.update(status='AWARDED',assignmentId=a['id'],carrierOrg=carrier)
        for c,of in t['offers'].items():of['status']='ACCEPTED' if c==carrier else 'CLOSED'
        self.save(db,t);s.update(status='ASSIGNED',assignmentId=a['id'],carrierOrg=carrier,driverUserId=driver_user,cost=offer['price']);self.save(db,s);self.share(db,s,[carrier])
        for oid in s['orderIds']:self.share(db,self.get(db,p,oid,'order'),[carrier])
        return a
    @action('admin','planner')
    def cmd_offer_respond(self,db,p,d):
        t=self.get(db,p,d.get('id'),'tender');self.version(t,d);require(p['org'] in t['offers'],'NOT_INVITED',403)
        require(t['status']=='OPEN' and self.now()<moment(t['expiresAt']),'OFFER_EXPIRED',409);o=t['offers'][p['org']];require(o['status']=='PENDING','ALREADY_RESPONDED',409)
        decision=d.get('decision');require(decision in ['ACCEPT','REJECT','COUNTER'],'INVALID_DECISION')
        if decision=='REJECT':o.update(status='REJECTED',reason=ident(d.get('reason')));return self.save(db,t)
        o.update(vehicleId=ident(d.get('vehicleId')),driverId=ident(d.get('driverId')))
        if decision=='COUNTER':o.update(status='COUNTER',price=cash(dec(d.get('price'))));return self.save(db,t)
        return self.reserve_award(db,p,t,p['org'],o)
    @action('admin','planner')
    def cmd_counter_accept(self,db,p,d):
        t=self.get(db,p,d.get('id'),'tender',True);self.version(t,d);require(t['status']=='OPEN' and self.now()<moment(t['expiresAt']),'OFFER_EXPIRED',409);carrier=d.get('carrierOrg');require(t['offers'].get(carrier,{}).get('status')=='COUNTER','COUNTER_REQUIRED');return self.reserve_award(db,p,t,carrier,t['offers'][carrier])
    @action('admin','planner')
    def cmd_expire_offers(self,db,p,d):
        ids=[]
        for t in self.all(db,'tender'):
            if t['org']==p['org'] and t['status']=='OPEN' and self.now()>=moment(t['expiresAt']):t['status']='EXPIRED';self.save(db,t);ids.append(t['id'])
        return {'expired':ids}
    @action('admin','planner')
    def cmd_rfq_create(self,db,p,d):
        for c in d.get('carriers',[]):require(self.linked(db,p['org'],c),'RELATION_REQUIRED')
        require(d.get('carriers') and moment(d.get('expiresAt'))>self.now(),'INVALID_RFQ');return self.add(db,p,'rfq',{'name':ident(d.get('name')),'carriers':d['carriers'],'expiresAt':d['expiresAt'],'status':'OPEN','bids':{},'scope':ident(d.get('scope'))},d['carriers'])
    @action('admin','planner')
    def cmd_rfq_bid(self,db,p,d):
        r=self.get(db,p,d.get('id'),'rfq');self.version(r,d);require(p['org'] in r['carriers'] and r['status']=='OPEN' and self.now()<moment(r['expiresAt']),'RFQ_CLOSED');r['bids'][p['org']]={'base':cash(dec(d.get('base'))),'perKg':cash(dec(d.get('perKg')))};return self.save(db,r)
    @action('admin','planner')
    def cmd_rfq_select(self,db,p,d):
        r=self.get(db,p,d.get('id'),'rfq',True);self.version(r,d);require(r['status']=='OPEN' and self.now()<moment(r['expiresAt']) and d.get('carrierOrg') in r['bids'],'INVALID_BID');carrier=d['carrierOrg'];draft=self.cmd_rate_create(db,p,{**d['rate'],'carrierOrg':carrier,**r['bids'][carrier]});r.update(status='SELECTED',draftRateId=draft['id']);self.save(db,r);return draft
    def assigned(self,db,p,d):
        s=self.get(db,p,d.get('shipmentId'),'shipment');require(p['org']==s.get('carrierOrg') or p['org']==s.get('subcontractorOrg'),'ASSIGNED_CARRIER_REQUIRED',403);return s
    @action('admin','planner')
    def cmd_subcontract(self,db,p,d):
        s=self.assigned(db,p,d);self.version(s,d);require(s['carrierOrg']==p['org'] and s['status']=='ASSIGNED','INVALID_STATE');sub=ident(d.get('targetOrg'));require(self.linked(db,p['org'],sub) and self.linked(db,s['org'],sub),'EXPLICIT_RELATION_REQUIRED',403)
        s['subcontractorOrg']=sub;self.save(db,s);self.share(db,s,[s['carrierOrg'],sub]);return self.add(db,p,'subcontract',{'shipmentId':s['id'],'targetOrg':sub,'price':cash(dec(d.get('price'))),'status':'AUTHORIZED'},[sub])
    @action('admin','operator','driver')
    def cmd_stage(self,db,p,d):
        s=self.assigned(db,p,d);self.version(s,d)
        sequence=['PICKUP','HUB','TRANSFER','LAST_MILE','DELIVERY'];stage=d.get('stage');require(stage in sequence,'INVALID_STAGE')
        keys=d.get('packageKeys');expected={x['key'] for x in s['packages']}
        require(isinstance(keys,list) and len(keys)==len(set(keys)) and set(keys)==expected,'CUSTODY_VOLUMES_MISMATCH')
        if s['status']=='ASSIGNED':require(s.get('labelStatus')=='READY' and s.get('fiscalStatus') in ['DEMO_AUTHORIZED','DEMO_NOT_REQUIRED'],'DISPATCH_BLOCKED');require(stage=='PICKUP','PICKUP_REQUIRED');s['status']='IN_TRANSIT'
        else:require(s['status'] in ['IN_TRANSIT','PARTIAL'] and sequence.index(stage)==sequence.index(s['stage'])+1,'INVALID_STAGE_TRANSITION')
        s.setdefault('custody',[]).append({'stage':stage,'packageKeys':sorted(keys),'quantity':len(keys),'actor':p['id'],'at':self.now().isoformat()})
        s['stage']=stage;s['lastEventAt']=self.now().isoformat();return self.save(db,s)
    @action('admin','operator','driver')
    def cmd_tracking(self,db,p,d):
        s=self.assigned(db,p,d);eid=ident(d.get('eventId'));old=[x for x in self.all(db,'tracking') if x['shipmentId']==s['id'] and x['eventId']==eid]
        if old:require(old[0]['hash']==sha(d),'EVENT_CONFLICT',409);return old[0]
        ts=moment(d.get('occurredAt'));require(ts<=self.now()+timedelta(minutes=5),'FUTURE_EVENT');pv=d.get('planVersion');require(isinstance(pv,int) and 1<=pv<=s['planVersion'],'INVALID_PLAN_VERSION')
        projected=pv==s['planVersion'] and s['status']=='IN_TRANSIT' and (not s['lastEventAt'] or ts>moment(s['lastEventAt']))
        if projected:s['tracking']=ident(d.get('type'));s['lastEventAt']=ts.isoformat();self.save(db,s)
        return self.add(db,{'id':p['id'],'org':s['org']},'tracking',{'shipmentId':s['id'],'eventId':eid,'hash':sha(d),'occurredAt':ts.isoformat(),'type':ident(d.get('type')),'projectionUpdated':projected,'status':'QUARANTINED' if pv!=s['planVersion'] else 'RECORDED'},[s['carrierOrg']])
    @action('admin','operator','driver')
    def cmd_pod(self,db,p,d):
        s=self.assigned(db,p,d);eid=ident(d.get('proofId'));old=[x for x in self.all(db,'pod') if x['shipmentId']==s['id'] and x['proofId']==eid]
        if old:require(old[0]['hash']==sha(d),'PROOF_CONFLICT',409);return old[0]
        self.version(s,d);require(s['status'] in ['IN_TRANSIT','PARTIAL'] and s['stage']=='DELIVERY','NOT_AT_DELIVERY');keys=d.get('packageKeys');require(isinstance(keys,list) and keys and len(keys)==len(set(keys)) and set(keys)<={x['key'] for x in s['packages']},'INVALID_PACKAGES');require(not set(keys)&set(s['delivered']),'ALREADY_DELIVERED',409)
        outcome=d.get('outcome');require(outcome in ['DELIVERED','FAILED'],'INVALID_OUTCOME');ident(d.get('reason'));ts=moment(d.get('occurredAt'));require(ts<=self.now()+timedelta(minutes=5),'FUTURE_EVENT')
        if d.get('fileId'):
            file=db.execute('SELECT * FROM files WHERE id=?',(d['fileId'],)).fetchone();require(file and file['object']==s['id'],'FILE_SCOPE',403)
        if outcome=='DELIVERED':
            s['delivered']=sorted(set(s['delivered'])|set(keys));s['status']='DELIVERED' if len(s['delivered'])==len(s['packages']) else 'PARTIAL';s['tracking']=s['status']
            if s['status']=='DELIVERED':s['completedAt']=ts.isoformat()
        s['lastEventAt']=max(moment(s['lastEventAt']) if s['lastEventAt'] else ts,ts).isoformat();self.save(db,s)
        proof=self.add(db,{'id':p['id'],'org':s['org']},'pod',{'shipmentId':s['id'],'proofId':eid,'hash':sha(d),'packageKeys':keys,'outcome':outcome,'reason':d['reason'],'fileId':d.get('fileId'),'occurredAt':ts.isoformat()},[s['carrierOrg']])
        self.add(db,{'id':p['id'],'org':s['org']},'notification',{'shipmentId':s['id'],'proofId':proof['id'],'status':'PREPARED_NOT_SENT','type':outcome})
        if s['status']=='DELIVERED':
            for r in self.all(db,'reservation'):
                if r['shipmentId']==s['id'] and r['status']=='ACTIVE':r['status']='RELEASED';self.save(db,r)
        return proof
    @action('admin','operator','driver')
    def cmd_claim_create(self,db,p,d):
        s=self.get(db,p,d.get('shipmentId'),'shipment');require(d.get('type') in ['DAMAGE','LOSS','DELAY','REFUSAL'],'INVALID_CLAIM')
        keys=d.get('packageKeys');require(isinstance(keys,list) and keys and len(keys)==len(set(keys)) and set(keys)<={x['key'] for x in s['packages']},'INVALID_CLAIM_PACKAGES')
        return self.add(db,{'id':p['id'],'org':s['org']},'claim',{'shipmentId':s['id'],'type':d['type'],'description':ident(d.get('description')),'packageKeys':keys,'quantity':len(keys),'status':'OPEN','history':[{'status':'OPEN','at':self.now().isoformat(),'user':p['id']}],'realIndemnity':False},[s.get('carrierOrg')] if s.get('carrierOrg') else [])
    @action('admin','operator')
    def cmd_claim_resolve(self,db,p,d):
        c=self.get(db,p,d.get('id'),'claim',True);self.version(c,d);require(c['status']=='OPEN','INVALID_STATE');c.update(status='RESOLVED',resolution=ident(d.get('resolution')));c.setdefault('history',[]).append({'status':'RESOLVED','resolution':c['resolution'],'at':self.now().isoformat(),'user':p['id']});return self.save(db,c)
    @action('admin','operator')
    def cmd_return_create(self,db,p,d):
        s=self.get(db,p,d.get('shipmentId'),'shipment',True);keys=d.get('packageKeys');require(isinstance(keys,list) and keys and len(keys)==len(set(keys)) and set(keys)<=set(s['delivered']),'RETURN_REQUIRES_DELIVERY')
        require(not any(set(keys)&set(x['packageKeys']) and x['shipmentId']==s['id'] for x in self.all(db,'return')),'RETURN_DUPLICATE',409)
        return self.add(db,p,'return',{'shipmentId':s['id'],'packageKeys':keys,'reason':ident(d.get('reason')),'status':'AUTHORIZED','carrierOrg':s['carrierOrg'],'history':[]},[s['carrierOrg']])
    @action('admin','operator','driver')
    def cmd_return_progress(self,db,p,d):
        r=self.get(db,p,d.get('id'),'return');self.version(r,d);target=d.get('status');trans={'AUTHORIZED':'COLLECTED','COLLECTED':'RECEIVED','RECEIVED':'CLOSED'};require(trans.get(r['status'])==target,'INVALID_TRANSITION')
        require(p['org']==(r['carrierOrg'] if target=='COLLECTED' else r['org']),'ROLE_SCOPE',403);r['history'].append({'from':r['status'],'to':target,'at':self.now().isoformat(),'user':p['id']});r['status']=target;return self.save(db,r)
