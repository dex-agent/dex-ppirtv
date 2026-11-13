---
name: TOOLSBOOK
description: "Indice reverso das ferramentas de `tools/`, `scripts/` por CAPACIDADE (o que eu consigo fazer -> script). Projecao gerada; nao editar a mao."
authority: derived_projection
authority_intent: prose_authored
authority_note: "Fatos (sha, papel, flags, imports) sao derivados do codigo. A CAPACIDADE e prosa autorada — docstring do autor ou `tools/CAPACIDADES.json` com sha. O INDEX.md continua dono do mapa de territorio (onde mora o arquivo)."
generated_by: "dex-toolsbook"
escopo: ['tools', 'scripts']
do_not_edit: true
---

# TOOLSBOOK — indice por capacidade

Pergunta que este livro responde: **tenho a capacidade X, qual script uso, como invoco, do que depende e o que ele faz no alvo?**

Gerado pelo motor `dex-toolsbook` a partir do codigo de cada script (docstring + argparse). Escopo: `tools/`, `scripts/`.

**Universo declarado:** 19 ferramenta(s) no livro · fora do escopo: tests 78, src 56, .zcode 52, skills 8, (raiz) 2, workflow 2, docs 1, spt-kit 1.
Motor: `~/.agents/skills/dex-toolsbook/scripts/toolsbook.py` (ou o shim do repo) — no lugar de `<motor>` nos comandos abaixo.
Frescor: `python -B <motor> --repo "C:/CodexProjetos/dex-PPIRTV" --dirs tools,scripts --check` (exit 2 = drift).
Mapa de territorio por arquivo: [`INDEX.md`](INDEX.md).

**Antes de criar ferramenta nova, busque aqui:** `python -B <motor> --repo "C:/CodexProjetos/dex-PPIRTV" --dirs tools,scripts --buscar "<o que voce quer fazer>"`.

**Sem este livro:** cada ferramenta declara `Localizador: <TAG>`, `Categoria:` e `Quando usar:` no proprio codigo — `rg -n "Localizador: <TAG>"` acha o script no repo inteiro, mesmo que o livro esteja ausente ou velho. O livro e conveniencia derivada; o comentario no codigo e a fonte de descoberta.

## Ferramentas

| Capacidade (o que eu consigo fazer) | Categoria | Quando usar (gatilho) | Localizador | Script | Invocacao | Reuso declarado | Perigo | SHA |
|---|---|---|---|---|---|---|---|---|
| Harness canônico de MUTAÇÃO DE AMOSTRA (promovido a tools/ no D-46; nasceu como | — | — | `**(sem localizador)**` | `tools/mutacao-amostra.py` | `python -B tools/mutacao-amostra.py --src --simbolo --literal --mutacao --teste --saida` | nenhum externo — stdlib (argparse/json/re/subprocess); invoca npx … | MUTA o arquivo-alvo no disco durante o run (restauracao byte-exata em | `ca3b631f8480` |
| Gerar PLAYBOOK.md do repo (projeção externa das regras) e verificar frescor. | — | — | `**(sem localizador)**` | `tools/playbook/generate-playbook.py` | `python -B tools/playbook/generate-playbook.py --repo --sources --write --check --check-sent` | fontes declaradas em tools/playbook/playbook-sources.txt (AGENTS.md, | --write SOBRESCREVE PLAYBOOK.md/PLAYBOOK.index.json da raiz (projeção | `baee0aded2eb` |
| judge-playbook.py — juiz mecanico da prova cega V5 (design arena-zcode campeao). | — | — | `**(sem localizador)**` | `tools/playbook/judge-playbook.py` | `python -B tools/playbook/judge-playbook.py --answer --index` | tools/playbook (index gerado pelo generate-playbook.py) | read-only (juiz mecânico da prova cega V5) | `5fe5fb3727bd` |
| post-merge (wrapper): git exige nome exato sem extensao; a implementacao | — | — | `**(sem localizador)**` | `tools/playbook/hooks/post-merge` | `—` | **nao declarado** | — | `d7c791c831f4` |
| global divergente (grita instrução em vez de agir) | — | — | `**(sem localizador)**` | `tools/playbook/hooks/post-merge.impl.mjs` | `—` | node:fs/node:child_process; pares canônicos de canonical-pairs | COPIA repo->global dos 4 pares após pull/merge; RECUSA sobrescrever | `cbd7a5eaf3c1` |
| PLAYBOOK drift gate - blocks any commit while the projection is stale. | — | — | `**(sem localizador)**` | `tools/playbook/hooks/pre-commit` | `—` | **nao declarado** | — | `7ec1e6d22cc2` |
| Auditoria do contrato de envelope de erro (PPIRTV-ERRO-QUE-ENSINA-ENVELOPE). | — | — | `**(sem localizador)**` | `scripts/audit-error-envelope.mjs` | `—` | src/error-envelope via build/dist | read-only (audita mensagens do envelope fiscal) | `6bb3f8ca8f3a` |
| Chamar tool MCP do dex-PPIRTV via stdio (e listar tools) com args JSON de | — | — | `**(sem localizador)**` | `scripts/call-mcp-tool.mjs` | `node scripts/call-mcp-tool.mjs --workspace <dir> --list · node scripts/call-mcp-tool.mjs …` | @modelcontextprotocol/sdk (client stdio); dist/launcher.js\|index.js … | chama tool MCP REAL no workspace (efeitos persistem em .ppirtv/ e no | `d9a0f1b623e0` |
| Os 4 pares globais do repo (fonte unica; consumido pelo audit-canonical-sync | — | — | `**(sem localizador)**` | `scripts/canonical-pairs.mjs` | `—` | nenhum externo (módulo de dados dos 4 pares canônicos) | read-only (fonte única consumida pelo audit/post-merge) | `ccc3d7ca8885` |
| PPIRTV-CAPACITY-COMMIT-GATE | — | — | `**(sem localizador)**` | `scripts/check-capacity.mjs` | `—` | node:child_process/node:fs; CAPACITY.receipt.json (contrato canônico) | BLOQUEIA commit sem par CAPACITY staged (gate read-only; emite | `4f5b83372afa` |
| de compartilhar) | — | — | `**(sem localizador)**` | `scripts/export-diagnostic-bundle.mjs` | `—` | store/flows do .ppirtv local | ESCREVE bundle diagnóstico em disco (fora do git; sanitizar antes | `0687b3e2d2ce` |
| points; use -DryRun para conferir antes; emite receipt JSON | — | — | `**(sem localizador)**` | `scripts/remove-safe-path.ps1` | `—` | nenhum — PowerShell puro | REMOVE arquivo/diretorio com validacao rigorosa de raiz e reparse | `cdacc0c5e08e` |
| render-ppirtv-phase.mjs | — | — | `**(sem localizador)**` | `scripts/render-ppirtv-phase.mjs` | `—` | nenhum externo (render puro) | read-only (render de fase para checklist visual) | `d5baa0f94859` |

## Sem capacidade registrada (5) — fila de leitura

A capacidade e **prosa**: leia o codigo e registre com `python -B <motor> --repo "C:/CodexProjetos/dex-PPIRTV" --dirs tools,scripts --registrar-capacidade <arquivo> --capacidade "<frase>"`. Enquanto nao existir, a entrada NAO ocupa a tabela acima — linha vazia nao responde a pergunta de quem busca.

- `scripts/audit-canonical-sync.mjs` — sem prosa
- `scripts/record-goal-progress.mjs` — sem prosa
- `scripts/smoke-mcp-tools.mjs` — sem prosa
- `scripts/validate-flow-engine-boundary.mjs` — sem prosa
- `scripts/validate-spt.mjs` — sem prosa

## Cobertura

- entradas na tabela: **13** (**13** ferramentas em `tools/`, `scripts/` + **0** entry points de produto)
- sem capacidade (fila de prosa): **5**
- fora da tabela por PAPEL: **teste 1**
- com `Reuso:` declarado (so ferramenta): **11**
- com `Custo:` (R17) declarado: **1** (exigido so de ferramenta NOVA)
- com `Perigo:` declarado: **11** (os que agem fora da maquina)
- sem `Reuso:`: **2** — `post-merge`, `pre-commit`
- imports internos que NAO resolvem (modulo ou simbolo): **0**

## Limite declarado

Este livro prova que a ferramenta EXISTE, que declara reuso, que os imports internos resolvem ate o simbolo e que a Invocacao cita arquivo existente. Nao prova que o reuso declarado e verdadeiro nem que a ferramenta funciona — isso e `nao_verificavel` aqui e fica com a revisao/o teste.
