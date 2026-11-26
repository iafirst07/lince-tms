import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const assetsDir=path.join(root,'source-assets');
const definitions={
 '/form-state.js':['form-state.js','text/javascript; charset=utf-8'],
 '/navigation.js':['navigation.js','text/javascript; charset=utf-8'], '/navigation.css':['navigation.css','text/css; charset=utf-8'],
 '/':['index.html','text/html; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'], '/style.css':['style.css','text/css; charset=utf-8'], '/sw.js':['sw.js','text/javascript; charset=utf-8'],
 '/driver/':['driver.html','text/html; charset=utf-8'], '/driver/driver.js':['driver.js','text/javascript; charset=utf-8'], '/driver/driver.css':['driver.css','text/css; charset=utf-8'], '/driver/driver-sw.js':['driver-sw.js','text/javascript; charset=utf-8'],
 '/driver/manifest.webmanifest':['driver.webmanifest','application/manifest+json'], '/driver/icon.svg':['driver-icon.svg','image/svg+xml'], '/driver/icon-192.png':['driver-icon-192.png','image/png'], '/driver/icon-512.png':['driver-icon-512.png','image/png'],
 '/docs/':['docs.html','text/html; charset=utf-8'], '/docs/openapi.json':['openapi.json','application/json'],
 '/demo-context.js':['../public-runtime/demo-context.js','text/javascript; charset=utf-8'], '/simulation-console.js':['../public-runtime/simulation-console.js','text/javascript; charset=utf-8']
};
const assets={};
for(const [url,[name,mime]] of Object.entries(definitions)){
 const filename=path.resolve(assetsDir,name);
 let bytes=fs.readFileSync(filename);
 if(name==='openapi.json'){
  const spec=JSON.parse(bytes.toString('utf8'));
  spec.info={...spec.info,title:'Lince — API pública de simulação',description:(spec.info.description||'')+' Variante pública: dados fictícios, workspace compartilhável e personas de demonstração; não autenticação real. O backend Python possui contrato de sessão distinto.'};
  spec.servers=[{url:'/'}];delete spec.security;
  for(const [route,item] of Object.entries(spec.paths||{}))for(const [method,op] of Object.entries(item)){
   if(!['get','post','put','patch','delete'].includes(method))continue;
   delete op.security;
   op.parameters=[...(op.parameters||[]),{name:'X-Lince-Workspace',in:'header',required:true,schema:{type:'string',format:'uuid'},description:'Identificador do cenário fictício compartilhável.'},{name:'X-Lince-Persona',in:'header',required:false,schema:{type:'string'},description:'ID de uma persona fictícia do cenário. Não é autenticação.'}];
  }
  spec.paths['/api/personas']={get:{summary:'Listar personas fictícias do cenário',responses:{'200':{description:'Perfis públicos de simulação, sem senhas.'}}}};
  spec.paths['/api/inbox']={post:{summary:'Receber evento simulado no workspace',description:'Não é webhook de fornecedor real; operação depende do contrato do simulador público.',responses:{'200':{description:'Recebimento/projeção explicitamente simulados.'},'409':{description:'Conflito de estado ou identidade.'}}}};
  const workspaceHeader={name:'X-Lince-Workspace',in:'header',required:true,schema:{type:'string',format:'uuid'},description:'Cenário fictício compartilhável.'};
  const personaHeader={name:'X-Lince-Persona',in:'header',required:true,schema:{type:'string'},description:'Persona fictícia; não autenticação.'};
  spec.paths['/api/personas'].get.parameters=[workspaceHeader];
  spec.paths['/api/inbox'].post.parameters=[workspaceHeader,personaHeader,{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'},description:'Preservar em repetição da mesma solicitação.'}];
  spec.paths['/api/inbox'].post.requestBody={required:true,content:{'application/json':{schema:{type:'object',required:['eventId','type','payload'],properties:{eventId:{type:'string'},type:{enum:['TRACKING','WMS','ERP_ACK']},payload:{type:'object',description:'TRACKING segue Command_tracking; WMS usa shipmentId/custody; ERP_ACK usa entryIds/reference.'}}}}}};
  const envelope=spec.components?.schemas?.CommandEnvelope;
  if(envelope?.oneOf){
   envelope.oneOf=envelope.oneOf.filter(x=>x.properties?.command?.const!=='migration_rollback');
   for(const command of ['backup','simulation_reset','inbox_receive'])envelope.oneOf.push({type:'object',required:['command','payload'],properties:{command:{const:command},payload:{type:'object',description:command==='simulation_reset'?'Não apaga cenário: retorna409 e orienta criar outro workspace.':command==='backup'?'Exporta ZIP fictício pelo endpoint /api/backup.':'Evento simulado: eventId, type TRACKING/WMS/ERP_ACK e payload próprio.'}}});
  }
  spec['x-python-only-commands']=['migration_rollback'];
  spec['x-runtime']='PUBLIC_SIMULATION_ONLY';bytes=Buffer.from(JSON.stringify(spec));
 }
 if(name.endsWith('.html')){
  let text=bytes.toString('utf8');
  text=text.replace('<head>','<head><script src="/demo-context.js"></script>');
  if(!text.includes('src="/demo-context.js"'))text=text.replace(/<head([^>]*)>/,'<head$1><script src="/demo-context.js"></script>');
  if(name==='index.html')text=text.replace('</head>','<script src="/simulation-console.js" defer></script></head>');
  bytes=Buffer.from(text);
 }
 if(name==='sw.js'||name==='driver-sw.js'){
  let text=bytes.toString('utf8');
  text=text.replace(/const SHELL = \[/,"const SHELL = ['/demo-context.js',");
  if(name==='sw.js')text=text.replace(/const ASSETS=\[/,"const ASSETS=['/demo-context.js','/simulation-console.js',");
  text=text.replace('lince-driver-shell-v1','lince-driver-public-v2');
  if(name==='driver-sw.js')text=text.replace('|| url.search) return;',"|| (url.search && url.pathname !== '/driver/')) return;");
  bytes=Buffer.from(text);
 }
 assets[url]={bodyBase64:bytes.toString('base64'),mime};
}
const read=n=>fs.readFileSync(path.join(root,'public-runtime',n),'utf8');
const strip=s=>s.replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm,'').replace(/^export\s*\{[^}]*\};?\s*$/gm,'').replace(/\bexport\s+(?=(?:async\s+)?(?:function|class)\b|(?:const|let|var)\b)/g,'');
const isolated=(file,names)=>'const {'+names.join(',')+'}=(()=>{\n'+strip(read(file))+'\nreturn {'+names.join(',')+'};})();\n';
const domain=isolated('volumetric.mjs',['validatePolicy','validateExactRate','overlapWeightBands','calculation','inBand','priceLines','totalLines'])+isolated('commerce.mjs',['createCheckoutHandlers'])+isolated('driver-tasks.mjs',['createDriverTaskHandlers'])+isolated('dock.mjs',['createDockHandlers'])+strip(read('domain.mjs')),worker=strip(read('worker.mjs'));
if(/^import /m.test(domain+'\n'+worker))throw new Error('Unbundled import');
const seed=JSON.parse(read('seed.json'));
const domainImports=read('worker.mjs').match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/domain\.mjs['"]/);
if(!domainImports)throw new Error('Domain import contract missing');
const imported=domainImports[1].split(',').map(x=>x.trim());
const bundle='// Lince public simulation. Fictitious data only.\nconst SEED='+JSON.stringify(seed)+';\nconst ASSETS='+JSON.stringify(assets)+';\nconst __LinceDomain=(()=>{\n'+domain+'\nreturn {'+imported.join(',')+'};})();\nconst {'+imported.join(',')+'}=__LinceDomain;\n'+worker;
const out=path.join(root,'dist/server');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'index.js'),bundle);
fs.mkdirSync(path.join(root,'dist/.openai'),{recursive:true});fs.copyFileSync(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
console.log(JSON.stringify({assets:Object.keys(assets).length,seedObjects:seed.objects.length,bundleBytes:Buffer.byteLength(bundle)}));
