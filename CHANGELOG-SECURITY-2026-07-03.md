# Changelog — Segurança e Estabilidade (2026-07-03)

## Corte de segurança baseado em code review externo (9 achados validados)

### Corrigidos neste corte

#### #1 CRÍTICO — Segredos em texto livre vazavam para o ledger sem redação por conteúdo
- **Antes**: `scrubSecrets` em `store.ts` redigia apenas por **nome de chave** (`/secret|token|password/i`). Um token `sk-live-...` colado em `goal`, `context` ou `decision` passava integral para `ledger.ndjson`.
- **Depois**: criado `src/security/secret-redaction.ts` como **SSOT** (Single Source of Truth). `scrubSecretLike` redaciona por **conteúdo** (`SECRET_LIKE_PATTERN`: `sk-...`, `Bearer ...`, `api_key=...`) e por nome de chave. Aplicado na borda de saída (`appendLedger` e `exportRedactedDiagnosticBundle`).

#### #2 ALTO — Linha corrompida no ledger derrubava `readLedger` (e todo o engine)
- **Antes**: `readLedger` fazia `JSON.parse` sem try/catch por linha. Uma linha truncada fazia `readLedger` lançar, propagando para todo chamador.
- **Depois**: `readLedger` agora tolerante — linhas corrompidas são filtradas (try/catch por linha via `flatMap`), sem crash.

#### #3 ALTO — Race condition em `writeJsonAtomic` com temp file fixo
- **Antes**: `writeJsonAtomic` usava `${filePath}.tmp` fixo. Duas chamadas concorrentes no mesmo artefato causavam perda silenciosa de dados.
- **Depois**: temp único com `crypto.randomUUID()`: `${filePath}.${randomUUID()}.tmp`.

#### #5 MÉDIO — Governança de segredo fragmentada em 6+ implementações
- **Antes**: 6 regex diferentes de detecção de segredo espalhadas por `store.ts`, `diagnostic-bundle.ts`, `mining-policy.ts`, sem fonte única.
- **Depois**: `src/security/secret-redaction.ts` é o SSOT. `mining-policy.ts` agora reexporta de lá. `diagnostic-bundle.ts` usa o SSOT.

#### #6 MÉDIO — Diagnostic bundle usava regex de redação mais fraca
- **Antes**: `redactSecretLikeText` em `diagnostic-bundle.ts` cobria `Authorization: Bearer` mas não `sk-...` bare.
- **Depois**: delega para `scrubSecretLike` (SSOT), que cobre todos os padrões.

### Estacionados (não bloqueantes, SPT futuro)

| # | Prioridade | Achado | Status |
|---|---|---|---|
| #4 | Baixo (rebaixado de Alto) | Injeção via .bat no graphify — `shell: false` já mitiga; falta allowlist de args | Defesa em profundidade |
| #7 | Médio | `classifyToolError` por regex sobre mensagem crua é frágil | SPT de error classes |
| #8 | Baixo | Path traversal em `sourcePathFor` (pré-condicionado) | Baixo risco |
| #9 | Baixo | `profileFor` fallback silencioso para mode inválido | Já estacionado (R1/F) |

### Decisões de design

- **Redação na borda de saída, não na persistência interna**: o flow JSON em `.ppirtv/` mantém conteúdo original para que o fiscal policy funcione (ex.: `gold_mining` com token sintético para teste de `blocked_reason`). A redação acontece em `appendLedger` (ledger.ndjson) e `exportRedactedDiagnosticBundle` (export cross-boundary).
- **SSOT**: `src/security/secret-redaction.ts` é o único lugar onde `SECRET_LIKE_PATTERN` é definido. Todos os módulos importam de lá.

### Validação
- `npm run check`: **173/173 testes verdes** (+9 novos em `tests/security-redaction.test.ts`).
- Build OK, audit canônico OK, e2e MCP 7/7 sem regressão.
