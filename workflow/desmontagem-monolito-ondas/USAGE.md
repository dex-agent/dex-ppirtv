# USAGE — desmontagem-monolito-ondas

## Exemplos executados

1. **Fotografia ANTES da sessão de desmontagem** (2026-11-07, main @ 4d75dd2):
   - `code-review-graph build --repo . --data-dir .agents/CODE-REVIEW-GRAPH` → 2.630 nós/39.843 arestas (build); capture `desmontagem-antes-4d75dd2` → captured, built_at==HEAD (receipt `.agents/receipts/manutencao-continua/desmontagem-antes-4d75dd2/receipt.json`).
   - Mapas: `.agents/MAPAS/capacidades-flow-engine-desmontagem-4d75dd2.md` + `decisoes-flow-engine-desmontagem-4d75dd2.md`; índice do corte em `.agents/MAPAS/INDEX.md`.
   - Achado real do passo 1: update incremental NO-OP (banco preso em a3d47c6) — o build resolveu; a pós-condição do capture pegou o stale ANTES de virar falso verde.

2. **Ondas executadas pelo método (antes da formalização — retroativos como evidência do rito)**:
   - fiscal-policy (2026-10-26, 9797016+7fec5bb): cluster inteiro → `src/verdict-fiscal-policy.ts`, suíte própria, camping SHRINK.
   - spt-traceability (c2e22a2): gate SPT v3 extraído inteiro, RED 4/4→5/5.
   - review-snapshot (5b66f56, issue #11): lógica nova fora do monólito + molde commit-then-verdict RED 2/2→GREEN 6/6.

3. **Onda 1 da fila (pendente — primeiro exemplo completo do runbook formal)**: 3ª cópia da sequência goal_start (flow-engine ~6087) → consumir SSOT error-envelope; Trilho `2026-11-07-desmontagem-flow-engine-ondas.md`, flow 3464 aberto.
