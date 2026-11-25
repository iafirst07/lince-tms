import json,time,hashlib,subprocess,sys,sqlite3
from decimal import Decimal
from test_a import Base
import test_b
from integrations import signature
from core import canonical

class TestsC(Base):
    order=test_b.TestsB.order;ship=test_b.TestsB.ship;resources=test_b.TestsB.resources;award=test_b.TestsB.award
    def setUp(self):super().setUp();self.mock=self.e.start_mock()
    def tearDown(self):self.mock.close();super().tearDown()
    def process(self,o,p=None):return self.cmd('outbox_process',{'id':o['id'],'version':o['version']},p)
    def test_process_exit_after_remote_accept_requires_query(self):
        msg=self.cmd('adapter_enqueue',{'adapter':'MAPS','payload':{'locations':[{'lat':0,'lon':0},{'lat':1,'lon':1}]}})
        script="""import sys,json,os
from engine import Engine
from types import SimpleNamespace
from datetime import datetime
e=Engine(sys.argv[1],lambda:datetime.fromisoformat(sys.argv[6]));e.mock=SimpleNamespace(url=sys.argv[2],key=sys.argv[3]);original=e.mock_request
def crash(m,query=False):
 original(m,query);os._exit(42)
e.mock_request=crash
e.execute(json.loads(sys.argv[4]),'outbox_process',json.loads(sys.argv[5]),'child-crash')
"""
        child=subprocess.run([sys.executable,'-c',script,str(self.e.path),self.mock.url,self.mock.key,json.dumps(self.p),json.dumps({'id':msg['id'],'version':msg['version']}),self.now.isoformat()],capture_output=True,timeout=15)
        self.assertEqual(child.returncode,42,child.stderr.decode());self.assertEqual(self.e.recover_outbox(),1)
        msg=self.e.state(self.p,msg['id']);self.assertEqual(msg['status'],'UNKNOWN');self.error('RECONCILE_OR_DLQ_REQUIRED',lambda:self.process(msg))
        result=self.cmd('outbox_query',{'id':msg['id'],'version':msg['version']});self.assertEqual(result['status'],'DONE')
        db=sqlite3.connect(self.mock.path)
        try:self.assertEqual(db.execute('SELECT count(*) FROM accepted WHERE id=?',(msg['messageId'],)).fetchone()[0],1)
        finally:db.close()
    def test_specific_oms_wms_erp_contracts_and_effects(self):
        from test_a import PACKS
        q=self.quote();loc=self.cmd('master_create',{'kind':'location','values':{'name':'Destino OMS','postalCode':'01310100','lat':-23.55,'lon':-46.65}})
        order={'externalId':'OMS1','quoteId':q['id'],'candidate':0,'packages':PACKS,'consumerCharge':'5','locationId':loc['id'],'windowStart':'2026-11-25T16:00:00Z','windowEnd':'2026-11-25T22:00:00Z'}
        result=self.process(self.cmd('adapter_enqueue',{'adapter':'OMS','payload':{'order':order}}));self.assertEqual(self.e.state(self.p,result['importedOrderId'])['externalId'],'OMS1')
        s=self.ship();result=self.process(self.cmd('adapter_enqueue',{'adapter':'WMS','payload':{'shipmentId':s['id'],'custody':'READY'}}));self.assertEqual(self.e.state(self.p,s['id'])['wmsCustody'],'READY')
        with self.e.db(True) as db:entry=self.e.add(db,self.p,'ledger',{'side':'AP','amount':'10','status':'POSTED_LOCAL_ONLY'})
        result=self.process(self.cmd('adapter_enqueue',{'adapter':'ERP','payload':{'entryIds':[entry['id']],'reference':'DEMO1'}}));self.assertEqual(result['result']['reconciledEntryIds'],[entry['id']])
        self.assertTrue(any(x['kind']=='reconciliation' for x in self.e.state(self.p)['objects']))
        self.error('WMS_CUSTODY',lambda:self.cmd('adapter_enqueue',{'adapter':'WMS','payload':{'shipmentId':s['id'],'custody':'FAKE'}}))
        self.error('DEDICATED_WORKFLOW_REQUIRED',lambda:self.cmd('adapter_enqueue',{'adapter':'MAPS','targetId':s['id'],'purpose':'LABEL','payload':{}}))
    def test_connector_config_snapshot_and_custody_conservation(self):
        config=self.cmd('adapter_config_create',{'adapter':'MAPS','name':'Mapa laboratório v1','contractVersion':1,'mode':'LOCAL_MOCK'})
        message=self.cmd('adapter_enqueue',{'adapter':'MAPS','configId':config['id'],'payload':{'locations':[{'lat':0,'lon':0},{'lat':1,'lon':1}]}})
        self.assertEqual(message['configSnapshot']['id'],config['id']);self.assertEqual(message['provider'],config['name'])
        self.error('NOT_FOUND',lambda:self.cmd('adapter_enqueue',{'adapter':'MAPS','configId':config['id'],'payload':{'locations':[{'lat':0,'lon':0},{'lat':1,'lon':1}]}},self.c))
        s=self.ready_delivery();self.assertEqual([c['quantity'] for c in s['custody']],[len(s['packages'])]*5)
        self.error('CUSTODY_VOLUMES_MISMATCH',lambda:self.cmd('stage',{'shipmentId':s['id'],'version':s['version'],'stage':'DELIVERY','packageKeys':[]},self.c))
    def test_local_settlement_partial_reject_and_compensate(self):
        # Posting itself is covered end-to-end by the invoice test; this isolates balance decisions.
        with self.e.db(True) as db:
            inv=self.e.add(db,self.p,'invoice',{'issuerOrg':self.c['org'],'status':'POSTED_LOCAL'})
            apentry=self.e.add(db,self.p,'ledger',{'invoiceId':inv['id'],'amount':'20.00','side':'AP','type':'POST'})
            self.e.add(db,self.c,'ledger',{'invoiceId':inv['id'],'amount':'20.00','side':'AR','type':'POST'})
        account=next(x for x in self.seed['accounts'] if x['username']=='loja.aprovador');approver=self.e.login(account['username'],account['password'])['user']
        approval=self.cmd('settlement_request',{'entryId':apentry['id'],'amount':'12','reason':'Baixa fictícia'})
        self.error('SETTLEMENT_EXCEEDS_BALANCE',lambda:self.cmd('settlement_request',{'entryId':apentry['id'],'amount':'9','reason':'Excesso'}))
        approval=self.cmd('approval_decide',{'id':approval['id'],'version':1,'decision':'APPROVE'},approver)
        settlement=self.e.state(self.p,approval['settlementIds'][0]);self.assertEqual(settlement['remainingBalance'],'8.00');self.assertFalse(settlement['realPayment'])
        self.error('REVERSE_SETTLEMENT_FIRST',lambda:self.cmd('reverse_request',{'entryId':apentry['id'],'reason':'Antes da baixa'}))
        undo=self.cmd('settlement_reverse_request',{'settlementId':settlement['id'],'reason':'Correção local'});self.cmd('approval_decide',{'id':undo['id'],'version':1,'decision':'REJECT'},approver)
        undo=self.cmd('settlement_reverse_request',{'settlementId':settlement['id'],'reason':'Correção revisada'});self.cmd('approval_decide',{'id':undo['id'],'version':1,'decision':'APPROVE'},approver)
        self.assertEqual(sum(Decimal(s['amount']) for s in self.e.state(self.p)['objects'] if s['kind']=='settlement'),Decimal(0))
        self.assertEqual(self.cmd('reverse_request',{'entryId':apentry['id'],'reason':'Estorno após compensação'})['status'],'PENDING')
    def test_rateio_adjust_uses_original_weights_not_rounded_money(self):
        with self.e.db(True) as db:
            ship=self.e.add(db,self.p,'shipment',{'status':'DELIVERED','packages':[{'orderId':'A','weightKg':'1'},{'orderId':'B','weightKg':'2'}]})
            assignment=self.e.add(db,self.p,'assignment',{'shipmentId':ship['id'],'price':'20.00'})
            invoice=self.e.add(db,self.p,'invoice',{'issuerOrg':self.c['org'],'assignmentIds':[assignment['id']],'assignmentVersions':{assignment['id']:1},'amount':'0.01','status':'RECEIVED'})
        tol=self.cmd('tolerance',{'name':'Zero','fixed':'0','percent':'0'});inv=self.cmd('invoice_audit',{'id':invoice['id'],'version':1,'toleranceId':tol['id']})
        self.assertEqual(inv['allocation'],{'A':'0.00','B':'0.01'})
        self.cmd('dispute_resolve',{'id':inv['disputeId'],'version':1,'decision':'ADJUST_TO_EXPECTED','reason':'Correção'})
        self.assertEqual(self.e.state(self.p,inv['id'])['allocation'],{'A':'6.67','B':'13.33'})
    def ready_delivery(self):
        s=self.award();out=self.cmd('label_request',{'shipmentId':s['id'],'version':s['version']},self.c);self.process(out,self.c)
        policy=self.cmd('fiscal_policy',{'name':'Somente demo','scenario':'TESTE','mode':'DEMO_ONLY','requirements':['DEMO_DOCUMENT']},self.c)
        s=self.e.state(self.c,s['id']);doc=self.cmd('fiscal_evaluate',{'shipmentId':s['id'],'version':s['version'],'policyId':policy['id'],'scenario':'TESTE'},self.c)
        self.process(self.e.state(self.c,doc['outboxId']),self.c)
        for stage in ['PICKUP','HUB','TRANSFER','LAST_MILE','DELIVERY']:
            s=self.e.state(self.c,s['id']);self.cmd('stage',{'shipmentId':s['id'],'version':s['version'],'stage':stage,'packageKeys':[x['key'] for x in s['packages']]},self.c)
        return self.e.state(self.c,s['id'])
    def test_mock_unknown_query_and_crash_recovery(self):
        s=self.award();out=self.cmd('label_request',{'shipmentId':s['id'],'version':s['version'],'mode':'LOST_RESPONSE'},self.c)
        m=self.process(out,self.c);self.assertEqual(m['status'],'UNKNOWN');self.error('RECONCILE_OR_DLQ_REQUIRED',lambda:self.process(m,self.c))
        m=self.cmd('outbox_query',{'id':m['id'],'version':m['version']},self.c);self.assertEqual(m['status'],'DONE');self.assertEqual(self.e.state(self.c,s['id'])['labelStatus'],'READY')
        msg=self.cmd('adapter_enqueue',{'adapter':'MAPS','payload':{'locations':[{'lat':0,'lon':0},{'lat':1,'lon':1}]}})
        self.e.test_crash_after_effect=True
        with self.assertRaises(SystemExit):self.process(msg)
        self.e.test_crash_after_effect=False;self.assertEqual(self.e.recover_outbox(),1);msg=self.e.state(self.p,msg['id']);self.assertEqual(msg['status'],'UNKNOWN')
        msg=self.cmd('outbox_query',{'id':msg['id'],'version':msg['version']});self.assertEqual(msg['status'],'DONE');self.assertEqual(len(msg['result']['distanceKm']),2)
    def test_callback_signature_dedup_and_dlq(self):
        payload={'event':'DEMO'};ts=int(time.time());body=canonical({'source':'OMS','message':'id1','payload':payload}).encode();sig=signature(self.mock.key,ts,body)
        self.error('SIGNATURE_INVALID',lambda:self.e.receive_callback('OMS','id1',payload,ts,'bad'))
        self.assertEqual(self.e.receive_callback('OMS','id1',payload,ts,sig)['status'],'RECEIVED_LOCAL_ONLY')
        self.assertEqual(self.e.receive_callback('OMS','id1',payload,ts,sig)['status'],'DUPLICATE_NO_EFFECT')
        m=self.cmd('adapter_enqueue',{'adapter':'MAPS','mode':'BEFORE_FAILURE','payload':{'locations':[{'lat':0,'lon':0},{'lat':1,'lon':1}]}})
        for _ in range(3):m=self.process(m)
        self.assertEqual(m['status'],'DLQ');self.error('RECONCILE_OR_DLQ_REQUIRED',lambda:self.process(m))
    def test_invoice_ledger_segregation_and_reversal(self):
        s=self.ready_delivery();self.cmd('pod',{'shipmentId':s['id'],'version':s['version'],'proofId':'POD','packageKeys':[x['key'] for x in s['packages']],'outcome':'DELIVERED','reason':'Demo','occurredAt':self.now.isoformat()},self.c)
        inv=self.cmd('invoice_create',{'assignments':[s['assignmentId']],'number':'F1','amount':'21'},self.c)
        tol=self.cmd('tolerance',{'name':'Zero','fixed':'0','percent':'0'});inv=self.cmd('invoice_audit',{'id':inv['id'],'version':1,'toleranceId':tol['id']});self.assertEqual(inv['status'],'DISPUTED');self.assertEqual(sum(Decimal(v) for v in inv['allocation'].values()),Decimal('21'))
        dispute=self.e.state(self.p,inv['disputeId']);self.cmd('dispute_resolve',{'id':dispute['id'],'version':1,'decision':'ADJUST_TO_EXPECTED','reason':'Conferido'});inv=self.e.state(self.p,inv['id']);self.assertEqual(inv['difference'],'0.00');self.assertEqual(inv['originalDifference'],'1.00');approval=self.cmd('approval_request',{'invoiceId':inv['id'],'version':inv['version']})
        account=next(x for x in self.seed['accounts'] if x['username']=='loja.aprovador');ap=self.e.login(account['username'],account['password'])['user'];self.error('ROLE_FORBIDDEN',lambda:self.cmd('approval_decide',{'id':approval['id'],'version':1,'decision':'APPROVE'}))
        self.cmd('approval_decide',{'id':approval['id'],'version':1,'decision':'REJECT'},ap)
        inv=self.e.state(self.p,inv['id']);self.assertEqual(inv['status'],'AUDITED');approval=self.cmd('approval_request',{'invoiceId':inv['id'],'version':inv['version']})
        done=self.cmd('approval_decide',{'id':approval['id'],'version':1,'decision':'APPROVE'},ap);self.assertEqual(done['status'],'APPROVED')
        entry=next(x for x in self.e.state(self.p)['objects'] if x['kind']=='ledger');rev=self.cmd('reverse_request',{'entryId':entry['id'],'reason':'Estorno local'});self.cmd('approval_decide',{'id':rev['id'],'version':1,'decision':'REJECT'},ap);rev=self.cmd('reverse_request',{'entryId':entry['id'],'reason':'Reavaliado'});self.cmd('approval_decide',{'id':rev['id'],'version':1,'decision':'APPROVE'},ap)
        with self.e.db() as db:
            entries=self.e.all(db,'ledger')
            for reversal in [e for e in entries if e['type']=='REVERSE']:
                original=next(e for e in entries if e['id']==reversal['reverses']);self.assertEqual(original['side'],reversal['side']);self.assertEqual(original['org'],reversal['org'])
        self.assertEqual(sum(Decimal(x['amount']) for x in self.e.state(self.p)['objects'] if x['kind']=='ledger'),Decimal(0))

if __name__=='__main__':__import__('unittest').main(verbosity=2)
