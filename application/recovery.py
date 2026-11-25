"""Local cross-process quiescence and resumable, non-overwriting restore."""
import hashlib,json,os,threading,time
from contextlib import contextmanager
from pathlib import Path

_registry={}
_registry_guard=threading.Lock()

class Gate:
    def __init__(self,path):self.path=path;self.lock=threading.RLock();self.local=threading.local()
    @contextmanager
    def hold(self):
        with self.lock:
            depth=getattr(self.local,'depth',0)
            if depth:
                self.local.depth=depth+1
                try:yield
                finally:self.local.depth-=1
                return
            handle=open(self.path,'a+b');handle.seek(0);handle.write(b'0');handle.flush();handle.seek(0)
            if os.name=='nt':
                import msvcrt
                while True:
                    try:msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1);break
                    except OSError:time.sleep(.01)
            else:
                import fcntl
                fcntl.flock(handle.fileno(),fcntl.LOCK_EX)
            self.local.depth=1
            try:yield
            finally:
                self.local.depth=0
                if os.name=='nt':
                    handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
                handle.close()

def gate(path):
    key=str(Path(path).resolve())
    with _registry_guard:return _registry.setdefault(key,Gate(key+'.consistency.lock'))

def marker_path(dest):return Path(str(dest)+'.restore.json')

def durable_write(path,body):
    with Path(path).open('xb') as f:f.write(body);f.flush();os.fsync(f.fileno())

def resume_restore(dest,crash_after=None):
    from core import require
    dest=Path(dest).resolve();marker=marker_path(dest);manifest=json.loads(marker.read_text(encoding='utf-8'))
    require(manifest['destination']==str(dest),'RESTORE_MARKER_MISMATCH')
    stage=Path(manifest['stage']).resolve();require(stage.parent==dest.parent and stage.name.startswith('.restore-'),'RESTORE_STAGE_INVALID')
    allowed={dest.name,'mock.sqlite'};require(set(manifest['files'])<=allowed and dest.name in manifest['files'],'RESTORE_FILES_INVALID')
    # Preflight all files before publishing any: an unrelated file is never overwritten.
    for name,digest in manifest['files'].items():
        source=stage/name;target=dest.parent/name
        require(source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest()==digest,'RESTORE_STAGE_HASH')
        require(not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()==digest,'RESTORE_DESTINATION_CONFLICT')
    for index,name in enumerate(manifest['files']):
        source=stage/name;target=dest.parent/name
        if not target.exists():os.link(source,target)
        if crash_after is not None and index+1==crash_after:os._exit(73)
    # Marker removed only after the complete pair is installed. Startup refuses an active marker.
    marker.unlink()
    for name in manifest['files']:(stage/name).unlink()
    pending=stage/'manifest.pending'
    if pending.exists():pending.unlink()
    stage.rmdir()
    return {'status':'RESTORED_LOCAL','sessions':0,'destination':str(dest),'recovery':'STAGED_RESUMABLE_PAIR'}
