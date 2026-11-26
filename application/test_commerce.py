import unittest,tempfile,uuid
from pathlib import Path
from datetime import datetime,timedelta
from copy import deepcopy
from engine import Engine
from commerce import Commerce,allocate_charge,money_cents
from seed import seed
from core import Error
if issubclass(Engine,Commerce):
 CheckoutEngine=Engine
else:
 class CheckoutEngine(Commerce,Engine):pass
class CommerceTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.now=datetime.fromisoformat('2026-11-26T16:00:00+00:00');self.e=CheckoutEngine(Path(self.tmp.name)/'test.sqlite',lambda:self.now);self.p=seed(self.e)['shipper']
  self.location=self.cmd('master_create',{'kind':'location','values':{'name':'Destino sintetico','postalCode':'01310100','lat':-23.55,'lon':-46.65}})
 def tearDown(self):self.tmp.cleanup()
 def cmd(self,n,d,key=None):return self.e.execute(self.p,n,d,key or uuid.uuid4().hex)
 def child(self,i,weight):
  packs=[dict(id='P1',weightKg=weight,lengthCm='20',widthCm='20',heightCm='20')];q=self.cmd('quote',dict(originCep=['01001000','02002000'][i],destinationCep='01310100',packages=packs))
  return dict(externalId='child-'+str(i),quoteId=q['id'],candidate=0,packages=packs,locationId=self.location['id'],windowStart=self.now.isoformat(),windowEnd=(self.now+timedelta(hours=3)).isoformat())
 def payload(self,charge='5.40'):return dict(externalId='checkout',consumerCharge=charge,children=[self.child(0,'2'),self.child(1,'5')])
 def test_two_origins_one_charge_replay_cancel(self):
  d=self.payload();parent=self.cmd('checkout_create',d,'same');self.assertEqual(parent,self.cmd('checkout_create',d,'same'));self.assertEqual(parent['logisticCost'],'34.00');self.assertEqual([x['consumerCharge'] for x in parent['allocations']],['2.22','3.18'])
  children=[self.e.state(self.p,x) for x in parent['orderIds']];self.assertEqual(sum(money_cents(x['consumerCharge']) for x in children),540);self.assertEqual(len(set(x['originCep'] for x in children)),2)
  cancelled=self.cmd('checkout_cancel',dict(id=parent['id'],version=parent['version']));self.assertEqual(cancelled['status'],'CANCELLED');self.assertTrue(all(self.e.state(self.p,x)['status']=='CANCELLED' for x in parent['orderIds']))
 def test_allocation_cent_zero_equal_and_large_integer(self):
  self.assertEqual(allocate_charge(1,[1,1]),[1,0]);self.assertEqual(allocate_charge(5,[0,0,0]),[2,2,1]);self.assertEqual(allocate_charge(0,[10,20]),[0,0]);self.assertEqual(sum(allocate_charge(999999999999,[999999999999,999999999998])),999999999999)
 def test_invalid_money_childcharge_and_rollback(self):
  d=self.payload()
  for value in ['1.001','-1','1e2',1.0,'NaN',' 1']:
   with self.subTest(value=value),self.assertRaises(Error):self.cmd('checkout_create',{**d,'consumerCharge':value})
  for mutate in [lambda x:x['children'][1].update(consumerCharge='1'),lambda x:x['children'][1].update(packages=[]),lambda x:x['children'][1].update(externalId=x['children'][0]['externalId'])]:
   bad=deepcopy(d);mutate(bad)
   with self.assertRaises(Error):self.cmd('checkout_create',bad)
   with self.e.db() as db:self.assertEqual(self.e.all(db,'checkout'),[]);self.assertEqual(self.e.all(db,'order'),[])
 def test_destination_expiry_and_version_guards(self):
  d=self.payload();other=self.cmd('master_create',{'kind':'location','values':{'name':'Outro destino','postalCode':'01310100','lat':-23.56,'lon':-46.66}})
  bad=deepcopy(d);bad['children'][1]['locationId']=other['id']
  with self.assertRaisesRegex(Error,'CHECKOUT_DESTINATION_MISMATCH'):self.cmd('checkout_create',bad)
  self.now+=timedelta(minutes=16)
  with self.assertRaisesRegex(Error,'QUOTE_EXPIRED'):self.cmd('checkout_create',d)
  self.now-=timedelta(minutes=16);parent=self.cmd('checkout_create',d)
  with self.assertRaisesRegex(Error,'VERSION_CONFLICT'):self.cmd('checkout_cancel',dict(id=parent['id'],version=0))
 def test_progressed_child_blocks_cancel_and_duplicate_parent(self):
  d=self.payload('0');parent=self.cmd('checkout_create',d);child=self.e.state(self.p,parent['orderIds'][0]);self.cmd('order_release',dict(id=child['id'],version=child['version']))
  before=self.e.state(self.p)
  with self.assertRaisesRegex(Error,'CHECKOUT_CANCEL_BLOCKED'):self.cmd('checkout_cancel',dict(id=parent['id'],version=parent['version']))
  self.assertEqual(self.e.state(self.p),before)
  with self.assertRaisesRegex(Error,'DUPLICATE_CHECKOUT'):self.cmd('checkout_create',d)
if __name__=='__main__':unittest.main(verbosity=2)
