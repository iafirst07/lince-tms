# QA funcional do Lince

Esta camada exercita o TMS com massa fictícia, editável e descartável. Não usa bases servidas, transportadoras, órgãos públicos ou pagamentos. A revisão de segurança e a homologação externa têm aceites próprios.

## Executar

Requer Python com as dependências do projeto e Node.js já disponíveis. O comando não instala nada:

```sh
python run_qa.py --list
python run_qa.py --layer all
python run_qa.py --layer front
python run_qa.py --layer back
```

Cada execução cria uma pasta nova em `qa-results/`, com stdout/stderr por suíte, códigos de saída, hashes de fonte antes/depois e `report.json`. O runner falha se uma suíte falhar ou a fonte mudar. Sete suítes não significam sete cenários: confira os nomes/assertivas e os resultados de cada uma. Não se soma passo HTTP com caso de teste.

## Camadas

- Formulários: valores persistidos antes de defaults, arrays de dias/feriados, troca de registro e rascunhos.
- Motorista: fila, contexto original, repetição, retomada e comprovantes fictícios.
- Backend Python: pedidos editáveis, cotação, plano/versões, ofertas, execução parcial/completa, financeiro e edição de frota com guardas.
- HTTP Python: servidor efêmero, arquivos do desktop/PWA/documentação e atualização cruzada da entrega.
- Worker público: HTTP com adaptador D1 em memória; jornadas, persistência, idempotência e negativos. Não equivale a um teste da infraestrutura Cloudflare.
- Interface no navegador: conferência separada de módulos/perfis, formulários, edição/readback e tela móvel. O runner lógico não substitui essa observação.

## Roteiro de uso editável

Na demonstração pública, use um cenário novo de teste. Isso cria outro workspace e preserva os cenários existentes. A opção “Explorar como” troca apenas a persona fictícia; não é autenticação empresarial.

1. Como Gestor da loja, crie um local de entrega em Cadastros, com CEP01310100 e coordenadas fictícias válidas. Edite o nome: CEP, coordenadas e demais valores devem permanecer.
2. Cote um transporte em Pedidos. Use os volumes de `examples/quote.json` como referência; todos os campos podem ser alterados. A cotação tem validade explícita e seus volumes devem coincidir com o pedido.
3. Crie o pedido com a cotação válida e um local com o mesmo CEP. O formulário oferece apenas destinos compatíveis e uma janela de fim posterior ao início. Para mudar peso ou destino, faça nova cotação e use Alterar pedido.
4. Libere, planeje e confirme o plano antes de vencer a cotação. Convide a transportadora; mude para o perfil correspondente para responder. Oferta de viagem cancelada não deve reabrir a viagem.
5. Valide a documentação e etiqueta simuladas, custódia e etapas. No Motorista, use somente a viagem designada; registre insucesso, entrega parcial e conclusão com motivos fictícios.
6. A transportadora registra a fatura de contratação entregue ainda não faturada. O gestor confere, resolve divergência ou solicita aprovação. O Aprovador decide; baixa/estorno continuam locais e simulados.
7. Use os cenários prontos para estudar falha, retorno, consulta de efeito incerto e conciliação. Resultado desconhecido exige consulta, não repetição cega.

Cadastros são editáveis; tarifas/perfis fiscais publicados criam novas versões conforme o contrato. Frota só pode ser editada sem reserva ativa nem manutenção programada: essa trava preserva o planejamento. Pedido executado gera solicitação de alteração/compensação, não reescrita silenciosa da entrega.

## Limites

O backend Python e o Worker público são implementações distintas. As contraprovas cobrem os casos identificados, sem prometer equivalência integral. Dados, endereços, imagens, documentos e contas são fictícios. Não insira dados pessoais ou corporativos na demonstração pública. O resultado de QA é técnico e delimitado; o aceite do produto continua humano.
