# Lince — referência de comandos

Inventário canônico: **69 comandos com campos e formas conhecidos revisados em fonte; nenhum payload permanece apenas derivado de AST.** Isso não transforma o schema em validação de estado, relação, saldo, calendário, vigência ou autorização. O backend continua responsável por esses requisitos.

Entrada comum: `POST /api/command`, `{command,payload}`, sessão local, CSRF e `Idempotency-Key` estável. Versão inteira deve ser a corrente. Dinheiro de entrada é string decimal; data/hora inclui fuso. Papéis abaixo são declarados no código, não auditoria de segurança concluída.

| Comando | Papéis declarados | Campos documentados | Obrigatórios comuns | Fonte do método |
|---|---|---|---|---|
| `adapter_config_create` | admin | `adapter`, `contractVersion`, `mode`, `name` | `adapter`, `contractVersion`, `mode`, `name` | application/integrations.py:70 |
| `adapter_enqueue` | admin, operator | `adapter`, `configId`, `mode`, `payload` | `adapter`, `payload` | application/integrations.py:80 |
| `aggregate_contract` | admin, planner | `name`, `providerOrg`, `reference`, `validFrom`, `validTo` | `name`, `providerOrg`, `reference`, `validFrom`, `validTo` | application/operations.py:147 |
| `approval_decide` | approver | `decision`, `id`, `version` | `decision`, `id`, `version` | application/finance.py:59 |
| `approval_request` | admin, auditor | `invoiceId`, `version` | `invoiceId`, `version` | application/finance.py:55 |
| `change_resolve` | admin, planner | `id`, `resolution`, `version` | `id`, `version` | application/operations.py:80 |
| `claim_create` | admin, driver, operator | `description`, `packageKeys`, `shipmentId`, `type` | `description`, `packageKeys`, `shipmentId`, `type` | application/operations.py:289 |
| `claim_resolve` | admin, operator | `id`, `resolution`, `version` | `id`, `resolution`, `version` | application/operations.py:294 |
| `counter_accept` | admin, planner | `carrierOrg`, `id`, `version` | `carrierOrg`, `id`, `version` | application/operations.py:228 |
| `dispute_resolve` | admin, auditor | `decision`, `id`, `reason`, `version` | `decision`, `id`, `reason`, `version` | application/finance.py:49 |
| `expense` | admin, operator, planner | `advanceAmount`, `amount`, `category`, `shipmentId` | `amount`, `category`, `shipmentId` | application/operations.py:173 |
| `expense_close` | admin, auditor | `amount`, `id`, `reference`, `version` | `amount`, `id`, `reference`, `version` | application/operations.py:184 |
| `expense_reconcile` | admin, auditor | `approvedAmount`, `id`, `reason`, `version` | `approvedAmount`, `id`, `reason`, `version` | application/operations.py:177 |
| `expire_offers` | admin, planner | Sem parâmetros próprios | Nenhum campo próprio global | application/operations.py:231 |
| `fiscal_cancel` | admin, operator | `id`, `reason`, `version` | `id`, `reason`, `version` | application/integrations.py:187 |
| `fiscal_evaluate` | admin, operator | `configId`, `mode`, `policyId`, `realOperation`, `scenario`, `shipmentId`, `version` | `shipmentId`, `version` | application/integrations.py:178 |
| `fiscal_local_preflight` | admin, operator, planner | `businessReference`, `document`, `operation`, `profileId`, `requestReference` | `businessReference`, `document`, `operation`, `profileId`, `requestReference` | application/fiscal_readiness.py:147 |
| `fiscal_policy` | admin | `mode`, `name`, `requirements`, `scenario` | `mode`, `name`, `requirements`, `scenario` | application/integrations.py:174 |
| `fiscal_profile_create` | admin, planner | `certificateRef`, `contractRef`, `documents`, `endpointCatalogRef`, `environment`, `issuerRef`, `name`, `providerRef`, `registrationRef`, `retentionPolicyRef`, `route`, `scenarioApprovalRef`, `schemaRefs`, `ufs` | `environment`, `name`, `route` | application/fiscal_readiness.py:122 |
| `fiscal_profile_revise` | admin, planner | `id`, `reason`, `values`, `version` | `id`, `reason`, `values`, `version` | application/fiscal_readiness.py:128 |
| `fiscal_readiness_assess` | admin, operator, planner | `profileId` | `profileId` | application/fiscal_readiness.py:139 |
| `fleet_create` | admin, planner | `aggregateContractId`, `capacityKg`, `fleetMode`, `licenseValidTo`, `name`, `type`, `userId` | `name`, `type` | application/operations.py:151 |
| `import_commit` | admin, operator, planner | `id`, `validOnly`, `version` | `id`, `version` | application/operations.py:34 |
| `import_preview` | admin, operator, planner | `rows` | `rows` | application/operations.py:26 |
| `invoice_audit` | admin, auditor | `id`, `toleranceId`, `version` | `id`, `toleranceId`, `version` | application/finance.py:38 |
| `invoice_create` | admin, operator | `amount`, `assignments`, `number` | `amount`, `assignments`, `number` | application/finance.py:31 |
| `label_request` | admin, operator | `configId`, `mode`, `shipmentId`, `version` | `shipmentId`, `version` | application/integrations.py:170 |
| `maintenance` | admin, planner | `end`, `reason`, `resourceId`, `start` | `end`, `reason`, `resourceId`, `start` | application/operations.py:162 |
| `maintenance_finish` | admin, planner | `id`, `reason`, `result`, `version` | `id`, `reason`, `result`, `version` | application/operations.py:167 |
| `master_create` | admin, planner | `kind`, `values` | `kind`, `values` | application/catalog.py:17 |
| `master_update` | admin, planner | `id`, `values`, `version` | `id`, `values`, `version` | application/catalog.py:47 |
| `migration_rollback` | platform_admin | `migrationHash` | `migrationHash` | application/portal.py:115 |
| `offer_respond` | admin, planner | `decision`, `driverId`, `id`, `price`, `reason`, `vehicleId`, `version` | `decision`, `id`, `version` | application/operations.py:219 |
| `offline_sync` | admin, driver, operator | `command`, `context`, `payload` | `command`, `context`, `payload` | application/portal.py:10 |
| `order_change` | admin, planner | `id`, `operation`, `reason`, `values`, `version` | `id`, `operation`, `version` | application/operations.py:47 |
| `order_create` | admin, operator, planner | `candidate`, `consumerCharge`, `externalId`, `locationId`, `packages`, `quoteId`, `windowEnd`, `windowStart` | `consumerCharge`, `externalId`, `locationId`, `packages`, `quoteId`, `windowEnd`, `windowStart` | application/operations.py:24 |
| `order_release` | admin, planner | `id`, `version` | `id`, `version` | application/operations.py:42 |
| `org_create` | platform_admin | `name`, `profile` | `name`, `profile` | application/core.py:198 |
| `outbox_process` | admin, operator | `id`, `version` | `id`, `version` | application/integrations.py:123 |
| `outbox_query` | admin, operator | `id`, `version` | `id`, `version` | application/integrations.py:164 |
| `outbox_requeue` | admin, operator | `id`, `mode`, `reason`, `version` | `id`, `reason`, `version` | application/integrations.py:157 |
| `plan` | admin, planner | `capacityKg`, `orderIds`, `originLocationId`, `speedKmh`, `start` | `orderIds`, `originLocationId`, `start` | application/operations.py:106 |
| `plan_commit` | admin, planner | `id`, `version` | `id`, `version` | application/operations.py:108 |
| `pod` | admin, driver, operator | `fileId`, `occurredAt`, `outcome`, `packageKeys`, `proofId`, `reason`, `shipmentId`, `version` | `occurredAt`, `outcome`, `packageKeys`, `proofId`, `reason`, `shipmentId`, `version` | application/operations.py:271 |
| `quote` | admin, operator, planner | `destinationCep`, `originCep`, `packages`, `side` | `destinationCep`, `originCep`, `packages` | application/catalog.py:105 |
| `rate_create` | admin, planner | `additions`, `base`, `carrierOrg`, `maxKg`, `minKg`, `name`, `perKg`, `priority`, `serviceId`, `side`, `validFrom`, `validTo`, `zoneId` | `base`, `carrierOrg`, `maxKg`, `minKg`, `perKg`, `priority`, `serviceId`, `side`, `validFrom`, `validTo`, `zoneId` | application/catalog.py:52 |
| `rate_publish` | admin, planner | `id`, `version` | `id`, `version` | application/catalog.py:61 |
| `relationship` | admin | `targetOrg` | `targetOrg` | application/core.py:216 |
| `relationship_respond` | admin | `decision`, `id`, `version` | `decision`, `id`, `version` | application/core.py:221 |
| `replan` | admin, planner | `id`, `plan`, `reason`, `version` | `id`, `plan`, `version` | application/operations.py:118 |
| `replan_approve` | admin, planner | `id`, `reason`, `version` | `id`, `reason`, `version` | application/operations.py:123 |
| `return_create` | admin, operator | `packageKeys`, `reason`, `shipmentId` | `packageKeys`, `reason`, `shipmentId` | application/operations.py:297 |
| `return_progress` | admin, driver, operator | `id`, `status`, `version` | `id`, `status`, `version` | application/operations.py:302 |
| `reverse_request` | admin, auditor | `entryId`, `reason` | `entryId`, `reason` | application/finance.py:89 |
| `rfq_bid` | admin, planner | `base`, `id`, `perKg`, `version` | `base`, `id`, `perKg`, `version` | application/operations.py:241 |
| `rfq_create` | admin, planner | `carriers`, `expiresAt`, `name`, `scope` | `carriers`, `expiresAt`, `name`, `scope` | application/operations.py:237 |
| `rfq_select` | admin, planner | `carrierOrg`, `id`, `rate`, `version` | `carrierOrg`, `id`, `rate`, `version` | application/operations.py:244 |
| `scenario_save` | admin, planner | `input`, `name` | `name` | application/portal.py:52 |
| `settlement_request` | admin, auditor | `amount`, `entryId`, `reason` | `amount`, `entryId`, `reason` | application/finance.py:14 |
| `settlement_reverse_request` | admin, auditor | `reason`, `settlementId` | `reason`, `settlementId` | application/finance.py:23 |
| `stage` | admin, driver, operator | `packageKeys`, `shipmentId`, `stage`, `version` | `packageKeys`, `shipmentId`, `stage`, `version` | application/operations.py:253 |
| `subcontract` | admin, planner | `price`, `shipmentId`, `targetOrg`, `version` | `price`, `shipmentId`, `targetOrg`, `version` | application/operations.py:249 |
| `tender` | admin, planner | `carriers`, `expiresAt`, `shipmentId`, `version` | `carriers`, `expiresAt`, `shipmentId`, `version` | application/operations.py:189 |
| `tolerance` | admin, auditor | `fixed`, `name`, `percent` | `fixed`, `name`, `percent` | application/finance.py:29 |
| `tracking` | admin, driver, operator | `eventId`, `occurredAt`, `planVersion`, `shipmentId`, `type` | `eventId`, `occurredAt`, `planVersion`, `shipmentId`, `type` | application/operations.py:263 |
| `upload_pod` | admin, driver, operator | `base64`, `shipmentId` | `base64`, `shipmentId` | application/portal.py:23 |
| `user_create` | admin, platform_admin | `org`, `password`, `roles`, `username` | `password`, `roles`, `username` | application/core.py:202 |
| `user_revoke` | admin, platform_admin | `userId` | `userId` | application/core.py:207 |
| `user_roles` | admin, platform_admin | `roles`, `userId` | `roles`, `userId` | application/core.py:211 |

## Formas variáveis e campos condicionais

- `master_create`: `kind` discrimina zona/calendário/serviço/local; `values` tem schema próprio. `master_update` recebe os valores completos do tipo indicado pelo objeto existente. Endereço tem número/bairro/cidade/UF/orientações opcionais, além dos campos básicos.
- `fleet_create`: `type=VEHICLE` exige capacidade; `type=DRIVER` exige validade de habilitação e pode vincular `userId`. `fleetMode=AGGREGATE` exige `aggregateContractId`; omitir fleetMode conserva OWN.
- `adapter_enqueue`: oneOf para OMS (`order`), WMS (`shipmentId/custody`), ERP (`entryIds/reference`) ou MAPS (`locations` com2–100coordenadas). CARRIER/FISCAL usam workflows dedicados. A UI converte escolhas de locais em coordenadas e formulários OMS em payload.order; a API não recebe os campos planos da UI.
- `order_change`: `CANCEL` não exige values. `EDIT` aplicado exige nova cotação, volumes, cobrança, local e janela; após contratação cria proposta; após execução pode apenas registrar compensação. `reason` é obrigatório nos estados contratados/executados, não em todos os estados.
- `change_resolve`: resolution é exigida na compensação pós-execução; uma proposta anterior aplica seus valores guardados. O schema não finge conhecer o estado só pelo ID.
- `replan`: pedidos/volumes são obtidos da remessa; orderIds adicional não muda essa origem. plan tem origem/início e capacidade/velocidade opcionais. reason é exigido para proposta de remessa ASSIGNED. `replan_approve` exige motivo e conferência de versão/viabilidade.
- `rfq_select.rate`: a proposta escolhida fornece carrierOrg/base/perKg; demais campos configuram rascunho de tarifa. Publicar é outra ação.
- `offer_respond`: ACCEPT/COUNTER exigem veículo/motorista; COUNTER também preço; REJECT motivo. O schema documenta os ramos sem representar disponibilidade/reserva real.
- Baixas e estornos: `settlement_request` usa entryId/amount/reason; `settlement_reverse_request` usa settlementId/reason; `reverse_request` usa entryId/reason. Saldo, duplicação, compensação prévia e aprovação distinta continuam no domínio. Nenhum comando transfere dinheiro.

## Campos conhecidos deliberadamente sem tipo mais estreito

`scenario_save.input` armazena qualquer JSON no contrato atual; a UI oferece objeto de cotação, mas isso não é obrigação inventada pelo schema. `ERP.payload.reference` também é preservado sem imposição de tipo pelo backend; os exemplos/UI usam texto. Esses pontos são comportamento conhecido, não payload desconhecido nem certificação de semântica.

## Fontes e alcance

Cada entrada do OpenAPI inclui `schemaSources`, `uiSources` e `testSourcesRead`, com caminhos relativos e linhas da versão inventariada. Leitura de um teste não significa que ele foi executado nesta revisão. O contrato tem exemplos sintéticos de forma; IDs ilustrativos precisam ser substituídos pelos IDs obtidos na instância. O tutorial executável em [API-SIMULACAO.md](API-SIMULACAO.md) já faz essa recuperação.

`receive_callback` segue método interno no Python; a inbox HTTP pública pertence ao Worker de simulação. A referência não transforma os cabeçalhos de workspace/persona em autenticação real nem presume paridade entre variantes. [Contrato canônico](application/openapi.json), documentação em `/docs/`, preparação fiscal em [FISCAL-INTEGRACAO.md](FISCAL-INTEGRACAO.md).
