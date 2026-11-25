"""Six local HTTP contracts with durable deduplication and explicit unknown effects."""
import hashlib,hmac,json,secrets,sqlite3,threading,time,uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import URLError,HTTPError
from core import action,require,Error,ident,canonical,sha,moment

KINDS={'OMS','WMS','ERP','CARRIER','MAPS','FISCAL'}
class ClosingConnection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()
def signature(key,ts,body):return hmac.new(key.encode(),str(ts).encode()+b'.'+body,hashlib.sha256).hexdigest()
def validate_contract(kind,payload):
    require(isinstance(payload,dict),'ADAPTER_PAYLOAD')
    required={'OMS':{'order'},'WMS':{'shipmentId','custody'},'ERP':{'entryIds','reference'},'CARRIER':{'shipmentId','packages','demo'},'MAPS':{'locations'},'FISCAL':{'documentId','schema','scenario'}}[kind]
    require(required<=set(payload),'ADAPTER_REQUIRED_FIELDS')
    if kind=='OMS':require(isinstance(payload['order'],dict) and {'externalId','quoteId','packages','consumerCharge','locationId','windowStart','windowEnd'}<=set(payload['order']),'OMS_ORDER_SCHEMA')
    if kind=='WMS':require(payload['custody'] in ['READY','HANDED_OVER'],'WMS_CUSTODY')
    if kind=='ERP':require(isinstance(payload['entryIds'],list) and payload['entryIds'],'ERP_ENTRIES')
    if kind=='CARRIER':require(payload['demo'] is True and isinstance(payload['packages'],list) and payload['packages'],'CARRIER_SCHEMA')
    if kind=='MAPS':
        require(isinstance(payload['locations'],list) and 2<=len(payload['locations'])<=100,'MAPS_LOCATIONS')
        for x in payload['locations']:require(isinstance(x.get('lat'),(int,float)) and isinstance(x.get('lon'),(int,float)) and abs(x['lat'])<=90 and abs(x['lon'])<=180,'MAPS_COORDINATES')
    if kind=='FISCAL':require(payload['schema']=='DEMO_ENVELOPE_1','FISCAL_DEMO_SCHEMA_ONLY')

class MockService:
    def __init__(self,path,key):
        self.path=str(path);self.key=key
        with sqlite3.connect(self.path,factory=ClosingConnection) as db:db.execute('CREATE TABLE IF NOT EXISTS accepted(id TEXT PRIMARY KEY,hash TEXT,kind TEXT,response TEXT)')
        outer=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                try:
                    size=int(self.headers.get('Content-Length','0'));require(0<size<=65536,'SIZE',400);raw=self.rfile.read(size);ts=int(self.headers.get('X-Time','0'));sig=self.headers.get('X-Signature','')
                    require(abs(int(time.time())-ts)<=300 and hmac.compare_digest(sig,signature(outer.key,ts,raw)),'SIGNATURE_INVALID',403)
                    d=json.loads(raw);require(d.get('kind') in KINDS,'UNKNOWN_ADAPTER');mid=ident(d.get('messageId'));validate_contract(d['kind'],d.get('payload'))
                    with sqlite3.connect(outer.path,timeout=10,factory=ClosingConnection) as db:
                        db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT hash,response FROM accepted WHERE id=?',(mid,)).fetchone()
                        if self.path=='/query':result=json.loads(old[1]) if old else {'status':'NOT_FOUND','messageId':mid};code=200
                        else:
                            require(self.path=='/effect','NOT_FOUND',404)
                            if old:require(old[0]==sha(d['payload']),'MOCK_PAYLOAD_CONFLICT',409);result=json.loads(old[1]);code=200
                            elif d.get('mode') in ['BEFORE_FAILURE','UNAVAILABLE']:result={'status':'NO_EFFECT','retryable':True};code=503
                            else:
                                result={'status':'REJECTED' if d.get('mode')=='REJECT' else 'APPLIED','messageId':mid,'protocol':'DEMO-'+uuid.uuid4().hex[:12],'kind':d['kind'],'adapterVersion':1,'real':False}
                                payload=d['payload']
                                if d['kind']=='OMS':result['externalOrderId']=payload['order']['externalId']
                                elif d['kind']=='WMS':result['custody']=payload['custody']
                                elif d['kind']=='ERP':result['reconciledEntryIds']=payload['entryIds']
                                elif d['kind']=='CARRIER':result['labelText']='ETIQUETA FICTICIA '+payload['shipmentId']
                                elif d['kind']=='MAPS':
                                    import math
                                    result['distanceKm']=[[round(math.hypot((a['lat']-b['lat'])*111,(a['lon']-b['lon'])*111),3) for b in payload['locations']] for a in payload['locations']]
                                elif d['kind']=='FISCAL':result['documentStatus']='DEMO_REJECTED' if d.get('mode')=='REJECT' else 'DEMO_AUTHORIZED'
                                db.execute('INSERT INTO accepted VALUES(?,?,?,?)',(mid,sha(d['payload']),d['kind'],canonical(result)));db.commit()
                                if d.get('mode')=='LOST_RESPONSE':result={'status':'UNKNOWN'};code=503
                                else:code=200
                    self.reply(code,result)
                except Error as e:self.reply(e.status,{'error':e.code})
                except Exception:self.reply(400,{'error':'INVALID_MOCK_REQUEST'})
            def reply(self,code,result):
                raw=canonical(result).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.url='http://127.0.0.1:'+str(self.server.server_port)
    def close(self):self.server.shutdown();self.server.server_close();self.thread.join()

class Integrations:
    @action('admin')
    def cmd_adapter_config_create(self,db,p,d):
        require(d.get('adapter') in KINDS and d.get('mode')=='LOCAL_MOCK' and d.get('contractVersion')==1,'LOCAL_ADAPTER_CONFIG_ONLY')
        require(not set(d)-{'adapter','name','mode','contractVersion'},'ADAPTER_CONFIG_FIELDS')
        return self.add(db,p,'adapterConfig',{'adapter':d['adapter'],'name':ident(d.get('name')),'mode':'LOCAL_MOCK','contractVersion':1,'status':'PUBLISHED_IMMUTABLE'})
    def start_mock(self):
        with self.db(True) as db:
            row=db.execute("SELECT v FROM meta WHERE k='mock_key'").fetchone();key=row[0] if row else secrets.token_hex(32)
            db.execute("INSERT OR REPLACE INTO meta VALUES('mock_key',?)",(key,))
        service=MockService(self.path.parent/'mock.sqlite',key);self.mock=service;return service
    @action('admin','operator')
    def cmd_adapter_enqueue(self,db,p,d):
        require(not d.get('targetId') and not d.get('purpose'),'DEDICATED_WORKFLOW_REQUIRED')
        require(d.get('adapter') not in ['CARRIER','FISCAL'],'DEDICATED_WORKFLOW_REQUIRED')
        return self.enqueue(db,p,d)
    def enqueue(self,db,p,d):
        require(d.get('adapter') in KINDS,'INVALID_ADAPTER');require(d.get('mode','GOOD') in ['GOOD','BEFORE_FAILURE','LOST_RESPONSE','REJECT','UNAVAILABLE'],'INVALID_MODE')
        payload=d.get('payload');validate_contract(d['adapter'],payload)
        config=None
        if d.get('configId'):
            config=self.get(db,p,d['configId'],'adapterConfig',True);require(config['adapter']==d['adapter'],'ADAPTER_CONFIG_MISMATCH')
        else:
            config=self.add(db,p,'adapterConfig',{'adapter':d['adapter'],'name':'Mock local '+d['adapter'],'mode':'LOCAL_MOCK','contractVersion':1,'status':'PUBLISHED_IMMUTABLE'})
        if d['adapter']=='OMS':self.order_values(db,p,payload['order'])
        elif d['adapter']=='WMS':self.get(db,p,payload['shipmentId'],'shipment')
        elif d['adapter']=='ERP':
            for eid in payload['entryIds']:self.get(db,p,eid,'ledger',True)
        return self.add(db,p,'outbox',{'adapter':d['adapter'],'adapterVersion':1,'provider':config['name'],'configSnapshot':dict(config),'payload':payload,'mode':d.get('mode','GOOD'),'messageId':'msg-'+uuid.uuid4().hex,'status':'PENDING','attempts':0,'effect':'NONE','targetId':d.get('targetId'),'purpose':d.get('purpose')})
    def mock_request(self,message,query=False):
        require(getattr(self,'mock',None),'MOCK_NOT_RUNNING',503)
        body=canonical({'kind':message['adapter'],'messageId':message['messageId'],'payload':message['payload'],'mode':message['mode']}).encode();ts=int(time.time())
        req=Request(self.mock.url+('/query' if query else '/effect'),data=body,headers={'Content-Type':'application/json','X-Time':str(ts),'X-Signature':signature(self.mock.key,ts,body)})
        try:
            with urlopen(req,timeout=3) as response:return json.load(response)
        except HTTPError as e:
            try:return json.loads(e.read())
            except ValueError:return {'status':'UNKNOWN'}
        except (URLError,TimeoutError):return {'status':'UNKNOWN'}
    def apply_effect(self,db,p,m,result):
        if result.get('status') not in ['APPLIED','REJECTED']:return
        m['status']='DONE' if result['status']=='APPLIED' else 'REJECTED';m['effect']=result['status'];m['protocol']=result.get('protocol')
        m['result']=result
        if m['status']=='DONE':
            if m['adapter']=='OMS':m['importedOrderId']=self.cmd_order_create(db,p,m['payload']['order'])['id']
            elif m['adapter']=='WMS':
                s=self.get(db,p,m['payload']['shipmentId'],'shipment');s['wmsCustody']=result['custody'];self.save(db,s)
            elif m['adapter']=='ERP':self.add(db,p,'reconciliation',{'entryIds':result['reconciledEntryIds'],'protocol':m['protocol'],'status':'CONFIRMED_MOCK_ONLY'})
            elif m['adapter']=='MAPS':self.add(db,p,'routeMatrix',{'locations':m['payload']['locations'],'distanceKm':result['distanceKm'],'provider':'SYNTHETIC_EUCLIDEAN','status':'READY'})
        if m.get('targetId'):
            target=self.get(db,p,m['targetId'])
            if m.get('purpose')=='LABEL':target['labelStatus']='READY' if m['status']=='DONE' else 'REJECTED'
            elif m.get('purpose')=='FISCAL':target['status']='DEMO_AUTHORIZED' if m['status']=='DONE' else 'DEMO_REJECTED';target['protocol']=m['protocol'];s=self.get(db,p,target['shipmentId'],'shipment');s['fiscalStatus']=target['status'];self.save(db,s)
            self.save(db,target)
    @action('admin','operator')
    def cmd_outbox_process(self,db,p,d):
        m=self.get(db,p,d.get('id'),'outbox',True);self.version(m,d);require(m['status'] in ['PENDING','RETRY'],'RECONCILE_OR_DLQ_REQUIRED',409)
        m['attempts']+=1;m['status']='PROCESSING';result=self.mock_request(m)
        if result.get('status')=='NO_EFFECT':m['status']='RETRY' if m['attempts']<3 else 'DLQ';m['effect']='NONE'
        elif result.get('status')=='UNKNOWN' or 'error' in result:m['status']='UNKNOWN';m['effect']='UNKNOWN'
        else:self.apply_effect(db,p,m,result)
        return self.save(db,m)
    def durable_outbox_process(self,p,d,key):
        # Claim and attempt are committed BEFORE HTTP. A crash cannot turn the message back into PENDING.
        with self.db(True) as db:
            u=db.execute('SELECT * FROM users WHERE id=?',(p['id'],)).fetchone();require(u and u['active'] and set(json.loads(u['roles']))&{'admin','operator'},'ROLE_FORBIDDEN',403)
            old=db.execute('SELECT * FROM idem WHERE user=? AND cmd=? AND k=?',(p['id'],'outbox_process',key)).fetchone()
            if old:
                require(old['hash']==sha(d),'IDEMPOTENCY_CONFLICT',409);return self.get(db,p,d['id'],'outbox',True)
            m=self.get(db,p,d.get('id'),'outbox',True);self.version(m,d);require(m['status'] in ['PENDING','RETRY'],'RECONCILE_OR_DLQ_REQUIRED',409)
            m['attempts']+=1;m['status']='PROCESSING';m['claimId']=secrets.token_hex(12);self.save(db,m)
            db.execute('INSERT INTO idem VALUES(?,?,?,?,?)',(p['id'],'outbox_process',key,sha(d),canonical(m)))
            claim=m['claimId']
        result=self.mock_request(m)
        if getattr(self,'test_crash_after_effect',False):raise SystemExit('INJECTED_CRASH_AFTER_EFFECT')
        with self.db(True) as db:
            current=self.get(db,p,m['id'],'outbox',True);require(current['status']=='PROCESSING' and current['claimId']==claim,'CLAIM_CHANGED',409)
            if result.get('status')=='NO_EFFECT':current['status']='RETRY' if current['attempts']<3 else 'DLQ';current['effect']='NONE'
            elif result.get('status')=='UNKNOWN' or 'error' in result:current['status']='UNKNOWN';current['effect']='UNKNOWN'
            else:self.apply_effect(db,p,current,result)
            self.save(db,current);db.execute('UPDATE idem SET response=? WHERE user=? AND cmd=? AND k=?',(canonical(current),p['id'],'outbox_process',key));return current
    def recover_outbox(self):
        # Called once by a single server owner at startup, not by concurrent workers.
        with self.db(True) as db:
            count=0
            for m in self.all(db,'outbox'):
                if m['status']=='PROCESSING':m['status']='UNKNOWN';m['effect']='UNKNOWN';m['recovery']='QUERY_BEFORE_RETRY';self.save(db,m);count+=1
            return count
    @action('admin','operator')
    def cmd_outbox_requeue(self,db,p,d):
        m=self.get(db,p,d.get('id'),'outbox',True);self.version(m,d)
        require(m['status']=='DLQ' and m['effect'] in ['NONE','CONFIRMED_NO_EFFECT'],'DLQ_NO_EFFECT_REQUIRED',409)
        mode=d.get('mode','GOOD');require(mode in ['GOOD','BEFORE_FAILURE','UNAVAILABLE'],'INVALID_REQUEUE_MODE')
        m.setdefault('triageHistory',[]).append({'at':self.now().isoformat(),'user':p['id'],'reason':ident(d.get('reason')),'attempts':m['attempts'],'previousMode':m['mode'],'nextMode':mode})
        m.update(status='RETRY',mode=mode);return self.save(db,m)
    @action('admin','operator')
    def cmd_outbox_query(self,db,p,d):
        m=self.get(db,p,d.get('id'),'outbox',True);self.version(m,d);require(m['status']=='UNKNOWN','NOT_UNKNOWN',409);result=self.mock_request(m,True)
        if result.get('status')=='NOT_FOUND':m['status']='RETRY';m['effect']='CONFIRMED_NO_EFFECT'
        else:self.apply_effect(db,p,m,result)
        return self.save(db,m)
    @action('admin','operator')
    def cmd_label_request(self,db,p,d):
        s=self.assigned(db,p,d);self.version(s,d);require(s['status']=='ASSIGNED' and s['labelStatus']=='NONE','LABEL_ALREADY_REQUESTED',409);s['labelStatus']='PENDING';self.save(db,s)
        return self.enqueue(db,p,{'adapter':'CARRIER','configId':d.get('configId'),'mode':d.get('mode','GOOD'),'payload':{'shipmentId':s['id'],'packages':s['packages'],'demo':True},'targetId':s['id'],'purpose':'LABEL'})
    @action('admin')
    def cmd_fiscal_policy(self,db,p,d):
        require(d.get('mode')=='DEMO_ONLY','REAL_POLICY_NOT_VALIDATED');require(d.get('requirements') in [[],['DEMO_DOCUMENT']],'UNKNOWN_REQUIREMENT')
        return self.add(db,p,'fiscalPolicy',{'name':ident(d.get('name')),'scenario':ident(d.get('scenario')),'requirements':d['requirements'],'status':'SIMULATED_NOT_LEGAL','mode':'DEMO_ONLY'})
    @action('admin','operator')
    def cmd_fiscal_evaluate(self,db,p,d):
        s=self.assigned(db,p,d);self.version(s,d)
        if not d.get('policyId'):return {'status':'PENDENTE_DADOS','reason':'Cenario e aplicabilidade nao definidos; municipal nao dispensa CIOT por inferencia'}
        policy=self.get(db,p,d['policyId'],'fiscalPolicy',True);require(d.get('scenario')==policy['scenario'],'SCENARIO_MISMATCH');require(d.get('realOperation') is not True,'EXTERNAL_HOMOLOGATION_BLOCKED',403)
        if not policy['requirements']:s['fiscalStatus']='DEMO_NOT_REQUIRED';return self.save(db,s)
        require(not any(x['shipmentId']==s['id'] and x['status'] not in ['DEMO_CANCELLED','DEMO_REJECTED'] for x in self.all(db,'fiscalDocument')),'DOCUMENT_ALREADY_EXISTS',409)
        doc=self.add(db,p,'fiscalDocument',{'shipmentId':s['id'],'policySnapshot':dict(policy),'status':'PENDING','real':False})
        out=self.enqueue(db,p,{'adapter':'FISCAL','configId':d.get('configId'),'mode':d.get('mode','GOOD'),'payload':{'documentId':doc['id'],'schema':'DEMO_ENVELOPE_1','scenario':policy['scenario']},'targetId':doc['id'],'purpose':'FISCAL'});doc['outboxId']=out['id'];self.save(db,doc);return doc
    @action('admin','operator')
    def cmd_fiscal_cancel(self,db,p,d):
        doc=self.get(db,p,d.get('id'),'fiscalDocument',True);self.version(doc,d);require(doc['status']=='DEMO_AUTHORIZED','INVALID_STATE');s=self.get(db,p,doc['shipmentId'],'shipment');require(s['status']=='ASSIGNED','EXECUTION_STARTED',409)
        doc.update(status='DEMO_CANCELLED',cancelReason=ident(d.get('reason')));s['fiscalStatus']='NOT_EVALUATED';self.save(db,s);return self.save(db,doc)
    def receive_callback(self,source,message,payload,ts,sig):
        body=canonical({'source':source,'message':message,'payload':payload}).encode()
        with self.db(True) as db:
            row=db.execute("SELECT v FROM meta WHERE k='mock_key'").fetchone();require(row and abs(int(time.time())-ts)<=300 and hmac.compare_digest(sig,signature(row[0],ts,body)),'SIGNATURE_INVALID',403)
            old=db.execute('SELECT hash FROM inbox WHERE source=? AND message=?',(source,message)).fetchone()
            if old:require(old[0]==sha(payload),'INBOX_CONFLICT',409);return {'status':'DUPLICATE_NO_EFFECT'}
            db.execute('INSERT INTO inbox VALUES(?,?,?,?)',(ident(source),ident(message),sha(payload),self.now().isoformat()));return {'status':'RECEIVED_LOCAL_ONLY'}
