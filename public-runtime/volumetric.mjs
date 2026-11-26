/* Exact rational arithmetic for an explicitly fictional optional tariff policy. */
export const POLICY='VOLUMETRIC_MAX_TOTAL_KG_V1';
const fields=['id','dimensionUnit','divisorCm3PerKg','rounding','aggregation','minimumBillableKg'];
function ensure(value){if(!value)throw new Error('INVALID_VOLUMETRIC_POLICY');}
const rational=s=>{ensure(typeof s==='string'&&/^\d+(\.\d{1,18})?$/.test(s));const[a,b='']=s.split('.');return [BigInt(a+b),10n**BigInt(b.length)];};
const add=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]],mul=(a,b)=>[a[0]*b[0],a[1]*b[1]],div=(a,b)=>[a[0]*b[1],a[1]*b[0]];
const gcd=(a,b)=>b?gcd(b,a%b):a;
const reduce=a=>{const g=gcd(a[0],a[1]);return [a[0]/g,a[1]/g];};
const fixed=(n,places)=>{const unit=10n**BigInt(places);return `${n/unit}.${String(n%unit).padStart(places,'0')}`;};
const ceilMilli=a=>(a[0]*1000n+a[1]-1n)/a[1];
export function validatePolicy(p){ensure(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===fields.length&&fields.every(k=>Object.hasOwn(p,k)));ensure(p.id===POLICY&&p.dimensionUnit==='CM'&&p.rounding==='CEILING_0_001_KG'&&p.aggregation==='MAX_OF_TOTAL_REAL_AND_TOTAL_VOLUMETRIC'&&p.minimumBillableKg==='0.000');ensure(typeof p.divisorCm3PerKg==='string'&&/^\d{1,10}(\.\d{1,6})?$/.test(p.divisorCm3PerKg)&&rational(p.divisorCm3PerKg)[0]>0n);return p;}
export function compareDecimal(a,b){const x=rational(String(a)),y=rational(String(b)),left=x[0]*y[1],right=y[0]*x[1];return left<right?-1:left>right?1:0;}
export function validateExactRate(rate){
 validatePolicy(rate.volumetricPolicy);
 const decimal=value=>{if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,6})?$/.test(value))throw new Error('INVALID_VOLUMETRIC_RATE');return value;};
 for(const name of ['minKg','maxKg','base','perKg'])decimal(rate[name]);
 if(compareDecimal(rate.minKg,rate.maxKg)>=0||!Number.isSafeInteger(rate.priority))throw new Error('INVALID_VOLUMETRIC_RATE');
 const additions=rate.additions??[];if(!Array.isArray(additions))throw new Error('INVALID_VOLUMETRIC_RATE');
 for(const addition of additions){if(!addition||typeof addition.name!=='string'||!addition.name.trim()||!['FIXED','PERCENT'].includes(addition.type))throw new Error('INVALID_VOLUMETRIC_RATE');decimal(addition.value);}
 return structuredClone(rate);
}
export function overlapWeightBands(a,b){return compareDecimal(a.minKg,b.maxKg)<0&&compareDecimal(b.minKg,a.maxKg)<0;}
export function calculation(packs,p){validatePolicy(p);let real=[0n,1n],volume=[0n,1n];for(const x of packs){real=add(real,rational(x.weightKg));volume=add(volume,mul(mul(rational(x.lengthCm),rational(x.widthCm)),rational(x.heightCm)));}const cubed=reduce(div(volume,rational(p.divisorCm3PerKg))),chosen=real[0]*cubed[1]>=cubed[0]*real[1]?real:cubed;
 const exact=a=>fixed(a[0]*10n**18n/a[1],18).replace(/0+$/,'').replace(/\.$/,'');return {realKg:exact(real),volumeCm3:exact(volume),divisorCm3PerKg:p.divisorCm3PerKg,volumetricKgRaw:{numerator:String(cubed[0]),denominator:String(cubed[1])},volumetricKg:fixed(ceilMilli(cubed),3),billableKg:fixed(ceilMilli(chosen),3),policySnapshot:structuredClone(p)};}
export function inBand(calc,min,max){const weight=rational(calc.billableKg),lo=rational(min),hi=rational(max);return weight[0]*lo[1]>=lo[0]*weight[1]&&weight[0]*hi[1]<hi[0]*weight[1];}
export function priceLines(rate,calc){const base=rational(rate.base),weight=mul(rational(rate.perKg),rational(calc.billableKg)),raw=add(base,weight);const cash=a=>fixed((a[0]*200n/a[1]+1n)/2n,2);const lines=[{name:'BASE',amount:cash(base)},{name:'WEIGHT',amount:cash(weight)}];for(const a of rate.additions||[])lines.push({name:a.name,amount:cash(a.type==='FIXED'?rational(a.value):div(mul(raw,rational(a.value)),[100n,1n]))});return lines;}
export function totalLines(lines){const total=lines.reduce((n,x)=>n+BigInt(x.amount.replace('.','')),0n);return fixed(total,2);}
