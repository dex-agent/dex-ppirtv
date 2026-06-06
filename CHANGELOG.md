# Changelog

Todas as mudancas relevantes deste projeto devem ser registradas aqui.

Este changelog comeca em 2026-06-06. Historico anterior nao foi
retrocatalogado; entradas futuras devem registrar mudancas confirmadas com data,
escopo, evidencias e lacunas quando existirem.

## [0.1.0] - 2026-06-06

### Adicionado

- Criado o changelog inicial do projeto para acompanhar mudancas a partir desta
  versao.
- Adicionada preservacao runtime do `operational-contract.json` v4, incluindo
  metadados, definicao de pronto, Gate Final PPIRTV, modelo de relatorio final,
  severidade operacional e detalhes por principio.
- Adicionados campos opcionais em `checklist_render` e `ppirtv_checkout`:
  `ready_definition`, `gate_final_output`, `final_report_model` e
  `contract_accountability`.
- Adicionados testes cobrindo contrato v4, checklist, checkout, prompt
  `final-verdict` e compatibilidade MCP.

### Alterado

- `final-verdict` agora orienta uso de `goal_verdict` para fluxo GOAL/SPT e
  inclui modelo de relatorio final PPIRTV.
- `clean-house-review` agora inclui orientacao derivada da definicao de lixo
  operacional.

### Corrigido

- O runtime deixou de descartar silenciosamente campos top-level do contrato v4.
- `version: "1.0"` deixa de ser convertido implicitamente para numero sem
  preservar `numeric_version`.
- `docs/contracts/GOAL_SPT_CANONICAL_CONTRACT.md` deixou de listar
  `goal_meeting_record` como tool oficial e passou a apontar para o contrato
  vivo `goal_meeting_add_turn`/`goal_meeting_close`/`goal_regress`.

### Interno

- Mantida compatibilidade com contratos v1 minimos usados em fixtures.
- `goal_verdict` permanece sem novos bloqueios fiscais neste corte; endurecimento
  por Gate do Quando e Definicao de Pronto fica para trilho posterior.

### Validacao

- `npm run check` passou com build TypeScript e 108 testes verdes.
- MCP real/list_tools validado por teste contra `dist/index.js`.

### Lacunas

- Bump de versao ainda nao foi decidido.
- Mudancas anteriores a este changelog nao foram retrocatalogadas.
