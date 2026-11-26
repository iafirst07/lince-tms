'use strict';
const assert=require('node:assert/strict');
const scanner=require('./scanner.js'),jsQR=require('./vendor/jsQR.js'),qrcode=require('./vendor/qrcode.js');
const tests=[];const test=(name,run)=>tests.push({name,run});
const key='ord-0123456789abcdef:V1';
function pixels(qr,scale=5){const size=(qr.size+8)*scale,data=new Uint8ClampedArray(size*size*4);data.fill(255);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.floor(y/scale)-4,c=Math.floor(x/scale)-4;if(r>=0&&c>=0&&r<qr.size&&c<qr.size&&qr.modules[r][c]){const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=0;}}return {data,width:size,height:size};}
test('safe identifier rules accept exact LINCE1 and raw identity without normalization or URL navigation',()=>{
 assert.deepEqual(scanner.parseCode('LINCE1:'+key),{packageKey:key,format:'LINCE1'});assert.deepEqual(scanner.parseCode(key),{packageKey:key,format:'RAW'});
 for(const bad of ['',null,' https://example.test','https:example','javascript:alert','data:text','LINCE1:https://evil.test','<svg>:x','ord:box\n','ord:box?x=1','ord:%3Cscript%3E','LINCE1:'+ 'A'.repeat(129)+':V1'])assert.throws(()=>scanner.parseCode(bad),scanner.ScannerError);
});
test('real vendored encoder->raster->vendored decoder roundtrip (native BarcodeDetector absent)',()=>{
 for(const value of [key,'order-B:1','a'.repeat(128)+':'+'b'.repeat(128)]){
  const qr=scanner.encodeQrMatrix(value,qrcode),image=pixels(qr),result=scanner.decodePixels(image.data,image.width,image.height,jsQR);assert.equal(result.packageKey,value);assert.equal(result.format,'LINCE1');assert.equal(qr.payload,'LINCE1:'+value);
 }
});
test('SVG is a deterministic numeric-only QR with quiet zone; no identifier HTML injection',()=>{
 const svg=scanner.encodeQrSvg(key,qrcode);assert.equal(svg,scanner.encodeQrSvg(key,qrcode));assert.match(svg,/viewBox="0 0 \d+ \d+"/);assert.equal(svg.includes(key),false);assert.equal(svg.includes('<script'),false);assert.equal(svg.includes('http://www.w3.org/2000/svg'),true);assert.throws(()=>scanner.encodeQrSvg('javascript:alert',qrcode),scanner.ScannerError);
});
test('invalid pixels, absent decoder and blank image fail explicitly or return no match',()=>{
 assert.throws(()=>scanner.decodePixels(new Uint8Array(4),2,2,jsQR),/Pixels/);assert.throws(()=>scanner.decodePixels(new Uint8ClampedArray(4),1,1,null),/indisponível/);
 const data=new Uint8ClampedArray(100*100*4);data.fill(255);assert.equal(scanner.decodePixels(data,100,100,jsQR),null);
});
function harness(overrides={}){
 let stops=0,calls=0,paused=0;const scheduled=new Map(),stream={getTracks:()=>[{stop(){stops++;}}]},video={srcObject:null,play:async()=>{},pause(){paused++;}},codes=[],errors=[];
 let index=0;const capture=scanner.createCapture({mediaDevices:{getUserMedia:async options=>{calls++;assert.equal(options.audio,false);return stream;}},video,readFrame:async()=>null,onCode:code=>codes.push(code),onError:e=>errors.push(e.code),schedule:fn=>{scheduled.set(++index,fn);return index;},cancel:id=>scheduled.delete(id),...overrides});
 return {capture,stream,video,codes,errors,scheduled,get stops(){return stops;},get calls(){return calls;},get paused(){return paused;}};
}
test('camera starts only on explicit controller start; stop closes all tracks, pending loop and video',async()=>{
 const h=harness();assert.equal(h.calls,0);await h.capture.start();assert.equal(h.calls,1);assert.equal(h.capture.isActive(),true);assert.equal(h.video.srcObject,h.stream);h.capture.stop();assert.equal(h.stops,1);assert.equal(h.video.srcObject,null);assert.equal(h.scheduled.size,0);h.capture.stop();assert.equal(h.stops,1);
});
test('switching camera stops old tracks before opening replacement',async()=>{
 const h=harness();await h.capture.start('environment');await h.capture.start('user');assert.equal(h.calls,2);assert.equal(h.stops,1);h.capture.stop();assert.equal(h.stops,2);
});
test('camera denied/unavailable/cancelled are distinct, no unexpected callback or live stream',async()=>{
 for(const [name,code]of [['NotAllowedError','CAMERA_DENIED'],['NotFoundError','CAMERA_UNAVAILABLE'],['AbortError','CAMERA_CANCELLED'],['NotReadableError','CAMERA_BUSY']]){
  const h=harness({mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error('mock'),{name});}}});await h.capture.start();assert.deepEqual(h.errors,[code]);assert.equal(h.codes.length,0);assert.equal(h.capture.isActive(),false);
 }
 const h=harness({mediaDevices:{}});await h.capture.start();assert.deepEqual(h.errors,['CAMERA_UNAVAILABLE']);
});
test('close while permission is pending stops late acquired tracks, with no camera restart',async()=>{
 let release,stops=0;const h=harness({mediaDevices:{getUserMedia:()=>new Promise(resolve=>{release=resolve;})}}),pending=h.capture.start();h.capture.stop();release({getTracks:()=>[{stop(){stops++;}}]});await pending;assert.equal(stops,1);assert.equal(h.capture.isActive(),false);assert.equal(h.scheduled.size,0);assert.equal(h.codes.length,0);
});
test('decoded frame closes camera before callback and does not issue an operation',async()=>{
 const h=harness({readFrame:async()=>scanner.parseCode('LINCE1:'+key)});await h.capture.start();const tick=[...h.scheduled.values()][0];await tick();assert.equal(h.codes[0].packageKey,key);assert.equal(h.stops,1);assert.equal(h.video.srcObject,null);assert.equal(h.capture.isActive(),false);
});
test('late decoded frame after close is ignored, preserving cancel semantics',async()=>{
 let done;const h=harness({readFrame:()=>new Promise(resolve=>{done=resolve;})});await h.capture.start();const tick=[...h.scheduled.values()][0],pending=tick();h.capture.stop();done(scanner.parseCode(key));await pending;assert.equal(h.codes.length,0);assert.equal(h.stops,1);
});
function fakeDocument(){
 const all=[],listeners=new Map(),doc={hidden:false,activeElement:{focus(){}},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}};
 function createElement(tag){const events=new Map(),node={tagName:tag,style:{},children:[],textContent:'',value:'',open:false,setAttribute(k,v){this[k]=v;},append(...items){this.children.push(...items);for(const i of items)if(i&&typeof i==='object')i.parent=this;},addEventListener(n,f){events.set(n,f);},showModal(){this.open=true;},close(){this.open=false;events.get('close')?.();},remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);},focus(){doc.activeElement=this;},pause(){},play:async()=>{},dispatch(n,e){events.get(n)?.(e);}};all.push(node);return node;}
 doc.createElement=createElement;doc.body=createElement('body');return {doc,all,listeners};
}
test('dialog open does not ask for camera; manual identified callback closes dialog and cleans listeners',()=>{
 const {doc,all,listeners}=fakeDocument();let cameras=0,result;const ui=scanner.create({document:doc,mediaDevices:{getUserMedia:async()=>{cameras++;throw new Error('must not call');}}});
 ui.open({onCode:value=>{result=value;}});assert.equal(cameras,0);assert.equal(doc.body.children.length,1);const manual=all.find(x=>x.tagName==='input'&&x.type==='text');manual.value='LINCE1:'+key;all.find(x=>x.textContent==='Usar chave digitada').onclick();
 assert.deepEqual(result,{packageKey:key,format:'LINCE1',source:'manual'});assert.equal(doc.body.children.length,0);assert.equal(listeners.size,0);ui.destroy();
});
test('dialog cancellation closes current reader and blocks callbacks; invalid manual URL stays unselected',()=>{
 const {doc,all}=fakeDocument();let delivered=0,error;const ui=scanner.create({document:doc});ui.open({onCode:()=>delivered++,onError:e=>{error=e.code;}});
 all.find(x=>x.tagName==='input'&&x.type==='text').value='https://example.test';all.find(x=>x.textContent==='Usar chave digitada').onclick();assert.equal(error,'INVALID_CODE');assert.equal(delivered,0);
 let prevented=false;all.find(x=>x.tagName==='dialog').dispatch('cancel',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(doc.body.children.length,0);assert.equal(delivered,0);
});
test('application callback rejection stays open for correction without false success or camera restart',()=>{
 const {doc,all}=fakeDocument();let rejected=0,calls=0;const ui=scanner.create({document:doc});ui.open({onCode(){if(++calls===1)throw new Error('Parada errada ou volume repetido');},onError(e){assert.match(e.message,/Parada errada/);rejected++;}});
 const manual=all.find(x=>x.tagName==='input'&&x.type==='text'),submit=all.find(x=>x.textContent==='Usar chave digitada');manual.value=key;submit.onclick();assert.equal(rejected,1);assert.equal(doc.body.children.length,1);submit.onclick();assert.equal(calls,2);assert.equal(doc.body.children.length,0);
});
test('async callback failure also remains correctable; asynchronous success closes only current reader',async()=>{
 const {doc,all}=fakeDocument();let errors=0;const ui=scanner.create({document:doc});ui.open({onCode:async()=>{throw new Error('Wrong stop');},onError:()=>errors++});all.find(x=>x.tagName==='input'&&x.type==='text').value=key;all.find(x=>x.textContent==='Usar chave digitada').onclick();await Promise.resolve();await Promise.resolve();assert.equal(errors,1);assert.equal(doc.body.children.length,1);ui.close();
});
(async()=>{const results=[];for(const t of tests){try{await t.run();results.push({name:t.name,pass:true});}catch(e){results.push({name:t.name,pass:false,error:e.stack});}}console.log(JSON.stringify({scope:'Pure QR roundtrip and mocked camera lifecycle; no browser/device/permissions or operations',passed:results.filter(x=>x.pass).length,total:results.length,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;})();
