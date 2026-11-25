import base64,hashlib,io,json,sqlite3,zipfile,secrets,warnings,tempfile,os
from contextlib import closing
from pathlib import Path
from datetime import datetime
from core import action,require,Error,ident,canonical,moment,dec,cash,sha
from decimal import Decimal
from recovery import gate,marker_path,durable_write,resume_restore

class Portal:
    @action('admin','operator','driver')
    def cmd_offline_sync(self,db,p,d):
        command=d.get('command');require(command in ['pod','tracking'],'OFFLINE_COMMAND_NOT_ALLOWED');payload=d.get('payload');context=d.get('context');require(isinstance(payload,dict) and isinstance(context,dict),'OFFLINE_CONTEXT_REQUIRED')
        s=self.assigned(db,p,payload)
        require(context.get('planVersion')==s['planVersion'] and context.get('assignmentId')==s.get('assignmentId') and isinstance(context.get('packageKeys'),list) and len(context['packageKeys'])==len(set(context['packageKeys'])) and set(context['packageKeys'])=={x['key'] for x in s['packages']},'OFFLINE_CONTEXT_CHANGED',409)
        original_hash=sha(d);event_field='proofId' if command=='pod' else 'eventId';event_id=ident(payload.get(event_field))
        old=[x for x in self.all(db,command) if x['shipmentId']==s['id'] and x[event_field]==event_id]
        if old:
            require(old[0].get('offlineRequestHash')==original_hash or (not old[0].get('offlineRequestHash') and old[0].get('hash')==sha(payload)),'OFFLINE_EVENT_CONFLICT',409);return old[0]
        effective=dict(payload)
        if command=='pod':effective['version']=s['version']
        else:require(effective.get('planVersion')==context['planVersion'],'OFFLINE_CONTEXT_CHANGED',409)
        obj=getattr(self,'cmd_'+command)(db,p,effective);obj['offlineRequestHash']=original_hash;obj['offlineContext']=context;return self.save(db,obj)
    @action('admin','operator','driver')
    def cmd_upload_pod(self,db,p,d):
        from PIL import Image
        s=self.assigned(db,p,d);require(s['status'] in ['IN_TRANSIT','PARTIAL'],'EXECUTION_REQUIRED')
        encoded=d.get('base64');require(isinstance(encoded,str) and len(encoded)<=2800000,'FILE_SIZE')
        try:raw=base64.b64decode(encoded,validate=True)
        except Exception:raise Error('INVALID_BASE64')
        require(0<len(raw)<=2*1024*1024,'FILE_SIZE')
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error')
                im=Image.open(io.BytesIO(raw));require(im.format in ['PNG','JPEG'],'UNSUPPORTED_FILE_TYPE');require(im.width*im.height<=16000000,'PIXEL_LIMIT');im.verify()
                im=Image.open(io.BytesIO(raw));im.load();clean=io.BytesIO();im.convert('RGB').save(clean,format='PNG');body=clean.getvalue()
        except Error:raise
        except Exception:raise Error('UNSAFE_OR_CORRUPT_IMAGE')
        fid='file-'+secrets.token_hex(10);db.execute('INSERT INTO files VALUES(?,?,?,?,?,?)',(fid,s['org'],s['id'],'image/png',body,hashlib.sha256(body).hexdigest()))
        return {'id':fid,'shipmentId':s['id'],'mime':'image/png','bytes':len(body),'status':'VALIDATED_REENCODED','antivirus':False}
    def file_read(self,p,fid):
        with self.db() as db:
            p=self.fresh(db,p);row=db.execute('SELECT * FROM files WHERE id=?',(ident(fid),)).fetchone();require(row,'NOT_FOUND',404);self.get(db,p,row['object'],'shipment');return bytes(row['body']),row['mime']
    def indicators(self,p):
        with self.db() as db:
            p=self.fresh(db,p);visible=self.visible(db,p);ships=[s for s in visible if s['kind']=='shipment' and s['status']!='CANCELLED'];orders=[o for o in visible if o['kind']=='order' and o['org']==p['org'] and o['status']!='CANCELLED'];done=[s for s in ships if s['status']=='DELIVERED'];evaluated=[s for s in done if s.get('promisedAt') and s.get('completedAt')];ontime=[s for s in evaluated if moment(s['completedAt'])<=moment(s['promisedAt'])]
            costs=[Decimal(o['candidate']['cost']) for o in orders if o.get('candidate',{}).get('cost') is not None];charges=[Decimal(o['consumerCharge']) for o in orders if o.get('consumerCharge') is not None];paired=[o for o in orders if o.get('candidate',{}).get('cost') is not None and o.get('consumerCharge') is not None]
            return {'scopeOrg':p['org'],'shipments':{'delivered':len(done),'total':len(ships),'ids':[s['id'] for s in ships]},'packages':{'delivered':sum(len(s['delivered']) for s in ships),'total':sum(len(s['packages']) for s in ships)},'onTime':{'numerator':len(ontime),'denominator':len(evaluated),'deliveredMissingPromiseOrActual':len(done)-len(evaluated),'ids':[s['id'] for s in evaluated],'onTimeIds':[s['id'] for s in ontime],'lateIds':[s['id'] for s in evaluated if s not in ontime],'missingIds':[s['id'] for s in done if s not in evaluated]},'commercial':{'cost':cash(sum(costs)) if costs else None,'costCoverage':len(costs),'charge':cash(sum(charges)) if charges else None,'chargeCoverage':len(charges),'orderDenominator':len(orders),'subsidyPaired':cash(sum(Decimal(o['candidate']['cost'])-Decimal(o['consumerCharge']) for o in paired)) if paired else None,'pairedCoverage':len(paired)},'definitionsVersion':'1','assistance':{'mode':'DETERMINISTIC_NO_ACTION','suggestions':['Verificar entregas sem promessa'] if len(done)>len(evaluated) else ['Sem lacuna de promessa nas entregas avaliadas']}}
    def simulate(self,p,data):
        with self.db() as db:
            p=self.fresh(db,p);require(set(p['roles'])&{'admin','planner'},'ROLE_FORBIDDEN',403)
            before=db.total_changes;result=self.calculate(db,p,data);require(db.total_changes==before,'SIMULATION_WROTE_DATA');return {'status':'SIMULATION_ONLY','result':result,'recommendation':'Menor custo elegível: '+result['candidates'][0]['carrierOrg'],'automaticAction':False}
    @action('admin','planner')
    def cmd_scenario_save(self,db,p,d):return self.add(db,p,'scenario',{'name':ident(d.get('name')),'input':d.get('input'),'mode':'SIMULATION_ONLY'})
    def backup(self,p,destination):
        with self.consistency.hold():return self._backup(p,destination)
    def _backup(self,p,destination):
        require('platform_admin' in p['roles'],'PLATFORM_BACKUP_REQUIRED',403)
        dest=Path(destination);dest.parent.mkdir(parents=True,exist_ok=True);tmp=dest.with_suffix('.sqlite.tmp')
        require(not dest.exists() and not tmp.exists(),'BACKUP_EXISTS',409)
        with self.db() as source:
            target=sqlite3.connect(tmp);source.backup(target);require(target.execute('PRAGMA integrity_check').fetchone()[0]=='ok','BACKUP_INTEGRITY');target.close()
        files={'application.sqlite':tmp.read_bytes()};tmp.unlink()
        mock_path=self.path.parent/'mock.sqlite'
        if mock_path.exists():
            con=sqlite3.connect(mock_path);out=sqlite3.connect(':memory:');con.backup(out);files['mock.sqlite']=out.serialize();out.close();con.close()
        manifest={'schema':1,'createdAt':self.now().isoformat(),'consistency':'QUIESCENT_APP_AND_MOCK_COMMAND_GATE','files':{n:hashlib.sha256(b).hexdigest() for n,b in files.items()},'includes':['users','config','files_blob','outbox','inbox','ledger','mock_protocols'],'sessionsInvalidatedOnRestore':True}
        with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
            for name,body in files.items():z.writestr(name,body)
            z.writestr('manifest.json',canonical(manifest))
        return manifest
    @staticmethod
    def restore(archive,destination,_crash_after=None):
        dest=Path(destination).resolve();dest.parent.mkdir(parents=True,exist_ok=True)
        with gate(dest).hold():return Portal._restore(archive,dest,_crash_after)
    @staticmethod
    def _restore(archive,dest,_crash_after=None):
        if marker_path(dest).exists():return resume_restore(dest,_crash_after)
        require(not dest.exists(),'RESTORE_DESTINATION_EXISTS',409)
        with zipfile.ZipFile(archive) as z:
            manifest=json.loads(z.read('manifest.json'));require(set(manifest['files'])<={'application.sqlite','mock.sqlite'},'BACKUP_FILES_INVALID')
            files={name:z.read(name) for name in manifest['files']};require(all(hashlib.sha256(body).hexdigest()==manifest['files'][name] for name,body in files.items()),'BACKUP_HASH_MISMATCH')
        mock_target=dest.parent/'mock.sqlite'
        require('mock.sqlite' not in files or not mock_target.exists(),'MOCK_RESTORE_EXISTS',409)
        # Validate in memory before creating any destination. Never overwrite an existing target.
        with closing(sqlite3.connect(':memory:')) as db:
            db.deserialize(files['application.sqlite']);require(db.execute('PRAGMA integrity_check').fetchone()[0]=='ok','RESTORE_INTEGRITY');db.execute('DELETE FROM sessions');db.commit();files['application.sqlite']=db.serialize()
        if 'mock.sqlite' in files:
            with closing(sqlite3.connect(':memory:')) as db:db.deserialize(files['mock.sqlite']);require(db.execute('PRAGMA integrity_check').fetchone()[0]=='ok','MOCK_RESTORE_INTEGRITY')
        stage=Path(tempfile.mkdtemp(prefix='.restore-',dir=dest.parent));prepared={dest.name:files['application.sqlite']}
        if 'mock.sqlite' in files:prepared['mock.sqlite']=files['mock.sqlite']
        require(dest.name!='mock.sqlite','RESTORE_NAME_COLLISION')
        for name,body in prepared.items():durable_write(stage/name,body)
        manifest={'destination':str(dest),'stage':str(stage),'files':{n:hashlib.sha256(b).hexdigest() for n,b in prepared.items()}}
        pending=stage/'manifest.pending';durable_write(pending,canonical(manifest).encode())
        os.link(pending,marker_path(dest));pending.unlink()
        return resume_restore(dest,_crash_after)
    def migrate_legacy(self,p,legacy):
        require('platform_admin' in p['roles'],'ROLE_FORBIDDEN',403)
        path=Path(legacy);require(path.is_file(),'LEGACY_NOT_FOUND')
        source=sqlite3.connect('file:'+path.as_posix()+'?mode=ro',uri=True);snapshot=sqlite3.connect(':memory:')
        try:
            source.backup(snapshot);require(snapshot.execute('PRAGMA integrity_check').fetchone()[0]=='ok','LEGACY_INTEGRITY');rows=snapshot.execute('SELECT id,kind,data FROM objects').fetchall();digest=hashlib.sha256(snapshot.serialize()).hexdigest()
            tables={x[0] for x in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")};trail={}
            for table in ['audit','idempotency']:
                if table in tables:
                    cursor=snapshot.execute('SELECT * FROM '+table);names=[x[0] for x in cursor.description];trail[table]=[dict(zip(names,row)) for row in cursor.fetchall()]
        finally:source.close();snapshot.close()
        # Preserve source identity as immutable archive objects; no unsafe promotion to live financial state.
        with self.db(True) as db:
            require(not db.execute('SELECT 1 FROM meta WHERE k=?',('legacy:'+digest,)).fetchone(),'MIGRATION_ALREADY_APPLIED',409);ids=[]
            for oid,kind,data in rows:
                obj=self.add(db,p,'legacyArchive',{'legacyId':oid,'legacyKind':kind,'payload':json.loads(data),'migrationHash':digest,'status':'ARCHIVED_NOT_OPERATIONAL'});ids.append(obj['id'])
            for table,records in trail.items():ids.append(self.add(db,p,'legacyArchive',{'legacyId':'trail:'+table,'legacyKind':table,'payload':records,'migrationHash':digest,'status':'ARCHIVED_NOT_OPERATIONAL'})['id'])
            db.execute('INSERT INTO meta VALUES(?,?)',('legacy:'+digest,canonical(ids)));return {'status':'MIGRATED_AS_ARCHIVE','records':len(ids),'sourceUntouched':True,'migrationHash':digest}
    @action('platform_admin')
    def cmd_migration_rollback(self,db,p,d):
        key='legacy:'+ident(d.get('migrationHash'));row=db.execute('SELECT v FROM meta WHERE k=?',(key,)).fetchone();require(row,'MIGRATION_NOT_FOUND')
        for oid in json.loads(row[0]):
            obj=self.get(db,p,oid,'legacyArchive',True);db.execute('DELETE FROM objects WHERE id=?',(obj['id'],))
        db.execute('DELETE FROM meta WHERE k=?',(key,));return {'status':'ROLLED_BACK_ARCHIVE','sourceUntouched':True}
