# Lince — roteiro da API de simulação

Este contrato descreve o **backend Python canônico local**. Desktop e PWA do motorista usam a mesma sessão, projeções, comandos e persistência. A demonstração pública Worker é um ambiente separado de laboratório, com dados fictícios; sua existência não comprova paridade integral com os comandos locais, homologação fiscal ou segurança produtiva.

Documentação navegável: `/docs/`. Contrato: `/docs/openapi.json`, também em [application/openapi.json](application/openapi.json). Inventário completo: [REFERENCIA-COMANDOS.md](REFERENCIA-COMANDOS.md). Os campos e formas conhecidos dos 69 comandos foram revisados em métodos, helpers, UI e testes. Não há payload somente derivado de AST; as regras dependentes de estado/referências continuam explicitamente no domínio.

## Duas variantes, contratos distintos

| Aspecto | Python canônico local | Demonstração pública Worker |
|---|---|---|
| Identidade de acesso | Cookie de sessão e CSRF, com contas locais | `X-Lince-Workspace` identifica um UUID de laboratório compartilhável; `X-Lince-Persona` escolhe uma persona fictícia |
| Autenticação | Login local com senha aleatória da instância | **Não há autenticação real**; persona/workspace não são mecanismos de segurança produtiva |
| Persistência | SQLite e banco de protocolos mock no diretório da instância | D1 e dados fictícios do ambiente próprio de demonstração |
| Navegação | Mesma origem local para desktop/PWA | `/demo-context.js`, servido pela própria origem antes dos scripts, acompanha o contexto compartilhável entre páginas |
| Rotas adicionais da variante | Não possui `/api/personas` ou `/api/inbox` HTTP | `/api/personas` lista personas sintéticas; `/api/inbox` recebe ações simuladas do laboratório, conforme o contrato público |
| Alcance | Comandos inventariados nesta referência | Consultar o OpenAPI e o suporte efetivo da versão pública; não presumir equivalência integral aos comandos Python |

O OpenAPI versionado em `application/openapi.json` continua descrevendo cookie/CSRF do Python. A publicação gera uma cópia específica para a variante Worker, com seus cabeçalhos; ela não deve ser usada para afirmar que o servidor Python aceita esses cabeçalhos. O contexto público é compartilhável e não contém uma credencial: use apenas dados fictícios, sem dados pessoais ou corporativos. Trocar uma persona não representa assumir a identidade de uma pessoa real.

O recebimento `/api/inbox` da demonstração pública não é webhook homologado de transportadora/ERP, nem integração com governo. Essa rota não foi acrescentada ao `server.py` Python pelo simples fato de existir no Worker. Os exemplos executáveis abaixo continuam exclusivos do laboratório Python local.

## Preparar uma instância nova

Requer Python e Pillow conforme [application/README.md](application/README.md), sem instalar dependências por este roteiro. Execute a partir de `application`:

```powershell
python -B server.py --db runtime-lince-demo/application.sqlite --init-simulation
python -B server.py --db runtime-lince-demo/application.sqlite --port 8767
```

O diretório deve ser novo: não repetir o inicializador em um banco já populado nem reutilizar `mock.sqlite` de outra demonstração. O CLI grava as senhas aleatórias em `runtime-lince-demo/first-access.json`, arquivo privado local que não deve entrar no repositório, nos logs públicos ou em uma URL estática. Não há senha padrão. Se já existir um servidor nessa porta, escolher outra porta livre e o mesmo endereço nos exemplos; não interromper outro processo por inferência.

Abrir `http://127.0.0.1:8767/` para desktop, `/driver/` para motorista e `/docs/` para este contrato. O endereço loopback só aponta para a máquina em que o navegador está aberto. Para usar outro notebook, rodar uma cópia local ou acessar uma hospedagem própria preparada para esse ambiente; não expor diretamente o servidor de laboratório como se estivesse homologado.

## Rotas reais

| Método e rota | Contrato |
|---|---|
| `POST /api/login` | `username` e `password`; retorna usuário/CSRF e cookie de sessão HttpOnly |
| `GET /api/session` | Sessão atual e CSRF; não retorna senha |
| `POST /api/logout` | Revoga sessão e limpa cookie; exige CSRF |
| `GET /api/state` | Objetos, organizações, usuários e comandos da projeção atual |
| `GET /api/state?id=...` | Um objeto visível ao usuário atual |
| `GET /api/simulation` | Manifesto de simulação visível ao ator; não habilita operações reais |
| `GET /api/kpis` | Indicadores, cobertura, denominadores, IDs e assistência determinística |
| `POST /api/command` | Envelope `{command,payload}`, sessão, CSRF e `Idempotency-Key` |
| `POST /api/simulate` | Entrada de cotação para comparação sem escrita operacional; exige sessão/CSRF |
| `GET /api/file?id=...` | Imagem de comprovante validada e autorizada, servida como attachment |
| `POST /api/backup` | ZIP privado consistente; administrador da plataforma, sessão e CSRF |

`/`, `/driver/`, `/docs/` e o contrato JSON são recursos estáticos públicos do servidor local. Os demais assets estão inventariados em `x-static-resources` no OpenAPI. Não há endpoint REST de callback/webhook genérico no `server.py` canônico desta versão.

## Sessão, versões, idempotência e erros

O backend local aceita sua origem loopback; uma requisição de outra origem não é uma forma de publicar o serviço. O cookie de sessão permanece no cliente. Escritas autenticadas exigem o `X-CSRF-Token` da sessão atual. Não copiar cookie, senha ou CSRF para exemplos públicos.

Cada comando usa uma chave de idempotência estável por usuário/comando/solicitação. Repetir exatamente a mesma solicitação não deve produzir uma segunda operação; payload diferente com a mesma chave conflita. O fluxo de outbox pode devolver o estado reconciliado corrente. A chave não dispensa consulta quando um efeito anterior é desconhecido.

Objetos versionados têm `version` inteira. Use a versão lida, não um incremento presumido. Uma resposta `VERSION_CONFLICT` exige reler e decidir sobre o conflito, preservando a intenção. A fila do motorista também conserva `planVersion`, `assignmentId` e as chaves de todos os volumes do embarque; outro POD no mesmo contexto pode ser reconciliado, mas alteração do contexto não deve ser escondida.

Erros seguem `{ "error": { "code": "...", "message": "..." } }`. Classes principais: `400` envelope/JSON inválido; `401` sessão ausente/inválida; `403` requisito/ação não permitida; `404` objeto/comando não encontrado no escopo; `409` conflito de versão/idempotência/estado/efeito; `422` validação de domínio; `429` bloqueio temporário de login; `500` falha interna com efeito não confirmado. O código específico orienta a retomada; não converter qualquer erro em ausência de efeito.

Os papéis declarados e os schemas documentam o contrato, mas não substituem revisão de permissões. A categoria de validação anteriormente bloqueada permanece separada; este roteiro não foi usado para repeti-la.

## Exemplo progressivo executável, somente local

O roteiro abaixo usa apenas a biblioteca padrão do Python. Copie para um arquivo local fora da publicação e execute contra uma instância recém-inicializada. Ele pede as senhas sem exibi-las. Primeiro entre como administrador da massa; no segundo login, use o motorista dedicado. Os comandos criam um novo pedido/perfil fiscal e registram comprovantes **na massa fictícia**. Não executar em ambiente operacional.

O exemplo consulta o manifesto e usa IDs devolvidos pela própria instância; nenhum ID fixo de banco ou credencial é publicado. O último percurso demonstra o contrato de `offline_sync` com rede disponível; não substitui o teste de IndexedDB, service worker ou queda de rede no navegador.

```python
import getpass
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPCookieProcessor

BASE = os.environ.get("LINCE_BASE_URL", "http://127.0.0.1:8767").rstrip("/")
assert urlsplit(BASE).hostname in {"127.0.0.1", "localhost"}, "Exemplo exclusivo para laboratório local"
client = build_opener(HTTPCookieProcessor(CookieJar()))
csrf = None

def request(path, payload=None, key=None):
    headers = {"Accept": "application/json"}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
        if csrf:
            headers["X-CSRF-Token"] = csrf
    if key:
        headers["Idempotency-Key"] = key
    with client.open(Request(BASE + path, data=body, headers=headers), timeout=20) as response:
        return json.load(response)

def login(label):
    global csrf
    print(label)
    username = input("Usuário local: ")
    password = getpass.getpass("Senha local: ")
    result = request("/api/login", {"username": username, "password": password})
    csrf = result["csrf"]
    return result["user"]

def command(name, payload, stable_key=None):
    return request("/api/command", {"command": name, "payload": payload}, stable_key or uuid.uuid4().hex)

admin = login("1. Administrador da instância sintética")
simulation = request("/api/simulation")
assert simulation["enabled"], "Inicialize uma instância de simulação visível ao administrador"
manifest = simulation["manifest"]
assert manifest["dataClassification"] == "FICTITIOUS_PET_ECOMMERCE_ONLY"
state = request("/api/state")
print("Objetos visíveis:", len(state["objects"]), "Cenários:", len(manifest["scenarios"]))

# Cotação multicarrier e comparação sem escrever operação.
packs = [{"id": "API-V1", "weightKg": "2", "lengthCm": "25", "widthCm": "18", "heightCm": "15"}]
quote_input = {"originCep": "01001000", "destinationCep": "01310100", "packages": packs}
comparison = request("/api/simulate", quote_input)
assert comparison["automaticAction"] is False
quote = command("quote", quote_input)
destination = command("master_create", {"kind": "location", "values": {
    "name": "Destino pet sintético da API", "postalCode": "01310100",
    "lat": -23.555, "lon": -46.645, "addressLine": "Rua Exemplo Pet",
    "number": "100", "district": "Demonstração", "city": "São Paulo", "uf": "SP",
    "deliveryInstructions": "Endereço fictício; não realizar entrega real"
}})
start = datetime.now(timezone.utc) + timedelta(hours=1)
order = command("order_create", {"externalId": "LINCE-API-" + uuid.uuid4().hex[:10],
    "quoteId": quote["id"], "candidate": 0, "packages": packs, "consumerCharge": "5.40",
    "locationId": destination["id"], "windowStart": start.isoformat(),
    "windowEnd": (start + timedelta(hours=3)).isoformat()})
released = command("order_release", {"id": order["id"], "version": order["version"]})
print("Pedido local:", released["status"])

# Fiscal: metadados e envelope locais, sem certificado ou transmissão.
profile = command("fiscal_profile_create", {"name": "Perfil local da API",
    "issuerRef": "issuer:lince-synthetic", "ufs": ["SP"], "documents": ["CTE", "MDFE"],
    "route": "LOCAL_MOCK", "environment": "LOCAL_TEST",
    "scenarioApprovalRef": "review:scenario-synthetic",
    "schemaRefs": {"CTE": "schema:cte-candidate", "MDFE": "schema:mdfe-candidate"}})
checklist = command("fiscal_readiness_assess", {"profileId": profile["id"]})
assert checklist["productionReady"] is False
preflight = command("fiscal_local_preflight", {"profileId": profile["id"], "document": "CTE",
    "operation": "ISSUE", "businessReference": order["externalId"],
    "requestReference": "API-PREFLIGHT-" + uuid.uuid4().hex[:10]})
assert preflight["status"] == "DEMO_PREPARED" and preflight["realOperationAllowed"] is False
print("Preparação fiscal:", checklist["status"], preflight["status"])

# Guardar somente o ID do cenário sintético para a próxima sessão.
driver_trip_id = next(x["shipmentId"] for x in manifest["scenarios"] if x["id"] == "DRIVER_READY_DELIVERY")
request("/api/logout", {})
csrf = None
driver = login("2. Motorista dedicado da massa: lince.motorista")
driver_state = request("/api/state")
trip = next(x for x in driver_state["objects"] if x["id"] == driver_trip_id)
assert trip["driverUserId"] == driver["id"] and trip["stage"] == "DELIVERY"
remaining = [p["key"] for p in trip["packages"] if p["key"] not in trip["delivered"]]
assert remaining, "Use a instância nova ou outra viagem ainda não concluída"
context = {"planVersion": trip["planVersion"], "assignmentId": trip["assignmentId"],
           "packageKeys": [p["key"] for p in trip["packages"]]}
chunks = [remaining[:1], remaining[1:]] if len(remaining) > 1 else [remaining]
for keys in chunks:
    # O payload e sua chave precisam sobreviver intactos a uma resposta perdida.
    proof_id = "API-POD-" + uuid.uuid4().hex
    payload = {"shipmentId": trip["id"], "version": trip["version"], "proofId": proof_id,
        "packageKeys": keys, "outcome": "DELIVERED", "reason": "Teste sintético da API",
        "occurredAt": datetime.now(timezone.utc).isoformat()}
    envelope = {"command": "pod", "payload": payload, "context": context}
    stable_key = uuid.uuid4().hex
    proof = command("offline_sync", envelope, stable_key)
    assert command("offline_sync", envelope, stable_key)["id"] == proof["id"]
finished = request("/api/state?id=" + trip["id"])
print("Viagem local:", finished["status"], "Volumes:", len(finished["delivered"]))
request("/api/logout", {})
csrf = None
```

Se ocorrer erro de rede depois do envio, o exemplo síncrono não tem uma fila durável própria. Não gerar nova chave/prova para “tentar de novo”: preservar o envelope e reconciliar pelo mesmo contrato. A PWA implementa esse armazenamento antes do envio; o tutorial apenas demonstra a API.

## Modelos e camadas

| Camada | Modelos e responsabilidades |
|---|---|
| Interface | Desktop, PWA, documentação; não decide validade fiscal nem confirmação de efeito remoto |
| Sessão/projeção | Usuário, organização, papéis e visão autorizada; não publicar credenciais ou afirmar auditoria de segurança concluída |
| Catálogo | Local/endereços, zona, calendário, serviço e tarifa publicada/versionada |
| Comercial | Cotação com snapshot/validade, pedido/volumes e alterações com histórico |
| Movimento | Plano, paradas/destinos snapshot, remessa, oferta, atribuição, reservas e custódia |
| Execução | Tracking causal, tentativa/POD e imagem, ocorrência e reversa |
| Financeiro | Fatura, tolerância, disputa, aprovação, AP/AR, baixa/compensação/estorno e despesas locais |
| Fiscal | Política/documento DEMO separados de perfil de preparação, checklist e preflight |
| Integração | Configuração local, outbox, inbox, protocolos mock, reconciliação e DLQ |
| Recuperação/observação | Audit trail, idempotência, backup/restore retomável, indicadores com cobertura e cenários sem escrita |

## Ativo e passivo, sem efeito real

A outbox persiste a intenção e o claim antes de enviar ao mock HTTP. `UNKNOWN` conserva a incerteza e exige `outbox_query`; `DLQ` só permite `outbox_requeue` quando a ausência de efeito está comprovada, com motivo e mesma identidade da mensagem. As tentativas anteriores não são apagadas. A operação é explícita; não foi criada agenda de monitoria.

O recebimento passivo do Python é `Integrations.receive_callback`, método interno que valida a mensagem e registra recibo/dedup. O simulador o usa com uma mensagem sintética assinada. **Não existe uma rota `/api/webhook` ou equivalente no servidor Python canônico inventariado.** A variante pública tem `/api/inbox` exclusivamente de simulação, com contrato separado. Receber um evento não comprova integração externa ou webhook homologado. Um webhook real precisará de contrato específico, mapeamento, idempotência e revisão próprios.

Os seis adaptadores presentes — OMS, WMS, ERP, CARRIER, MAPS e FISCAL — usam contratos próprios e mocks locais. Isso não equivale à API de um fornecedor real. Referência fiscal, assinatura oficial, certificado, credenciamento e homologação continuam separados conforme [FISCAL-INTEGRACAO.md](FISCAL-INTEGRACAO.md).

## Documentação e validação

OpenAPI 3.1.1 segue a [especificação oficial OpenAPI](https://spec.openapis.org/oas/v3.1.1.html). O documento registra os endpoints reais e todos os comandos encontrados na composição atual de `Engine`. Foi verificado por leitura, parse JSON, referências internas, identidade de comandos, links e sintaxe do JavaScript da página. Não há validador OpenAPI externo instalado neste ambiente; não foi instalado um para este trabalho. A validação estrutural própria não é certificação formal do schema ou teste de todas as operações.

O exemplo Python acima também foi executado por HTTP em um servidor efêmero com banco novo e contas aleatórias da massa. Passaram os percursos positivos de sessão, manifesto, comparação/cotação/pedido, preparação fiscal e motorista concluindo três volumes com replay da mesma chave. Nenhuma senha foi impressa. Esse teste não operou navegador, instalação PWA, armazenamento offline real ou runtime anterior, nem executou a categoria de revisão de permissões bloqueada. O recibo está em `evidencias/documentacao-lince-20261125/exemplo-http-resultado.json`.

Schemas explícitos agora modelam os campos/formas conhecidos dos 69 comandos, incluindo variantes por kind/type/adapter. Campos condicionais ao estado não foram promovidos a obrigatórios globais. scenario_save.input e ERP.payload.reference conservam o JSON sem restrição de tipo que o backend aceita; não foram estreitados por suposição. Nenhum schema substitui invariantes de estado, relações, disponibilidade, saldo ou autorização. A atualização de um comando, rota ou contrato exige revisar/regenerar a documentação correspondente. Fontes e hashes desta unidade estão em `evidencias/documentacao-lince-20261125/`.

## Revisão documental de payloads

Revisão2: os 34 payloads antes parciais receberam campos/tipos/formas revisados em fonte. Cadastros por kind, recurso por type, ofertas por decision e adaptadores por adapter têm variantes explícitas. Alteração/cancelamento e replanejamento documentam requisitos condicionais ao estado sem exigir campos irrelevantes globalmente. Nenhum payload permanece classificado como PARTIAL_SOURCE_DERIVED; isso é cobertura documental de campos conhecidos, não cobertura total de comportamento. O tutorial Python não mudou; sua prova HTTP anterior permanece suficiente e não foi repetida nesta revisão. Evidências do delta em `evidencias/documentacao-lince-20261125/revisao2/`.
