# Lince — simulador de transportes

Estudo funcional de TMS para o contexto Petlove: desktop para operação e PWA para o motorista, com paleta candidata roxo/coral. Todos os estabelecimentos, endereços, usuários, pedidos, documentos e imagens de demonstração são fictícios.

## Acessos

- Demonstração pública: https://lince-tms.rafaelsiqueira7394.chatgpt.site
- App do motorista: https://lince-tms.rafaelsiqueira7394.chatgpt.site/driver/
- Documentação de API: https://lince-tms.rafaelsiqueira7394.chatgpt.site/docs/

O runtime público é um motor de **simulação** HTTP separado, com personas fictícias e armazenamento próprio; não é autenticação produtiva nem homologação do backend Python. Um workspace compartilhável permite explorar o mesmo cenário no desktop e no motorista. Não insira informações reais nesse ambiente público.

## Executar o backend Python canônico no notebook

Requer Python 3.12+ e as dependências do arquivo requirements. Use um ambiente virtual de sua escolha:

```sh
python -m pip install -r requirements.txt
python start_lince.py
```

Na primeira execução, um diretório novo de simulação é preparado com 18 cenários,11 pedidos,7 viagens e7 contas. As senhas são geradas aleatoriamente e ficam somente em `runtime-local/first-access.json`, ignorado pelo Git. Consulte esse arquivo local para entrar. Execuções posteriores reutilizam a base; o inicializador não apaga nem reseta bancos existentes.

Desktop local: http://127.0.0.1:8766/ · Motorista: http://127.0.0.1:8766/driver/ · APIs: http://127.0.0.1:8766/docs/

Para criar outra instância independente: `python start_lince.py --new-demo --port 8767`. O app pode ser instalado como PWA quando servido por HTTPS ou localhost; acesso pelo celular a uma instância própria exige hospedagem HTTPS apropriada. O servidor local não é exposto automaticamente na rede.

## Navegação

A visão geral abre filas de atenção. Os módulos separam registros por tipo e situação; a busca e a página ficam na URL. Detalhes abrem em painel lateral, com registros relacionados e ações contextualizadas. Formulários abrem sob demanda e apresentam o próximo passo ao concluir. No motorista, uma viagem fica em foco por vez.

## Camadas

`application/` contém a API HTTP Python, domínio modular, SQLite, filas/integrações mock, desktop, PWA e recuperação. `public-runtime/` contém o runtime público de simulação JS. Ambos usam os contratos de interação documentados, mas sua equivalência integral não está presumida.

- Catálogos, calendário, tarifas versionadas e cotação multitransportadora.
- Pedidos/importação, planejamento/rota heurística, replanejamento, RFQ/ofertas e reservas.
- Custódia, tracking, tentativas/POD com foto, ocorrências, reversa e fila offline.
- Conferência, rateio, disputa, aprovação, AP/AR, baixas/estornos locais e despesas.
- Frota, agregados, manutenção, preparação fiscal, indicadores e simulação.
- Integração ativa por outbox/mocks e recebimento passivo explicitamente documentado.

## Documentos

- [Roteiro dos cenários](SIMULACAO.md)
- [API e exemplos](API-SIMULACAO.md)
- [Catálogo de comandos](REFERENCIA-COMANDOS.md)
- [Preparação fiscal](FISCAL-INTEGRACAO.md)
- [App motorista e offline](application/driverREADME.md)

## Limites de aceite

Integrações de transportadora, ERP e órgãos públicos são simuladas. Perfis fiscais externos apenas preparam dependências; não emitem nem assinam documentos oficiais. Homologação real depende de cenário, certificado, credenciamento, fornecedor e validação competente. Baixas não movimentam dinheiro. Rota não é solver ótimo e não usa trânsito real.

A revisão de permissões do backend Python permanece parcial por bloqueio da plataforma; testes funcionais não a substituem. Instalação/offline em todos os aparelhos, acessibilidade integral, segurança, carga e critérios operacionais de produção têm aceites próprios. O objetivo de navegação completa da simulação não equivale a liberação de produção.

## Camada de QA

[Guia de testes e massa editável](QA.md). Execute `python run_qa.py --layer all` para a bateria funcional em dados descartáveis. Front e back podem ser executados separadamente. O runner registra resultados e hashes; não instala dependências, não altera bancos servidos e não substitui a conferência no navegador.
