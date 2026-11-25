from decimal import Decimal,ROUND_FLOOR
from core import action,require,ident,dec,cash

def allocate(total,weights):
    require(weights and all(w>0 for w in weights.values()),'INVALID_ALLOCATION')
    require(total>=0 and total==Decimal(cash(total)),'INVALID_ALLOCATION_TOTAL')
    exact={k:total*100*w/sum(weights.values()) for k,w in weights.items()}
    cents={k:int(v.to_integral_value(rounding=ROUND_FLOOR)) for k,v in exact.items()}
    remainder=int(total*100)-sum(cents.values())
    for k in sorted(weights,key=lambda k:(-(exact[k]-cents[k]),k))[:remainder]:cents[k]+=1
    return {k:cash(Decimal(v)/100) for k,v in cents.items()}

class Finance:
    @action('admin','auditor')
    def cmd_settlement_request(self,db,p,d):
        entry=self.get(db,p,d.get('entryId'),'ledger',True);require(entry['side']=='AP' and entry['type']=='POST','INVALID_SETTLEMENT')
        invoice=self.get(db,p,entry['invoiceId'],'invoice',True);require(invoice['status']=='POSTED_LOCAL','INVOICE_NOT_OPEN')
        require(not any(a.get('originalEntryId')==entry['id'] and a['type']=='REVERSE' and a['status']=='PENDING' for a in self.all(db,'approval')),'REVERSAL_PENDING',409)
        amount=dec(d.get('amount'));require(amount>0,'POSITIVE_AMOUNT_REQUIRED')
        committed=sum(Decimal(s['amount']) for s in self.all(db,'settlement') if s['entryId']==entry['id'])+sum(Decimal(a['amount']) for a in self.all(db,'approval') if a.get('originalEntryId')==entry['id'] and a['type']=='SETTLEMENT' and a['status']=='PENDING')
        require(committed+amount<=Decimal(entry['amount']),'SETTLEMENT_EXCEEDS_BALANCE',409)
        return self.add(db,p,'approval',{'type':'SETTLEMENT','originalEntryId':entry['id'],'invoiceId':invoice['id'],'issuerOrg':invoice['issuerOrg'],'amount':cash(amount),'reason':ident(d.get('reason')),'requestedBy':p['id'],'status':'PENDING'})
    @action('admin','auditor')
    def cmd_settlement_reverse_request(self,db,p,d):
        settled=self.get(db,p,d.get('settlementId'),'settlement',True);require(settled['side']=='AP' and Decimal(settled['amount'])>0,'INVALID_SETTLEMENT_REVERSAL')
        require(not any(a.get('originalSettlementId')==settled['id'] and a['status'] in ['PENDING','APPROVED'] for a in self.all(db,'approval')),'SETTLEMENT_REVERSAL_EXISTS',409)
        invoice=self.get(db,p,settled['invoiceId'],'invoice',True)
        return self.add(db,p,'approval',{'type':'SETTLEMENT_REVERSE','originalSettlementId':settled['id'],'sourceApprovalId':settled['approvalId'],'invoiceId':invoice['id'],'issuerOrg':invoice['issuerOrg'],'amount':settled['amount'],'reason':ident(d.get('reason')),'requestedBy':p['id'],'status':'PENDING'})
    @action('admin','auditor')
    def cmd_tolerance(self,db,p,d):return self.add(db,p,'tolerance',{'name':ident(d.get('name')),'fixed':cash(dec(d.get('fixed'))),'percent':str(dec(d.get('percent'))),'status':'PUBLISHED_IMMUTABLE'})
    @action('admin','operator')
    def cmd_invoice_create(self,db,p,d):
        refs=d.get('assignments');require(isinstance(refs,list) and refs and len(refs)==len(set(refs)),'INVALID_ASSIGNMENTS');assignments=[self.get(db,p,x,'assignment') for x in refs];require(all(a['carrierOrg']==p['org'] for a in assignments),'CARRIER_SCOPE',403)
        owner=assignments[0]['org'];require(all(a['org']==owner for a in assignments),'MIXED_CUSTOMERS')
        ships=[self.get(db,p,a['shipmentId'],'shipment') for a in assignments];require(all(s['status']=='DELIVERED' for s in ships),'DELIVERY_REQUIRED')
        number=ident(d.get('number'));require(not any(x['issuerOrg']==p['org'] and (x['number']==number or set(x['assignmentIds'])&set(refs)) for x in self.all(db,'invoice')),'INVOICE_DUPLICATE',409)
        return self.add(db,{'id':p['id'],'org':owner},'invoice',{'issuerOrg':p['org'],'assignmentIds':refs,'assignmentVersions':{a['id']:a['version'] for a in assignments},'number':number,'amount':cash(dec(d.get('amount'))),'currency':'BRL','status':'RECEIVED','payment':'NOT_EXECUTED'},[p['org']])
    @action('admin','auditor')
    def cmd_invoice_audit(self,db,p,d):
        i=self.get(db,p,d.get('id'),'invoice',True);self.version(i,d);require(i['status']=='RECEIVED','INVALID_STATE');tol=self.get(db,p,d.get('toleranceId'),'tolerance',True);assignments=[self.get(db,p,x,'assignment',True) for x in i['assignmentIds']]
        require(all(a['version']==i['assignmentVersions'][a['id']] for a in assignments),'ASSIGNMENT_VERSION_CONFLICT',409)
        expected=sum(Decimal(a['price']) for a in assignments);diff=Decimal(i['amount'])-expected;limit=dec(tol['fixed'])+expected*dec(tol['percent'])/100;weights={}
        for a in assignments:
            s=self.get(db,p,a['shipmentId'],'shipment',True);require(s['status']=='DELIVERED','REALIZED_MISMATCH')
            for pack in s['packages']:weights[pack['orderId']]=weights.get(pack['orderId'],Decimal(0))+dec(pack['weightKg'])
        i.update(expected=cash(expected),difference=cash(diff),toleranceSnapshot=dict(tol),allocationWeightsSnapshot={k:str(v) for k,v in weights.items()},allocation=allocate(Decimal(i['amount']),weights),auditedBy=p['id'],status='AUDITED' if abs(diff)<=limit else 'DISPUTED')
        if i['status']=='DISPUTED':i['disputeId']=self.add(db,p,'dispute',{'invoiceId':i['id'],'difference':i['difference'],'status':'OPEN'},[i['issuerOrg']])['id']
        return self.save(db,i)
    @action('admin','auditor')
    def cmd_dispute_resolve(self,db,p,d):
        dispute=self.get(db,p,d.get('id'),'dispute',True);self.version(dispute,d);require(dispute['status']=='OPEN','INVALID_STATE');i=self.get(db,p,dispute['invoiceId'],'invoice',True)
        require(d.get('decision') in ['ACCEPT_DIFFERENCE','ADJUST_TO_EXPECTED'],'INVALID_DECISION');dispute.update(status='RESOLVED',decision=d['decision'],reason=ident(d.get('reason')))
        if d['decision']=='ADJUST_TO_EXPECTED':i['originalAmount']=i['amount'];i['originalDifference']=i['difference'];i['difference']='0.00';i['amount']=i['expected'];i['allocation']=allocate(Decimal(i['amount']),{k:Decimal(v) for k,v in i['allocationWeightsSnapshot'].items()})
        i['status']='AUDITED';i['resolvedBy']=p['id'];self.save(db,i);return self.save(db,dispute)
    @action('admin','auditor')
    def cmd_approval_request(self,db,p,d):
        i=self.get(db,p,d.get('invoiceId'),'invoice',True);self.version(i,d);require(i['status']=='AUDITED','AUDIT_REQUIRED');i['status']='PENDING_APPROVAL';self.save(db,i)
        return self.add(db,p,'approval',{'invoiceId':i['id'],'amount':i['amount'],'issuerOrg':i['issuerOrg'],'requestedBy':p['id'],'status':'PENDING','type':'POST'})
    @action('approver')
    def cmd_approval_decide(self,db,p,d):
        a=self.get(db,p,d.get('id'),'approval',True);self.version(a,d);require(a['status']=='PENDING','ALREADY_DECIDED',409);require(a['requestedBy']!=p['id'],'SEGREGATION_REQUIRED',403);require(d.get('decision') in ['APPROVE','REJECT'],'INVALID_DECISION')
        a['status']='APPROVED' if d['decision']=='APPROVE' else 'REJECTED';a['approvedBy']=p['id']
        if a['status']=='APPROVED' and a['type']=='SETTLEMENT_REVERSE':
            originals=[s for s in self.all(db,'settlement') if s['approvalId']==a['sourceApprovalId']];require(len(originals)==2,'SETTLEMENT_PAIR_REQUIRED');entries=[]
            for original in originals:
                entry=next(e for e in self.all(db,'ledger') if e['id']==original['entryId']);settled=sum(Decimal(s['amount']) for s in self.all(db,'settlement') if s['entryId']==entry['id'])
                entries.append(self.add(db,{'id':p['id'],'org':original['org']},'settlement',{'entryId':entry['id'],'invoiceId':a['invoiceId'],'approvalId':a['id'],'side':original['side'],'amount':cash(-Decimal(original['amount'])),'reverses':original['id'],'remainingBalance':cash(Decimal(entry['amount'])-settled+Decimal(original['amount'])),'status':'REVERSED_LOCAL_ONLY','realPayment':False})['id'])
            a['settlementIds']=entries;return self.save(db,a)
        if a['status']=='APPROVED' and a['type']=='SETTLEMENT':
            entries=[]
            for owner,side in [(p['org'],'AP'),(a['issuerOrg'],'AR')]:
                originals=[e for e in self.all(db,'ledger') if e['invoiceId']==a['invoiceId'] and e['org']==owner and e['side']==side and e['type']=='POST'];require(len(originals)==1,'ORIGINAL_LEDGER_AMBIGUOUS')
                original=originals[0];settled=sum(Decimal(s['amount']) for s in self.all(db,'settlement') if s['entryId']==original['id']);require(settled+Decimal(a['amount'])<=Decimal(original['amount']),'SETTLEMENT_EXCEEDS_BALANCE',409)
                entries.append(self.add(db,{'id':p['id'],'org':owner},'settlement',{'entryId':original['id'],'invoiceId':a['invoiceId'],'approvalId':a['id'],'side':side,'amount':a['amount'],'remainingBalance':cash(Decimal(original['amount'])-settled-Decimal(a['amount'])),'status':'SETTLED_LOCAL_ONLY','realPayment':False})['id'])
            a['settlementIds']=entries;return self.save(db,a)
        if a['status']=='APPROVED':
            amount=Decimal(a['amount']);sign=1 if a['type']=='POST' else -1
            entries=[]
            for owner,side in [(p['org'],'AP'),(a['issuerOrg'],'AR')]:
                original=None
                if a['type']=='REVERSE':
                    matches=[e for e in self.all(db,'ledger') if e['invoiceId']==a['invoiceId'] and e['org']==owner and e['side']==side and e['type']=='POST'];require(len(matches)==1,'ORIGINAL_LEDGER_AMBIGUOUS');original=matches[0]['id']
                entry=self.add(db,{'id':p['id'],'org':owner},'ledger',{'invoiceId':a['invoiceId'],'approvalId':a['id'],'amount':cash(amount*sign),'side':side,'type':a['type'],'reverses':original,'status':'POSTED_LOCAL_ONLY','realPayment':False})
                entries.append(entry['id'])
            a['entryIds']=entries;i=self.get(db,p,a['invoiceId'],'invoice',True);i['status']='POSTED_LOCAL' if a['type']=='POST' else 'REVERSED_LOCAL';self.save(db,i)
        elif a['type']=='POST':
            i=self.get(db,p,a['invoiceId'],'invoice',True);i['status']='AUDITED';self.save(db,i)
        return self.save(db,a)
    @action('admin','auditor')
    def cmd_reverse_request(self,db,p,d):
        e=self.get(db,p,d.get('entryId'),'ledger',True);require(e['side']=='AP' and e['type']=='POST','INVALID_REVERSAL');require(not any(a.get('originalEntryId')==e['id'] and a['type']=='REVERSE' and a['status'] in ['PENDING','APPROVED'] for a in self.all(db,'approval')),'REVERSAL_EXISTS',409)
        require(sum(Decimal(s['amount']) for s in self.all(db,'settlement') if s['entryId']==e['id'])==0 and not any(a.get('originalEntryId')==e['id'] and a['type']=='SETTLEMENT' and a['status']=='PENDING' for a in self.all(db,'approval')),'REVERSE_SETTLEMENT_FIRST',409)
        i=self.get(db,p,e['invoiceId'],'invoice',True);return self.add(db,p,'approval',{'type':'REVERSE','originalEntryId':e['id'],'invoiceId':i['id'],'issuerOrg':i['issuerOrg'],'amount':e['amount'],'reason':ident(d.get('reason')),'requestedBy':p['id'],'status':'PENDING'})
