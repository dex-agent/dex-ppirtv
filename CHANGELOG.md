# Changelog

Todas as mudancas relevantes deste projeto devem ser registradas aqui.

Este changelog comeca em 2026-06-06. Historico anterior nao foi
retrocatalogado; entradas futuras devem registrar mudancas confirmadas com data,
escopo, evidencias e lacunas quando existirem.

## [Unreleased] - 2026-07-28

- 2026-11-11 — **D-39 · GITHUB #18 CURADA: contratos de erro diferenciam reanexação de rastreabilidade de fingerprint SPT divergente** (Trilho `2026-11-11-issue18-diferenciar-rebind-rastreabilidade-fingerprint.md`; flow 4460; GO único do dono; corte **doc-only, zero src** — camping flow-engine NOT_APPLICABLE por ausência de edição do monólito): o consumidor que tropeçava em `GOAL_BINDING_MISMATCH` não sabia se devia tentar de novo, restaurar o SPT ou abrir flow novo — os dois mundos (reparo mecânico de mapa vs imutabilidade de binding) estavam documentados em superfícies separadas sem a costura que os diferencia. O guard (`flow-engine.ts:4759`, lança ANTES de qualquer mutação) e o envelope atual (`restore_original_binding_or_start_new_goal`, server.ts:1177) estão CORRETOS e permanecem intocados — a issue é `[docs]` por desenho. Cura documental em 2 superfícies: (a) `MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md` — `GOAL_BINDING_MISMATCH` sai da linha agrupada para **linha própria** com as duas sub-rotas explícitas: (1) SPT editado sem intenção de trocar de plano → restaurar os bytes do fingerprint registrado (diagnóstico por `ppirtv_trace`, reason_code `spt_contract_fingerprint_drift`, registered vs current) e reatar com a MESMA idempotency_key; (2) contrato realmente alterado de propósito → **flow sucessor com idempotency_key NOVA**, predecessor preservado, decisão de owner — com a diferenciação explícita de `SPT_V3_TRACEABILITY_MISSING` (mapa ausente + binding compatível: MESMA key reata o mapa, reparo mecânico sem owner); (b) `GOAL_SPT_CANONICAL_CONTRACT.md` — seção nova conectando os dois mundos ortogonais (mesma verdade com anexo perdido vs verdades divergentes), o exemplo que deixa claro que `goal_start` NUNCA reescreve silenciosamente um binding diferente **apontando para o teste vivo que o caracteriza** (`tests/mcp.test.ts`, it que edita o SPT entre dois `goal_start` e o retry falha MISMATCH — a doc aponta para o teste como âncora, padrão do conselheiro $oraculo-legado: caracterização antes de tudo), e a nota de o consumidor conferir `ppirtv_trace` além de `goal_status` antes de atribuir provas (o trace expõe `binding_integrity.fields_compared` que o status não mostra). Veredito do oráculo que desenhou o corte ($oraculo-pragmatico, selos confirmado_documental: projeto por contrato l.269/l.2412, ortogonalidade l.252/l.805, duplicação l.805, janela quebrada l.394/l.399): costurar apontando para as fontes, nunca duplicar. Suíte 910 inalterada (doc-only); `npm run check` exit 0. **Emenda adversarial** (5 revisores arena-flash, 1P1/5P2/8P3; claim sobreviveu — attacker "verificado e sólido", revisor falso-verde 0 findings): **(P1)** `GOAL_BINDING_MISMATCH` tem 8 causas possíveis (`immutable binding differs in <campos>` — objective/evidence_required/required_evidence/requested_verdict_policy/source/risk_level/flow_role/spt_contract) e a doc descrevera só fingerprint — Passo 0 novo: ler os campos na própria mensagem; demais campos = envelope divergente → `goal_status.goal_envelope` + mesma decisão; **(P2)** flow sucessor exige `goal_start` NOVO SEM reusar a flow_id do flow preso (mesma flow_id + key nova = erro distinto não-traduzido, flow-engine l.4726); "(decisão de owner)" movida para DENTRO da sub-rota 2; ponte grep-ável com o envelope vivo (`restore_original_binding_or_start_new_goal`); `ppirtv_trace` promovido a discriminador ANTES da escolha das sub-rotas (seletor `goal_id`); **(P3)** "retry SEM restaurar os bytes antes"; binding legacy `spt_contract_fingerprint_missing` não se cura restaurando bytes (→ sub-rota 2); typos ("e é ele", "É a MESMA"); flow 4460 citado. Suíte 910 inalterada; check exit 0; global re-sincronizado (audit:canonical pass).

- 2026-11-11 — **D-38 · GITHUB #17 CURADA: goal_verdict anuncia a mineração pós-verdict que o gate terminal vai exigir** (marker `FE-2026-11-11-ISSUE0017-VERDICT-NEXT-ACTION-MINING-EXCEPTION`; Trilho `2026-11-11-issue17-next-required-action-terminal.md`; GO único do dono; consumidor real crsantosxx com observação via stdio): a resposta de `goal_verdict` com veredito positivo podia anunciar `advance_terminal` (ou o genérico `resolve_blockers` listando só `residual_risks/next_step/memoria_viva_reconciled`) enquanto o gate terminal exigiria uma `mm_memory_mining` **posterior ao veredito** que nenhuma resposta anterior indicou — o consumidor cumpre o anunciado e trava no não-anunciado (mesma família D-34/D-36: sequência ensinada incompleta). Causa-raiz na fonte: o requisito (`hasVerdictAfterLatestMemoryMining`, `mining-policy.ts:806`) era avaliado SÓ no caminho do `goal_advance` terminal (`flow-engine.ts` l.2990); `closureBlockersFor` não o inclui, então `terminalAdvanceAllowed` do verdict não o via. Cura mínima no bloco de retorno de `goalVerdictUnlocked` (~12 linhas, camping EXCEPTION integrity): predição `requiresPostVerdictMining` = veredito positivo E fase terminal no perfil E `hasVerdictAfterLatestMemoryMining(flowRecarregadoPósVerdict)` — **o predicado EXATO da fonte única** (reload de 1 leitura em vez de equivalência manual); `next_required_action` passa a responder `{type run_memory_mining, tool mm_memory_mining}` com reason ensinando o ciclo completo (minerar → depois fornecer `residual_risks/next_step/memoria_viva_reconciled` no terminal). Fonte única preservada: o guard do advance terminal intocado (o requisito continua avaliado no caminho vivo do gate). RED→GREEN provado: it caso (`run_memory_mining` + ciclo fecha com re-mining → `complete`) e it controle (fase NÃO-terminal: o aviso é exclusivo do destino terminal — nunca `run_memory_mining`); descoberta paga pelo RED: **todo GOAL oficial exige mineração ANTES do verdict** (sem writer o verdict morre em `memory_required_but_empty`) — o caso "sem mining" não existe por desenho. Contrato público ampliado (critério 2 da issue pela rota documental): description de `goal_verdict` declara a predição; description de `goal_advance` declara que **`memoria_viva_reconciled` atesta a reconciliação das superfícies vivas incluindo o checklist do Trilho vinculado ANTES do terminal** (o flow fica imutável após complete) — sentinelas no it de tools/list; motor não lê .md do Trilho por desenho. Suíte 908→**910** (2 its novos); `npm run check` exit 0. **Emenda adversarial** (5 revisores perfil rápido, 0P1/5P2/9P3; o único high era o it que consagrava o bug — JÁ corrigido no commit do corte, diff congelado era pré-correção; 2 P2 REFUTADOS na fonte: verdict sem binding é inalcançável (`assertGoalBinding` l.2526) e memoria_viva_reconciled É tipado boolean no `REQUIREMENT_KINDS_BY_KEY`): reason do verdict ensina sequência completa (resolver closure_blockers listados + aviso de que o snapshot `status.*` não carrega o requisito — siga o `next_required_action` do topo); description do goal_advance qualifica imutabilidade como engine-level e declara que a atestação é da sessão (motor não lê o Trilho); assert do controle PINADO em resolve_blockers (lista mascararia vazamento); ramo morto writer:false removido; EVOLUTION.md título stale corrigido; record 43 selado com commit 8f677b4/parent 9a8d2c2; CHANGELOG espaçamento normalizado.

- 2026-11-10 — **OPS · GITHUB #15: reconciliação dos flows históricos não-terminais — 4 arquivados por fechamento DOCUMENTAL via API, 29 preservados para decisão do owner** (Trilho `2026-11-10-issue15-reconciliacao-flows-historicos.md`, flow 4348; GO único do dono; corte de ops SEM D-xx e SEM src — camping N/A): inventário vivo pós-D-34/D-37 = **33 flows não-terminais** nesta máquina (o 2948 citado na abertura da issue já fora arquivado no D-34; os flows do dia 4255/4302 completaram; concorrência fria — mtime mais recente 2026-10-18), classificados **por flow com evidência** (SPT status / workspace / ev-vd / mtime) em `.agents/AUDITORIAS/2026-11-10-issue15-reconciliacao-flows.md`: **4 ARQUIVÁVEIS DOCUMENTAIS** (SPT em estado terminal do vocabulário legado: 2374 CONCLUIDO_COM_RESSALVA 17ev/0vd; 2036 e 2078 CONCLUIDO_NAO_PRONTO; 2313 EM_VALIDACAO_NAO_PRONTO), 18 stubs externos sem goal_binding/SPT (maio-jun), 2 com SPT ausente (0015 MemoryAutoIt, 0072 PHP_AUTO_GERADO_V3), 9 com SPT AUTORIZADO/EM_EXECUCAO/PLANEJADO de jul-ago (trabalho entregue em flows/commits posteriores, mas SPT sem declaração de conclusão = **sem fechamento documental comprovável**). Os 4 documentais **arquivados SOMENTE via API** (`flow_archive`, motivo citando o status do SPT + readback conferindo `status=archived` + evento `flow_archived` + evidências/vereditos preservados — NENHUMA edição manual de arquivo de flow); os 29 ambíguos/externos **intactos** (regra da própria issue: preservar em caso de dúvida), com recomendação por família publicada na #15 para decisão do owner (pergunta única). Prova executável: `python -B .agents/AUDITORIAS/2026-11-10-issue15-verify.py` → 4/4 archived com motivo + 29 intactos, exit 0; comentário na #15 com a tabela-resumo (C-04); `npm run check` exit 0 (suíte 908 — ops não toca código). Distinção publicada: **fechamento documental ≠ conclusão oficial** — mora no motivo de cada arquivamento. **Rodada 2 (GO do owner na pergunta da #15, mesmo dia)**: +20 arquivamentos administrativos via API (18 stubs externos sem goal_binding/SPT + 2 com SPT citado inexistente no workspace), motivo citando a classe e a autorização, readback **24 archived pelo corte / 9 da família 3 (SPT não-terminal) preservados para decisão flow-a-flow** — lista viva no comentário da issue. **Emenda adversarial** (5 revisores perfil rápido, 0P1/4P2/5P3, nenhum quebra a claim material — contra-prova manual dos revisores confirmou a classificação: 4 SPTs terminais ao vivo, 8 SPTs não-terminais distintos, 2 ausentes reais): (P2) verificador **CWD-ancorado** por `__file__` e **detector de 5º arquivado implícito** (evento `flow_archived` no marco do corte fora da lista dos 4 = erro) — nasceu em `.agents/TMP/` e **mudou-se para a AUDITORIAS** (ponteiros apontam o destino perene); (P2) **proveniência do corpo da issue fechada**: o inventário citado na abertura (`f0477a4`, 197 arquivos, 31 active) é de OUTRA instalação da frota — nesta máquina (239 arquivos, 33 não-terminais) o 2374 estava active até este corte arquivá-lo às 23:04Z (history: único evento), sinalizado em comentário de emenda na #15; (P2/P3) limitações do verificador DECLARADAS no cabeçalho (preservação por contagem, não hash; classificação dos 29 conferida pela contra-prova dos revisores no CONSOLIDADO); (P3) nuance registrada: 3 dos 4 arquivamentos saíram como `archived_blocked_flow=true` (flows estavam `blocked`; `preserved_blockers=[]` — sem perda) e "terminal do vocabulário legado" é leitura interpretativa declarada no motivo do 2313.

- 2026-11-10 — **D-37 · ISSUE-LOCAL-0007 CURADA: gerador MM emite candidate no charset L1 da dex-memoria 0.1.17 + retry com operation_id fresco** (marker `FE-2026-11-10-ISSUE0007-RETRY-FRESH-ID-EXCEPTION`; Trilho `2026-11-10-issue0007-gerador-mm-trigger-charset.md`; GO único do dono — issue aberta pela janela irmã do registry após 2 rollbacks no 24º Jumper): o writer da MM entregava **title/trigger com os metacaracteres `^ [ ] CR LF` herdados do item da mineração** (caso graphify: shape-MM `^{slug}-[hash8]$` citando hash de grafo) — a dex-memoria 0.1.17 rejeita em request-stage (`INVALID_CANDIDATE` citando o caractere) — e o **retry do resolve reusava o `operation_id` preso em PENDING** ("use a new operation_id"). Cura em duas funções puras + cola: **`sanitizeCandidateText`** no adapter (title/trigger no charset; body cru; caso bom sai idêntico) e **`freshOperationIdForRetry`** em memory-promotion (id fresco sufixado `-retry-N` **somente para id PRESO**: status não-COMMITTED e não-PARTIAL_PENDING — **PARTIAL_PENDING segue o RESUME canônico pelo mesmo id**, contrato preservado porque **a suíte PEGOU a regressão** do primeiro desenho que sufixava tudo); o monólito ganhou 1 linha de invocação (camping EXCEPTION integrity, record 42). RED-first duplo (adapter charset + engine charset-retry no baseline `4326322`); 2 achados pagos pela execução: helper `partialReceipt` de fixture assume rota `global` e sufixo `::` quebra paths de receipt no **Windows** (`:` proibido em nome de arquivo — ENOENT ao vivo; separador é hífen). **PROVA REAL**: mineração com hash no item commitando **COMMITTED na dex-memoria 0.1.17 REAL** (`theme=COMMITTED`, receipt `mmv2_617f…520e9c8`, memory_home temporário isolado — o vault da casa intocado). Suíte 906→**908** (906+2); `npm run check` exit 0. **Emenda adversarial** (5 revisores, **1P1/2P2/5P3**, 3 classes convergentes; probes de 2 revisores contra o código real): **(P1)** `freshOperationIdForRetry` **reescrita por família com contador no SUFIXO numérico** — o 1º desenho regenerava id já queimado na 3ª tentativa (loop base↔retry-1: `v2_receipts` é SUBSTITUÍDO por rodada e a contagem por receipts nunca via o id sufixado; RED ao vivo no teste de 3 rodadas antes do fix); **(P2)** último PARTIAL_PENDING da família devolve o MESMO id (resume canônico preservado inclusive em id sufixado); **(P2 vocabulário)** receipt real é `COMMITTED|PARTIAL_PENDING|FAILED` — o teste fabricava "PENDING" impossível (preso real = FAILED): corrigido + tipo `Pick` fechado; **(P3s)** guard `TITLE_EMPTY` no writer, assert de VALOR do title saneado, contadores "(906+2)".

- 2026-11-10 — **D-36 · GITHUB #16 / ISSUE-LOCAL-0008 CURADAS: contrato público de `goal_advance` alinhado ao desenho D-31** (Trilho `2026-11-10-issue16-contrato-goal-advance-path-inexistente.md`; GO único do dono sobre a 1ª issue ONLINE de consumidor — crsantosxx, reprodução MCP nativa em `f0477a4`): a description do `tools/list` prometia *"an absent changed file without deleted_files fails closed"* enquanto o motor D-31 (`gate-provided-paths.ts`, deliberado, 10+ tests) devolve **ressalva `provided_missing_paths`** (nunca bloqueia, nunca entra na union). Corte de contrato (motor intocado, camping N/A): frase declara as 3 verdades; it MCP `contrato-goal-advance-path-inexistente` RED-provado na sentinela ANTES do fix (caracterização antes da mudança) com **caso+controle no MESMO advance** (ressalva nomeia só o inexistente; `changed_files_snapshot` acolhe só o existente) e fase persistida conferida. **Emenda adversarial** (5 revisores, 0P1/4P2/7P3, 2 classes convergentes; probe MCP real): (P2) **escopo de fase** — fora de `implementacao` o receipt NÃO nomeia (5/6 fases mudas por probe): a frase herdaria a mesma classe de mentira que o corte veio matar; emendada com "when the implementation gate advances ... changed_files paths are only inspected during the implementation gate" + caso diretório ("or not a regular file") + âncora legível (`gate.provided_missing_paths`) + markers negativos do `next_step`; (P2) **caso SOLO por MCP** (2º flow, path único inexistente: ressalva + snapshot vazio + fase — a claim "even when it is the only declared path" provada onde mora); (P2) `suite.total` re-medido no receipt (905→906; congelamento classe paga 2×); (P3, 3 revisores) **sentinela BIDIRECIONAL** `not.toContain("fails closed")` provada por **mutação CASO E** (description mentirosa citando o campo ao lado → RED exato; restore → GREEN) — vacina da classe descrição×comportamento nos dois sentidos; (P3) fail-near no setup (phase `implementacao` assertada antes do advance alvo). Não-curados deliberados: dedup case-variant da ressalva e `resultOf` opaco (motor/harness pré-existentes fora do escopo). Suíte 905→**906** (902+4, files 72); `npm run check` exit 0; D-36 nos 2 mapas; TRACKER 0008 fechada com `remote_url`; #16 fechada online com commit de prova.

- 2026-11-10 — **D-35 · ISSUE-LOCAL-0006 CURADA: E2E golden-path do ciclo GOAL sobre o SPT v3 canônico** (Trilho `2026-11-10-issue0006-e2e-golden-path-spt-v3.md`; GO único do dono — última issue aberta do TRACKER, fila da revisão D-30 **fechada 6/6**): novo it em `tests/goal-lifecycle.e2e.test.ts` percorre o ciclo completo **no contrato canônico `dex.spt.v3`** — fixture v3 reutilizada do molde `memory-gate-loop.test.ts` com **2 critérios** (prova a expansão múltipla), `addDeclarativeEvidence` expande **exatamente 1 evidência por critério** (`Evidence.criterion_proof` é singular — descoberta do corte: 1 chamada → 2 provas C-01/C-02 passed), gate de revisão bloqueado (`review_evidence_coherent`) → review estrutural `code_review` com fp pós-âncora → verde, verdict `pronto` citando as provas + a review, FONTE persistida conferida (verdicts + as 2 criterion_proofs passed) e artefatos no disco (flow JSON com `goal_started`/`verdict_recorded` + ledger). O it v2 legacy PERMANECE verde (contrato legado aceito por `spt-contract.ts:165-169` segue provado). Zero `src/` (amplificação de teste; camping N/A); suíte 904→905; `npm run check` exit 0.

- 2026-11-09 — **D-34 · ISSUE-LOCAL-0001 + ISSUE-LOCAL-0003 CURADAS: diagnóstico que ensina o culpado** (Trilho `2026-11-09-issue0001-0003-diagnostico-que-ensina.md`; GO único do dono sobre veredito do $oraculo-refatoracao 🧬 — família "erro mudo" da régua da casa R9, nunca silêncio): **(0001)** `goal_gate_check`/`goal_advance` com chave desconhecida em `provided` (typo `tests_executed` plural custou 1 turno real no flow 5703) agora devolve **`provided_ignored: ["tests_executed"]` no receipt** — julgamento mora na função pura `providedIgnoredKeys` (`src/gate-resolution.ts`, reuso do mapa `PROVIDED_REQUIREMENT_KINDS` + chaves de requisito da fase + `changed_files`/`deleted_files` aceitas em toda fase); o motor ganhou SÓ cola (calcular + spread condicional no `GateRecord.provided_ignored?`, domain aditivo — camping EXCEPTION `FE-2026-11-09-ISSUE0001-PROVIDED-IGNORED-EXCEPTION`, RED real no baseline 4c693c6). O aviso é RESSALVA: nunca entra em `missing`, nunca reprova — a chave válida presente continua bastando. **(0003)** `REVIEW_SCOPE_UNATTRIBUTED_PATH`/`UNDISCOVERED_PATH` agora **nomeiam os paths ofensivos** (`offending_paths: a, b (+2 more)` — filter no lugar do `some()` que achava o culpado e o jogava fora; 4 probes externos pagos no flow 136; molde da irmã STALE que já nomeava o evidence_id; truncagem 10 + contador preserva o envelope). **(zumbi)** flow `2948` (stub de goal_start órfão do hardening-2, `active` em concepcao desde 2026-10-18 com 0 evidências — o hardening real fechou no flow 2900) arquivado pela rota canônica, saindo do hook de SessionStart. RED-first 1+3 provados no baseline; suíte 896→901; `npm run check` exit 0. **Emenda adversarial** (5 revisores, 0P1/3P2/7P3, 3 classes convergentes — probe do adversário no motor real): (P2) **falso positivo morto** — `PROVIDED_REVIEW_INPUT_KEYS` aceita `review_findings`/`review_artifact_path` (lidas por `needsReviewCoherence` fora do mapa; avisá-las ensinaria a REMOVER chave que altera o julgamento do `review_evidence_coherent`); (P2, 3 revisores convergentes) **simetria do preflight** — `goal_gate_preflight` também nomeia o typo (`FE-2026-11-09-ISSUE0001-EMENDA-SIMETRIA-PREFLIGHT-EXCEPTION`, record 41: invariante D-31 vale para a família inteira); (P3s) paths entre aspas com quebras achatadas no `offending_paths` (ambiguidade de vírgula + injeção), amarração `PROVIDED_PATH_KEYS`×`sanitizePersistedProvided` por teste, timeout no git do teste, `satisfies Pick` real no lugar de `as never`, selagem do record 40 commitada (classe do 39 não recorrente).

- 2026-11-09 — **D-33 · ISSUE-LOCAL-0004 CURADA: fim da tool fantasma no guidance de `librarian_status`** (Trilho `2026-11-09-issue0004-tool-fantasma.md`, flow 4124; GO único do dono sobre a revisão de issues; sentinela plantada na emenda 2 do D-30 paga agora): `blockerOwner("librarian_status")` devolvia `"memory_recall"` — tool que **NUNCA existiu no registro** (o servidor registra 32 tools; `memory_recall` era só o nome de eventos `memory_recalled`), ou seja, o guidance emitido ao operador direcionava para uma tool inexistente. Cura: mapeia para **`ppirtv_checkout`** (tool de checagem especializada de accountability do librarian — veredito documental $oraculo-clean-code 🧬 cap 2 *Meaningful Names* l.906-920: nomes/guidance revelam intenção executável; padrão da tabela `blockerOwner` = tool de ação especializada, irmãs `evidence_add`/`mm_memory_mining`/`hygiene_scan`). RED ao vivo: a sentinela deliberada (teste que esperava o bug) falhou no momento exato da cura — prova viva — e foi **consumida** na sequência. **Emenda adversarial** (dwfrun-24fd4a16, 0 P1/1 P2/6 P3): o P2 provou por mutation probe que a lista hardcoded deixaria passar um ramo futuro fantasma (a claim "tabela inteira" era por coincidência) e as tabelas irmãs `tool:` do guidance não tinham guard — curado com **vacina por CONSTRUÇÃO** no teste: o registro vivo é extraído do `server.ts` por regex (`registerPpirtvTool`, piso ≥30 = tripwire de forma), cada par `if (blocker === …) return "…"` da tabela `blockerOwner` e TODO `tool:` do guidance do módulo são julgados contra o registro — **nenhuma tool fantasma passa, nem futura** (classe morta, não instância). Suíte **896 inalterada** (892+4, files 70 — sentinela reescrita 1:1); `flow-engine.ts` intocado (camping N/A); issue fechada com diálogo datado; EST-20261109-TOOL-FANTASMA pago.

- 2026-11-09 — **D-32 · ISSUE-LOCAL-0005 CURADA: typecheck de `tests/` no pipeline** (Trilho `2026-11-09-issue0005-typecheck-tests.md`, flow 4070; GO do dono sobre a recomendação da revisão de issues): `npm run check` agora valida tipos de `src/` **E** `tests/` — `tsconfig.tests.json` novo (extends base, `noEmit`, lib ES2023 para `findLast`, include src+tests) + script `check:types` rodando **antes** do vitest. Curadoria completa dos ~130 erros herdados em 18 arquivos (RED congelado: 251 linhas, reabrível em `.agents/EVIDENCIAS/2026-11-09-issue0005-typecheck/BASELINE-RED.txt`; `src/` puro: 0 erros): fixtures completas (**Meeting +8 campos — a barata do D-30 fica impossível de repetir**, `GoalVerdictInput.next_step`, `GateRequirement.kind` real do mapa), `scripts/validate-flow-engine-boundary.d.mts` (declarações do validador de camping para o typecheck), `as const` dos profiles de cutover, casts de envelope dinâmico e non-null **somente em asserts** (veredito documental $oraculo-clean-code cap 7 *Don't Return Null*/cap 9 *test code same standards*). tsc 0 erros; suíte **896** (892 passed + 4 skipped, files 70) verde sem mudança de comportamento; zero `src/` de runtime. **Emenda adversarial** (5 revisores, 0 P1/4 P2/10 P3): receipt CAPACITY com aritmética fechada (892+0+4=896, files 70 — o `total: 852` e o rótulo "(Onda 5…)" estavam congelados há 4 cortes e `2aad953` gravara total-como-passed) + **vacina no fiscal** `check-capacity.mjs` (`CAPACITY_RECEIPT_SUITE_TOTAL_MISMATCH`: cruzamento passed+failed+skipped===total — impossibilita a classe); `d.mts` com vocabulários **fechados** espelhados do `.mjs` (probe do adversário provou o tsc aceitando `mode: "SHRINKGG"` que o validador reprova) e sem parâmetro fantasma `label`; README com o pipeline real do `check`; baseline RED copiado para a pasta de evidências (claim reabrível). Não-curados deliberados: 38 casts `as string` em posição de input (união conhecida do próprio motor, ramo full sempre devolve id — higiene); remoção de optional chaining em `contents[0]` muda o modo de falha de borda (TypeError vs assert) sem mudar veredito; spawn git sem timeout e regex dotAll = classes pré-existentes estacionadas.

- 2026-11-09 — **D-31 emenda adversarial · P1 bypass fechado + fronteira de workspace + preflight simétrico** (marker `FE-2026-11-09-ISSUE0002-ADV-BYPASS-AVISO-EXCEPTION`; adversarial 5 revisores consolidada, 4 RED novos provados no baseline `0c6dda9`): (P1, contratos+revisor-código, confirmado por probe da sessão dona) o par `changed_files`+`deleted_files` **simultâneo** de path que **nunca existiu** entrava **mudo** na union — a isenção por `deleted_files` valia para qualquer path. Decisão de desenho (veredito documental $oraculo-clean-code cap 7 *Provide Context with Exceptions*): o par simultâneo é o **formato canônico de deleção** (1ª declaração; indistinguível de deleção real no disco — a suíte provou que restringir a isenção à union histórica quebrava o sensor `attests an explicit deletion`), então **continua entrando por atestação do cliente**, mas quando o disco não confirma e a union histórica não conhece, o receipt emite o **aviso `provided_unconfirmed_deletions`** nomeando o path (nunca bloqueia — o typo em duas listas deixa de ser mudo). (P2, 3 revisores) **fim do fallback `process.cwd()`**: sem `goal_binding` (gate_check legado/flow de pipeline) não há fronteira legítima para julgar existência — a ressalva fica ausente nessas rotas em vez de consultar a raiz do **servidor** (cap 8 *Clean Boundaries*). (P2) `isExistingFile` (statSync+isFile) substitui `existsSync` — **diretório não é arquivo do escopo** (typo `src` vira ressalva). (P2) `goal_gate_preflight` passa a emitir `provided_missing_paths`/`provided_unconfirmed_deletions` **simétrico** ao gate persistente (a rota read-only não silencia o typo). Julgamento extraído para `src/gate-provided-paths.ts` (módulo novo; fachada ganhou só cola). `GateRecord` ganha `provided_unconfirmed_deletions?` (domain). RED-first: 4 RED no baseline + 1 documental (V5); suíte 891→896; sensor #6 verde. Reincidência paga do P2 do receipt CAPACITY (âncoras congeladas) curada no commit de fechamento (write-tree re-ancorado).

- 2026-11-09 — **D-31 · ISSUE-LOCAL-0002 CURADA: fim do fantasma eterno na union de `changed_files`** (marker `FE-2026-11-09-ISSUE0002-PROVIDED-PATHS-UNION-EXCEPTION`; Trilho `2026-11-09-issue0002-union-path-fantasma.md`, flow 4029; GO único do dono sobre a revisão de issues): gate de implementação com path **inexistente** em `provided.changed_files` agora devolve **ressalva `provided_missing_paths`** nomeando os paths no receipt (nunca bloqueia, nunca em `missing` — typo vira achado de 1 segundo) e **não persiste o path na union** `flow.changed_files` (path declarado antes de existir entra quando passar a existir — comportamento declarado); critério 3 (expurgo por `deleted_files`) fechado pelo **aceite alternativo da própria issue**: com a não-entrada, o typo morre na nascente e não há fantasma eterno — o expurgo literal foi **implementado, testado e REJEITADO com regresso medido** (quebrava a atestação de deleção REAL do desenho #6: path deletado legitimamente precisa permanecer na union como memória do escopo para o snapshot atestá-lo; `engine.test` "attests an explicit deletion" + replay do `goalStatus` provaram ao vivo). RED-first: `tests/gate-provided-paths.test.ts` (4 testes, motor real) — RED provado no baseline `7c76632` e GREEN após a cura; `GateRecord` ganha `provided_missing_paths?` (domain); guard `DELETED_FILES_NOT_CHANGED` preservado na semântica original. Custo real da barata: flow 136 — 3 verdicts bloqueados + 6 emissões de review (155 targets = 154 reais + 1 typo). Camping EXCEPTION `urgent_hotfix` no ledger (38º record, RED real). Suíte 887→891.

- 2026-11-09 — **D-30 EMENDA 3 (consolidado automático da adversarial completou pós-reset; 22 achados agrupados 1P1/6P2/10P3, CONSOLIDADO.md primário)**: **P2 receipt re-ancorado** — head/tree_hash do CAPACITY.receipt.json estavam congelados no commit anterior (mesma classe do P2 pago na Onda 5, achado do revisor checklist com probe write-tree); curado com âncoras reais da árvore medida (head=009f780 + tree_hash write-tree staged). **P3 missing_context curado** — ramo do enum prometido no título e não exercitado (contratos): agora com fixture de 3 faltantes exatos (origin ausente, 2≤n<4). **P3 E2E SPT v2 estacionado** — golden-path prova o contrato legacy v2; versão v3 do ciclo completo = amplificação de corte próprio (EST emenda). **P2 CHANGELOG caiu** (entradas D-30 já no commit 009f780, como a ressalva do revisor previa). **Não-curados deliberados**: P3 acentuação inconsistente nos títulos de teste (cosmético, sem efeito comportamental), P3 freeze do ALVO.diff incompleto (lição de processo: o congelamento deve cobrir o pacote inteiro do corte, não só testes). Demais achados já curados na emenda 2.

- 2026-11-09 — **D-30 EMENDA 2 (consolidação adversarial 5 revisores — 23 achados 1P1/10P2/12P3 — com veredito do $oraculo-clean-code 🧬 confirmado_documental cap.9 "Tests are as important to the health of a project" + F.I.R.S.T. Self-Validating, range_0121_0180 sha b3a57786; 35/35 verde + tsc strict LIMPO nos 6 arquivos + check exit 0 suíte 887)**: **P1 fixture×schema (adversário)** — makeMeeting omite 10 campos obrigatórios de `Meeting` e makeResolution omitia `created_at`/`source` com cast `as`; curado SEM casts + prova `tsc --strict` pontual (que pegou DE GRAÇA 3 props fantasmas `phase` em goalAdvance que o vitest deixava passar — o motor ignora a prop silenciosamente); **causa-raiz estacionada**: tests/ fora do typecheck do pipeline (tsconfig só src/**, vitest não typechecka). **P2 teleporte de fase (adversário+revisor-codigo convergentes)** — E2E mutava store direto; curado: sequência canônica de 3 goalAdvance reais (pensamentos→planejamento→implementacao→revisao) + asserts exatos do persistido (phase revisao, status active pós-verdict pronto — advance TERMINAL é rota própria da suíte do motor). **P2 tool fantasma (contratos)** — `blockerOwner("librarian_status")` → `memory_recall` NÃO registrada nas 32 tools (bug de PRODUTO pré-existente exposto): SENTINELA deliberada no teste + EST-20261109-TOOL-FANTASMA (owner definido; decisão do conselheiro: cura de produto em Trilho próprio, não no corte de testes). **P2 tautologia do verdict (contratos+revisor-codigo)** — já curada na emenda 1 pela fonte persistida (validação dupla; revisor-codigo confirma que `verdict.status` do envelope é snapshot-objeto — a cura pela fonte era a rota certa). **P3s curados**: OR-assert com evento fantasma `review_evidence_attached` → forma fechada `evidence_attached`; double-casts flowsDir/ledgerPath removidos (props públicas readonly); documentais fixados: latestOpenMeeting vence por ORDEM do array (ignora opened_at), promotionScopeForDestinations theme-sem-theme → "tema" (guard mora no motor), validateProgressNumbers NÃO valida status ("failed" passa), falso-positivo de classe MAIOR que "validade"/"testemunha" ("rodoviaria" casa `rodar?`). **Emenda 1 mantida** (revisor testes: 4 curados + 1 qualificado). Consolidado manual pela sessão (fase auto do workflow parou no cap do provider 19:43Z; 5 relatórios em `.agents/EVIDENCIAS/2026-11-09-testes-integracao-e2e/`).

- 2026-11-09 — **D-30 EMENDA (adversarial, revisor testes: 5 achados — 4 curados + 1 qualificado, 34/34 verde)**: FAL-01 P2 assert do verdict vacuo (`?? "pronto"` sempre passava) → cura: verdict conferido pela FONTE persistida (`flow.verdicts.at(-1).status === "pronto"`); FAL-04 P3 `.not.toBe("open")` fraco → `.toBe("closed_unconsumed")` + `reusable: true`; FAL-05 P3 count `>0` → `.toBe(2)` exato (array e objeto); FAL-02 P2 falso-positivo "validade" consagrado → convertido em **SENTINELA deliberada** (nome do it anuncia: falhar = regex consertado, atualizar EST-ONDA6); FAL-03 P2 "graphify" textual sem binding → **qualificado como contrato textual por desenho** (nome do it + comentário: carregamento do grafo mora no motor, coberto pela suíte do engine — este teste não afirma cobertura de binding).

- 2026-11-09 — **D-30: testes de integração dos 4 módulos de política + E2E golden-path do ciclo GOAL** (Trilho `2026-11-09-testes-integracao-e2e-modulos.md`, flow 3982; GO único do dono "Precisamos teste end-to-end + teste-de-integração"; roteamento honrado: $interrogador-documental → mentor-documental-teste-de-integracao (FTS5 774 docs, lição Test Pyramid: E2E poucos conferindo efeitos REAIS) → RED primeiro): **4 suítes de integração com import DIRETO** — `tests/meeting-policy.integration.test.ts` (7), `tests/fiscal-blockers.integration.test.ts` (9), `tests/ppirtv-checkin.integration.test.ts` (8), `tests/memory-promotion.integration.test.ts` (8) — com helper `tests/helpers/policy-modules-fixture.ts` (Flow/Meeting/Cooperator/Evidence/Candidate mínimos reais) cobrindo ramos adversariais: gatilho negativo de reunião NÃO reativa blocker, `verdict_recorded` consome o sinal de meeting aberto, meeting elegível sem meeting_id exige retry, `latestFiscalBlock` RECONCILA blockers (anti falso-verde: blocker morto some do diagnóstico), famílias/owners/interpretações de blocker, falso-positivo CONHECIDO `validade`/`testemunha` do regex de future-action documentado fiel (ressalva estacionada), `validateProgressNumbers` rejeita totais/estados inválidos, eventos `work_progress_recorded` deformados filtrados sem quebrar o summary, resolução park sem when NÃO é rastreável, destino ÚNICO de promoção, `memoryV2CandidateId` determinístico (NFC+espaços; acento é semântica), `memoryV2Slug` com sufixo de identidade hex. **E2E `tests/goal-lifecycle.e2e.test.ts` (2)**: ciclo completo start→gate bloqueado (`review_evidence_coherent`)→review estrutural (fp pós-âncora)→gate verde→status→verdict pronto, com artefatos PERSISTIDOS conferidos no disco (flow `.json` com `goal_started`/evidence/`verdict_recorded` + ledger `.ndjson` contendo o flow) + idempotência do goal_start (mesmo flow_id, 1 arquivo). **Vigília provada por mutação 5/5** (meetingKindForType convergente→transversal, blockerOwner review_required→memory_recall, validateProgressNumbers total inválido passa, candidateId slice 23, fingerprint com nonce Date.now — cada RED flagrado pela suíte com revert imediato e src/ byte-igual). Interrogatório pagou: 2 suposições pegas pelos próprios testes (event type `fiscal_policy_blocked`, semântica do 2º parâmetro do slug). Suíte **852→886** (69 files); `npm run check` exit 0; **zero src/** (camping NOT_APPLICABLE, `no-change-signal`); LIMITES declarados: cobertura amostral por ramos (não exaustiva), camada stdio já coberta por 36 its do mcp.test.ts não é re-testada. D-30 registrado nos mapas de decisões (interno 261109b + público).

- 2026-11-09 — **Mapa de decisões público: `docs/architecture/FLOW_ENGINE_DECISIONS_MAP.md`** (skill dex-mapa-das-decisoes, modo Histórico; fotografia interna `261109b` em `.agents/MAPAS/` projetada para o repo a pedido do dono — "disponível no repo para esclarecer dúvidas de uso"): IDs estáveis **D-01..D-29** com fontes Git-permanentes (commits/CHANGELOG/ledger), **tabela dúvida-comum→decisão** no topo (9 atalhos: onde mora meetings/gate/fiscal/checkin/memory-promotion, por que o envelope de erro ensina, como confiar na preservação...), L1 índice executivo + L2 blocos `## D-xx` (formato de consumo por LLM: `rg "D-xx"` + leitura dirigida; JSON só para consumidor mecânico como o ledger). Publicação completa (regra `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL`): README + docs/INDEX.md (2 seções) + docs/architecture/INDEX.md + rota no AGENTS.md (localizador `PPIRTV-FLOW-ENGINE-DECISIONS-MAP`) + INDEX raiz; PLAYBOOK regen (AGENTS é fonte — 8 regras). Regra de manutenção publicada: sessão que criar onda/cura nova atualiza o mapa na mesma entrega. Zero src; par CAPACITY com reavaliação `reavaliacao_decisions_map_publico`.

- 2026-11-09 — **Documentação pós-maratona: mapa de código por módulo** (skills dex-documentacao + projeto-doc-mapear-documentacao + documentacao-tecnica; mapeamento read-only antes da escrita): **`src/INDEX.md` NOVO** (núcleo de orquestração + 5 módulos de política + SSOTs, pós-maratona 8181→4933) com netos `src/memory/INDEX.md` e `src/security/INDEX.md`; INDEX raiz ganha a árvore (`src/`, netos, `docs/architecture/INDEX.md`); README "Documentation for agents" roteia o mapa de código; fix de links `.agents/MAPAS/{INDEX,HISTORICO-DESMONTAGEM}.md` (`../INDEX.md`→`../../INDEX.md`). Validação: `check-markdown-links.py` — doc viva limpa (219 quebrados são zonas históricas: BACKUPS/REPORTS congelados/REVIEWS com âncoras de linha/TMP). Fonte viva: FLOW_ENGINE_EVOLUTION.md (mapa de extrações) continua a âncora da arquitetura.

- 2026-11-09 — **Onda 7 emenda: adversarial consolidada (0 P1/3 P2/7 P3) — contagens reconciliadas 5341/−408 (linha fantasma pela 3ª vez), claim errorMessage qualificado** (mesma sessão, flow 3952; 5 revisores, confirmado ao vivo pela sessão): baseline real `601c8ac` = **5341L** (não 5342 — o número veio do `len(split('
'))` do script de corte DE NOVO, apesar da régua escrita; o mesmo arquivo é chamado de 5341 pela emenda Onda 6 no mesmo CHANGELOG), delta real **−408L**; range do bloco corrigido para **l.4837-5268** (432L; a última linha removida é branca). **Claim `errorMessage` qualificado**: fonte única para o MOTOR — restam 2 cópias privadas pré-existentes byte-idênticas em `memory/memory-graph-provider.ts:232` e `memory/memory-recall.ts:313` (duplicação pré-corte, risco de drift, estacionada). Estacionados: 33 símbolos sem teste direto + evidence_selectors do record sem seletor para mcp.test (tio-testador, junto com EST-20261109-ADV-ONDA5/6); robustez pré-existente fiel (branches mortos writtenIds, sameCandidateResolution order-sensível, memoryV2OperationId ordem de tags, densidade→light silencioso — todos byte-idênticos ao baseline, mitigados ou não-regressão). Suíte 848+4=852; tsc 0; zero mudança de código (a emenda é documental).

- 2026-11-09 — **Onda 7 (ÚLTIMA): eixo memory-v2/promotion sai do monólito — a maratona de famílias termina** (marker `FE-2026-11-09-ONDA7-MEMORY-PROMOTION-SHRINK`; Trilho `2026-11-09-onda7-memory-promotion.md`, flow 3952; GO único do dono): **33 símbolos** (32 funções + type `V2CommittedBoundaryError`) migram como bloco contíguo (l.4837-5267 do monólito pré-corte, 432L) para **`src/memory-promotion.ts`** (458L) — candidatos/resolução (`latestTraceableCandidateResolutionMap`, `applyMemoryCandidateResolution`, `sameCandidateResolution`), v2 IDs/receipts (`memoryV2Slug/CandidateId/OperationId/ReconciliationId`, `v2ReceiptsProveCommittedEffect`), escopo confinado (`requireConfiguredV2Root`, `confinedV2Workspace`, `requestedV2MiningClassification`), promotion (`isPromotionScope`, `promotionDestination/ScopeForDestinations/ThemeForDestinations`, `v2PromotionClassification`, `candidateScoreTotal/Identity/Lookup`), decisão de escrita (`memoryWriteDecision`, `memoryNonWriteAction/Reason`, `memoryEditSuggestion`) + ledger de candidatos. **`errorMessage` → lang-utils** (fonte única, molde requireText/nowIso). Motor importa 29 símbolos; dependência do bloco em função não-migrante era SÓ errorMessage (interrogada por probe pré-corte). **Monólito 5342→4933 (−409L)** *(emenda: baseline real 5341, delta −408 — ver entrada de emenda)*; suíte **848+4=852 SEM editar teste**; tsc 0; **vacina TOTAL pegou 9 mortos ANTES do commit** (6 do corte + 3 de linhas únicas gigantes). Camping SHRINK com **janela acumulada** defacc1→corte (record cobre emenda 3ff6d7e + playbook 601c8ac + corte — lição da Onda 6 embutida). **Depois desta onda resta apenas o núcleo de orquestração (por desenho) — a maratona de famílias fecha aqui.**

- 2026-11-09 — **Onda 6 emenda: adversarial consolidada (0 P1/3 P2/10 P3) — 42 imports mortos cortados (vacina aprende a varrer TODOS os blocos), contagens reconciliadas, `__stash__` documentado** (mesma sessão, flow 3917; 5 revisores, clusters confirmados ao vivo): a varredura anti-import-morto pegou 2 mortos no bloco NOVO mas **não revarria os imports antigos** — o corte mortificou **8 imports de blocos pré-existentes** (consumidores migraram) e a sonda TOTAL revelou **34 mortos acumulados das Ondas 1-5** que nenhuma onda varreu (barata nunca está sozinha): 42 cortados de uma vez, monólito 5503→**5341**; tsc 0; suíte **848+4=852**; vacina agora varre TODOS os blocos de import (parser por bloco completo, corpo = arquivo sem imports). **Contagens reconciliadas por medição**: baseline real `b5d5f95` = **6155L** (o 6156 era a linha fantasma do split de novo — a régua `wc -l` estava escrita e foi ignorada); import do motor = **12 símbolos** (não 13 — `checkInTrailAlignment` foi o morto que a vacina cortou e o contador textual ficou pré-corte); mensagem do commit b5d5f95 anunciava 25 imports, real **23** (15 monólito + 8 fiscal-blockers). **Campo `__stash__: true` vazou para o record ONDA6 selado** (artefato do script de preparação do ledger; sem produtor/consumidor; record imutável pós-selo) — documentado no FLOW_ENGINE_EVOLUTION.md como emenda textual. Estacionados: testes diretos dos símbolos migrados (3 P2 do revisor testes: legacy_unclassified, regex quando/future-action com falso-positivo "validade"/"testemunha", ~metade dos 23 símbolos; owner tio-testador), invariante parent→base_blob do validador para janela acumulada (Trilho futuro), README 5×6 components (pré-existente), robustez P3 (workProgressEvents data:null, progressText maxLength≤0, compactPpirtvCheckout null assimétrico, memoryLayersFromFiles caminho relativo).

- 2026-11-09 — **Onda 6: família check-in/check-out PPIRTV sai do monólito** (marker `FE-2026-11-09-ONDA6-PPIRTV-CHECKIN-SHRINK`; Trilho `2026-11-09-onda6-ppirtv-checkin.md`, flow 3917; GO único do dono com mesa QUESTIONADORES-ATIVADO e RESPIRA-ANTES-DE-CODAR — fotografia declarada antes do corte: 3 blocos contíguos, dependências cruzadas interrogadas): **23 funções + 2 consts** migram para **`src/ppirtv-checkin.ts`** (696L, módulo novo) — check-in/check-out (`ppirtvCheckIn/Out`, `checkInTrailAlignment`, `compactPpirtvCheckout`), accountability (evidence/learning/loop/memory/utility + `countBySignature`, `memoryLayersFromFiles`), sub-família evidence-quality que acompanha (`classifyEvidenceQuality`, `evidenceQualityReasons`, `goalEvidenceMetadataNote`, `mergeEvidenceNotes`, `hasFutureAction`, `hasQuando`, `missingQuandoGate`, `FUTURE_ACTION_PATTERN`/`QUANDO_INDICATOR`) e work-progress (`progressText`, `validateProgressNumbers`, `workProgressEvents`, `workProgressSummary`) + `memoryMiningStatus`. O bloco é **autônomo do monólito** (zero dependência de funções não-migrantes — interrogado por probe antes do corte); motor importa 13 símbolos. **Monólito 6156→5503 (−652L líquido; −666 brutos)**; suíte **848+4=852 SEM editar teste**; tsc 0. **Vacina Onda 5 aplicada e paga no primeiro uso: varredura anti-import-morto pegou 2 mortos ANTES do commit** (`checkInTrailAlignment` no monólito — todo chamador migrou; `path` preventivo no módulo). Camping SHRINK. Ficam por desenho: eixo memory-v2/promotion (l.5340-5771 — onda futura), utils do motor (`progressReceipt`, `assertPhase`, `normalizeSuggestedCooperators`, `materialActiveCredits`, `memoryWriterRuntimeSummary`, `collectTempFiles`).

- 2026-11-09 — **Onda 5 emenda: adversarial consolidada (0 P1/2 P2/8 P3) — 25 imports mortos cortados, contagens reconciliadas, CAPACITY receipt re-ancorado** (mesma sessão, flow 3874; 5 revisores independentes, clusters confirmados ao vivo pela sessão dona antes de curar): **imports mortos do corte mecânico removidos** — 15 no monólito (todo chamador migrou junto: `hasReviewEvidence`, `librarianRequired`, `isBlockerStillActive`, `blockerSources/Family/Interpretation`, `whyFiscalModeNotActive`, `memoryRequiredDiagnostics`, `memoryMiningVerdictStillBlocked/BlockedDiagnostics/BlockedSequence`, `librarianExplicitlyOutOfScope`, `librarianReason`, `graphifyReason`, `statusValue`) e 10 no módulo (`Scope`, `Verdict`, `writeMemoryCandidate`, `MemoryLibrarian`, `MemoryHookRunner`, `DexMemoriaV2FlowWriterConfig`, `PpirtvStore`, `assertNoSecretLikePayload`, `requireText`, `nowIso`); tsc não flagrava (sem `noUnusedLocals`). **Contagens reconciliadas por medição**: baseline real `db823f1` = **7071L** (não 7072 — o `len(split('\n'))` do script de corte contava linha fantasma), delta real **−901L**; símbolos movidos = **50 top-level** (44 no selo AST + 2 consts não-AST `FISCAL_POLICY_DEPS`/`MEETING_RESOLVABLE_BLOCKERS` + 4 tipos omitidos da lista do selo). **P2 receipt curado**: `CAPACITY.receipt.json` re-ancorado com `head`/`tree_hash` REAIS da árvore medida (write-tree staged; antes congelado em `db823f1` há 4 receipts). Estacionados (P2/P3): teste direto do módulo (owner tio-testador), asserção tautológica `expect(true)` na fixture RED, spawn git sem timeout, asserts fracos de presença, gramática "saem". Suíte **848+4=852**; tsc 0.

- 2026-11-09 — **Onda 5: diagnóstico de bloqueio fiscal + ações diretas sai do monólito** (marker `FE-2026-11-09-ONDA5-FISCAL-BLOCKERS-SHRINK`; Trilho `2026-11-09-onda5-fiscal-blockers.md`, flow 3874; GO único do dono, régua ESCOTEIRO-ONDA, eixo indicado pelo $oraculo-clean-code — SRP cap. 10/organizing for change): **~48 símbolos top-level** migram para **`src/fiscal-blockers.ts`** (995L, módulo novo) — família librarian (librarianRequired/ExplicitlyOutOfScope, latest/structuredLibrarianStatus, librarianReason, librarianCheckoutAccountability), blocker-diagnostics (blockerDiagnosticsFor/Sources/Family/Interpretation, isBlockerStillActive, reconciledBlockers, latestFiscalBlock, whyFiscalModeNotActive), memory-mining-blocked (verdictBlockers/StillBlocked/BlockedDiagnostics/BlockedAction/BlockedSequence, memoryRequiredDiagnostics), ações diretas (blockedDirectAction, phaseAdvance/blockedArchive, withDirectAction, fiscalBackTo, nextRequiredActionFor, blockerResolutionGuidance), loop/escalation (fiscalLoopMonitor, strongestLoopMonitor, loopEscalationFor, blockerLoopId, MEETING_RESOLVABLE_BLOCKERS, blockerOwner), hasReviewEvidence + FISCAL_POLICY_DEPS + statusValue + tipos (BlockerDiagnostics, RecallVisualStatus, MemoryMiningV2Summary, V2MemoryCandidateResolution); **`requireText`/`nowIso` viram exports de `lang-utils`** (fonte única; monólito importa). **Monólito 7072→6170 (−902L)**; suíte **848+4=852 SEM editar teste** (comportamento preservado); camping SHRINK. Ficam por desenho: evaluateFiscalPolicy e helpers diretos (a avaliação), check-in/graphify e promotion-scope (outros eixos). *(Emenda 2026-11-09, adversarial consolidada: contagens reconciliadas — baseline real 7071L, delta −901L, 50 símbolos movidos (44 selo AST + 2 consts + 4 tipos), 25 imports mortos cortados; ver entrada de emenda acima.)*

- 2026-11-09 — **Cura-6 emenda: P1 da adversarial curado — grandfathering de selo histórico no nascimento** (mesma sessão, mesa QUESTIONADORES-ATIVADO; P1 convergente de 3 revisores com probes reais): `committedSealKeys` (id+commit) lidos do manifest do HEAD — elo cujo selo já está commitado passou pelo gate do seu commit com as regras da época (parent pré-cura-3 não é crime retroativo); nascimento é o selo ainda não commitado. RED F (elo selado em commit intermediário sem parent — probe real 4bf8aab..HEAD: 5 falsos → **0**); P3 pago: `cat-file` do chain com blob loose vira `LEDGER_CHAIN_BLOB_UNREADABLE` estruturado (crash sem receipt, classe REGRESSAO-ERROR-PATH), `record.id ?? "unknown"` no birth loop, typo receipt, contador de suíte corrigido por medição viva **848+4=852**. Suíte 852; adversarial CONSOLIDADA (1 P1/3 P2/9 P3) em `.agents/AUDITORIAS/adversarial-261109-cura6/`.

- 2026-11-09 — **Cura-6: rede do fiscal + janelas restantes da selagem + vocabulário Provide Context** (marker `FE-2026-11-09-CURA6-SEAL-REMAINING`; Trilho `2026-11-09-cura6-seal-remaining.md`, flow 3834; GO único do dono no veredito do $oraculo-clean-code como mentor consultor — Simple Design Rule 1 aplicada ao fiscal): **P2-A** ledger encolhido — record selado removido do head reprova `LEDGER_PREFIX_RECORD_REMOVED:{id}` com reason próprio (o dereference cru `after.id` lançava TypeError engolido pelo catch e o receipt acusava `BASE_LEDGER_UNREADABLE` FALSO — "error handling que obscurece lógica" cap. 7); **P2-B** conferência de nascimento cobre TODOS os `chainRecords` (birthRecords), não só o declaration tail — intermediário novo com selo de blob mentiroso escapa de toda verificação (probe da adversarial: SEAL REASONS=[]); **P2-C** rede da cura-5: vacinas de invariância do `canonicalJson` — E discriminante (ordem de chaves NÃO-selo trocada no prefixo não é mutação; **RED-por-mutação provado**: stringify cru fabrica `LEDGER_HISTORY_MUTATED`) + D integração (selagem reordenada exit 0); **P3s Provide Context**: `COMMIT_SEAL_TARGET_MISSING:{id}` distinto de `COMMIT_SEAL_COMMIT_NOT_FOUND` (rev-list discrimina commit inexistente × commit-sem-target; o seal-diff reorganizado lê pais primeiro), enums unificados nos 3 paths (B2 e loop LEDGER_PREFIX migram de `LEDGER_PREFIX_COMMIT_SEAL_MISMATCH` genérico), typo MD, CAPACITY receipt em dict. 3 REDs baseline 1ed5dcb → GREEN; suíte **846+4=850**; camping NOT_APPLICABLE (fiscal puro).

- 2026-11-09 — **Cura-5: error-path do selo com receipt estruturado + janelas restantes da selagem** (marker `FE-2026-11-09-CURA5-SEAL-ERROR-PATH`; Trilho `2026-11-08-cura5-seal-diff-crash.md`, flow 3805; P1 da adversarial cura-4 — regressão do 8ad367a, lição `REGRESSAO-ERROR-PATH-TRY-CATCH`): **P1 crash do seal-diff FECHADO** — `rev-list` de linhagem mora no MESMO `try` do `rev-parse` do blob (commit inexistente devolve `COMMIT_SEAL_COMMIT_NOT_FOUND` estruturado; antes o CLI crashava SEM receipt); **P2 blob do nascimento** — o path de declaração (B2) agora confere `commit:TARGET` contra o `head_blob` declarado (`COMMIT_SEAL_BLOB_MISMATCH` — linhagem honesta + blob mentiroso era selo verde); **P2 deselagem** — guard do LEDGER_PREFIX olha o PAR (`after.commit || before.commit` com `recordChanged`): remover o commit de record selado em diff de motor reprova `COMMIT_SEAL_COMMIT_MISSING`; **P2 recordChanged canônico** — `canonicalJson` (chaves ordenadas recursivas) nas 3 comparações de record (LEDGER_PREFIX, `preservedPrefix`, `COMMIT_SEAL_RECORD_CHANGED`): re-serialização com outra ordem de chaves não fabrica nem esconde mudança. 3 REDs provados no baseline c7b2ed6 (fixtures exercitam seal-diff/B2/LEDGER_PREFIX de verdade — `--head WORKTREE` + declaration casando o par base/head do diff) → GREEN; suíte **842+4=846**; camping **NOT_APPLICABLE** (primeira cura 100% fiscal: `src/flow-engine.ts` intocado — sem record no ledger por desenho).

- 2026-11-08 — **Cura-4: linhagem de selagem incondicional (helper único nos 3 gates) + rede antes da pá** (marker `FE-2026-11-08-CURA4-SEAL-LINEAGE-UNICO`; Trilho `2026-11-08-cura4-seal-lineage-unico.md`, flow 3778; GO do dono aceitando recomendação do $oraculo-clean-code autenticada no corpus en-2008): **P1-1 motor-laundering FECHADO** — `sealLineageReasons` helper único consumido pelo LEDGER_PREFIX (dispara quando o record ENTRA ou MUDA no diff, não só quando commit muda), pelo path de declaração (record novo com commit fabricado nasce conferido — RED B2) e pelo seal-diff sem o continue que mascarava BLOB_MISMATCH; **P1-2/P2 fechados** — `selectorIsReplayable` (self-match `new RegExp(seletor).test(seletor)` fecha irmão colidente) + **grandfathering DECLARADO** (`LEGACY_SELECTOR_EXEMPT` com id CURA2 — o replay bootstrap volta verde com isenção visível, RED C); **F4/G9 pago** — `providedSatisfied` (morto com comentário falso) ENTERRADO; **G5 pago** — `backfillReattachLedger` helper único com ordem unificada (reattach→flow_created→goal_started nos 2 caminhos, aceita pelo dono) + imports do motor consolidados; **dialetos changed-files PINADOS** em teste (toStringArray coercivo × strictPathArray rejeitante — a "unificação proibida" vira contrato executável); bug latente corrigido: `importSpecifier(consumer, undefined)` lançava falso PRODUCT_CONSUMER_NOT_FOUND para EXCEPTION sem destination. 4 REDs provados no baseline 7d5b67b → GREEN; suíte **839+4=843 sem editar teste**; camping EXCEPTION.

- 2026-11-08 — **Onda 4: família verdict-coherence + wrappers de requisito migram para gate-resolution — higiene da Onda 3 paga no mesmo corte** (marker `FE-2026-11-08-ONDA4-GATE-RESOLUTION-SHRINK`; Trilho `2026-11-08-onda4-gate-resolution.md`, flow 3751; GO do dono, régua ESCOTEIRO-ONDA): **11 símbolos** saem do monólito para `src/gate-resolution.ts` (646→784L) — `hasRequirement`+`officialGoalNeedsCanonicalVerdict` (wrappers de `resolveGateRequirements`; este com 7 consumers), `reviewEvidenceRequested`/`structuredReviewAttestationRequested` e a família de coerência review×changed_files do VERDICT com **renomes anti-colisão** (`canonicalVerdictChangedFiles`, `verdictChangedFilesSnapshotAt`, `verdictChangedFilesAfterEvent` + `changedFilesMatchReview`/`reviewedChangedFilesForVerdict`/`reviewRemainsCurrent`/`verdictHistoryIndex`); as variantes irmãs de EVIDENCE que já moravam lá **coabitam SEM unificação** (stringArray+unique+sort × reviewPathArray+sameReviewPaths — dedup cego mudaria comportamento; laudo 2026-10-17) e a `stringArray` local (predicado-guard) ganha alias `toStringArray` para a conversora de lang-utils. **Higiene EST-20261108-ADV-ONDA3 itens 1-4 paga**: header do meeting-policy reescrito (família sequencer COMPLETA mora nele), 4 sequencers sem consumidor externo des-exportados, **par morto `hasMaterialMeetingOrRegress`+`hasMaterialMeeting` removido com rg de ausência**, imports duplicados consolidados, `truthy` privada renomeada `providedSatisfied` (dialeto PROVIDED com nota do laudo). **Motor 7223→7097 (−126L)**; suíte **835+4=839 sem editar teste**. Camping SHRINK reasons [].

- 2026-11-08 — **Cura-3: seletor validado como regex + parent_commit obrigatório na selagem + backfill no early-return terminal** (marker `FE-2026-11-08-CURA3-SELO-PARENT-OBRIGATORIO`; Trilho `2026-11-08-cura3-selo-parent-obrigatorio.md`, flow 3719; P1 da adversarial cura-2 confirmado por comando + P2s convergentes): o gate de `evidence_selectors`/`red_evidence` passa a validar que o seletor, **como REGEX**, casa o título declarado (`selectorRunsAsRegex`; `EVIDENCE_SELECTOR_REGEX_INVALID`/`RED_SELECTOR_REGEX_INVALID`) — o caso canônico dos parênteses literais casa `includes()` mas roda **0 testes com exit 0** no replay do `vitest -t` (falso verde de replay; o seletor do record CURA2 rodava 22 skipped/0). A selagem vira **opt-out fechado**: record que ganha `commit` sem `parent_commit` reprova `COMMIT_SEAL_PARENT_MISSING`, remoção do campo em seal-diff reprova `COMMIT_SEAL_PARENT_REMOVED`, e o path de declaração confere a **linhagem** de records selados no mesmo diff do motor (`LEDGER_PREFIX` agora invoca `sealedParentReasons` — fechando a rota same-commit que validava só blob). No motor: o **early-return reused&&terminal** ganha o mesmo backfill do re-attach do branch comum (a trilha do ledger não depende de qual caminho devolveu o status). Higiene: assert do backfill comum pina `_recovered`, typo P2/P2, prosa truncada do MD. 3 REDs → GREEN 38/38 nos 2 arquivos; suíte 835+4=839.

- 2026-11-08 — **Onda 3: política de meetings/required_cooperation mora fora do monólito — SHRINK que paga a FE-DEBT-006** (marker `FE-2026-11-08-ONDA3-MEETINGS-POLICY-SHRINK`; Trilho `2026-11-08-onda3-meetings-policy.md`, flow 3693; GO do dono): **49 símbolos top-level** do eixo meeting/required_cooperation saem do `flow-engine.ts` para **`src/meeting-policy.ts`** (941L) — sinais, material, diagnóstico, participantes, kind/type, ledger-data, apply/assert, **família sequencer COMPLETA** (requiredCooperation/loop/research/emergency/badLoop/reviewRequired + `LoopMonitor`; a dependência cruzada de `loopMeetingSequence` com as irmãs refutou a exclusão inicial), resolução de skills de cooperação e cooperators. Acompanharam por fonte única: `unique/truthy/stringArray/uniqueCooperators` → **`src/lang-utils.ts`** (motor+policy) e `latestFiscalBlockEvent`/`MEMORY_MINING_BLOCKED_VERDICT_REASON` → `verdict-fiscal-policy.ts`. **Monólito 8180→7210 (−970L, −12%)** com **zero símbolos adicionados** (AST diff); suíte **832+4=836 sem editar teste**; mensagens byte a byte. Camping **SHRINK com `pays_debt_id=FE-DEBT-006`** — a dívida sai do ledger. *(Emenda 2026-11-08, adversarial Onda 3 consolidada: contagens reconciliadas — 47 `removed_symbols` no record, 48 declarações em meeting-policy, 54 removidas no diff todo, delta medido 8179→7210 = −969L; ver emenda documental no FLOW_ENGINE_EVOLUTION.md.)*

- 2026-11-08 — **Cura-2: selo vivo confere linhagem + backfill do re-attach** (marker `FE-2026-11-08-CURA2-VALIDADOR-SELO-VIVO`; Trilho `2026-11-08-cura2-validador-selo-vivo.md`, flow 3667; P1 da adversarial da cura confirmado por prova executada): o **selo VIVO** (`evaluateCommitSealDiff`) agora reprova `COMMIT_SEAL_PARENT_MISMATCH` para record selado cujo `parent_commit` não casa nenhum pai real do rev-list — o helper antes vivia **só no replay de bootstrap** (caminho morto desde o manifesto existir; a rodada real devolvia PASS com `ledger_bootstrap: null`). Predicado de pai vira **fonte única** (`parentMatchesCommit`), `selectedParent` é sempre full sha do array de pais (prefixo cru nunca vai ao rev-parse), merge com pai mentiroso emite só MISMATCH, e o bootstrap ganha a isenção de EXCEPTION sem `destination_module` igual ao path de declaração. No motor: **backfill do re-attach** — o reuso confere history persistido × ledger e completa a trilha ausente via `ensureLedgerTransitionRecorded` (`spt_traceability_reattached_recovered`) quando o append falhou pós-save. Higiene: regex do teste sem cruzar critérios, MD da cura no rodapé cronológico + nota do red_command irrep rodável, commits curtos remanescentes em full sha. 2 REDs → GREEN 35/35; suíte 832+4=836.

- 2026-11-08 — **Corte de cura: ordem do evento de re-attach + linhagem do ledger de camping + validador de pai único** (marker `FE-2026-11-08-CURA-ADVERSARIAL-LINHAGEM-LEDGER`; Trilho `2026-11-08-cura-adversarial-linhagem-ledger.md`, flow 3637; achados CONFIRMADOS das adversariais Onda 2/2b): **P1 2b** — o ledger do evento `spt_traceability_reattached` passa a ser escrito somente **DEPOIS de `saveFlow` persistir o flow** (flag `reattachLedgerData`; history segue atômico com o save; actor `dex-code`) — trilha falsa impossível quando saveFlow ou o secret-gate falham (RED: ledger continha o evento de re-attach que nunca persistiu; retry gravava duplicado). **P1 Onda 2** — helper puro `sealedParentReasons` no validador reprova `COMMIT_PARENT_MISMATCH` para pai armazenado que não casa nenhum pai real **inclusive em pai único** (ponto cego), prefixo ≥7 aceito; **linhagem corrigida** (PATH-ATTRIBUTION `parent_commit`→`0bdd375` full — pai real dono do `base_blob`; CONVERGENCIA e commit do ONDA2B em full sha). Prosa do record selado imutável (`stripSeal`), correção documental no MD. **Higiene**: CAPACITY dedup, gaps de teste (fingerprint incondicional, ledger escopado por flow_id, conteúdo da admissão), hoist `traceIndexFor`, un-export `SptTraceIndex`. 2 REDs provados → GREEN 33/33 nos 2 arquivos.

- 2026-11-08 — **Onda 2b: evento de re-attach + pré-indexação — itens reais da FE-DEBT-006 entregues** (marker `FE-2026-11-08-ONDA2B-REATTACH-EVENTO-INDICE`; Trilho `2026-11-08-onda2b-fecha-fe-debt-006.md`, flow 3601): o re-bind que reata `spt_traceability` de flow órfão (cura da issue #10) deixa **trilha de auditoria** — evento `spt_traceability_reattached` no history E no ledger com flow_id e fingerprint do contrato (helper puro `sptTraceabilityReattachedEventData` + 4 linhas de cola no motor). Qualify/cobertura/declarative consultam o **índice pré-construído `SptTraceIndex`** (WeakMap, O(C+E) uma única vez; `traceabilityFromContract` pre-aquece) — **zero `.find` linear** no caminho de qualificação (rg exit 1 nos dois módulos); shape persistido `{requirements,tasks}` inalterado, flows antigos ganham índice lazy na 1ª consulta. RED provado (0 eventos no baseline 217c389) → GREEN 11/11; suíte 828+4=832. Pagamento estrutural do record FE-DEBT-006 (`pays_debt_id`) agendado no SHRINK verificado da Onda 3 (decisão do desenho com o fiscal: validador exige símbolo removido + saldo negativo).

- 2026-11-08 — **Onda 2: sentinela de admissão v3 mora no SSOT** (marker `FE-2026-11-08-ONDA2-SENTINELA-ADMISSAO-V3`; Trilho `2026-11-08-onda2-sentinela-admissao-v3.md`, flow 3570): `assertCriterionProofAdmission` exportada de `src/spt-traceability.ts` unifica as 4 checagens inline do `attachEvidenceUnlocked` (v2 rejeita / v3 sem mapa rejeita / v3 qualifica — mensagens preservadas byte a byte); monólito com **zero checagem SPT_V3 inline** (rg prova). RED→GREEN 10/10. Selagem pós-commit dos records da noite para o camping (retroativos).

- 2026-11-08 — **Convergência PR12: `review_scope_attribution` vira a única rota canônica** (marker `FE-2026-11-07-CONVERGENCIA-PR12`; Trilho `2026-11-07-convergencia-pr12-atribuicao-escopo.md`, flow 3501; GO do dono no veredito do $oraculo-pragmatico): merge do PR12 (evidência `review_scope_attribution` com binding v1 + `goal_verdict.scope_attribution_evidence_ids`, tipo `GoalVerdictInput` extraído, motor −26 linhas, QUICKSTART documentado) + **revert do `path_attribution`** do 080abdd (supersede o record `...-PATH-ATTRIBUTION-REGRESSAO-C01`), preservando T24b/Onda 1 e os records do ledger. Espelho do schema-index ganha `scope_attribution_evidence_ids`. RED real da convergência: 6 cenários MCP stdio do PR12 falhavam por forma de path (8.3×longo) — assert curada por **identidade fs (dev+ino)** preservando a intenção. **Validador de camping curado em 2 classes com RED** (20/20): `sealed_retroactive` (record selado ancestral do base = história, não corte novo) e `supersedes_record` (convergência explícita) — regra-mãe preservada. 12/12 no corroboration.

- 2026-11-07 — **Regressão C-01 da issue #11: `path_attribution` no goal_verdict** (marker `FE-2026-11-07-PATH-ATTRIBUTION-REGRESSAO-C01`; relato do dono com RED confirmado em 05e8563): a rota pública prometida pela cura da issue #11 agora existe no próprio veredito — `{path, sha256, justification}` por acréscimo legítimo dos `pending_review_additions`; política pura `applyPathAttribution` em `src/review-snapshot.ts` (triagem em sha divergente/caminho indeterminado/sensível — nada aplica), cola no verdict que amplia o snapshot, atualiza o fp do conjunto ampliado, audita `path_attribution_applied` (history+ledger) e anexa revisão derivada citada cobrindo o conjunto final; schema MCP com o campo opcional. Sem atribuição, fiscalização padrão preservada. RED→GREEN fiel ao roteiro do dono (fixture motor-direto) + teste de triagem: 8/8 no arquivo, suíte 821+4=825 (+2).

- 2026-11-07 — **Onda 1 da desmontagem: teto terminal consome o SSOT de goal_start** (marker `FE-2026-11-07-ONDA1-GOAL-START-SSOT`; Trilho `.agents/PLAN-TASKS/2026-11-07-desmontagem-flow-engine-ondas.md`, flow 3464): a 3ª cópia da sequência (`close_flow_with_reservation`, rota do teto terminal) ensinava `goal_start` com args locais **sem `evidence_required`/`source`** — reprovados pelo schema vivo; consumidor que copiasse a sequência do teto batia no falso-verde programado. Cura: `goalStartTaughtArgs` exportado do SSOT `src/error-envelope.ts` e o passo `order: 3` do motor consome o builder (diff líquido no monólito: 1 import + 1 linha). RED→GREEN `tests/engine.test.ts` T24b — motor REAL (3 regressos → verdict bloqueado → `goal_status`) até a rota terminal, sequência validada pelo oráculo `validateSequenceSteps` com schema-index espelhado; T24 inalterado; suíte do cluster 31/31. Camping EXCEPTION `public_compatibility` no ledger. FE-DEBT-006: item da 3ª cópia PAGO; seguem sentinelas + `evaluateExpectation` + meetings na fila do mapa de decisões.
- 2026-11-07 — **FE-2026-11-07-ISSUE11-ATTRIBUTION**. Atribuição explícita de caminhos externos por evidência `review_scope_attribution`, com revisor, origem e justificativa. O servidor vincula a atestação à base Git e ao conteúdo observado. `goal_verdict` seleciona as evidências por ID, protege caminhos declarados e rejeita atribuição obsoleta ou caminhos novos sem atribuição. O veredito registra os IDs usados e o mesmo snapshot avaliado. Regressões pela entrada MCP stdio cobrem aceitação de código revisado, mudanças no excluído e no alvo, caminho novo, alias de caminho protegido e fingerprint incorreto. Flows existentes mantêm seus IDs.

- 2026-11-07 — **Diretriz ESCOTEIRO-ONDA** (dono, noite): as ondas densas do mapa da maratona são executadas **a cada ajuste** — fix que tocar cluster já mapeado extrai a onda inteira daquele cluster no mesmo corte (exemplares vivos: fiscal-policy, spt-traceability, verdict-learning, mining-policy, review-snapshot), nunca a pedra minúscula; a maratona é contínua, não um bloco à espera de mega-GO. Cláusula emendada no `AGENTS.md` (CLAUSULA DE MARATONA). FE-DEBT-006 segue sendo paga pelos próximos escoteiros-onda que tocarem seus cantos (3ª cópia flow-engine:6087, sentinelas, evaluateExpectation).

- 2026-11-07 — **Issue #11: verdict bloqueado não persiste a ampliação do snapshot** (marker `FE-2026-11-07-ISSUE11-BLOCKED-VERDICT-SNAPSHOT`; Trilho `.agents/PLAN-TASKS/2026-11-07-issue11-verdict-bloqueado-nao-persiste-ampliacao.md`, flow 3428): em worktree compartilhado, o `goal_verdict` corroborava com git ANTES da avaliação e o `persistFiscalBlock` salvava o flow com o conjunto ampliado (4→6.475 paths; 2 flows reais presos) — a inflamação ficava persistida para sempre. Cura: no caminho de bloqueio, `restoreBlockedVerdictSnapshot` (função pura em `src/review-snapshot.ts`, FORA do monólito) restaura `changed_files`/`deleted_files` do último gate aprovado com snapshot (evidência histórica) e registra os acréscimos como `pending_review_additions` auditáveis no evento `fiscal_policy_blocked` (history+ledger, payload único fatorado); a AVALIAÇÃO continua honesta com o conjunto corrente. **Recuperação pública no mesmo flow**: `goal_status` expõe `pending_review_additions` — lean traz `count`+`restored_from`+receita de atribuição (teto <5KB preservado), full traz o array completo; a receita ensina a re-declarar os acréscimos legítimos como `provided.changed_files` no próximo gate (os alheios ficam como registro auditável). Vacina RED-first com o molde `commit-then-verdict` do relato da issue (commit pós-base + untracked pré-existente): RED 2/2 provado antes da cura, GREEN 6/6 com goal_status verificado nos 2 modos. Camping EXCEPTION (fix com RED real, lógica nova fora do monólito, helper `pendingReviewAdditionsFor` movida para review-snapshot.ts). Ressalva: a política de corroboração do verdict POSITIVO segue honesta (avalia o worktree inteiro) — atribuição por gate é a rota de saída documentada.

- 2026-11-07 — **Família completa de args ensinados executáveis em TODAS as rotas de goal_start** (smoke de régua do workflow `revisao-adversarial` perfil rapido, runs `dwfrun-75470f15`+`dwfrun-ffb1707d`, CONSOLIDADO `.agents/AUDITORIAS/adversarial-smoke-rapido-261107/`; Trilho `.agents/PLAN-TASKS/2026-11-07-envelope-familia-todas-rotas.md`): **P1** — a 4ª cópia da sequência morava no próprio SSOT: `terminalReservationTail` ensinava `goal_start` sem `evidence_required`/`source` na rota composta do teto terminal (probe real do adversário com esbuild+oráculo; nenhum teste cobria `attempt_regress_limit_reached`) — curada com `evidence_required: true` + `source` e vacinada (sequência inteira aprovada pelo oráculo + RED documentado da forma antiga). **P2#1** — builders ensinavam placeholder string `"<evidence_required>"` para campo `z.boolean()`: verbatim falhava por TIPO; agora `true` literal com replay verbatim-por-tipo provado nas 3 rotas. **P2#2** (3 lentes convergentes) — schema-index manual podia divergir do servidor em silêncio (já divergia: `flow_role` ausente, enums de `requested_verdict_policy`/`risk_level`/`mode` sem enum, `goal_verdict` sem `residual_risks`, `flow_archive` ausente): index movido para `tests/helpers/sequence-schema-index.ts` e **espelhado contra o tools/list real** no `mcp.test.ts` (required+type+enum por campo — evolução do servidor reprova a suíte, não a frota); o espelho caçou 2 drifts do index velho na 1ª rodada (`flow_id` das meetings é optional no vivo). FE-DEBT-006: 4ª cópia CURADA, 3ª (`flow-engine.ts:6087`) segue como única pendência — flow-engine intocado (camping NOT_APPLICABLE).

- 2026-11-07 — **P1 do workflow revisao-adversarial** (10/10 lentes, CONSOLIDADO `.agents/AUDITORIAS/adversarial-261107-review-fixes/`; Trilho `.agents/PLAN-TASKS/2026-11-07-envelope-executavel-evidence-required.md`): o `required_tool_sequence` de `SPT_V3_TRACEABILITY_MISSING` ensinava `goal_start` SEM `evidence_required` — obrigatório no schema vivo (`PPIRTV_INPUT_INVALID` na chamada verbatim; 3 revisores provaram com probe em servidor vivo). Cura em SSOT: builders `recoverTraceabilityRequiredAction` + `goalStartRequiredAction` movidos para `src/error-envelope.ts` (curados, com `evidence_required` e origem de leitura no passo 1); server consome sem duplicata inline. **Vacina da classe**: schema-index do `validateSequenceSteps` agora cobre `goal_start`/`spt_validate` com o required vivo — a forma antiga é REPROVADA em teste (RED documentado) e os builders curados aprovados; próxima evolução do schema quebra o envelope na suíte, não na frota. 3ª cópia (flow-engine:6087, teto terminal) registrada na FE-DEBT-006 — flow-engine intocado (camping NOT_APPLICABLE). Docs de fidelidade do corte anterior no mesmo commit: narrativa corrigida (o export morto removido foi o de `missingCriterionCoverage`; `cappedCoverageDetails` nunca foi exportada — nasceu privada), CAPACITY 809→810, MD `2710-2730` + proveniência `11d5eb0` aplicada no corpo + headings `###`.

- 2026-11-07 — Review-fixes da issue #10 (revisão adversarial 6 lentes; marker FE-2026-11-07-ISSUE10-REVIEW-FIXES): envelope MCP de `SPT_V3_TRACEABILITY_MISSING` agora aponta `goal_start` (única rota que reata a traceability — `goal_resume` não curava e mantinha o consumidor no loop original da issue); `goal_status` lean (detail default) expõe `spt_contract_version`/`spt_traceability_present`; reason fecha em 1 rodada (nomeia ER/task dona, ids citados, prova aprovada existente não citada, `|` entre provas, cap 4000 chars); uma única passada de `criterionCoverageDiagnostics` (wrapper morto `missingCriterionCoverage` removido); estreitamento de `goal_binding` no call-site. +5 testes (órfão-no-verdict com rota, misto aprovada-não-citada, âncora de formato `^SPT...missing=...; details=`, lean, verde multi-critério) — 9/9 no arquivo. Único P1 da revisão refutado na fonte (`fingerprintSptContract` cobre o contrato inteiro — fail-closed). **FE-DEBT-006 aberta** (CONTAIN): unificar sentinelas v3 + evento `spt_traceability_reattached` + O(C+E) + saneamento de evaluateExpectation — pagável pela onda densa EST-20261105. Trilho `.agents/PLAN-TASKS/2026-11-07-issue10-review-fixes.md`. **Emenda 2ª revisão adversarial (9 lentes, 8 relatórios; 1 cancelada pelo dono)**: P1 consenso corrigido — envelope agora ensina `required_tool_sequence` executável (goal_status lê `goal_envelope.idempotency_key` → spt_validate → goal_start completo; `args:{flow_id}` sozinho falhava no schema e key nova criaria flow duplicado); teste "lean" agora exercita o branch lean de verdade (default do ENGINE é full; lean é default da camada MCP); reason ação-primeiro ("cite a prova já aprovada <id>" antes de "anexe" — ordem anterior induzia re-anexo duplicado); `citedIds` hoisted (invariante do loop); export de `cappedCoverageDetails` sem consumidor removido; regex do misto ancorada no `evidence_id` real; jornada completa da cura provada no teste do re-bind (re-bind → prova passed → verdict positivo); contrato do envelope separou `SPT_INVALIDO` (rota `spt_validate`) e header do corte anterior corrigido SHRINK→EXCEPTION (drift MD×ledger). Refutado: `debt.responsibility` igual à `declaration.responsibility` é exigência do validador. 9/9 no arquivo após emenda.

- 2026-11-07 — Issue #10 (rotas A+B): verdict que ensina + diagnóstico de binding + cura de órfãos (Trilho `.agents/PLAN-TASKS/2026-11-07-issue10-verdict-diagnostico.md`, flow 3255; marker FE-2026-11-07-ISSUE10-VERDICT-DIAGNOSTICO): `SPT_V3_CRITERION_COVERAGE_REQUIRED` agora detalha POR QUE cada critério está descoberto (`proof_not_passed: <evd> (evaluation literal)` ou `no_criterion_proof: ...rota de correção`) — prefixo e `missing=` preservados para consumers existentes. `goal_status` expõe `spt_contract_version` e `spt_traceability_present`; re-bind do mesmo SPT v3 reata `spt_traceability` de flows órfãos (antes ficavam cegos para sempre). Camping EXCEPTION urgent_hotfix com extração embutida: gate SPT v3 do verdict (traceability+stale+cobertura, l.2710-2730 do baseline) extraído INTEIRO para `assertSptV3PositiveVerdictCoverage` em `src/spt-traceability.ts` (cluster da política SPT, anti-escoteiro: bloco coeso completo, não meio-cluster); `missingCriterionCoverage` vira wrapper fino de `criterionCoverageDiagnostics` (zero duplicação). RED 4/4 no baseline 25275b0 → GREEN 4/4 (receipt `.agents/receipts/2026-11-07-issue10-baseline.log`). Rota C (re-bind com contrato diferente) fica registrada como pendência do contrato de idempotência. Workflow `manutencao-iterativa-com-evidencia` 1.0.3 no mesmo corte: régua anti-escoteiro-minúsculo no passo 6 + Meta-análise questionadora (cura finding do fiscal) — origem: correção do dono 2026-11-05 + auto-análise `$dex-anti-autossabotagem` 2026-11-07 (onda densa EST-20261105 é o próximo bloco de decomposição).

- 2026-11-07 — Vacina da classe "Obsolete Comment" do preflight + revisão pós-merge do PR #9 (Trilho `.agents/PLAN-TASKS/2026-11-07-revisao-pr9-issues-vacina-banner.md`, flow 3217): novo teste `tests/spt-kit-banner.test.ts` casa o range anunciado no `--schema` (`S00..S10`) com os checks efetivamente emitidos no código (regex `add("Snn"`) e o cabeçalho com o shape máximo — check novo sem bump do banner reprova na suíte, não no usuário. RED provado por mutação do banner para S00..S09 (2 failed) antes do GREEN 2/2 (receipt `.agents/receipts/2026-11-07-banner-vacina.log`). Pull do PR #9 revisado: banner confere, hook post-merge imprimiu `INALTERADO` (1ª medição real em pull — paridade dos 4 pares globais provada viva fora do self-test), PLAYBOOK regenerado local (a projeção vinda do PR embutia fontes `.agents` locais da máquina de origem; drift entre máquinas declarado como limitação). Issues #8 (curada pelo PR #9), #6 (curada por `c481247`) e #5 (lapidações `c481247`+`423e89a`) fechadas com comentário de prova. Origem: veredito `$oraculo-clean-code` (Boy Scout Rule p.14 + C2 Obsolete Comment p.286, selo confirmado_documental).

- 2026-11-07 — Preserva `PAINEL-DE-FERRAMENTAS` e `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL` no PLAYBOOK a partir de uma fonte versionada que acompanha o clone.

- 2026-11-06 — Faxina das dívidas estacionadas do dia (Trilho `.agents/PLAN-TASKS/2026-11-06-faxina-dividas-estacionadas.md`, flow 3171): novo workflow `workflow/fechamento-goal-worktree-compartilhado/` 1.0.0 (pacote 6 irmãos dex.workflow.v1; fiscal `check-workflow.py` OK, `check-schemas.py` 0 findings) capturando a receita do flow 3086 — review estrutural cobre o COLETADO do worktree vivo (`reviewed_targets` superconjunto de `flow.changed_files`), commit seletivo por proveniência e fechamento de coerência com a janela irmã via receipt real dela. Dívidas locais pagas no mesmo corte (superfícies `.agents/` gitignored): 37/37 espelhos dex-memoria COMMITTED (log `.agents/receipts/2026-11-06-espelhos-lote.log`), resíduo `.code-review-graph/` raiz removido com MANIFEST na LIXEIRA, ledger `PENDENTES.md` VALIDO com as 3 pendências abertas auditadas (todas de decisão humana, roteadas), 11 seções 5-campos no GATILHOS-VIVOS (15 campos E SE??), rota absoluta do fulltext clean-code no SKILL global do oráculo + fonte canônica no AprendizadoConsultado (commit lá `499ed2bb`, pathspec seletivo). Ressalva ER-04: procedure literal `grep -c E.se` (case-sensitive) não casa o molde "E SE??" da casa; contagem provada com `rg -c 'E SE\?\?|E se\?\?'` = 15 ≥ 15.

- 2026-11-06 — Atualizacao de frota em a8f90e0: corrige a cobertura anunciada por `spt-kit/preflight.mjs --schema` para S00..S10; S10 ja era executado. Fixture existente `plan-objeto.md` confirma rejeicao causal; provas em `.agents/receipts/frota-20261106/`.

- 2026-11-06 — Hook post-merge de paridade dos 4 pares globais (Trilho `.agents/PLAN-TASKS/2026-11-06-hook-post-merge-paridade-contratos.md`, flow 3142): após pull/merge, `tools/playbook/hooks/post-merge` (wrapper sh + `post-merge.impl.mjs`) sincroniza repo→`~/.agents` quando um dos pares muda, RECUSANDO sobrescrever global divergente de ORIG_HEAD e de HEAD (edição local viva) com instrução acionável; silencioso (INALTERADO) quando nada mudou. Lista dos 4 pares extraída para `scripts/canonical-pairs.mjs` (fonte única consumida também pelo `audit-canonical-sync.mjs`, sem mudança de comportamento). Self-test 4/4 RED→GREEN (COPIADO/JA-OK/RECUSADO/INALTERADO; receipt `.agents/receipts/2026-11-06-postmerge-selftest.log`); `npm run check` exit 0. Zero instalação: `core.hooksPath` já aponta para a pasta.

- 2026-11-06 — spt-kit cobertura total (Trilho `.agents/PLAN-TASKS/2026-11-06-spt-kit-cobertura-total.md`, flow 3086): S00 do preflight agora diagnostica a causa (primeiros 40 bytes do arquivo + causas provaveis: titulo antes do bloco, BOM, use o bloco do MOLDE) e tolera BOM UTF-8 como o parser oficial; novo S10 antecipa o shape dos 21 campos do `dex.spt.v3` (campo obrigatorio ausente, plan fora de array de strings, tasks sem objetos, uncertainties < 1 item, chave desconhecida citando as validas; lista espelhada do `SCHEMA/dex.spt.v3.schm.md`, bump junto). Instrucao de copia curada nas 3 superficies (GUIA passo 1, header do MOLDE, contrato GOAL_SPT global + copia local): copiar o BLOCO YAML, nunca o arquivo integral — o header de prosa gerava S00 mecanicamente (classe paga 2x em 2026-10-31 + print 2026-11-06). GUIA ensina copiar os `proof_skeletons` da saida do `spt_validate`. 5 fixtures adversariais RED->GREEN (falso verde x3 provado; receipt `.agents/receipts/2026-11-06-spt-kit-red-fixtures.log`); sha256 do MOLDE bumpado no `.schm.md` rev 3 no mesmo commit; suite 799|0|4, `npm run check` exit 0. Redirector do mentor clean-code global ganha a rota absoluta do fulltext.

- 2026-11-05 — Completa recuperacao publica para arquivos regulares ingeridos por corroboracao unborn legada. Ausencia de HEAD/base e declaracoes historicas positivas delimitam recuperacao; registro excluded_legacy_unborn_files preserva rastreabilidade. Status/review/verdict compartilham dedupe por identidade fisica. Prova causal em tests/review-snapshot-recovery.test.ts; flow real dos workflows preservado.

- 2026-11-05 — Recuperacao publica da issue #6: status e revisao usam a mesma projecao do snapshot legado. A evidencia aceita persiste exclusoes de repositorios aninhados automaticos com registro `review_scope_recovery`, sem reescrever historico. Dedupe preserva diretorios explicitamente declarados; arquivos ausentes, sensiveis, escapes e exclusoes declaradas permanecem protegidos. Testes causais incluem transporte MCP real e releitura do store; fonte em `tests/review-snapshot-recovery.test.ts`.

- 2026-11-05 — review_findings só viram mineração com texto forte (issue #5 lapidação 2, Trilho verdict-learning-filtro-findings): extração SHRINK de `deriveVerdictLearning`+`isStrongLearningText` para `src/verdict-learning.ts` (fachada ganha só o import); findings seguem a mesma regra do rationale (filtro `isStrongLearningText`) — promoção cega criava candidatos de confiança baixa (2 gerados ao vivo pelo flow 2950). RED 1/1 no baseline; guard mining-policy verde sem edição; registro FE-2026-11-05-VERDICT-LEARNING-FILTRO-FINDINGS.

- 2026-11-05 — Corrige coletor de corroboração em `src/review-snapshot.ts` (issues GitHub #6 P1 + #5.1, Trilho `.agents/PLAN-TASKS/2026-11-05-snapshot-unborn-aninhado.md`, flow 2950, veredito pronto_com_ressalvas): repos unborn (sem HEAD) não têm mais corroboração por status (`gitChangedFiles` null — mantém declaração com limitação, precedente do próprio contrato); parser do porcelain -z descarta entrada com barra final (repo aninhado nunca foi revisável e congelava verdict em REVIEW_SNAPSHOT_FILE_REQUIRED persistido); `dedupeChangedFilesByFsIdentity` deduplica por identidade fs (win32 case-insensitive preservando casing da declaração, Linux exato) e saneia flows feridos na próxima visita; early-return do merge compara conteúdo (2===2 escondia troca dir↔untracked). RED 4/4 no baseline; caracterização nova 5/5; 2 guards com fixture unborn adaptados com commit-base (provas ipsis literis); suíte 781|0|4 (60 files); `npm run check` exit 0; strict do snapshot intocado. Push fora do corte.

- 2026-11-02 — Workflow local1.0.1 declara preflight/dependencias e adocao seletiva do global1.2.0; perfil PPIRTV v1 preservado. Retrofit global comprovou cinco pacotes relocalizados, perfis CC consumidos e falha explicita por dependencia ausente; nao altera runtime fiscal ou flows. Skills externas exigem verificacao no computador consumidor.

- 2026-11-02 — Integrada correcao fiscal terminal423e89a preservando workflow0e566b1; contratos globais sincronizados, check776/4 e rota real Hub com nao_pronto/arquivo/sucessor de reconciliacao. Transporte desktop exige reconexao apos encerrar launcher antigo; MCP stdio corrigido comprovado. Produto consumidor nao recebe aceite implicito.

### Documentado — 2026-11-02

- Implanta workflow de manutencao continua1.0.0, derivado do global reconciliado1.1.0; perfil PPIRTV v1 com CC5/nesting2 e metas90/80 report-only. Wrapper local consome CRG existente, exporter1.2.0 e medidor0.4.2; contato v1 validado pela skill owner. Snapshots e metricas reais preservam limites; sem alteracao do runtime fiscal ou flows consumidores.

- README explicita o conteúdo esperado de um PR de rascunho e distingue
  publicação de aceitação. Recorte documental usado no ensaio real da
  dex-gerar-pull-request; sem alteração de runtime ou contrato MCP.

### Corrigido — 2026-11-02

- Veredito não-positivo não desarma mais a recorrência fiscal (P1 da revisão
  em dupla do merge 2e63c8c): o scan de `recurringRisk` encerra o relato
  pendente somente com `verdict_recorded` positivo (`pronto`/`pronto_com_ressalvas`);
  `nao_pronto`/`bloqueado`/veredito rejeitado não apagam a declaração.
  `recurring_risk: false` só persiste quando o veredito grava
  (`reportRecurringRiskCleared` — veredito rejeitado não grava sinal); retry
  com mesmo valor efetivo não duplica `recurring_risk_reported`. Teto de
  regressão `attempt_regress_limit_reached` vira terminal por desenho
  (decisão do dono, opção b): envelope e `next_required_action`
  (`close_flow_with_reservation`) prescrevem encerrar com ressalva +
  `flow_archive` + flow novo — nunca "repita o veredito" com
  `locked_by_limit=true`. Trilho
  `2026-11-02-fiscal-verdict-nao-positivo`; provas:
  `tests/fiscal-recurrence.test.ts` 29/29 (RED 4|24 no baseline),
  `tests/engine.test.ts` (4 asserts do teto adaptados ao contrato novo),
  contrato do envelope atualizado (ponteiro morto corrigido) e 3 dívidas
  registradas no PENDENTES.
- Recorrencia fiscal deixa de ser inferida de texto livre: `goal_verdict`
  aceita `recurring_risk` boolean opcional. Omissao preserva relato pendente,
  `false` o encerra, verdict registrado encerra a avaliacao. Regressos
  persistidos prevalecem sobre contagem menor e sobre `false`; suite verde,
  negacoes e citacoes nao criam `attempt_regress_count`. Relatos invalidos
  sao rejeitados conjuntamente antes de escrita. Contadores e persistencia
  fiscal saem da fachada (FE-2026-11-02-FISCAL-SIGNALS-SHRINK, FE-DEBT-005).
  Provas: `tests/fiscal-recurrence.test.ts`, T10/T26/T26b, MCP schema real.
- `goal_status full` reaplica o fingerprint corrente depois do reload do
  primeiro recall. Corrige hash stale comprovado em dois testes e preserva a
  rejeicao strict de hash divergente. A copia documental local do contrato
  GOAL/SPT foi sincronizada com a emenda global do kit de 2026-10-30.

### Adicionado

- Kit SPT válido-por-construção (2026-10-30, GO do dono — Trilho
  `kit-spt-valido-por-construcao-261030`, SPT local
  `.agents/PLAN-TASKS/2026-10-30-kit-spt-valido-por-construcao.md`; PRD
  aprovado por arena cega de 20 modelos no registry): novo
  `SCHEMA/dex.spt.v3.schm.md` (schema documental rev 1 no padrão `.schm.md`
  da casa, com checksum do molde registrado) e `spt-kit/` — `MOLDE.md`
  (21 slots TODO-PREENCHER), `RULES.md` (R1-R08, uma verificação cada),
  `GUIA.md` (1 página), `preflight.mjs` (S01-S09, sem MCP) e fixtures RED
  (S03 critério inchido, S09 drift de checksum). Bateria ER-01..ER-10 10/10
  verde (receipt local `.agents/receipts/2026-10-30-kit-spt-er-battery.log`);
  dogfood: o próprio Trilho nasceu `valid=true` de primeira (receipt local
  `.agents/receipts/2026-10-30-kit-spt-validate-1a-execucao.log`). Memórias
  do bloco pendentes de gravação dex (owner: sessão de fechamento).

### Alterado

- GUIA do kit cita a tríade documental do preflight (2026-11-01, revisão de
  print de sessão irmã em outra máquina — Trilho demo-e2e; o tropeço
  `--help` → ENOENT era da versão pré-`1239263`): `spt-kit/GUIA.md` ganha a
  seção "Ajuda viva" (`--help`/`--schema`/`--usage`, exit 0 antes de ler
  qualquer arquivo), fechando a regra 3 do padrão documental da casa — tríade
  citada como fonte viva. Comportamento já entregue em `1239263`; aqui só a
  fonte viva de uso foi completada.

- Parsers de corroboração imunes a C-quoting do git (2026-10-30, GO do dono —
  Trilho `git-porcelain-nul-quoting`, SPT
  `.agents/PLAN-TASKS/2026-10-30-git-porcelain-nul-quoting.md`, consumo da
  pendência `PPIRTV-GIT-QUOTING-UNWRAP-001`): git C-quoteia paths (espaços no
  `status --porcelain` — `core.quotePath=false` não cura; non-ASCII com
  escapes octais no `diff --name-only`, divergência D1 da recepção) e o parser
  `line.slice(3)` mantinha aspas literais — impossíveis no Windows (lstat
  ENOENT) — congelando entries no `changed_files` e matando o strict review
  com `REVIEW_SNAPSHOT_FILE_REQUIRED`. Cura estrutural: `gitChangedFiles` e
  `gitCommittedFilesSince` consomem saída `-z` NUL-delimited (git nunca
  quoteia; rename/copy consumido mantendo o alvo novo; slice(3)-antes-do-trim
  preservado — trim na entry inteira comia o XY " M" e expunha runtime como
  não-doc); ponte legacy no loop de entries: entry congelada com aspas
  resolve o arquivo REAL via prefer-exact-then-unquoted (exact primeiro;
  nome real quotado no Linux nunca mis-hash; entry com path despido + sha
  real); ambas ausentes seguem fail-closed. Suíte nova RED-first
  `tests/git-porcelain-quoting.test.ts` 6/6 (5 causais | 1 guard no RED);
  suíte integral 737|4 (58 arquivos) sem edição de teste; barata do trim-slice
  pega ao vivo pela suíte irmã `git-corroboration-commits` (lição do corte
  anterior aplicada pelo spt-revisor). Workspace consumidor ConfigurarWindows
  intocado (restrição da recepção); flow-engine intocado (camping sem visita
  nova).
- Snapshot redige sensível não-declarado de terceiro (2026-10-29, GO do dono —
  Trilho `env-snapshot-sensitive-redaction`, SPT
  `.agents/PLAN-TASKS/2026-10-29-env-snapshot-sensitive-redaction.md`, consumo
  da pendência `PPIRTV-ENV-SNAPSHOT-001` sobre o laudo do workspace
  consumidor): untracked sensível (.env) varrido pela corroboração git não
  congela mais flow oficial para sempre — `filterCorroborationFiles` também
  descarta `isSensitiveWorkspacePath` (prevenção no merge);
  `fingerprintReviewedImplementation` ganha a opção aditiva
  `redactedSensitivePaths` (entry `redacted_sensitive`, conteúdo nunca lido
  nem hasheado) e a proveniência de declaração (`redactableSensitivePaths`:
  provided.changed_files de todos os gates + revision_set de criterion_proof)
  separa TERCEIRO não-declarado (redigido, flow destrava) de PRODUTO PRÓPRIO
  declarado (segue fail-closed, guard `revision_path_sensitive` intacto).
  Emenda barata 2: as rotas corrente e ESTRITA de atestação de review
  compartilham o wrapper SSOT `strictReviewSnapshotFingerprint` — visita
  CONTAIN ao camping (`FE-2026-10-29-ENV-SNAPSHOT-REDACTION-CONTAIN`), debt
  `FE-DEBT-005` aberta e pagável. Suíte nova RED-first
  `tests/env-snapshot-sensitive.test.ts` (vítima e2e destrava; guardas
  declarados preservados); suíte integral verde sem edição de teste
  existente. Consumidor `ConfigurarWindows` deve re-executar o
  `ppirtv-close-harness-v3.mjs` para o verdict do flow vítima.
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
