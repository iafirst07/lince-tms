(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;root.LinceScanner=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 class ScannerError extends Error {constructor(code,message){super(message);this.name='ScannerError';this.code=code;}}
 const fail=(code,message)=>{throw new ScannerError(code,message);};
 function parseCode(value){
  if(typeof value!=='string'||value.length>264||value.length<3)fail('INVALID_CODE','Identificador vazio ou grande demais.');
  const format=value.startsWith('LINCE1:')?'LINCE1':'RAW',packageKey=format==='LINCE1'?value.slice(7):value;
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(packageKey)||/^(https?|javascript|data|blob|file|ftp):/i.test(packageKey))fail('INVALID_CODE','Leia uma etiqueta LINCE1 ou informe a chave exata do volume. Links não são abertos.');
  return {packageKey,format};
 }
 function encodeQrMatrix(value,encoder=root.qrcode){
  const parsed=parseCode(value);if(typeof encoder!=='function')fail('ENCODER_UNAVAILABLE','Gerador QR local indisponível.');
  const payload='LINCE1:'+parsed.packageKey,qr=encoder(0,'M');qr.addData(payload,'Byte');qr.make();const size=qr.getModuleCount();
  return {payload,size,modules:Array.from({length:size},(_,r)=>Array.from({length:size},(_,c)=>qr.isDark(r,c)))};
 }
 function encodeQrSvg(value,encoder=root.qrcode){
  const qr=encodeQrMatrix(value,encoder),size=qr.size+8;let d='';qr.modules.forEach((row,r)=>row.forEach((dark,c)=>{if(dark)d+=`M${c+4},${r+4}h1v1h-1z`;}));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR de volume Lince"><rect width="${size}" height="${size}" fill="white"/><path d="${d}" fill="black"/></svg>`;
 }
 function decodePixels(data,width,height,decoder=root.jsQR){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>4000000||!ArrayBuffer.isView(data)||data.BYTES_PER_ELEMENT!==1||data.length!==width*height*4)fail('INVALID_IMAGE','Pixels ou dimensões inválidos.');
  if(typeof decoder!=='function')fail('DECODER_UNAVAILABLE','Leitor QR local indisponível. Use a entrada manual identificada.');
  const result=decoder(data,width,height,{inversionAttempts:'attemptBoth'});return result?parseCode(result.data):null;
 }
 function cameraError(error){const messages={NotAllowedError:['CAMERA_DENIED','Permissão de câmera negada. Autorize no navegador ou use imagem/entrada manual.'],NotFoundError:['CAMERA_UNAVAILABLE','Nenhuma câmera disponível. Use imagem ou entrada manual.'],NotReadableError:['CAMERA_BUSY','Câmera em uso ou indisponível. Feche outro aplicativo e tente novamente.'],AbortError:['CAMERA_CANCELLED','A abertura da câmera foi cancelada.']};const mapped=messages[error?.name];return error instanceof ScannerError?error:new ScannerError(mapped?.[0]||'CAMERA_ERROR',mapped?.[1]||'Não foi possível abrir a câmera. Use HTTPS e confira o dispositivo.');}
 function createCapture({mediaDevices=root.navigator?.mediaDevices,video,readFrame,onCode=()=>{},onError=()=>{},schedule=fn=>root.setTimeout(fn,180),cancel=id=>root.clearTimeout(id)}){
  let generation=0,stream=null,timer=null,lastInvalid='';
  const stopTracks=s=>{for(const track of s?.getTracks?.()||[])try{track.stop();}catch{}};
  function stop(){generation++;if(timer!==null)cancel(timer);timer=null;stopTracks(stream);stream=null;if(video){try{video.pause();}catch{}video.srcObject=null;}}
  async function start(facing='environment'){
   stop();lastInvalid='';const token=generation;
   if(!mediaDevices?.getUserMedia){onError(new ScannerError('CAMERA_UNAVAILABLE','Câmera não disponível neste navegador ou conexão. Use imagem ou entrada manual.'));return;}
   try{
    const acquired=await mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing}}});
    if(token!==generation){stopTracks(acquired);return;}stream=acquired;video.srcObject=stream;await video.play();
    if(token!==generation)return;
    async function tick(){
     if(token!==generation)return;
     try{const code=await readFrame(video);if(token!==generation)return;if(code){stop();try{onCode(code);}catch(error){onError(new ScannerError('VALIDATION_REJECTED',error?.message||'Identificador recusado pelo aplicativo.'));}return;}}
     catch(error){if(token!==generation)return;const mapped=cameraError(error);if(mapped.code!==lastInvalid){lastInvalid=mapped.code;onError(mapped);}}
     if(token===generation)timer=schedule(tick);
    }
    timer=schedule(tick);
   }catch(error){if(token!==generation)return;stop();onError(cameraError(error));}
  }
  return {start,stop,isActive:()=>stream!==null};
 }
 function create(options={}){
  const doc=options.document||root.document;if(!doc)fail('NO_DOCUMENT','Leitor visual requer um navegador.');
  let dialog=null,capture=null,generation=0,callbacks={},previousFocus=null,cleanup=null;
  const node=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
  function close(){generation++;capture?.stop();capture=null;const current=dialog;dialog=null;cleanup?.();cleanup=null;if(current){if(current.open)current.close();current.remove();}try{previousFocus?.focus();}catch{}}
  function open({onCode,onError=()=>{}}={}){
   if(typeof onCode!=='function')fail('CALLBACK_REQUIRED','Defina a validação do volume no aplicativo.');close();callbacks={onCode,onError};previousFocus=doc.activeElement;
   const token=generation;dialog=node('dialog');dialog.setAttribute('aria-label','Ler etiqueta de volume');dialog.style.cssText='max-width:min(94vw,560px);max-height:90vh;overflow:auto;padding:20px;border:1px solid #aaa;border-radius:12px;background:white;color:#202030';
   const title=node('h2','Ler etiqueta ou QR'),help=node('p','Leitura identifica o volume. O aplicativo ainda precisa validar a parada e pedir confirmação. Nenhuma baixa é feita aqui.'),status=node('p','Câmera desligada. Abra por sua escolha.'),video=node('video');video.autoplay=false;video.muted=true;video.playsInline=true;video.style.cssText='width:100%;max-height:38vh;background:#111';
   const camera=node('button','Abrir câmera'),swap=node('button','Trocar câmera'),finish=node('button','Fechar leitor'),fileLabel=node('label','Ler imagem de etiqueta (somente neste aparelho)'),file=node('input'),manualLabel=node('label','Entrada manual da chave do volume (não é leitura por câmera)'),manual=node('input'),submit=node('button','Usar chave digitada');
   for(const b of [camera,swap,finish,submit])b.type='button';file.type='file';file.accept='image/png,image/jpeg';manual.type='text';manual.maxLength=264;manual.autocomplete='off';manualLabel.append(manual);fileLabel.append(file);status.setAttribute('role','status');
   let facing='environment',imageGeneration=0;const canvas=node('canvas');
   const error=e=>{if(token!==generation)return;status.textContent=e.message;callbacks.onError(e);};
   const deliver=(code,source)=>{if(token!==generation)return;capture?.stop();status.textContent='Identificador lido. Validando no aplicativo…';
    const accepted=result=>{if(token!==generation)return;if(result===false){error(new ScannerError('VALIDATION_REJECTED','Identificador recusado pelo aplicativo. Confira parada e volume.'));return;}close();};
    const rejected=e=>{if(token!==generation)return;error(e instanceof Error?e:new ScannerError('VALIDATION_REJECTED',String(e)));};
    try{const result=callbacks.onCode({...code,source});if(result&&typeof result.then==='function')result.then(accepted,rejected);else accepted(result);}catch(e){rejected(e);}
   };
   async function frame(source){
    const width=source.videoWidth||source.width||source.naturalWidth,height=source.videoHeight||source.height||source.naturalHeight;if(!width||!height)return null;
    if(width*height>16000000)fail('IMAGE_TOO_LARGE','Imagem acima de16MP. Escolha uma menor.');
    const factor=Math.min(1,960/Math.max(width,height));canvas.width=Math.round(width*factor);canvas.height=Math.round(height*factor);const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)fail('CANVAS_UNAVAILABLE','Não foi possível preparar a leitura da imagem.');ctx.drawImage(source,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    return decodePixels(pixels.data,pixels.width,pixels.height,options.decoder||root.jsQR);
   }
   capture=createCapture({mediaDevices:options.mediaDevices||root.navigator?.mediaDevices,video,readFrame:frame,onCode:code=>deliver(code,'camera'),onError:error});
   camera.onclick=()=>{imageGeneration++;status.textContent='Aguardando câmera e leitura QR…';capture?.start(facing);};swap.onclick=()=>{imageGeneration++;facing=facing==='environment'?'user':'environment';status.textContent='Trocando câmera…';capture?.start(facing);};finish.onclick=close;
   submit.onclick=()=>{imageGeneration++;capture?.stop();try{deliver(parseCode(manual.value),'manual');}catch(e){error(e);}};
   file.onchange=async()=>{const imageToken=++imageGeneration;capture?.stop();const selected=file.files?.[0];if(!selected)return;if(!['image/png','image/jpeg'].includes(selected.type)||selected.size>8*1024*1024){error(new ScannerError('INVALID_FILE','Use imagem JPEG/PNG de até8MB.'));return;}
    let image,url;
    try{if(root.createImageBitmap)image=await root.createImageBitmap(selected);else{url=root.URL.createObjectURL(selected);image=await new Promise((resolve,reject)=>{const i=new root.Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new ScannerError('INVALID_IMAGE','Imagem inválida.'));i.src=url;});}if(token!==generation||imageToken!==imageGeneration)return;const code=await frame(image);if(token!==generation||imageToken!==imageGeneration)return;if(code)deliver(code,'image');else error(new ScannerError('NOT_FOUND','Nenhum QR reconhecido. Confira a imagem ou use entrada manual.'));}
    catch(e){if(imageToken===imageGeneration)error(e instanceof ScannerError?e:new ScannerError('INVALID_IMAGE','Não foi possível ler a imagem.'));}finally{image?.close?.();if(url)root.URL.revokeObjectURL(url);}
   };
   dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(dialog)close();});
   const visibility=()=>{if(doc.hidden)capture?.stop();};doc.addEventListener('visibilitychange',visibility);const pageHide=()=>capture?.stop();root.addEventListener?.('pagehide',pageHide);
   cleanup=()=>{doc.removeEventListener('visibilitychange',visibility);root.removeEventListener?.('pagehide',pageHide);};
   dialog.append(title,help,status,video,camera,swap,fileLabel,manualLabel,submit,finish);doc.body.append(dialog);if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');finish.focus();
   return {close};
  }
  return {open,close,destroy:close};
 }
 return {ScannerError,parseCode,encodeQrMatrix,encodeQrSvg,decodePixels,createCapture,create};
});
