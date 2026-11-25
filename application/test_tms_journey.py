"""Editable-mass continuation tests. Synthetic temporary DBs, no permission audit."""
from copy import deepcopy
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest
import uuid
from core import Error
from engine import Engine
from seed import seed

EVENTS = {}
PACKS = [dict(id='P1',weightKg='2',lengthCm='25',widthCm='18',heightCm='15'),
         dict(id='P2',weightKg='3',lengthCm='30',widthCm='20',heightCm='16')]
EDITED = [{**PACKS[0]}, {**PACKS[1], 'weightKg':'4'}]


class TmsJourneyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.now=datetime.fromisoformat('2026-11-25T16:00:00+00:00')
        self.e=Engine(Path(self.tmp.name)/'journey.sqlite',lambda:self.now)
        self.fixture=seed(self.e);self.p=self.fixture['shipper'];self.c=self.fixture['carriers'][0]
        self.mock=None;self.case=self._testMethodName;EVENTS[self.case]={'commands':[],'observed':[]}
        self.origin=self.cmd('master_create',{'kind':'location','values':{'name':'Origem sintética QA','postalCode':'01001000','lat':-23.54,'lon':-46.64}})

    def tearDown(self):
        if self.mock:self.mock.close()
        self.tmp.cleanup()

    def cmd(self,name,values,actor=None):
        actor=actor or self.p
        try:
            result=self.e.execute(actor,name,values,uuid.uuid4().hex)
            EVENTS[self.case]['commands'].append({'command':name,'actor':actor.get('username','synthetic'),
                'resultKind':result.get('kind'),'resultId':result.get('id'),'resultStatus':result.get('status')})
            return result
        except Error as exc:
            EVENTS[self.case]['commands'].append({'command':name,'actor':actor.get('username','synthetic'),'domainError':exc.code})
            raise

    def observe(self,**values):EVENTS[self.case]['observed'].append(values)
    def read(self,oid,actor=None):return self.e.state(actor or self.p,oid)
    def values(self,external,packs=None,charge='5.40'):
        packs=deepcopy(packs or PACKS)
        quote=self.cmd('quote',{'originCep':'01001000','destinationCep':'01310100','packages':packs})
        destination=self.cmd('master_create',{'kind':'location','values':{'name':'Destino pet fictício '+external,'postalCode':'01310100','lat':-23.55,'lon':-46.65,
            'addressLine':'Rua Exemplo Pet','number':'100','city':'São Paulo','uf':'SP','deliveryInstructions':'Somente teste sintético'}})
        return {'externalId':external,'quoteId':quote['id'],'candidate':0,'packages':packs,'consumerCharge':charge,
                'locationId':destination['id'],'windowStart':self.now.isoformat(),'windowEnd':(self.now+timedelta(hours=4)).isoformat()}
    def order(self,external,packs=None,charge='5.40'):return self.cmd('order_create',self.values(external,packs,charge))
    def release(self,order):return self.cmd('order_release',{'id':order['id'],'version':order['version']})
    def plan(self,orders):return self.cmd('plan',{'orderIds':[o['id'] for o in orders],'originLocationId':self.origin['id'],
        'start':self.now.isoformat(),'capacityKg':'100','speedKmh':'40'})
    def commit(self,plan):return self.cmd('plan_commit',{'id':plan['id'],'version':plan['version']})
    def resources(self):
        vehicle=self.cmd('fleet_create',{'type':'VEHICLE','name':'Van sintética QA','capacityKg':'100'},self.c)
        driver=self.cmd('fleet_create',{'type':'DRIVER','name':'Motorista sintético QA','licenseValidTo':'2030-01-01T00:00:00Z'},self.c)
        return vehicle,driver
    def award(self,ship,resources=None):
        vehicle,driver=resources or self.resources()
        tender=self.cmd('tender',{'shipmentId':ship['id'],'version':ship['version'],'carriers':[self.c['org']],
                               'expiresAt':(self.now+timedelta(hours=1)).isoformat()})
        self.cmd('offer_respond',{'id':tender['id'],'version':tender['version'],'decision':'ACCEPT','vehicleId':vehicle['id'],'driverId':driver['id']},self.c)
        return self.read(ship['id']), (vehicle,driver)
    def delivery(self,ship):
        if not self.mock:self.mock=self.e.start_mock()
        message=self.cmd('label_request',{'shipmentId':ship['id'],'version':ship['version']},self.c)
        self.cmd('outbox_process',{'id':message['id'],'version':message['version']},self.c)
        policy=self.cmd('fiscal_policy',{'name':'Fiscal QA somente DEMO','scenario':'QA_SYNTHETIC','mode':'DEMO_ONLY','requirements':['DEMO_DOCUMENT']},self.c)
        ship=self.read(ship['id'])
        document=self.cmd('fiscal_evaluate',{'shipmentId':ship['id'],'version':ship['version'],'policyId':policy['id'],'scenario':'QA_SYNTHETIC'},self.c)
        message=self.read(document['outboxId'],self.c)
        self.cmd('outbox_process',{'id':message['id'],'version':message['version']},self.c)
        for stage in ['PICKUP','HUB','TRANSFER','LAST_MILE','DELIVERY']:
            ship=self.read(ship['id'])
            self.cmd('stage',{'shipmentId':ship['id'],'version':ship['version'],'stage':stage,'packageKeys':[x['key'] for x in ship['packages']]},self.c)
        return self.read(ship['id'])
    def pod(self,ship,keys,proof):return self.cmd('pod',{'shipmentId':ship['id'],'version':ship['version'],'proofId':proof,'packageKeys':keys,
        'outcome':'DELIVERED','reason':'Prova fictícia QA','occurredAt':self.now.isoformat()},self.c)
    def approver(self):
        account=next(a for a in self.fixture['accounts'] if a['username']=='loja.aprovador')
        return self.e.login(account['username'],account['password'])['user']
    def posted_invoice(self):
        order=self.release(self.order('PY-MONEY'))
        ship,_=self.award(self.commit(self.plan([order])))
        ship=self.delivery(ship);self.pod(ship,[x['key'] for x in ship['packages']],'PY-MONEY-POD')
        assignment=self.read(ship['assignmentId'])
        invoice=self.cmd('invoice_create',{'assignments':[assignment['id']],'number':'PY-MONEY-INVOICE','amount':assignment['price']},self.c)
        tolerance=self.cmd('tolerance',{'name':'Zero QA','fixed':'0','percent':'0'})
        invoice=self.cmd('invoice_audit',{'id':invoice['id'],'version':invoice['version'],'toleranceId':tolerance['id']})
        approval=self.cmd('approval_request',{'invoiceId':invoice['id'],'version':invoice['version']})
        approval=self.cmd('approval_decide',{'id':approval['id'],'version':approval['version'],'decision':'APPROVE'},self.approver())
        entry=next(x for x in self.e.state(self.p)['objects'] if x['id'] in approval['entryIds'] and x['side']=='AP')
        return invoice,entry

    def test_PY01_released_order_can_be_edited_and_planned(self):
        order=self.release(self.order('PY01'))
        changed=self.cmd('order_change',{'id':order['id'],'version':order['version'],'operation':'EDIT','values':self.values('IGNORED-ID',EDITED,'7.50')})
        self.assertEqual(changed['externalId'],'PY01');self.assertEqual(changed['status'],'VALIDATED')
        self.assertEqual(changed['contentVersion'],2);self.assertEqual(changed['consumerCharge'],'7.50')
        self.assertEqual(changed['revisions'][0]['quoteId'],order['quoteId'])
        ship=self.commit(self.plan([self.release(changed)]))
        self.assertEqual(Decimal(ship['weightKg']),Decimal('6'));self.assertEqual(ship['cost'],'22.00')
        self.assertEqual(len(ship['packages']),2)
        self.observe(externalId=changed['externalId'],contentVersion=changed['contentVersion'],charge=changed['consumerCharge'],shipmentWeight=ship['weightKg'],cost=ship['cost'])

    def test_PY02_edit_consolidated_order_releases_sibling_and_rebooks(self):
        first=self.release(self.order('PY02-A'));sibling=self.release(self.order('PY02-B'))
        ship=self.commit(self.plan([first,sibling]));before=deepcopy(ship)
        current=self.read(first['id'])
        edited=self.cmd('order_change',{'id':current['id'],'version':current['version'],'operation':'EDIT','values':self.values('PY02-A',EDITED)})
        old=self.read(ship['id']);other=self.read(sibling['id'])
        self.assertEqual(old['status'],'CANCELLED');self.assertEqual(old['packages'],before['packages']);self.assertEqual(old['stops'],before['stops'])
        self.assertEqual(other['status'],'RELEASED');self.assertEqual(other['shipmentIds'],[])
        replacement=self.commit(self.plan([self.release(edited),other]))
        self.assertEqual(len(replacement['packages']),4);self.assertEqual(len({x['key'] for x in replacement['packages']}),4)
        self.assertEqual(Decimal(replacement['weightKg']),Decimal('11'))
        self.observe(oldShipment=old['status'],sibling=other['status'],newVolumes=len(replacement['packages']),newWeight=replacement['weightKg'])

    def test_PY03_cancel_after_award_requires_resolution_and_frees_resources(self):
        first=self.release(self.order('PY03-A'));sibling=self.release(self.order('PY03-B'))
        ship,resources=self.award(self.commit(self.plan([first,sibling])))
        current=self.read(first['id']);proposal=self.cmd('order_change',{'id':current['id'],'version':current['version'],'operation':'CANCEL','reason':'Cancelar um pedido da carga'})
        self.assertEqual(proposal['status'],'APPROVAL_REQUIRED');self.assertEqual(self.read(ship['id'])['status'],'ASSIGNED')
        self.cmd('change_resolve',{'id':proposal['id'],'version':proposal['version']})
        sibling=self.read(sibling['id']);self.assertEqual(sibling['status'],'RELEASED');self.assertEqual(sibling['shipmentIds'],[])
        with self.e.db() as db:old_reservations=[x for x in self.e.all(db,'reservation') if x['shipmentId']==ship['id']]
        self.assertTrue(old_reservations);self.assertTrue(all(x['status']=='RELEASED' for x in old_reservations))
        replacement,_=self.award(self.commit(self.plan([sibling])),resources)
        self.assertEqual(replacement['status'],'ASSIGNED');self.assertEqual(self.read(ship['assignmentId'])['status'],'CANCELLED')
        self.observe(proposal=proposal['status'],oldShipment=self.read(ship['id'])['status'],newShipment=replacement['status'],resourcesReused=True)

    def test_PY04_edited_mass_to_partial_full_delivery_finance_and_compensation(self):
        order=self.release(self.order('PY04'))
        order=self.cmd('order_change',{'id':order['id'],'version':order['version'],'operation':'EDIT','values':self.values('PY04',EDITED,'7.50')})
        ship,_=self.award(self.commit(self.plan([self.release(order)])))
        ship=self.delivery(ship);first_payload={'shipmentId':ship['id'],'version':ship['version'],'proofId':'PY04-FIRST','packageKeys':[ship['packages'][0]['key']],
            'outcome':'DELIVERED','reason':'Primeiro volume fictício','occurredAt':self.now.isoformat()}
        first=self.cmd('pod',first_payload,self.c);partial=self.read(ship['id']);self.assertEqual(partial['status'],'PARTIAL')
        replay=self.cmd('pod',first_payload,self.c);self.assertEqual(replay['id'],first['id']);self.assertEqual(self.read(ship['id'])['version'],partial['version'])
        with self.assertRaisesRegex(Error,'ALREADY_DELIVERED'):
            self.pod(partial,[partial['packages'][0]['key']],'PY04-DUPLICATE-VOLUME')
        self.pod(partial,[partial['packages'][1]['key']],'PY04-REMAINING');done=self.read(ship['id']);self.assertEqual(done['status'],'DELIVERED')
        assignment=self.read(done['assignmentId']);invoice=self.cmd('invoice_create',{'assignments':[assignment['id']],'number':'PY04-INVOICE','amount':str(Decimal(assignment['price'])+Decimal('1.17'))},self.c)
        tolerance=self.cmd('tolerance',{'name':'Zero QA','fixed':'0','percent':'0'})
        invoice=self.cmd('invoice_audit',{'id':invoice['id'],'version':invoice['version'],'toleranceId':tolerance['id']});self.assertEqual(invoice['status'],'DISPUTED')
        self.cmd('dispute_resolve',{'id':invoice['disputeId'],'version':1,'decision':'ADJUST_TO_EXPECTED','reason':'Conferência sintética'})
        invoice=self.read(invoice['id']);self.assertEqual(invoice['amount'],'22.00');self.assertEqual(invoice['originalAmount'],'23.17')
        approval=self.cmd('approval_request',{'invoiceId':invoice['id'],'version':invoice['version']})
        self.cmd('approval_decide',{'id':approval['id'],'version':approval['version'],'decision':'APPROVE'},self.approver())
        order=self.read(order['id']);before=self.read(done['id']);proofs_before=[x for x in self.e.state(self.p)['objects'] if x['kind']=='pod']
        proposal=self.cmd('order_change',{'id':order['id'],'version':order['version'],'operation':'CANCEL','reason':'Compensar sem apagar execução'})
        self.assertEqual(proposal['status'],'COMPENSATION_REQUIRED')
        self.cmd('change_resolve',{'id':proposal['id'],'version':proposal['version'],'resolution':'Histórico operacional e financeiro preservados'})
        self.assertEqual(self.read(done['id']),before);self.assertEqual([x for x in self.e.state(self.p)['objects'] if x['kind']=='pod'],proofs_before)
        self.assertEqual(self.read(invoice['id'])['status'],'POSTED_LOCAL')
        self.observe(ship=before['status'],proofs=len(proofs_before),invoiceOriginal='23.17',invoiceAdjusted='22.00',postExecutionChange=proposal['status'],historyPreserved=True)

    def test_PY05_plan_commit_after_quote_expiry_is_rejected(self):
        order=self.release(self.order('PY05'));plan=self.plan([order])
        self.now+=timedelta(minutes=16)
        error=None;result=None
        try:result=self.commit(plan)
        except Error as exc:error=exc.code
        current=self.read(plan['id'])
        with self.e.db() as db:shipments=self.e.all(db,'shipment')
        self.observe(clock=self.now.isoformat(),quoteExpiresAt=self.read(order['quoteId'])['expiresAt'],error=error,
                     resultStatus=result.get('status') if result else None,planStatus=current['status'],shipments=len(shipments))
        self.assertIsNotNone(error,'Plano expirado foi comprometido sem recotação')
        self.assertIn(error,{'QUOTE_EXPIRED','QUOTE_STALE','PLAN_EXPIRED'})
        self.assertEqual(current['status'],'FEASIBLE');self.assertEqual(shipments,[])

    def test_PY06_subcent_settlement_cannot_create_zero_approval(self):
        invoice,entry=self.posted_invoice()
        control=self.cmd('settlement_request',{'entryId':entry['id'],'amount':'0.01','reason':'Controle positivo de um centavo'})
        self.assertEqual(control['amount'],'0.01')
        error=None;result=None
        try:result=self.cmd('settlement_request',{'entryId':entry['id'],'amount':'0.004','reason':'Valor menor que centavo que arredonda a zero'})
        except Error as exc:error=exc.code
        with self.e.db() as db:requests=[x for x in self.e.all(db,'approval') if x['type']=='SETTLEMENT']
        self.observe(input='0.004',halfUpExpected='0.00',error=error,createdApprovalAmount=result.get('amount') if result else None,
                     settlementApprovalAmounts=[x['amount'] for x in requests])
        self.assertIsNotNone(error,'Baixa subcentavo criou aprovação financeira arredondada a zero')
        self.assertEqual([x['amount'] for x in requests],['0.01'])

    def test_PY07_invalid_edit_rolls_back_previously_planned_mass(self):
        first=self.release(self.order('PY07-A'));other=self.release(self.order('PY07-B'));ship=self.commit(self.plan([first,other]))
        before=[self.read(x) for x in [first['id'],other['id'],ship['id']]]
        invalid=self.values('PY07-A',EDITED);invalid['quoteId']=first['quoteId']
        with self.assertRaisesRegex(Error,'QUOTE_CONTENT_MISMATCH'):
            self.cmd('order_change',{'id':first['id'],'version':before[0]['version'],'operation':'EDIT','values':invalid})
        after=[self.read(x) for x in [first['id'],other['id'],ship['id']]]
        self.assertEqual(after,before)
        self.observe(error='QUOTE_CONTENT_MISMATCH',orderSiblingShipmentExactlyPreserved=True)

    def test_PY08_cancel_and_recreate_external_order_keeps_one_active_charge(self):
        first=self.order('PY08',charge='5.40')
        cancelled=self.cmd('order_change',{'id':first['id'],'version':first['version'],'operation':'CANCEL'})
        replacement=self.order('PY08',EDITED,'7.50')
        self.assertNotEqual(first['id'],replacement['id']);self.assertEqual(self.read(first['id'])['status'],'CANCELLED')
        with self.e.db() as db:orders=[x for x in self.e.all(db,'order') if x['externalId']=='PY08']
        active=[x for x in orders if x['status']!='CANCELLED']
        self.assertEqual(len(orders),2);self.assertEqual(len(active),1);self.assertEqual(sum(Decimal(x['consumerCharge']) for x in active),Decimal('7.50'))
        self.assertEqual(cancelled['revisions'][0]['consumerCharge'],'5.40')
        self.observe(historyOrders=len(orders),activeOrders=len(active),activeCharge=active[0]['consumerCharge'],oldStatus=cancelled['status'])


    def test_PY09_cancel_offered_order_cannot_revive_cancelled_shipment(self):
        order=self.release(self.order('PY09'));ship=self.commit(self.plan([order]));vehicle,driver=self.resources()
        tender=self.cmd('tender',{'shipmentId':ship['id'],'version':ship['version'],'carriers':[self.c['org']],
            'expiresAt':(self.now+timedelta(hours=1)).isoformat()})
        current=self.read(order['id'])
        self.cmd('order_change',{'id':current['id'],'version':current['version'],'operation':'CANCEL','reason':'Cancelamento durante oferta'})
        before=self.read(ship['id']);offer=self.read(tender['id'],self.c)
        self.observe(shipmentAfterCancel=before['status'],tenderAfterCancel=offer['status'])
        self.assertEqual(before['status'],'CANCELLED');self.assertEqual(offer['status'],'CANCELLED')
        with self.assertRaises(Error):
            self.cmd('offer_respond',{'id':offer['id'],'version':offer['version'],'decision':'ACCEPT','vehicleId':vehicle['id'],'driverId':driver['id']},self.c)
        self.assertEqual(self.read(ship['id']),before)


if __name__=='__main__':unittest.main(verbosity=2)
