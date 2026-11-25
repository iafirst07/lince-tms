(function () {
  'use strict';
  const originalFetch=window.fetch.bind(window),url=new URL(location.href),mode=location.pathname.startsWith('/driver/')?'driver':'desktop';
  const validWorkspace=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
  const previousWorkspace=sessionStorage.getItem('lince-demo-workspace');
  let workspace=url.searchParams.get('workspace')||previousWorkspace;
  if(!validWorkspace(workspace))workspace=crypto.randomUUID();
  sessionStorage.setItem('lince-demo-workspace',workspace);url.searchParams.set('workspace',workspace);history.replaceState(null,'',url);
  if(previousWorkspace!==workspace){
    // Preserve pending records in their original namespaces; remove only active
    // actor pointers so an offline first visit cannot display another scenario.
    sessionStorage.removeItem('rota-actor');localStorage.removeItem('rota-current-actor');localStorage.removeItem('lince-driver-actor');localStorage.removeItem('lince-driver-signed-out');
    sessionStorage.removeItem('lince-demo-persona:desktop');sessionStorage.removeItem('lince-demo-persona:driver');sessionStorage.removeItem('lince-demo-signed-out:desktop');sessionStorage.removeItem('lince-demo-signed-out:driver');
  }
  const personaKey='lince-demo-persona:'+mode,exitKey='lince-demo-signed-out:'+mode;
  let persona=sessionStorage.getItem(personaKey)||'',catalog=[],toolbar=null,ready,inFlight=null,readyState='idle',readyResult=null,lastFailure=null;
  function storePersona(value){persona=value||'';if(persona)sessionStorage.setItem(personaKey,persona);else sessionStorage.removeItem(personaKey);}
  async function bootstrap(){
    const response=await originalFetch('/api/personas',{headers:{'X-Lince-Workspace':workspace},credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error('O cenário público não está disponível. Tente novamente quando houver conexão.');
    const result=await response.json();catalog=result.personas||[];
    if(!catalog.some(p=>p.id===persona))storePersona('');
    if(!persona&&!sessionStorage.getItem(exitKey)){
      const defaultPersona=mode==='driver'?(catalog.find(p=>p.username==='lince.motorista')||catalog.find(p=>p.roles?.length===1&&p.roles[0]==='driver')||catalog.find(p=>p.roles?.includes('driver'))):catalog.find(p=>p.username==='loja.admin')||catalog.find(p=>p.roles?.includes('admin'));
      if(defaultPersona)storePersona(defaultPersona.id);
    }
    return result;
  }
  function ensureReady({retry=false}={}){
    if(readyState==='ready')return Promise.resolve(readyResult);
    if(inFlight)return inFlight;
    if(readyState==='failed'&&(!retry||navigator.onLine===false))return Promise.reject(lastFailure);
    readyState='pending';
    inFlight=bootstrap().then(result=>{readyResult=result;readyState='ready';lastFailure=null;renderToolbar();contextualLinks();return result;},error=>{readyState='failed';lastFailure=error;throw error;}).finally(()=>{inFlight=null;});
    return inFlight;
  }
  // One bootstrap attempt in flight, no background polling. A later API request
  // may retry once after connectivity returns instead of awaiting a dead promise.
  ready=ensureReady();ready.catch(()=>{});
  // This adapter adds context to HTTP. It never manufactures an API response,
  // runs business handlers, or persists the server's domain state in the browser.
  window.fetch=async function(input,init={}){
    const target=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
    if(target.origin!==location.origin||!target.pathname.startsWith('/api/'))return originalFetch(input,init);
    if(target.pathname!=='/api/personas')await ensureReady({retry:true});
    const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers||{}).forEach((v,k)=>headers.set(k,v));
    headers.set('X-Lince-Workspace',workspace);if(persona)headers.set('X-Lince-Persona',persona);
    const response=await originalFetch(input,{...init,headers,credentials:'omit'});
    if(target.pathname==='/api/login'&&response.ok){const result=await response.clone().json();storePersona(result.user.id);sessionStorage.removeItem(exitKey);renderToolbar();}
    if(target.pathname==='/api/logout'&&response.ok){storePersona('');sessionStorage.setItem(exitKey,'1');renderToolbar();}
    return response;
  };
  function contextualLinks(){
    document.querySelectorAll('a[href]').forEach(a=>{
      let target;try{target=new URL(a.getAttribute('href'),location.href);}catch{return;}
      if(target.origin!==location.origin||a.getAttribute('href').startsWith('#'))return;
      if(target.pathname.startsWith('/api/file')){target.searchParams.set('workspace',workspace);if(persona)target.searchParams.set('persona',persona);}
      else if(!target.pathname.startsWith('/api/'))target.searchParams.set('workspace',workspace);
      if(a.href!==target.href)a.href=target.href;
    });
    document.querySelectorAll('input[type=password]').forEach(input=>{input.required=false;input.disabled=true;input.value='';input.placeholder='Sem senha na simulação pública';});
  }
  function renderToolbar(){
    if(!toolbar)return;toolbar.replaceChildren();
    const title=document.createElement('strong');title.textContent='Lince · simulação pública';toolbar.append(title);
    const description=document.createElement('span');description.textContent='Dados fictícios. Personas públicas, sem autenticação ou operação real.';toolbar.append(description);
    const label=document.createElement('label');label.textContent='Persona ';
    const select=document.createElement('select');select.setAttribute('aria-label','Persona pública de simulação');
    const empty=document.createElement('option');empty.value='';empty.textContent='Escolher persona';select.append(empty);
    for(const p of catalog){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.username} · ${p.roles.join(', ')}`;select.append(option);}select.value=persona;
    select.onchange=()=>{storePersona(select.value);sessionStorage.removeItem(exitKey);location.reload();};label.append(select);toolbar.append(label);
    const share=document.createElement('button');share.type='button';share.textContent='Copiar link do cenário';share.onclick=async()=>{const shared=new URL(location.href);shared.searchParams.set('workspace',workspace);try{await navigator.clipboard.writeText(shared.href);share.textContent='Link copiado';}catch{prompt('Copie o link deste cenário fictício:',shared.href);}};toolbar.append(share);
    const fresh=document.createElement('button');fresh.type='button';fresh.textContent='Novo cenário';fresh.onclick=()=>{const target=new URL(location.href);target.searchParams.set('workspace',crypto.randomUUID());location.href=target.href;};toolbar.append(fresh);
    const desktop=document.createElement('a');desktop.href='/?workspace='+workspace;desktop.textContent='Gestão';toolbar.append(desktop);
    const driver=document.createElement('a');driver.href='/driver/?workspace='+workspace;driver.textContent='Motorista';toolbar.append(driver);
    const docs=document.createElement('a');docs.href='/docs/?workspace='+workspace;docs.textContent='API e documentação';toolbar.append(docs);
  }
  async function installToolbar(){
    const style=document.createElement('style');style.textContent='.lince-demo-toolbar{position:relative;z-index:10000;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;background:#3B195B;color:#fff;font:13px/1.4 system-ui,sans-serif;border-bottom:3px solid #F05A6E}.lince-demo-toolbar strong{font-size:15px}.lince-demo-toolbar>span{flex:1;min-width:170px}.lince-demo-toolbar label{margin:0;font:inherit;color:#fff}.lince-demo-toolbar select{font:inherit;display:inline-block;width:auto;max-width:240px;min-height:34px;padding:6px;border-radius:6px;color:#321A43;background:#fff}.lince-demo-toolbar button{font:inherit;min-height:34px;padding:7px 10px;border:1px solid #d5c3e4;border-radius:6px;background:#fff;color:#3B195B;cursor:pointer}.lince-demo-toolbar a{color:#fff;text-decoration:underline;padding:5px}.lince-demo-toolbar :focus-visible{outline:3px solid #F05A6E;outline-offset:2px}';document.head.append(style);
    toolbar=document.createElement('aside');toolbar.className='lince-demo-toolbar';toolbar.setAttribute('aria-label','Controles do cenário público fictício');document.body.prepend(toolbar);
    try{await ready;renderToolbar();}catch(error){toolbar.textContent='Simulação pública: '+error.message;}
    contextualLinks();new MutationObserver(contextualLinks).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installToolbar,{once:true});else installToolbar();
  window.LincePublicContext={workspace,get persona(){return persona;},get ready(){return ensureReady({retry:true});},get status(){return readyState;},ensureReady};
})();
