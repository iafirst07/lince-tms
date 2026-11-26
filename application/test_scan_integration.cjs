'use strict';
const assert=require('node:assert/strict');
const {validateScannedPackage}=require('./driver.js');
const trip={id:'s',status:'IN_TRANSIT',stage:'DELIVERY',planVersion:1,assignmentId:'a',delivered:[],packages:[{key:'o1:V1',orderId:'o1',id:'V1'},{key:'o2:V1',orderId:'o2',id:'V1'}],stops:[{orderId:'o1'},{orderId:'o2'}]};
const scope={tripId:'s',type:'DELIVERY',planVersion:1,assignmentId:'a',orderId:'o1'};
const checks=[];function test(name,fn){fn();checks.push(name);}
test('correct exact volume selected, no shipment mutation',()=>{const old=JSON.stringify(trip);assert.equal(validateScannedPackage(trip,scope,'o1:V1'),'o1:V1');assert.equal(JSON.stringify(trip),old);});
test('same label V1 other order refused',()=>assert.throws(()=>validateScannedPackage(trip,scope,'o2:V1')));
test('unknown volume refused',()=>assert.throws(()=>validateScannedPackage(trip,scope,'other:V1')));
test('pending proof volume refused',()=>assert.throws(()=>validateScannedPackage(trip,scope,'o1:V1',['o1:V1'])));
test('delivered volume refused',()=>assert.throws(()=>validateScannedPackage({...trip,delivered:['o1:V1']},scope,'o1:V1')));
test('changed assignment/version/trip refused',()=>{for(const d of [{assignmentId:'b'},{planVersion:2},{tripId:'other'}])assert.throws(()=>validateScannedPackage(trip,{...scope,...d},'o1:V1'));});
test('wrong stage or no selected stop refused',()=>{assert.throws(()=>validateScannedPackage({...trip,stage:'HUB'},scope,'o1:V1'));assert.throws(()=>validateScannedPackage(trip,{...scope,orderId:null},'o1:V1'));});
const pickup={...trip,status:'ASSIGNED',pickupStops:[{stopId:'p1',type:'PICKUP',orderId:'o1',packageKeys:['o1:V1']},{stopId:'p2',type:'PICKUP',orderId:'o2',packageKeys:['o2:V1']}],pickupReceipts:[]},ps={...scope,type:'PICKUP',stopId:'p1'};
test('pickup explicit identity no automatic receipt',()=>{assert.equal(validateScannedPackage(pickup,ps,'o1:V1'),'o1:V1');assert.equal(pickup.pickupReceipts.length,0);assert.throws(()=>validateScannedPackage(pickup,ps,'o2:V1'));});
test('confirmed or started pickup refused',()=>{assert.throws(()=>validateScannedPackage({...pickup,pickupReceipts:[{stopId:'p1',status:'CONFIRMED',planVersion:1,assignmentId:'a'}]},ps,'o1:V1'));assert.throws(()=>validateScannedPackage({...pickup,status:'IN_TRANSIT'},ps,'o1:V1'));});
console.log(JSON.stringify({scope:'Scanner identity integration only; no device or browser claim',pass:checks.length,total:checks.length,checks},null,2));
