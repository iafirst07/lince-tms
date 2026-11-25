import json,threading
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from test_a import Base,PACKS
from server import Handler

class TestsHTTP(Base):
    def test_cookie_csrf_session_and_static_boundaries(self):
        handler=type('IsolatedHandler',(Handler,),{'engine':self.e});server=ThreadingHTTPServer(('127.0.0.1',0),handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();url='http://127.0.0.1:'+str(server.server_port)
        def request(path,data=None,headers=None):
            req=Request(url+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
            try:r=urlopen(req,timeout=3)
            except HTTPError as e:r=e
            with r:return r.status,r.headers,r.read()
        try:
            self.assertEqual(request('/api/state')[0],401)
            account=self.seed['accounts'][0];status,headers,body=request('/api/login',{'username':account['username'],'password':account['password']});self.assertEqual(status,200);login=json.loads(body);cookie=headers['Set-Cookie'];self.assertIn('HttpOnly',cookie);self.assertIn('SameSite=Strict',cookie)
            h={'Cookie':cookie.split(';')[0]};self.assertEqual(request('/api/session',headers=h)[0],200)
            data={'command':'quote','payload':{'originCep':'01001000','destinationCep':'01310100','packages':PACKS}}
            self.assertEqual(request('/api/command',data,h)[0],403)
            h.update({'X-CSRF-Token':login['csrf'],'Idempotency-Key':'http-quote'});self.assertEqual(request('/api/command',data,h)[0],200)
            self.assertEqual(request('/runtime/application.sqlite',headers=h)[0],404)
            self.assertEqual(request('/api/logout',{},h)[0],200);self.assertEqual(request('/api/state',headers=h)[0],401)
        finally:server.shutdown();server.server_close();thread.join()
