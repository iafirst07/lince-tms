## Revisão funcional local — 26/11/2026

Coleta e entrega agora distinguem parada, pedido e volumes, sem seleção automática de todos os volumes. O fluxo de compra multi-origem mantém uma cobrança ao consumidor, separada dos custos logísticos, com rateio em centavos. Tarifas podem optar por política versionada de cubagem; o divisor6000 exibido é exemplo sintético. Planos com coleta explícita exigem recibo de cada parada antes da saída. Reversa pode virar tarefa atribuída ao motorista. Docas têm capacidade, reserva, remarcação e check-in/out simulados.

Revisão distinta da fonte e integração local: ver evidências responsáveis no projeto. Testes com dados fictícios não demonstram coleta física, tarifa contratual, emissão fiscal ou prontidão empresarial. PWA não é APK/IPA. A retomada automática de workspace/persona após fechar uma sessão continua pendente: candidato excluído após falha de armazenamento negado. Preserve o link completo com `?workspace=…` para compartilhar o mesmo cenário.

Links: [Desktop](https://lince-tms.rafaelsiqueira7394.chatgpt.site), [Motorista](https://lince-tms.rafaelsiqueira7394.chatgpt.site/driver/), [API](https://lince-tms.rafaelsiqueira7394.chatgpt.site/docs/). Demonstração pública usa personas fictícias e não pede senha. O backend Python local possui credenciais próprias geradas no primeiro acesso; não copiar credenciais para o código público.


---

# Aplicação TMS local

Versão modular isolada do protótipo da porta 8765. Dados fictícios, servidor somente em 127.0.0.1:8766, SQLite persistente. Nenhum pagamento, notificação, emissão fiscal ou integração externa real. Não há senha padrão nem reinicialização automática do banco.

## Executar

Requer Python 3.12 e Pillow já disponíveis no ambiente. Não requer instalação. Na pasta application:

```powershell
$py = 'C:/Users/rafae/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $py server.py --db runtime-ui/application.sqlite --init-demo
& $py server.py --db runtime-ui/application.sqlite --port 8766
```

O primeiro comando é opt-in, uma única vez por banco vazio. Gera usuários/senhas aleatórias em `runtime-ui/first-access.json`, que deve permanecer local. O segundo reutiliza o banco existente; fecha ao encerrar o processo. O processo coordenador inicia a interface em segundo plano. Não executar outra instância para o mesmo banco: há trava exclusiva. Para cadastro vazio, usar `--init` no lugar de `--init-demo`, informando administrador e organização. Não executar reset de dados existentes; uma nova demonstração usa outro diretório explicitamente escolhido.

O mock HTTP usa porta aleatória em loopback e banco `mock.sqlite` no mesmo diretório. Seu início/encerramento é explícito pelo servidor; construir `Engine` não inicia serviços. O relógio de domínio é injetável no construtor para testes. O relógio HMAC usa tempo real e janela de 300 segundos.

## Jornada

1. Administrador da loja: cadastrar locais, conferir calendário/serviço/tarifas, cotar os pacotes e criar pedido com cobrança ao consumidor separada. A massa inicial tem duas transportadoras elegíveis.
2. Liberar pedido, planejar/consolidar, confirmar plano e oferecer viagem. Transportadora cadastra veículo/motorista e aceita a oferta, reservando ambos no intervalo.
3. Transportadora solicita etiqueta e política/documento fiscal **simulados**. Processar mensagens no painel de integrações; estado UNKNOWN exige consultar antes de repetir. Sem isso, despacho permanece bloqueado.
4. Registrar coleta, hub, transferência, última milha e chegada à entrega. POD aceita parcelas por chave de pacote, comprovante PNG/JPEG e tentativa sem entrega; registrar ocorrências ou reversa quando aplicável.
5. Transportadora apresenta fatura após entrega. Loja audita, resolve disputa e solicita aprovação; usuário aprovador distinto decide. A aprovação gera AP/AR locais; estorno usa novos lançamentos negativos e referências aos respectivos originais.

Interface em `index.html`, `app.js`, `style.css` é de autoria do coordenador e tem revisão visual própria. Seu aceite não é inferido dos testes de backend.

## Contratos HTTP

Todas as respostas são JSON, salvo arquivos e página. `POST /api/login` recebe username/password e devolve user/csrf, cookie HttpOnly/SameSite=Strict. `GET /api/session` devolve sessão atual. `POST /api/logout` revoga sessão. Escritas autenticadas exigem X-CSRF-Token; comandos exigem Idempotency-Key.

`GET /api/state` entrega objetos, organizações, diretório autorizado e comandos permitidos; `?id=` consulta um objeto com as mesmas guardas. `POST /api/command` recebe command/payload, valida papel, relação, objeto, versão e estado no servidor. `POST /api/simulate` não grava operação. `GET /api/kpis` filtra o escopo antes de agregar. Comando `upload_pod` recebe shipmentId/base64; `GET /api/file?id=` revalida acesso e serve attachment. `POST /api/backup` é exclusivo do administrador da plataforma e retorna ZIP. Runtime e banco não são rotas estáticas.

Os contratos específicos dos seis adapters estão em `validate_contract` de integrations.py: OMS importa pedido, WMS aplica custódia, ERP cria reconciliação local, carrier retorna etiqueta simulada, maps calcula matriz sintética, fiscal retorna estado de documento DEMO. CARRIER/FISCAL só entram pelas respectivas jornadas, sem target/purpose livre no comando genérico. Não são implementações de fornecedores comerciais.

`adapter_config_create` publica configuração imutável por tenant: adapter, name, contractVersion=1, mode=LOCAL_MOCK. A outbox conserva configSnapshot; configId seleciona configuração compatível, sem endpoint externo livre. Ausência de configId cria configuração local explícita na persistência.

Cada `stage` exige packageKeys exato, sem duplicações, faltas ou extras, e grava custódia com quantidade, ator e horário. `settlement_request` solicita baixa parcial LOCAL por entryId/amount/reason; aprovação distinta gera AP/AR settlement e saldo. `settlement_reverse_request` compensa uma baixa por settlementId/reason. Nenhuma baixa efetua pagamento. Estorno contábil é bloqueado enquanto houver baixa não compensada ou solicitação pendente.

`offline_sync` aceita somente pod/tracking e recebe command, payload original, context com planVersion, assignmentId e todas as packageKeys do embarque. Atribuição/relação/contexto são revalidados antes de reconciliar a versão do POD. Contexto alterado devolve OFFLINE_CONTEXT_CHANGED; não descartar a fila. Identificador da prova/evento e hash do pedido evitam duplicação após resposta perdida, inclusive com nova chave de transporte. Mudança de versão decorrente de outro POD do mesmo contexto é reconciliada atomicamente.

## Persistência e recuperação

Backup consistente inclui banco, BLOBs de comprovantes, configurações, inbox/outbox, ledger e banco mock, com hashes. Restore valida em memória, exige destino novo, recusa colisão de mock, invalida todas as sessões e não sobrescreve arquivo existente:

```powershell
& $py server.py --restore caminho/backup.zip --db novo-diretorio/application.sqlite
```

Migração opt-in `--migrate-legacy caminho/preview.sqlite` autentica administrador, gera backup anterior e copia snapshot SQLite consistente, incluindo WAL. Conserva IDs de origem em legacyId e trilhas como arquivo histórico **não operacional**. `migration_rollback` remove apenas arquivo importado daquela migração; não modifica a fonte. Não converter contratos/financeiro antigos automaticamente. Fonte autorizada do baseline é o backup em `../evidencias/continuidade-baseline/preview.sqlite`, nunca o banco vivo da porta 8765.

Outbox persiste PROCESSING antes de HTTP, sem manter transação SQLite durante envio. Encerramento após efeito externo deixa claim recuperável: startup muda para UNKNOWN e consulta messageId. O mock persiste deduplicação. DLQ não reenvia automaticamente; exige análise.

## Validação executável e limites

```powershell
& $py -m unittest -v test_a test_b test_c test_d test_http
```

- A: sessão/CSRF/revogação, metadados imutáveis, cutoff, cotação decimal de duas transportadoras, imutabilidade/ambiguidade, calendário/restart e relação revogada.
- B: importação inválida, versões/cancelamento, consolidação com cancelamento de um irmão, replanejamento inviável conservador, duas aceitações concorrentes, manutenção, RFQ e reversa completa.
- C: assinatura/inbox/DLQ, seis contratos com efeitos locais, resposta perdida, processo filho encerrado após aceite HTTP e consulta posterior, disputa/aprovação rejeitada/reapresentação, AP/AR e estorno com vínculo correto.
- Complementos C: configuração por tenant, conservação dos volumes na custódia, baixa parcial e compensação segregadas, rateio após ajuste usando pesos originais (inclusive parcelas arredondadas a zero).
- D: imagem reencodada e acesso revogado, backup/restore com colisão sem arquivo parcial, migração com WAL e rollback, simulação sem escrita e ausência diferente de zero.
- Complemento D: dois PODs offline com mesma versão, reabertura do banco, replay sem duplicação, tracking tardio e recusa de contexto alterado.
- HTTP: cookie, sessão, CSRF, comando autenticado, negação de caminho de banco e logout.

Resultados e hashes são registrados em `validation/`. Quantidade de testes não significa que todos os 32 casos documentais ou todas as capacidades M01–M16 foram homologados. Revisão independente, UI, benchmark e gabarito de indicadores têm evidências próprias do coordenador. Não alegar segurança produtiva.

Limites externos: fornecedores, credenciais, pagamento, homologação fiscal e notificações reais indefinidos. Limites locais deliberados: rota heurística com distância sintética (sem solver ótimo/trânsito); documento fiscal é envelope DEMO, não XML de emissão oficial; sem cálculo de tributos; upload apenas PNG/JPEG, sem antivírus; legado apenas arquivo histórico; callback de inbox registra recebimento/dedup e não inventa tradução de eventos de fornecedores. O contrato de política detalhado está em CONTRACT.md.

## Delta de recuperação

Backup mantém quiescência de comandos e efeitos mock até capturar appDB+mockDB. A guarda é reentrante, por banco, com lock de arquivo; quem escreve SQL diretamente fora da aplicação não participa do contrato. Restore usa staging validado, marker publicado atomicamente e instalação sem sobrescrita. Se houver interrupção, a inicialização recusa RESTORE_INCOMPLETE; repetir `--restore` no mesmo destino retoma o conjunto registrado. Antes do marker, uma interrupção pode deixar staging órfão sem publicar banco. Após a instalação completa, o marker é removido. O teste interrompe um processo entre os dois arquivos, não simula perda física de energia.

Rateio usa maiores restos em centavos: piso das parcelas exatas, seguido da distribuição dos centavos restantes por parte fracionária decrescente, com empate por ID crescente. Conserva o total sem parcelas negativas para totais positivos e reutiliza os pesos originais nos ajustes. Offline sync reconhece também POD normal já aplicado quando o hash do payload original coincide exatamente. Testes do delta: `python -m unittest -v test_recovery_delta`. Evidências do snapshot anterior são preservadas.

## Delta comercial e operacional

RFQ permanece separado da viagem: create → bid → select gera rascunho; publish torna a tarifa elegível para quote. Seleção após expiração é recusada. Contraproposta só reserva recursos no counter_accept; reoferta cancela a oferta aberta anterior; expiração ocorre no instante limite.

Edição antes de execução exige nova cotação e preserva revisão. Após award gera proposta; resolução cancela assignment antigo e libera reservas. Após execução registra compensação descritiva sem apagar entrega/POD e sem gerar pagamento implícito. Replanejamento de viagem ASSIGNED exige reason e retorna replanChange. `replan_approve {id,version,reason}` valida a versão da viagem e calcula viabilidade antes de cancelar contrato/reservas; retorna plano para confirmação. Inviável conserva a viagem original. Após execução a via continua compensatória, sem reescrever a operação.

Agregado é recurso ligado a contrato imutável: `aggregate_contract {name,providerOrg,validFrom,validTo,reference}`; `fleet_create` recebe fleetMode=AGGREGATE e aggregateContractId. A contratação da viagem valida vigência integral e relação vigente. Não representa homologação jurídica de contrato real. `maintenance_finish` recebe id/version/result/reason; COMPLETED exige fim decorrido, CANCELLED conserva justificativa.

Despesa registra amount/advanceAmount/category por viagem. `expense_reconcile {id,version,approvedAmount,reason}` confere o valor, preserva original e cria expenseAdjustment com diferença, direção e saldo local. `expense_close {id,version,amount,reference}` fecha exatamente o saldo. Reembolso devido, devolução de adiantamento e saldo zero são distintos. São acertos de controle local, sem transferência bancária nem lançamento automático no ledger AP/AR de faturas. Revisão de permissões tem limite próprio; estes testes funcionais não a substituem.

Ocorrências exigem packageKeys válidas e preservam quantity derivada e histórico OPEN/RESOLVED; não inventam indenização. `outbox_requeue {id,version,reason,mode}` só admite DLQ com efeito comprovadamente ausente, preserva messageId/tentativas e histórico de triagem. UNKNOWN continua exigindo consulta, nunca reenvio direto.

Teste dirigido: `python -m unittest -v test_commercial_delta`. Há gabarito de três paradas (ordem, distância, tempo), capacidade/janela/incompatibilidade, duas substituições de plano com conservação, RFQ até cotação, contraproposta, importação mista, mudanças por fase, contratos de agregado, manutenção e reservas adjacentes, despesas e acertos locais. Rotas são heurística sintética, sem otimização global, trânsito ou divisão automática de um pedido entre várias viagens. Importação é transação local por lote válido escolhido, não streaming externo por linha.
