"""Local DEMO commercial parent. Allocation is a declared design, not a tax rule."""
import re
from decimal import Decimal
from core import action, require, ident

POLICY = 'COST_PROPORTIONAL_CENTS_V1'


def money_cents(value):
    require(isinstance(value,str) and bool(re.fullmatch(r'\d{1,10}(\.\d{1,2})?',value)), 'INVALID_CHECKOUT_MONEY')
    return int(Decimal(value)*100)


def money(cents):
    return format(Decimal(cents)/100,'.2f')


def allocate_charge(cents, weights):
    require(type(cents) is int and cents>=0 and isinstance(weights,list) and bool(weights) and all(type(w) is int and w>=0 for w in weights),'INVALID_ALLOCATION')
    weights=weights if sum(weights) else [1]*len(weights)
    total=sum(weights);parts=[cents*w//total for w in weights]
    order=sorted(range(len(weights)),key=lambda i:(-(cents*weights[i]%total),i))
    for i in order[:cents-sum(parts)]:parts[i]+=1
    return parts


class Commerce:
    @action('admin','planner')
    def cmd_checkout_create(self,db,p,d):
        external=ident(d.get('externalId'));charge=money_cents(d.get('consumerCharge'))
        require(not any(x['org']==p['org'] and x['externalId']==external for x in self.all(db,'checkout')),'DUPLICATE_CHECKOUT',409)
        children=d.get('children');require(isinstance(children,list) and 2<=len(children)<=20,'INVALID_CHECKOUT_CHILDREN')
        prepared=[];seen=set();destination=None
        for child in children:
            require(isinstance(child,dict) and 'consumerCharge' not in child,'CHILD_CHARGE_FORBIDDEN')
            value=self.order_values(db,p,{**child,'consumerCharge':'0.00'})
            require(value['externalId'] not in seen,'DUPLICATE_CHECKOUT_CHILD');seen.add(value['externalId'])
            if destination is None:destination=value['locationId']
            require(value['locationId']==destination,'CHECKOUT_DESTINATION_MISMATCH')
            prepared.append(value)
        costs=[money_cents(v['candidate']['cost']) for v in prepared];allocated=allocate_charge(charge,costs)
        parent=self.add(db,p,'checkout',{'externalId':external,'consumerCharge':money(charge),'logisticCost':money(sum(costs)),
            'allocationPolicy':POLICY,'zeroCostPolicy':'EQUAL_BY_ORIGINAL_INDEX','status':'VALIDATED','orderIds':[],
            'allocations':[{'index':i,'externalId':v['externalId'],'cost':money(costs[i]),'consumerCharge':money(allocated[i]),'quoteId':v['quoteId'],'snapshotHash':v['snapshotHash']} for i,v in enumerate(prepared)],'simulation':True})
        for i,value in enumerate(prepared):
            value.update(checkoutId=parent['id'],consumerCharge=money(allocated[i]),subsidy=money(costs[i]-allocated[i]),consumerChargeRole='ALLOCATED_NOT_ADDITIONAL')
            parent['orderIds'].append(self.add(db,p,'order',value)['id'])
        return self.save(db,parent)

    @action('admin','planner')
    def cmd_checkout_cancel(self,db,p,d):
        parent=self.get(db,p,d.get('id'),'checkout',True);self.version(parent,d)
        require(parent['status']=='VALIDATED','CHECKOUT_CANCEL_BLOCKED',409)
        children=[self.get(db,p,oid,'order',True) for oid in parent['orderIds']]
        require(all(o.get('checkoutId')==parent['id'] and o['status']=='VALIDATED' and not o['shipmentIds'] for o in children),'CHECKOUT_CANCEL_BLOCKED',409)
        for child in children:child.update(status='CANCELLED');self.save(db,child)
        parent.update(status='CANCELLED');return self.save(db,parent)
