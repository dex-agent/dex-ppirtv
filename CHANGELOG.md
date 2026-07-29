# Changelog

Todas as mudancas relevantes deste projeto devem ser registradas aqui.

Este changelog comeca em 2026-06-06. Historico anterior nao foi
retrocatalogado; entradas futuras devem registrar mudancas confirmadas com data,
escopo, evidencias e lacunas quando existirem.

## [Unreleased] - 2026-07-28

### Corrigido

- O fechamento de SPT entrega a prestação de contas aos owners:
  `garimpeiro` classifica, `estacionamento` persiste itens ativos,
  `napkin-projeto` avalia o runbook e `dex-memoria` grava memoráveis com
  validação de `consciencia-memorias`; exibição no checkout não conta como
  receipt de destino.
- O fechamento de SPT agora possui defesa local explícita em `AGENTS.md`: antes
  de fornecer `memoria_viva_reconciled=true`, o executor deve aplicar
  `memoria-viva`, despachar para `garimpeiro`, `estacionamento`,
  `napkin-projeto`, `dex-memoria`/`consciencia-memorias` e reabrir ACTIVE,
  HANDOFF e PLAN-TASKS/ACTIVE para provar o efeito. A reconciliação pós-fechamento também
  rotulou instruções antigas como históricas superseded, impedindo que uma nova
  janela receba próximos passos já concluídos.
- A validacao `full` e `compact` substitui o booleano generico `clean_house`
  pela atestacao unica `memoria_viva_reconciled`. `memoria-viva` permanece
  owner da reconciliacao de continuidade e da orquestracao de
  todos os owners de fechamento; `mm_pipeline_run` deixa de fabricar o
  fechamento e agora bloqueia ate a atestacao externa.
- As suites do seletor de memoria e da propagacao do launcher agora registram
  e removem todas as raizes temporarias criadas por teste. O cleanup tenta
  todas as raizes, falha de forma visivel quando nao conclui e execucoes
  repetidas deixam saldo zero de diretorios `ppirtv-*` em `%TEMP%`.
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
  permanecem consultaveis, mas nao satisfazem mais `review_required` por
  autodeclaracao. Evidencia estruturada de review e veredito agora carregam o
  fingerprint SHA-256 reproduzivel do conteudo dos `changed_files`; status,
  veredito e fechamento recalculam o snapshot vivo, invalidando review quando
  os bytes mudam mesmo que os caminhos permaneçam iguais. Flows pre-upgrade sem
  fingerprint ficam fail-closed, caminhos Windows equivalentes usam identidade
  canonica e plataformas case-sensitive preservam diferencas de casing. A
  atestacao agora precisa citar o fingerprint observado, rejeita arquivo
  sensivel, externo, ausencia nao declarada ou diretorio antes de conceder
  credito e o veredito precisa citar o `evidence_id` de review consumido.
  Delecao legitima usa `deleted_files`, colecao vazia ganha identidade propria,
  flows concluidos congelam sua proveniencia e recusam mutacao posterior por
  fatos, gate persistente, resume, progresso, regresso, reuniao, evidencia,
  veredito ou memoria; hygiene terminal e somente leitura, `goal_start`
  idempotente nao toca o terminal e archive tem retry sem duplicacao. Delecao
  declarada cujo path ainda exista, inclusive symlink quebrado, falha
  explicitamente; `deleted_files: []` remove tombstone quando um arquivo e
  restaurado em REWORK. A rota legada `verdict_record` nao opera sobre GOAL
  oficial.
- Tentativas de conclusao bloqueadas agora registram
  `goal_terminal_blocked` no historico e ledger, com assinatura contada pelo
  monitor de loops mesmo quando o gate local acabou de passar.
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
- O primeiro `goal_start` concorrente agora reivindica a
  `idempotency_key` por hash antes de criar o flow; apenas uma chamada cria e
  bindings duplicados preexistentes falham fechados.
- O primeiro estado persistido por `goal_start` agora ja nasce com
  `goal_binding`. Falhas entre save e ledger sao reconciliadas no retry por
  eventos append-only `flow_created_recovered`, `goal_started_recovered`,
  `flow_completed_recovered` e `flow_archived_recovered`, com `original_at`
  derivado do estado vivo; recovery nao reexecuta hooks nem regrava flow
  terminal. Se o append original persistiu antes de uma falha de retorno, o
  retry preserva um evento original e nao duplica recovery.
- O primeiro binding de um flow legado ativo continua sendo um
  `goal_started` original, mas exige objetivo literalmente igual, recusa
  veredito advisory preexistente e revalida o binding depois do lock para que
  chamadas concorrentes com chaves diferentes nao criem duas autoridades.
  Flow terminal sem binding falha explicitamente. Recovery de conclusao
  preserva `evidence_ids`, e o archive reconcilia uma conclusao persistida
  antes de tornar o flow irrecuperavelmente terminal.
- Bindings duplicados para a mesma chave agora geram receipt MCP estruturado
  `GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS`, com IDs conflitantes sanitizados,
  proxima acao por `ppirtv_trace` e zero mutacao.

### Alterado

- `src/flow-engine.ts` passa a ter owner evolutivo
  `$refactoring-fowler-rich`, com `$clean-code` como lente e pequenas extracoes
  comportamentalmente verificadas por visita; `src/review-snapshot.ts` e o
  primeiro modulo coeso extraido sob essa regra, seguido por
  `src/goal-ledger-recovery.ts` para isolar reconciliacao append-only e erro de
  binding duplicado. Lixo ou metodo legado no
  recorte so pode ser removido depois de busca de consumidores, garimpo,
  checkpoint temporario e comparacao antes/depois; o checkpoint e restaurado
  no RED e removido depois do GREEN. Referencia somente em teste nao conta
  automaticamente como uso real: a analise separa consumidor de produto,
  infraestrutura necessaria e teste autorreferente. Codigo novo precisa
  declarar responsabilidade, owner, modulo de destino e consumidor real antes
  de crescer o monolito; export sustentado apenas por teste isolado e RED
  arquitetural.
- Receipts de status, preflight, checklist e mutacao separam
  `phase_blockers`, `closure_blockers` e `phase_advance_allowed`; a acao fiscal
  existente permanece em `next_required_action` e o avanco local aparece em
  `phase_next_required_action`.
- A descricao e o prompt publicos de `goal_verdict` agora explicitam que um
  veredito positivo nao conclui GOAL oficial sozinho e que o cliente deve
  consultar `phase_advance_allowed`/`closure_blockers` antes do
  `goal_advance` terminal. O recibo positivo tambem devolve esses campos e
  `next_required_action.tool=goal_advance`, protegendo clientes com descriptor
  antigo ou em cache.
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

- A limpeza histórica das fixtures temporárias congelou 1.574 alvos em
  manifesto, moveu-os para quarentena reversível e, após autorização e suíte
  estável com 490 aprovados/4 ignorados, removeu a raiz exata. Cinquenta e oito
  junctions internos foram tratados como folhas; cinco entradas externas
  permaneceram invariantes. Uma execução anterior foi descartada como prova
  porque a fonte viva mudou durante a suíte.
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

- Correcao de gates fase/fechamento: engine 168/168; contrato MCP focal 2/2;
  `npm run check` com build, auditoria canonica, 455 testes aprovados e 4
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
