# USAGE — manutencao PPIRTV 1.0.0

## Exemplos executados

- Data: 2026-11-02; owner executor PPIRTV + reviewer local; sem revisor independente.
- Origem: Trilho .agents/PLAN-TASKS/2026-11-02-manutencao-continua-crg.md; matriz .agents/receipts/manutencao-continua-20261102/reconciliation.md.
- Baseline: exporter owner1.2.0 realmente leu banco existente; 2255 nos/36038 arestas,125 arquivos; fingerprint63acb80eaf1a871e26ca5e658739e224856eb3fac84b28a8106550aac8dea5cf; HEAD77c019d, treee2e41ce. Indice limpo; primeira fotografia de fontes antes da instancia.
- Corte implantacao-01: comandos help/schema/usage e capture-cut.py --cut implantacao-01; perfil efetivamente consumido report_only;5comandos de ferramentas mais refresh preservados no receipt.
- Corte implantacao-02: corrige falta de receipt quando ferramenta owner esta ausente; RED preservado antes do reparo. Reteste5/5 e nova captura real. Nao inventou refatoracao de produto para produzir terceiro estado.

| Escopo | Funcoes reconhecidas | CC bruta soma/max | Nesting | Limite |
|---|---:|---|---|---|
| src/mcp | 4 | 21 / 17 | 3 measured,1 partial | fixture revelou extracao suspeita para declaracao TS; valores afetados nao confirmados |
| scripts locais | 7 | 29 / 8 | 7 not_applicable | Python nao recebe js_ts_nesting; nao e profundidade zero |
| contato compartilhado | 4 | 45 / 23 | consultar raw por rotina | inclui helpers; perfil PPIRTV nao vira gate global |

- Fonte da medicao: medidor0.4.2, schema v2; raw/logs em .agents/receipts/manutencao-continua/implantacao-01 e implantacao-02; receipts incluem comandos, datas, hashes antes/depois e ferramentas.
- Diff CRG real consumido pelo adapter: graph-diff-v2.json; partial, zero diferencas estruturais observadas; nao mede ciclos nem prova cobertura. Snapshot aponta working_tree dirty na instancia. Grafo nao cobriu scripts novos untracked; fonte/testes/raw separados preservam essa lacuna.
- Escopo CRG autoral observado: src, tests, scripts, tools, spt-kit e vitest.config.ts; sem dist/dependencias/runtime/browser/QA gerado. Exclusoes futuras declaradas em .code-review-graphignore.
- Testes: contato15/15; workflow owner37/37; exporter/ledger24/24; medidor37/37 + fixtures verdes; consumidor local5/5; produto focal tool-effects9/9. Suite de produto consolidada fica no receipt product-suite.log, sem inferir 90/80.
- Reuso: exporter/medidor/checker oficiais reutilizados. call-mcp-tool.mjs inspecionado no grafo e fonte: opera MCP e nao captura CRG/metricas. Wrapper local criado para config/receipts do pacote, um consumidor real (este workflow), justificado por responsabilidade especifica; nao alega dois consumidores independentes. Ferramenta de contato deriva contrato comprovado nos dois consumidores, mas uso da nova fonte compartilhada foi observado somente no PPIRTV.
- Esforco observado: comandos registram inicio/fim; tempo humano e custo recorrente nao medidos. Mais funcoes e soma de CC nao sao veto; nenhum payback futuro alegado.
- Cobertura90/80: nao medida. Ciclos novos: nao medidos. Efeito externo de transporte: somente mensagens Slack com receipt; simulador nao faz polling.
- Pendencia medidor: fixture scanner-probe.ts demonstra CC1/linha unica para corpo com &&/ternario; raw scanner-probe-raw.json. Owner dex-complexidade-ciclomatica; reproduzir antes de confiar proxima medicao dependente. Nao modificar fonte para o scanner.
- Fiscal: decisao terminal recebida; origin/main423e89a confirmado read-only. Checkout77c019d e processo MCP nao foram atualizados por esta implantacao. Nenhum verdict/archive/novo Goal/reset/restart.

## Comandos reproduziveis

```powershell
$env:PYTHONUTF8 = '1'
python -B workflow/manutencao-iterativa-com-evidencia/scripts/capture-cut.py --cut proximo-corte-real
python -B -m unittest discover -s workflow/manutencao-iterativa-com-evidencia/tests -p 'test_*.py'
python -B "$env:USERPROFILE/.agents/skills/dex-criar-workflow-contexto-atual/scripts/check-workflow.py" --workflow workflow/manutencao-iterativa-com-evidencia
python -B "$env:USERPROFILE/.agents/skills/check-schemas/scripts/check-schemas.py" workflow/manutencao-iterativa-com-evidencia/SCHEMA
```

- Nao repetir captura com mesmo identificador; output create-only. Troca de source/config requer nova captura; mudanca de motor requer remedir, nao reavaliar raw antigo.
