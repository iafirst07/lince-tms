"""Run the Lince functional QA layers with disposable, fictional data only."""
from pathlib import Path
import argparse,datetime,hashlib,json,shutil,subprocess,sys,time

ROOT=Path(__file__).resolve().parent
LAYERS={
 'front':[
  ('scanner_qr',['node','application/test_scanner.cjs'],'.'),
  ('scanner_context',['node','application/test_scan_integration.cjs'],'.'),
  ('edit_forms',['node','application/test_form_state.cjs'],'.'),
  ('driver_queue',['node','application/test_driver_logic.cjs'],'.')],
 'back':[
  ('live_operations',['node','public-runtime/test-live-operations.mjs'],'.'),
  ('live_http',['node','public-runtime/test-live-http.mjs'],'.'),
  ('exploration_factory',['node','public-runtime/test-exploration.mjs'],'.'),
  ('exploration_http',['node','public-runtime/test-exploration-http.mjs'],'.'),
  ('python_commerce_cubage_tasks_dock',[sys.executable,'-B','-m','unittest','test_commerce','test_volumetric','test_driver_tasks','test_dock'],'application'),
  ('public_commerce_cubage_tasks_dock',['node','--test','public-runtime/test-commerce.mjs','public-runtime/test-volumetric.mjs','public-runtime/test-volumetric-entry.mjs','public-runtime/test-driver-tasks.mjs','public-runtime/test-dock.mjs'],'.'),
  ('python_journey',[sys.executable,'-B','-m','unittest','test_tms_journey.TmsJourneyTests'],'application'),
  ('fleet_edit',[sys.executable,'-B','-m','unittest','test_resource_edit.ResourceEditTests'],'application'),
  ('python_http',[sys.executable,'-B','-m','unittest','test_lince_http.LinceHTTP'],'application'),
  ('public_journey',['node','public-runtime/test-tms-journey.mjs'],'.'),
  ('public_regression',['node','public-runtime/test-public-runtime.mjs'],'.')]
}

def hashes():
    return {str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest()
            for folder in ['application','public-runtime'] for p in (ROOT/folder).iterdir()
            if p.is_file() and p.suffix in {'.py','.js','.mjs','.cjs','.css','.html','.json'}}

def main():
    parser=argparse.ArgumentParser(description='Lince: QA funcional com massa fictícia; não instala dependências ou altera bancos servidos.')
    parser.add_argument('--layer',choices=['front','back','all'],default='all')
    parser.add_argument('--output',type=Path)
    parser.add_argument('--list',action='store_true')
    args=parser.parse_args()
    commands=[(layer,*item) for layer,items in LAYERS.items() if args.layer in ['all',layer] for item in items]
    if args.list:
        print(json.dumps([{'layer':layer,'id':name,'command':cmd,'cwd':cwd} for layer,name,cmd,cwd in commands],indent=2));return
    if not shutil.which('node'):raise SystemExit('Node.js é necessário para testar os clientes e o Worker de simulação.')
    run=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output=args.output or ROOT/'qa-results'/run;output.mkdir(parents=True,exist_ok=False)
    before=hashes();results=[];start=time.monotonic()
    for layer,name,cmd,cwd in commands:
        print('Executando '+name+'...',flush=True);t=time.monotonic()
        try:
            p=subprocess.run(cmd,cwd=ROOT/cwd,capture_output=True,encoding='utf-8',errors='replace',timeout=300)
            (output/(name+'.stdout.txt')).write_text(p.stdout,encoding='utf-8')
            (output/(name+'.stderr.txt')).write_text(p.stderr,encoding='utf-8')
            results.append({'id':name,'layer':layer,'exitCode':p.returncode,'pass':p.returncode==0,'seconds':round(time.monotonic()-t,3)})
        except subprocess.TimeoutExpired:
            results.append({'id':name,'layer':layer,'pass':False,'error':'TIMEOUT','seconds':round(time.monotonic()-t,3)})
    after=hashes();stable=before==after
    report={'run':run,'scope':'Functional synthetic QA layers; Python temporary databases and Worker fake D1. Browser/UI, security and external homologation are separate.','results':results,'layersPassed':sum(r['pass'] for r in results),'layersTotal':len(results),'sourceStable':stable,'sourceHashes':before,'finalHashes':after,'seconds':round(time.monotonic()-start,3),'allPass':stable and all(r['pass'] for r in results)}
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(output/'report.json'),'allPass':report['allPass'],'layersPassed':report['layersPassed'],'layersTotal':len(results),'sourceStable':stable},ensure_ascii=False))
    if not report['allPass']:raise SystemExit(1)

if __name__=='__main__':main()
