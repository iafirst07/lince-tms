from datetime import timedelta
from decimal import Decimal
from test_a import Base,PACKS
import test_b,test_c
from engine import Engine

class CommercialDelta(Base):
    order=test_b.TestsB.order;ship=test_b.TestsB.ship;resources=test_b.TestsB.resources;award=test_b.TestsB.award
    process=test_c.TestsC.process;ready_delivery=test_c.TestsC.ready_delivery
    def values(self,external='new',packs=None):
        packs=packs or PACKS;q=self.cmd('quote',{'originCep':'01001000','destinationCep':'01310100','packages':packs});loc=self.cmd('master_create',{'kind':'location','values':{'name':'Novo local','postalCode':'01310100','lat':-23.56,'lon':-46.66}})
        return {'externalId':external,'quoteId':q['id'],'candidate':0,'packages':packs,'consumerCharge':'7','locationId':loc['id'],'windowStart':'2026-11-25T16:00:00Z','windowEnd':'2026-11-25T22:00:00Z'}
    def test_three_stop_route_known_distance_windows_capacity_incompatibility(self):
        origin=self.cmd('master_create',{'kind':'location','values':{'name':'Zero sintético','postalCode':'01001000','lat':0,'lon':0}});orders=[]
        for index,lon in [(3,.03),(1,.01),(2,.02)]:
            vals=self.values('ROUTE'+str(index));loc=self.cmd('master_create',{'kind':'location','values':{'name':'Parada'+str(index),'postalCode':'01310100','lat':0,'lon':lon}});vals['locationId']=loc['id'];order=self.cmd('order_create',vals);orders.append(self.cmd('order_release',{'id':order['id'],'version':1}))
        values={'orderIds':[o['id'] for o in orders],'originLocationId':origin['id'],'start':'2026-11-25T16:00:00Z','capacityKg':'15','speedKmh':'111'}
        plan=self.cmd('plan',values);self.assertEqual(plan['status'],'FEASIBLE');self.assertEqual([x['orderId'] for x in plan['stops']],[orders[1]['id'],orders[2]['id'],orders[0]['id']]);self.assertEqual(plan['distanceKm'],3.33);self.assertEqual([x['km'] for x in plan['stops']],[1.11]*3);self.assertEqual(plan['end'],'2026-11-25T16:16:48+00:00')
        self.assertIn('CAPACITY_EXCEEDED',self.cmd('plan',{**values,'capacityKg':'14.999'})['reasons'])
        cold=self.cmd('order_create',self.values('COLD',[{**PACKS[0],'cargoClass':'COLD'}]));self.cmd('order_release',{'id':cold['id'],'version':1});self.assertIn('CARGO_INCOMPATIBLE',self.cmd('plan',{**values,'orderIds':[orders[0]['id'],cold['id']]})['reasons'])
        tight=self.values('TIGHT');tight['windowEnd']='2026-11-25T16:00:01Z';o=self.cmd('order_create',tight);self.cmd('order_release',{'id':o['id'],'version':1});infeasible=self.cmd('plan',{**values,'orderIds':[o['id']]});self.assertIn('WINDOW_INFEASIBLE:'+o['id'],infeasible['reasons'])
    def test_feasible_post_award_replan_approval_conserves_packages(self):
        s=self.award();origin=self.cmd('master_create',{'kind':'location','values':{'name':'Nova saída','postalCode':'01001000','lat':-23.54,'lon':-46.64}})
        plan_values={'originLocationId':origin['id'],'start':'2026-11-25T16:10:00Z','capacityKg':'100','speedKmh':'40'}
        change=self.cmd('replan',{'id':s['id'],'version':s['version'],'plan':plan_values,'reason':'Ajuste de saída'});self.assertEqual(change['status'],'APPROVAL_REQUIRED');self.assertEqual(self.e.state(self.p,s['id'])['status'],'ASSIGNED')
        plan=self.cmd('replan_approve',{'id':change['id'],'version':1,'reason':'Impacto aceito'});replacement=self.cmd('plan_commit',{'id':plan['id'],'version':1})
        self.assertEqual({x['key'] for x in replacement['packages']},{x['key'] for x in s['packages']});self.assertEqual(self.e.state(self.p,s['assignmentId'])['status'],'CANCELLED')
        with self.e.db() as db:self.assertTrue(all(r['status']=='RELEASED' for r in self.e.all(db,'reservation')))
        plan=self.cmd('replan',{'id':replacement['id'],'version':replacement['version'],'plan':{**plan_values,'start':'2026-11-25T16:20:00Z'}});final=self.cmd('plan_commit',{'id':plan['id'],'version':1})
        self.assertEqual(self.e.state(self.p,s['orderIds'][0])['shipmentIds'],[final['id']])
        with self.e.db() as db:active=[x for x in self.e.all(db,'shipment') if x['status']!='CANCELLED'];self.assertEqual(len(active),1);self.assertEqual(len(active[0]['packages']),len(s['packages']))
    def test_rfq_selection_publish_quote_and_expired_selection(self):
        rfq=self.cmd('rfq_create',{'name':'Compra','scope':'SP','carriers':[self.c['org']],'expiresAt':(self.now+timedelta(hours=1)).isoformat()})
        rfq=self.cmd('rfq_bid',{'id':rfq['id'],'version':1,'base':'5','perKg':'1'},self.c)
        with self.e.db() as db:old=self.e.all(db,'rate')[0]
        rate={k:old[k] for k in ['name','side','zoneId','serviceId','validFrom','validTo','minKg','maxKg','additions']};rate['priority']=9
        draft=self.cmd('rfq_select',{'id':rfq['id'],'version':rfq['version'],'carrierOrg':self.c['org'],'rate':rate});self.assertEqual(draft['status'],'DRAFT');self.assertEqual(self.quote()['candidates'][0]['cost'],'20.00')
        self.cmd('rate_publish',{'id':draft['id'],'version':1});self.assertEqual(self.quote()['candidates'][0]['cost'],'10.00')
        second=self.cmd('rfq_create',{'name':'Expira','scope':'SP','carriers':[self.c['org']],'expiresAt':(self.now+timedelta(seconds=1)).isoformat()});second=self.cmd('rfq_bid',{'id':second['id'],'version':1,'base':'1','perKg':'1'},self.c);self.now+=timedelta(seconds=1)
        self.error('INVALID_BID',lambda:self.cmd('rfq_select',{'id':second['id'],'version':second['version'],'carrierOrg':self.c['org'],'rate':rate}))
    def test_reject_reoffer_expire_counter_and_reserve(self):
        s=self.ship();v,dr=self.resources();expires=self.now+timedelta(seconds=1)
        t=self.cmd('tender',{'shipmentId':s['id'],'version':s['version'],'carriers':[self.c['org']],'expiresAt':expires.isoformat()})
        self.cmd('offer_respond',{'id':t['id'],'version':1,'decision':'REJECT','reason':'Agenda'},self.c)
        s=self.e.state(self.p,s['id']);new=self.cmd('tender',{'shipmentId':s['id'],'version':s['version'],'carriers':[self.c['org']],'expiresAt':expires.isoformat()});self.assertEqual(self.e.state(self.p,t['id'])['status'],'CANCELLED')
        self.now=expires;self.assertEqual(self.cmd('expire_offers',{})['expired'],[new['id']]);self.error('OFFER_EXPIRED',lambda:self.cmd('offer_respond',{'id':new['id'],'version':2,'decision':'ACCEPT','vehicleId':v['id'],'driverId':dr['id']},self.c))
        s=self.e.state(self.p,s['id']);t=self.cmd('tender',{'shipmentId':s['id'],'version':s['version'],'carriers':[self.c['org']],'expiresAt':(self.now+timedelta(hours=1)).isoformat()})
        t=self.cmd('offer_respond',{'id':t['id'],'version':1,'decision':'COUNTER','price':'27','vehicleId':v['id'],'driverId':dr['id']},self.c)
        assignment=self.cmd('counter_accept',{'id':t['id'],'version':t['version'],'carrierOrg':self.c['org']});self.assertEqual(assignment['price'],'27.00')
        reopened=Engine(self.e.path,lambda:self.now)
        with reopened.db() as db:self.assertEqual(len([r for r in reopened.all(db,'reservation') if r['status']=='ACTIVE']),1)
    def test_edits_before_plan_after_award_and_execution_compensation(self):
        original=self.order('EDIT-1');vals=self.values(packs=[{**PACKS[0],'weightKg':'6'}]);changed=self.cmd('order_change',{'id':original['id'],'version':1,'operation':'EDIT','values':vals})
        self.assertEqual(changed['packages'][0]['weightKg'],'6');self.assertNotEqual(changed['quoteId'],original['quoteId']);self.assertEqual(changed['contentVersion'],2);self.assertEqual(changed['revisions'][0]['quoteId'],original['quoteId'])
        # Independent awarded order preserves its original until explicit change resolution.
        s=self.award();order=self.e.state(self.p,s['orderIds'][0]);proposal=self.cmd('order_change',{'id':order['id'],'version':order['version'],'operation':'EDIT','values':self.values(),'reason':'Destino revisto'})
        self.assertEqual(proposal['status'],'APPROVAL_REQUIRED');self.assertEqual(self.e.state(self.p,s['id'])['status'],'ASSIGNED')
        self.cmd('change_resolve',{'id':proposal['id'],'version':1});self.assertEqual(self.e.state(self.p,s['id'])['status'],'CANCELLED');self.assertEqual(self.e.state(self.p,s['assignmentId'])['status'],'CANCELLED')
        with self.e.db() as db:self.assertTrue(all(r['status']=='RELEASED' for r in self.e.all(db,'reservation')))
    def test_post_execution_compensation_preserves_delivery_and_pod(self):
        mock=self.e.start_mock()
        try:
            s=self.ready_delivery();proof=self.cmd('pod',{'shipmentId':s['id'],'version':s['version'],'proofId':'DELIVERED1','packageKeys':[x['key'] for x in s['packages']],'outcome':'DELIVERED','reason':'Recebido','occurredAt':self.now.isoformat()},self.c)
            order=self.e.state(self.p,s['orderIds'][0]);request=self.cmd('order_change',{'id':order['id'],'version':order['version'],'operation':'CANCEL','reason':'Após entrega'})
            self.assertEqual(request['status'],'COMPENSATION_REQUIRED');self.cmd('change_resolve',{'id':request['id'],'version':1,'resolution':'Registrar custo e nova operação separadamente'})
            self.assertEqual(self.e.state(self.p,s['id'])['status'],'DELIVERED');self.assertEqual(self.e.state(self.p,order['id'])['version'],order['version']);self.assertEqual(self.e.state(self.p,proof['id'])['proofId'],'DELIVERED1')
        finally:mock.close()
    def test_import_mixed_valid_dedup_and_replay(self):
        value=self.values('IMPORT1');preview=self.cmd('import_preview',{'rows':[value,value,{'externalId':'invalid'}]});self.assertEqual((preview['valid'],preview['errors']),(1,2))
        payload={'id':preview['id'],'version':1,'validOnly':True};done=self.cmd('import_commit',payload,key='import1');again=self.cmd('import_commit',payload,key='import1');self.assertEqual(done['orderIds'],again['orderIds'])
        reopened=Engine(self.e.path,lambda:self.now);self.assertEqual(reopened.state(self.p,done['id'])['status'],'COMMITTED')
        duplicate=self.cmd('import_preview',{'rows':[value]});self.assertEqual(duplicate['rows'][0]['error'],'DUPLICATE_ORDER')
    def test_maintenance_close_and_adjacent_reservations(self):
        s=self.ship();v,driver=self.resources();maintenance=self.cmd('maintenance',{'resourceId':v['id'],'start':s['start'],'end':s['end'],'reason':'Revisão'},self.c)
        self.error('MAINTENANCE_NOT_ENDED',lambda:self.cmd('maintenance_finish',{'id':maintenance['id'],'version':1,'result':'COMPLETED','reason':'Ainda não acabou'},self.c))
        self.cmd('maintenance_finish',{'id':maintenance['id'],'version':1,'result':'CANCELLED','reason':'Reagendamento'},self.c)
        t=self.cmd('tender',{'shipmentId':s['id'],'version':1,'carriers':[self.c['org']],'expiresAt':(self.now+timedelta(hours=1)).isoformat()});self.cmd('offer_respond',{'id':t['id'],'version':1,'decision':'ACCEPT','vehicleId':v['id'],'driverId':driver['id']},self.c)
        order=self.order('SECOND');self.cmd('order_release',{'id':order['id'],'version':1})
        with self.e.db() as db:plan=self.e.get(db,self.p,s['planId'])
        origin=self.cmd('master_create',{'kind':'location','values':{'name':'Segunda origem','postalCode':'01001000','lat':-23.54,'lon':-46.64}})
        plan=self.cmd('plan',{'orderIds':[order['id']],'originLocationId':origin['id'],'start':s['end'],'capacityKg':'100','speedKmh':'40'});nextship=self.cmd('plan_commit',{'id':plan['id'],'version':1})
        tender=self.cmd('tender',{'shipmentId':nextship['id'],'version':1,'carriers':[self.c['org']],'expiresAt':(self.now+timedelta(hours=1)).isoformat()});self.cmd('offer_respond',{'id':tender['id'],'version':1,'decision':'ACCEPT','vehicleId':v['id'],'driverId':driver['id']},self.c)
        reopened=Engine(self.e.path,lambda:self.now)
        with reopened.db() as db:
            reservations=reopened.all(db,'reservation');self.assertEqual(len(reservations),2);self.assertEqual(reservations[0]['end'],reservations[1]['start'])
    def test_aggregate_contract_award_and_expense_adjustments(self):
        partner=self.seed['carriers'][1];relation=self.cmd('relationship',{'targetOrg':partner['org']},self.c);self.cmd('relationship_respond',{'id':relation['id'],'version':1,'decision':'ACCEPT'},partner)
        contract=self.cmd('aggregate_contract',{'name':'Agregado fictício','providerOrg':partner['org'],'validFrom':'2026-11-25T00:00:00Z','validTo':'2026-11-26T00:00:00Z','reference':'DEMO-CONTRACT'},self.c)
        vehicle=self.cmd('fleet_create',{'type':'VEHICLE','name':'Van agregada','capacityKg':'100','fleetMode':'AGGREGATE','aggregateContractId':contract['id']},self.c);_,driver=self.resources()
        s=self.ship();t=self.cmd('tender',{'shipmentId':s['id'],'version':1,'carriers':[self.c['org']],'expiresAt':(self.now+timedelta(hours=1)).isoformat()});self.cmd('offer_respond',{'id':t['id'],'version':1,'decision':'ACCEPT','vehicleId':vehicle['id'],'driverId':driver['id']},self.c)
        for amount,advance,difference,direction in [('30','20','10.00','REIMBURSEMENT_DUE'),('10','20','-10.00','REFUND_DUE'),('20','20','0.00','BALANCED')]:
            expense=self.cmd('expense',{'shipmentId':s['id'],'amount':amount,'advanceAmount':advance,'category':'Combustível demo'},self.c)
            self.cmd('expense_reconcile',{'id':expense['id'],'version':1,'approvedAmount':amount,'reason':'Comprovante conferido'},self.c)
            adjustment=next(x for x in self.e.state(self.c)['objects'] if x['kind']=='expenseAdjustment' and x['expenseId']==expense['id']);self.assertEqual(adjustment['difference'],difference);self.assertEqual(adjustment['direction'],direction)
            if Decimal(difference):
                self.error('ADJUSTMENT_AMOUNT_MISMATCH',lambda:self.cmd('expense_close',{'id':adjustment['id'],'version':1,'amount':'1','reference':'Inválido'},self.c))
                closed=self.cmd('expense_close',{'id':adjustment['id'],'version':1,'amount':str(abs(Decimal(difference))),'reference':'LOCAL-001'},self.c);self.assertFalse(closed['realPayment']);self.assertEqual(closed['status'],'CLOSED_LOCAL')
