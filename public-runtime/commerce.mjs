/* Fictional local policy, not a corporate checkout or payment service. */
export const POLICY='COST_PROPORTIONAL_CENTS_V1';
export function allocateCharge(cents,weights){
  if(!Number.isSafeInteger(cents)||cents<0||!Array.isArray(weights)||!weights.length||!weights.every(w=>Number.isSafeInteger(w)&&w>=0))throw new Error('INVALID_ALLOCATION');
  const ws=weights.some(w=>w>0)?weights.map(BigInt):weights.map(()=>1n),total=ws.reduce((a,b)=>a+b,0n),charge=BigInt(cents),parts=ws.map(w=>charge*w/total);
  const order=ws.map((w,i)=>({i,r:charge*w%total})).sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1);
  let remaining=Number(charge-parts.reduce((a,b)=>a+b,0n));for(let n=0;n<remaining;n++)parts[order[n].i]++;
  return parts.map(Number);
}
export function createCheckoutHandlers(api){
  const {get,list,add,orderValues,check,text,copy}=api;
  const cents=v=>{check(typeof v==='string'&&/^\d{1,10}(\.\d{1,2})?$/.test(v),'INVALID_CHECKOUT_MONEY');const [a,b='']=v.split('.');return Number(BigInt(a)*100n+BigInt((b+'00').slice(0,2)));};
  const money=n=>`${n<0?'-':''}${Math.floor(Math.abs(n)/100)}.${String(Math.abs(n)%100).padStart(2,'0')}`;
  const own=(w,p,id,kind)=>{const o=get(w,id,kind);check(o.org===p.org,'OWNER_REQUIRED',403);return o;};
  return {
    checkout_create(w,p,d){
      const externalId=text(d.externalId),charge=cents(d.consumerCharge);check(!list(w,'checkout').some(x=>x.org===p.org&&x.externalId===externalId),'DUPLICATE_CHECKOUT',409);
      check(Array.isArray(d.children)&&d.children.length>=2&&d.children.length<=20,'INVALID_CHECKOUT_CHILDREN');
      const seen=new Set();let destination;const prepared=d.children.map(child=>{
        check(child&&typeof child==='object'&&!Array.isArray(child)&&!Object.hasOwn(child,'consumerCharge'),'CHILD_CHARGE_FORBIDDEN');
        own(w,p,child.quoteId,'quote');own(w,p,child.locationId,'location');const externalId=text(child.externalId);
        check(!seen.has(externalId)&&!list(w,'order').some(o=>o.org===p.org&&o.externalId===externalId&&o.status!=='CANCELLED'),'DUPLICATE_CHECKOUT_CHILD',409);seen.add(externalId);
        const value=orderValues(w,p,{...child,consumerCharge:'0.00'});destination??=value.locationId;check(destination===value.locationId,'CHECKOUT_DESTINATION_MISMATCH');
        return {...value,externalId,status:'VALIDATED',shipmentIds:[],revisions:[],contentVersion:1};
      });
      const costs=prepared.map(v=>cents(v.candidate.cost)),allocated=allocateCharge(charge,costs),staged=copy(w);
      const parent=add(staged,p,'checkout',{externalId,consumerCharge:money(charge),logisticCost:money(costs.reduce((a,b)=>a+b,0)),allocationPolicy:POLICY,zeroCostPolicy:'EQUAL_BY_ORIGINAL_INDEX',status:'VALIDATED',orderIds:[],simulation:true,
        allocations:prepared.map((v,i)=>({index:i,externalId:v.externalId,cost:money(costs[i]),consumerCharge:money(allocated[i]),quoteId:v.quoteId,quoteContentSignature:v.quoteContentSignature}))});
      prepared.forEach((v,i)=>parent.orderIds.push(add(staged,p,'order',{...v,checkoutId:parent.id,consumerCharge:money(allocated[i]),subsidy:money(costs[i]-allocated[i]),consumerChargeRole:'ALLOCATED_NOT_ADDITIONAL'}).id));
      parent.version++;w.objects=staged.objects;return parent;
    },
    checkout_cancel(w,p,d){
      const parent=own(w,p,d.id,'checkout');check(d.version===parent.version,'VERSION_CONFLICT',409);check(parent.status==='VALIDATED','CHECKOUT_CANCEL_BLOCKED',409);
      const children=parent.orderIds.map(id=>own(w,p,id,'order'));check(children.every(o=>o.checkoutId===parent.id&&o.status==='VALIDATED'&&Array.isArray(o.shipmentIds)&&!o.shipmentIds.length),'CHECKOUT_CANCEL_BLOCKED',409);
      children.forEach(o=>{o.status='CANCELLED';o.version++;});parent.status='CANCELLED';parent.version++;return parent;
    }
  };
}
