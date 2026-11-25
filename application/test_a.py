import tempfile,unittest,uuid
from pathlib import Path
from datetime import datetime,timedelta
from engine import Engine
from core import Error
from seed import seed

PACKS=[{'id':'P1','weightKg':'5','lengthCm':'20','widthCm':'15','heightCm':'10'}]
class Base(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=datetime.fromisoformat('2026-11-25T13:00:00-03:00');self.e=Engine(Path(self.tmp.name)/'db.sqlite',lambda:self.now);self.seed=seed(self.e);self.p=self.seed['shipper'];self.c=self.seed['carriers'][0]
    def tearDown(self):self.tmp.cleanup()
    def cmd(self,cmd,data,p=None,key=None):return self.e.execute(p or self.p,cmd,data,key or uuid.uuid4().hex)
    def error(self,code,fn):
        with self.assertRaises(Error) as c:fn()
        self.assertEqual(c.exception.code,code)
    def quote(self):return self.cmd('quote',{'originCep':'01001-000','destinationCep':'01310-100','packages':PACKS})

class TestsA(Base):
    def test_driver_read_scope_and_privilege_revocation(self):
        q=self.quote();u=self.cmd('user_create',{'username':'scope.driver','password':'fake-test-password-123','roles':['driver']})
        login=self.e.login('scope.driver','fake-test-password-123');p=login['user']
        self.error('NOT_FOUND',lambda:self.e.state(p,q['id']));self.assertNotIn(q['id'],[o['id'] for o in self.e.state(p)['objects']])
        with self.e.db(True) as db:
            a=self.e.add(db,self.p,'shipment',{'driverUserId':p['id'],'status':'ASSIGNED'});b=self.e.add(db,self.p,'shipment',{'driverUserId':'another','status':'ASSIGNED'})
        self.assertEqual(self.e.state(p,a['id'])['id'],a['id']);self.error('NOT_FOUND',lambda:self.e.state(p,b['id']))
        self.cmd('user_roles',{'userId':u['id'],'roles':['auditor']});self.error('SESSION_INVALID',lambda:self.e.authenticate(login['token']))
        self.cmd('user_revoke',{'userId':u['id']});self.error('USER_REVOKED',lambda:self.e.state(p,a['id']))
    def test_master_metadata_and_cutoff_rejected(self):
        zone=self.cmd('master_create',{'kind':'zone','values':{'name':'Teste','from':'10000000','to':'19999999','priority':20}})
        other=self.cmd('master_create',{'kind':'zone','values':{'name':'Outra','from':'20000000','to':'29999999','priority':20}},self.c)
        self.error('MASTER_FIELDS_INVALID',lambda:self.cmd('master_update',{'id':zone['id'],'version':1,'values':{'name':'Ataque','from':'10000000','to':'19999999','priority':20,'id':other['id']}}))
        self.assertEqual(self.e.state(self.c,other['id'])['name'],'Outra')
        self.error('INVALID_CUTOFF',lambda:self.cmd('master_create',{'kind':'calendar','values':{'name':'Ruim','timezone':'America/Sao_Paulo','weekdays':[0],'holidays':[],'cutoff':'14:00+03:00'}}))
    def test_login_csrf_revoke_no_default(self):
        a=self.seed['accounts'][0];login=self.e.login(a['username'],a['password'])
        self.error('CSRF_INVALID',lambda:self.e.authenticate(login['token'],'bad',True))
        self.assertEqual(self.e.authenticate(login['token'],login['csrf'],True)['id'],self.p['id'])
        self.e.logout(login['token']);self.error('SESSION_INVALID',lambda:self.e.authenticate(login['token']))
        self.error('ALREADY_BOOTSTRAPPED',lambda:self.e.bootstrap('bad','another','VeryLongFakePassword'))
    def test_quote_multicarrier_decimal_snapshot(self):
        q=self.quote();self.assertEqual([x['cost'] for x in q['candidates']],['20.00','25.00']);self.assertEqual(q['destinationCep'],'01310100')
        self.assertEqual(q['candidates'][0]['delivery'],'2026-11-27')
        self.error('NOT_FOUND',lambda:self.e.state(self.c,q['id']))
    def test_publication_immutable_ambiguity(self):
        with self.e.db() as db:r=self.e.all(db,'rate')[0]
        self.error('PUBLISHED_IMMUTABLE',lambda:self.cmd('rate_publish',{'id':r['id'],'version':r['version']}))
        vals={k:v for k,v in r.items() if k not in ['id','kind','org','version','createdBy','createdAt','publishedAt','status']}
        new=self.cmd('rate_create',vals);self.error('AMBIGUOUS_RATE',lambda:self.cmd('rate_publish',{'id':new['id'],'version':1}))
    def test_roles_version_calendar_and_recovery(self):
        user=self.cmd('user_create',{'username':'read-only','password':'fake-test-password-123','roles':['driver']})
        p={'id':user['id'],'org':user['org'],'roles':user['roles']}
        self.error('ROLE_FORBIDDEN',lambda:self.cmd('quote',{},p))
        self.now=datetime.fromisoformat('2026-12-24T14:00:00-03:00');q=self.quote();self.assertEqual(q['candidates'][0]['pickup'],'2026-12-28')
        reopened=Engine(self.e.path,lambda:self.now);self.assertEqual(reopened.state(self.p,q['id']),q)
    def test_relationship_revocation_blocks_shared_object(self):
        with self.e.db(True) as db:o=self.e.add(db,self.p,'sample',{'value':1},[self.c['org']]);rel=self.e.all(db,'relationship')[0]
        self.assertEqual(self.e.state(self.c,o['id'])['value'],1)
        self.cmd('relationship_respond',{'id':rel['id'],'version':rel['version'],'decision':'REVOKE'})
        self.error('NOT_FOUND',lambda:self.e.state(self.c,o['id']))
        self.assertNotIn(o['id'],[x['id'] for x in self.e.state(self.c)['objects']])

if __name__=='__main__':unittest.main(verbosity=2)
