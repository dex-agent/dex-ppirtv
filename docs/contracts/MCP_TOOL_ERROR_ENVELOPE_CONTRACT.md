# Contrato de Envelope de Erro Acionável na Fronteira MCP

- **Localizador**: `PPIRTV-ERRO-QUE-ENSINA-ENVELOPE`
- **Trilho**: `.agents/PLAN-TASKS/2026-10-15-erro-que-ensina.md` (flow `flow_20261015111405627_2609_0001`)
- **Data**: 2026-10-15 · **Owner**: executor $mapeador-implementacao · **Status**: ativo
- **Fonte viva**: `src/error-envelope.ts` (builder) + tradutor em `src/server.ts` (`classifyToolError`)

## Motivação (custo medido)

Duas capturas do dono (2026-10-15): agente executor queimou **5m12s + ~2m40s de pensamento + 5 greps** ao receber `PPIRTV_FISCAL_BLOCKED: attempt_regress_count; required_cooperation=`, produziu **diagnóstico errado** (leu campo vazio como "cooperador sem nome") e ainda esbarrou em `Tool input failed inputSchema validation` sem saber qual campo. Mensagem que não ensina → arqueologia → erro de diagnóstico → regra errada quase memorizada. O contraste: envelopes que ensinam (`memory_required_but_empty` com `required_tool_sequence` e args exatas) são executados sem arqueologia.

## Regra do envelope (SPEC)

Todo erro que cruza a fronteira MCP das tools do dex-PPIRTV carrega:

1. **Código desambiguado** — uma condição, um código (nunca dois ramos opostos sob o mesmo rótulo);
2. **Números do estado** que geraram o blocker, quando existirem (ex.: `attempt_count=0, regress_count=0, max=3, meetings=0`);
3. **`next_required_action`** `{type, tool, reason}` e, quando há sequência, **`required_tool_sequence`** `[{order, tool, args, only_if}]` — literal, copiável, com args conferidos contra o schema vivo das tools;
4. **Campos vazios omitidos** — nunca `chave=` em branco (campo vazio parece "valor faltando");
5. **Erro de input ensina a forma** — envelope com nomes literais `field`, `received_type`, `expected_type`, `example`.

## Split do `attempt_regress_count` (caso P1)

`attempt_regress_count` cobria DUAS condições opostas (`src/flow-engine.ts:5006-5009`):

| Ramo | Condição real | Código novo | Números no blocker | Destravamento |
| --- | --- | --- | --- | --- |
| Limite estourado | `regress_count >= maxRegressions (3)` | `attempt_regress_limit_reached` | `regress_count=N, max=3` | parar de regredir; corrigir trabalho e tentar veredito |
| Tentativas insuficientes | risco recorrente + `attempt_count < 2` + `regress_count < 1` + zero meetings | `attempts_insufficient_before_positive_verdict` | `attempt_count=N, regress_count=N, max=3, meetings=N` | `goal_meeting_open(suggested_cooperators=[...])` → `goal_meeting_close(decision)` → `goal_verdict(meeting_id)`, OU `goal_regress`, OU novo `goal_verdict` |

**Compatibilidade**: o texto da mensagem nova mantém o alias legado `attempt_regress_count` até grep provar que nenhum consumidor depende da string exata.

**Fonte dos números**: `hasEnoughAttempts`/`countHistory`/`countRegressions` (`src/flow-engine.ts:5756-5781`) já computam tudo no ponto do throw — o envelope só deixa de descartar.

## Inventário 2026-10-15 (151 throw sites · ~80 códigos CAPS · ~20 traduzidos)

### A. Fronteira MCP — já traduzidos no `classifyToolError` (server.ts ~919-1190)

| Código | Origem | next_required_action hoje | Actionability |
| --- | --- | --- | --- |
| `PPIRTV_FISCAL_BLOCKED` | flow-engine:2729 | `goal_status` (**circular** — relê o mesmo blocker) | **P1: split + números + sequência ramificada (T-2)** |
| `MEMORY_MINING_BLOCKED_VERDICT` | flow-engine:2711 | sequência completa em texto (mm_memory_mining → resolve → verdict) | ✅ padrão bom |
| `memory_required_but_empty` (via fiscal) | flow-engine:6360+ | `required_tool_sequence` com args exatas | ✅ padrão-ouro da casa |
| `SPT_V3_TRACEABILITY_MISSING` / `SPT_INVALIDO` | spt engine | `spt_validate` + owner | ✅ |
| `SPT_V3_CRITERION_COVERAGE_REQUIRED` | flow-engine:2702 | lista critérios faltantes | ✅ |
| `SPT_V3_EVIDENCE_INVALID` / `SPT_V3_EVIDENCE_STALE` | spt-traceability | campo + motivo | ✅ |
| `SPT_V3_DECLARATIVE_OBSERVED_TYPE` | spt-declarative-proof | "send observed_value as X; received Y" | ✅ padrão para erros de input |
| `GOAL_BINDING_MISMATCH`, `GOAL_NAO_ATIVO`, `EVIDENCIA_AUSENTE`, `SENSITIVE_CONTENT_BLOCKED`, `MEETING_ALREADY_CLOSED`, `MEETING_NOT_CLOSED`, `MEETING_BLOCKER_NOT_OWNED`, `MEETING_CONCURRENT_MUTATION`, `MEMORY_MINING_INPUT_INVALID`, `PROGRESS_AFTER_TERMINAL`, `REVIEW_ATTESTATION_CLAIMS_REQUIRED`, `GRAPHIFY_CONSUMPTION_UNKNOWN_REFERENCES`, `SPT_V2_EXECUTION_MIGRATION_REQUIRED`, `PPIRTV_TOOL_ERROR` (fallback) | vários | tool + reason por código | ✅ traduzidos (T-5 re-verifica args) |

### B. Fronteira MCP — SEM tradução hoje (alvo da T-5, fecha em zero)

| Família | Códigos | Destravamento a ensinar |
| --- | --- | --- |
| Locks de meeting | `MEETING_LOCKED`, `MEETING_LOCK_INVALID`, `MEETING_LOCK_IDENTITY_CHANGED`, `MEETING_LOCK_TIMEOUT`, `MEETING_STALE_LOCK_IDENTITY_CHANGED` | `goal_status detail=full` (expõe lock owner/expira) → aguardar ou reabrir com idempotency_key correta |
| Candidatos de memória | `MEMORY_CANDIDATES_NOT_MINED`, `MEMORY_CANDIDATE_IDENTITY_CONFLICT`, `MEMORY_CANDIDATE_IDENTITY_DUPLICATE`, `MEMORY_CANDIDATE_IDENTITY_REQUIRED`, `MEMORY_CANDIDATE_PROMOTION_DESTINATION_CONFLICT`, `MEMORY_CANDIDATE_PROMOTION_FIELDS_NOT_ALLOWED`, `MEMORY_CANDIDATE_PROMOTION_METADATA_REQUIRED`, `MEMORY_CANDIDATE_PROMOTION_OWNER_NOT_ALLOWED`, `MEMORY_CANDIDATE_PROMOTION_TAG_INVALID`, `MEMORY_CANDIDATE_PROMOTION_THEME_NOT_ALLOWED` | rodar `mm_memory_mining` antes; para promotion: campos/owner/tag/theme exigidos por código |
| Goal lifecycle | `GOAL_IDEMPOTENCY_DUPLICATE_BINDINGS`, `GOAL_LEGACY_FLOW_OBJECTIVE_MISMATCH`, `GOAL_LEGACY_FLOW_VERDICTS_PRESENT`, `GOAL_TERMINAL_FLOW_UNBOUND`, `GOAL_WORKSPACE_STORE_MISMATCH`, `OFFICIAL_GOAL_REQUIRES_GOAL_VERDICT` | `goal_status` do flow existente / `spt_validate` + novo `goal_start` |
| Progresso | `PROGRESS_COMPLETED_INCOMPLETE`, `PROGRESS_CURRENT_INVALID`, `PROGRESS_TOTAL_INVALID` | corrigir `completed/total/current` na própria chamada |
| Review snapshot | `REVIEW_SNAPSHOT_FILE_REQUIRED`, `REVIEW_SNAPSHOT_FINGERPRINT_REQUIRED`, `REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH`, `REVIEW_SNAPSHOT_OUTSIDE_WORKSPACE`, `REVIEW_SNAPSHOT_SENSITIVE_PATH`, `REVIEW_SNAPSHOT_DECLARED_DELETION_STILL_EXISTS` | caminho relativo dentro do workspace + fingerprint do `goal_status` |
| Fluxo terminal/imutável | `FLOW_IMMUTABLE_AFTER_COMPLETION`, `DELETED_FILES_NOT_CHANGED`, `RECALL_CONSUMPTION_WITHOUT_RECALL` | novo `goal_start` (reexecução) / declarar deleted em changed_files / registrar consumo recall antes |

### C. Internos de CLI/ops (fora da fase 1 — não cruzam tools do executor)

`memory-writer-selector-*` (49 sites), `launcher-environment` , `config` (12), `catalogs`, `provenance-trace`, `goal-ledger-recovery`, `review-snapshot` interno, `store`. Erro de ops de instalação/cutover, não de agente executor; fase futura se houver consumidor MCP.

## Erros de input (SPEC item 5)

Exemplo real da captura: agente enviou `suggested_cooperators` como **string JSON duplamente codificada** (`"[{\"material\":...}]"`). O envelope de input responde com:

```json
{
  "field": "suggested_cooperators",
  "received_type": "string",
  "expected_type": "array<{name: string, reason: string, material: boolean}>",
  "example": [{"name": "response-evidence-fiscal", "reason": "valida provas", "material": false}]
}
```

Schemas de tool continuam estritos (zod) e `.describe()` nos campos quentes ensina no lado do cliente via `tools/list`. O fio server-side é real desde a fase 2A (2026-10-15): a validação de input roda no SDK (`McpServer.validateToolInput`, zod ANTES do handler) e o override `installTeachingInputValidation` (src/server.ts) transforma a falha de validação em `McpError(InvalidParams)` cuja message carrega `PPIRTV_INPUT_INVALID: {code, tool, message, input_issues:[{field, received_type, expected_type, example}], next_required_action:{type:"fix_input_fields", tool, reason}}`. Na fronteira do cliente (SDK atual) isso chega como tool result `isError:true` com text `MCP error -32602: PPIRTV_INPUT_INVALID: {...}` — legível para o agente executor sem arqueologia. Exemplo genérico de tipo usa placeholder `<string>`/`<number>` (substitua; não envie literal). O override é feature-detected: se o método sumir em upgrade do SDK, o servidor volta ao comportamento original (message crua do zod) e o teste de fronteira `tests/server-boundary.test.ts` pinta RED avisando a casa.

## Exemplo P1 do inventário: diagnóstico em cascata (fora do corte, estacionado)

`spt_validate` emite `SPT_CONTRACT_WORKSPACE_MISMATCH` **falso** quando a semântica do SPT falha: `parseSptDocument` devolve `contract=null` e o check `!!contract && ...` cascateia `spt_workspace_matches` para false — o validador reporta sintoma (workspace) em vez da causa raiz (semântica). Medido ao vivo na criação do Trilho. Estacionado: `EST-20261015-VALIDATE-CASCATA` (owner sprinter, próximo trilho do validador).

## Validação e manutenção

- Auditoria contínua: `node scripts/audit-error-envelope.mjs` imprime `codigos_sem_next_required_action=N` (report informativo por padrão; `--strict` devolve exit 1 quando N>0 para uso pontual de evidência). Virar gate de CI é decisão explícita do dono — auditoria que ensina, não bloqueia (anti-autossabotagem P10: limite sem evidência de dano real não vira trava automática);
- Args de sequências literais são conferidos contra os schemas vivos de `src/server.ts` (regra do revisor P1-1: sequência copiável com arg errado é falso-verde programado);
- Toda mensagem nova que cruza a fronteira MCP nasce com os 5 itens da regra.
