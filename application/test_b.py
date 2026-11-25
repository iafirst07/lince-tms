from test_a import Base,PACKS
from core import Error
import concurrent.futures

class TestsB(Base):
    def test_consolidation_cancel_preserves_sibling_and_infeasible_replan(self):
        orders=[self.order('A'),self.order('B')]
        for o in orders:self.cmd('order_release',{'id':o['id'],'version':1})
        origin=self.cmd('master_create',{'kind':'location','values':{'name':'Origem','postalCode':'01001000','lat':-23.54,'lon':-46.64}})
        values={'orderIds':[o['id'] for o in orders],'originLocationId':origin['id'],'start':'2026-11-25T16:00:00Z','capacityKg':'100','speedKmh':'40'}
        plan=self.cmd('plan',values);s=self.cmd('plan_commit',{'id':plan['id'],'version':1})
        result=self.cmd('replan',{'id':s['id'],'version':s['version'],'plan':{**values,'capacityKg':'1'}})
        self.assertEqual(result['status'],'INFEASIBLE');self.assertTrue(result['originalPreserved']);self.assertEqual(self.e.state(self.p,s['id'])['status'],'PLANNED')
        first=self.e.state(self.p,orders[0]['id']);self.cmd('order_change',{'id':first['id'],'version':first['version'],'operation':'CANCEL'})
        sibling=self.e.state(self.p,orders[1]['id']);self.assertEqual(sibling['status'],'RELEASED');self.assertEqual(sibling['shipmentIds'],[])
        plan=self.cmd('plan',{**values,'orderIds':[sibling['id']]});self.assertEqual(self.cmd('plan_commit',{'id':plan['id'],'version':1})['status'],'PLANNED')
    def order(self,external='O1'):
        q=self.quote();loc=self.cmd('master_create',{'kind':'location','values':{'name':'Destino','postalCode':'01310100','lat':-23.55,'lon':-46.65}})
        return self.cmd('order_create',{'externalId':external,'quoteId':q['id'],'candidate':0,'packages':PACKS,'consumerCharge':'5','locationId':loc['id'],'windowStart':'2026-11-25T16:00:00Z','windowEnd':'2026-11-25T22:00:00Z'})
    def ship(self):
        o=self.order();o=self.cmd('order_release',{'id':o['id'],'version':1});origin=self.cmd('master_create',{'kind':'location','values':{'name':'Origem','postalCode':'01001000','lat':-23.54,'lon':-46.64}})
        plan=self.cmd('plan',{'orderIds':[o['id']],'originLocationId':origin['id'],'start':'2026-11-25T16:00:00Z','capacityKg':'100','speedKmh':'40'})
        return self.cmd('plan_commit',{'id':plan['id'],'version':1})
    def resources(self,p=None):
        p=p or self.c
        v=self.cmd('fleet_create',{'type':'VEHICLE','name':'Van','capacityKg':'100'},p)
        driver=self.cmd('fleet_create',{'type':'DRIVER','name':'Motorista fictício','licenseValidTo':'2030-01-01T00:00:00Z'},p)
        return v,driver
    def award(self):
        s=self.ship();v,dr=self.resources();t=self.cmd('tender',{'shipmentId':s['id'],'version':1,'carriers':[self.c['org']],'expiresAt':'2026-11-25T18:00:00Z'})
        a=self.cmd('offer_respond',{'id':t['id'],'version':1,'decision':'ACCEPT','vehicleId':v['id'],'driverId':dr['id']},self.c)
        return self.e.state(self.c,s['id'])
    def test_order_import_edit_cancel(self):
        o=self.order();self.error('VERSION_CONFLICT',lambda:self.cmd('order_release',{'id':o['id'],'version':2}))
        canceled=self.cmd('order_change',{'id':o['id'],'version':1,'operation':'CANCEL'});self.assertEqual(canceled['status'],'CANCELLED');self.assertEqual(len(canceled['revisions']),1)
        imp=self.cmd('import_preview',{'rows':[{'externalId':'invalid'}]});self.assertEqual(imp['errors'],1);self.error('IMPORT_HAS_ERRORS',lambda:self.cmd('import_commit',{'id':imp['id'],'version':1}))
    def test_plan_award_partial_and_full_reverse(self):
        s=self.award()
        self.error('DISPATCH_BLOCKED',lambda:self.cmd('stage',{'shipmentId':s['id'],'version':s['version'],'stage':'PICKUP','packageKeys':[x['key'] for x in s['packages']]},self.c))
        # Integration C owns label/fiscal commands. Fixture isolates B until C is attached.
        with self.e.db(True) as db:
            s=self.e.get(db,self.c,s['id']);s['labelStatus']='READY';s['fiscalStatus']='DEMO_AUTHORIZED';self.e.save(db,s)
        for stage in ['PICKUP','HUB','TRANSFER','LAST_MILE','DELIVERY']:
            s=self.e.state(self.c,s['id']);self.cmd('stage',{'shipmentId':s['id'],'version':s['version'],'stage':stage,'packageKeys':[x['key'] for x in s['packages']]},self.c)
        s=self.e.state(self.c,s['id']);self.cmd('pod',{'shipmentId':s['id'],'version':s['version'],'proofId':'POD1','packageKeys':[s['packages'][0]['key']],'outcome':'DELIVERED','reason':'Fictício','occurredAt':self.now.isoformat()},self.c)
        r=self.cmd('return_create',{'shipmentId':s['id'],'packageKeys':[s['packages'][0]['key']],'reason':'Devolução'})
        r=self.cmd('return_progress',{'id':r['id'],'version':1,'status':'COLLECTED'},self.c)
        r=self.cmd('return_progress',{'id':r['id'],'version':r['version'],'status':'RECEIVED'})
        r=self.cmd('return_progress',{'id':r['id'],'version':r['version'],'status':'CLOSED'});self.assertEqual(r['status'],'CLOSED')
    def test_concurrent_award_and_counter(self):
        s=self.ship();t=self.cmd('tender',{'shipmentId':s['id'],'version':1,'carriers':[c['org'] for c in self.seed['carriers']],'expiresAt':'2026-11-25T18:00:00Z'});resources=[self.resources(c) for c in self.seed['carriers']]
        def accept(i):
            c=self.seed['carriers'][i];v,dr=resources[i]
            try:return self.cmd('offer_respond',{'id':t['id'],'version':1,'decision':'ACCEPT','vehicleId':v['id'],'driverId':dr['id']},c)['kind']
            except Error as e:return e.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:r=list(pool.map(accept,[0,1]))
        self.assertEqual(r.count('assignment'),1);self.assertEqual(r.count('VERSION_CONFLICT'),1)
    def test_maintenance_blocks_and_rfq_produces_draft(self):
        s=self.ship();v,dr=self.resources();self.cmd('maintenance',{'resourceId':v['id'],'start':'2026-11-25T00:00:00Z','end':'2026-11-26T00:00:00Z','reason':'Revisão'},self.c)
        t=self.cmd('tender',{'shipmentId':s['id'],'version':1,'carriers':[self.c['org']],'expiresAt':'2026-11-25T18:00:00Z'})
        self.error('RESOURCE_MAINTENANCE',lambda:self.cmd('offer_respond',{'id':t['id'],'version':1,'decision':'ACCEPT','vehicleId':v['id'],'driverId':dr['id']},self.c))
        rfq=self.cmd('rfq_create',{'name':'Contrato anual','scope':'Pacotes SP','carriers':[self.c['org']],'expiresAt':'2026-12-01T00:00:00Z'})
        bid=self.cmd('rfq_bid',{'id':rfq['id'],'version':1,'base':'12','perKg':'1'},self.c);self.assertEqual(bid['bids'][self.c['org']]['base'],'12.00')

if __name__=='__main__':__import__('unittest').main(verbosity=2)
