import concurrent.futures,json,sqlite3,subprocess,sys,threading,zipfile
from pathlib import Path
from decimal import Decimal
from contextlib import closing
from test_a import Base
import test_c
from engine import Engine
from finance import allocate

class RecoveryDelta(Base):
    order=test_c.TestsC.order;ship=test_c.TestsC.ship;resources=test_c.TestsC.resources;award=test_c.TestsC.award
    process=test_c.TestsC.process;ready_delivery=test_c.TestsC.ready_delivery
    def setUp(self):super().setUp();self.mock=self.e.start_mock()
    def tearDown(self):self.mock.close();super().tearDown()
    def test_quiescent_pair_waits_for_remote_effect_and_local_commit(self):
        message=self.cmd('adapter_enqueue',{'adapter':'MAPS','payload':{'locations':[{'lat':0,'lon':0},{'lat':1,'lon':1}]}})
        accepted=threading.Event();release=threading.Event();backup_started=threading.Event();original=self.e.mock_request
        def paused(m,query=False):
            result=original(m,query);accepted.set()
            if not release.wait(8):raise RuntimeError('test timeout')
            return result
        self.e.mock_request=paused;archive=Path(self.tmp.name)/'pair.zip'
        def snapshot():backup_started.set();return self.e.backup(self.p,archive)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            sending=pool.submit(self.process,message);self.assertTrue(accepted.wait(5));backing=pool.submit(snapshot);self.assertTrue(backup_started.wait(5))
            try:self.assertFalse(backing.done());self.assertFalse(archive.exists())
            finally:release.set()
            self.assertEqual(sending.result(5)['status'],'DONE');manifest=backing.result(5)
        self.assertEqual(manifest['consistency'],'QUIESCENT_APP_AND_MOCK_COMMAND_GATE')
        with zipfile.ZipFile(archive) as z,closing(sqlite3.connect(':memory:')) as app,closing(sqlite3.connect(':memory:')) as mock:
            app.deserialize(z.read('application.sqlite'));mock.deserialize(z.read('mock.sqlite'))
            obj=json.loads(app.execute('SELECT data FROM objects WHERE id=?',(message['id'],)).fetchone()[0]);self.assertEqual(obj['status'],'DONE')
            self.assertEqual(mock.execute('SELECT count(*) FROM accepted WHERE id=?',(obj['messageId'],)).fetchone()[0],1)
    def test_restore_crash_between_files_is_resumable_and_not_startable(self):
        archive=Path(self.tmp.name)/'backup.zip';self.e.backup(self.p,archive);dest=Path(self.tmp.name)/'restored'/'application.sqlite'
        script="from engine import Engine;import sys;Engine.restore(sys.argv[1],sys.argv[2],_crash_after=1)"
        child=subprocess.run([sys.executable,'-c',script,str(archive),str(dest)],capture_output=True,timeout=10)
        self.assertEqual(child.returncode,73,child.stderr.decode());self.assertTrue(dest.exists());self.assertFalse((dest.parent/'mock.sqlite').exists())
        self.error('RESTORE_INCOMPLETE',lambda:Engine(dest))
        result=Engine.restore(archive,dest);self.assertEqual(result['recovery'],'STAGED_RESUMABLE_PAIR');self.assertTrue((dest.parent/'mock.sqlite').exists())
        reopened=Engine(dest)
        with reopened.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
        self.assertFalse(Path(str(dest)+'.restore.json').exists())
    def test_normal_pod_lost_response_reconciles_exact_original(self):
        s=self.ready_delivery();payload={'shipmentId':s['id'],'version':s['version'],'proofId':'NORMAL-LOST','packageKeys':[p['key'] for p in s['packages']],'outcome':'DELIVERED','reason':'Recebido','occurredAt':self.now.isoformat()}
        context={'planVersion':s['planVersion'],'assignmentId':s['assignmentId'],'packageKeys':[p['key'] for p in s['packages']]}
        proof=self.cmd('pod',payload,self.c);synced=self.cmd('offline_sync',{'command':'pod','payload':payload,'context':context},self.c);self.assertEqual(proof['id'],synced['id'])
        with self.e.db() as db:self.assertEqual(len(self.e.all(db,'pod')),1)
    def test_largest_remainders_no_negative_amounts(self):
        result=allocate(Decimal('.02'),{k:Decimal(1) for k in 'ABCD'})
        self.assertEqual(result,{'A':'0.01','B':'0.01','C':'0.00','D':'0.00'})
        self.assertEqual(sum(map(Decimal,result.values())),Decimal('.02'));self.assertTrue(all(Decimal(x)>=0 for x in result.values()))
        self.assertEqual(allocate(Decimal('20'),{'A':Decimal(1),'B':Decimal(2)}),{'A':'6.67','B':'13.33'})
