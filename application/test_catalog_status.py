"""Synthetic configurable-catalog lifecycle; no permission campaign or external IO."""
import copy,tempfile,unittest,uuid
from pathlib import Path
from datetime import datetime,timezone
from core import Error
from engine import Engine
from seed import seed
class CatalogStatusTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.e=Engine(Path(self.temp.name)/'catalog.sqlite',lambda:datetime(2026,11,26,12,tzinfo=timezone.utc));self.fixture=seed(self.e);self.p=self.fixture['shipper']
  self.loc=self.master('location',dict(name='Destino ensaio',postalCode='01001000',lat=-23.55,lon=-46.63));self.origin=self.master('location',dict(name='Origem ensaio',postalCode='01002000',lat=-23.55,lon=-46.63));self.svc=self.row(self.fixture['serviceId']);self.cal=self.row(self.svc['calendarId']);self.zone=next(x for x in self.e.state(self.p)['objects'] if x['kind']=='zone')
  self.packages=[dict(id='V1',weightKg='1',lengthCm='10',widthCm='10',heightCm='10')]
 def tearDown(self):self.temp.cleanup()
 def cmd(self,a,d,p=None,key=None):return self.e.execute(p or self.p,a,d,key or uuid.uuid4().hex)
 def row(self,id):return next(x for x in self.e.state(self.p)['objects'] if x['id']==id)
 def master(self,kind,values):return self.cmd('master_create',dict(kind=kind,values=values))
 def status(self,o,status='INACTIVE',p=None):return self.cmd('fleet_update' if o['kind']=='resource' else 'master_update',dict(id=o['id'],version=self.row(o['id'])['version'],values=dict(status=status),reason='Retirada reversivel de ensaio'),p)
 def rejects(self,code,a,d):
  before=copy.deepcopy(self.e.state(self.p)['objects'])
  with self.assertRaises(Error) as ctx:self.cmd(a,d)
  self.assertEqual(ctx.exception.code,code);self.assertEqual(before,self.e.state(self.p)['objects'])
 def quote(self):return self.cmd('quote',dict(originCep='01002000',destinationCep='01001000',packages=self.packages))
 def orderdata(self,q):return dict(externalId=uuid.uuid4().hex,quoteId=q['id'],candidate=0,packages=q['packages'],locationId=self.loc['id'],windowStart='2026-11-26T13:00:00Z',windowEnd='2026-11-27T23:00:00Z',consumerCharge='5.40')
 def test_lifecycle_all_four_and_persistent_history(self):
  for obj in [self.loc,self.zone,self.svc,self.cal]:
   vals={k:copy.deepcopy(v) for k,v in obj.items() if k not in ['id','kind','org','createdAt','createdBy','version','status','history']};vals['name']+=' editado';edited=self.cmd('master_update',dict(id=obj['id'],version=obj['version'],values=vals));off=self.status(edited);self.assertEqual(off['status'],'INACTIVE');on=self.status(off,'ACTIVE');self.assertEqual(on['id'],obj['id']);self.assertGreaterEqual(len(on['history']),3)
 def test_new_quote_and_old_quote_new_order_rejected_after_zone_service_calendar(self):
  for obj in [self.zone,self.svc,self.cal]:
   q=self.quote();self.status(obj);self.rejects('NO_ELIGIBLE_COVERAGE','quote',dict(originCep='01002000',destinationCep='01001000',packages=self.packages));self.rejects('MASTER_INACTIVE','order_create',self.orderdata(q));self.status(obj,'ACTIVE')
 def test_snapshot_preserved_and_plan_commit_origin_gate(self):
  q=self.quote();o=self.cmd('order_create',self.orderdata(q));snapshot=copy.deepcopy(o['destinationSnapshot']);self.status(self.loc);self.rejects('MASTER_INACTIVE','order_create',self.orderdata(q));self.rejects('MASTER_INACTIVE','dock_create',dict(locationId=self.loc['id'],name='Doca ensaio',capacity=1,timezone='UTC'));self.cmd('order_release',dict(id=o['id'],version=o['version']));payload=dict(orderIds=[o['id']],originLocationId=self.origin['id'],start='2026-11-26T13:00:00Z',capacityKg='100',speedKmh='40');plan=self.cmd('plan',payload);self.assertEqual(self.row(o['id'])['destinationSnapshot'],snapshot);self.status(self.origin);self.rejects('MASTER_INACTIVE','plan',payload);self.rejects('MASTER_INACTIVE','plan_commit',dict(id=plan['id'],version=plan['version']))
 def test_invalid_mixed_stale_and_reason_are_atomic(self):
  o=self.loc;self.rejects('INVALID_STATUS_UPDATE','master_update',dict(id=o['id'],version=o['version'],values=dict(status='INACTIVE',name='misturado'),reason='x'));self.rejects('INVALID_STATUS_UPDATE','master_update',dict(id=o['id'],version=o['version'],values=dict(status='DELETED'),reason='x'));self.rejects('INVALID_TEXT','master_update',dict(id=o['id'],version=o['version'],values=dict(status='INACTIVE')));self.status(o);self.rejects('VERSION_CONFLICT','master_update',dict(id=o['id'],version=o['version'],values=dict(status='ACTIVE'),reason='x'))
 def test_inactive_calendar_new_service_and_restore_guard(self):
  self.status(self.cal);self.rejects('MASTER_INACTIVE','master_create',dict(kind='service',values=dict(name='Novo ensaio',calendarId=self.cal['id'],transitDays=1,maxPackageKg='10',maxShipmentKg='20')));off=self.status(self.svc);self.rejects('MASTER_INACTIVE','master_update',dict(id=off['id'],version=off['version'],values=dict(status='ACTIVE'),reason='x'))
 def test_free_fleet_and_reserved_maintenance_guards(self):
  v=self.cmd('fleet_create',dict(type='VEHICLE',name='Van ensaio',capacityKg='100',fleetMode='OWN'));self.status(v);self.status(v,'ACTIVE');self.cmd('maintenance',dict(resourceId=v['id'],start='2026-11-27T13:00:00Z',end='2026-11-27T15:00:00Z',reason='Ensaio'));self.rejects('RESOURCE_MAINTENANCE','fleet_update',dict(id=v['id'],version=self.row(v['id'])['version'],values=dict(status='INACTIVE'),reason='x'))
 def test_reverse_destination_inactive_is_atomic_and_restore_works(self):
  from test_driver_tasks import Fake,OWNER
  e=Fake();e.objects['loc']['status']='INACTIVE';before=copy.deepcopy(e.objects);d=dict(id='r',version=1,destinationLocationId='loc',windowStart='2026-11-26T10:00:00Z',windowEnd='2026-11-26T12:00:00Z',reason='Ensaio')
  with self.assertRaises(Error) as ctx:e.cmd_return_assign(None,OWNER,d)
  self.assertEqual(ctx.exception.code,'MASTER_INACTIVE');self.assertEqual(e.objects,before);e.objects['loc']['status']='ACTIVE';self.assertEqual(e.cmd_return_assign(None,OWNER,d)['destinationSnapshot']['postalCode'],'03003000')
 def test_legacy_missing_status_and_reason_limit(self):
  self.rejects('INVALID_TEXT','master_update',dict(id=self.loc['id'],version=self.loc['version'],values=dict(status='INACTIVE'),reason='x'*129))
  with self.e.db() as db:
   loc=self.e.get(db,self.p,self.loc['id'],'location',True);loc.pop('status');self.e.save(db,loc)
  self.assertTrue(self.cmd('order_create',self.orderdata(self.quote()))['id'])
if __name__=='__main__':unittest.main(verbosity=2)
