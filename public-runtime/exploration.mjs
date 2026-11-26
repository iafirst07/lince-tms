/** Opt-in fictional exploration for NEW workspaces. Existing state is never reset. */
export const EXPLORATION_VERSION='LINCE_EXPLORATION_1';
export function createExploration({executeCommand,choosePersona}){
  return function enrichExploration(workspace,{enabled=false}={}){
    if(!enabled)return workspace;
    if(workspace.exploration){if(workspace.exploration.version!==EXPLORATION_VERSION)throw Error('EXPLORATION_VERSION_CONFLICT');return workspace;}
    if(Object.keys(workspace.idempotency||{}).length)throw Error('EXPLORATION_REQUIRES_NEW_WORKSPACE');
    let w=structuredClone(workspace),sequence=0;const now=w.clock,at=hours=>new Date(Date.parse(now)+hours*3600000).toISOString();
    const run=(actor,command,payload)=>{const result=executeCommand(w,choosePersona(w,actor),command,payload,`exploration-v1-${++sequence}`,now);w=result.workspace;return result.result;};
    const object=id=>w.objects.find(x=>x.id===id),version=id=>({id,version:object(id).version});
    const shipper=choosePersona(w,'loja.admin'),carrier=choosePersona(w,'carrier1.admin'),driver=choosePersona(w,'lince.coleta');
    const locations=w.objects.filter(x=>x.kind==='location'&&x.org===shipper.org&&Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon)));
    if(locations.length<2)throw Error('EXPLORATION_LOCATIONS_REQUIRED');const origin=locations[0],destination=locations.find(x=>x.postalCode!==origin.postalCode)||locations[1];
    const parcel=[{id:'V1',weightKg:'2',lengthCm:'20',widthCm:'10',heightCm:'10'}];
    const quote=(originCep)=>run('loja.admin','quote',{originCep,destinationCep:destination.postalCode,packages:parcel});
    const candidate=q=>{const i=q.candidates.findIndex(c=>c.carrierOrg===carrier.org);if(i<0)throw Error('EXPLORATION_CARRIER_QUOTE_REQUIRED');return i;};
    const child=(reference,q)=>({externalId:reference,quoteId:q.id,candidate:candidate(q),packages:q.packages,locationId:destination.id,windowStart:at(1),windowEnd:at(8)});
    const q1=quote(origin.postalCode),q2=quote(origin.postalCode==='02002000'?'01001000':'02002000');
    const checkout=run('loja.admin','checkout_create',{externalId:'EXPLORAR-FRETE-UNICO',consumerCharge:'5.40',children:[child('EXPLORAR-ORIGEM-A',q1),child('EXPLORAR-ORIGEM-B',q2)]});
    const orders=[1,2].map(i=>run('loja.admin','order_create',{...child(`EXPLORAR-COLETA-${i}`,q1),consumerCharge:'0.00'}));
    for(const o of orders)run('loja.admin','order_release',version(o.id));
    const plan=run('loja.admin','plan',{orderIds:orders.map(o=>o.id),originLocationId:origin.id,start:at(1),capacityKg:'100',speedKmh:'40',perStopPickup:true});
    if(plan.status!=='FEASIBLE')throw Error('EXPLORATION_PLAN_INFEASIBLE');
    const shipment=run('loja.admin','plan_commit',version(plan.id));
    const vehicle=run('carrier1.admin','fleet_create',{type:'VEHICLE',name:'Van fictícia — exploração coleta',capacityKg:'100',cargoClasses:['GENERAL']}),resource=run('carrier1.admin','fleet_create',{type:'DRIVER',name:'Motorista coleta — exploração',userId:driver.id,licenseValidTo:at(24*90)});
    const tender=run('loja.admin','tender',{shipmentId:shipment.id,version:object(shipment.id).version,carriers:[carrier.org],expiresAt:at(4)});
    run('carrier1.admin','offer_respond',{...version(tender.id),decision:'ACCEPT',vehicleId:vehicle.id,driverId:resource.id});
    const label=run('loja.admin','label_request',{shipmentId:shipment.id,version:object(shipment.id).version,mode:'GOOD'});
    run('loja.admin','outbox_process',version(label.id));
    const policy=run('loja.admin','fiscal_policy',{name:'Exploração local sem emissão',scenario:'EXPLORATION_FICTITIOUS',requirements:[],mode:'DEMO_ONLY'});
    run('loja.admin','fiscal_evaluate',{shipmentId:shipment.id,version:object(shipment.id).version,policyId:policy.id,scenario:'EXPLORATION_FICTITIOUS'});
    const s=object(shipment.id),first=s.pickupStops[0];
    run('lince.coleta','pickup_confirm',{shipmentId:s.id,version:s.version,planVersion:s.planVersion,assignmentId:s.assignmentId,stopId:first.stopId,packageKeys:first.packageKeys,eventId:'EXPLORATION-PICKUP-1'});
    const returnParent=w.objects.find(s=>s.kind==='shipment'&&s.org===shipper.org&&s.driverUserId&&s.status==='DELIVERED'&&s.delivered?.length&&!w.objects.some(r=>r.kind==='return'&&r.shipmentId===s.id));
    if(!returnParent)throw Error('EXPLORATION_RETURN_PARENT_REQUIRED');
    const pack=returnParent.packages.find(p=>returnParent.delivered.includes(p.key));
    const returned=run('loja.admin','return_create',{shipmentId:returnParent.id,packageKeys:[pack.key],reason:'Devolução fictícia para explorar tarefa de coleta'});
    const task=run('loja.admin','return_assign',{...version(returned.id),destinationLocationId:origin.id,windowStart:at(1),windowEnd:at(8),reason:'Destino fictício explícito para exploração'});
    const dock=run('loja.admin','dock_create',{locationId:origin.id,name:'Doca fictícia explorável',capacity:2,timezone:'America/Sao_Paulo'});
    const reservation=run('loja.admin','dock_reserve',{dockId:dock.id,reference:'EXPLORAR-DOCA',start:at(1),end:at(2),units:1,shipmentId:shipment.id});
    w.exploration={version:EXPLORATION_VERSION,createdAt:now,classification:'FICTITIOUS_ONLY',realOperationAllowed:false,
      ids:{checkoutId:checkout.id,childOrderIds:checkout.orderIds,pickupShipmentId:shipment.id,pickupOrderIds:orders.map(o=>o.id),returnId:task.id,returnTaskId:task.taskId,returnParentShipmentId:returnParent.id,dockId:dock.id,reservationId:reservation.id},
      routes:[{id:'EXP-PICKUP',actor:'lince.coleta',actorId:driver.id,objectId:shipment.id,link:'/driver/',expected:'Dois pedidos de coleta explícitos; primeiro recibo confirmado, segundo pendente. Confirmar segundo e então passagem PICKUP, sem marcar entrega.'},
        {id:'EXP-RETURN',actor:w.users.find(u=>u.id===task.driverUserId)?.username,actorId:task.driverUserId,objectId:task.id,link:'/driver/',expected:'Tarefa reversa atribuída com origem/destino e volume entregue de referência; coleta não altera entrega original.'},
        {id:'EXP-CHECKOUT',actor:'loja.admin',objectId:checkout.id,link:'/',expected:'Duas origens, destino comum e cobrança única5.40; parcelas somam5.40 e custos logísticos separados.'},
        {id:'EXP-DOCK',actor:'loja.admin',objectId:reservation.id,link:'/',expected:'Capacidade2, reserva1; reservar última unidade, recusar terceira, remarcar/cancelar e acompanhar histórico.'}],
      limits:['Public personas, not enterprise authentication','No physical pickup, return, fiscal document, payment, sensor or provider operation','Relative links require current workspace context; physical-device proof pending']};
    return w;
  };
}
