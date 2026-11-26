from volumetric import validate_policy,calculation
import copy,re
from datetime import timedelta,date,time
from decimal import Decimal,localcontext
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from core import action,require,Error,ident,dec,cash,moment,sha

def cep(v):require(isinstance(v,str) and re.fullmatch(r'\d{5}-?\d{3}',v),'INVALID_CEP');return v.replace('-','')
def packages(v):
    require(isinstance(v,list) and 0<len(v)<=200,'INVALID_PACKAGES');out=[];seen=set()
    for x in v:
        pid=ident(x.get('id'));require(pid not in seen,'DUPLICATE_PACKAGE');seen.add(pid)
        vals={k:format(dec(x.get(k),Decimal('.000001')).normalize(),'f') for k in ['weightKg','lengthCm','widthCm','heightCm']}
        out.append({'id':pid,**vals,'cargoClass':x.get('cargoClass','GENERAL')})
    return sorted(out,key=lambda x:x['id'])

class Catalog:
    def active_master(self,db,p,oid,kind):
        value=self.get(db,p,oid,kind,True);require(value.get('status','ACTIVE')=='ACTIVE','MASTER_INACTIVE',409);return value
    def active_candidate(self,db,p,candidate):
        rate=self.get(db,p,candidate['rateId'],'rate',True)
        self.active_master(db,p,rate['zoneId'],'zone');service=self.active_master(db,p,rate['serviceId'],'service');self.active_master(db,p,service['calendarId'],'calendar')
    def catalog_status(self,old,p,d):
        values=d.get('values',{});require(set(values)=={'status'} and values['status'] in ['ACTIVE','INACTIVE'],'INVALID_STATUS_UPDATE')
        reason=ident(d.get('reason'));require(reason.strip(),'REASON_REQUIRED')
        previous={k:copy.deepcopy(v) for k,v in old.items() if k!='history'}
        old['history']=old.get('history',[])+[{'at':self.now().isoformat(),'actorId':p['id'],'reason':reason,'previous':previous,'status':values['status']}]
        old['status']=values['status'];return old
    @action('admin','planner')
    def cmd_master_create(self,db,p,d):
        kind=d.get('kind');require(kind in ['zone','calendar','service','location'],'INVALID_MASTER');v=copy.deepcopy(d.get('values',{}));self.validate_master(db,p,kind,v)
        return self.add(db,p,kind,dict(v,status='ACTIVE'))
    def validate_master(self,db,p,kind,v,exclude=None):
        fields={'zone':{'name','from','to','priority'},'calendar':{'name','timezone','cutoff','holidays','weekdays'},'service':{'name','calendarId','transitDays','maxPackageKg','maxShipmentKg'},'location':{'name','postalCode','lat','lon'}}
        optional={'addressLine','number','complement','district','city','uf','deliveryInstructions'} if kind=='location' else set()
        require(fields[kind]<=set(v)<=fields[kind]|optional,'MASTER_FIELDS_INVALID')
        for key in optional & set(v):
            require(isinstance(v[key],str) and len(v[key])<=(1000 if key=='deliveryInstructions' else 200),'INVALID_DELIVERY_ADDRESS')
        if kind=='location' and v.get('uf'):
            require(v['uf'] in {'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'},'INVALID_UF')
        ident(v.get('name'))
        if kind=='zone':
            v['from']=cep(v.get('from'));v['to']=cep(v.get('to'));require(v['from']<=v['to'],'INVALID_RANGE');require(isinstance(v.get('priority'),int),'INVALID_PRIORITY')
            for old in self.all(db,'zone'):
                if old['org']==p['org'] and old['id']!=exclude and old['priority']==v['priority'] and old['from']<=v['to'] and v['from']<=old['to']:
                    require((old['from'],old['to'])!=(v['from'],v['to']),'AMBIGUOUS_ZONE')
        elif kind=='calendar':
            require(isinstance(v.get('cutoff'),str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',v['cutoff']),'INVALID_CUTOFF')
            try:ZoneInfo(v.get('timezone',''))
            except (ZoneInfoNotFoundError,ValueError,TypeError):raise Error('INVALID_TIMEZONE')
            try:time.fromisoformat(v['cutoff']);[date.fromisoformat(x) for x in v['holidays']]
            except (KeyError,ValueError,TypeError):raise Error('INVALID_CALENDAR')
            require(isinstance(v.get('weekdays'),list) and v['weekdays'] and set(v['weekdays'])<=set(range(7)),'INVALID_WEEKDAYS')
        elif kind=='service':
            self.active_master(db,p,v.get('calendarId'),'calendar');require(isinstance(v.get('transitDays'),int) and 0<=v['transitDays']<=60,'INVALID_TRANSIT');dec(v.get('maxPackageKg'),Decimal('.001'));dec(v.get('maxShipmentKg'),Decimal('.001'))
        else:
            v['postalCode']=cep(v.get('postalCode'))
            for k,lim in [('lat',90),('lon',180)]:require(isinstance(v.get(k),(int,float)) and abs(v[k])<=lim,'INVALID_COORDINATE')
    @action('admin','planner')
    def cmd_master_update(self,db,p,d):
        old=self.get(db,p,d.get('id'),owner=True);require(old['kind'] in ['zone','calendar','service','location'],'INVALID_MASTER');self.version(old,d)
        vals=copy.deepcopy(d.get('values',{}))
        if 'status' in vals:
            if vals.get('status')=='ACTIVE' and old['kind']=='service':self.active_master(db,p,old['calendarId'],'calendar')
            return self.save(db,self.catalog_status(old,p,d))
        self.validate_master(db,p,old['kind'],vals,old['id']);old['history']=old.get('history',[])+[{k:v for k,v in old.items() if k!='history'}]
        old.update(vals);return self.save(db,old)
    @action('admin','planner')
    def cmd_rate_create(self,db,p,d):
        v=copy.deepcopy(d);self.active_master(db,p,v.get('zoneId'),'zone');service=self.active_master(db,p,v.get('serviceId'),'service');self.active_master(db,p,service['calendarId'],'calendar')
        require(v.get('side') in ['BUY','SELL'],'INVALID_SIDE');carrier=ident(v.get('carrierOrg'));require(carrier==p['org'] or self.linked(db,p['org'],carrier),'RELATION_REQUIRED',403)
        require(moment(v.get('validFrom'))<moment(v.get('validTo')),'INVALID_VALIDITY')
        require(dec(v.get('minKg'))<dec(v.get('maxKg')),'INVALID_WEIGHT_BAND');dec(v.get('base'));dec(v.get('perKg'))
        require(isinstance(v.get('priority'),int),'INVALID_PRIORITY')
        for a in v.get('additions',[]):ident(a.get('name'));require(a.get('type') in ['FIXED','PERCENT'],'INVALID_ADDITION');dec(a.get('value'))
        if 'volumetricPolicy' in v:validate_policy(v['volumetricPolicy'])
        v['status']='DRAFT';return self.add(db,p,'rate',v)
    @action('admin','planner')
    def cmd_rate_publish(self,db,p,d):
        r=self.get(db,p,d.get('id'),'rate',True);self.version(r,d);require(r['status']=='DRAFT','PUBLISHED_IMMUTABLE',409)
        self.active_candidate(db,p,{'rateId':r['id']})
        for other in self.all(db,'rate'):
            if other['id']==r['id'] or other['org']!=p['org'] or other['status']!='PUBLISHED':continue
            same=all(other[k]==r[k] for k in ['carrierOrg','serviceId','zoneId','side','priority'])
            overlap=moment(other['validFrom'])<moment(r['validTo']) and moment(r['validFrom'])<moment(other['validTo']) and dec(other['minKg'])<dec(r['maxKg']) and dec(r['minKg'])<dec(other['maxKg'])
            require(not(same and overlap),'AMBIGUOUS_RATE',409)
        r['status']='PUBLISHED';r['publishedAt']=self.now().isoformat();return self.save(db,r)
    def calculate(self,db,p,d):
        destination=cep(d.get('destinationCep'));origin=cep(d.get('originCep'));packs=packages(d.get('packages'));weight=sum(dec(x['weightKg']) for x in packs);now=self.now();results=[];reasons=[]
        services={s['id']:s for s in self.all(db,'service') if s['org']==p['org'] and s.get('status','ACTIVE')=='ACTIVE'}
        zones={z['id']:z for z in self.all(db,'zone') if z['org']==p['org'] and z.get('status','ACTIVE')=='ACTIVE'}
        rates=[]
        for r in self.all(db,'rate'):
            if r['org']!=p['org'] or r['status']!='PUBLISHED' or r['side']!=d.get('side','BUY'):continue
            z=zones.get(r['zoneId']);service=services.get(r['serviceId'])
            if not z or not service or not z['from']<=destination<=z['to']:continue
            if self.get(db,p,service['calendarId'],'calendar',True).get('status','ACTIVE')!='ACTIVE':continue
            if not moment(r['validFrom'])<=now<moment(r['validTo']):continue
            billed=Decimal(calculation(packs,r['volumetricPolicy'])['billableKg']) if 'volumetricPolicy' in r else weight
            if not dec(r['minKg'])<=billed<dec(r['maxKg']):continue
            if r['carrierOrg']!=p['org'] and not self.linked(db,p['org'],r['carrierOrg']):continue
            if weight>dec(service['maxShipmentKg']) or any(dec(x['weightKg'])>dec(service['maxPackageKg']) for x in packs):reasons.append({'rate':r['id'],'reason':'CAPACITY'});continue
            rates.append((r,z,service))
        groups={}
        for r,z,s in rates:groups.setdefault((r['carrierOrg'],s['id']),[]).append((r,z,s))
        for group in groups.values():
            group.sort(key=lambda t:(-t[1]['priority'],int(t[1]['to'])-int(t[1]['from']),-t[0]['priority']))
            if len(group)>1:
                a,b=group[:2];require((a[1]['priority'],int(a[1]['to'])-int(a[1]['from']),a[0]['priority'])!=(b[1]['priority'],int(b[1]['to'])-int(b[1]['from']),b[0]['priority']),'AMBIGUOUS_RATE')
            r,z,s=group[0];cal=self.get(db,p,s['calendarId'],'calendar',True);dt=now.astimezone(ZoneInfo(cal['timezone']));day=dt.date()
            if dt.time()>=time.fromisoformat(cal['cutoff']):day+=timedelta(days=1)
            def business(day):return day.weekday() in cal['weekdays'] and day.isoformat() not in cal['holidays']
            for _ in range(400):
                if business(day):break
                day+=timedelta(days=1)
            else:raise Error('CALENDAR_NO_CAPACITY')
            pickup=day
            for _ in range(s['transitDays']):
                day+=timedelta(days=1)
                while not business(day):day+=timedelta(days=1)
            memory=calculation(packs,r['volumetricPolicy']) if 'volumetricPolicy' in r else None
            billed=Decimal(memory['billableKg']) if memory else weight
            with localcontext() as context:
                context.prec=100
                raw=dec(r['base'])+billed*dec(r['perKg']);lines=[{'name':'BASE','amount':cash(dec(r['base']))},{'name':'WEIGHT','amount':cash(billed*dec(r['perKg']))}]
                for a in r.get('additions',[]):lines.append({'name':a['name'],'amount':cash(dec(a['value']) if a['type']=='FIXED' else raw*dec(a['value'])/100)})
                results.append({'carrierOrg':r['carrierOrg'],'serviceId':s['id'],'rateId':r['id'],'rateVersion':r['version'],'cost':cash(sum(Decimal(x['amount']) for x in lines)),'currency':'BRL','lines':lines,'pickup':pickup.isoformat(),'delivery':day.isoformat(),'calendarSnapshot':cal,'rateSnapshot':r})
            if memory:results[-1]['weightCalculation']={**memory,'rateId':r['id'],'rateVersion':r['version']}
        require(results,'NO_ELIGIBLE_COVERAGE')
        return {'originCep':origin,'destinationCep':destination,'packages':packs,'weightKg':str(weight),'candidates':sorted(results,key=lambda r:Decimal(r['cost'])),'reasons':reasons,'expiresAt':(now+timedelta(minutes=15)).isoformat(),'snapshotHash':sha([origin,destination,packs])}
    @action('admin','planner','operator')
    def cmd_quote(self,db,p,d):return self.add(db,p,'quote',self.calculate(db,p,d))
