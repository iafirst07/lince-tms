# Primeira jornada de e commerce e última milha

Versão 0.2, desenho original. Recorte Brasil confirmado por Rafael, decisão do autor do projeto. Dois perfis separados. Regras numéricas a seguir são políticas sintéticas do protótipo, não tarifas de mercado nem normas fiscais. Nenhum dado de cliente real será usado.

## Jornada funcional e propriedade

Embarcador simula checkout por CEP e pacotes → compara serviço/prazo/custo → registra frete cobrado ao consumidor sob política comercial própria → cria pedido OMS fictício → libera → planeja/gera embarque → oferta ao transportador relacionado. Transportador aceita com reserva → solicita etiqueta simulada → coleta/despacha sob política fiscal fictícia → registra tentativa e entrega parcial/completa. Embarcador acompanha visão autorizada, prepara comunicação sem envio, audita fatura e abre reversa quando necessário.

OMS é origem do pedido; WMS informa volumes prontos, sem criar estoque no TMS. ERP recebe obrigações por adaptador, sem efetivar pagamento. O protótipo simula todas essas fronteiras localmente. Nenhum checkout real, Correios, transportadora ou mensageria será conectado.

| RF | Módulos | Regra candidata e aceite | Teste |
|---|---|---|---|
| RF17 | M02/M04 | Normalizar CEP para oito dígitos; validar cobertura/serviço/medidas e distinguir timeout, indisponível e sem cobertura | T25,T26 |
| RF18 | M03/M04 | Promessa usa calendário/fuso/cutoff/capacidade; quote expira e vincula snapshot | T27 |
| RF19 | M04/M05/M10 | Custo de transporte, cobrança do consumidor e subsídio comercial separados; split não duplica cobrança | T28 |
| RF20 | M05/M06/M08 | Package único com medidas próprias e rastreabilidade; totais de linhas reconciliados com pacotes | T29 |
| RF21 | M08/M12/M15 | Etiqueta/despacho pelo adaptador simulado; UNKNOWN sem reemissão cega | T30 |
| RF22 | M09/M14 | Tentativa com resultado/motivo; insucesso, reentrega, parcial e completa por pacote | T31 |
| RF23 | M09/M11 | Reversa autorizada aponta pacote entregue, quantidade e motivo; custos próprios sem apagar ida | T32 |
| RF24 | M09/M15 | Eventos preparam intenção de comunicação, sem envio; OMS/WMS/ERP são fronteiras separadas | T26,T31 |

Origem RF17–RF24: decisão humana de recorte mais desenho original (PROP). Nenhuma atribuição de comportamento detalhado aos fornecedores. Rastreabilidade principal RF01–RF16 permanece em FONTES-E-COMPARACAO.md.

## Políticas fechadas para a fatia sintética local

Organizações fictícias E e T, relação ativa rel-et. Sessão de demonstração escolhe papel E operador ou T operador: isso NÃO é autenticação produtiva. Toda operação de domínio, leitura direta e projeção pública da demo aplica a relação e o papel; teste inclui organização X sem relação. Bind somente 127.0.0.1. SQLite isolado no diretório runtime do produto e Python stdlib são escolha reversível local, não decisão de stack de produção.

Contrato demo road-demo v1: custo de compra BRL 10.00 + BRL 2.00 por kg total, HALF_UP em duas casas; pesos/medidas positivos; máximo 30 kg por pacote e 100 kg por embarque; CEP destino normalizado entre 01000000 e 05999999, origem válida sintaticamente. Serviço sem cobertura retorna NO_COVERAGE; contrato inválido INELIGIBLE; adaptador simulado lento TIMEOUT; manutenção UNAVAILABLE. Nenhum desses vira preço zero.

Calendário demo: segunda a sexta, sem feriados cadastrados, timezone America/Sao_Paulo, cutoff 14:00 exclusivo (às 14h já próximo dia útil), coleta no dia elegível e entrega em dois dias úteis após coleta. Tempo injetável nos testes; produção requer calendário real e política validada. Validade da cotação: 15 minutos. Limites e promessa constam do snapshot; alteração de CEP, pacote, serviço ou versão comercial exige nova cotação.

Política de cobrança ao consumidor: FIXED com valor não negativo explicitamente escolhido pelo embarcador, uma única cobrança lógica por pedido. Valor zero representa benefício comercial deliberado, nunca fallback de cotação. Subsídio estimado = custo de compra menos valor cobrado; se negativo há excedente comercial, sem alegar lucro líquido. Transportador vê preço da contratação, não política de checkout nem subsídio. Ao dividir pacote/embarque, custo analítico pode ser rateado, mas a cobrança do consumidor não é reemitida. Protótipo inicial não divide fisicamente um pacote; distribui pacotes indivisíveis.

Uma fatura por assignment no protótipo; tolerância demo 0.00. Divergência abre disputa. Auditoria não paga. Insucesso preserva tentativa; reentrega manual autorizada gera nova tentativa sem cobrança automática. POD contém pacote/quantidade; duplicata não duplica realizado. Reversa só para pacote entregue autorizado, um retorno ativo por pacote; mantém ida e gera movimento reverso separado, sem reembolso automático.

## Complementos mínimos de comando

Convenções de autorização, idempotência, erros e versão em API.md aplicam-se abaixo. Este recorte fecha os comandos antes de código, mas não certifica contrato de produção. IDs são fictícios, dados de endereço/contato pessoal ficam ausentes.

| Comando | Entrada obrigatória mínima | Guarda e saída |
|---|---|---|
| POST /v1/checkout-quotes | originPostalCode, destinationPostalCode, serviceId, packages[{id,weightKg,lengthCm,widthCm,heightCm}], pricingAt | Validar CEP/medidas/calendário/capacidade; 201 quoteId, custo, promessa, validade, snapshot; 422 sem cobertura/ineligível; 503 timeout/indisponível distintos |
| POST /v1/ecommerce-orders | externalId, checkoutQuoteId, packages, customerFreightCharge{policy:FIXED,amount,currency:BRL} | Snapshot/pacotes iguais ao quote vigente, uma cobrança por pedido, referências pertencem a E; 201 pedido version1; duplicata não cria cobrança |
| POST /v1/transport-orders/{id}/release | expectedVersion | VALIDATED e snapshot vigente; 200 RELEASED version+1, mesmo contentVersion |
| POST /v1/planning-runs/{id}/commit | expectedPlanVersion | Run SUCCEEDED, pedidos/contentSnapshots atuais, quantidades conservadas; 201 shipmentId e etapas; replay retorna mesmos IDs |
| POST /v1/shipments/{id}/label-requests | expectedVersion, adapter:DEMO | Assignment válido e snapshot; 202 requestId/status; UNKNOWN bloqueia nova emissão até consulta/reconciliação simulada |
| POST /v1/shipments/{id}/dispatch | expectedVersion, regulatoryPolicy:DEMO_NOT_REAL | Award, reserva e etiqueta simulada READY; 200 IN_TRANSIT; documento obrigatório simulado ausente/UNKNOWN bloqueia |
| POST /v1/shipments/{id}/attempts | attemptId, packageIds, occurredAt, outcome:FAILED/DELIVERED, reason quando FAILED | T designado, pacotes da etapa; FAILED gera tentativa e intenção de comunicação; DELIVERED exige prova textual fictícia e atualiza parcial/completa, sem apagar tentativas |
| POST /v1/returns | orderId, packageIds, reason | E dono ou T com autorização explícita; só entregue e sem retorno ativo; 201 returnId/status AUTHORIZED; duplicata não duplica reversa |
| GET /v1/label-requests/{id} | id na URL | Consulta estado sem reemitir; status UNKNOWN permanece até resolução simulada explícita |

Protótipo pode implementar caminho síncrono interno de planejamento se responder com estado honesto e conservar as mesmas guardas; não fingir fila externa. Os caminhos mínimos concretos e schemas de UI devem constar no README do protótipo, com mapeamento aos contratos candidatos, caso o adapter local use endpoints de comando genéricos.

## Oito testes adicionais planejados

| ID | RF | Entrada | Resultado esperado | Estado |
|---|---|---|---|---|
| T25 | RF17 | CEP com hífen/zeros; inválido; bem formado fora cobertura | Normalizar sem perder zeros; inválido rejeitado; NO_COVERAGE distinto | PLANEJADO |
| T26 | RF17/RF24 | Adaptador TIMEOUT, UNAVAILABLE e NO_COVERAGE | Resultados distintos, sem preço zero, sem notificação enviada | PLANEJADO |
| T27 | RF18 | Sexta 13:59/14:00; fim de semana; quote expirado ou snapshot alterado | Datas úteis conforme cutoff; recotar ao expirar/mudar; promessa versionada | PLANEJADO |
| T28 | RF19 | Custo 30.00, cobrança 5.00; replay; dois embarques de um pedido | Uma cobrança 5.00, subsídio 25.00; transportador sem acesso ao checkout; sem duplicação no split | PLANEJADO |
| T29 | RF20 | Pacotes P1/P2; pacote repetido, faltante ou acima do limite | Soma conservada e IDs únicos; não duplicar carga/cobrança; limites bloqueiam | PLANEJADO |
| T30 | RF21 | Timeout depois da etiqueta aceita e tentativa de reemissão | UNKNOWN bloqueia retry; consulta recupera único protocolo; nenhuma emissão real | PLANEJADO |
| T31 | RF22/RF24 | Falha P1, entrega P2, reentrega P1 e replay | PARTIAL depois COMPLETE, tentativas preservadas, evento/intenção uma vez; sem envio | PLANEJADO |
| T32 | RF23 | Reversa pacote entregue, repetição e pacote não entregue | Uma reversa ativa autorizada; não entregue rejeitado; ida/cobrança preservadas | PLANEJADO |

O protótipo executará o subconjunto implementado e registrará testes reais por nome/assertiva. Estado PLANEJADO deste catálogo só muda com mapeamento e evidência suficiente; uma suíte pequena não promove automaticamente todos os 32 cenários.
