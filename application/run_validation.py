"""Local, synthetic test evidence; does not touch the interactive demo database."""
import hashlib,io,json,sys,time,unittest
from datetime import datetime,timezone
from pathlib import Path

def main():
    root=Path(__file__).parent;out=root/'validation';out.mkdir(exist_ok=True)
    modules=['test_a','test_b','test_c','test_d','test_http'];buf=io.StringIO();suite=unittest.defaultTestLoader.loadTestsFromNames(modules);start=time.monotonic()
    result=unittest.TextTestRunner(stream=buf,verbosity=2).run(suite)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report={'at':stamp,'testsRun':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'seconds':round(time.monotonic()-start,3),'success':result.wasSuccessful(),'testModules':modules,'python':sys.version,'hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob('*.py'))},'acceptance':'AUTHOR_TESTS_ONLY_NOT_ALL_DOCUMENTARY_CASES'}
    for path in [out/'result.json',out/('result-'+stamp+'.json')]:path.write_text(json.dumps(report,indent=2),encoding='utf-8')
    for path in [out/'suite.txt',out/('suite-'+stamp+'.txt')]:path.write_text(buf.getvalue(),encoding='utf-8')
    print(buf.getvalue());print(json.dumps({k:v for k,v in report.items() if k!='hashes'}));return not result.wasSuccessful()

if __name__=='__main__':sys.exit(main())
