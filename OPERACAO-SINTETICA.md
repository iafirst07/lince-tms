# Operação sintética do Lince

Entrada: `/live/`. Usa o mesmo `?workspace=…` das telas de gestão e motorista. Nenhuma informação real de cliente, motorista, certificado ou contrato deve ser inserida na demonstração pública. Personas públicas não são autenticação empresarial.

## O que a demonstração deve executar

1. Receber uma solicitação pela API e criar um pedido do próprio simulador, com resposta, referência e consulta. O pedido recebido aguarda planejamento; sua viagem precisa conter seu ID para acompanhá-lo. Uma viagem previamente planejada não transporta automaticamente um pedido novo.
2. Selecionar uma viagem real do cenário e iniciar uma sessão de localização sintética. Mapa, próxima parada, posição, horário de captura/recebimento e estado da conexão devem concordar. Avanço é uma entrada simulada, não captura de GPS. Pausa, falta de rede e posição antiga precisam ser distinguíveis.
3. Registrar ocorrência e entrega no contexto da viagem/pedido. Localização nunca comprova entrega. A confirmação de entrega respeita os volumes e as condições do domínio existente.
4. Preparar documentos e processar respostas fiscais locais: rejeição, correção, consulta, cancelamento ou encerramento conforme o tipo/estado. HTML imprimível e XML são artefatos sintéticos, identificados sem validade fiscal; não são XML autorizado pela SEFAZ.
5. Gerar notificações numa caixa de saída local, simular falha, consultar e repetir com controle de duplicidade. Um ACK sintético não comprova recebimento por um sistema externo.

## API da demonstração

Contrato dos payloads, estados e limites: `/docs/live-api.json` no site ou `public-runtime/live-api-contract.json` no código.

Todas as rotas usam `X-Lince-Workspace` (UUID do cenário) e `X-Lince-Persona` (persona pública). Mutações exigem `Content-Type: application/json` e `Idempotency-Key`. São endpoints reais do simulador; não são uma integração produtiva com fornecedor.

- `GET /api/live-state`: consulta estado e catálogo visível. Inclui hora de referência para classificar posição antiga.
- `POST /api/live-command`: envelope `{ "action": "…", "payload": { } }`. A página Integrações mostra exemplos executáveis, resposta e pendências.
- `GET /api/live-document?id=…&format=xml`: conteúdo XML sintético.
- `GET /api/live-document?id=…&format=html`: documento sintético imprimível.

Preservar a mesma chave e o mesmo payload quando a resposta se perder. Consultar primeiro o último efeito quando ele for desconhecido. Uma chave nova não deve ser utilizada para mascarar duplicidade da mesma solicitação externa.

## Fronteiras

O Worker público JS e o backend local Python são implementações distintas. Este módulo amplia o Worker público; não demonstra equivalência ou homologação de ambos. O acompanhamento entre páginas usa consultas HTTP enquanto a interface está aberta, não serviço permanente no celular. Câmera, GPS físico, operação em segundo plano e APK/IPA possuem testes próprios. Não há chamada à SEFAZ, ANTT, transportadora, ERP ou destinatário externo.

O enquadramento fiscal/contratual real de uma empresa depende de seus cenários e validação competente. A presença de um tipo de documento nesta demonstração não define sua obrigatoriedade, emissor ou dispensa em uma operação real.

Evidências e resultado por versão: `evidencias/operacao-sintetica-20261126/`. Enquanto revisão/publicação/UI não estiverem concluídas, este documento é o contrato de uso pretendido, não declaração de aceite.
