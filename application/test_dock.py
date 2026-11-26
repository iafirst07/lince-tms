import unittest, tempfile, uuid, threading
from pathlib import Path
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from engine import Engine
from dock import Dock, calc_overlap_capacity
from core import Error

if issubclass(Engine, Dock):
    DockEngine = Engine
else:
    class DockEngine(Dock, Engine): pass

class DockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.at = datetime(2026,11,26,8,tzinfo=timezone.utc)
        self.e = DockEngine(Path(self.tmp.name)/'dock.sqlite', lambda:self.at)
        self.p = self.e.bootstrap('Ficticia','dock-user','synthetic-password-123')
        with self.e.db(True) as db: self.location = self.e.add(db,self.p,'location',{'name':'Local ficticio','postalCode':'01001000'})
        self.dock = self.cmd('dock_create',dict(locationId=self.location['id'],name='Doca A',capacity=2,timezone='America/Sao_Paulo'))
    def tearDown(self): self.tmp.cleanup()
    def cmd(self,c,d,k=None): return self.e.execute(self.p,c,d,k or uuid.uuid4().hex)
    def reserve(self,start='2026-11-26T10:00:00Z',end='2026-11-26T11:00:00Z',units=1,k=None):
        return self.cmd('dock_reserve',dict(dockId=self.dock['id'],reference='Ficticia',start=start,end=end,units=units),k)
    def progress(self,row,status):return self.cmd('dock_progress',dict(id=row['id'],version=row['version'],status=status,reason='Ficticio'))
    def test_halfopen_sweep_and_capacity(self):
        self.reserve(units=2);self.reserve('2026-11-26T11:00:00Z','2026-11-26T12:00:00Z',2)
        with self.assertRaisesRegex(Error,'DOCK_CAPACITY_CONFLICT'):self.reserve()
        rows=[dict(id='a',start='2026-11-26T10:00:00Z',end='2026-11-26T11:00:00Z',units=1,status='RESERVED'),dict(id='b',start='2026-11-26T11:00:00Z',end='2026-11-26T12:00:00Z',units=1,status='RESERVED')]
        self.assertEqual(calc_overlap_capacity(rows,'2026-11-26T10:00:00Z','2026-11-26T12:00:00Z',1),2)
    def test_validation(self):
        for units in [True,0,1.5,'1',3]:
            with self.subTest(units=units),self.assertRaises(Error):self.reserve(units=units)
        for start,end in [('2026-11-26T10:00:00','2026-11-26T11:00:00Z'),('2026-11-26T11:00:00Z','2026-11-26T10:00:00Z'),('2026-11-26T10:00:00.0001Z','2026-11-26T11:00:00Z')]:
            with self.assertRaises(Error):self.reserve(start,end)
        for capacity in [True,0,21,1.5,'2']:
            with self.assertRaises(Error):self.cmd('dock_create',dict(locationId=self.location['id'],name='B',capacity=capacity,timezone='UTC'))
    def test_reschedule_conflict_stale_and_history(self):
        a=self.reserve(units=2);self.reserve('2026-11-26T12:00:00Z','2026-11-26T13:00:00Z',2);before=self.e.state(self.p,a['id'])
        with self.assertRaisesRegex(Error,'DOCK_CAPACITY_CONFLICT'):self.cmd('dock_reschedule',dict(id=a['id'],version=a['version'],start='2026-11-26T12:00:00Z',end='2026-11-26T13:00:00Z',reason='Ficticio'))
        self.assertEqual(self.e.state(self.p,a['id']),before)
        b=self.cmd('dock_reschedule',dict(id=a['id'],version=a['version'],start='2026-11-26T07:00:00-03:00',end='2026-11-26T08:00:00-03:00',reason='Offset equivalente'))
        self.assertEqual(b['start'],'2026-11-26T10:00:00+00:00');self.assertEqual(len(b['history']),2)
        with self.assertRaisesRegex(Error,'VERSION_CONFLICT'):self.cmd('dock_reschedule',dict(id=a['id'],version=a['version'],start=a['start'],end=a['end'],reason='Stale'))
    def test_progress_no_show_and_release(self):
        a=self.reserve(units=2)
        with self.assertRaisesRegex(Error,'DOCK_NO_SHOW_TOO_EARLY'):self.progress(a,'NO_SHOW')
        for status in [None, [], {}, 1]:
            with self.assertRaisesRegex(Error,'INVALID_DOCK_TRANSITION'):self.progress(a,status)
        with self.assertRaisesRegex(Error,'VERSION_CONFLICT'):self.cmd('dock_progress',dict(id=a['id'],version=True,status='CHECKED_IN',reason='Ficticio'))
        a=self.progress(a,'CHECKED_IN')
        for command,payload in [('dock_progress',dict(id=a['id'],version=a['version'],status='CANCELLED',reason='x')),('dock_reschedule',dict(id=a['id'],version=a['version'],start=a['start'],end=a['end'],reason='x'))]:
            with self.assertRaises(Error):self.cmd(command,payload)
        a=self.progress(a,'CHECKED_OUT');self.reserve(units=2)
    def test_cancel_and_no_show_release(self):
        a=self.reserve(units=2);self.progress(a,'CANCELLED');b=self.reserve(units=2);self.at=datetime(2026,11,26,11,tzinfo=timezone.utc);self.progress(b,'NO_SHOW');self.reserve(units=2)
    def test_replay_restart_snapshot(self):
        a=self.reserve(k='stable');self.assertEqual(a,self.reserve(k='stable'))
        self.e=DockEngine(self.e.path,lambda:self.at);self.assertEqual(a,self.reserve(k='stable'))
        with self.e.db(True) as db:
            loc=self.e.get(db,self.p,self.location['id'],'location',True);loc['name']='Alterado';self.e.save(db,loc)
        self.assertEqual(self.e.state(self.p,a['id'])['locationSnapshot']['name'],'Local ficticio')
        with self.assertRaisesRegex(Error,'IDEMPOTENCY_CONFLICT'):self.reserve(units=2,k='stable')
    def test_last_slot_concurrent(self):
        barrier=threading.Barrier(2)
        def work(i):
            barrier.wait()
            try:self.reserve(units=2,k='parallel'+str(i));return 'OK'
            except Error as e:return e.code
        with ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(work,[1,2]))
        self.assertEqual(sorted(result),['DOCK_CAPACITY_CONFLICT','OK'])

if __name__=='__main__':unittest.main(verbosity=2)
