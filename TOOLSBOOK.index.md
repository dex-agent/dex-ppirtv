# TOOLSBOOK — índice de consulta

Abra primeiro este índice; depois apenas as fichas pertinentes.
Fonte: TOOLSBOOK.json. Livro completo: TOOLSBOOK.md.
Resumo de descoberta, não prova de adequação nem cobertura total.

## mutacao-amostra (reviewed)

Harness canonico de MUTACAO DE AMOSTRA: muta 1 literal num simbolo TS, roda tsc+vitest e devolve veredito executavel (PEGA / SOBREVIVEU / INVALIDO).
Quando: Corte de rede REDE-CORTE-POR-MODULO; provar que it vigia a mutacao (vigilia e o juiz); caracterizar lacuna (b).

## test-symbol-coverage (reviewed)

Regua perene da rede simbolo x suite: mede mention_refs e code_refs de cada export dos modulos da serie (maratona Ondas 1-7 + domain desde D-50).
Quando: Antes/depois de corte de rede; decidir proximo maior monte com cara de corte; calibrar no REDE.md.

## check-duplicacao-delta (reviewed)

5o gate do pre-commit: bloqueia commit que introduz/mantem duplicata Type-2 ENTRE arquivos .py staged (hash de AST normalizada) com as 2 localizacoes.
Quando: Todo commit com .py staged (hook chama automaticamente); auditoria manual de duplicacao em Python.

## duplicacao-allowlist (reviewed)

Allowlist versionada (R10) de excecoes legitimas do gate de duplicacao, com motivo por entrada.
Quando: Falso positivo confirmado do gate Type-2 em .py.

## generate-playbook (reviewed)

Projecao deterministica PLAYBOOK.md + PLAYBOOK.index.json das regras de decisao do repo (fontes em tools/playbook/playbook-sources.txt). MODO CONSUMIDOR so por fonte DECLARADA ausente (TRACKER 0030; GitHub #42 #43): o clone do destinatario nao gera drift falso nem degrada a projecao, e o produtor minimo gera o primeiro par. PARSER POR DECLARACAO (ISSUE-LOCAL-0031): so e regra a secao cujo token foi declarado no titulo, numa linha 'Localizador:' ou sozinho na primeira bala do corpo.
Quando: Editar fonte (README/AGENTS/INDEX/napkin) regenerar na MESMA sessao; --check no pre-commit (gate 1); preparar envio a terceiros.

## judge-playbook (reviewed)

Juiz mecanico da prova cega V5 do playbook (design arena-zcode campeao): intersecao de conjuntos — mencionar PLAYBOOK.md, citar selo pb-<8hex> real, localizador real e rota da regra citada.
Quando: Avaliar se resposta de consumidor externo usou o playbook de verdade (eco do AGENTS nao casa).

## pre-commit-gates (reviewed)

Porta de commit com 5 gates: (1) PLAYBOOK frescor, (2) CAPACITY par MD+receipt staged, (3) CRG auto-curativo (src/tests/scripts/workflow/tools), (4) TOOLSBOOK frescor, (5) duplicacao-delta .py.
Quando: TODO commit do repo (hook incondicional; ativar com git config core.hooksPath tools/playbook/hooks).

## post-merge-paridade (reviewed)

Hook post-merge: confere paridade dos 4 pares canonicos global<->local apos pull (contratos compartilhados).
Quando: todo git pull/merge no repo

## canonical-pairs (reviewed)

Modulo de DADOS dos 4 pares canonicos global<->local (fonte unica; consumido pelo audit-canonical-sync e pelo hook post-merge).
Quando: nascer/mudar par de contrato compartilhado

## audit-canonical-sync (reviewed)

Audita por hash se as copias locais dos contratos globais divirgem da fonte global (canonicaliza CRLF antes do SHA).
Quando: npm run audit:canonical; antes de declarar pronto contrato compartilhado

## check-capacity (reviewed)

Gate CAPACITY: todo commit exige CAPACITY.md (secao Reavaliacao atual) + CAPACITY.receipt.json (dex.capacity.snapshot.v1) STAGED no mesmo commit.
Quando: todo commit (hook); quando toca src/tests/scripts/package.json/tsconfig.json a reavaliacao cobre os deltas

## validate-spt (reviewed)

Validador LOCAL do Trilho/SPT v3 (mesma regra do spt_validate MCP, motor direto na sessao).
Quando: antes de goal_start; quando MCP indisponivel ou para conferencia dupla

## validate-flow-engine-boundary (reviewed)

Fiscal do camping de src/flow-engine.ts: todo edit recebe SHRINK/CONTAIN/EXCEPTION/FAIL; exige record causal no ledger de blobs + RED real em EXCEPTION; sela no commit seguinte.
Quando: toda visita que TOCA src/flow-engine.ts (gatilho PPIRTV-FLOW-ENGINE-CAMPING-RULE; consulta read-only = NOT_APPLICABLE)

## call-mcp-tool (reviewed)

Harness generico MCP stdio: chama tool do dex-PPIRTV (launcher ou index) com args JSON de arquivo; tambem lista tools.
Quando: cerimonia MCP na sessao (goal_start/evidence_add/verdict...); provar tools/list real; consumidor de workspace terceiro

## smoke-mcp-tools (reviewed)

Smoke read-only do servidor MCP: chama tools/list (NUNCA tools mutantes) contra dist/launcher|index.
Quando: apos build, antes de declarar mudanca de tools carregada

## record-goal-progress (reviewed)

Persiste progresso de goal no flow (eventos de fase/checklist) via tools MCP do goal.
Quando: cerimonia /GOAL: avancos de fase e checklist visual

## render-ppirtv-phase (reviewed)

Hook visual (ZCode/Claude Code compativel): renderiza a barra de fases PPIRTV do workspace ativo lendo .ppirtv/flows/*.json.
Quando: sessao com checklist visual dinamico (ancora-fluxo --detail full)

## export-diagnostic-bundle (reviewed)

Exporta bundle diagnostico dos flows do .ppirtv local para analise/compartilhamento.
Quando: diagnostico cross-flow; relato de consumidor (contrato CROSS_REPO_PROBLEM_REPORT)

## audit-error-envelope (reviewed)

Auditoria do contrato de envelope de erro (PPIRTV-ERRO-QUE-ENSINA-ENVELOPE): confere mensagens do envelope fiscal via src/error-envelope no build.
Quando: mudar error-envelope; evidencia pontual de diagnostico-que-ensina

## remove-safe-path (reviewed)

Harness canonico de remocao segura (-Path/-Root/-Recurse/-DryRun) para quando o harness bloqueia Remove-Item inline por policy.
Quando: gatilho REMOVE-ITEM-BLOQUEADO-POLITICA; remocao de pasta/arquivo nao trivial

## es-everything-busca-nome (reviewed)

Busca de arquivo/pasta/executavel por NOME no sistema Windows inteiro em milissegundos (Everything voidtools).
Quando: gatilho ES-PRIMEIRA-BATIDA-POR-NOME: por nome, es.exe e a PRIMEIRA batida ANTES de find/glob/ls recursivo e ANTES de declarar que a fonte nao existe

Revisão: warning — external_sources_not_checked; reopen the canonical owner
## code-review-graph-cli (reviewed)

CLI do grafo estrutural CRG: banco .agents/CODE-REVIEW-GRAPH com update incremental + consultas para review estrutural/blast radius.
Quando: gate CRG-LOCAL-STRUCTURAL-GRAPH (todo commit que toca codigo atualiza o banco no mesmo instante — hook cura); antes de review estrutural

Revisão: warning — external_sources_not_checked; reopen the canonical owner
## dex-toolsbook-motor (reviewed)

Motor do proprio livro: fatos (--facts path->sha256), validacao (--check TOOLSBOOK.json), projecao (--render/--index) e ficha focal (--card ID).
Quando: criar/mudar/recuperar ferramenta do repo; conferir frescor do livro; consulta por intenção antes de criar

Revisão: warning — external_sources_not_checked; reopen the canonical owner
## spt-preflight (reviewed)

validador estrutural local de Trilho SPT v3 antes do goal_start (fiscal S00-S12; regras locais + PARIDADE COM O MOTOR: quando dist/spt-contract.js esta ao lado do kit, reporta como S10 o que o schema do motor rejeita)
Quando: rodar ANTES de qualquer goal_start e ao lapidar um Trilho; also consumido por fixtures de teste que validam o fiscal; no kit copiado para outro workspace roda sem o motor ao lado e avisa que a paridade esta desligada
