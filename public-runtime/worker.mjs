import {createLiveOperations} from './live-operations.mjs';
import {createExploration} from './exploration.mjs';
import {createWorkspace,choosePersona,personas,stateFor,executeCommand,fingerprintRequest,simulate,kpis,ApiError,COMMANDS} from './domain.mjs';
import {SEED,ASSETS} from './generated.mjs';

const liveOperations=createLiveOperations({executeCommand,choosePersona,ApiError});
const enrichExploration=createExploration({executeCommand,choosePersona});
const encoder=new TextEncoder();
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
const assert=(ok,code,status=400)=>{if(!ok)throw new ApiError(code,status);};
const decode=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
const encode=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK=262144,MAX_JSON=900000,MAX_FILES=24,MAX_TOTAL_FILE_BYTES=8*1024*1024;

async function externalizeFiles(db,workspaceId,w){
  const entries=Object.values(w.files||{});assert(entries.length<=MAX_FILES,'SIMULATION_FILE_LIMIT',413);assert(entries.reduce((n,f)=>n+Number(f.bytes||0),0)<=MAX_TOTAL_FILE_BYTES,'SIMULATION_FILE_BYTES_LIMIT',413);
  for(const file of entries){
    if(typeof file.base64!=='string')continue;
    const body=file.base64;assert(body.length<=2796204,'FILE_SIZE',413);
    let count=0;
    for(let i=0;i<body.length;i+=CHUNK){await db.prepare('INSERT OR REPLACE INTO simulation_file_chunks (workspace_id,file_id,chunk_index,body) VALUES (?,?,?,?)').bind(workspaceId,file.id,count++,body.slice(i,i+CHUNK)).run();}
    delete file.base64;file.chunkCount=count;file.storage='D1_CHUNKS_SIMULATION';
  }
}
function serialized(w){const value=JSON.stringify(w);assert(encoder.encode(value).length<=MAX_JSON,'SIMULATION_WORKSPACE_LIMIT',413);return value;}
async function load(db,wid,seed,now,exploration=false){
  let row=await db.prepare('SELECT version,data FROM simulation_workspaces WHERE id=?').bind(wid).first();
  if(row)return{version:Number(row.version),workspace:JSON.parse(row.data)};
  const base=createWorkspace(seed,now),w=exploration?enrichExploration(base,{enabled:true}):base;await externalizeFiles(db,wid,w);const body=serialized(w);
  await db.prepare('INSERT OR IGNORE INTO simulation_workspaces (id,version,data,updated_at) VALUES (?,1,?,?)').bind(wid,body,now).run();
  row=await db.prepare('SELECT version,data FROM simulation_workspaces WHERE id=?').bind(wid).first();assert(row,'WORKSPACE_CREATE_FAILED',503);return{version:Number(row.version),workspace:JSON.parse(row.data)};
}
async function persist(db,wid,version,w,now){
  // New chunks can precede the CAS. A losing update may leave unreachable chunks;
  // metadata is only referenced by a successful workspace CAS, never by orphan lookup.
  await externalizeFiles(db,wid,w);const body=serialized(w);
  const result=await db.prepare('UPDATE simulation_workspaces SET version=version+1,data=?,updated_at=? WHERE id=? AND version=?').bind(body,now,wid,version).run();
  assert(Number(result.meta?.changes||result.changes||0)===1,'WORKSPACE_CONFLICT_RETRY_SAME_OPERATION',409);
}
async function fileBody(db,wid,metadata){
  assert(metadata,'NOT_FOUND',404);
  const rows=await db.prepare('SELECT chunk_index,body FROM simulation_file_chunks WHERE workspace_id=? AND file_id=? ORDER BY chunk_index').bind(wid,metadata.id).all();
  const values=rows.results||[];assert(values.length===metadata.chunkCount&&values.every((row,i)=>row.chunk_index===i),'FILE_INCOMPLETE',409);
  return decode(values.map(row=>row.body).join(''));
}
function zipStored(name,body){
  const filename=encoder.encode(name),bytes=encoder.encode(body),crcTable=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
  let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
  const local=new Uint8Array(30+filename.length),central=new Uint8Array(46+filename.length),end=new Uint8Array(22),lv=new DataView(local.buffer),cv=new DataView(central.buffer),ev=new DataView(end.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint32(14,crc,true);lv.setUint32(18,bytes.length,true);lv.setUint32(22,bytes.length,true);lv.setUint16(26,filename.length,true);local.set(filename,30);
  cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,crc,true);cv.setUint32(20,bytes.length,true);cv.setUint32(24,bytes.length,true);cv.setUint16(28,filename.length,true);central.set(filename,46);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,1,true);ev.setUint16(10,1,true);ev.setUint32(12,central.length,true);ev.setUint32(16,local.length+bytes.length,true);
  const output=new Uint8Array(local.length+bytes.length+central.length+end.length);output.set(local);output.set(bytes,local.length);output.set(central,local.length+bytes.length);output.set(end,local.length+bytes.length+central.length);return output;
}
export function createWorker({seed,assets,exploration=false}){
  return{async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    try{
      if(!path.startsWith('/api/')){
        const asset=assets[path]||assets[path==='/'?'/':path.endsWith('/')?path+'index.html':path];
        if(!asset)return json({error:{code:'NOT_FOUND'}},404);
        assert(request.method==='GET'||request.method==='HEAD','METHOD_NOT_ALLOWED',405);
        return new Response(request.method==='HEAD'?null:decode(asset.bodyBase64),{headers:{'Content-Type':asset.mime||'application/octet-stream','Cache-Control':path.endsWith('sw.js')?'no-cache':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
      }
      assert(env.DB,'SIMULATION_DATABASE_UNAVAILABLE',503);
      const wid=request.headers.get('X-Lince-Workspace')||url.searchParams.get('workspace');assert(UUID.test(wid||''),'WORKSPACE_REQUIRED');
      const now=new Date().toISOString(),loaded=await load(env.DB,wid,seed,now,exploration),w=loaded.workspace;
      let identifier=request.headers.get('X-Lince-Persona')||url.searchParams.get('persona');
      if(request.method==='GET'&&path==='/api/personas')return json({simulation:true,workspace:wid,personas:personas(w),commands:COMMANDS,limits:w.limits});
      let body=null;
      if(request.method==='POST'){
        assert(request.headers.get('Content-Type')?.split(';')[0]==='application/json'||path==='/api/logout'||path==='/api/backup','JSON_REQUIRED');
        const raw=await request.text();assert(encoder.encode(raw).length<=3000000,'BODY_SIZE',413);body=raw?JSON.parse(raw):{};assert(body&&typeof body==='object'&&!Array.isArray(body),'JSON_OBJECT_REQUIRED');
      }
      if(request.method==='POST'&&path==='/api/login'){
        const p=choosePersona(w,body.username||body.persona);return json({user:p,csrf:'PUBLIC_SIMULATION_NOT_AUTH',simulation:true,authentication:false,workspace:wid});
      }
      const p=choosePersona(w,identifier);
      if(request.method==='GET'&&path==='/api/session')return json({user:p,csrf:'PUBLIC_SIMULATION_NOT_AUTH',simulation:true,authentication:false,workspace:wid});
      if(request.method==='POST'&&path==='/api/logout')return json({status:'LOGGED_OUT',simulation:true,remoteSessionExisted:false});
      if(request.method==='GET'&&path==='/api/simulation'){
        const manifest=stateFor(w,p).objects.find(o=>o.kind==='simulationManifest')||null;
        return json({enabled:!!manifest,manifest,simulation:true,realOperationAllowed:false});
      }
      if(request.method==='GET'&&path==='/api/exploration'){const x=w.exploration;return json({enabled:!!x,version:x?.version||null,routes:(x?.routes||[]).map(route=>({...route,kind:w.objects.find(o=>o.id===route.objectId)?.kind})),simulation:true});}
      if(request.method==='GET'&&path==='/api/live-state')return json(liveOperations.read(w,p,{...Object.fromEntries(url.searchParams),now}));
      if(request.method==='GET'&&path==='/api/live-document'){
        const doc=liveOperations.document(w,p,url.searchParams.get('id'),url.searchParams.get('format')||'html');
        return new Response(doc.body,{headers:{'Content-Type':doc.mime,'Content-Disposition':'inline; filename="'+doc.filename+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'"}});
      }
      if(request.method==='POST'&&path==='/api/live-command'){
        const key=request.headers.get('Idempotency-Key');assert(key,'IDEMPOTENCY_KEY_REQUIRED');
        const changed=liveOperations.command(w,p,body.action,body.payload,key,now);
        if(!changed.replayed)await persist(env.DB,wid,loaded.version,changed.workspace,now);
        return json(changed.result);
      }
      if(request.method==='GET'&&path==='/api/state')return json({...stateFor(w,p,url.searchParams.get('id')||undefined),workspace:wid,workspaceVersion:loaded.version});
      if(request.method==='GET'&&path==='/api/kpis')return json(kpis(w,p));
      if(request.method==='GET'&&path==='/api/file'){
        const metadata=w.files[url.searchParams.get('id')];const bytes=await fileBody(env.DB,wid,metadata);
        return new Response(bytes,{headers:{'Content-Type':metadata.mime,'Content-Disposition':'attachment; filename="comprovante-ficticio.'+(metadata.mime==='image/png'?'png':'jpg')+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }
      if(request.method==='POST'&&path==='/api/simulate'){
        const preview=copyClock(w,now);return json(simulate(preview,p,body));
      }
      if(request.method==='POST'&&path==='/api/backup'){
        const snapshot=JSON.parse(JSON.stringify(w));for(const file of Object.values(snapshot.files))file.base64=encode(await fileBody(env.DB,wid,file));
        return new Response(zipStored('lince-cenario-ficticio.json',JSON.stringify({simulation:true,workspace:wid,exportedAt:now,data:snapshot},null,2)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="lince-cenario-ficticio.zip"','Cache-Control':'no-store'}});
      }
      if(request.method==='POST'&&(path==='/api/command'||path==='/api/inbox')){
        const key=request.headers.get('Idempotency-Key');assert(key,'IDEMPOTENCY_KEY_REQUIRED');const command=path==='/api/inbox'?'inbox_receive':body.command,payload=path==='/api/inbox'?body:body.payload;
        const hash=await fingerprintRequest(command,payload),changed=executeCommand(w,p,command,payload,key,now,hash);
        if(!changed.replayed)await persist(env.DB,wid,loaded.version,changed.workspace,now);
        return json(changed.result);
      }
      throw new ApiError('NOT_FOUND',404);
    }catch(error){
      if(error instanceof ApiError)return json({error:{code:error.code,message:error.message},simulation:true},error.status);
      if(error instanceof SyntaxError)return json({error:{code:'INVALID_JSON'},simulation:true},400);
      console.error('Public simulation request failed',String(error?.message||'unknown'));
      return json({error:{code:'SIMULATION_OPERATION_NOT_CONFIRMED',message:'A operação não foi confirmada. Preserve a chave e consulte o cenário antes de tentar novamente.'},simulation:true},503);
    }
  }};
}
function copyClock(w,now){const v=JSON.parse(JSON.stringify(w));v.clock=now;return v;}
export default createWorker({seed:SEED,assets:ASSETS,exploration:true});
