## Explorar o Lince com dados prontos — 26/11/2026

Desktop: https://lince-tms.rafaelsiqueira7394.chatgpt.site · Motorista: https://lince-tms.rafaelsiqueira7394.chatgpt.site/driver/ . A demonstração pública usa personas fictícias, sem senha empresarial. Não informe dados pessoais ou corporativos.

Use **Novo cenário** para carregar os exemplos novos; isso preserva os cenários anteriores. Abra **Comece por aqui: operação pronta para explorar**. Os quatro percursos adicionais mostram coleta com um recibo pendente, tarefa de reversa atribuída, compra multi-origem com frete único e reserva de doca. Cada percurso informa o perfil, o esperado e o link do registro. Os18cenários anteriores continuam disponíveis em Cenários de teste.

Para compartilhar uma operação entre desktop e celular, use **Copiar link do cenário** e mantenha `?workspace=…`. O contexto instalado/standalone não foi homologado; a correção candidata de persistência anterior permanece excluída.

No motorista, abra uma viagem e escolha a parada. **Mostrar etiquetas QR de teste** gera etiquetas com os volumes desse cenário. **Ler etiqueta ou QR deste pedido** abre o leitor: câmera somente após clicar **Abrir câmera**, imagem escolhida no aparelho ou entrada manual explicitamente identificada. A validação confere a chave exata da parada/tarefa; leitura não registra entrega. Confira os volumes e confirme a operação separadamente. Coleta e retorno possuem leitura própria de identificação, também sem baixa automática.

O formato entregue é etiqueta com **QR**. Código de barras linear Code128/EAN não está implementado. Abrir câmera depende de HTTPS, permissão e suporte do aparelho; negue/cancele sem perder o cenário. Leitura por imagem/manual não equivale a teste físico da câmera. PWA é o pacote disponível; não há APK/IPA ou publicação de loja.

Bibliotecas locais: jsQR (Apache2.0) e qrcode-generator (MIT), versões fixadas e sem CDN em execução. Licenças integrais em `application/vendor/LICENSE` e `application/vendor/qrcode.LICENSE`. Evidências de implementação, revisão e publicação ficam no registro responsável do projeto; testes de aparelho e produção têm aceites próprios.

---

## Revisão funcional local — 26/11/2026

Coleta e entrega agora distinguem parada, pedido e volumes, sem seleção automática de todos os volumes. O fluxo de compra multi-origem mantém uma cobrança ao consumidor, separada dos custos logísticos, com rateio em centavos. Tarifas podem optar por política versionada de cubagem; o divisor6000 exibido é exemplo sintético. Planos com coleta explícita exigem recibo de cada parada antes da saída. Reversa pode virar tarefa atribuída ao motorista. Docas têm capacidade, reserva, remarcação e check-in/out simulados.

Revisão distinta da fonte e integração local: ver evidências responsáveis no projeto. Testes com dados fictícios não demonstram coleta física, tarifa contratual, emissão fiscal ou prontidão empresarial. PWA não é APK/IPA. A retomada automática de workspace/persona após fechar uma sessão continua pendente: candidato excluído após falha de armazenamento negado. Preserve o link completo com `?workspace=…` para compartilhar o mesmo cenário.

Links: [Desktop](https://lince-tms.rafaelsiqueira7394.chatgpt.site), [Motorista](https://lince-tms.rafaelsiqueira7394.chatgpt.site/driver/), [API](https://lince-tms.rafaelsiqueira7394.chatgpt.site/docs/). Demonstração pública usa personas fictícias e não pede senha. O backend Python local possui credenciais próprias geradas no primeiro acesso; não copiar credenciais para o código público.


---

## Benchmark e estrutura mobile revisados — 25/11/2026

Rodada atual compara27frentes do Lince com documentação pública atual de OracleOTM26C, SAPTM e BlueYonder;13fontes qualificadas em COBERTURA-TMS.json, revisão distinta em evidencias/benchmark-mobile-20261125/revisao/. Auditoria encerrada no recorte, produto permanece com lacunas abertas. Sem acesso autenticado aos runtimes dos fornecedores nem alegação de paridade completa.

PWA pública /driver/ conferida no Edge390x844, com viagens de entrega e coleta, destinos/janelas/volumes e instruções de instalação. Não foram criados binários Android/iOS nem testados aparelhos reais. PrioridadesP0: confirmação por parada/pedido (rótulos de volume repetidos/pré-seleção observados), validar continuidade de cenário na instalação/retomada e regra de freteúnico em carrinho multi-origem ainda não demonstrada. Demais critérios por frente no JSON; roteiro mobile e distribuição candidata em application/driverREADME.md.

Nenhum runtime, banco servido, entrega ou autorização produtiva alterados; somente documentos/registro. Backups/hash-base/readback preservados. Aceites anteriores não promovidos; validação humana e homologações externas permanecem. Owner PULSO nesta unidade; execução independente suficiente não repetida. Próxima ação elegível: correção delimitada dosP0 com fonte/contrato e prova nova; aparelho real necessário para aceite mobile, sem alegar compatibilidade por viewport.

---

## QA funcional concluído — versão pública 5, 25/11/2026

Revisão de navegação e jornadas TMS concluída no recorte fictício autorizado. Camada repetível em run_qa.py, QA.md e examples/: 72 casos nomeados em sete suites, todos aprovados na combinação do runner final com reteste do frontend afetado. Evidências compiladas e de navegador são separadas, sem somar repetições: quatro controles POST do bundle, 19 assets; baseline de 77 combinações perfil/tela e 60 renderizações de formulário (58 comandos). Revisão distinta dos deltas Python, JS e formulário concluída, preservando falhas e ciclos anteriores.

Corrigidos cancelamento/oferta que reativava entrega, cotação vencida no planejamento, liquidação arredondada a zero, preservação de edições/candidatos e validação de coordenadas/CEP/volumes. Cadastros de organizações/usuários consultáveis, edição de frota versionada, calendários editáveis e escolhas financeiras contextualizadas. Navegador público confirmou escrita/leitura de dados fictícios e detalhe móvel390x844 sem overflow horizontal. Cenários e bancos anteriores preservados.

Site: https://lince-tms.rafaelsiqueira7394.chatgpt.site ; GitHub commit397e1b8af880a430b1558952663c9c7a3b5d81d6. Fonte/site e provas: evidencias/qa-tms-20261125/resultado-final.json. Pronto para simulação e avaliação humana; aceite produtivo, fiscal/integrações reais e segurança empresarial permanecem abertos. Sem nova agenda, instalação ou operação corporativa. Owner PULSO; consumo/custo desconhecidos. Próxima ação: avaliação humana ou lacuna material nova, sem repetir baterias suficientes.

---

## Navegação revisada — versão pública 4, 25/11/2026

Pedido humano direto de Rafael: navegar e melhorar a navegação. PULSO percorreu o site e corrigiu consulta, menus, filtros, detalhes e formulários: prioridades na visão geral, listas por tipo/situação, detalhes laterais, ações contextualizadas, continuidade e retomada por URL. Motorista foca uma viagem por vez. Valores/datas legíveis; planejamento oferece somente pedidos liberados.

Site público atualizado: https://lince-tms.rafaelsiqueira7394.chatgpt.site, versão4/source bacc19557f3b703c751630d6475af0c00a44ea94. GitHub público atualizado, commit488218c1f34a905ab21b3fad357d49adce173826. Registro e limites: evidencias/navegacao-lince-20261125/resultado.json. UI hospedada desktop e viewport390x844 conferida; liberação de pedido fictício1001 confirmada com próximo passo; rascunho/retomada corrigidos após achado real. Testes23runtime/9lógica motorista/3HTTPPython e18assets compilados. Não é auditoria independente integral de UX nem aceite produtivo.

Nenhum reset de banco ou cenário salvo. Alteração funcional observada apenas em pedido da massa fictícia. Fiscal/integradores reais, segurança/permissões e aceites anteriores continuam com seus limites; categoria de auditoria bloqueada não repetida. Nenhuma agenda nova. Próxima ação: avaliação humana da navegação e correção de lacuna material observada, sem reabrir baterias suficientes por rotina. Owner desta unidade PULSO; aceite humano pendente, consumo desconhecido.

---

## Lince publicado — decisão vigente em 25/11/2026

Rafael confirmou a conta pessoal **iafirst07**, código público e demonstração pública com dados fictícios. Essa decisão substitui, somente neste pacote independente, as antigas vedações de publicação e a pendência de escolha da conta preservadas abaixo. Nome de trabalho Lince, com paleta candidata roxo/coral inspirada na referência pública da Petlove; não houve importação de dados corporativos.

**SIMULACAO_PUBLICADA_COM_GATES_PRODUTIVOS_ABERTOS.** [Desktop](https://lince-tms.rafaelsiqueira7394.chatgpt.site), [motorista](https://lince-tms.rafaelsiqueira7394.chatgpt.site/driver/), [API](https://lince-tms.rafaelsiqueira7394.chatgpt.site/docs/) e [GitHub público](https://github.com/iafirst07/lince-tms). Repositório85arquivos, commitb8a64d8a099048a7fe9cd18a20f21902d7d25fd8; Sitev2/sourcef933f3164614a33ce44a781a50cc325c1959d622. Referência responsável: evidencias/publicacao-lince-20261125/publicacao-final.json.

Backend Python e runtime público JS são distintos. Foram acrescentados app motorista/PWA, destinos imutáveis, preparação fiscal por versões, biblioteca18cenários e documentação69comandos canônicos/71na variante pública. A publicação tem APIHTTP e persistênciaD1 reais para a simulação; personas são públicas, não autenticação empresarial. TesteUI hospedado confirmou entrega fictícia no motorista e atualização no desktop, além de reconciliação de resposta perdida em cenário novo. Não comprova todos os comandos/aparelhos nem equivalência integral Python/JS.

Falhas encontradas foram preservadas:403 em cliente automático, sem reprodução no Edge;503 de comando por export ausente do bundle, corrigido e retestado; respostas mock omitidas no cenárioUNKNOWN, corrigidas. Registro pendente do motorista foi recuperado sem reset. Revisão distinta compilada4/4, runtime23/23, HTTPPython3/3 e demais evidências delimitadas. Fiscal real, fornecedores/contratos, segurança/permissões, acessibilidade integral, carga e aceite operacional permanecem abertos. A campanha de permissões anteriormente rejeitada pela plataforma não foi repetida.

Owner desta integração/publicação: PULSO; autores e revisor congelados ao final, sem escrita concorrente. Governança/coordenação comercial anterior permanece histórica, sem novo despacho após respostas alheias ao escopo. Próxima ação elegível depende de gate concreto: escolha de fornecedor/contrato para homologação externa, ou observação humana de falha nova no simulador. Não criar vigilância, agenda ou operação corporativa por inferência. Aceite humano/consumo corporativo/custo desconhecidos.

---

## Estado vigente integrado em 25/11/2026

**APLICACAO_LOCAL_FUNCIONAL_COM_GATES_ABERTOS. Produto completo não aceito.** Esta atualização substitui apenas os estados correntes anteriores abaixo, preservados como histórico. A aplicação nova fica em `application/`, porta8766; protótipo e banco8765 preservados. [Entrega e acesso](ENTREGA-LOCAL-20261125.md), [matriz por capacidade](MATRIZ-CONCLUSAO.json), [execução/recuperação](application/README.md).

48 capacidades funcionais revisadas no recorte,7 adaptadores/envelopes DEMO testados,12 capacidades compostas parciais. Módulos não recebem aceite global por contagem. Permanecem: revisão de permissões limitada por bloqueio automático; fornecedores/contratos e homologação fiscal/externa; acessibilidade integral e critérios operacionais de produção. Rafael reafirmou fornecedores ainda indefinidos; não repetir pergunta.

Último efeito PULSO: integração de provas/documentação, com backups/hash-base/readback; nenhum código, sessão ou banco alterado. Owner lógico RS - Gestão Comercial. Próxima ação: recuperar matriz e evidências antes de retomar cada gate; não repetir testes já suficientes nem categoria de ação rejeitada. Coordenação retornou assunto distinto após trabalho TMS; causa desconhecida, sem presumir efeito externo. Operação cotidiana e qualquer retomada devem reconciliar escopo atual antes de escrever.

---

# TMS independente estudo e blueprint

Iniciativa TMS-INDEPENDENTE-20261125-01, versão documental 0.2, 25/11/2026. Produto independente para embarcadores e transportadores, com módulos separados, começando por entregas de e-commerce e última milha no Brasil, conforme decisões de Rafael. O pacote contém o blueprint e uma primeira fatia funcional local sintética, revisada. Não é um TMS completo nem está liberado para produção.

## Leitura

- [Contrato e decisões](CONTRATO.md)
- [Fontes e comparação](FONTES-E-COMPARACAO.md)
- [Produto e requisitos](PRD.md)
- [Jornada inicial de e-commerce](ECOMMERCE.md)
- [Arquitetura e domínio](ARQUITETURA.md)
- [Contratos de API candidatos](API.md)
- [Testes e ondas](TESTES-E-ONDAS.md)
- [Estado e próximas ações](project-state.md)

Owner único: RS - Gestão Comercial, thread 01a0bdd1-1297-78c0-b858-a1bf42b18530. Coordenação por referência em 07-negocios-projetos; todos os artefatos do produto permanecem nesta raiz própria. Não é extensão de produto corporativo. Não houve acesso a implementações proprietárias dos fornecedores.

## Demonstração e evidências

[Abra a demonstração neste computador](http://127.0.0.1:8765). Servidor temporário em loopback, sem serviço permanente. [Como executar e limites](prototype/README.md). Para retomar o percurso atual, iniciar com --db runtime/preview.sqlite; o padrão runtime/demo.sqlite é outro banco de demonstração.

Fluxo verificado: cotação, pedido/pacotes, custo logístico separado da cobrança consumidor, oferta/reserva, etiqueta simulada com UNKNOWN reconciliado, despacho, insucesso, entrega parcial/completa, fatura/auditoria e reversa. Testes: 22 da suíte e quatro contraprovas independentes passaram, sem representar os 32 cenários documentais integrais.

- [Revisão documental](evidencias/REVISAO-DOCUMENTAL.md)
- [Revisão de código e contraprovas](evidencias/revisao-codigo/RESULTADO.md)
- [Hashes dos arquivos de código](prototype/snapshot.json)
- [Evidência de interface e reinício](evidencias/preview-final.json)

Integrações, fiscal e documentos são fictícios; sem autenticação produtiva, envio, pagamento, estoque próprio ou replanejamento completo. Próxima evolução: fechar cidades/cargas e contratos de integração, enquanto ampliar casos locais sem dados reais.
