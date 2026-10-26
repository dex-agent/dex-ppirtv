# CAPACITY â€” Mapa de Capacidades dex-PPIRTV

> Fotografia estÃ¡tica gerada pela skill `dex-mapa-capacidades` no corte
> **commit `947fdb4` (2026-10-18)**. NÃ£o Ã© checklist vivo: nova mediÃ§Ã£o exige
> novo pedido/execuÃ§Ã£o da skill. NÃ£o editar Ã  mÃ£o o veredito das linhas â€”
> regenerar. Espelho comentado (matriz de 10 colunas com limites por linha):
> `.agents/AUDITORIAS/2026-10-18-mapa-capacidades-947fdb4.md` (local, nÃ£o
> versionado).

## Identidade da fotografia

| DimensÃ£o | Valor |
| --- | --- |
| Objeto | dex-PPIRTV â€” servidor MCP executor PPIRTV (goal/flow/gate/evidence/memory) + launcher global + dex-agent local |
| Fotografia/revisÃ£o | commit `947fdb4`, suite 666 passed \| 4 skipped, build verde, tools/list 32 ao vivo |
| Ambiente | Windows Server, Node 24.16, workspace `C:\CodexProjetos\dex-PPIRTV`, MCP stdio local |
| Fontes vivas | `dist/index.js` + `dist/launcher.js`, `src/`, `tests/` (44 arquivos), ledger camping (10 records selados), receipts em `.agents/AUDITORIAS/EVIDENCIAS/` |
| Escopo | Capacidades acionÃ¡veis por consumidores (agente MCP, dono, casa) |
| Fora de escopo | Skill registry global, projetos consumidores, vNext nÃ£o decidido |

**ConvenÃ§Ã£o de estado (honestidade)**: `comprovada` = orÃ¡culo independente ao
vivo no corte OU suÃ­te dedicada verde; `parcial` = implementada + suÃ­te verde,
sem jornada de consumidor viva no corte; `nÃ£o comprovada` = sem orÃ¡culo no
corte (nÃ£o Ã© ausÃªncia).

## Reavaliação 2026-10-26 — fechamento hardening-3 + rito P0 (docs-only, zero src)

> Commit de fechamento de governanca: pendencia P0 `PPIRTV-GATE-INTEGRITY-REVALIDATION-2026-10-18` consumida com prova (probe A-F v2 black-box MCP 6/6 no HEAD 113713a; camping cumulativo PASS x2 nas bases 5e7d5df/067d975; suites 17/17; `pendencias.py --valida` VALIDO); flow `flow_20261018140649700_2948_0001` COMPLETE com veredito `pronto_com_ressalvas`; CHANGELOG/laudo Addendum 22/REVIEWS INDEX/Trilho/ACTIVE/HANDOFF reconciliados. Nenhuma capacidade de produto mudou (0 capability files; gate PASS 34 capabilities); fotografia `947fdb4` segue vigente; receipt atualizado apenas em `generated_at`.
## ReavaliaÃ§Ã£o 2026-10-23 â€” snapshot fantasma: sensÃ­vel de runtime de terceiro Ã© redigido, nunca bloqueia

> GO do dono 2026-10-23, cura da pendÃªncia PPIRTV-VEREDITO-TERMINAL-GATES-
> SNAPSHOT-FANTASMA (flows 0568/0602 do workspace jev travados em
> `REVIEW_SNAPSHOT_SENSITIVE_PATH: .codex/config.toml`). DiagnÃ³stico com
> evidÃªncia: o guarda (sensÃ­vel por nome, desde f9a63f1) estava certo, mas a
> fronteira errada â€” `GIT_CORROBORATION_EXCLUDED_PREFIXES` (l.101) cobria
> .git/.ppirtv/.agents e NÃƒO os dot-dirs de runtime de outros hosts; e o
> merge nÃ£o-filtrado foi PERSISTIDO no changed_files do flow (416 paths no
> 0568, o universo untracked inteiro), de modo que remover o arquivo do
> disco nÃ£o curava e reiniciar o servidor tampouco. Delta do corte
> (review-snapshot.ts + error-envelope.ts + testes; flow-engine.ts
> intocado): (1) prefixos += `.codex/`, `.zcode/` (ruÃ­do automÃ¡tico de
> runtime de qualquer host nunca entra pela corroboraÃ§Ã£o); (2)
> `fingerprintReviewedImplementation` REDIGE path sensÃ­vel sob prefixo de
> runtime como entrada `{state: "redacted_runtime"}` (conteÃºdo NUNCA lido
> nem hasheado) em vez de lanÃ§ar â€” cura flows jÃ¡ envenenados sem restart e
> sem cirurgia; sensÃ­vel FORA de runtime dir (`.env`, `.npmrc`, `config.toml`
> de produto na raiz, `vendor/*/.git/config`) continua fail-closed; (3)
> envelope REVIEW_SNAPSHOT_PATH_INVALID ensina a causa real e a rota (path
> de terceiro corroborado; tirar do workspace/changed_files). Provas: RED
> 2/3 falhas antes do fix; suite 716|4 (pÃ³s-rodada); probe da vÃ­tima real â€” fingerprint
> do flow 0568 com os 416 paths persistidos (incluindo .codex/config.toml)
> computa SEM throw no build novo; teste de independÃªncia prova que o
> conteÃºdo redigido nunca altera o hash. Contrato atualizado: `.git/config`
> na raiz passa a ser redigido (ruÃ­do de runtime), teste gate-resolution
> ajustado com comentÃ¡rio. Base `ba6bb85`. RODADA ADVERSARIAL (1, fixes
> aplicados antes do push): redaÃ§Ã£o vale para TODO path sob prefixo de
> runtime apÃ³s resoluÃ§Ã£o lexical (nÃ£o sÃ³ sensÃ­vel-por-nome) â€” cura tambÃ©m o
> modo strict do attach de review (REVIEW_SNAPSHOT_FILE_REQUIRED por path
> runtime ausente morre; vÃ­tima 0568 resolve em strict), impede
> leitura/hash de runtime nÃ£o-sensÃ­vel (.zcode/), fecha o traversal
> .codex/../.env (fail-closed de produto preservado) e despirra aspas
> literais de path persistido sujo (famÃ­lia input-unwrap). Suite 716|4;
> description de goal_verdict atualizada. Selagem: Trilho CONCLUÃDO,
commit e533f6a PUSHED; vÃ­tima 0568 provada em modo strict; aÃ§Ã£o consumidor
= fleet update do jev + reanexar review.

## ReavaliaÃ§Ã£o 2026-10-21 â€” fiscal auto-ressalva: required_cooperation ensina a receita e review_required lidera o composto

> GO do dono 2026-10-21 ("menor corte possÃ­vel com o maior ganho, sem
> reinventar a roda") para a trava recorrente de 10 meses do blocker
> `required_cooperation`. Delta deste corte (texto/schema/contrato/teste â€”
> zero mudanÃ§a de lÃ³gica do gate; `src/flow-engine.ts` intocado):
> (1) `src/error-envelope.ts` â€” a sequÃªncia ensinada (`meetingSequence`)
> agora carrega `satisfies_blockers: ["required_cooperation"]` +
> `participants_present` no passo da `goal_meeting_close` e `evidence_ids`
> no verdict, o reason da branch `register_required_cooperation` ensina a
> receita literal (close com satisfies_blockers + participantes + verdict
> com meeting_id/evidence_ids; preencher apenas cooperators nÃ£o satisfaz) e
> nasce a branch `attach_structural_review_before_meetings` como PRIMEIRA:
> no bloqueio composto, `review_required` lidera (goal_status full â†’
> evidence_add kind code_review espelhando `reviewRequiredSequence` do
> engine, com scope_classification/scope_reference e arrays de substituiÃ§Ã£o
> nÃ£o vazios + fingerprint vigente â†’ goal_meeting_open â†’ close com
> participants_present/satisfies_blockers â†’ verdict com
> evidence_ids/meeting_id); no review puro, verdict SEM meeting_id;
> (2) `src/server.ts` â€” description viva de `goal_meeting_close` ensina a
> receita, `satisfies_blockers` ganha `.describe()`
> (`INPUT_FIELD_DESCRIPTIONS`) e o branch `provide_meeting_id_for_verdict`
> do `classifyToolError` respeita a lideranÃ§a do review_required; (3)
> contrato `GOAL_SPT_CANONICAL_CONTRACT.md` (global+local,
> `audit:canonical` verde) ganha o bullet da forma de satisfaÃ§Ã£o +
> lideranÃ§a do composto + pointer para GOAL_EXECUTION_BRIDGE; (4)
> `tests/error-envelope.test.ts` com asserts literais (RED provado: 3
> novos falharam antes do fix) + rodada de correÃ§Ã£o da revisÃ£o adversarial
> em 2 voltas (F1 open ausente, F2 participants_present, F3 payload sem scope_*, F4
> evidence_ids, F5 precedÃªncia sobre attempt-branches, F6 guarda no server,
> F7 fixture alinhado ao schema vivo, F8 meeting_id no review puro, F4-residual da rodada 2: rationale
> com o literal "cooperacao material" rearma o blocker no verdict
> (positiveMeetingTrigger flow-engine l.5179) â€” rationales neutralizadas +
> teste de regressÃ£o travando os literais).
> Provas: suite 711 passed | 4 skipped (54 arquivos);
> `audit-error-envelope` 33 famÃ­lias / 0 sem rota / 8 sequÃªncias vÃ¡lidas
> contra schema vivo; probe MCP stdio `tools/list` 7/7 PASS. Base `424b1ca`.

## ReavaliaÃ§Ã£o 2026-10-18 â€” frentes 2 e 3: unwrap profundo + leitura que responde + SHRINK FE-DEBT-001

> GO do dono apÃ³s auditoria por print (pedido Ã— entendimento Ã— entrega).
> Causa-raiz do loop eterno do consumidor decifrada no cÃ³digo: o flow velho
> persistiu `gates[implementacao].provided.changed_files` com elementos
> `{"value": X}` e o `goal_status` compact/full rejoga esse provided no
> `checkGate`, onde `strictPathArray` lanÃ§ava DENTRO da tool de leitura.
> Entregue: (1) `src/input-unwrap.ts` novo â€” desembrulho profundo (arrays e
> objetos aninhados, teto de profundidade) no ponto Ãºnico da fronteira para
> TODAS as tools + `sanitizePersistedProvided` (replay de dado persistido
> sujo Ã© saneado; drop nunca adiciona satisfaÃ§Ã£o â€” fail-closed honesto);
> (2) as tools de diagnÃ³stico com handler tolerante (`goal_status`,
> `flow_status`) nunca rejeitam por forma na fronteira; as demais mantÃªm o
> envelope ensinante com rota (identificaÃ§Ã£o com referÃªncia, nÃ£o loop); (3) `normalizeReviewPathForPlatform` tolera nÃ£o-string e o
> helper `unique` do monolito descarta nÃ£o-strings legados (fim do
> `value.trim is not a function`/`[object object]` crÃ­ptico); (4) visita
> SHRINK ao monolito paga FE-DEBT-001: classificadores de `spt_path`
> migram para `src/spt-path-diagnostics.ts`. CritÃ©rio de aceite = replay do
> transcript real do consumidor: `tests/consumer-replay-jumper.test.ts` 4/4
> (RED provado antes do fix) + `tests/input-unwrap.test.ts` 9/9;
> `npm run check:flow-engine` PASS modo SHRINK. Prova estendida aos trÃªs modos de `detail` (lean default, compact e full) no mesmo flow sujo. Selado no commit `9a96e92`
> (blobs conferidos: base `c01421a` â†’ head `cb629ce`).

## ReavaliaÃ§Ã£o 2026-10-18 â€” fronteira de input nunca bloqueante (unwrap + ressalvas)

> Diretiva do dono: problema vai ocorrer com 100% de certeza; quando ocorrer,
> Ã© identificado e NUNCA bloqueante â€” ressalva com referÃªncia do local.
> Implementado no desenho mÃ­nimo (ponytail + chato + jev-gate-principios):
> (1) `unwrapClientValueWrappers` (12 linhas) no override de
> `validateToolInput` â€” o artefato de cliente `{"value": X}` Ã© desembrulhado
> em UM ponto para TODAS as tools e campos de topo (laudo consumidor jumper:
> 14 retries); (2) `src/review-input.ts` (92 linhas, extraÃ­do do monolito,
> âˆ’83 em `src/server.ts`): unwrap de domÃ­nio nas 6 chaves de review +
> validador que agora gera `review_input_ressalvas` no receipt em vez de
> `PPIRTV_INPUT_INVALID` bloqueante; o gate de veredito segue fail-closed no
> substancial. Provas: `tests/review-input.test.ts` 3/3,
> `tests/evidence-add-review-wire.test.ts` 5/5 (RED provado contra dist
> antigo), `tests/mcp-tool-describe.test.ts` com frases literais do novo
> contrato; suÃ­te 691 passed | 4 skipped.

## ReavaliaÃ§Ã£o 2026-10-18 â€” contratos de corroboraÃ§Ã£o documentados no help vivo

> `goal_start` e `goal_verdict` descriptions agora ensinam `git_head_base`
> congelado, `git diff base..HEAD`, fail-closed em base Ã³rfÃ£ e a rota de
> resoluÃ§Ã£o de `review_required` (evidence_add com as 6 flat keys). Fonte
> Ãºnica: `tools/list` â€” `--help/--schema/--usage/--describe/--list` do
> entrypoint e do harness herdam a mesma description (OCP: um ponto de
> escrita, todos os canais). Prova documental:
> `tests/mcp-tool-describe.test.ts` 4/4 (novo assert de frases);
> probes ao vivo nos 5 modos; suÃ­te 686 passed | 4 skipped.

## ReavaliaÃ§Ã£o 2026-10-18 â€” corroboration por commit (NOVO-1/NOVO-2) + SHRINK FE-DEBT-003

> `goal_start` congela `git_head_base`; `goal_verdict` corrobora COMMITS via
> `git diff base..HEAD` (fail-closed em base orfa exige review) e runtime
> `.git/`/`.ppirtv/`/`.agents/` sai do ruÃ­do de corroboration.
> `flowWithCurrentImplementationFingerprint` deixa o monolito (SHRINK paga
> `FE-DEBT-003`; camping PASS SHRINK). RED-first:
> `tests/git-corroboration-commits.test.ts` 4/4 (burla commit-then-verdict
> NOVO-1 reprovada; doc-only legÃ­timo NOVO-2 aceito; base orfa fail-closed);
> probes MCP H3 3/3 (laudo adendo 3); suÃ­te 685 passed | 4 skipped.
> LimitaÃ§Ã£o declarada: flow iniciado SEM git nÃ£o tem baseline â€” corroboraÃ§Ã£o
> por commit sÃ³ existe quando o repo preexiste ao primeiro binding.

## ReavaliaÃ§Ã£o 2026-10-18 â€” hardening-3 + gate de commit

> Recibo canÃ´nico machine-readable: [CAPACITY.receipt.json](CAPACITY.receipt.json)
> (`dex.capacity.snapshot.v1`). A matriz abaixo Ã© a vista humana; o gate lÃª o
> recibo e exige ambos staged antes do commit.

> ReavaliaÃ§Ã£o do worktree sobre a fotografia `947fdb4`. NÃ£o substitui a
> fotografia histÃ³rica; registra o delta observado e as limitaÃ§Ãµes antes do
> prÃ³ximo commit.

| Capacidade | Delta observado | EvidÃªncia |
|---|---|---|
| CAP-02 gates tipados | `changed_files`/`deleted_files` agora rejeitam escalar/objeto antes do merge; `[]` bloqueia | probe A/A2, teste R2, suÃ­te 679 |
| CAP-08 invalidaÃ§Ã£o same-path | gate de revisÃ£o stale exige `review_current` e review estruturada atual; claims-only nÃ£o reabre | probe B, teste R3 |
| CAP-11 mechanical documental | veredito corrobora `changed_files` contra o diff Git real E commits via `git diff base..HEAD` (base congelada no primeiro `goal_start`; base orfa fail-closed); sem `.git` no start a limitaÃ§Ã£o Ã© declarada | tests/git-corroboration-commits.test.ts 4/4; probes H3 3/3 |
| CAP-16 fiscal camping | visita CONTAIN PASS; `FE-DEBT-003` aberto para extrair a cola restante | `npm run check:flow-engine` PASS |
| CAP-17 selagem pÃ³s-commit | `598ae5d` per-commit continua FAIL por selagem em `76e9c94`; exceÃ§Ã£o documentada | replay per-commit/cumulativo |
| CAP-07 scaffold de review | server boundary remove `[object Object]`/nao-string de `reviewed_targets`/`scope_reference` e cai para placeholder | `tests/server-review-scaffold.test.ts` 2/2 |
| CAP-33 gate de capacidades | `CAPACITY.receipt.json` Ã© a fonte canÃ´nica; hook bloqueia commit sem receipt + vista humana staged | `tests/capacity-gate.test.ts` 1/1 + `tests/capacity-receipt.test.ts` 1/1 |
| CAP-34 help/schema/usage por tool | `--describe/--schema/--usage` funcionam no `dist/index.js` e no harness; sem tool falham com help, sem hang | `tests/tool-cli-entrypoint.test.ts` 4/4 + `tests/mcp-tool-describe.test.ts` 3/3 |

**EvidÃªncia do corte:** `npm run check` 681 passed | 4 skipped; build verde;
`check:flow-engine` PASS CONTAIN; `tests/gate-integrity-hardening-3.test.ts`
4/4; `tests/capacity-gate.test.ts` 1/1; `tests/mcp-tool-describe.test.ts`
3/3; `tests/tool-cli-entrypoint.test.ts` 4/4; `tests/server-review-scaffold.test.ts`
2/2; `tests/capacity-receipt.test.ts` 1/1;
`npm run check:capacity` PASS;
probes A/A2/B/C/D/E/F/G. A matriz completa herda o espelho 947fdb4; o delta
revalidou CAP-02/08/11/16/17/33/34. **LimitaÃ§Ãµes:** R5 permanece decisÃ£o documentada
(evidence genÃ©rico aceita `criterion_proof`; review stale Ã© contido por R3);
R7 per-commit Ã© exceÃ§Ã£o documentada; sem `.git` nÃ£o hÃ¡ corroboraÃ§Ã£o de diff.
`FE-DEBT-003` aberto. A pendÃªncia P0
`PPIRTV-GATE-INTEGRITY-REVALIDATION-2026-10-18` continua **aberta**.

## Matriz de capacidades

| ID | Capacidade | Estado | OrÃ¡culo que decidiu |
|---|---|---|---|
| CAP-01 | goal_start com SPT v3 (binding, idempotÃªncia, revalidaÃ§Ã£o, guard de segredo nos risks do contrato) | **comprovada** | CerimÃ´nia viva + probe runtime rejeitou segredo em `spt.risks` |
| CAP-02 | Gates de fase tipados fail-closed (R2/R10) | **comprovada** | Bateria 13/13 â€” `[]`/`"false"`/`0`/`{}` rejeitados |
| CAP-03 | DiagnÃ³stico `field/received/expected` no preflight (R8) | **comprovada** | Teste R8 + probe dist devolveu o diagnÃ³stico real |
| CAP-04 | Retorno sem salto para frente (R1; mesma fase = regresso fiscal legal) | **comprovada** | Bateria R1 + 3 testes legados vivos verdes |
| CAP-05 | Veredito canÃ´nico com cobertura de critÃ©rios | **comprovada** | Jornada viva: 1Âª tentativa reprovada (C-2/C-4/C-6); 2Âª com 20 ids passou |
| CAP-06 | Rota declarativa `declarative_proof` 1â†’N | **comprovada** | 20 criterion_proofs criados; quickstart Â§Declarative route |
| CAP-07 | Review estrutural com fingerprint + cobertura integral de changed_files | **comprovada** | Review parcial 5/11 rejeitada ao vivo; integral passou |
| CAP-08 | InvalidaÃ§Ã£o de gates por fingerprint same-path (R3) | **comprovada** | Bateria R3 (bloqueio) + nÃ£o-regressÃ£o (reuse legÃ­timo) |
| CAP-09 | Fluxo manual legado sem goal_binding | **comprovada** | Teste legacy verde (nÃ­vel suÃ­te) |
| CAP-10 | Segredo rejeitado antes de persistir | **comprovada** | Bateria R4 Ã—3 portas + flow JSON limpo conferido |
| CAP-11 | Fast-track mechanical sÃ³ para diff documental (R6, allowlist invertida) | **comprovada** | Veredito mechanical com `scripts/deploy`/`Makefile` reprovado |
| CAP-12 | MineraÃ§Ã£o append-only + idempotÃªncia no ledger | **comprovada** | 3 eventos `memory_mined` no corte (prÃ©+pÃ³s-veredito idÃªntico anexou) |
| CAP-13 | ResoluÃ§Ã£o de candidatos de memÃ³ria | **comprovada** | Recibo MGL (descarte com rationale) + suÃ­te |
| CAP-14 | IntegraÃ§Ã£o dex-memoria V2 (receipts COMMITTED) | **comprovada** | 2 receipts reais; L1â†”L2 confirmado |
| CAP-15 | Seletor de memÃ³ria (bins + probe) | **parcial** | e2e 12 verdes + bins; sem jornada viva no corte |
| CAP-16 | Fiscal camping (SHRINK/CONTAIN/EXCEPTION + ledger + markers) | **comprovada** | Replays PASS; EXCEPTION de integridade aceita |
| CAP-17 | Selagem pÃ³s-commit de records (R7) | **comprovada** | Probe adversarial: selagem mentirosa REPROVA; record selado no commit |
| CAP-18 | Replay cumulativo em cadeia (`5e7d5df..HEAD`) | **comprovada** | PASS com cadeia de 4 records |
| CAP-19 | Servidor direto stdio (`dist/index.js`) | **comprovada** | `tools/list` real: 32 tools com schemas |
| CAP-20 | Launcher global com contrato workspace+cwd | **comprovada** | Sem sinal â†’ erro tipado; com sinal â†’ `ok:true` (2 orÃ¡culos) |
| CAP-21 | runtime_probe | **comprovada** | Presente em toda chamada de harness |
| CAP-22 | ppirtv_trace / arqueologia evolutiva | **parcial** | SuÃ­te verde; sem consumo vivo no corte |
| CAP-23 | spt_validate standalone | **parcial** | SuÃ­te verde; no corte sÃ³ via revalidaÃ§Ã£o interna do goal_start |
| CAP-24 | ReuniÃµes / required_cooperation | **parcial** | SuÃ­te verde; sem reuniÃ£o viva no corte |
| CAP-25 | hygiene_scan / lixeira com manifesto | **parcial** | SuÃ­te verde; sem scan vivo no corte |
| CAP-26 | mm_pipeline_run (orquestraÃ§Ã£o em lote) | **parcial** | SuÃ­te verde; missÃ£o do corte foi single-flow |
| CAP-27 | ppirtv_checkout | **parcial** | SuÃ­te verde; fechamento do corte usou goal_status |
| CAP-28 | checklist_render (fluxo visual) | **parcial** | Tool viva no tools/list; sem render no corte |
| CAP-29 | DocumentaÃ§Ã£o publicada achÃ¡vel | **parcial** | Estrutural (INDEX + rotas AGENTS); link-checker nÃ£o executado |
| CAP-30 | PLAYBOOK projeÃ§Ã£o externa + hook anti-drift | **comprovada** | Hook FRESCO nos commits do corte |
| CAP-31 | Versioning/snapshot de produto | **nÃ£o comprovada** | Estritamente documental; sem decisÃ£o de versÃ£o no corte |
| CAP-32 | Dex Agent Telegram (Ã¡udio/proativo) | **comprovada** | Receipts reais messageId 879/880 (print nÃ£o exercitado) |
| CAP-33 | Gate de reavaliaÃ§Ã£o de capacidades antes de commit | **comprovada** | `npm run check:capacity` + hook pre-commit desta visita |
| CAP-34 | Help/schema/usage read-only por tool MCP (entrypoint + harness) | **comprovada** | `dist/index.js --describe/--schema/--usage` + `tests/tool-cli-entrypoint.test.ts` 4/4 |

## Mapa relacional estÃ¡tico

```mermaid
flowchart LR
  subgraph Consumidores
    A[Agente MCP]
    D[Dono da casa]
    F[Fiscal camping / memoria]
  end
  subgraph CicloGOAL[Capacidades de ciclo GOAL]
    C01[goal_start SPT v3]
    C02[Gates tipados fail-closed]
    C05[Veredito canonico]
    C06[Rota declarativa 1â†’N]
    C07[Review com fingerprint]
  end
  subgraph Integridade
    C04[Retorno sem salto]
    C08[Invalidacao por fingerprint]
    C10[Segredo rejeitado]
    C11[Mechanical so documental]
  end
  subgraph MemoriaECamping
    C12[Mineracao append-only]
    C14[dex-memoria V2]
    C16[Fiscal camping]
    C17[Selagem pos-commit]
  end
  subgraph Entrada
    C19[Servidor direto 32 tools]
    C20[Launcher workspace+cwd]
    C30[PLAYBOOK hook]
  end
  A --> C01 --> C02 --> C07 --> C05
  C06 -. satisfaz gate .-> C02
  C04 & C08 & C11 -. protegem .-> C05
  C10 -. protege .-> C01
  C12 --> C14
  C16 --> C17
  A --> C19
  D --> C20
  D --> C30
  F --> C16
```

## Laudo

- **17 comprovadas com orÃ¡culo vivo**, **9 parciais** (implementadas + suÃ­te
  666 verde, sem consumidor real acionando no corte), **1 nÃ£o comprovada**
  (versioning â€” documental).
- **Endurecidas/novas no corte**: CAP-03, CAP-07, CAP-08, CAP-11, CAP-17 â€”
  todas com RED causal preservado antes do fix.
- **Nota estrutural honesta**: `flow-engine.ts` fechou o corte +12 linhas
  nÃ£o-vazias (EXCEPTION de integridade no ledger, expira no prÃ³ximo diff);
  dÃ­vidas do ledger zeradas; 4 testes skipped (condicionais de ambiente) nÃ£o
  investigados.

## Limites da mediÃ§Ã£o

- Fotografia estÃ¡tica em `947fdb4`; nÃ£o acompanha mudanÃ§as posteriores.
- OrÃ¡culo "vivo" = exercÃ­cio real na sessÃ£o do corte; capacidades parciais
  tÃªm sÃ³ orÃ¡culo de suÃ­te (declarado por linha).
- `nÃ£o comprovada` nÃ£o Ã© ausÃªncia de capacidade.