# Lince Motorista — PWA de simulação

Aplicativo web instalável em `/driver/`, usando a mesma API, usuários, viagens, comprovantes e banco do desktop. Não há backend falso em `localStorage`, usuário padrão ou operação real. O nome Lince e a paleta roxo/coral são uma proposta visual; não constituem aplicativo oficial ou reprodução de logotipo corporativo.

## Jornada implementada

1. Entrar com um usuário de motorista já criado na aplicação. A operação precisa atribuir a viagem a esse usuário; entrar como administrador não inventa viagens para o motorista.
2. Consultar viagens em andamento/concluídas e abrir etapas, paradas, janelas, volumes e destinos recebidos no snapshot da viagem. Viagens antigas sem destino mostram “Endereço não informado”. O mapa externo só é aberto por clique nas coordenadas existentes; não há geolocalização automática.
3. Conferir todos os volumes e confirmar a próxima passagem da carga, com conexão. As transições e os pré-requisitos continuam validados pelo backend.
4. Selecionar volumes, registrar entrega parcial/completa ou tentativa sem sucesso, com observação e foto opcional. A foto é reencodada/reduzida e preservada na fila local até o upload; o backend ainda a valida.
5. Sem conexão, salvar comprovantes e atualizações da viagem no IndexedDB antes de qualquer tentativa de envio. A tela distingue “salvo neste aparelho” de “confirmado pelo sistema”. Volumes que já têm entrega pendente aparecem como aguardando confirmação.
6. Sincronizar com a sessão atual revalidada. Primeiro a foto usa `upload_pod` com chave estável; depois `offline_sync` recebe prova/evento e contexto originais. Resposta perdida repete a mesma identidade e conteúdo; não cria nova entrega. Mudança de contexto preserva o registro para conferência e impede reenvio automático.
7. Registrar avaria/extravio/atraso/recusa com volumes afetados e conexão. A solicitação é preservada antes do envio, com chave estável: resposta perdida aparece como “Ocorrência a confirmar”, e a confirmação manual reutiliza exatamente a mesma solicitação. Ocorrências e passagens da carga não são apresentadas como ações offline se a API atual não oferece esse contrato. Uma passagem repetida após resposta perdida também conserva a chave da mesma viagem/versão/etapa.
8. Voltar ao desktop e atualizar para conferir os mesmos registros. Sair do app interrompe envios ainda não iniciados e não apaga a fila; pendências ficam separadas por usuário/organização. A fila não sincroniza automaticamente em segundo plano.

## Instalação e operação

O manifesto usa `display=standalone`, escopo `/driver/` e ícones SVG/PNG192/512 próprios. O navegador precisa oferecer instalação e contexto seguro (HTTPS ou localhost). Abrir `127.0.0.1` no celular não acessa o servidor do PC; uso em outro aparelho exige hospedagem/URL acessível que seja preparada pelo responsável. Não expor diretamente o servidor de demonstração loopback como se estivesse homologado para produção.

O botão de instalação aparece quando o navegador oferece esse evento. No iPhone, a instrução é usar Compartilhar → Adicionar à Tela de Início. Esta entrega é PWA, sem binário, publicação na App Store ou garantia de compatibilidade com todos os aparelhos.

O service worker só trata GET dos sete arquivos estáticos nomeados no shell. API, login, dados autenticados, comprovantes e imagens de entrega não são cacheados pelo service worker. A visão offline mínima e a fila são dados locais explícitos no IndexedDB; não são criptografia nem prova de isolamento integral. Senha, cookie e CSRF não são gravados pela PWA no armazenamento local. Cookies seguem o servidor existente.

Limpar os dados do site ou remoção pelo navegador pode apagar pendências. A opção de solicitar armazenamento persistente depende da decisão do navegador e não impede limpeza manual. Preferir aparelho protegido e sincronizar assim que possível. Não fechar ou limpar o app como forma de “confirmar” um registro.

## Integração estática pelo servidor

| URL | Arquivo | MIME |
|---|---|---|
| `/driver/` | `driver.html` | `text/html; charset=utf-8` |
| `/driver/driver.js` | `driver.js` | `text/javascript; charset=utf-8` |
| `/driver/driver.css` | `driver.css` | `text/css; charset=utf-8` |
| `/driver/driver-sw.js` | `driver-sw.js` | `text/javascript; charset=utf-8` |
| `/driver/manifest.webmanifest` | `driver.webmanifest` | `application/manifest+json` |
| `/driver/icon.svg` | `driver-icon.svg` | `image/svg+xml` |
| `/driver/icon-192.png` | `driver-icon-192.png` | `image/png` |
| `/driver/icon-512.png` | `driver-icon-512.png` | `image/png` |

O registro SW em `/driver/driver-sw.js` pede somente escopo `/driver/`; não precisa ampliar para `/`. O SW da área desktop não deve assumir arquivos/API do motorista. Atualizações do shell precisam de revisão e incremento do cache quando houver mudança incompatível.

## Validação do autor

`node --check driver.js`, `node --check driver-sw.js` e `node test_driver_logic.cjs`.

O roteiro Node executa nove casos funcionais de projeção operacional mínima, snapshot imutável, dois PODs/contexto, resposta perdida de POD, resposta perdida de upload, conflito operacional preservado, saída local durante upload, resposta perdida de ocorrência e seleção dos recursos estáticos do SW. Usa adaptadores de memória; não opera navegador, IndexedDB real, servidor ou bancos existentes. Um caso reabre um novo adaptador a partir dos registros serializados; isso não é teste de reinício de navegador/OS.

Continuam necessários teste visual/em dispositivo, IndexedDB e shell offline reais, instalação em navegadores-alvo e revisão independente deste delta. O bloqueio anterior da revisão de permissões não foi contornado ou reexecutado. Testes funcionais da PWA não promovem o backend a segurança produtiva ou produto completo.
