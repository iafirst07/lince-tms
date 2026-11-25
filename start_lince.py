"""Start an isolated Lince simulation. No reset or external exposure."""
from pathlib import Path
import argparse,datetime,subprocess,sys

ROOT=Path(__file__).resolve().parent

def main():
    parser=argparse.ArgumentParser(description='Lince: simulação com dados fictícios')
    parser.add_argument('--new-demo',action='store_true',help='Create a separate fresh simulation directory')
    parser.add_argument('--port',type=int,default=8766)
    args=parser.parse_args()
    try:
        import PIL
        from zoneinfo import ZoneInfo
        ZoneInfo('America/Sao_Paulo')
    except ImportError:
        raise SystemExit('Instale as dependências: python -m pip install -r requirements.txt')
    except Exception as error:
        raise SystemExit('Verifique tzdata e dependências: '+str(error))
    name='runtime-local'
    if args.new_demo:name+='-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    data=ROOT/name;database=data/'application.sqlite'
    command=[sys.executable,'-B',str(ROOT/'application/server.py'),'--db',str(database)]
    if not database.exists():
        subprocess.run(command+['--init-simulation'],check=True,cwd=ROOT/'application')
    print('Acessos privados: '+str(data/'first-access.json'))
    print('Desktop: http://127.0.0.1:'+str(args.port)+'/')
    print('Motorista: http://127.0.0.1:'+str(args.port)+'/driver/')
    subprocess.run(command+['--port',str(args.port)],check=True,cwd=ROOT/'application')

if __name__=='__main__':main()
