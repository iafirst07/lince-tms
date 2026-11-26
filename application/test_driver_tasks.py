"""Synthetic normal assigned-task business tests; no DB/session/permission probes."""
import copy,unittest
from datetime import datetime,timezone
from core import Error
from driver_tasks import DriverTasks

P={'id':'driver','org':'carrier','roles':['driver']};OWNER={'id':'operator','org':'shipper','roles':['operator']}
class Fake(DriverTasks):
    def __init__(self):
        self.objects={
          's':{'id':'s','kind':'shipment','org':'shipper','carrierOrg':'carrier','driverUserId':'driver','version':1,'planVersion':1,'assignmentId':'assignment','status':'ASSIGNED','delivered':['o:1'],'packages':[{'key':'o:1','id':'1','orderId':'o'}],'pickupStops':[{'stopId':'pickup:o','type':'PICKUP','orderId':'o','packageKeys':['o:1'],'originSnapshot':{'name':'Synthetic origin','postalCode':'01001000'}}]},
          'o':{'id':'o','kind':'order','destinationSnapshot':{'name':'Synthetic destination','postalCode':'02002000'}},
          'r':{'id':'r','kind':'return','org':'shipper','version':1,'shipmentId':'s','packageKeys':['o:1'],'status':'AUTHORIZED','history':[]},
          'loc':{'id':'loc','org':'shipper','kind':'location','name':'Explicit return','postalCode':'03003000'}}
    def get(self,db,p,id,kind=None,owner=False):return copy.deepcopy(self.objects[id])
    def assigned(self,db,p,d):return self.get(db,p,d['shipmentId'])
    def version(self,obj,d):
        if d.get('version')!=obj['version']:raise Error('VERSION_CONFLICT',409)
    def save(self,db,obj):obj['version']+=1;self.objects[obj['id']]=copy.deepcopy(obj);return copy.deepcopy(obj)
    def now(self):return datetime(2026,11,26,10,tzinfo=timezone.utc)
class Cases(unittest.TestCase):
    def setUp(self):self.e=Fake();self.d={'shipmentId':'s','version':1,'planVersion':1,'assignmentId':'assignment','stopId':'pickup:o','packageKeys':['o:1'],'eventId':'pickup-event'}
    def rejects(self,code,fn):
        before=copy.deepcopy(self.e.objects)
        with self.assertRaises(Error) as ctx:fn()
        self.assertEqual(ctx.exception.code,code);self.assertEqual(self.e.objects,before)
    def assignment(self,**extra):return self.e.cmd_return_assign(None,OWNER,{'id':'r','version':self.e.objects['r']['version'],'windowStart':'2026-11-26T10:00:00Z','windowEnd':'2026-11-26T12:00:00Z','reason':'Synthetic task',**extra})
    def test_pickup_replay_and_no_delivery(self):
        before=copy.deepcopy(self.e.objects['s']);receipt=self.e.cmd_pickup_confirm(None,P,self.d);self.assertEqual(receipt['status'],'CONFIRMED');self.assertEqual(self.e.cmd_pickup_confirm(None,P,self.d),receipt);self.assertEqual(len(self.e.objects['s']['pickupReceipts']),1);self.assertEqual(self.e.objects['s']['delivered'],before['delivered']);self.assertEqual(self.e.objects['s']['status'],'ASSIGNED')
    def test_pickup_unknown_stale_and_duplicate(self):
        self.rejects('PICKUP_STOP_UNKNOWN',lambda:self.e.cmd_pickup_confirm(None,P,{**self.d,'stopId':'legacy'}))
        self.rejects('TASK_CONTEXT_CHANGED',lambda:self.e.cmd_pickup_confirm(None,P,{**self.d,'planVersion':2}))
        self.rejects('PICKUP_VOLUMES_MISMATCH',lambda:self.e.cmd_pickup_confirm(None,P,{**self.d,'packageKeys':['other']}))
        self.rejects('VERSION_CONFLICT',lambda:self.e.cmd_pickup_confirm(None,P,{**self.d,'version':0}))
        self.e.cmd_pickup_confirm(None,P,self.d);self.rejects('TASK_EVENT_CONFLICT',lambda:self.e.cmd_pickup_confirm(None,P,{**self.d,'version':2}))
        self.rejects('PICKUP_ALREADY_CONFIRMED',lambda:self.e.cmd_pickup_confirm(None,P,{**self.d,'eventId':'new','version':2}))
    def test_legacy_unknown_origin(self):
        del self.e.objects['s']['pickupStops'][0]['originSnapshot'];self.rejects('POINT_UNKNOWN',lambda:self.e.cmd_pickup_confirm(None,P,self.d))
    def test_return_assign_snapshot_and_reassign(self):
        original=copy.deepcopy(self.e.objects['s']);r=self.assignment();self.assertEqual(r['sourceSnapshot']['postalCode'],'02002000');self.assertEqual(r['destinationSnapshot']['postalCode'],'01001000')
        r2=self.assignment(destinationLocationId='loc');self.assertEqual(r2['taskId'],r['taskId']);self.assertEqual(r2['taskVersion'],2);self.assertEqual(r2['history'][-1]['previous']['destinationSnapshot'],r['destinationSnapshot']);self.assertEqual(self.e.objects['s'],original)
    def test_return_legacy_explicit_destination(self):
        self.e.objects['s']['pickupStops']=[];self.rejects('RETURN_DESTINATION_UNKNOWN',lambda:self.assignment());self.assertEqual(self.assignment(destinationLocationId='loc')['destinationSnapshot']['postalCode'],'03003000')
    def test_return_collect_replay_context_and_original_preserved(self):
        r=self.assignment();original=copy.deepcopy(self.e.objects['s']);d={'id':'r','version':r['version'],'taskId':r['taskId'],'eventId':'collect','packageKeys':['o:1']}
        self.rejects('TASK_CONTEXT_CHANGED',lambda:self.e.cmd_driver_return_collect(None,P,{**d,'taskId':'old'}));receipt=self.e.cmd_driver_return_collect(None,P,d)
        self.assertEqual(self.e.objects['r']['status'],'COLLECTED');self.assertEqual(self.e.cmd_driver_return_collect(None,P,d),receipt);self.assertEqual(len(self.e.objects['r']['collectionReceipts']),1);self.assertEqual(self.e.objects['s'],original)
        self.rejects('TASK_EVENT_CONFLICT',lambda:self.e.cmd_driver_return_collect(None,P,{**d,'version':d['version']+1}));self.rejects('INVALID_RETURN_TRANSITION',lambda:self.e.cmd_driver_return_collect(None,P,{**d,'eventId':'new','version':self.e.objects['r']['version']}))
    def test_return_multiorder_ambiguous_and_after_collection_no_reassign(self):
        self.e.objects['s']['packages'].append({'key':'other:1','orderId':'other'});self.e.objects['r']['packageKeys'].append('other:1');self.rejects('RETURN_ORDER_AMBIGUOUS',lambda:self.assignment())
        self.e=Fake();r=self.assignment();self.e.cmd_driver_return_collect(None,P,{'id':'r','version':r['version'],'taskId':r['taskId'],'eventId':'collect','packageKeys':['o:1']});self.rejects('RETURN_ASSIGNMENT_CLOSED',lambda:self.assignment())
if __name__=='__main__':unittest.main(verbosity=2)
