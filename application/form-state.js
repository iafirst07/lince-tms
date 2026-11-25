(function(root){
  'use strict';
  const owns=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
  function at(object,path){let value=object;for(const part of path.split('.')){if(!owns(value,part))return undefined;value=value[part];}return value;}
  function initial(field,key,draft={},record=null){
    let value;
    if(owns(draft,key))value=draft[key];
    else if(record){value=at(record,key.startsWith('values.')?key.slice(7):key);}
    if(value===undefined)value=field.type==='choices'||field.type==='multi'?(field.values||[]):field.value;
    if(field.type==='lines'&&Array.isArray(value))return value.join('\n');
    if(field.type==='datetime-local'&&value&&Number.isFinite(Date.parse(value))){const d=new Date(value);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}
    return value;
  }
  function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
  function candidateIndex(candidates,snapshot){const target=JSON.stringify(stable(snapshot));const matches=candidates.map((c,i)=>JSON.stringify(stable(c))===target?i:-1).filter(i=>i>=0);return matches.length===1?matches[0]:-1;}
  function switchRecord(name,id){return {[name]:id};}
  function snapshot(form){const data={};for(const input of form.querySelectorAll('input,select,textarea')){if(!input.name||input.type==='file')continue;if(input.dataset.array){data[input.name]||=[];if(input.checked)data[input.name].push(input.dataset.integer==='true'?Number(input.value):input.value);}else data[input.name]=input.type==='checkbox'?input.checked:input.value;}return data;}
  const api={initial,switchRecord,snapshot,candidateIndex};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LinceFormState=api;
})(typeof window!=='undefined'?window:globalThis);
