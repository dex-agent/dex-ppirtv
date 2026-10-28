# Changelog

Todas as mudancas relevantes deste projeto devem ser registradas aqui.

Este changelog comeca em 2026-06-06. Historico anterior nao foi
retrocatalogado; entradas futuras devem registrar mudancas confirmadas com data,
escopo, evidencias e lacunas quando existirem.

## [Unreleased] - 2026-07-28

### Alterado

- Egress de mining e sequência de unblock saem da fachada (2026-10-28, GO do
  dono — Trilho `mining-egress-shrink`, SPT
  `.agents/PLAN-TASKS/2026-10-28-mining-egress-shrink.md`): pagamento da debt
  de camping `FE-DEBT-004` com SHRINK verificado — `memoryMiningRequiredSequence`
  migra de `src/flow-engine.ts` para o SSOT `src/memory/mining-policy.ts`
  (Mover Função; a fachada consome por import nos 2 call sites
  `required_tool_sequence` e `executable_route`) e o par de projeção
  `nuggets_collected`/`deposit_guidance` colapsa no helper único
  `miningVisibilityEgress` do SSOT, espalhado nos 4 pontos da fachada (legacy
  summary/return + v2 summary/return). Comportamento preservado: BASELINE
  725|4 no HEAD `a678a1a`, suites de rede 222/222 sem edição de teste
  (mining-deposit 9 + engine 198 + mining-policy 15). Record
  `FE-2026-10-28-MINING-EGRESS-SHRINK` no ledger com
  `pays_debt_id=FE-DEBT-004` (a debt deixa de estar aberta); selagem
  pós-commit no commit seguinte. Próximo candidato da maratona destravado:
  sub-eixo meetings (`PPIRTV-VERDICT-MEETINGS-TREE`).
- Mining expõe a entrada vazia e ensina o depósito (2026-10-27, GO do dono — Trilho
  `mining-deposit-visibility`, SPT
  `.agents/PLAN-TASKS/2026-10-27-mining-deposit-visibility.md`): fim do
  0-anestesiante do `mm_memory_mining` — summary e retorno passam a expor
  `nuggets_collected` e, quando nenhum depósito sobrevive à coleta,
  `deposit_guidance` ensinando a depositar; a política mora no SSOT
  `src/memory/mining-policy.ts` (`EMPTY_MINING_DEPOSIT_GUIDANCE` +
  projeção pura `emptyMiningDepositGuidance`), consumida pelos dois caminhos
  de writer (legacy e `mineMemoryV2`) como cola de projeção sem decisão nova
  no monolito (visita CONTAIN do camping, debt `FE-DEBT-004` pagável em
  SHRINK futuro). As DUAS rotas de unblock de `memory_required_but_empty` —
  `memoryRequiredErrorAction` em `src/server.ts` (agora exportada) e
  `memoryMiningRequiredSequence` no flow-engine — ganham passo 1
  `evidence_attach` com `gold_mining` modelo antes de minerar, via builder
  SSOT `miningDepositStep` em `src/memory/mining-policy.ts` (única verdade do
  passo; mining/status/verdict reordenados para 2/3/4; colateral declarado:
  asserts de índice da sequência em `tests/engine.test.ts` atualizados para a
  nova ordem). `THEME_RULES`
  delphi reconhece vocabulário de build (`dcc32|dpr|dproj` — ouro real
  pontuava 4 e caía em `ledger_only` silencioso). Description do
  `mm_memory_mining` declara que o classificador lê somente texto depositado
  em `gold_mining`/`parking_lot`. Suite nova RED-first
  `tests/mining-deposit-visibility.test.ts` (9 casos; RED 9/9 preservado em
  `.agents/AUDITORIAS/EVIDENCIAS/2026-10-27-mining-deposit-red.log`). O
  comportamento "vazio satisfaz o fiscal" é PRESERVADO de propósito (decisão
  MGL 2026-10-18) — a cura é visibilidade + rota, não bloqueio.
- Eixo fiscal do verdict sai do monolito (2026-10-26, GO do dono — árvore CCP P1
  `verdict-fiscal-policy-tree`, SPT
  `.agents/PLAN-TASKS/2026-10-26-verdict-fiscal-policy-tree.md`): o núcleo
  fiscal do veredito (`evaluateFiscalPolicy`, `fiscalResult`, `requiredCoo`,
  `cooReason`, `fiscalMateriality`, `fiscalText`, `materialRiskText`,
  `explicit/negative/positiveMeetingTrigger`, `codeReviewRequired`,
  `hasReviewEvidence`, `recurringRisk`, `hasEnoughAttempts`,
  `regressLimitReached`) migra para `src/verdict-fiscal-policy.ts` com
  dependências explícitas (`FiscalPolicyDeps`) dos eixos vizinhos até os
  cortes futuros de cada eixo; a fachada mantém wrappers finos e a cola de
  chamada (7 call sites de `evaluateFiscalPolicy` e 2 de `hasReviewEvidence`
  intactos). `src/flow-engine.ts`: 8428 → ~8200 linhas (−11 símbolos
  próprios). Prova de comportamento: suite integral **716|4 sem nenhuma
  edição de teste** + probe A–F v2 **6/6** no dist rebuildado. Record
  `FE-2026-10-26-VERDICT-FISCAL-POLICY-SHRINK` no ledger de camping (SHRINK;
  selagem pós-commit no commit seguinte). Sub-eixo meetings fica no monolito
  (eixo CCP próprio, corte futuro). Premissa da pendência corrigida pela
  Onda 0: `changedFilesContainCode` já vivia exportado em
  `src/gate-resolution.ts:60`.
- Rito de fechamento da pendência P0 gate-integrity consumido no ledger (2026-10-26, GO do dono; HEAD `113713a`, zero código de produto tocado): bateria A–F do laudo de revalidação reexecutada black-box MCP contra o contrato vigente — **6/6 verde** (A bloqueia `changed_files` inválido com rejeição tipada na fronteira; B same-path bloqueia com `review_current`; C declarativa v3 resolve `evidence`; D extensionless mechanical exige review no veredito; E segredo rejeitado com resposta/flow/ledger limpos; F forward return rejeitado), harness adaptado ao contrato vigente (`declarative_proof` exige `paths`; review estruturada obrigatória no gate de revisão), receipts em `.agents/AUDITORIAS/EVIDENCIAS/2026-10-26-*`; camping cumulativo **PASS ×2** (`5e7d5df..HEAD`, `067d975..HEAD`; cadeia de 7 records); suites **17/17** (revalidation 13 + hardening-3 4) e ER-1..ER-4 do SPT exit 0; pendência `PPIRTV-GATE-INTEGRITY-REVALIDATION-2026-10-18` consumida com prova (`pendencias.py --valida` exit 0); flow `flow_20261018140649700_2948_0001` (goal `gate-integrity-hardening-3`) encerrado com veredito `pronto_com_ressalvas` — objetivo executado por janelas diretas com commits selados, flow fechado como registro honesto com ressalva; Trilho hardening-3 CONCLUIDO; laudo de revalidação ganhou Addendum §22 e `REVIEWS/INDEX` aponta o fechamento atual (nenhum laudo antigo citado como fechamento). Exceções documentadas no addendum: camping per-commit retroativo das janelas de 2026-10-18 é estruturalmente impossível (selagem pós-commit dos records instituída depois daqueles commits; cobertura viva pelo cumulativo PASS ×2, superconjunto) e observação menor não reprodutível de declarativo sem `paths` aceito 1× em diagnóstico. Próxima: pendência P1 `verdict-fiscal-policy-tree` (próximo SHRINK da maratona).
- Snapshot fantasma redigido: path sensível sob dot-dir de runtime de
  terceiro nunca mais bloqueia o verdict (2026-10-23, GO do dono — cura da
  pendência PPIRTV-VEREDITO-TERMINAL-GATES-SNAPSHOT-FANTASMA, flows
  0568/0602 do jev): `GIT_CORROBORATION_EXCLUDED_PREFIXES` ganha `.codex/`
  e `.zcode/` (ruído automático de runtime de qualquer host, igual
  .git/.ppirtv/.agents); `fingerprintReviewedImplementation` REDIGE path
  sensível sob esses prefixos como entrada `state:"redacted_runtime"`
  (conteúdo NUNCA lido nem hasheado — teste de independência prova) em vez
  de lançar `REVIEW_SNAPSHOT_SENSITIVE_PATH`, curando flows já envenenados
  (o merge não-filtrado tinha sido persistido no `changed_files` — 416
  paths no flow 0568; remover o arquivo/reiniciar o servidor não curava);
  sensível de produto próprio (`.env`, `.npmrc`, `config.toml` na raiz,
  `vendor/*/.git/config`) continua fail-closed; o envelope
  `REVIEW_SNAPSHOT_PATH_INVALID` ensina a causa real (path de terceiro
  corroborado) e a rota. Prova da vítima real: fingerprint do flow 0568
  com os 416 paths persistidos computa sem throw no build novo. RED 2/3;
  suite 714|4. `src/flow-engine.ts` intocado. Rodada adversarial (1, fixes
  aplicados): redação passa a valer para TODO path sob prefixo de runtime
  após resolução lexical — não apenas sensível-por-nome — o que cura também
  o modo strict do attach de review (path runtime ausente não gera mais
  REVIEW_SNAPSHOT_FILE_REQUIRED; prova da vítima real em modo strict
  resolve), impede leitura/hash de runtime não-sensível (`.zcode/` etc.),
  fecha o traversal `.codex/../.env` (resolve para produto → fail-closed) e
  despirra aspas literais de path persistido sujo (família input-unwrap);
  description de goal_verdict atualizada com a lista nova. Suite 716|4.
- Fiscal auto-ressalva do `required_cooperation` + liderança do
  `review_required` no bloqueio composto (2026-10-21, GO do dono — menor
  corte, maior ganho, sem skill nova): o envelope de erro passa a ensinar a
  receita real de satisfação (`goal_meeting_open` → `goal_meeting_close`
  com `satisfies_blockers=["required_cooperation"]` + `participants_present`
  + decisão, consumida pelo `goal_verdict` via `meeting_id` com
  `evidence_ids`; preencher apenas `cooperators` nunca satisfez — o filtro
  eligible não lê esse campo); a nova branch
  `attach_structural_review_before_meetings` (primeira da cadeia) declara
  que `review_required` lidera qualquer composto e ensina a rota completa
  `goal_status` full → `evidence_add` kind `code_review` (espelhando
  `reviewRequiredSequence`: `scope_classification`/`scope_reference`,
  arrays de substituição não vazios, fingerprint vigente) → cooperação →
  veredito (sem `meeting_id` no review puro); a description viva e o
  `.describe()` de `satisfies_blockers` na `goal_meeting_close` ensinam via
  `tools/list`; o branch `provide_meeting_id_for_verdict` do
  `classifyToolError` respeita a liderança do review; o contrato canônico
  `GOAL_SPT_CANONICAL_CONTRACT.md` (global+local) ganha a forma de
  satisfação + pointer para `GOAL_EXECUTION_BRIDGE`. RED provado (3 testes
  novos falharam antes) + revisão adversarial com probes vivos (F1–F8
  corrigidos: open na sequência, participants_present, payload com
  scope_*, evidence_ids no verdict, precedência sobre attempt-branches,
  guarda no server, fixture alinhado ao schema vivo, meeting_id condicional;
  rodada 2: rationale do verdict com o literal "cooperacao material" rearma o
  blocker — literais neutralizados + teste de regressão);
  suite 711|4, audit-error-envelope 0 códigos sem rota / 8 sequências
  válidas, probe tools/list 7/7. `src/flow-engine.ts` intocado.
- Fronteira de input nunca bloqueante — frentes 2 e 3: unwrap profundo +
  leitura que responde + SHRINK FE-DEBT-001 pago (2026-10-18, GO do dono
  após auditoria por print): o desembrulho do artefato `{"value": X}` passa
  a valer para TODOS os níveis (elementos de array e objetos aninhados —
  causa do `provided.changed_files` inválido e do `[object object]` no
  laudo do consumidor), em UM ponto no módulo novo `src/input-unwrap.ts`;
  as tools de diagnóstico cujos handlers toleram shape arbitrário
  (`goal_status`, `flow_status` — as rotas que o consumidor usa para
  destravar) nunca rejeitam por forma; as demais mantêm o envelope
  ensinante (campo/recebido/esperado/exemplo/rota — identificação com
  referência, não loop); o replay de `provided`
  persistido sujo em flows velhos é saneado antes do merge
  (`sanitizePersistedProvided` — drop de lixo nunca adiciona satisfação, o
  gate segue fail-closed), `normalizeReviewPathForPlatform` tolera não-string
  (fim do `value.trim is not a function`) e o helper `unique` do monolito
  descarta não-strings de flows legados. Critério de aceite = replay do
  transcript real do consumidor: `tests/consumer-replay-jumper.test.ts`
  (goal_status full responde no flow sujo + evidence_add aceito com arrays
  embrulhados chegando flat). A visita ao monolito é SHRINK: os
  classificadores de `spt_path` (`resolveSptPath`, `isDirectory`, `isFile`,
  `isInsideOrEqual`, `isSensitivePath`) migram para
  `src/spt-path-diagnostics.ts` e pagam a dívida FE-DEBT-001.
- Fronteira de input nunca bloqueante (2026-10-18, laudo do consumidor na
  máquina jumper + diretiva do dono): o artefato de serialização de cliente
  `{"value": X}` (objeto de uma chave `"value"`, medido 2026-10-17 e
  2026-10-18 com o consumidor preso em 14 retries) é desembrulhado em UM
  ponto (`installTeachingInputValidation`) para TODAS as tools e campos de
  topo; nas seis chaves de review o par de domínio
  `src/review-input.ts` (92 linhas, extraído do monolito `src/server.ts`,
  −83 linhas) desembrulha e o validador existente passa a gerar
  `review_input_ressalvas` no receipt (campo/recebido/esperado/referência
  para corrigir a serialização do chamador) em vez de rejeitar com
  `PPIRTV_INPUT_INVALID`. O gate de veredito continua fail-closed no
  substancial. Desenho lapidado com ponytail + chato + jev-gate-principios
  (VERIFICAR→corrigido: sair do meio, barata vizinha em outras tools,
  limite sem evidência). Provas: `tests/review-input.test.ts` 3/3,
  `tests/evidence-add-review-wire.test.ts` 5/5 RED-first (rejeição antiga
  provada contra dist anterior), `tests/mcp-tool-describe.test.ts` com
  frases literais; suíte 691 passed | 4 skipped.
- Contratos de corroboração documentados no help vivo (2026-10-18): as
  descriptions de `goal_start` e `goal_verdict` no `tools/list` agora
  ensinam `git_head_base` congelado, corroboração `git diff base..HEAD`,
  fail-closed em base órfã e a rota de resolução de `review_required`;
  `--help/--schema/--usage/--describe/--list` herdam da mesma fonte.
  `tests/mcp-tool-describe.test.ts` 4/4 com asserts documentais.
- Corroboration Git por commit no verdict (NOVO-1/NOVO-2) + SHRINK FE-DEBT-003 pago (2026-10-18): `goal_start` congela `git_head_base` e `goal_verdict` corrobora commits via `git diff base..HEAD` (fail-closed em base orfa exige review); runtime `.git/`/`.ppirtv/`/`.agents/` sai do ruido de corroboration; `flowWithCurrentImplementationFingerprint` deixa o monolito (`src/review-snapshot.ts`). `tests/git-corroboration-commits.test.ts` 4/4 RED-first.

### Adicionado

- CAPACITY com recibo canonico `dex.capacity.snapshot.v1` (2026-10-18):
  `CAPACITY.receipt.json` passa a ser a fonte machine-readable do gate;
  `CAPACITY.md` fica como vista humana validada por
  `tests/capacity-receipt.test.ts`. O gate le o recibo, nao a tabela Markdown.
- Entrypoint help (2026-10-18): `dist/index.js` e `dist/launcher.js`
  aceitam `--describe/--schema/--usage/--list/--help` sem iniciar o stdio;
  sem tool imprimem help e falham com exit 1, sem hang.
  `tests/tool-cli-entrypoint.test.ts` 4/4.
- Review scaffold boundary (2026-10-18): `goal_status` remove alvos
  `[object Object]`/nao-string de `reviewed_targets` e `scope_reference`,
  caindo para placeholder explicito em vez de ensinar payload invalido.
  `tests/server-review-scaffold.test.ts` 2/2.

- Help/schema/usage read-only por tool MCP (2026-10-18): `dist/index.js` e
  `call-mcp-tool.mjs` com `--describe/--schema/--usage` leem `tools/list` e
  imprimem descricao, JSON Schema e usage sem invocar a tool; quickstart ganhou
  o wire flat de review e o FAQ deixou de mandar o agente ao codigo-fonte.
  `tests/mcp-tool-describe.test.ts` 3/3; suite 681 passed | 4 skipped.
- Gate integrity hardening-3: changed_files estrito, review currency e corroboracao Git (2026-10-18
  `gate-integrity-hardening-3`, SPT
  `.agents/PLAN-TASKS/2026-10-18-gate-integrity-hardening-3.md`): R2 valida
  `changed_files`/`deleted_files` como array estrito de paths no SSOT; R3 exige
  review estruturada atual quando o gate de revisao ficou stale same-path; R6
  corrobora `changed_files` contra o diff Git real no veredito; SPT e laudo de
  re-review referenciados. Suite 671 passed | 4 skipped; build/audit e camping
  CONTAIN PASS; FE-DEBT-003 aberto para extrair a cola restante da fachada.
  R5 fica como decisao documentada: evidence generico aceita criterion_proof
  aprovado; o gate de revisao stale e contido por R3 (review estruturada
  atual), nao por um filtro de fase. R7: 598ae5d per-commit continua FAIL
  porque o commit do record foi selado em 76e9c94; replay cumulativo PASS e
  a excecao fica documentada. Novo gate PPIRTV-CAPACITY-COMMIT-GATE:
  `npm run check:capacity` + hook pre-commit exigem CAPACITY.md staged com
  `## Reavaliação` em todo commit; teste `tests/capacity-gate.test.ts` 1/1.
  Pendencia P0 nao consumida.
- Revalidacao gate-integrity fecha os residuos F1-F6 (R1-R10) (2026-10-18
  `gate-integrity-hardening-2`, SPT
  `.agents/PLAN-TASKS/2026-10-18-gate-integrity-hardening-2.md`, laudo
  `.agents/REVIEWS/2026-10-18-laudo-gate-integrity-hardening-2.md`):
  (R1) `flow_return`/`goal_regress` nao avancam — destino posterior a fase
  atual rejeita com `PPIRTV_PHASE_RETURN_MUST_GO_BACK` antes de mutar
  (retorno para a propia fase segue legal: e o gatilho de regresso fiscal);
  (R2) requisito `source=flow` so e satisfeito pelo TIPO contratado
  (`GateRequirementKind` no perfil; `[]`/`"false"`/`0`/`{}` nunca valem) e
  chave provided desconhecida falha fechada; (R3) `GateRecord` grava
  `implementation_fingerprint` e o recheck de revisao/teste/validacao julga a
  review contra o conteudo ATUAL (`reviewCurrencyAppliesToPhase`) — mudanca
  same-path bloqueia o reuse; (R4) os risks do CONTRATO SPT passam pelo guard
  central no choke point `validateSpt` (goal_start e tool publica);
  (R5) `criterion_proof.passed` aprovado satisfaz o requisito generico de
  evidence (rota declarativa documentada no quickstart); (R6) allowlist
  invertida — so extensao documental explicita e doc; `scripts/deploy`,
  `Makefile`, `Dockerfile` e sem extensao sao codigo e exigem review no
  veredito mechanical; (R8) o diagnostico
  `field`/`received`/`expected` prometido chega ao consumidor no
  `goal_gate_preflight.required`. RED causal (10 failed | 2 passed em
  598ae5d) em
  `.agents/AUDITORIAS/EVIDENCIAS/2026-10-18-hardening2-red.log`; bateria em
  `tests/gate-integrity-revalidation.test.ts` (13 testes); suite completa 666
  passed | 4 skipped. Guards de segredo consolidados no SSOT
  `src/security/secret-redaction.ts` (EXCEPTION
  `FE-2026-10-18-GATE-INTEGRITY-HARDENING-2`, +12 linhas nao-vazias, 2 simbolos saem da fachada).

- Loop de mineracao pos-veredito deixa de ser insolvel (history append-only por tentativa; SHRINK MGL) (2026-10-18
  `memory-gate-loop-solubility`, SPT
  `.agents/PLAN-TASKS/2026-10-18-memory-gate-loop-solubility.md`): (decisao A)
  o history do flow e 100% append-only — cada mineracao registra um evento
  `memory_mined` proprio, mesmo com resultado identico — e a idempotencia vive
  SOMENTE no ledger V2 por reconciliation id; o loop monitor so reseta a
  janela quando o reconciliation id muda (re-mining duplicado nao e progresso),
  enquanto eventos legados sem id continuam resetando. Doze predicados de
  politica de mineracao e a matematica da janela de loop sairam da fachada
  para `src/memory/mining-policy.ts` (SHRINK
  `FE-2026-10-18-MEMORY-GATE-LOOP-SHRINK`, -142 linhas nao-vazias). RED causal
  em `.agents/AUDITORIAS/EVIDENCIAS/2026-10-18-memory-gate-loop-red.log`;
  bateria em `tests/memory-gate-loop.test.ts` (4 testes) e suite completa
  653 passed | 4 skipped.

- Segredo no envelope, gate stale e evidencia vazia falham fechado (F4/F5/F6) (2026-10-18
  `gate-integrity-f4f5f6`, SPT
  `.agents/PLAN-TASKS/2026-10-18-gate-integrity-f4f5f6.md`, laudo
  `.agents/REVIEWS/2026-10-17-laudo-gate-integrity-hardening.md`): (F4)
  `createFlow`, `update_flow_facts` e `goal_start` rejeitam payload
  secret-like ANTES de persistir — segredo nao chega mais ao flow JSON nem ao
  ledger; (F5) `GateRecord` grava `changed_files_snapshot`, gates downstream
  (`revisao`/`teste`/`validacao`) passados sao invalidados quando
  `changed_files` muda e o reuso exige snapshot identico; (F6) o requisito
  generico `evidence` exige evidencia relevante (`satisfies` cobrindo
  `expected_evidence` OU receipt de teste com `passed`/`failed`/`exit_code`),
  nao a existencia de qualquer evidencia. Replay black-box dos cenarios C/D e
  bateria em `tests/gate-integrity-f4f5f6.test.ts` (8 testes). Rebaixado em
  2026-10-18: a revalidacao
  (`.agents/REVIEWS/2026-10-18-laudo-gate-integrity-fix-revalidation.md`)
  achou residuos de F1/F3/F4/F5 so fechados pelo `gate-integrity-hardening-2`
  abaixo — o fechamento original valia pelos cenarios C/D testados, nao pelos
  residuos.

- Gates de prova tipados, retorno cross-profile e mechanical com codigo falham fechado (2026-10-18
  `gate-integrity-hardening`, SPT
  `.agents/PLAN-TASKS/2026-10-17-gate-integrity-hardening.md`, laudo
  `.agents/REVIEWS/2026-10-17-laudo-gate-integrity-hardening.md`): (F1) requisitos
  `provided` agora tem tipo contratado em `src/gate-resolution.ts` —
  `implementation_done`/`diff_reviewed`/`barata_scan`/`test_executed`/
  `memoria_viva_reconciled` exigem boolean `true`, `next_step` texto nao vazio,
  `residual_risks` lista de textos (lista vazia valida) e `regression_risks`
  ao menos um texto (strings `"false"`/`"no"`, `[]`, `{}`, `0` nao valem mais
  como prova; diagnostico `field`/`received`/`expected` no gate bloqueado);
  (F3) fast-track `mechanical` so e honrado sem arquivo de codigo em
  `changed_files` (`CODE_FILE_EXTENSIONS` + `changedFilesContainCode`
  centralizados em `src/gate-resolution.ts`) — codigo auto-declarado mechanical
  exige review estruturada no veredito; (F2) `flow_return` cross-profile
  rejeita com `PPIRTV_INVALID_PHASE_FOR_PROFILE` antes de persistir,
  transicao de fase desconhecida lanca `PPIRTV_UNKNOWN_PHASE_TRANSITION` e
  `phaseAdvanceAllowed` falha fechado em fase fora do perfil
  (`src/flow-engine.ts`, EXCEPTION `FE-2026-10-18-GATE-INTEGRITY-TYPED-PHASES`);
  `goal_advance` (`src/server.ts`) ensina os tipos no contrato da tool.
  RED preservado em
  `.agents/AUDITORIAS/EVIDENCIAS/2026-10-17-gate-integrity-red.log`
  (7 failed | 4 passed); bateria em `tests/gate-integrity-hardening.test.ts`
  (11 tests: tabela requisito x valor, cenario A compact mechanical, cenario B
  cross-profile, F3 codigo x doc-only, nao-regressoes). Suite integral: 41
  files, 641 passed | 4 skipped.
- Review gate a prova de loop (2026-10-17 `review-gate-loop-proof`, SPT
  `.agents/PLAN-TASKS/2026-10-17-review-gate-loop-proof.md`): o
  fiscal de loop conta retry de review invalida e snippet de review_required ensina a forma completa
  — evidencia de review invalida carrega `review_valid: false` no evento
  `evidence_attached` e deixa de resetar a janela do `loop_monitor`
  (`src/flow-engine.ts`, EXCEPTION `FE-2026-10-17-REVIEW-LOOP-FISCAL-SANE`,
  validade computada em `src/gate-resolution.ts`); o snippet de
  `required_tool_sequence` lista TODOS os `changed_files` em
  `reviewed_targets`, expoe `reviewed_implementation_fingerprint` e
  `operator_must_replace` completo; e o wire do `evidence_add`
  (`src/server.ts`) rejeita `observed_result` aninhado com
  `PPIRTV_INPUT_INVALID` ensinando campo, recebido e esperado (incidente
  2026-10-17: ~60 retries invalidas em ~2h). Caracterizacao do comportamento
  preservado em `tests/loop-monitor-preserved.test.ts`; ciclo do incidente
  escalando em `tests/loop-monitor-escalation.test.ts`; snippet em
  `tests/review-snippet.test.ts`; wire em `tests/evidence-add-review-wire.test.ts`;
  diagnostico de forma em `tests/review-diagnostics-shape.test.ts`. Prova
  black-box com receipt
  `.agents/AUDITORIAS/EVIDENCIAS/2026-10-17-review-gate-loop-proof-replay.json`
  (nested morre no wire; snippet lista todos os changed_files; ciclo invalido
  acumula `loop_monitor.count` e ativa escalonamento). Suite integral:
  40 files, 630 passed | 4 skipped.
- Trilho B do validador que ensina (2026-10-15 `validador-que-ensina`, flow
  `flow_20261015172738769_2700_0001`, veredito positivo): quatro defeitos de
  ensino corrigidos fora do monolito. (R-01) a cascata do `spt_validate` morreu
  — `SPT_CONTRACT_INVALID` (causa raiz de semantica/schema) agora vem ANTES de
  `SPT_CONTRACT_WORKSPACE_MISMATCH`/`OBJECTIVE_MISMATCH` em
  `src/spt-path-diagnostics.ts`, porque workspace/objective so sao avaliaveis
  com contrato valido (antes: semantica quebrada gerava WORKSPACE_MISMATCH
  falso via `contract=null` cascateando o check); (R-02) precedencia
  existencial — `spt_exists`/`spt_is_file` antes de `spt_under_plan_tasks` no
  validador e no `ppirtv_trace` (`src/provenance-trace.ts`), entao path
  inexistente fora de PLAN-TASKS recebe `SPT_PATH_NOT_FOUND` em vez da
  afirmacao falsa "The SPT exists outside"; (R-03) branch `FLOW_NOT_FOUND` no
  `classifyToolError` (`src/server.ts`): ENOENT de `flows/flow_*.json` vira
  envelope com `flow_id`, hint e `next_required_action` apontando
  `goal_status detail=full` — ENOENT cru sobrevive apenas em
  `details.original_error`; (R-04) `presentGate` (`src/presentation.ts`)
  anexa `review_evidence_diagnostics` recalculado quando o gate de revisao
  bloqueia com review anexada — o escopo movel por `changed_files` fica
  visivel (`scope_reference_not_authorized`) sem tocar o engine. Suíte nova
  `tests/spt-validator-teaching.test.ts` (7 testes) + regressao do teste
  antigo de trace que codificava o bug (expectativa atualizada para
  `spt_path_missing`). Bateria 616/616 (35 suites); `src/flow-engine.ts`
  intocado. Re-medição do baseline fase 2 com agente virgem
  (`.agents/AUDITORIAS/2026-10-15-fase2-remedicao-baseline.json`): o envelope
  sustentou a jornada black-box inteira (74 chamadas, zero leitura de
  src/docs, `required_tool_sequence` executado sem arqueologia); novo achado
  estacionado `EST-20261015-FINGERPRINT-NAO-EXPOSTO` (P1: fingerprint do
  review_required nao exposto de forma enxuta).

- Fase 2A do envelope que ensina (Trilho 2026-10-15 `envelope-fase2-a`, flow
  `flow_20261015160535398_2663_0001`): (1) oracle de sequencia no
  `scripts/audit-error-envelope.mjs` valida os steps ensinados pelas mensagens
  fiscais contra o `inputSchema` vivo de `tools/list` (duas testemunhas
  independentes; `--strict` exit 0; o RED historico do enum `decisao` virou
  teste permanente no vitest); (2) o fio real do erro de input na fronteira —
  override feature-detected de `McpServer.validateToolInput` em
  `src/server.ts` transforma a falha de validacao zod no envelope
  `PPIRTV_INPUT_INVALID` com `field/received_type/expected_type/example` e
  `next_required_action` (antes o SDK devolvia a message crua), com teste de
  fronteira spawn real (`tests/server-boundary.test.ts`) que pinta RED se o
  override sumir em upgrade do SDK; (3) o contrato do envelope agora documenta
  o fio real em vez de prometer validacao server-side inexistente e os campos
  quentes `cooperators`, `active_credits` e `write_policy` ganharam
  `.describe()` no `tools/list`; (4) fiscal camping reconhece cadeia coberta
  no diff acumulado `origin-main..HEAD` (`scripts/validate-flow-engine-boundary.mjs`):
  sufixo contiguo do ledger conectando `base_blob` a `head_blob` com
  diff-replay por janela + markers por record + ultimo record integral — a
  janela local commit->push deixa de ficar vermelha sem causa no codigo
  (reason renomeado `LEDGER_REQUIRES_APPENDED_RECORDS_COVERING_DIFF`;
  teste e2e com fixture origin/main). Bateria: 34 suites / 609 testes verdes,
  `npm run check` exit 0, `flow-engine.ts` intocado.

- Erro que ensina (Trilho 2026-10-15 `erro-que-ensina`): a
  mensagem fiscal bloqueada agora ensina split, numeros e rota de destravamento
  — `attempt_regress_count` e acompanhado dos codigos desambiguados
  `attempt_regress_limit_reached`/`attempts_insufficient_before_positive_verdict`
  com `attempt_count/regress_count/max/meetings` no blocker, o envelope
  `src/error-envelope.ts` projeta `next_required_action` com sequencia literal
  (`goal_meeting_open(suggested_cooperators=...) -> goal_meeting_close ->
  goal_verdict(meeting_id)`) no lugar da rota circular `goal_status`, segmentos
  `required_cooperation=` vazios sao omitidos na superficie MCP, familias de
  codigo sem tradutor ganham rota de destravamento, `goal_advance` blocked
  expoe `gates_pending`, erros de input ensinam
  `field/received_type/expected_type/example` e o parse de SPT anexa hint de
  quote para itens YAML com dois-pontos. Contrato:
  `docs/contracts/MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md`.
- Correcao da bateria adversarial (2026-10-15, 11 revisores + kimi CLI): a
  sequencia literal ensinada usava `type: "decisao"` (valor invalido no enum
  `MEETING_TYPES`; correto: `"decision"`) e omitia campos obrigatorios
  (`meeting_id` no `goal_meeting_close`; `status`/`rationale`/`next_step` no
  `goal_verdict`) — copiar a sequencia ao pe da letra quebrava no schema vivo.
  Corrigido em `src/error-envelope.ts` (meetingSequence); 602 testes verdes,
  audit `codigos_sem_next_required_action=0`. Dividas honestas da bateria
  estacionadas: envelope de input sem call site na fronteira (SDK valida antes
  do handler), cascata hint x workspace-mismatch, precedencia S05 e familia
  MEETING_LOCK sem regra UNBLOCK.
- Rota declarativa com autenticacao server-side no `evidence_add`
  (Trilho 2026-10-14 `evidencia-declarativa-server-side`): o campo opcional
  `declarative_proof` recebe `{task_id, evidence_requirement_id,
  observed_value, paths}` e o servidor deriva requirement/criterion do SPT
  vinculado, computa o `revision_set` com SHA-256 dos paths, carimba o
  timestamp do servidor, aplica defaults sobrescriveis de
  environment/producer/limits e expande para um `criterion_proof` completo por
  criterio em `evidence_requirement.proves` (modulo novo
  `src/spt-declarative-proof.ts`; `src/flow-engine.ts` intocado e continua
  validando cada prova). Tipo de `observed_value` incompativel com o
  expectation falha largo com `SPT_V3_DECLARATIVE_OBSERVED_TYPE` ensinando o
  tipo cru esperado; `declarative_proof` e `criterion_proof` sao mutuamente
  exclusivos. `spt_validate` de SPT v3 valido agora emite `proof_skeletons`
  por evidence_requirement e `scripts/validate-spt.mjs` os expoe, para o
  agente nao adivinhar o payload de prova. Contrato canônico atualizado
  (docs/contracts + copia global, `npm run audit:canonical` verde).

- O contrato de tag governada agora vive em um unico helper
  `src/memory/governed-tag.ts`: o padrao aninhado `#tema/assunto` e a assercao
  de rejeicao deixam de existir em quatro copias independentes (schemas MCP,
  FlowEngine e adapter Dex Memoria V2) e passam a ter definicao unica, com
  rejeicao provada na fronteira MCP stdio, no adapter e nas duas camadas do
  engine. A politica de metadados de promocao V2
  (`requireV2PromotionMetadata`) deixou a fachada para
  `src/memory/mining-policy.ts` no mesmo trilho e o SHRINK do ledger de
  evolucao paga `FE-DEBT-001`.

- A identidade do lock de meeting voltou a distinguir `dev:ino` em caminhos
  normais, mantendo `dev`-only apenas em pastas compartilhadas VirtualBox
  (`\\VBoxSvr`), onde o inode oscila entre `lstat`: o guard detecta troca de
  arquivo no filesystem comum sem gerar falso `MEETING_LOCK_IDENTITY_CHANGED`
  no VBoxSvr (teste focal `tests/lock-identity-vbox.test.ts`).

- A mineracao posterior ao ultimo veredito agora precede o fechamento de um
  GOAL oficial: `goal_advance` bloqueia a conclusao enquanto o ultimo
  `verdict_recorded` for posterior ao ultimo `memory_mined`, sem cursor, campo
  persistente, blocker publico ou schema novo. Um teste MCP preserva o RED
  causal e confirma que a guarda temporal sai depois da nova mineracao.

- Reparo governado do Estacionamento para o piloto semântico: uma ficha já
  promovida teve status, lifecycle e closure reconciliados sem apagar
  proveniência. O writer oficial voltou a aceitar capturas e criou três riscos
  P2 separados para isolamento causal, delta B-A de loops e identidade do
  score receipt. Um P2 lateral sobre itens terminais nos gatilhos de retomada
  foi roteado ao owner do writer; o índice passou a 29 itens e valida sem issues.

- Piloto de nao inferioridade do revisor semantico executado em Mini/Sol low
  A/B e preservado sem rerun cosmetico. A auditoria dos eventos supersedeu o
  primeiro verde: Mini ARM_A leu tres artefatos do tratamento e houve tres
  leituras externas ao snapshot. O resultado correto e
  `causal_comparable=false`, `inconclusive`/`no_promotion`, sem atribuir
  degradacao causal a candidata. O renderer agora prende receipt, manifesto
  normalizado, manager terminal, run, summary, oracle e matriz Mini/Sol 4/4;
  a suite focal passa 57/57. Auditoria lexical detecta violacoes observadas, mas isolamento futuro
  exige workspace fisicamente separado ou telemetria completa.
  `src/flow-engine.ts` permaneceu intocado.

- Contrato experimental de não inferioridade do revisor semântico com matriz
  Mini/Sol low A/B, delta único, fingerprint explícito de ambiente e paths
  observados, rubrica por eixos e limites de custo separados. O novo gate
  `validate-spt-semantic-causal-comparison.mjs` acumula falhas independentes em
  `diagnostics[]` para correção em lote; RED por módulo ausente virou 25/25
  GREEN e a validação suplementar da CLI estruturada fechou 26/26. O scorer
  separado de não inferioridade distingue degradação, benefício e inconclusão
  em sete eixos; as três suítes combinadas passam 33/33. Nenhuma lane,
  promoção, MCP de produto ou `src/flow-engine.ts` foi acionado.

- Contrato experimental do piloto semantico endurecido para ligar ARM,
  fixtures, manifesto normalizado, manager terminal e run root exato. A suite
  focal rejeita manager em execucao, terminal com erro e `artifact_root`
  cruzado; o piloto v5 autentico permaneceu valido 4/4. O resultado nao foi
  promovido: score estrito 0/4, reviewer timeout sem decisao semantica e gaps
  prospectivos de `recoverable`, `candidate_evaluation` e budget permanecem
  documentados. `src/flow-engine.ts` nao foi tocado.

- Squad local `squad-spt-semantic-admission` com autoria publica de SPT,
  separacao entre produtor, operador, validator e reviewer, e piloto A/B
  read-only em Mini/Sol. O forward-test preservou um RED: tres lanes completas
  ignoraram os fixtures e pontuaram `0/3`, uma expirou e o schema de
  `benchmark_ok` aceitou completude superficial. A candidata nao foi promovida
  e o MCP completo permaneceu bloqueado; o proximo corte deve exigir fixture
  IDs/ARM exatos e terminal fail-fast do reviewer.

- Skill candidata local `dex-ppirtv-validate-spt` para revisar viabilidade
  semantica depois de `spt_validate`, sem alterar o SPT ou o runtime MCP. Um
  forward-test cego com tres fixtures estruturalmente validas aceitou o caso
  feliz e detectou uma ambiguidade material e uma impossibilidade contratual;
  scorer independente 3/3 e review terminal liberam apenas um futuro Trilho de
  admissao, mantendo instalacao global bloqueada.

- Experimento isolado `EvaluatePhaseGate` sob `src/vnext/phase-gate/`, sem
  consumidor de producao e sem alterar `src/flow-engine.ts`. O slice compara
  decisoes semanticas com o oraculo atual, cobre blockers de fase e fechamento
  terminal, impede escalada por historico/fingerprint ausente, recupera resumo
  serializado por port read-only e preserva rollback pela remocao integral da
  fronteira. O microbenchmark mede core e oraculo separadamente e nao representa
  ganho de velocidade do produto.

- Decisão arquitetural pública para a vNext do PPIRTV: compara evolução do
  runtime atual, núcleo compatível isolado e greenfield; preserva a versão
  funcional como oráculo/rollback, define gate proporcional para novo
  repositório, separa fases visíveis de evidências exclusivas e propõe um
  primeiro experimento `EvaluatePhaseGate` side-by-side. O mapa também registra
  a capacidade parcial existente de escalada de loops e a lacuna de cobertura
  percebida entre classes de erro e consumidores, sem implementar produto.

- Catálogo tipado e fail-closed de efeitos MCP para as 32 tools públicas. O
  `tools/list` agora expõe `readOnlyHint`, `destructiveHint`,
  `idempotentHint` e `openWorldHint` em todas elas; `runtime_probe` é declarado
  leitura idempotente de mundo fechado e usa inspeção do adapter que não
  inicializa `.ppirtv` nem o ledger; seu receipt declara `mutated=false`. A
  matriz pelo efeito máximo contém 3 tools
  somente leitura, 11 aditivas e 18 mutantes: consultas que ainda inicializam o
  store são declaradas aditivas, evidências que podem substituir o fingerprint
  de implementação são mutantes e retries terminalmente congelados preservam
  idempotência. O contrato público explica a fronteira
  de aprovação headless e proíbe resolver cancelamentos com filtro, proxy,
  wrapper ou renomeação exclusiva de laboratório. Testes e smoke validam o
  transporte real das annotations; a dívida comum de inicialização em APIs de
  leitura do store permanece explícita para Trilho próprio.

- Snapshot público e imutável do sistema em 2026-08-03, com identidade Git e
  runtime, CRG sincronizado, limites do benchmark Compact v3, mapa da
  arquitetura atual e caminho sequenciado para a próxima versão. Um contrato
  público de versionamento agora separa versão declarada, release comprovada,
  versões de contrato e versões documentais; `0.2.0` é somente candidata
  condicional até a auditoria de compatibilidade, sem bump, tag ou release
  neste corte.

- Gate `PPIRTV-FLOW-ENGINE-RESPONSIBILITY-BALANCE` para toda edição de
  `src/flow-engine.ts`: o fiscal read-only classifica o diff como `SHRINK`,
  `CONTAIN`, `EXCEPTION` ou `FAIL`, vincula a declaração a blobs Git, rejeita
  crédito por formatação/exclusão alheia e exige consumidor, evidência, dívida
  e próxima ação. O ledger é append-only daqui em diante; comparação explícita
  não oculta worktree sujo, somente `SHRINK` paga dívida, e consumidor, RED,
  expiração e marcadores precisam de prova verificável. O desenho arquitetural vivo e o ledger público registram
  extrações já realizadas, `FE-DEBT-001`, próximos seams e a obrigação de
  atualizar este changelog; consultas sem alteração retornam
  `NOT_APPLICABLE`.

- Índice público de documentação, quickstart/FAQ operacional para agentes
  pequenos e contrato reproduzível de relatos cross-repo. Os dois documentos
  novos são publicados por links em `README.md`, `AGENTS.md`, `docs/INDEX.md`
  e `INDEX.md`, com teste contra regressão de achabilidade.

- O contrato puro de consumo de recall agora vive em
  `src/memory/recall-consumption-contract.ts`, com normalização, validação,
  limites, erro e comparação testados diretamente. `FlowEngine` preserva a
  fachada pública e mantém somente a orquestração de ledger/store, sem mudar
  schemas, mensagens, idempotência ou o consumidor MCP existente.
- Mapa de missão do acampamento `src/flow-engine.ts`, apoiado por Code Review
  Graph sincronizado no HEAD `03423df`: documenta 8.678 linhas, sete regiões
  de responsabilidade, consumidores reais, hotspots, seams de extração por
  ondas e um primeiro experimento reversível, sem alterar código de produto.
- Receipt local do Code Review Graph reconciliado para 1.710 nós, 27.751
  arestas e 64 arquivos, com `head_matches_build=true`, backup do registry,
  hash do banco e limite explícito da consulta divergente de fluxos afetados.

- Trilhos SPT v3 agora possuem um grafo canônico de requisitos, critérios,
  tasks e requisitos de evidência. `spt_validate` publica
  `contract_version=3` e `execution_eligible=true`; provas por critério derivam
  a expectativa do SPT vinculado, e vereditos positivos permanecem bloqueados
  até cobrir todos os critérios mínimos. SPT v2 continua legível e reutilizável
  por retry exato, recovery ou reconciliation explícitos, mas não inicia nova
  execução oficial.

### Corrigido

- O fiscal de higiene V2 deixou de classificar o índice histórico
  `conhecimento/INDEX.md` como rota V2 rejeitada. A detecção agora reconhece
  como candidato L3 apenas uma rota aninhada sob `conhecimento/`, mantendo
  bloqueio para traversal, URI, anchor, backslash e sufixo invalido em rotas V2 L2/L3. O RED e
  o GREEN cobrem parser e `hygiene_scan`; corpora de memória permanecem
  intocados e processos MCP persistentes ainda exigem rebuild/reconexão para
  carregar o reparo.

- `spt_path` agora tem ownership acionavel de ponta a ponta: `spt_validate`,
  `goal_start` e `ppirtv_trace` devolvem `code`, `owner`, `field`, `reason`,
  `next_required_action` e `recoverable` nas falhas cobertas. O trace resolve
  paths relativos contra `project_root`, deixa de silenciar SPT existente fora
  de `PLAN-TASKS` e distingue binding persistido sem path de arquivo SPT
  ausente, sem reescrever flows ou ledger historicos.
- `GOAL_EXECUTION_BRIDGE.md` deixou de ensinar SPT v2 como contrato de nova
  execucao e agora aponta SPT v3, a cadeia de ownership e a obrigacao de repetir
  a chamada corrigida. O contrato canonico global/local publica a matriz A-J.

- O README agora ensina corretamente que novas execuções exigem SPT v3 e
  limita v2 a histórico, retry exato, recovery e reconciliation, alinhando a
  introdução pública ao contrato canônico e ao schema vivo de `goal_start`.

- `evidence_add` agora rejeita `reviewed_implementation_fingerprint` sem uma
  atestação estruturada de review, em vez de retornar sucesso e descartar o
  fingerprint silenciosamente. O contrato MCP e o contrato SPT canônico
  documentam a exigência de `kind`/`satisfies`, o erro acionável e o nesting
  estrito de `criterion_proof`, com exemplo JSON completo e sincronizado entre
  a fonte global e a cópia versionada.
- O detector fiscal de risco recorrente agora exige contexto de falha para
  `recorrente`, evitando que o nome legítimo `Recorrentes V2` gere
  `attempt_regress_count`. O controle `Erro recorrente` permanece bloqueado;
  `tentativa` e `regress` foram preservados por compatibilidade até RED causal
  próprio. A correção é geral e não altera produto, UI, dados, schema ou deploy
  do PremierFinanceiro.
- Evidências de review de flows com `changed_files` agora usam somente esses
  paths como autoridade e deixam de publicar ou aceitar frases operacionais de
  `scope.in` como alvos revisáveis. A cobertura integral dos arquivos e dos
  critérios SPT v3 permanece fail-closed; flows legados sem `changed_files`
  preservam o fallback histórico comprovado para `scope.in`.
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

- O patch isolado de annotations MCP é candidato a mudança `MINOR` aditiva,
  mas a auditoria do conteúdo acumulado em `Unreleased` encontrou risco
  `MAJOR` por contratos anteriores de SPT v3, defaults e fechamento. Nenhum
  bump, tag ou release foi autorizado; o owner de release ainda deve decidir
  migração compatível ou declaração explícita da quebra.
- Nao houve bump de versao, tag ou release. O risco de incompatibilidade
  acumulada permanece explícito e a versão continua a confirmar pelo owner de
  release; nenhuma quebra foi publicada por este Trilho.
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
