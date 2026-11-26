(function(){
 'use strict';
 const node=(tag,text)=>{const x=document.createElement(tag);if(text)x.textContent=text;return x;};
 const actorNames={'loja.admin':'Ana Ribeiro · Gestão','lince.coleta':'Bruno Costa · Coletas','lince.motorista':'Marcos Lima · Entregas','carrier1.admin':'Carlos Nunes · Vértice Transportes','carrier2.admin':'Marina Souza · Via Norte Logística'};
 async function start(){
  if(!window.LincePublicContext)return;
  try{
   await window.LincePublicContext.ready;
   const url=new URL(location.href),requested=url.searchParams.get('exploreActor');
   if(requested){
    const response=await fetch('/api/personas'),catalog=await response.json(),person=catalog.personas?.find(p=>p.username===requested);
    url.searchParams.delete('exploreActor');history.replaceState(null,'',url);
    if(person&&window.LincePublicContext.persona!==person.id){
     const select=document.querySelector('select[aria-label="Persona pública de simulação"]');
     if(select){select.value=person.id;select.dispatchEvent(new Event('change',{bubbles:true}));return;}
    }
   }
   const response=await fetch('/api/exploration');if(!response.ok)return;const data=await response.json(),main=document.querySelector('main');if(!main)return;
   const panel=node('details');panel.className='panel lince-exploration-guide';panel.style.cssText='padding:18px;margin:12px 0;border:1px solid #d9c4ed;border-radius:12px;background:#fff;color:#2f1d3d';
   panel.append(node('summary','Comece por aqui: operação pronta para explorar'));
   if(!data.enabled){panel.append(node('p','Este cenário preserva a massa anterior. Use “Novo cenário” para explorar os exemplos de coleta, reversa, frete único e docas. Os registros atuais não serão apagados.'));main.prepend(panel);return;}
   panel.append(node('p','Cada percurso indica o responsável e o resultado esperado. Acompanhe as alterações na gestão e no app motorista.'));
   for(const route of data.routes||[]){
    const card=node('article');card.style.cssText='padding:12px 0;border-top:1px solid #e7dded';const title=({'EXP-PICKUP':'Conferir uma coleta','EXP-RETURN':'Coletar uma devolução','EXP-CHECKOUT':'Conferir o frete único','EXP-DOCK':'Agendar uma doca'})[route.id]||route.id;
    card.append(node('h3',title),node('p','Perfil: '+(actorNames[route.actor]||route.actor)),node('p',route.expected));
    const a=node('a','Abrir este percurso');const target=new URL(route.link,location.origin);target.searchParams.set('workspace',window.LincePublicContext.workspace);target.searchParams.set('exploreActor',route.actor);
    if(target.pathname.startsWith('/driver/')){if(route.kind==='shipment')target.hash=new URLSearchParams({trip:route.objectId}).toString();}
    else{const module=route.kind==='checkout'?'orders':route.kind==='dockReservation'?'planning':'execution';target.hash=new URLSearchParams({module,type:route.kind,record:route.objectId}).toString();}
    a.href=target.href;a.style.cssText='display:inline-block;padding:10px 14px;border-radius:8px;background:#5a2d82;color:white';card.append(a);panel.append(card);
   }
   panel.append(node('p','Para testar o leitor: abra uma viagem, escolha a parada, mostre suas etiquetas QR de teste e use “Ler etiqueta”. A leitura apenas confere/seleciona o volume; confirme a operação separadamente. Câmera, imagem e entrada manual são modos distintos.'));
   main.prepend(panel);
  }catch(error){console.warn('Guia de exploração indisponível; cenário atual preservado.');}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
