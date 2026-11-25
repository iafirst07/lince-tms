# Lince — laboratório de simulação

O inicializador cria uma operação fictícia de e-commerce pet para explorar o desktop, o app do motorista e as APIs locais com estados persistentes. Não usa dados, clientes, regras internas ou operações reais da Petlove. Os cenários são exemplos originais do produto Lince.

Implementação: [application/simulation.py](application/simulation.py), função `seed_simulation(engine)`. É opt-in e exige banco da aplicação vazio e diretório novo, sem `mock.sqlite`. Não apaga, restaura, completa ou mistura uma base já existente. O protótipo e os runtimes anteriores permanecem separados.

## Inicialização e acesso

O integrador expõe a função no CLI `--init-simulation`. A função retorna `accounts` para o inicializador gravar no arquivo privado de primeiro acesso; não imprime nem persiste senhas nos cenários, no código ou nas evidências. Cada senha é gerada aleatoriamente. O manifesto persistido contém apenas nomes de usuário, papéis, organização e IDs dos cenários.

Depois de inicializar e iniciar o servidor no diretório escolhido, os pontos de entrada são `/` para o desktop e `/driver/` para o motorista. O servidor, a UI e os parâmetros finais do CLI têm instruções próprias em [application/README.md](application/README.md); esta unidade não altera o servidor central nem comprova sua publicação.

| Usuário local | Uso previsto |
|---|---|
| `loja.admin` | Cadastros, pedidos, planejamento, conferência e configurações sintéticas |
| `loja.aprovador` | Decidir aprovações financeiras pendentes, como pessoa distinta do solicitante |
| `loja.operador` | Operação e planejamento conforme os comandos da aplicação |
| `carrier1.admin` | Transportadora principal fictícia: aceitar oferta, executar etapas e apresentar fatura |
| `carrier2.admin` | Segunda transportadora fictícia: comparar/receber propostas |
| `lince.motorista` | Papel exclusivo `driver`, relacionado a recursos de frota e viagens pelo comando de atribuição |
| `lince.coleta` | Segundo motorista exclusivo, com cenário de coleta |

Não há senha padrão. As senhas retornadas pelo inicializador devem permanecer no arquivo privado local de primeiro acesso e fora do GitHub e das evidências públicas. A existência dos perfis não representa auditoria completa de permissões ou aprovação para uso produtivo.

## Roteiro dos 18 cenários

O objeto `simulationManifest` preserva os IDs efetivos, estados esperados, próximo comando e contagens para a instância. IDs de objetos e credenciais são aleatórios; o desenho da massa é determinístico e as datas são relativas ao relógio da instância.

| ID | Estado inicial e exploração |
|---|---|
| `DESKTOP_DRAFT` | Pedido com dois volumes `VALIDATED`; liberar, ou recotar se a cotação tiver vencido |
| `DESKTOP_RELEASED` | Pedido `RELEASED`, disponível para planejamento |
| `DRIVER_READY_DELIVERY` | Rota `IN_TRANSIT`, etapa `DELIVERY`, duas paradas e três volumes; registrar tentativa, POD parcial e restante no app |
| `PASSIVE_WMS` | Contrato WMS já processado pelo mock HTTP; custódia `READY` persistida na remessa |
| `DRIVER_PICKUP` | Viagem do segundo motorista em `PICKUP`; próxima passagem pelo `HUB` |
| `DESKTOP_TENDER` | Oferta `OPEN` para duas transportadoras; explorar aceite ou contraproposta |
| `FINANCE_DISPUTE` | Entrega concluída e fatura `DISPUTED`, diferença sintética de R$ 15; conferir e resolver a disputa |
| `FINANCE_APPROVAL` | Fatura conferida com aprovação `PENDING`; decidir usando o aprovador |
| `FINANCE_POSTED` | AP/AR locais, conciliação ERP mock e solicitação de baixa parcial de R$ 2 para aprovar |
| `REVERSE_AND_CLAIM` | Reversa parcial `AUTHORIZED` e ocorrência `OPEN`; coletar, receber, encerrar e tratar a ocorrência |
| `DRIVER_PARTIAL` | Dois volumes, um entregue e outro pendente; concluir o restante sem duplicar o primeiro POD |
| `PASSIVE_OMS` | Pedido `VALIDATED`, criado pelo efeito do contrato OMS no mock HTTP |
| `PASSIVE_INBOX` | Recebimento local de mensagem assinada; o recibo não inventa projeção de domínio |
| `ACTIVE_UNKNOWN` | Efeito aceito pelo mock com resposta perdida, estado `UNKNOWN`; consultar antes de tentar de novo |
| `ACTIVE_RECONCILED` | Outro caso de resposta perdida já consultado; `DONE`, protocolo local único |
| `ACTIVE_DLQ` | Três falhas comprovadamente sem efeito, `DLQ`; fazer triagem e reprocessar a mesma mensagem |
| `FISCAL_LOCAL` | Perfil e preflight `DEMO_PREPARED`; não é XML nem protocolo de órgão público |
| `FISCAL_PENDING` | Perfil direto para homologação em `PENDING_DATA`, com campos e dependências discriminados |

As sete viagens, onze pedidos e demais objetos foram produzidos por comandos positivos de domínio, incluindo custódia, provas, fatura e aprovação. Somente o manifesto é gravado como metadado do gerador, sem representar uma operação de negócio. As imagens são geradas localmente com o texto de comprovante fictício e passam pelo mesmo comando de upload da aplicação.

## Camadas e comportamento ativo/passivo

1. **Interface:** desktop e PWA consomem sessões, projeções e comandos do mesmo backend. A massa prepara seus percursos; navegar cada tela exige a prova de UI do integrador, distinta dos testes desta unidade.
2. **API e domínio:** os cenários usam `engine.execute` com os contratos dos comandos e chaves de idempotência; não são linhas de remessa/fatura inseridas diretamente no banco para aparentar fluxo concluído.
3. **Persistência:** SQLite conserva estados, snapshots, auditoria, deduplicação, filas, ledger e imagens. Uma reabertura mantém os IDs e os estados.
4. **Integração ativa:** outbox e mocks HTTP locais de OMS/WMS/ERP/CARRIER/FISCAL/MAPS exercitam envios, resposta perdida, consulta, triagem e protocolo único. As seis siglas designam contratos próprios de laboratório, não implementações de fornecedores.
5. **Recebimento passivo:** há uma mensagem de inbox assinada e persistida pelo método de recebimento. O inbox atual registra recebimento/dedup; não traduz automaticamente qualquer evento em entrega ou status do pedido. Expor e homologar webhooks reais é trabalho específico do integrador/fornecedor.
6. **Coordenação:** ações de processamento/consulta são explícitas. Não há agenda, monitor permanente, envio a cliente, órgão governamental ou transportadora real criado pelo gerador.

O gerador inicia um mock HTTP efêmero somente durante a preparação e o encerra ao terminar. O banco `mock.sqlite` permanece para o servidor reaberto consultar os mesmos protocolos e recuperar os casos `UNKNOWN`. O servidor deve iniciar seu mock normalmente ao servir essa instância; não reutilizar o diretório de outra demonstração.

## Datas, validade e limites

As janelas são calculadas a partir de `engine.now()`, e não copiadas de um dia anterior. A massa base de tarifas tem período sintético de 2026 até antes de 2030; fora desse intervalo, o inicializador recusa para exigir uma versão explícita da massa. Nenhum esquema/regra fiscal ganha vigência por esse período de demonstração.

Os estados são exemplos produzidos no instante de inicialização, não a cronologia física de uma operação real. Há cenários futuros já posicionados em execução para permitir navegação imediata; isso não mede atraso, tempo ou resultado real. Promessas, distâncias, endereços e indicadores são sintéticos. A cotação conserva sua validade normal de 15 minutos: depois desse prazo, fluxos ainda não liberados/planejados podem exigir recotação, como o produto determina. Não foi removida essa regra para fazer a demonstração parecer sempre pronta.

Se a inicialização falhar depois de alguns comandos, pode existir uma base nova parcial. Não reaplicar o seed nessa base e não apagar uma base de origem por inferência. Preservar a evidência, diagnosticar a etapa e criar outra instância nova descartável quando apropriado. Um diretório já populado nunca é resetado por este comando.

## Evidências e testes

Os testes funcionais em [application/test_simulation.py](application/test_simulation.py) cobrem estados e endereços no desktop, motorista com papel dedicado concluindo POD parcial/restante e replay offline positivo, OMS/WMS/inbox, recuperação `UNKNOWN` e triagem de DLQ, reabertura/integridade, manifesto sem credenciais, recusa de banco já populado e continuação de aprovação financeira e reversa.

Resultados e histórico: [evidencias/simulacao-20261125](VALIDACAO.md). A primeira rodada encontrou duas falhas do próprio teste: texto esperado incompatível com a instrução da massa e conexão de leitura do teste não fechada no Windows. Ambas foram corrigidas sem ocultar o histórico. A contagem final está no resultado do autor; não equivale a cobertura total de todas as telas, permissões ou integrações reais.

```powershell
python -B -m unittest -v test_simulation
```

Executar em `application` com as dependências já documentadas. Nenhum banco em uso foi acessado pelos testes. A categoria de revisão de permissões previamente bloqueada não foi reexecutada e continua com seu gate próprio. A preparação fiscal está descrita em [FISCAL-INTEGRACAO.md](FISCAL-INTEGRACAO.md).
