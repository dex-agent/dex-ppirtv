---
name: TOOLSBOOK
description: "Indice reverso das ferramentas de `tools/`, `scripts/` por INTENCAO (verbo -> script). Projecao gerada; nao editar a mao."
authority: derived_projection
authority_note: "O INDEX.md continua dono do mapa de territorio (onde mora o arquivo). Este livro indexa por intencao."
generated_by: "dex-toolsbook"
escopo: ['tools', 'scripts']
do_not_edit: true
---

# TOOLSBOOK — indice por intencao

Pergunta que este livro responde: **tenho a intencao X, qual script uso, como invoco, do que depende e o que ele faz no alvo?**

Gerado pelo motor `dex-toolsbook` a partir do codigo de cada script (docstring + argparse). Escopo: `tools/`, `scripts/`.
Motor: `~/.agents/skills/dex-toolsbook/scripts/toolsbook.py` (ou o shim do repo) — no lugar de `<motor>` nos comandos abaixo.
Frescor: `python -B <motor> --repo "C:/CodexProjetos/dex-PPIRTV" --dirs tools,scripts --check` (exit 2 = drift).
Mapa de territorio por arquivo: [`INDEX.md`](INDEX.md).

**Antes de criar ferramenta nova, busque aqui:** `python -B <motor> --repo "C:/CodexProjetos/dex-PPIRTV" --dirs tools,scripts --buscar "<o que voce quer fazer>"`.

## Ferramentas

| Intencao | Script | Invocacao | Reuso declarado | Perigo (age no alvo) | Evidencia exclusiva (R17) |
|---|---|---|---|---|---|
| Harness canônico de MUTAÇÃO DE AMOSTRA (promovido a tools/ no D-46; nasceu como | `tools/mutacao-amostra.py` | `python -B tools/mutacao-amostra.py --src --simbolo --literal --mutacao --teste --saida` | nenhum externo — stdlib (argparse/json/re/subprocess); invoca npx tsc/vitest | MUTA o arquivo-alvo no disco durante o run (restauracao byte-exata em | R17 pago no D-46 (promocao do harness-v2 com 2o consumidor real; 9 runs |
| Régua perene da rede símbolo×suíte (D-41, 2026-11-12; emendada pela adversarial). | `tools/test-symbol-coverage.py` | `python -B tools/test-symbol-coverage.py --json` | nenhum externo — stdlib (re/ast/json/pathlib) | read-only (varre src/ e tests/; nunca escreve) | R17 pago na D-41 (régua da rede simbolo×suite; rodadas 1-6 documentadas |
| Gerar PLAYBOOK.md do repo (projeção externa das regras) e verificar frescor. | `tools/playbook/generate-playbook.py` | `python -B tools/playbook/generate-playbook.py --repo --sources --write --check --check-sent` | fontes declaradas em tools/playbook/playbook-sources.txt (AGENTS.md, | --write SOBRESCREVE PLAYBOOK.md/PLAYBOOK.index.json da raiz (projeção | — (legado) |
| judge-playbook.py — juiz mecanico da prova cega V5 (design arena-zcode campeao). | `tools/playbook/judge-playbook.py` | `python -B tools/playbook/judge-playbook.py --answer --index` | tools/playbook (index gerado pelo generate-playbook.py) | read-only (juiz mecânico da prova cega V5) | — (legado) |
| global divergente (grita instrução em vez de agir) | `tools/playbook/hooks/post-merge.impl.mjs` | `—` | node:fs/node:child_process; pares canônicos de canonical-pairs | COPIA repo->global dos 4 pares após pull/merge; RECUSA sobrescrever | — (legado) |
| (sem docstring — declarar a intencao na 1a linha) | `scripts/audit-canonical-sync.mjs` | `—` | canonical-pairs.mjs (os 4 pares global<->local) | read-only (audita por hash; canonicaliza CRLF antes do SHA) | — (legado) |
| Auditoria do contrato de envelope de erro (PPIRTV-ERRO-QUE-ENSINA-ENVELOPE). | `scripts/audit-error-envelope.mjs` | `—` | src/error-envelope via build/dist | read-only (audita mensagens do envelope fiscal) | — (legado) |
| Chamar tool MCP do dex-PPIRTV via stdio (e listar tools) com args JSON de | `scripts/call-mcp-tool.mjs` | `node scripts/call-mcp-tool.mjs --workspace <dir> --list · node scripts/call-mcp-tool.mjs --workspace <dir> --probe …` | @modelcontextprotocol/sdk (client stdio); dist/launcher.js\|index.js do repo | chama tool MCP REAL no workspace (efeitos persistem em .ppirtv/ e no | — (legado) |
| Os 4 pares globais do repo (fonte unica; consumido pelo audit-canonical-sync | `scripts/canonical-pairs.mjs` | `—` | nenhum externo (módulo de dados dos 4 pares canônicos) | read-only (fonte única consumida pelo audit/post-merge) | — (legado) |
| PPIRTV-CAPACITY-COMMIT-GATE | `scripts/check-capacity.mjs` | `—` | node:child_process/node:fs; CAPACITY.receipt.json (contrato canônico) | BLOQUEIA commit sem par CAPACITY staged (gate read-only; emite | — (legado) |
| de compartilhar) | `scripts/export-diagnostic-bundle.mjs` | `—` | store/flows do .ppirtv local | ESCREVE bundle diagnóstico em disco (fora do git; sanitizar antes | — (legado) |
| (sem docstring — declarar a intencao na 1a linha) | `scripts/record-goal-progress.mjs` | `—` | dist/launcher (tools MCP do goal) | persiste progresso no flow (muta .ppirtv/) | — (legado) |
| points; use -DryRun para conferir antes; emite receipt JSON | `scripts/remove-safe-path.ps1` | `—` | nenhum — PowerShell puro | REMOVE arquivo/diretorio com validacao rigorosa de raiz e reparse | — (legado) |
| render-ppirtv-phase.mjs | `scripts/render-ppirtv-phase.mjs` | `—` | nenhum externo (render puro) | read-only (render de fase para checklist visual) | — (legado) |
| (sem docstring — declarar a intencao na 1a linha) | `scripts/smoke-mcp-tools.mjs` | `—` | @modelcontextprotocol/sdk; dist/launcher\|index | chama tools/list (read-only; nunca chama tools mutantes) | — (legado) |
| (sem docstring — declarar a intencao na 1a linha) | `scripts/validate-flow-engine-boundary.mjs` | `—` | dist/gate-resolution (validadores de fronteira do monólito) | read-only (valida fronteira flow-engine) | — (legado) |
| (sem docstring — declarar a intencao na 1a linha) | `scripts/validate-spt.mjs` | `—` | @modelcontextprotocol/sdk; servidor dex-ppirtv (spt_validate oficial) | read-only (valida Trilho SPT; nunca escreve) | — (legado) |

## Cobertura

- entradas lidas: **17** (**17** ferramentas em `tools/`, `scripts/` + **0** entry points de produto na raiz)
- com `Reuso:` declarado (so ferramenta): **17**
- com `Custo:` (R17) declarado: **2** (exigido so de ferramenta NOVA)
- com `Perigo:` declarado: **17** (os que agem fora da maquina)
- sem `Reuso:`: **0**
- imports internos que NAO resolvem (modulo ou simbolo): **0**
- produto sem intencao declarada: **0** (camada textual, nao bloqueia)

## Limite declarado

Este livro prova que a ferramenta EXISTE, que declara reuso, que os imports internos resolvem ate o simbolo e que a Invocacao cita arquivo existente. Nao prova que o reuso declarado e verdadeiro nem que a ferramenta funciona — isso e `nao_verificavel` aqui e fica com a revisao/o teste.
