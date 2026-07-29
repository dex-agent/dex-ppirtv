# Changelog

Todas as mudancas relevantes deste projeto devem ser registradas aqui.

Este changelog comeca em 2026-06-06. Historico anterior nao foi
retrocatalogado; entradas futuras devem registrar mudancas confirmadas com data,
escopo, evidencias e lacunas quando existirem.

## [Unreleased] - 2026-07-28

### Corrigido

- Gates de fase deixam de incorporar prematuramente blockers fiscais de
  fechamento, permitindo Pensamentos/Concepcao avancar enquanto review,
  memoria, hygiene e cooperacao continuam visiveis e bloqueiam o veredito.
- A conclusao terminal agora exige veredito canonico positivo e ausencia de
  blockers de fechamento antes de executar o hook pos-fase ou registrar
  `flow_completed`; o veredito positivo, sozinho, nao publica mais um
  `status=complete` prematuro.
- O guard terminal agora preserva `required_cooperation` quando uma reuniao
  elegivel ainda precisa ser vinculada por `meeting_id` ao novo veredito.
- A terminalizacao foi serializada e tornou-se idempotente; retries e chamadas
  concorrentes nao repetem hook nem evento de conclusao.
- Metadados de review aceitos por `goal_verdict` agora persistem no veredito e
  continuam validos para o guard terminal apos reload.
- O monitor de loops preserva o escalonamento causado por blockers locais
  mesmo quando o status fiscal usa uma identidade agregada equivalente.
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

- Receipts de status, preflight, checklist e mutacao separam
  `phase_blockers`, `closure_blockers` e `phase_advance_allowed`; a acao fiscal
  existente permanece em `next_required_action` e o avanco local aparece em
  `phase_next_required_action`.
- `ppirtv_checkout` lean/full/compact preserva a mesma separacao, e receipts
  compactos nao declaram `active` ou `advanced=true` quando o resultado real
  ficou bloqueado.
- A promocao publica de candidato `destinations_required` aceita metadados
  explicitos de destino, densidade, tags, tema e owner; promocao deep continua
  fail-closed sem `owner_skill`.
- O schema MCP e o contrato documentado agora expoem os campos necessarios
  para promocao V2 sem adivinhar decisoes de dominio.
- O estado agregado da mineracao distingue candidatos resolvidos, ledger-only,
  estacionamento, descarte, destino promovido e bloqueio residual.

### Documentado

- Novo handoff cross-repo confirmou que a separacao fase/fechamento permite
  chegar oficialmente a Validacao, mas `hygiene_scan` ainda mistura dez
  findings rich externos ao SPT e acopla `memory_required_but_empty` quando o
  writer do flow está `unconfigured`. O laudo preserva flow, evidence/event
  IDs, hashes, limites e RED sintético recomendado; nenhum código foi alterado.

### Compatibilidade e riscos

- Nao houve bump de versao, tag, release ou breaking change declarado; a
  versao permanece a confirmar.
- Locks vivos de outro processo e locks estaveis malformados continuam
  fail-closed.
- A recuperacao simultanea de lock morto possui risco TOCTOU vizinho fora
  deste corte, registrado no estacionamento com owner e gatilho.

### Validacao

- Correcao de gates fase/fechamento: engine 167/167; contrato MCP focal 1/1;
  `npm run check` com build, auditoria canonica, 451 testes aprovados e 4
  ignorados.
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
