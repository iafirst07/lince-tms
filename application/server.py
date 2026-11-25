"""Loopback-only application HTTP server. No default users/passwords."""
import argparse,getpass,hashlib,json,os,secrets,sys
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from engine import Engine
from core import Error,require

ROOT=Path(__file__).resolve().parent
class Handler(BaseHTTPRequestHandler):
    engine=None
    def log_message(self,*args):pass
    def send(self,status,data,mime='application/json; charset=utf-8',headers=None):
        body=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Frame-Options','DENY')
        for k,v in (headers or {}).items():self.send_header(k,v)
        self.end_headers();self.wfile.write(body)
    def guard(self):
        host=self.headers.get('Host','');require(host.split(':')[0] in ['127.0.0.1','localhost'],'LOCAL_HOST_REQUIRED',403)
        origin=self.headers.get('Origin');require(not origin or origin in [f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'],'ORIGIN_FORBIDDEN',403)
    def token(self):
        try:c=SimpleCookie();c.load(self.headers.get('Cookie',''));return c['tms_session'].value if 'tms_session' in c else ''
        except Exception:return ''
    def principal(self,write=False):return self.engine.authenticate(self.token(),self.headers.get('X-CSRF-Token'),write)
    def read_json(self):
        require(self.headers.get('Content-Type','').split(';')[0]=='application/json','JSON_REQUIRED',400)
        length=int(self.headers.get('Content-Length','0'));require(0<length<=3000000,'BODY_SIZE',400)
        d=json.loads(self.rfile.read(length));require(isinstance(d,dict),'JSON_OBJECT_REQUIRED',400);return d
    def error(self,e):
        if isinstance(e,Error):self.send(e.status,{'error':{'code':e.code,'message':e.code}})
        elif isinstance(e,(ValueError,KeyError,TypeError)):self.send(400,{'error':{'code':'INVALID_REQUEST','message':'Dados incompletos ou inválidos'}})
        else:self.send(500,{'error':{'code':'INTERNAL_ERROR','message':'Falha interna; operação não confirmada'}})
    def do_GET(self):
        try:
            self.guard();url=urlsplit(self.path);q=parse_qs(url.query)
            static={'/form-state.js':('form-state.js','text/javascript; charset=utf-8'),'/navigation.js':('navigation.js','text/javascript; charset=utf-8'),'/navigation.css':('navigation.css','text/css; charset=utf-8'),'/':('index.html','text/html; charset=utf-8'),'/app.js':('app.js','text/javascript; charset=utf-8'),'/sw.js':('sw.js','text/javascript; charset=utf-8'),'/style.css':('style.css','text/css; charset=utf-8')}
            driver_assets={'/driver/':('driver.html','text/html; charset=utf-8'),'/driver/driver.js':('driver.js','text/javascript; charset=utf-8'),'/driver/driver.css':('driver.css','text/css; charset=utf-8'),'/driver/driver-sw.js':('driver-sw.js','text/javascript; charset=utf-8'),'/driver/driver.webmanifest':('driver.webmanifest','application/manifest+json'),'/driver/driver-icon.svg':('driver-icon.svg','image/svg+xml'),'/driver/manifest.webmanifest':('driver.webmanifest','application/manifest+json'),'/driver/icon.svg':('driver-icon.svg','image/svg+xml'),'/driver/icon-192.png':('driver-icon-192.png','image/png'),'/driver/icon-512.png':('driver-icon-512.png','image/png'),'/docs/':('docs.html','text/html; charset=utf-8'),'/docs/openapi.json':('openapi.json','application/json')}
            static.update(driver_assets)
            if url.path=='/driver':return self.send(302,b'','text/plain',{'Location':'/driver/'})
            if url.path in static:
                filename,mime=static[url.path];require((ROOT/filename).is_file(),'UI_NOT_AVAILABLE',503);return self.send(200,(ROOT/filename).read_bytes(),mime,{'Service-Worker-Allowed':'/driver/'} if filename=='driver-sw.js' else None)
            p=self.principal()
            if url.path=='/api/session':
                with self.engine.db() as db:csrf=db.execute('SELECT csrf FROM sessions WHERE token=?',(hashlib.sha256(self.token().encode()).hexdigest(),)).fetchone()[0]
                return self.send(200,{'user':p,'csrf':csrf})
            if url.path=='/api/state':return self.send(200,self.engine.state(p,q.get('id',[None])[0]))
            if url.path=='/api/simulation':
                manifests=[x for x in self.engine.state(p)['objects'] if x['kind']=='simulationManifest']
                return self.send(200,{'enabled':bool(manifests),'manifest':manifests[0] if manifests else None,'realOperationAllowed':False})
            if url.path=='/api/kpis':return self.send(200,self.engine.indicators(p))
            if url.path=='/api/file':
                body,mime=self.engine.file_read(p,q.get('id',[None])[0]);return self.send(200,body,mime,{'Content-Disposition':'attachment; filename="comprovante-validado.png"'})
            raise Error('NOT_FOUND',404)
        except Exception as e:self.error(e)
    def do_POST(self):
        try:
            self.guard();path=urlsplit(self.path).path
            if path=='/api/login':
                d=self.read_json();login=self.engine.login(d.get('username'),d.get('password'));token=login.pop('token');return self.send(200,login,headers={'Set-Cookie':f'tms_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'})
            p=self.principal(True)
            if path=='/api/logout':self.engine.logout(self.token());return self.send(200,{'status':'LOGGED_OUT'},headers={'Set-Cookie':'tms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
            if path=='/api/command':
                d=self.read_json();return self.send(200,self.engine.execute(p,d.get('command'),d.get('payload'),self.headers.get('Idempotency-Key')))
            if path=='/api/simulate':return self.send(200,self.engine.simulate(p,self.read_json()))
            if path=='/api/backup':
                target=self.engine.path.parent/'backups'/('backup-'+secrets.token_hex(8)+'.zip');self.engine.backup(p,target);return self.send(200,target.read_bytes(),'application/zip',{'Content-Disposition':'attachment; filename="tms-backup-local.zip"'})
            raise Error('NOT_FOUND',404)
        except Exception as e:self.error(e)

def lock_database(path):
    lock=open(str(path)+'.server.lock','a+b');lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
    try:
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:lock.close();raise SystemExit('Banco já está servido por outro processo.')
    return lock

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--db',default=str(ROOT/'runtime'/'application.sqlite'));parser.add_argument('--port',type=int,default=8766);parser.add_argument('--init-demo',action='store_true');parser.add_argument('--init-simulation',action='store_true');parser.add_argument('--init',action='store_true');parser.add_argument('--restore');parser.add_argument('--migrate-legacy')
    args=parser.parse_args()
    if args.restore:
        print(Engine.restore(args.restore,args.db));return
    engine=Engine(args.db)
    if args.init_simulation:
        from simulation import seed_simulation
        dest=engine.path.parent/'first-access.json';require(not dest.exists(),'ACCESS_FILE_EXISTS')
        result=seed_simulation(engine);dest.write_text(json.dumps(result['accounts'],ensure_ascii=False,indent=2),encoding='utf-8')
        print('Lince: simulação nova preparada. Acessos privados em '+str(dest));return
    if args.init_demo:
        from seed import seed
        result=seed(engine);dest=engine.path.parent/'first-access.json';require(not dest.exists(),'ACCESS_FILE_EXISTS');dest.write_text(json.dumps(result['accounts'],indent=2),encoding='utf-8');print('Acesso inicial gerado em '+str(dest));return
    if args.init:
        username=input('Usuário administrador: ');password=getpass.getpass('Senha (mínimo 12): ');name=input('Organização: ');engine.bootstrap(name,username,password);print('Administrador criado.');return
    if args.migrate_legacy:
        login=engine.login(input('Administrador: '),getpass.getpass('Senha: '));p=login['user'];backup=engine.path.parent/'backups'/('pre-migration-'+secrets.token_hex(6)+'.zip');engine.backup(p,backup);print(engine.migrate_legacy(p,args.migrate_legacy));return
    lock=lock_database(engine.path)
    with engine.db() as db:require(db.execute('SELECT 1 FROM users').fetchone(),'INITIALIZE_EXPLICITLY_FIRST')
    engine.recover_outbox();mock=engine.start_mock();Handler.engine=engine;server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'TMS local http://127.0.0.1:{args.port} | mocks isolados {mock.url}',flush=True)
    try:server.serve_forever()
    finally:server.server_close();mock.close();lock.close()

if __name__=='__main__':main()
