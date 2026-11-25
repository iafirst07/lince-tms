# Produto e requisitos do TMS independente

Versão 0.2. Desenho candidato original. Decisões humanas: dois perfis com módulos separados; primeiro recorte Brasil, entregas de e-commerce e última milha. O problema a validar é a fragmentação entre promessa no checkout, contratação, execução e conferência do frete; ainda não há entrevistas, baseline ou benefício medido. ECOMMERCE.md detalha a primeira jornada e os requisitos RF17–RF24, distribuídos pelos 16 módulos existentes.

## Resultado e públicos

Resultado desejado para o primeiro protótipo: completar uma viagem sintética desde o pedido até a auditoria, com colaboração entre embarcador e transportador sem exposição indevida de tarifas e documentos. Embarcador controla demanda, compra de frete, acompanhamento e auditoria. Transportador controla oferta, capacidade, execução, preço de venda e acerto. Uma organização pode ter ambos os perfis, mas o perfil não concede acesso a outro tenant nem revela automaticamente preços de compra e venda.

Papéis candidatos: administrador da organização, planejador, comprador de frete, operador de transporte, motorista, auditor e aprovador financeiro. Motorista vê somente viagens designadas e dados necessários; auditor não altera tarifas; aprovador não aprova a própria divergência sem política explícita. A configuração de segregação será fechada antes da produção.

## Módulos e aceites propostos

E = embarcador; T = transportador; A = ambos. Ondas são propostas, não compromissos de entrega. Núcleo compartilhado significa código comum, não dados compartilhados sem permissão.

| Módulo e RF | Perfil e onda | Comportamento e aceite positivo | Restrição e aceite negativo |
|---|---|---|---|
| M01 RF01 Identidade e auditoria | A, 1 | Autorizar usuário por organização, papel e objeto; registrar autoria e mudanças | Negar outro tenant também em exportação, cache, job e POD |
| M02 RF02 Cadastros e rede | A, 1–2 | Versionar locais, zonas, rotas, serviços, unidades e calendários | Recusar unidade desconhecida, zona ambígua ou janela inválida |
| M03 RF03 Contratos e tabelas | E compra; T venda, 1–2 | Selecionar tabela ativa por vigência, cobertura, serviço e capacidade | Não usar contrato expirado nem sobrepor regras sem precedência explícita |
| M04 RF04 Cotação | A, 1 | Expor componentes, moeda, versão, validade, restrições e memória de cálculo | Sem candidato retorna motivo; nunca preço zero como fallback |
| M05 RF05 Pedidos e unidades | E cria; T recebe, 1 | Importar demanda e conservar quantidades distribuídas entre embarques | Replay não duplica; alteração concorrente falha com conflito |
| M06 RF06 Planejamento | A, 1 básico; 3 otimização | Formar plano com carga, capacidade, janelas e incompatibilidades atendidas | Inviável não é liberado; split somente permitido; replanejamento cria versão |
| M07 RF07 Contratação | E oferece; T responde, 1; RFQ 4 | Uma oferta de viagem aceita gera contratação e reserva atômicas | Dois aceites não criam duas atribuições; RFQ plurianual não é aceite de viagem |
| M08 RF08 Execução | T executa; E acompanha, 1–2 | Coleta, transferência, redespacho, crossdock e entrega por etapa | Despacho bloqueia quando pré-requisito aplicável não está atendido |
| M09 RF09 Tracking e ocorrências | A, 1 básico; 2–3 completo | Vincular POD à etapa, tratar avaria, sinistro, recusa e reversa | Evento atrasado não regride estado; compensação preserva histórico |
| M10 RF10 Auditoria e rateio | E audita; T contesta, 1–2 | Comparar fatura, contratação e realizado; rateio conserva total | Divergência acima da tolerância abre disputa e impede aprovação automática |
| M11 RF11 Faturamento e acerto | T fatura; E aprova, 1 simulado; 2 integração | Separar contas a pagar/receber e despesas; reconciliar retorno do ERP | Timeout não significa falha nem sucesso; não repetir pagamento desconhecido |
| M12 RF12 Fiscal e regulatório | T conforme papel legal; E consulta permitido, 2 | Adaptador avalia documentos exigidos por cenário e mantém protocolo | Não inventar dispensa/obrigatoriedade; cenário sem regra validada não opera em produção |
| M13 RF13 Frota e parceiros | T, 2 básico; 3 completo | Reservar veículo/motorista, manutenção, agregados, despesas e subcontratação | Veículo indisponível ou reserva conflitante não é alocado |
| M14 RF14 Portais e mobile | A, 1 portal mínimo; 3 offline | Compartilhar visão autorizada e sincronizar prova com identidade de origem | Link não concede acesso amplo; sincronização repetida não duplica POD |
| M15 RF15 Integrações | A, 1 | Inbox/outbox, deduplicação, correlação, assinatura e recuperação observável | Callback inválido, arquivo malicioso e fórmula CSV não são promovidos |
| M16 RF16 Simulação e indicadores | A, 1 instrumentação; 4 avançado | Simular cenário sem mudar operação; explicar proposta de IA antes de ação | Simulação/IA não contrata nem paga autonomamente; dado incompleto não vira ganho |

## Jornadas de referência

Embarcador: importar pedido → validar locais/unidades → selecionar contratos elegíveis → cotar → planejar carga → ofertar viagem → receber aceite → acompanhar etapas e ocorrências → conferir POD → auditar fatura → aprovar ou contestar → encaminhar ao ERP e reconciliar. Rejeição de oferta permite nova rodada; não duplica reserva. Mudança após contratação precisa análise de impacto e nova versão antes de nova oferta.

Transportador: receber oferta autorizada → conferir capacidade, preço de venda e custo estimado interno → aceitar → reservar → programar coleta/carga/viagem → validar requisitos fiscais aplicáveis → despachar → registrar eventos/POD ou ocorrência → faturar → tratar disputa → reconciliar acerto. Se subcontratar, contrato e acesso do terceiro são explícitos; o embarcador não passa a ver automaticamente a margem interna.

Caso sintético comum: organização E solicita 10 volumes de 100 kg totais entre dois locais fictícios, janela de entrega definida, contrato de compra BRL vigente. Organização T aceita uma oferta de BRL 150,00 e registra custo interno estimado de BRL 100,00. O sistema mostra ao embarcador apenas BRL 150,00; a diferença de BRL 50,00 é resultado estimado antes de despesas adicionais, não lucro líquido. Uma entrega parcial de 6 volumes mantém 4 pendentes; o POD não encerra os 10. Quantidade recebida, avariada e recusada é explícita.

Lotação: viagem dedicada, restrição de exclusividade. Fracionada: unidades de diferentes pedidos e etapas de hub com conservação de quantidades. Parcel: volume identificado individualmente e tentativas de entrega. Essas três variantes são alvo de requisitos; nenhuma está homologada. Multimodal exigirá documentos, etapas e restrições próprias por modal e país.

## Regras transversais

RFQ estratégico compara propostas para período/rotas e produz contrato versionado; contratação de viagem usa instância de demanda e prazo de aceite. Calendários consideram fuso de cada local. Reserva tem intervalo e expiração; aceitação e expiração concorrentes são serializadas. Custos internos, cobrança ao cliente, compra de frete e rateio analítico são valores diferentes.

Alterar pedido antes da oferta recalcula dependências. Depois da aceitação, suspender alteração silenciosa e gerar proposta de mudança com impacto em carga, reserva e preço. Após início de execução, registrar compensação/ocorrência; não apagar embarque nem reciclar comprovante. Cancelamento financeiro e cancelamento logístico usam comandos próprios.

## Métricas candidatas

Cotação válida = respostas elegíveis / solicitações válidas; erro de cálculo = resultados divergentes do oráculo / casos auditados; SLA entrega = entregas no prazo / entregas com prazo conhecido; divergência = faturas contestadas / auditadas; km vazio = km sem carga / km operado; ocupação medida separadamente em peso e volume. Medir também tempo de resolução, efeitos duplicados, p95 por operação, consumo do solver e recuperação de incidentes. Excluir dados ausentes do denominador e informar cobertura. Metas, volume alvo, baseline, RPO e RTO ainda serão definidos; nenhum ganho foi observado.

## Pendências de produto

Segmento e país estão decididos: e-commerce/última milha, Brasil. Rafael ainda define cidades, cargas e restrições comerciais do piloto antes de produção. Owner técnico fecha stack, escala, papéis e contratos de integração. Especialista fiscal a designar valida aplicabilidade antes de operação Brasil. Não há prazo/custo prometido sem equipe, volume e integrações definidos. A fila e condições de retomada ficam em project-state.md.
