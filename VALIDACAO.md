# Validação e limites

As verificações usam dados fictícios e ambientes isolados. Não são aceite operacional da Petlove.

- Backend Python: critérios funcionais por módulo, fiscal preparado, destino imutável e integração HTTP desktop/motorista. Teste HTTP novo: 3/3; preparação fiscal/destino: 12/12; massa sintética: 5/5.
- PWA motorista: lógica de fila e retomada exercitada; instalação em todos os aparelhos ainda não comprovada.
- Runtime público JS: motor separado com persistência D1 e personas fictícias. Os testes de domínio não demonstram equivalência integral com Python.
- Revisões distintas encontraram falhas de rota, inicialização após reconexão, persona padrão e remapeamento de IDs; foram corrigidas com contraprovas delimitadas. A publicação revelou exportação ausente no bundle e projeção incompleta do cenário UNKNOWN; o histórico das falhas permanece registrado localmente.
- A revisão de permissões Python foi interrompida por bloqueio automático da plataforma e permanece parcial; não está certificada por testes funcionais.
- Emissão fiscal, pagamentos, integrações reais, trânsito, carga, segurança e aceite empresarial permanecem pendentes de homologação própria.

Os testes existentes não devem ser usados como prova de prontidão de produção. Não há credenciais, dados corporativos, bancos ou registros pessoais neste pacote.
