# TOOLSBOOK

dex-PPIRTV: ferramentas executaveis do repo (tools/, scripts/, hooks do playbook) + ferramentas externas em uso direto pelo projeto (es.exe, code-review-graph, motor dex-toolsbook). Fonte autorada: este JSON; TOOLSBOOK.md e TOOLSBOOK.index.md sao projecoes.

Fonte autorada: TOOLSBOOK.json. Projecao de leitura; nao editar esta copia.
Checagem mecanica: structural_fresh.
Adequacao semantica e prontidao de commit: nao avaliadas pelo motor.

## Cobertura declarada

Inspecionado:
- tools/check-duplicacao-delta.py
- tools/mutacao-amostra.py
- tools/test-symbol-coverage.py
- tools/duplicacao-allowlist.json
- tools/playbook/generate-playbook.py
- tools/playbook/judge-playbook.py
- tools/playbook/hooks/pre-commit
- tools/playbook/hooks/post-merge
- tools/playbook/hooks/post-merge.impl.mjs
- scripts/audit-canonical-sync.mjs
- scripts/audit-error-envelope.mjs
- scripts/call-mcp-tool.mjs
- scripts/canonical-pairs.mjs
- scripts/check-capacity.mjs
- scripts/export-diagnostic-bundle.mjs
- scripts/record-goal-progress.mjs
- scripts/remove-safe-path.ps1
- scripts/render-ppirtv-phase.mjs
- scripts/smoke-mcp-tools.mjs
- scripts/validate-flow-engine-boundary.mjs
- scripts/validate-spt.mjs
- TOOLSBOOK.md/TOOLSBOOK.index.md na raiz (v1 de tools/ morto; historia preservada no git 65a0a80)

Nao inspecionado:
- workflow/ (2 scripts do metodo da casa; consumiveis pelo registry, nao ferramenta de produto do repo)
- spt-kit/ (kit de molde/preflight do contrato SPT; documento-metodo, nao catalogado como ferramenta)
- skills/ (8 pacotes do sync-lab; fora do escopo de ferramenta do repo)
- tests/ (suite vitest; cobertura, nao ferramenta operacional)
- docs/ (documentacao viva)

## mutacao-amostra

**Estado autorado:** reviewed

**purpose:**
Harness canonico de MUTACAO DE AMOSTRA: muta 1 literal num simbolo TS, roda tsc+vitest e devolve veredito executavel (PEGA / SOBREVIVEU / INVALIDO).

**when:**
Corte de rede REDE-CORTE-POR-MODULO; provar que it vigia a mutacao (vigilia e o juiz); caracterizar lacuna (b).

**how:**
python -B tools/mutacao-amostra.py --src src/<mod>.ts --simbolo <nome-real> --literal '<exato count==1>' --mutacao '<novo>' --teste 'tests/<arquivo>.test.ts' [--saida .json]

**inputs:**
src, simbolo (aceita generics apos emenda D-49), literal exato (count==1, single-line), mutacao, arquivo(s) de teste

**outputs:**
JSON receipt {valido, sobreviveu, failed, passed, restaurado, viva_no_disco}; exit 0=veredito VALIDO (NAO significa PEGA), 2=INVALIDO/guarda

**risks:**
MUTA o alvo no disco durante o run (finally restaura byte-exato; conferir sha pos-lote); mutante que quebra tsc = INVALIDO, nunca PEGA.

**owner:**
tio-testador

**next_review:**
proximo corte de rede (D-51+): conferir se lacunas de span reaparecem

**capabilities:**
- mutacao-de-amostra
- vigilia-de-mutacao
- baseline-verde-antes
- restauracao-byte-exata
- lock-O_EXCL-entre-lotes

**not_for:**
- literal multi-linha em arquivo CRLF (detector ensina single-line)
- generic-de-generic (>1 nivel de chaves)
- export const multi-linha sem ';' (span indefinido)

**evidence:**
- docstring l.1-61 (vacinas D-45..D-49)
- .agents/AUDITORIAS/2026-11-14-rede-fiscal-blockers/MUTACOES/ (23 validas congeladas)
- .agents/AUDITORIAS/2026-11-13-rede-review-snapshot/MUTACOES/

**Fontes examinadas:**
- `tools/mutacao-amostra.py` — SHA256 `e682fd5894e4549d8476ad6a1fa6da5f463797e95a1e43f303f9165d54f2cd40`

## test-symbol-coverage

**Estado autorado:** reviewed

**purpose:**
Regua perene da rede simbolo x suite: mede mention_refs e code_refs de cada export dos modulos da serie (maratona Ondas 1-7 + domain desde D-50).

**when:**
Antes/depois de corte de rede; decidir proximo maior monte com cara de corte; calibrar no REDE.md.

**how:**
python -B tools/test-symbol-coverage.py --json <caminho.json> (tabela vai ao stdout; JSON tem modules/total/prose_suspects)

**inputs:**
src/ e tests/ do repo (root derivado de __file__; copia relocada ABORTA alto, nunca 0/0 silencioso)

**outputs:**
tabela por modulo (code/mention/sem-ref) + JSON {modules:{<mod>:{exports,mention_refs,code_refs,without_nominal_ref[]}}, total, prose_suspects}

**risks:**
mention em comentario/titulo de it conta como prose (use code_refs para decidir); o mapa de DECISOES mora no REDE.md, nao aqui.

**owner:**
sprinter/conselho-de-rede (sessao do corte)

**next_review:**
D-50 fechado (domain adicionado ao MARATHON_MODULES pela janela do corte); re-medir apos its novos

**capabilities:**
- regua-de-rede
- discriminacao-code-vs-mention
- prose_suspects

**not_for:**
- veredito de cobertura (sem ref nominal NAO significa sem cobertura — rotulo honesto do help)
- gate bloqueante (e relatorio)

**evidence:**
- .agents/AUDITORIAS/2026-11-12-rede-simbolos-suporte/REDE.md (rodadas 1-9)
- help do script (rotulo honesto)
- regua rodada 11 D-51 (2026-11-15): principles em MARATHON_MODULES; TOTAL 99/278, sem ref 175
- regua rodada 12 D-52 (2026-11-16): ppirtv-checkin em MARATHON_MODULES 15/21 sem-ref 6; TOTAL 114/299, sem ref 181

**Fontes examinadas:**
- `tools/test-symbol-coverage.py` — SHA256 `6d5ee4dc53d50c2c73b77d46bbc5f7492c31cc695f99cf7235050cf8af72191a`

## check-duplicacao-delta

**Estado autorado:** reviewed

**purpose:**
5o gate do pre-commit: bloqueia commit que introduz/mantem duplicata Type-2 ENTRE arquivos .py staged (hash de AST normalizada) com as 2 localizacoes.

**when:**
Todo commit com .py staged (hook chama automaticamente); auditoria manual de duplicacao em Python.

**how:**
python -B tools/check-duplicacao-delta.py --check (no pre-commit, apos detectar .py staged)

**inputs:**
diff staged de *.py; tools/duplicacao-allowlist.json (excecoes R10 com motivo)

**outputs:**
verde ou BLOQUEIO com pares e localizacoes (reporta BASENAME)

**risks:**
motor reporta BASENAME: falso negativo silencioso se casar path completo (declarado na memoria do gate); custo 0.274s medido.

**owner:**
guarda dos gates (revisao pela skill dex-duplicacao-codigo)

**next_review:**
quando o delta .ts staged for aprovado pelo dono

**capabilities:**
- gate-pre-commit
- deteccao-type-2-AST
- allowlist-versionada

**not_for:**
- arquivos .ts (proposta de delta .ts staged aguarda GO — vacinas de reuso)
- duplicata intra-arquivo

**evidence:**
- RED provado ao vivo com commit ABORTADO (4 gates verdes antes; commit b07daf1 instala)
- auto-memory ppirtv-gate-duplicacao-delta-5-portao

**Fontes examinadas:**
- `tools/check-duplicacao-delta.py` — SHA256 `b9d1fa212cd2429e3aac83d0fb96400930ffa4c2c125c3ff6be9e9e5d5b652cd`

## duplicacao-allowlist

**Estado autorado:** reviewed

**purpose:**
Allowlist versionada (R10) de excecoes legitimas do gate de duplicacao, com motivo por entrada.

**when:**
Falso positivo confirmado do gate Type-2 em .py.

**how:**
editar tools/duplicacao-allowlist.json (entrada + motivo; baseline atual: 0 grupos)

**inputs:**
par de arquivos + justificativa

**outputs:**
excecao consultavel no gate

**risks:**
allowlist crescer sem revisao (cada entrada precisa de motivo)

**owner:**
revisor do gate

**next_review:**
no primeiro falso positivo real

**capabilities:**
- allowlist-com-motivo

**not_for:**
- silenciar duplicata sem motivo escrito

**evidence:**
- gate RED b07daf1 (allowlist vazia = baseline 0 grupos)

**Fontes examinadas:**
- `tools/duplicacao-allowlist.json` — SHA256 `cfc5b4a82260060d80652e6625a03f692f813ccb5d1454990e724f9c148db9ca`

## generate-playbook

**Estado autorado:** reviewed

**purpose:**
Projecao deterministica PLAYBOOK.md + PLAYBOOK.index.json das regras de decisao do repo (fontes em tools/playbook/playbook-sources.txt). MODO CONSUMIDOR so por fonte DECLARADA ausente (TRACKER 0030; GitHub #42 #43): o clone do destinatario nao gera drift falso nem degrada a projecao, e o produtor minimo gera o primeiro par. PARSER POR DECLARACAO (ISSUE-LOCAL-0031): so e regra a secao cujo token foi declarado no titulo, numa linha 'Localizador:' ou sozinho na primeira bala do corpo.

**when:**
Editar fonte (README/AGENTS/INDEX/napkin) regenerar na MESMA sessao; --check no pre-commit (gate 1); preparar envio a terceiros.

**how:**
python -B tools/playbook/generate-playbook.py --repo . --write (regen) | --check (frescor; exit 2 = drift, projecao incompleta ou recusa) | --check-sent (fontes enviadas) | [--sources a,b]

**inputs:**
fontes declaradas em playbook-sources.txt

**outputs:**
PLAYBOOK.md + PLAYBOOK.index.json na raiz (authority: derived_projection)

**risks:**
fonte editada sem regen trava QUALQUER commit (gate incondicional) — inclusive janelas paralelas

**owner:**
dex-playbook-entrada (skill da familia Dex)

**next_review:**
ao adicionar/remover fonte de decisao

**capabilities:**
- projecao-externa
- gate-frescor
- modo consumidor SO por fonte declarada (manifesto ou --sources) ausente: --check exit 0 c/ aviso nomeando as ausentes, depois de conferir o par recebido; --write RECUSA exit 2 preservando a projecao; autodeteccao sem manifesto nunca ativa o modo (produtor minimo gera)
- par recebido conferido: --check e --check-sent reprovam (exit 2) clone sem PLAYBOOK.md ou sem PLAYBOOK.index.json
- parser por declaracao: localizador so do titulo, de linha 'Localizador:' ou de bala sozinha no topo; citacao interna vira secao nao decodificada c/ motivo; gatilho so de linha 'Gatilho:'; extrato so de prosa; dedupe por localizador

**not_for:**
- edicao manual da projecao (nunca)

**evidence:**
- hook pre-commit l.5
- plaquinha global PLAYBOOK-ENTRADA-EXTERNA-261005
- tests/issue-0030-playbook-clone-consumidor.test.ts (4 its: clone check=aviso/write=recusa preservando bytes/check-sent/fonte drift real segue exit 2)
- tests/issue-0042-0043-playbook-consumidor.test.ts (4 its: produtor minimo exit 0; clone sem md / sem index / check-sent exit 2)
- tests/issue-local-0031-playbook-parser.test.ts (10 its: localizador por declaracao x citacao interna; gatilho; extrato; linha omitida; dedupe; grafia)
- mutacao de sessao 2026-11-23: 7 mutacoes (M1 autodeteccao, M2 par recebido, M3 localizador, M4 gatilho, M5 dedupe, M6 extrato, M7 render) -> 7 PEGA, 0 sobrevivente

**Fontes examinadas:**
- `tools/playbook/generate-playbook.py` — SHA256 `fc5393270b0e75f5f10583d20511d8da8f3886a40091d9a93cf662888b5a96a6`

## judge-playbook

**Estado autorado:** reviewed

**purpose:**
Juiz mecanico da prova cega V5 do playbook (design arena-zcode campeao): intersecao de conjuntos — mencionar PLAYBOOK.md, citar selo pb-<8hex> real, localizador real e rota da regra citada.

**when:**
Avaliar se resposta de consumidor externo usou o playbook de verdade (eco do AGENTS nao casa).

**how:**
python -B tools/playbook/judge-playbook.py <resposta> <index> (ver criterios no docstring)

**inputs:**
resposta do consumidor + PLAYBOOK.index.json

**outputs:**
veredito mecanico por criterio

**risks:**
nenhum identificado (read-only)

**owner:**
arena-zcode (design campeao)

**next_review:**
quando o formato do index mudar

**capabilities:**
- prova-cega-V5

**not_for:**
- julgar qualidade da resposta (so o USO REAL do playbook)

**evidence:**
- docstring l.1-6

**Fontes examinadas:**
- `tools/playbook/judge-playbook.py` — SHA256 `336db15ae963ebaf074bf741287dea673f569964feb2aefe06fb76e4ca71e042`

## pre-commit-gates

**Estado autorado:** reviewed

**purpose:**
Porta de commit com 5 gates: (1) PLAYBOOK frescor, (2) CAPACITY par MD+receipt staged, (3) CRG auto-curativo (src/tests/scripts/workflow/tools), (4) TOOLSBOOK frescor, (5) duplicacao-delta .py.

**when:**
TODO commit do repo (hook incondicional; ativar com git config core.hooksPath tools/playbook/hooks).

**how:**
executado pelo git automaticamente; nao use --no-verify para contornar

**inputs:**
staged do commit

**outputs:**
commit liberado ou bloqueado com diagnostico por gate

**risks:**
frota sem CLI/skill: CRG e TOOLSBOOK degradam para AVISO P10 (travar commit por falta de ferramenta e autossabotagem); CAPACITY valida FORMA do par, head==HEAD nao e verificado (EST-F3).

**owner:**
guarda dos gates

**next_review:**
D-50+ (gate TOOLSBOOK reaparelhado ao contrato v2 nesta sessao)

**capabilities:**
- gate-playbook
- gate-capacity
- gate-crg
- gate-toolsbook
- gate-duplicacao

**not_for:**
- --no-verify (proibido pelas regras locais)

**evidence:**
- tools/playbook/hooks/pre-commit (5 blocos comentados)
- AGENTS.md local (PPIRTV-CAPACITY-COMMIT-GATE, CRG-LOCAL-STRUCTURAL-GRAPH)
- cura TRACKER-0011 (2026-11-16, D-52 A-00): comentario do gate de duplicacao cita a dona real do motor medir-duplicacao.py (dex-complexidade-ciclomatica) — 1 linha, zero mudanca de comportamento

**Fontes examinadas:**
- `tools/playbook/hooks/pre-commit` — SHA256 `166f25ab958dfb20aa9e74481fab739b1fba4f7a60c21b995504b02c961d9b61`

## post-merge-paridade

**Estado autorado:** reviewed

**purpose:**
Hook post-merge: confere paridade dos 4 pares canonicos global<->local apos pull (contratos compartilhados).

**when:**
todo git pull/merge no repo

**how:**
wrapper sh de 3 linhas + decide() PURA no post-merge.impl.mjs (self-test pelo wrapper)

**inputs:**
arquivos dos pares (canonical-pairs.mjs)

**outputs:**
aviso de divergencia pos-merge

**risks:**
nome de hook sem extensao e CJS no node (licao paga: import ESM quebra)

**owner:**
guarda dos contratos compartilhados

**next_review:**
quando nascer 5o par (bump em canonical-pairs)

**capabilities:**
- paridade-contratos
- wrapper-sh-impl-esm

**not_for:**
- correcao automatica (so aponta)

**evidence:**
- memoria ppirtv-hook-git-hook-wrapper-esm (a8f90e0)

**Fontes examinadas:**
- `tools/playbook/hooks/post-merge` — SHA256 `d7c791c831f46c5b761195147055cf89b7964033e1bc1f58698609b22cf8779b`
- `tools/playbook/hooks/post-merge.impl.mjs` — SHA256 `f645ca7e5878ced5d69f5db1120f27cefd442c7db4c9742911356d3b07de2353`

## canonical-pairs

**Estado autorado:** reviewed

**purpose:**
Modulo de DADOS dos 4 pares canonicos global<->local (fonte unica; consumido pelo audit-canonical-sync e pelo hook post-merge).

**when:**
nascer/mudar par de contrato compartilhado

**how:**
import { canonicalPairs } from scripts/canonical-pairs.mjs

**inputs:**
repoRoot, userProfile

**outputs:**
lista dos pares com caminhos

**risks:**
bump esquecido deixa par novo fora da paridade

**owner:**
guarda dos contratos

**next_review:**
no 5o par

**capabilities:**
- dados-de-pares

**not_for:**
- logica de comparacao (mora nos consumidores)

**evidence:**
- cabecalho do modulo

**Fontes examinadas:**
- `scripts/canonical-pairs.mjs` — SHA256 `7da6f697ecf24a9d820dee8c2cdf8db9043af58da530db324688073f0ee1e346`

## audit-canonical-sync

**Estado autorado:** reviewed

**purpose:**
Audita por hash se as copias locais dos contratos globais divirgem da fonte global (canonicaliza CRLF antes do SHA).

**when:**
npm run audit:canonical; antes de declarar pronto contrato compartilhado

**how:**
node scripts/audit-canonical-sync.mjs

**inputs:**
canonical-pairs.mjs

**outputs:**
relatorio de divergencia por par

**risks:**
CRLF nao canonicalizado daria falso drift (ja tratado)

**owner:**
guarda dos contratos

**next_review:**
no 5o par

**capabilities:**
- audit-sync-global-local

**not_for:**
- correcao (diagnostico)

**evidence:**
- D-39: audit pegou sync ao vivo (2f901fe)

**Fontes examinadas:**
- `scripts/audit-canonical-sync.mjs` — SHA256 `2449cebdb092dcebac43e0ff7084ae88c74e108b851263233f7e529e62b719f4`

## check-capacity

**Estado autorado:** reviewed

**purpose:**
Gate CAPACITY: todo commit exige CAPACITY.md (secao Reavaliacao atual) + CAPACITY.receipt.json (dex.capacity.snapshot.v1) STAGED no mesmo commit.

**when:**
todo commit (hook); quando toca src/tests/scripts/package.json/tsconfig.json a reavaliacao cobre os deltas

**how:**
node scripts/check-capacity.mjs --staged

**inputs:**
staged do commit

**outputs:**
verde ou bloqueio com campos faltantes

**risks:**
receipt re-foto e MANUAL: receipt velho passa no gate (incidente pago no D-47; ressalva em pe)

**owner:**
guarda dos gates / sessao que commita

**next_review:**
se o dono quiser endurecer o gate a head==HEAD (hoje proposital)

**capabilities:**
- gate-capacity-par-staged

**not_for:**
- verificar conteudo verdadeiro do receipt (valida FORMA; head==HEAD e suite==vitest real ficam na mao da sessao — ressalva EST-F3)

**evidence:**
- AGENTS.md local PPIRTV-CAPACITY-COMMIT-GATE
- incidente D-47 (falso verde herdado, ISSUE-LOCAL-0009)

**Fontes examinadas:**
- `scripts/check-capacity.mjs` — SHA256 `db90ca026aacf7094e82d20bf69d881f41cb39c590ef5b770a6aa0f94f5e8977`

## validate-spt

**Estado autorado:** reviewed

**purpose:**
Validador LOCAL do Trilho/SPT v3 (mesma regra do spt_validate MCP, motor direto na sessao).

**when:**
antes de goal_start; quando MCP indisponivel ou para conferencia dupla

**how:**
node scripts/validate-spt.mjs <trilho>

**inputs:**
arquivo do Trilho (.agents/PLAN-TASKS/*.md)

**outputs:**
receipt estrutural (valid, contract_version, missing, contract_errors)

**risks:**
transporte MCP ja deu falso negativo intermitente (D-49) — motor direto serve de arbitro

**owner:**
sprinter

**next_review:**
bump do schema dex.spt.v3

**capabilities:**
- validacao-spt-v3-local

**not_for:**
- substituir o spt_validate MCP oficial quando disponivel (e rota de conferencia/aceleracao)

**evidence:**
- D-49: spt_validate MCP FALSE com textos identicos; motor direto valid=true

**Fontes examinadas:**
- `scripts/validate-spt.mjs` — SHA256 `b4f6ceabc3ba0188081612a775c7eea9951ff42e2ab20bb3f005842b7f4477df`

## validate-flow-engine-boundary

**Estado autorado:** reviewed

**purpose:**
Fiscal do camping de src/flow-engine.ts: todo edit recebe SHRINK/CONTAIN/EXCEPTION/FAIL; exige record causal no ledger de blobs + RED real em EXCEPTION; sela no commit seguinte.

**when:**
toda visita que TOCA src/flow-engine.ts (gatilho PPIRTV-FLOW-ENGINE-CAMPING-RULE; consulta read-only = NOT_APPLICABLE)

**how:**
npm run check:flow-engine (wrappa este validador)

**inputs:**
diff da visita, ledger, declaredTestTitles (titulos de it/test EXATOS, nunca describe)

**outputs:**
veredito semantico por edicao + record selado no commit seguinte (commit/parent_commit preenchidos por evaluateCommitSealDiff)

**risks:**
record pos-commit = LEDGER_CHANGE/SHAPE_CHANGED (emenda exige reset --soft e dancar); seletor sem acento exato = RED_SELECTOR_NOT_FOUND

**owner:**
oraculo-refatoracao

**next_review:**
proximo corte que tocar o monolito

**capabilities:**
- camping-fiscal-semantico
- selo-de-record
- red-evidence-por-seletor-de-it
- evidence-nao-versionada (.agents/) reprovada mesmo existindo no disco (gate EVIDENCE_NOT_VERSIONED, CI run 44505736533)
- prune exige prova por simbolo (PRUNE_SYMBOL_UNDECLARED:<nome> — remocao real fora da declaracao reprova)
- redirect versionado de evidence legada (evidence_redirects no manifest; destino versionado + sha256; record-check bootstrap e diff redirect-only de ledger sancionado)

**not_for:**
- visitas que nao tocam o arquivo (NOT_APPLICABLE)

**evidence:**
- memoria ppirtv-issue19-fechada-selo-camping-coreografia (4 dancas decifradas)
- fonte l.433-446/l.1158-1229
- Trilho 2026-11-21-redirect-evidence-legada-ledger (flow 5916_0001): 6 records re-ancorados, RED->GREEN 4/4, mutacao PEGA

**Fontes examinadas:**
- `scripts/validate-flow-engine-boundary.mjs` — SHA256 `efdd2e857db7672573ae0b678d4016859b076467355f77a0802b3552e2e1601a`

## call-mcp-tool

**Estado autorado:** reviewed

**purpose:**
Harness generico MCP stdio: chama tool do dex-PPIRTV (launcher ou index) com args JSON de arquivo; tambem lista tools.

**when:**
cerimonia MCP na sessao (goal_start/evidence_add/verdict...); provar tools/list real; consumidor de workspace terceiro

**how:**
node scripts/call-mcp-tool.mjs <tool> --args-file <json> [--entry dist/launcher.js|dist/index.js]

**inputs:**
tool, args JSON conferidos, entrypoint

**outputs:**
resposta da tool REAL (efeitos persistem em .ppirtv/ e no disco)

**risks:**
chama tool REAL: erro de MCP nunca vai para /dev/null (licao do flow 3217)

**owner:**
Fernanda do Fluxo (cerimonias)

**next_review:**
mudanca de entrypoint/launcher

**capabilities:**
- harness-mcp-stdio
- tools-list-real
- chamada-com-args-arquivo

**not_for:**
- chamada mutante sem conferir o JSON (use --args-file revisado)

**evidence:**
- usado em todos os cortes D-3x..D-49 (cerimonia MCP)
- AGENTS local: validar list_tools real apos build

**Fontes examinadas:**
- `scripts/call-mcp-tool.mjs` — SHA256 `d5b8f676cc2f57c6f6e55d1962149e447391903748eb5d0ca2e4cd1360368cca`

## smoke-mcp-tools

**Estado autorado:** reviewed

**purpose:**
Smoke read-only do servidor MCP: chama tools/list (NUNCA tools mutantes) contra dist/launcher|index.

**when:**
apos build, antes de declarar mudanca de tools carregada

**how:**
node scripts/smoke-mcp-tools.mjs [--entry <launcher|index>]

**inputs:**
entrypoint compilado

**outputs:**
lista de tools real (prova TOOLS-REAL; list_dir/regex NAO valem)

**risks:**
nenhum identificado

**owner:**
validador-pronto

**next_review:**
mudanca de servidor/tools

**capabilities:**
- smoke-tools-list

**not_for:**
- chamadas mutantes (read-only por desenho)

**evidence:**
- regra local AGENTS: validar list_tools real apos build

**Fontes examinadas:**
- `scripts/smoke-mcp-tools.mjs` — SHA256 `4fa549cbaef6ded0495061d5445e7c0a1cc7479a7af73849132769d34e9e9930`

## record-goal-progress

**Estado autorado:** reviewed

**purpose:**
Persiste progresso de goal no flow (eventos de fase/checklist) via tools MCP do goal.

**when:**
cerimonia /GOAL: avancos de fase e checklist visual

**how:**
node scripts/record-goal-progress.mjs <args do evento>

**inputs:**
flow alvo, payload do progresso

**outputs:**
mutacao em .ppirtv/ (evento persistido)

**risks:**
muta .ppirtv/ (runtime local, fora do versionamento)

**owner:**
Fernanda do Fluxo

**next_review:**
mudanca de schema de evento

**capabilities:**
- persistir-progresso-flow

**not_for:**
- uso fora de cerimonia ativa

**evidence:**
- cabecalho do script

**Fontes examinadas:**
- `scripts/record-goal-progress.mjs` — SHA256 `e9620016a1765da33a411af3ee8a34959d9aba6815f73d259ac5c081a9069043`

## render-ppirtv-phase

**Estado autorado:** reviewed

**purpose:**
Hook visual (ZCode/Claude Code compativel): renderiza a barra de fases PPIRTV do workspace ativo lendo .ppirtv/flows/*.json.

**when:**
sessao com checklist visual dinamico (ancora-fluxo --detail full)

**how:**
node scripts/render-ppirtv-phase.mjs (render puro, read-only)

**inputs:**
.ppirtv/flows/*.json do workspace ativo

**outputs:**
barra visual P🧠->P🗂️->I🛠️->R🔎->T🧪->V✅ com fase corrente

**risks:**
nenhum identificado

**owner:**
ancora-fluxo

**next_review:**
mudanca de fases do contrato

**capabilities:**
- render-de-fase

**not_for:**
- mutar estado do flow

**evidence:**
- cabecalho do script

**Fontes examinadas:**
- `scripts/render-ppirtv-phase.mjs` — SHA256 `ab6678412c2811965b11e98398dc936345565324bb5727a664c8720519fa310b`

## export-diagnostic-bundle

**Estado autorado:** reviewed

**purpose:**
Exporta bundle diagnostico dos flows do .ppirtv local para analise/compartilhamento.

**when:**
diagnostico cross-flow; relato de consumidor (contrato CROSS_REPO_PROBLEM_REPORT)

**how:**
node scripts/export-diagnostic-bundle.mjs

**inputs:**
store/flows do .ppirtv local

**outputs:**
bundle em disco FORA do git

**risks:**
ESCREVE bundle; sanitizar antes de enviar a terceiro

**owner:**
diagnosticador da sessao

**next_review:**
quando o contrato de relato mudar

**capabilities:**
- bundle-diagnostico

**not_for:**
- compartilhar sem sanitizar (pode conter paths/payloads)

**evidence:**
- cabecalho do script

**Fontes examinadas:**
- `scripts/export-diagnostic-bundle.mjs` — SHA256 `bc6c31d28a09139ad0af7ae41d5b0768e6f9ebe98413ded78934f4b656c2d8e0`

## audit-error-envelope

**Estado autorado:** reviewed

**purpose:**
Auditoria do contrato de envelope de erro (PPIRTV-ERRO-QUE-ENSINA-ENVELOPE): confere mensagens do envelope fiscal via src/error-envelope no build.

**when:**
mudar error-envelope; evidencia pontual de diagnostico-que-ensina

**how:**
node scripts/audit-error-envelope.mjs [--strict]

**inputs:**
dist do repo

**outputs:**
report-first: codigos_sem_next_required_action=N; --strict exit 1 quando N>0 (so para evidencia pontual)

**risks:**
--strict fora de evidencia pontual vira falso bloqueio

**owner:**
guarda do envelope

**next_review:**
se o dono decidir virar gate

**capabilities:**
- audit-envelope-erro
- report-first

**not_for:**
- gate continuo de CI (decisao do dono pendente — anti-autossabotagem P10)

**evidence:**
- cabecalho do script
- contrato docs/contracts (envelope de erro)

**Fontes examinadas:**
- `scripts/audit-error-envelope.mjs` — SHA256 `5f721080da2616f3d0e8e600daf12d890b143c7b5a3405198cb6f0ec5dc6cd1e`

## remove-safe-path

**Estado autorado:** reviewed

**purpose:**
Harness canonico de remocao segura (-Path/-Root/-Recurse/-DryRun) para quando o harness bloqueia Remove-Item inline por policy.

**when:**
gatilho REMOVE-ITEM-BLOQUEADO-POLITICA; remocao de pasta/arquivo nao trivial

**how:**
powershell -File scripts/remove-safe-path.ps1 -Path <alvo> -Root <raiz> [-Recurse] [-DryRun]

**inputs:**
path alvo + raiz de seguranca

**outputs:**
remocao com guardas (ou simulacao com -DryRun)

**risks:**
operacao destrutiva: sempre -DryRun primeiro em alvo novo

**owner:**
powershell-windows

**next_review:**
sem mudanca prevista

**capabilities:**
- remocao-segura-com-guardas

**not_for:**
- bypassar garimpo (nada se apaga sem garimpeiro antes)

**evidence:**
- plaquinha global REMOVE-ITEM-BLOQUEADO-POLITICA
- nota citavel 2026-08-18

**Fontes examinadas:**
- `scripts/remove-safe-path.ps1` — SHA256 `c46a46e761384d8dfd42617ff1936685c55d8ec0e624be6969b9c2bde023a41d`

## es-everything-busca-nome

**Estado autorado:** reviewed
**Revisao da fonte:** warning — external_sources_not_checked; reopen the canonical owner

**purpose:**
Busca de arquivo/pasta/executavel por NOME no sistema Windows inteiro em milissegundos (Everything voidtools).

**when:**
gatilho ES-PRIMEIRA-BATIDA-POR-NOME: por nome, es.exe e a PRIMEIRA batida ANTES de find/glob/ls recursivo e ANTES de declarar que a fonte nao existe

**how:**
es.exe -n 20 <termo> (CLI ES do Everything; indexacao do desktop)

**inputs:**
termo de nome (nao conteudo)

**outputs:**
paths que casam o nome

**risks:**
depende do servico Everything ativo na maquina

**owner:**
ferramenta da maquina (skill busca-arquivos-everything)

**next_review:**
upgrade do es.exe

**capabilities:**
- busca-por-nome-sistema-todo

**not_for:**
- busca de CONTEUDO dentro de arquivo (use rg)

**evidence:**
- AGENTS.md global plaquinha ES-PRIMEIRA-BATIDA-POR-NOME (caso pago 2x)

**Fontes externas (fora do check local):**
- owner: voidtools (ES CLI) | locator: $env:USERPROFILE\.localin\es.exe | revision: 1.1.0.37 | evidence: AGENTS.md plaquinha ES-PRIMEIRA-BATIDA-POR-NOME (caso pago 2x); skill busca-arquivos-everything

**Fontes examinadas:**
- `AGENTS.md` — SHA256 `5aa0e4500535c5277ef7c19cb3863634bcc3a7f08830bad330b0af7778133f2b`

## code-review-graph-cli

**Estado autorado:** reviewed
**Revisao da fonte:** warning — external_sources_not_checked; reopen the canonical owner

**purpose:**
CLI do grafo estrutural CRG: banco .agents/CODE-REVIEW-GRAPH com update incremental + consultas para review estrutural/blast radius.

**when:**
gate CRG-LOCAL-STRUCTURAL-GRAPH (todo commit que toca codigo atualiza o banco no mesmo instante — hook cura); antes de review estrutural

**how:**
code-review-graph update --repo . --data-dir .agents/CODE-REVIEW-GRAPH -q (NUNCA --base HEAD: NO-OP comprovado)

**inputs:**
fontes do repo

**outputs:**
banco estrutural + receipts; exige head_matches_build=true

**risks:**
banco stale gera review em grafo velho (conferir head_matches_build); frota sem CLI: gate degrada para aviso P10

**owner:**
guarda dos gates (skill code-review-graph)

**next_review:**
sem mudanca prevista

**capabilities:**
- grafo-estrutural
- update-incremental
- blast-radius

**not_for:**
- --base HEAD (barata morta 2026-11-05: diff vazio = banco preso)

**evidence:**
- hook pre-commit l.24-31
- memoria ppirtv-desmontagem-flow-engine-aberta-3464 (WinError 183 = rm receipt failed)

**Fontes externas (fora do check local):**
- owner: skill code-review-graph (registry) | locator: code-review-graph no PATH | revision: nao pinada (lacuna declarada) | evidence: hook pre-commit l.24-31 chama e confere exit; banco .agents/CODE-REVIEW-GRAPH

**Fontes examinadas:**
- `tools/playbook/hooks/pre-commit` — SHA256 `166f25ab958dfb20aa9e74481fab739b1fba4f7a60c21b995504b02c961d9b61`

## dex-toolsbook-motor

**Estado autorado:** reviewed
**Revisao da fonte:** warning — external_sources_not_checked; reopen the canonical owner

**purpose:**
Motor do proprio livro: fatos (--facts path->sha256), validacao (--check TOOLSBOOK.json), projecao (--render/--index) e ficha focal (--card ID).

**when:**
criar/mudar/recuperar ferramenta do repo; conferir frescor do livro; consulta por intenção antes de criar

**how:**
python -B ~/.agents/skills/dex-toolsbook/scripts/toolsbook.py --repo . --check TOOLSBOOK.json (raiz) | --render ... | --index ... | --card TOOLSBOOK.json (raiz) <id>

**inputs:**
TOOLSBOOK.json v2 (authority llm_authored)

**outputs:**
fatos/diagnostico/projecoes stdout (motor NUNCA grava); exit 0=mecanico ok, 1=stale, 2=invalido

**risks:**
hash fresco NAO prova cobertura nem qualidade; busca vazia NAO prova ausencia

**owner:**
dex-toolsbook (registry; padrao TOOLS-FAMILIA-REUSO-GLOBAL: o repo nao copia o motor)

**next_review:**
ISSUE-LOCAL-0010 (pinar versao da skill na frota)

**capabilities:**
- fatos-sha
- check-estrutural
- render-e-index
- card-focal

**not_for:**
- julgamento semantico (semantic_fit: not_assessed por desenho; o LLM autora, o motor confere fatos)
- aprovar commit (nunca usar como aprovacao)

**evidence:**
- SCHEMA/dex.toolsbook.v2.schm.md (contrato canonico no registry)
- --usage do motor

**Fontes externas (fora do check local):**
- owner: skill dex-toolsbook (registry ~/.agents/skills) | locator: ~/.agents/skills/dex-toolsbook/scripts/toolsbook.py | revision: contrato v2 working_tree do registry (sem pin — ISSUE-LOCAL-0010) | evidence: este TOOLSBOOK.json passa no --check

**Fontes examinadas:**
- `tools/playbook/hooks/pre-commit` — SHA256 `166f25ab958dfb20aa9e74481fab739b1fba4f7a60c21b995504b02c961d9b61`

## spt-preflight

**Estado autorado:** reviewed

**purpose:**
validador estrutural local de Trilho SPT v3 antes do goal_start (fiscal S00-S12; espelho local do spt_validate MCP)

**when:**
rodar ANTES de qualquer goal_start e ao lapidar um Trilho; also consumido por fixtures de teste que validam o fiscal

**how:**
node spt-kit/preflight.mjs <caminho-do-trilho>; achados no stdout com exit != 0; --schema/--help/--usage pelo intercept TRIADE-DOC

**inputs:**
caminho do arquivo .md do Trilho (frontmatter YAML na linha 1); --checksum <molde> p/ anti-drift S09

**outputs:**
stdout: achados=0 (verde) ou lista Snn com exit != 0; banner --schema anuncia S00..S12

**risks:**
casamento por substring em procedure ja pagou a auditoria 377f94a (#39): boundary de fim de token e obrigatorio em novos Snn de script; S12 cobra FORMA na criacao — conteudo das 3 respostas e do agente (doc 10 lei 1)

**owner:**
spt-kit (fiscal local); revisao sprinter/spt-revisor

**next_review:**
bump do schema dex.spt.v3 ou novo check Snn

**capabilities:**
- S00 frontmatter
- S03 criterios atomicos
- S04 expectation kinds
- S11 prova de tipos por nomes completos (check:types|check inteiro; boundary de fim de token — GitHub #39)
- S12 bloco abertura pago (R19): 3 perguntas base contexto/ferramentas/mentor na CRIACAO do Trilho — transicao compativel, ausencia nunca bloqueia o motor

**not_for:**
- validacao semantica do CONTEUDO (isso e do agente/spt_validate MCP); nao substitui goal_start binding

**evidence:**
- tests/issue-r19-abertura.test.ts (3 its: sem bloco dispara S12; completo limpa; incompleto nomeia o campo)
- tests/issue-0039-prefixo-capacity.test.ts (S11 boundary)

**Fontes examinadas:**
- `spt-kit/preflight.mjs` — SHA256 `e1a532be23c1521fc0bc4605ceda01c9376e36387d76ecb1f718fdcbff38b279`
