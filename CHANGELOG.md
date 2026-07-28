# Changelog

Todas as mudancas relevantes deste projeto devem ser registradas aqui.

Este changelog comeca em 2026-06-06. Historico anterior nao foi
retrocatalogado; entradas futuras devem registrar mudancas confirmadas com data,
escopo, evidencias e lacunas quando existirem.

## [Unreleased] - 2026-07-28

### Corrigido

- O resolvedor de candidatos de memoria passou a aceitar identidades V2 em
  `candidate_id`, preservar compatibilidade com `id` legado e rejeitar
  identidades ausentes, divergentes ou duplicadas antes de mutacao.
- As resolucoes `accept_ledger_only`, `park`, `discard` e `promote` agora sao
  reaplicadas pela mineracao V2, preservadas apos reload e idempotentes em
  repeticoes.
- Findings e turns com o mesmo aprendizado deixam de produzir memorias
  duplicadas apenas por diferenca de prefixo editorial; a proveniencia de
  ambas as origens permanece observavel.
- A leitura concorrente do flow lock passa a repetir uma troca legitima de
  identidade durante aquisicao, limitada pelo deadline existente, em vez de
  tratar churn ABA como corrupcao terminal.

### Alterado

- A promocao publica de candidato `destinations_required` aceita metadados
  explicitos de destino, densidade, tags, tema e owner; promocao deep continua
  fail-closed sem `owner_skill`.
- O schema MCP e o contrato documentado agora expoem os campos necessarios
  para promocao V2 sem adivinhar decisoes de dominio.
- O estado agregado da mineracao distingue candidatos resolvidos, ledger-only,
  estacionamento, descarte, destino promovido e bloqueio residual.

### Compatibilidade e riscos

- Nao houve bump de versao, tag, release ou breaking change declarado; a
  versao permanece a confirmar.
- Locks vivos de outro processo e locks estaveis malformados continuam
  fail-closed.
- A recuperacao simultanea de lock morto possui risco TOCTOU vizinho fora
  deste corte, registrado no estacionamento com owner e gatilho.

### Validacao

- Mineracao V2 focal: 51 testes aprovados.
- Contrato MCP focal: 2 testes aprovados com roots temporarios.
- Compatibilidade legada filtrada: 1 teste executado e aprovado.
- Runtime MCP recarregado provou candidato real, resolucao aplicada,
  idempotencia e `blocked_verdict=false` em `classify_only`, sem escrita no
  vault vivo.
- O RED concorrente `MEETING_LOCK_IDENTITY_CHANGED` foi reproduzido na suite e
  isoladamente antes da correcao.
- O conjunto focal de locks passou com 12 testes; `npm run check` passou com
  auditoria canonica, build, 442 testes aprovados e 4 ignorados.

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
