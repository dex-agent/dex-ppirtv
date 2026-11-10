# FlowEngine Decisions Map — por que o código é assim

`LOCALIZER: PPIRTV-FLOW-ENGINE-DECISIONS-MAP`

Mapa público das decisões que moldaram `src/flow-engine.ts` e os módulos em
volta (maratona de desmontagem 2026-11-07→2026-11-09, régua "escoteiro-onda").
Propósito: **esclarecer dúvidas de uso e proveniência** — quando você se
perguntar "onde mora X?", "por que isso é um módulo separado?", "quem decide
Y?", a resposta está numa decisão D-xx abaixo, com fonte reabrível.

Como consumir: a tabela L1 responde a maioria das consultas (busque por
`D-xx`); os blocos L2 (`## D-xx`) trazem origem, escolha e prova. Este
arquivo é a projeção pública versionada; as fotografias internas completas
(capacidades, CRG, receipts) moram no workspace de manutenção sob
`.agents/MAPAS/` (fora do versionamento por design).

## Dúvida comum → decisão

| Dúvida de uso | Resposta curta | Decisão |
| --- | --- | --- |
| Onde mora a política de meetings/required_cooperation? | `src/meeting-policy.ts`, não no motor | D-19 |
| Onde é decidido se um gate está satisfeito? | `src/gate-resolution.ts` (coerência review×changed_files) | D-21 |
| Por que meu fluxo está bloqueado por fiscal? Diagnóstico? | `src/fiscal-blockers.ts` expõe o diagnóstico e ações diretas | D-25 |
| O que o `ppirtv_checkin` calcula? | `src/ppirtv-checkin.ts` (envelope de status/accountability) | D-26 |
| Quem decide escrita/promoção de memória v2? | `src/memory-promotion.ts` | D-27 |
| Erros MCP: por que o envelope "ensina o desbloqueio"? | SSOT de error-envelope + teto terminal | D-14 |
| Posso confiar que behavior foi preservado nas extrações? | Ledger selado por blob + fiscal `check:flow-engine` | D-13, D-24 |
| Por que existe um índice SptTraceIndex? | Evento re-attach de criterion_proofs (rastreabilidade) | D-16 |
| Como adicionar um módulo novo sem crescer o monólito? | Leia `FLOW_ENGINE_EVOLUTION.md` + `src/INDEX.md` primeiro | D-12, D-01 |

## L1 — Índice executivo (27 decisões)

| ID | Título | Estado | Etapa | K/N | Fonte viva (Git) |
| --- | --- | --- | --- | --- | --- |
| D-01 | GO maratona + fotografia ANTES | aceita | V✅ | 3/3 | `FLOW_ENGINE_EVOLUTION.md` |
| D-02 | Mapa Onda 0 (símbolo→cluster→suite→destino) | aceita | V✅ | 1/1 | `FLOW_ENGINE_EVOLUTION.md` |
| D-03 | Ordem fiscal-policy antes de meetings | aceita | V✅ | 1/1 | CHANGELOG 2026-10 |
| D-04 | Onda 2 fiscal-policy (árvore verdict) | supersedida→evento | V✅ | 1/1 | `src/verdict-learning.ts` |
| D-06..10 | Extrações contínuas (traceability/learning/mining/envelope/snapshot) | aceitas | V✅ | 5/5 | CHANGELOG; módulos em `src/` |
| D-11 | FE-DEBT-006 (3 cópias goal_start/sentinela/evaluate) | aceita→paga | V✅ | 3/3 | Ondas 1/2/2b |
| D-12 | Régua ESCOTEIRO-ONDA contínua | aceita | V✅ | 1/1 | `FLOW_ENGINE_EVOLUTION.md` |
| D-13 | Desmontagem com fotografia antes/depois | aceita | V✅ | 1/1 | ledger `flow-engine-evolution.json` |
| D-14 | **Onda 1**: teto terminal → SSOT error-envelope | aceita→evento | V✅ | 1/1 | 115d7e5+0bdd375 |
| D-15 | **Onda 2**: sentinela admissão v3 → SSOT | aceita→evento | V✅ | 1/1 | 217c389; `src/spt-traceability.ts` |
| D-16 | **Onda 2b**: evento re-attach + SptTraceIndex | aceita→evento | V✅ | 1/1 | 145ac4e+9df1304 |
| D-17 | Cura adversarial 2/2b (ledger pós-save + linhagem) | aceita→evento | V✅ | 2/2 | 9facae1+665bb5f |
| D-18 | **Cura-2**: selo vivo confere linhagem | aceita→evento | V✅ | 2/2 | 49524c3+e809b05 |
| D-19 | **Onda 3**: meetings-policy (49 símbolos) | aceita→evento | V✅ | 1/1 | 9ad23ee..d46a415; `src/meeting-policy.ts` |
| D-20 | **Cura-3**: seletor-regex + parent obrigatório | aceita→evento | V✅ | 1/1 | cb0b4aa..6e0ce92 |
| D-21 | **Onda 4**: gate-resolution (11 símbolos) | aceita→evento | V✅ | 1/1 | 8505275..7d5b67b; `src/gate-resolution.ts` |
| D-22 | **Cura-4**: linhagem incondicional 3 gates | aceita→evento | V✅ | 1/1 | 8ad367a+c7b2ed6 |
| D-23 | **Cura-5**: error-path do selo estruturado | aceita→evento | V✅ | 3/3 | 1ed5dcb |
| D-24 | **Cura-6**: RECORD_REMOVED + birthRecords + vacinas | aceita→evento | V✅ | 3/3 | beef440+db823f1 |
| D-25 | **Onda 5**: fiscal-blockers (50 símbolos) | aceita→evento | V✅ | 3/3 | e0ec9d1..b5d5f95; `src/fiscal-blockers.ts` |
| D-26 | **Onda 6**: ppirtv-checkin (23 funcs) | aceita→evento | V✅ | 3/3 | defacc1..601c8ac; `src/ppirtv-checkin.ts` |
| D-27 | **Onda 7**: memory-promotion (33 símbolos; ÚLTIMA) | aceita→evento | V✅ | 3/3 | c99ef48..8c4cf46; `src/memory-promotion.ts` |
| D-28 | Vacina anti-import-morto total | aceita | V✅ | 3/3 | nasceu Onda 5, pagou 6/7 |
| D-29 | Janela acumulada no selo SHRINK | aceita | V✅ | 2/2 | Ondas 6/7 |
| D-30 | Suíte de integração dos 4 módulos + E2E golden-path (pós-maratona) | aceita | V✅ | 6/6 | `tests/*.integration.test.ts` + `tests/goal-lifecycle.e2e.test.ts` |
| D-31 | ISSUE-0002: ressalva `provided_missing_paths` + não-entrada na union (expurgo rejeitado com regresso medido); emenda adversarial: aviso `provided_unconfirmed_deletions` + fronteira envelope + preflight simétrico | aceita | V✅ | 6/6 | `tests/gate-provided-paths.test.ts` + `src/gate-provided-paths.ts`; commits `0c6dda9`+emenda |
| D-32 | ISSUE-0005: typecheck de `tests/` no pipeline (`check:types` no `check` antes do vitest; curadoria de ~130 erros herdados) | aceita | V✅ | 6/6 | `tsconfig.tests.json`; commit `3d41f26` |
| D-33 | ISSUE-0004: fim da tool fantasma no guidance — `librarian_status` → `ppirtv_checkout`; sentinela consumida julgando contra o registro vivo | aceita | V✅ | 4/4 | `src/fiscal-blockers.ts`; commit `e5992f4` |
| D-34 | Aviso `provided_ignored` no receipt do gate (typo nunca mais silencioso; cola pura, julgamento em gate-resolution) + erros de escopo nomeiam `offending_paths` | `rg "provided_ignored" src/gate-resolution.ts`; record 40 do ledger | 2026-11-09 · ISSUE-LOCAL-0001+0003 · 8367969 |
| D-35 | E2E golden-path sobre SPT v3 canônico: `addDeclarativeEvidence` expande 1 evidência por critério (`criterion_proof` SINGULAR) | `rg "golden-path SPT v3" tests/goal-lifecycle.e2e.test.ts` | 2026-11-10 · ISSUE-LOCAL-0006 · c7c3779 |

*(D-05 nunca foi atribuído — lacuna declarada, não fabricada.)*

Resultado líquido: monólito **8.181 → 4.933 linhas (−40%)** com 7 ondas + 6
curas; suíte de testes **823 → 852** sem editar teste de comportamento; 5
módulos de política + SSOTs; 38 records selados no ledger.

## Árvore causal (Mermaid)

```mermaid
flowchart TD
    M["D-01 GO maratona<br/>2026-11-07"] --> D2["D-02 Onda 0 mapa"]
    D2 --> D11["D-11 FE-DEBT-006"]
    D11 --> O1["D-14 Onda 1 SSOT"]
    D11 --> O2["D-15 Onda 2 sentinela"]
    O2 --> O2b["D-16 Onda 2b re-attach"]
    O2b --> C3["D-20 Cura-3 selo"]
    D2 --> O3["D-19 Onda 3 meetings"]
    O3 --> O4["D-21 Onda 4 gate-resolution"]
    O4 --> C4["D-22 Cura-4 linhagem"]
    C4 --> C5["D-23 Cura-5 error-path"]
    C5 --> C6["D-24 Cura-6 grandfathering"]
    C6 --> O5["D-25 Onda 5 fiscal-blockers"]
    O5 --> V["D-28 vacina imports"]
    O5 --> O6["D-26 Onda 6 ppirtv-checkin"]
    O6 --> J["D-29 janela acumulada"]
    J --> O7["D-27 Onda 7 memory-promotion<br/>MARATONA ENCERRA"]
    C3 -.supersede.-> C2["D-18 Cura-2"]
    C2 -.supersede.-> C17["D-17 cura 2/2b"]
```

## L2 — Detalhe por decisão

### D-01..D-13 (fundação)
GO único do dono após veredito documental; fotografia ANTES = capacidades +
decisões + grafo estrutural (CRG) com `built_at == HEAD`. D-12 é a diretriz
"escoteiro-onda": correção que toca cluster mapeado extrai a onda INTEIRA daquele
cluster no mesmo corte — extração densa, não pedra minúscula; big-bang e
reescrita ampla continuam proibidos.

### D-11 (FE-DEBT-006) e Ondas 1/2/2b (D-14..D-16)
A 3ª cópia da sequência goal_start/sentinela/avaliação foi paga em 3 ondas
SSOT-first: envelope de erro com teto terminal (error-envelope.ts), sentinela de
admissão v3 + rastreabilidade (spt-traceability.ts) e evento re-attach com
índice SptTraceIndex. A dívida estrutural só foi declarada paga no record da
Onda 3, por exigência do fiscal.

### Curas 2/2b→6 (D-17..D-24): o validador fiscal amadurece
Cada cura fecha achado P1/P2 da revisão adversarial da onda anterior COM teste
RED provado: linhagem do selo → selo vivo + parent obrigatório → linhagem
incondicional + self-match → error-path estruturado → `RECORD_REMOVED` +
`birthRecords` + vacinas provadas **por mutação** (a vacina que não vigia nada
não é vacina). Consumidor: `npm run check:flow-engine` (gate de edição).

### D-25..D-27 (Ondas 5/6/7): as famílias saem, 2026-11-09
Diagnóstico de bloqueio fiscal (50 símbolos → fiscal-blockers.ts), envelope de
status check-in/checkout (→ ppirtv-checkin.ts) e candidatos/promoção de memória
v2 (→ memory-promotion.ts, última onda). Cada corte foi selado no ledger COM
parent; emendas intermediárias (imports mortos, contagens) entraram como
janela acumulada (D-29) — record único cobrindo a janela, em vez de fabricar
dívida para caber em CONTAIN.

### D-28/D-29 (transversais)
Vacina anti-import-morto: parser por bloco completo `import {...} from "...";`
varrendo o corpo sem imports; pegou 42 mortos acumulados (Onda 6) e 9 em
linha-única gigante (Onda 7). Janela acumulada: ver D-25..D-27 acima.

### D-31 (pós-maratona, 2026-11-09): ISSUE-0002 — fim do fantasma na union
Primeira issue do TRACKER local curada por GO (P1, custo real: flow 136 com
3 verdicts bloqueados + 6 emissões de review por 1 typo). O gate de
implementação com path inexistente em `provided.changed_files` devolve
**ressalva `provided_missing_paths`** no receipt (nunca bloqueia) e **não
persiste o path na union** `flow.changed_files` — o typo morre na nascente.
Decisão com regresso medido: o expurgo literal da union por `deleted_files`
foi implementado, testado e **rejeitado** (quebrava a atestação de deleção
real do desenho #6 — path deletado legitimamente permanece na union como
memória do escopo; suíte do engine provou ao vivo); critério fechado pelo
aceite alternativo da própria issue. Camping EXCEPTION `urgent_hotfix`
(record 38, RED real). Dúvida de uso: declarou um arquivo que ainda não
existe? O receipt avisa na hora — redeclare quando o arquivo existir.

**Emenda adversarial (record 39, EXCEPTION integrity)**: o par
`changed_files`+`deleted_files` **simultâneo** é o formato canônico de
deleção (1ª declaração) e **entra por atestação do cliente** — quando o
disco não confirma e a union histórica não conhece, o receipt emite o aviso
**`provided_unconfirmed_deletions`** (nunca bloqueia; o typo em duas listas
deixa de ser mudo — fechado com veredito documental do $oraculo-clean-code).
No mesmo corte: fim do fallback `process.cwd()` (sem `goal_binding` não há
fronteira legítima — rota legada fica sem ressalva em vez de julgar contra a
raiz do servidor), `isExistingFile` substitui `existsSync` (diretório não é
arquivo do escopo) e `goal_gate_preflight` emite as chaves simetricamente.
Julgamento mora em `src/gate-provided-paths.ts`; suíte 891→896.

### D-30 (pós-maratona, 2026-11-09): testes de integração + E2E
A maior dívida declarada da maratona foi paga: os 4 módulos de política que
só eram exercitados via suíte do motor ganharam suítes de integração com
import direto (`tests/meeting-policy|fiscal-blockers|ppirtv-checkin|
memory-promotion.integration.test.ts`, fixtures reais em
`tests/helpers/policy-modules-fixture.ts`) cobrindo ramos adversariais
(gatilho negativo de reunião, verdict consumindo sinal, blockers
reconciliados, falso-positivo conhecido "validade"/"testemunha" documentado
fiel, progresso inválido, resolução park sem quando, destino único de
promoção). O E2E (`tests/goal-lifecycle.e2e.test.ts`) percorre o ciclo
completo — goal_start → gate de revisão bloqueado → review estrutural →
gate verde → status → verdict — e confere os artefatos PERSISTIDOS em disco
(flow `.json` com `goal_started`/evidence/`verdict_recorded` + ledger
`.ndjson`), além da idempotência do `goal_start`. Vigília provada por
mutação (5 mutações, cada uma flagrada em RED com revert imediato). Suíte
852→886, zero mudança de produto.


### D-32 (pós-maratona, 2026-11-09): ISSUE-0005 — typecheck de tests/ no pipeline
O gate `npm run check` não validava tipos dos arquivos de teste (tsconfig só
`src/**`; vitest não typechecka) — a fixture incompleta do D-30 e 3 props
fantasmas `phase` passavam em silêncio. Cura: `tsconfig.tests.json` (extends
base, noEmit, lib ES2023 p/ `findLast`) + script `check:types` no `check`
ANTES do vitest, com curadoria completa dos ~130 erros herdados em 18
arquivos (baseline RED congelado: 251 linhas). Classes: fixtures completas
(Meeting +8 campos — a própria barata do D-30 agora impossível de repetir;
`GoalVerdictInput.next_step`; `GateRequirement.kind` real do mapa),
`d.mts` de declaração para o validador de camping `.mjs`, `as const` dos
profiles de cutover, casts de envelope dinâmico e non-null **só em asserts**
(veredito documental $oraculo-clean-code cap 7/cap 9). tsc 0 erros; suíte 896
verde; zero `src/` de runtime. Dúvida de uso: fixture incompleta ou prop
fantasma em teste agora quebra o `npm run check` na hora.


### D-33 (pós-maratona, 2026-11-09): ISSUE-0004 — fim da tool fantasma no guidance
`blockerOwner("librarian_status")` apontava `memory_recall` — tool que NUNCA
existiu no registro (32 tools reais; só eventos `memory_recalled`). Veredito
documental $oraculo-clean-code (cap 2 *Meaningful Names*, l.906-920): guidance
é um nome de rota — deve revelar intenção executável. Escolha pela própria
tabela: irmãos apontam tools de AÇÃO especializada → **`ppirtv_checkout`**
(checagem de accountability do librarian, dona do diagnóstico
graphify/bibliotecário). Sentinela consumida conforme desenhada: RED provado
ao vivo na cura; o teste novo julga a tabela INTEIRA contra o registro VIVO
de tools — nenhuma tool fantasma passa. Dúvida de uso: guidance de blocker
nunca mais aponta tool inexistente (o teste vigia).

## Estado e débitos declarados (pós-maratona)

- Núcleo restante (~4.9k linhas) permanece monolito **por desenho**: cola de
  orquestração cujo seam ainda não é seguro; o mapa vivo de próximos seams está
  em `FLOW_ENGINE_EVOLUTION.md`.
- Dívidas abertas declaradas: testes diretos dos 5 módulos (hoje cobertos pela
  suíte do motor), invariante parent→base_blob no validador (não modela janela
  acumulada), revisão de README antigos.
- Cada visita que tocar `src/flow-engine.ts` executa `npm run check:flow-engine`
  (gatilho `PPIRTV-FLOW-ENGINE-CAMPING-RULE`).

## Manutenção

- Owner: `documentacao-tecnica / Dora Docs` + `$oraculo-refatoracao` (conteúdo).
- Quando: nova onda/cura tocando o flow-engine ⇒ linha L1 nova + bloco L2 + link
  de fonte; a fotografia interna correspondente nasce em `.agents/MAPAS/`.
- Formato: L1 tabela (1 linha por decisão) + L2 âncoras `## D-xx` no mesmo
  arquivo — consumido por LLM via `rg "D-xx"` e leitura dirigida.

## D-34 — diagnóstico que ensina o culpado (ISSUE-0001+0003)

**Dúvida comum**: "por que o gate ignorou minha chave?" / "qual path disparou
o UNATTRIBUTED?" — agora ambos nomeiam o culpado no ponto de erro.

- **O quê**: (a) `providedIgnoredKeys` (src/gate-resolution.ts, função pura)
  devolve `provided_ignored: ["tests_executed"]` no `GateRecord` — chaves de
  `provided` que nenhum requisito da fase conhece (typo vira ressalva visível,
  nunca bloqueio; `changed_files`/`deleted_files` aceitas em toda fase porque o
  motor as lê fora do mapa de requisitos); a fachada ganhou só o cálculo+spread
  (cola pura, camping EXCEPTION record 40, RED real). (b) `filter` no lugar do
  `some()` nos 2 erros de escopo de `review-scope-attribution.ts`:
  `offending_paths: a, b (+N more)` — truncagem 10 com contador, molde da irmã
  STALE que já nomeava o evidence_id. (c) flow zumbi 2948 (stub de goal_start
  do hardening-2, 0 evidências) arquivado pela rota canônica (vrd_4173 +
  flow_archive) — saiu do hook de SessionStart.
- **Por que assim e não outro**: reuso do mapa `PROVIDED_REQUIREMENT_KINDS`
  (FE-DEBT-002) em vez de inventário novo; mensagem (como STALE) em vez de
  campo estrutural no envelope (schema intocado); aviso nunca bloqueante —
  mesmo desenho dos avisos D-31.
- **Fontes**: commit 8367969; record 40 do ledger
  `docs/architecture/flow-engine-evolution.json`; RED baseline 4c693c6
  (`tests/gate-provided-ignored.test.ts`, `tests/review-scope-offending-paths.test.ts`).

## D-35 — E2E golden-path SPT v3 (ISSUE-0006)

**Dúvida comum**: "como é o ciclo canônico completo com provas por critério?"
→ o it golden-path v3 é o exemplar executável.

- **O quê**: `tests/goal-lifecycle.e2e.test.ts` ganhou o it v3 — fixture v3
  (molde `memory-gate-loop.test.ts`, 2 critérios), `addDeclarativeEvidence`
  expande **1 evidência por critério** (`Evidence.criterion_proof` é
  SINGULAR — 1 chamada → provas C-01/C-02), gate de revisão
  `review_evidence_coherent` → review estrutural `code_review` fp pós-âncora
  → verde, verdict `pronto` citando provas + review, fonte persistida e
  artefatos no disco. O it v2 legacy permanece (contrato legado provado).
- **Por que assim**: reuso dos moldes v3 existentes em vez de fixture nova;
  2 critérios provam a expansão múltipla; zero src (amplificação de teste).
- **Fontes**: commit c7c3779; suíte 905; fila da revisão D-30 fechada 6/6.
