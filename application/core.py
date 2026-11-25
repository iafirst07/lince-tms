"""Persistence, identity and authorization for the isolated local application."""
import base64, copy, hashlib, hmac, json, os, secrets, sqlite3, threading, uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from recovery import gate,marker_path

class Error(Exception):
    def __init__(self, code, status=422):self.code,self.status=code,status;super().__init__(code)
def require(ok,code,status=422):
    if not ok:raise Error(code,status)
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(v):return hashlib.sha256(canonical(v).encode()).hexdigest()
def ident(v):require(isinstance(v,str) and 0<len(v)<=128,'INVALID_TEXT');return v
def dec(v,minimum=Decimal(0)):
    import re
    require(isinstance(v,str) and re.fullmatch(r'\d{1,10}(\.\d{1,6})?',v),'INVALID_DECIMAL')
    n=Decimal(v);require(n>=minimum,'INVALID_DECIMAL');return n
def cash(v):return format(v.quantize(Decimal('.01'),rounding=ROUND_HALF_UP),'.2f')
def moment(v):
    try:d=datetime.fromisoformat(v)
    except (ValueError,TypeError):raise Error('INVALID_TIME')
    require(d.tzinfo is not None,'TIMEZONE_REQUIRED');return d
def action(*roles):
    def wrap(fn):fn.roles=set(roles);return fn
    return wrap

class Entity(dict):
    def __init__(self,value):
        super().__init__(value)
        self._identity=tuple(self.get(k) for k in ('id','org','kind','createdBy','createdAt'))

class Core:
    def __init__(self,path,clock=None):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        require(not marker_path(self.path.resolve()).exists(),'RESTORE_INCOMPLETE',409)
        self.consistency=gate(self.path)
        self.clock=clock or (lambda:datetime.now(timezone.utc))
        with self.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT);
            CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT,profile TEXT);
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,org TEXT,username TEXT UNIQUE,salt TEXT,password TEXT,roles TEXT,active INTEGER);
            CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT,csrf TEXT,expires TEXT);
            CREATE TABLE IF NOT EXISTS login_failures(username TEXT,at TEXT);
            CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY,kind TEXT,org TEXT,shared TEXT,data TEXT);
            CREATE TABLE IF NOT EXISTS idem(user TEXT,cmd TEXT,k TEXT,hash TEXT,response TEXT,PRIMARY KEY(user,cmd,k));
            CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY,user TEXT,org TEXT,cmd TEXT,obj TEXT,at TEXT,detail TEXT);
            CREATE TABLE IF NOT EXISTS inbox(source TEXT,message TEXT,hash TEXT,at TEXT,PRIMARY KEY(source,message));
            CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,org TEXT,object TEXT,mime TEXT,body BLOB,hash TEXT);
            ''')
            db.execute("INSERT OR IGNORE INTO meta VALUES('schema','1')")
    @contextmanager
    def db(self,write=False):
        if write:
            with self.consistency.hold():
                with self._db(write) as db:yield db
        else:
            with self._db(write) as db:yield db
    @contextmanager
    def _db(self,write=False):
        db=sqlite3.connect(str(self.path),timeout=20,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON')
            if write:db.execute('BEGIN IMMEDIATE')
            yield db
            if write:db.commit()
        except: 
            if write:db.rollback()
            raise
        finally:db.close()
    def now(self):return self.clock().astimezone(timezone.utc)
    def password(self,password,salt):
        require(isinstance(password,str) and 12<=len(password)<=256,'PASSWORD_MIN_12')
        return 'pbkdf2-sha256:600000:'+hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex()
    def new_user(self,db,org,username,password,roles):
        allowed={'platform_admin','admin','planner','operator','driver','auditor','approver'}
        require(isinstance(roles,list) and roles and set(roles)<=allowed,'INVALID_ROLES')
        require(db.execute('SELECT id FROM organizations WHERE id=?',(org,)).fetchone(),'ORG_NOT_FOUND')
        salt=secrets.token_hex(16);uid='usr-'+uuid.uuid4().hex[:12]
        try:db.execute('INSERT INTO users VALUES(?,?,?,?,?,?,1)',(uid,org,ident(username),salt,self.password(password,salt),canonical(roles)))
        except sqlite3.IntegrityError:raise Error('USER_EXISTS',409)
        return {'id':uid,'org':org,'username':username,'roles':roles}
    def bootstrap(self,name,username,password):
        with self.db(True) as db:
            require(not db.execute('SELECT 1 FROM users').fetchone(),'ALREADY_BOOTSTRAPPED',409)
            org='org-'+uuid.uuid4().hex[:10];db.execute('INSERT INTO organizations VALUES(?,?,?)',(org,ident(name),'SHIPPER'))
            return self.new_user(db,org,username,password,['platform_admin','admin','planner','operator','auditor'])
    def login(self,username,password):
        ident(username)
        with self.db(True) as db:
            since=(self.now()-timedelta(minutes=5)).isoformat()
            require(db.execute('SELECT count(*) FROM login_failures WHERE username=? AND at>?',(username,since)).fetchone()[0]<5,'LOGIN_THROTTLED',429)
            u=db.execute('SELECT * FROM users WHERE username=?',(username,)).fetchone()
            valid=False
            try:valid=bool(u and u['active'] and hmac.compare_digest(self.password(password,u['salt']),u['password']))
            except Error:pass
            if not valid:
                db.execute('INSERT INTO login_failures VALUES(?,?)',(username,self.now().isoformat()))
            else:
                token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(24)
                db.execute('INSERT INTO sessions VALUES(?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],csrf,(self.now()+timedelta(hours=8)).isoformat()))
                db.execute('DELETE FROM login_failures WHERE username=?',(username,))
                return {'token':token,'csrf':csrf,'user':{'id':u['id'],'org':u['org'],'username':u['username'],'roles':json.loads(u['roles'])}}
        raise Error('INVALID_LOGIN',401)
    def authenticate(self,token,csrf=None,write=False):
        require(isinstance(token,str) and len(token)<256,'LOGIN_REQUIRED',401)
        with self.db() as db:
            row=db.execute('SELECT s.*,u.org,u.username,u.roles,u.active FROM sessions s JOIN users u ON s.user=u.id WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            require(row and row['active'] and self.now()<moment(row['expires']),'SESSION_INVALID',401)
            if write:require(isinstance(csrf,str) and hmac.compare_digest(csrf,row['csrf']),'CSRF_INVALID',403)
            return {'id':row['user'],'org':row['org'],'username':row['username'],'roles':json.loads(row['roles'])}
    def logout(self,token):
        with self.db(True) as db:db.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(token.encode()).hexdigest(),))
    def linked(self,db,a,b):
        if a==b:return True
        return any(set(x['parties'])=={a,b} and x['status']=='ACTIVE' for x in self.all(db,'relationship'))
    def allowed(self,db,p,row):
        roles=set(p['roles']);obj=json.loads(row['data'])
        if not roles & {'admin','platform_admin'}:
            financial={'invoice','tolerance','dispute','ledger','approval','expense','assignment','settlement'}
            operational={'shipment','tracking','pod','claim','return','resource','reservation','maintenance','assignment','subcontract'}
            if roles=={'driver'}:
                sid=obj['id'] if row['kind']=='shipment' else obj.get('shipmentId')
                if row['kind'] not in {'shipment','tracking','pod','claim','return'} or not sid:return False
                sr=db.execute("SELECT data FROM objects WHERE id=? AND kind='shipment'",(sid,)).fetchone()
                if not sr or json.loads(sr[0]).get('driverUserId')!=p['id']:return False
            elif not roles & {'planner','operator'}:
                if roles & {'auditor','approver'} and row['kind'] not in financial|{'shipment','pod','claim','return'}:return False
            elif row['kind'] in financial and not roles & {'auditor','approver','planner'}:return False
        if row['kind']=='relationship':return p['org'] in json.loads(row['data'])['parties']
        return row['org']==p['org'] or (p['org'] in json.loads(row['shared']) and self.linked(db,row['org'],p['org']))
    def get(self,db,p,oid,kind=None,owner=False):
        row=db.execute('SELECT * FROM objects WHERE id=?',(ident(oid),)).fetchone()
        require(row and self.allowed(db,p,row),'NOT_FOUND',404)
        require(not kind or row['kind']==kind,'NOT_FOUND',404)
        if owner:require(row['org']==p['org'],'OWNER_REQUIRED',403)
        return Entity(json.loads(row['data']))
    def all(self,db,kind=None):
        return [Entity(json.loads(r['data'])) for r in db.execute('SELECT data FROM objects'+(' WHERE kind=?' if kind else ''),(kind,) if kind else ())]
    def add(self,db,p,kind,data,shared=None):
        data=copy.deepcopy(data);data.update(id=kind+'-'+uuid.uuid4().hex[:12],kind=kind,org=p['org'],version=1,createdBy=p['id'],createdAt=self.now().isoformat())
        db.execute('INSERT INTO objects VALUES(?,?,?,?,?)',(data['id'],kind,p['org'],canonical(shared or []),canonical(data)));return Entity(data)
    def save(self,db,obj):
        require(isinstance(obj,Entity) and obj._identity==tuple(obj.get(k) for k in ('id','org','kind','createdBy','createdAt')),'IMMUTABLE_IDENTITY',409)
        row=db.execute('SELECT org,kind,data FROM objects WHERE id=?',(obj['id'],)).fetchone();require(row and row['org']==obj['org'] and row['kind']==obj['kind'],'IMMUTABLE_IDENTITY',409)
        require(json.loads(row['data'])['version']==obj['version'],'VERSION_CONFLICT',409)
        obj['version']+=1;db.execute('UPDATE objects SET data=? WHERE id=?',(canonical(obj),obj['id']));return obj
    def version(self,o,p):require(p.get('version')==o['version'],'VERSION_CONFLICT',409)
    def share(self,db,obj,orgs):
        for org in orgs:require(self.linked(db,obj['org'],org),'RELATIONSHIP_REQUIRED',403)
        db.execute('UPDATE objects SET shared=? WHERE id=?',(canonical(orgs),obj['id']))
    def projection(self,db,p,o):
        o=copy.deepcopy(o)
        if o['org']!=p['org']:
            for key in ['consumerCharge','subsidy','quoteId','candidate','revisions','internalCost','commercialPolicy','snapshotHash','externalId']:o.pop(key,None)
            if o['kind']=='tender':o['offers']={p['org']:o.get('offers',{}).get(p['org'],{})}
            if o['kind']=='rfq':o['bids']={p['org']:o.get('bids',{}).get(p['org'],{})}
            if o['kind']=='order':
                shipments=[x for x in self.visible(db,p) if x['kind']=='shipment' and o['id'] in x.get('orderIds',[])]
                ids={x['id'] for s in shipments for x in s['packages'] if x['orderId']==o['id']}
                o['packages']=[x for x in o['packages'] if x['id'] in ids];o['shipmentIds']=[s['id'] for s in shipments];o['status']='SHARED_VIEW'
        return o
    def visible(self,db,p):return [json.loads(row['data']) for row in db.execute('SELECT * FROM objects') if self.allowed(db,p,row)]
    def state(self,p,oid=None):
        with self.db() as db:
            p=self.fresh(db,p)
            if oid:return self.projection(db,p,self.get(db,p,oid))
            orgs=[dict(x) for x in db.execute('SELECT id,name,profile FROM organizations') if x['id']==p['org'] or 'platform_admin' in p['roles'] or self.linked(db,p['org'],x['id'])]
            users=[{'id':u['id'],'org':u['org'],'username':u['username'],'roles':json.loads(u['roles']),'active':bool(u['active'])} for u in db.execute('SELECT id,org,username,roles,active FROM users') if ('platform_admin' in p['roles'] or (u['org']==p['org'] and set(p['roles'])&{'admin','planner'}) or u['id']==p['id'])]
            return {'user':p,'objects':[self.projection(db,p,x) for x in self.visible(db,p)],'organizations':orgs,'users':users,'commands':self.commands(p)}
    def commands(self,p):
        return [n[4:] for n in dir(self) if n.startswith('cmd_') and set(p['roles']) & getattr(getattr(self,n),'roles',set())]
    def fresh(self,db,p):
        u=db.execute('SELECT * FROM users WHERE id=?',(p['id'],)).fetchone();require(u and u['active'],'USER_REVOKED',401)
        return {'id':u['id'],'org':u['org'],'username':u['username'],'roles':json.loads(u['roles'])}
    def execute(self,p,cmd,data,key):
        with self.consistency.hold():return self._execute(p,cmd,data,key)
    def _execute(self,p,cmd,data,key):
        ident(cmd);ident(key);require(isinstance(data,dict),'JSON_OBJECT_REQUIRED',400)
        fn=getattr(self,'cmd_'+cmd,None);require(fn and getattr(fn,'roles',None),'COMMAND_NOT_FOUND',404)
        require(set(p['roles'])&fn.roles,'ROLE_FORBIDDEN',403)
        if cmd=='outbox_process':return self.durable_outbox_process(p,data,key)
        with self.db(True) as db:
            active=db.execute('SELECT * FROM users WHERE id=?',(p['id'],)).fetchone();require(active and active['active'],'USER_REVOKED',401)
            p={'id':active['id'],'org':active['org'],'username':active['username'],'roles':json.loads(active['roles'])}
            require(set(p['roles'])&fn.roles,'ROLE_FORBIDDEN',403)
            old=db.execute('SELECT * FROM idem WHERE user=? AND cmd=? AND k=?',(p['id'],cmd,key)).fetchone()
            if old:
                require(old['hash']==sha(data),'IDEMPOTENCY_CONFLICT',409);cached=json.loads(old['response'])
                if cached.get('kind'):self.get(db,p,cached['id'])
                return self.projection(db,p,cached) if cached.get('kind') else cached
            result=fn(db,p,data)
            if result.get('kind'):result=self.projection(db,p,result)
            db.execute('INSERT INTO idem VALUES(?,?,?,?,?)',(p['id'],cmd,key,sha(data),canonical(result)))
            db.execute('INSERT INTO audit(user,org,cmd,obj,at,detail) VALUES(?,?,?,?,?,?)',(p['id'],p['org'],cmd,result.get('id'),self.now().isoformat(),canonical({'requestHash':sha(data)})))
            return result
    @action('platform_admin')
    def cmd_org_create(self,db,p,d):
        require(d.get('profile') in ['SHIPPER','CARRIER','BOTH'],'INVALID_PROFILE');oid='org-'+uuid.uuid4().hex[:10]
        db.execute('INSERT INTO organizations VALUES(?,?,?)',(oid,ident(d.get('name')),d['profile']));return {'id':oid,'name':d['name'],'profile':d['profile']}
    @action('platform_admin','admin')
    def cmd_user_create(self,db,p,d):
        require(d.get('org',p['org'])==p['org'] or 'platform_admin' in p['roles'],'ORG_FORBIDDEN',403)
        require('platform_admin' not in d.get('roles',[]) or 'platform_admin' in p['roles'],'ROLE_FORBIDDEN',403)
        return self.new_user(db,d.get('org',p['org']),d.get('username'),d.get('password'),d.get('roles'))
    @action('platform_admin','admin')
    def cmd_user_revoke(self,db,p,d):
        u=db.execute('SELECT * FROM users WHERE id=?',(ident(d.get('userId')),)).fetchone();require(u and (u['org']==p['org'] or 'platform_admin' in p['roles']),'NOT_FOUND',404)
        require(u['id']!=p['id'],'SELF_REVOKE_BLOCKED');db.execute('UPDATE users SET active=0 WHERE id=?',(u['id'],));db.execute('DELETE FROM sessions WHERE user=?',(u['id'],));return {'id':u['id'],'status':'REVOKED'}
    @action('platform_admin','admin')
    def cmd_user_roles(self,db,p,d):
        u=db.execute('SELECT * FROM users WHERE id=?',(ident(d.get('userId')),)).fetchone();require(u and (u['org']==p['org'] or 'platform_admin' in p['roles']),'NOT_FOUND',404)
        roles=d.get('roles');require(isinstance(roles,list) and roles and set(roles)<={'admin','planner','operator','driver','auditor','approver'},'INVALID_ROLES');require(u['id']!=p['id'],'SELF_CHANGE_BLOCKED')
        db.execute('UPDATE users SET roles=? WHERE id=?',(canonical(roles),u['id']));db.execute('DELETE FROM sessions WHERE user=?',(u['id'],));return {'id':u['id'],'roles':roles,'sessionsRevoked':True}
    @action('admin')
    def cmd_relationship(self,db,p,d):
        target=ident(d.get('targetOrg'));require(target!=p['org'] and db.execute('SELECT id FROM organizations WHERE id=?',(target,)).fetchone(),'INVALID_PARTNER')
        require(not any(set(x['parties'])=={p['org'],target} and x['status']!='REVOKED' for x in self.all(db,'relationship')),'RELATION_EXISTS',409)
        return self.add(db,p,'relationship',{'parties':[p['org'],target],'status':'PENDING'},[target])
    @action('admin')
    def cmd_relationship_respond(self,db,p,d):
        row=db.execute("SELECT data FROM objects WHERE id=? AND kind='relationship'",(ident(d.get('id')),)).fetchone();require(row,'NOT_FOUND',404);o=Entity(json.loads(row[0]));require(p['org'] in o['parties'],'NOT_FOUND',404);self.version(o,d)
        require(d.get('decision') in ['ACCEPT','REVOKE'],'INVALID_DECISION')
        if d['decision']=='ACCEPT':require(o['status']=='PENDING' and o['org']!=p['org'],'INVALID_STATE');o['status']='ACTIVE'
        else:o['status']='REVOKED'
        return self.save(db,o)
