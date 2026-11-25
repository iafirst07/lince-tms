# Preparação fiscal e conexão futura

O TMS possui agora uma camada de **preparação local**, independente do fornecedor. Ela registra perfis versionados, identifica pendências e valida envelopes de integração. Não emite documentos oficiais, não assina XML e não contém um conector real com a SEFAZ, a ANTT ou um provedor.

Isso permite avançar o produto enquanto emitente, cenário e fornecedor estão indefinidos. A emissão real só pode ser aceita depois de definir esses elementos, implementar o conector correspondente e validar seus retornos no ambiente autorizado. Nenhum percentual de prontidão fiscal é inferido de um checklist preenchido.

## Quem se conecta a quem

| Responsabilidade | Fronteira preparada | Dependência real |
|---|---|---|
| CT-e da prestação de transporte | Perfil do emitente/UF, ambiente e contrato de integração | Emissor, credenciamento, certificado, assinatura, regras e serviços autorizadores aplicáveis |
| MDF-e da operação | Perfil e contrato próprios; operações de consulta, cancelamento e encerramento no envelope local | Aplicabilidade, composição de documentos, regras e autorização/eventos do ambiente competente |
| NF-e de mercadoria já emitida | `NFE_REFERENCE`: somente consulta/referência neste módulo | ERP/OMS ou emissor responsável; este módulo não emite NF-e |
| CIOT | Contrato regulatório separado da emissão fiscal | Enquadramento das partes, integração e instituição habilitada quando aplicável |
| Fornecedor de integração | Rota `PROVIDER`, com referência ao fornecedor e ao contrato | Implementação da API específica, responsabilidade pelo certificado, homologação e retornos |

`DIRECT` e `PROVIDER` são opções de arquitetura preparadas, não conectores implementados. `LOCAL_MOCK` é exclusivamente local. O app do motorista não deve guardar certificado, senha fiscal ou chave privada; ele consome apenas os documentos e estados que a operação autorizada disponibilizar.

## Configuração e estados locais

Implementação: [application/fiscal_readiness.py](application/fiscal_readiness.py).

O perfil tem nome, referência ao emitente, UFs, documentos, ambiente, rota e referências de cenário, esquema, credenciamento, custódia do certificado, catálogo de serviços e retenção. Na rota de fornecedor, acrescenta referências ao fornecedor e ao contrato técnico. São metadados no formato `tipo:identificador`, como `vault:certificado-transportadora`; o módulo não resolve nem recebe o segredo. O formato de referência não é um detector de segredos e não autoriza colocar credenciais em um campo de texto.

- `IMMUTABLE_CONFIGURATION`: configuração gravada; não significa que foi verificada externamente.
- `PENDING_DATA`: faltam campos ou referências para avaliar o contrato local. A resposta discrimina cada pendência e seu motivo; não presume dispensa.
- `LOCAL_CONTRACT_READY`: metadados necessários presentes para o teste local. Referências continuam declaradas, sem confirmação externa.
- `DEMO_PREPARED`: preflight `LOCAL_MOCK`; protocolo local determinístico, `officialDocument=false` e `real=false`.
- `PREPARED_EXTERNAL_BLOCKED`: envelope preparado para rota direta/fornecedor; não foi transmitido. Conector, comprovação externa, homologação e liberação permanecem pendentes.

Todo resultado mantém `productionReady=false`, `realOperationAllowed=false` e `liveTransmissionEnabled=false`, inclusive se o perfil mencionar `PRODUCTION`. Não há botão de ligar emissão real nesta implementação.

Criar uma revisão gera outro ID, com `supersedes` e `profileRevision` incrementada. O perfil anterior, avaliações e envelopes preservam seus snapshots. Só existe um sucessor direto por perfil; uma revisão adicional parte do sucessor atual. A máquina de estados dos documentos fiscais DEMO já existente permanece separada: um preflight não autoriza despacho nem muda um documento para autorizado.

## Comandos de integração

Usam a entrada já existente `POST /api/command`, sessão, CSRF e idempotência da aplicação. Este delta não revalida nem promove as proteções globais.

| Comando | Entrada | Saída persistida |
|---|---|---|
| `fiscal_profile_create` | Perfil completo ou deliberadamente incompleto | `fiscalProfile` imutável, revisão 1 |
| `fiscal_profile_revise` | `id`, `version`, `values` completos e `reason` | Novo `fiscalProfile`, com vínculo ao anterior |
| `fiscal_readiness_assess` | `profileId` | `fiscalReadiness`, snapshot e lista de dados/gates pendentes |
| `fiscal_local_preflight` | `profileId`, `document`, `operation`, `businessReference`, `requestReference` | `fiscalPreflight` com envelope e resultado local/bloqueado |

Documentos aceitos: `CTE`, `MDFE`, `CIOT`, `NFE_REFERENCE`. Operações: `ISSUE`, `QUERY`, `CANCEL`, `CLOSE`; encerramento só para MDF-e/CIOT e referência NF-e só permite consulta. São operações de **contrato local**, não cobertura integral dos eventos oficiais.

Exemplo de perfil sintético:

```json
{
  "name": "Cenário local de estudo",
  "issuerRef": "issuer:empresa-sintetica",
  "ufs": ["SP"],
  "documents": ["CTE", "MDFE"],
  "route": "LOCAL_MOCK",
  "environment": "LOCAL_TEST",
  "scenarioApprovalRef": "review:cenario-local",
  "schemaRefs": {"CTE": "schema:cte-4.00-candidato", "MDFE": "schema:mdfe-3.00b-candidato"}
}
```

As versões no exemplo são referências candidatas; não comprovam quais notas técnicas estarão vigentes no ambiente escolhido. O contrato `FISCAL_PREPARATION_1` inclui perfil/snapshot/revisão, documento, operação, referências de negócio e solicitação, ambiente e rota. O formato é `LOCAL_PREPARATION_ENVELOPE_NOT_OFFICIAL_XML`. O protocolo local não pode ser apresentado como protocolo de órgão público.

## O que falta para emissão real

1. Responsável fiscal/técnico identifica emitente, inscrição/enquadramento, partes, carga, localidades, remuneração e documentos aplicáveis. A UF e o cenário determinam requisitos; não há dispensa automática por última milha ou operação municipal.
2. Escolher integração direta ou fornecedor compatível, fechar contrato, catálogo de serviços/ambientes e responsabilidades de assinatura, custódia e guarda.
3. Implementar o conector real, resolução autorizada das referências de certificado/credencial, XML/JSON oficial, assinatura e regras aplicáveis. O pipeline precisa distinguir preparação, autorização, rejeição, eventos, consulta e efeito desconhecido.
4. Homologar no ambiente autorizado com exemplos e retornos reais pertinentes, inclusive recuperação após resposta perdida; confirmar vigência dos esquemas e regras. Testes locais não produzem esse aceite.
5. Liberar produção por decisão competente, com condições operacionais e revisão de proteções próprias. Configurar o nome `PRODUCTION` não executa essa liberação.

## Fontes públicas abertas em 25/11/2026

- [SEFAZ-SP — credenciamento CT-e](https://portal.fazenda.sp.gov.br/servicos/cte/Paginas/CredenciamentoDescredenciamento-.aspx): informa certificado ICP-Brasil, credenciamento e separação entre testes e produção. É uma referência de SP; não substitui o procedimento da UF do estabelecimento.
- [SEFAZ-SP — serviços CT-e](https://portal.fazenda.sp.gov.br/servicos/cte/Paginas/Webservices.aspx): publica serviços distintos para homologação e produção, incluindo consulta, recepção e eventos. Endereço publicado não comprova disponibilidade ou autorização para usá-lo.
- [SVRS — CT-e, documentos](https://dfe-portal.svrs.rs.gov.br/CTE/Documentos): índice com MOC 4.00 e esquemas/notas técnicas recentes, inclusive itens de 11/11/2026. Foi lido o índice, não integralmente cada manual/regra. A publicação de um item não resolve sozinha sua vigência no cenário.
- [SVRS — MDF-e, FAQ](https://dfe-portal.svrs.rs.gov.br/Mdfe/Faq): descreve credenciamento, certificado e testes para emissão. O FAQ também contém conteúdo histórico; enquadramento e obrigação atual exigem confronto com a norma vigente.
- [SVRS — MDF-e, documentos](https://dfe-portal.svrs.rs.gov.br/MDFE/Documentos): índice de MOC 3.00b, esquemas e notas. Relaciona a NT 2026.001 a CIOT em prestação remunerada por conta de terceiros; não foi auditada integralmente a regra ou implantação.
- [ANTT — CIOT, perguntas frequentes](https://www.gov.br/antt/pt-br/assuntos/cargas/ciot-para-todos-1/perguntas-frequentes): distingue a rota de TAC/equiparado por instituição autorizada e hipóteses de integração por ETC. A preparação deve conservar partes, contrato e enquadramento em vez de assumir uma única rota para todos. A página descreve integração, ambientes e certificado; não prova acesso deste TMS.
- [ANTT — PEF](https://www.gov.br/antt/pt-br/assuntos/cargas/pagamento-eletronico-de-fretes-pef-ciot): contém aviso de que alterações de 2026 estão em implementação e sua plena operacionalização será comunicada. Portanto é necessário reconciliar norma, contrato técnico e implantação efetiva antes de ativar o conector; o FAQ não é prova isolada de disponibilidade.

Registro das consultas, falha na abertura do FAQ nacional CT-e e snapshots públicos com hashes: [fontes.json](VALIDACAO.md). Nenhum serviço fiscal autenticado foi acessado.

## Validação deste delta

Cinco testes funcionais em bancos temporários cobrem dados ausentes, preflight local, fronteiras de operações/documentos, rotas externas bloqueadas, revisão imutável, reabertura, idempotência e validação de metadados. [Resultado do autor](VALIDACAO.md). Não são testes de autorização/isolamento, transmissão real, XML oficial, assinatura, homologação ou regras tributárias completas.

```powershell
python -B -m unittest -v test_fiscal_readiness
```

Executar na pasta `application`, com o Python já disponível. O integrador deve incluir `FiscalReadiness` na composição de `Engine` e a UI pode consumir os quatro comandos. Não é necessária migração destrutiva: o módulo usa o armazenamento de objetos e auditoria/idempotência existentes. Perfis novos podem ser retirados da composição do motor em uma reversão; registros e snapshots devem ser preservados.
