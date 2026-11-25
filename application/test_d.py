import base64,io,json,sqlite3
from pathlib import Path
from PIL import Image
from test_a import Base,PACKS
import test_c
from engine import Engine

class TestsD(Base):
    def test_offline_two_pods_same_version_dedup_and_changed_context(self):
        self.mock=self.e.start_mock()
        try:
            s=self.ready_delivery()
            with self.e.db(True) as db:
                ship=self.e.get(db,self.c,s['id']);second={**ship['packages'][0],'key':ship['packages'][0]['key']+'-2'};ship['packages'].append(second);self.e.save(db,ship)
            s=self.e.state(self.c,s['id']);context={'planVersion':s['planVersion'],'assignmentId':s['assignmentId'],'packageKeys':[x['key'] for x in s['packages']]}
            requests=[{'command':'pod','payload':{'shipmentId':s['id'],'version':s['version'],'proofId':'OFF-'+str(i),'packageKeys':[pack['key']],'outcome':'DELIVERED','reason':'Offline','occurredAt':self.now.isoformat()},'context':context} for i,pack in enumerate(s['packages'])]
            first=self.cmd('offline_sync',requests[0],self.c)
            from engine import Engine
            self.e=Engine(self.e.path,lambda:self.now)
            second=self.cmd('offline_sync',requests[1],self.c);self.assertEqual(self.e.state(self.c,s['id'])['status'],'DELIVERED')
            self.assertEqual(self.cmd('offline_sync',requests[0],self.c)['id'],first['id'])
            tracking={'command':'tracking','payload':{'shipmentId':s['id'],'eventId':'OFF-T','planVersion':s['planVersion'],'type':'DEPARTED','occurredAt':self.now.isoformat()},'context':context}
            self.assertFalse(self.cmd('offline_sync',tracking,self.c)['projectionUpdated'])
            self.error('OFFLINE_CONTEXT_CHANGED',lambda:self.cmd('offline_sync',{**requests[0],'context':{**context,'planVersion':context['planVersion']+1}},self.c))
        finally:self.mock.close()
    order=test_c.TestsC.order;ship=test_c.TestsC.ship;resources=test_c.TestsC.resources;award=test_c.TestsC.award;process=test_c.TestsC.process;ready_delivery=test_c.TestsC.ready_delivery
    def setUp(self):super().setUp();self.mock=self.e.start_mock()
    def tearDown(self):self.mock.close();super().tearDown()
    def test_upload_reencode_and_scope_revoke(self):
        s=self.ready_delivery();buffer=io.BytesIO();Image.new('RGB',(8,8),'blue').save(buffer,format='PNG')
        f=self.cmd('upload_pod',{'shipmentId':s['id'],'base64':base64.b64encode(buffer.getvalue()+b'<script>evil</script>').decode()},self.c)
        body,mime=self.e.file_read(self.c,f['id']);self.assertNotIn(b'<script>',body);self.assertEqual(mime,'image/png')
        self.error('UNSAFE_OR_CORRUPT_IMAGE',lambda:self.cmd('upload_pod',{'shipmentId':s['id'],'base64':base64.b64encode(b'<svg/>').decode()},self.c))
        with self.e.db() as db:rel=next(x for x in self.e.all(db,'relationship') if self.c['org'] in x['parties'])
        self.cmd('relationship_respond',{'id':rel['id'],'version':rel['version'],'decision':'REVOKE'})
        self.error('NOT_FOUND',lambda:self.e.file_read(self.c,f['id']))
    def test_backup_restore_sessions_and_collision_atomic(self):
        q=self.quote();backup=Path(self.tmp.name)/'backup.zip';self.e.backup(self.p,backup)
        restored=Path(self.tmp.name)/'restored'/'db.sqlite';Engine.restore(backup,restored);e=Engine(restored,lambda:self.now)
        self.assertEqual(e.state(self.p,q['id'])['id'],q['id'])
        with e.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
        target=Path(self.tmp.name)/'collision'/'db.sqlite';target.parent.mkdir();(target.parent/'mock.sqlite').write_bytes(b'preserve')
        self.error('MOCK_RESTORE_EXISTS',lambda:Engine.restore(backup,target));self.assertFalse(target.exists());self.assertEqual((target.parent/'mock.sqlite').read_bytes(),b'preserve')
    def test_legacy_wal_snapshot_and_rollback(self):
        legacy=Path(self.tmp.name)/'legacy.sqlite';source=sqlite3.connect(legacy)
        try:
            source.execute('PRAGMA journal_mode=WAL');source.execute('CREATE TABLE objects(id TEXT,kind TEXT,data TEXT)');source.commit();source.execute('INSERT INTO objects VALUES(?,?,?)',('old1','order','{"demo":true}'));source.commit()
            first=self.e.migrate_legacy(self.p,legacy);self.assertEqual(first['records'],1)
            source.execute('INSERT INTO objects VALUES(?,?,?)',('old2','order','{"demo":true}'));source.commit()
            second=self.e.migrate_legacy(self.p,legacy);self.assertEqual(second['records'],2);self.assertNotEqual(first['migrationHash'],second['migrationHash'])
            self.cmd('migration_rollback',{'migrationHash':second['migrationHash']});self.assertEqual(source.execute('SELECT count(*) FROM objects').fetchone()[0],2)
        finally:source.close()
    def test_simulation_no_writes_and_missing_not_zero(self):
        with self.e.db() as db:before=db.execute('SELECT count(*) FROM objects').fetchone()[0]
        result=self.e.simulate(self.p,{'originCep':'01001000','destinationCep':'01310100','packages':PACKS});self.assertFalse(result['automaticAction'])
        with self.e.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM objects').fetchone()[0],before)
        m=self.e.indicators(self.p);self.assertIsNone(m['commercial']['charge']);self.assertEqual(m['onTime']['denominator'],0)

if __name__=='__main__':__import__('unittest').main(verbosity=2)
