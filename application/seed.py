"""Explicit fictitious fixtures; generated passwords, never implicit startup seeding."""
import secrets,uuid
def seed(engine):
    access=[]
    password=secrets.token_urlsafe(18)
    root=engine.bootstrap('Lince Pet','loja.admin',password)
    access.append({'username':'loja.admin','password':password,'org':root['org']})
    login=engine.login('loja.admin',password);p=login['user']
    def call(actor,cmd,data):return engine.execute(actor,cmd,data,uuid.uuid4().hex)
    carriers=[]
    for i in [1,2]:
        org=call(p,'org_create',{'name':['Vértice Transportes','Via Norte Logística'][i-1],'profile':'CARRIER'})
        pw=secrets.token_urlsafe(18);u=call(p,'user_create',{'org':org['id'],'username':f'carrier{i}.admin','password':pw,'roles':['admin','planner','operator','driver','auditor']})
        cp=engine.login(u['username'],pw)['user'];access.append({'username':u['username'],'password':pw,'org':org['id']});carriers.append(cp)
        rel=call(p,'relationship',{'targetOrg':org['id']});call(cp,'relationship_respond',{'id':rel['id'],'version':rel['version'],'decision':'ACCEPT'})
    for name,roles in [('loja.aprovador',['approver']),('loja.operador',['operator','planner'])]:
        pw=secrets.token_urlsafe(18);call(p,'user_create',{'username':name,'password':pw,'roles':roles});access.append({'username':name,'password':pw,'org':p['org']})
    zone=call(p,'master_create',{'kind':'zone','values':{'name':'São Paulo — Capital','from':'01000000','to':'05999999','priority':10}})
    cal=call(p,'master_create',{'kind':'calendar','values':{'name':'Calendário comercial São Paulo','timezone':'America/Sao_Paulo','cutoff':'14:00','weekdays':[0,1,2,3,4],'holidays':['2026-12-25']}})
    service=call(p,'master_create',{'kind':'service','values':{'name':'Entrega Econômica','calendarId':cal['id'],'transitDays':2,'maxPackageKg':'30','maxShipmentKg':'100'}})
    for i,cp in enumerate(carriers):
        rate=call(p,'rate_create',{'name':['Tabela Vértice — Capital','Tabela Via Norte — Capital'][i],'side':'BUY','carrierOrg':cp['org'],'zoneId':zone['id'],'serviceId':service['id'],'validFrom':'2026-01-01T00:00:00Z','validTo':'2030-01-01T00:00:00Z','minKg':'0','maxKg':'101','base':str(10+i*5),'perKg':'2','priority':1,'additions':[]})
        call(p,'rate_publish',{'id':rate['id'],'version':rate['version']})
    return {'mode':'EXPLICIT_DEMO','accounts':access,'shipper':p,'carriers':carriers,'serviceId':service['id']}
