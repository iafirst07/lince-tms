import unittest,tempfile,uuid,copy
from pathlib import Path
from datetime import datetime
from engine import Engine
from seed import seed
from volumetric import calculation,validate_policy
from core import Error
POLICY=dict(id='VOLUMETRIC_MAX_TOTAL_KG_V1',dimensionUnit='CM',divisorCm3PerKg='6000',rounding='CEILING_0_001_KG',aggregation='MAX_OF_TOTAL_REAL_AND_TOTAL_VOLUMETRIC',minimumBillableKg='0.000')
PACK=dict(id='P',weightKg='2',lengthCm='100',widthCm='100',heightCm='100')
class VolumetricTests(unittest.TestCase):
 def test_exact_policy_and_invalid_values(self):
  memory=calculation([PACK],POLICY);self.assertEqual(memory['billableKg'],'166.667');self.assertEqual(memory['volumetricKgRaw'],dict(numerator='500',denominator='3'))
  self.assertEqual(calculation([{**PACK,'weightKg':'200'}],POLICY)['billableKg'],'200.000')
  mixed=[{**PACK,'weightKg':'100','lengthCm':'1','widthCm':'1','heightCm':'1'},{**PACK,'id':'P2','weightKg':'1','lengthCm':'100','widthCm':'100','heightCm':'60'}]
  self.assertEqual(calculation(mixed,POLICY)['billableKg'],'101.000')
  self.assertEqual(calculation([{**PACK,'lengthCm':'0.000001','widthCm':'0.000001','heightCm':'0.000001'}],POLICY)['volumeCm3'],'0.000000000000000001')
  for fields in [dict(divisorCm3PerKg='0'),dict(divisorCm3PerKg='-1'),dict(divisorCm3PerKg=6000),dict(dimensionUnit='M'),dict(rounding='ROUND'),dict(extra=1)]:
   with self.subTest(fields=fields),self.assertRaises(Error):validate_policy({**POLICY,**fields})
 def test_real_engine_legacy_optin_snapshot_and_coverage(self):
  with tempfile.TemporaryDirectory() as tmp:
   e=Engine(Path(tmp)/'t.sqlite',lambda:datetime.fromisoformat('2026-11-26T16:00:00+00:00'));p=seed(e)['shipper']
   def cmd(n,d):return e.execute(p,n,d,uuid.uuid4().hex)
   request=dict(originCep='01001000',destinationCep='01310100',packages=[PACK]);old=cmd('quote',request);self.assertEqual(old['candidates'][0]['cost'],'14.00');self.assertNotIn('weightCalculation',old['candidates'][0])
   rate=copy.deepcopy(old['candidates'][0]['rateSnapshot']);data={k:v for k,v in rate.items() if k not in ['id','kind','org','version','createdAt','createdBy','publishedAt','status']};data.update(priority=100,maxKg='1000',volumetricPolicy=POLICY)
   draft=cmd('rate_create',data);cmd('rate_publish',dict(id=draft['id'],version=draft['version']))
   quoted=cmd('quote',request);candidate=next(x for x in quoted['candidates'] if x['rateId']==draft['id']);self.assertEqual(candidate['cost'],'343.33');self.assertEqual(candidate['weightCalculation']['billableKg'],'166.667');self.assertEqual(quoted['weightKg'],'2');self.assertEqual(e.state(p,old['id']),old)
   newer={**data,'priority':101,'volumetricPolicy':{**POLICY,'divisorCm3PerKg':'5000'}};d=cmd('rate_create',newer);cmd('rate_publish',dict(id=d['id'],version=d['version']));self.assertEqual(e.state(p,quoted['id']),quoted)
   with self.assertRaisesRegex(Error,'NO_ELIGIBLE_COVERAGE'):cmd('quote',{**request,'destinationCep':'99999999'})
   with self.assertRaises(Error):cmd('quote',{**request,'packages':[{**PACK,'weightKg':'0'}]})
if __name__=='__main__':unittest.main(verbosity=2)
