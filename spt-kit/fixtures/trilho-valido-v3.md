---
dex_contract: spt
version: 3
status: 'RASCUNHO'
owner: 'sessao-zcode-dex-ppirtv (GO do dono 2026-11-23 ao plano do $oraculo-solid; fiscal $chato)'
date: '2026-11-23'
workspace: 'C:\CodexProjetos\dex-PPIRTV'
abertura:
  contexto: "Segunda rodada do auditor externo (GitHub #41-#53, revisao 02cb74b..3eed999). Três achados caem no gerador do Playbook, todos reproduzidos nesta sessão: #43 regressao — resolve_sources devolve (solved, ausentes) sem distinguir fonte DECLARADA (manifesto ou --sources) de CANDIDATO da autodeteccao, e main trata qualquer ausente como clone consumidor, entao --write recusa um produtor minimo (exit 2 listando 3 candidatos default; com --sources da exit 0). #42 — no modo consumidor --check devolve 0 antes de conferir PLAYBOOK.md e PLAYBOOK.index.json (exit 0 numa fixture sem os dois). ISSUE-LOCAL-0031 (UAT-1 A3) — parse_rules_file usa o primeiro token CAPS-hifen >=12 do corpo como localizador (citacoes internas viram nome de regra: Bootstrap→TRACKER-LOCAL, Leitura→PENDENTES-LEDGER, Dex Agent→PPIRTV-GIT-CONSOLIDACAO-SELETIVA-MAIN), gatilho e a primeira linha que contem 'gatilho' (casa GATILHOS-VIVOS e repete o rotulo '- Gatilho:'), extrato e a primeira linha nao vazia (cerca de codigo, bala do token), grafia 'ndeclarado', e a mesma regra de duas fontes sai duas vezes sem dedupe. Fato medido: AGENTS.md local e gitignored (.gitignore:20) — as 7 regras que ele projeta apontam fonte que nao viaja no clone; docs/PLAYBOOK-RULES.md e a fonte que viaja. Decisao anterior preservada: o modo consumidor do ISSUE-LOCAL-0030 (commit 6b3ea97) continua valendo para clone com manifesto e fonte declarada ausente. Lacunas: a medida 'base exit 0 em 02cb74b' e do auditor (nao reexecutei o gerador antigo); frequencia em producao nao medida."
  ferramentas: "tools/playbook/generate-playbook.py (alvo unico; ficha generate-playbook no TOOLSBOOK; CRG impact no HEAD 3eed999: 0 arquivos do repo dependem dele — folha do grafo). tests/issue-0030-playbook-clone-consumidor.test.ts (padrao de fixture e helper rodar() reaproveitado). tools/playbook/hooks/pre-commit (gate 1 chama --check: herda o comportamento, nao muda). tools/playbook/judge-playbook.py (juiz da prova cega consome PLAYBOOK.md + index — conferir apos o regen). spt-kit/preflight.mjs + scripts/validate-spt.mjs (validacao do Trilho) e scripts/call-mcp-tool.mjs (cerimonia). Conselheiro $oraculo-clean-code ativo: grafo rico clean-code-deep-reconciled-fase-b (442 nos, exit 0), FTS5 do mentor (437 blocos), fulltext en-2008 SHA 38f11d3f conferido no manifesto — ancoras l.1273 e l.1570 (funcao faz uma coisa; quem trata erro so trata erro), l.5801 (duplicacao), l.1697 (comentario impreciso e pior que nenhum), l.2663. Regua dex-regras-desenvolvimento-casa R1-R19 + referencias Python, JavaScript e TypeScript (ja existentes; nenhuma linguagem nova). mm_pipeline_run avaliado e descartado: cria flow legado com evidencia DECLARADA pela entrada (l.4462), nao cobre SPT v3 com prova por criterio."
  mentor: "mentor-documental-python (argparse, codigos de saida, re) — interrogar com $interrogador-documental no tropeço de parser ou exit code."
origin: "GO do dono 2026-11-23 ('sim segue completo ate o final'), aceitando o plano do $oraculo-solid: Trilho P = gerador do Playbook."
goal:
  id: aud2-p-playbook-gerador-261123
  title: 'Trilho P — gerador do Playbook: modo consumidor so por fonte declarada, par recebido conferido, parser que nomeia regra por declaracao'
  objective: "O gerador do Playbook trata como clone consumidor so o repo cuja fonte DECLARADA (manifesto ou --sources) esta ausente, exige o par PLAYBOOK.md + PLAYBOOK.index.json nas conferencias desse clone, e so decodifica como regra a secao cujo token foi declarado no titulo, numa linha Localizador: ou sozinho na primeira bala do corpo — fechando #42, #43 e o ISSUE-LOCAL-0031, com RED antes, mutacao e cerimonia completa."
context: "Uma funcao, uma responsabilidade: resolve_sources so resolve fontes; a classificacao produtor x consumidor so olha fontes declaradas; a conferencia do par recebido mora numa funcao propria usada por --check e --check-sent. No parser, funcoes puras separadas para localizador, gatilho e extrato, e dedupe por localizador na agregacao. Efeito visivel: o PLAYBOOK do repo deixa de listar 7 'regras' com localizador trocado e fonte que nao viaja, e lista as regras declaradas em docs/PLAYBOOK-RULES.md."
problem: "Um produtor minimo nao consegue gerar o primeiro Playbook, um clone sem os arquivos publicados passa na conferencia, e a projecao mostra regras com localizador, gatilho e extrato que nao sao da regra."
decision: "Menor mudança que fecha a classe: (1) ausentes so conta fonte declarada — autodeteccao nao declara; (2) funcao projecoes_ausentes() exige o par em --check e --check-sent do consumidor; (3) no parser, token nomeia a regra so por declaracao (titulo, linha Localizador:, bala sozinha no topo do corpo), o que nao declara vira secao nao decodificada com ancora; gatilho so de linha 'Gatilho:', extrato so de prosa (linha omitida quando nao ha), grafia 'não declarado', primeira ocorrencia ganha no dedupe. Decisao do dono para a #49 (kit x motor) vale aqui por analogia: nada instalado quebra — clone com manifesto segue exatamente como hoje."
scope:
  include:
    - 'tools/playbook/generate-playbook.py'
    - 'tests/issue-0042-0043-playbook-consumidor.test.ts'
    - 'tests/issue-local-0031-playbook-parser.test.ts'
    - 'PLAYBOOK.md e PLAYBOOK.index.json regenerados no mesmo corte'
    - 'TOOLSBOOK ficha generate-playbook, CAPACITY par e CHANGELOG'
  exclude:
    - 'ISSUE-LOCAL-0032 (onboarding do destinatario e exit codes): decisao de produto do dono, Trilho proprio'
    - 'template da skill dex-playbook-entrada: repo dono e o registry (drift de 185 linhas, item proprio)'
    - 'tools/playbook/hooks/pre-commit (so chama --check)'
    - 'conteudo das fontes docs/PLAYBOOK-RULES.md e AGENTS.md'
requirements:
  - id: REQ-01
    statement: 'Modo consumidor so por fonte declarada, com o par recebido conferido.'
    criteria:
      - id: C-01
        statement: 'Produtor sem manifesto gera o par PLAYBOOK a partir das fontes opcionais presentes com exit 0.'
      - id: C-02
        statement: 'Clone consumidor com um arquivo publicado ausente reprova --check com exit 2 nomeando o arquivo ausente.'
  - id: REQ-02
    statement: 'O parser so decodifica regra cujo localizador foi declarado.'
    criteria:
      - id: C-03
        statement: 'Seção cujo único token aparece em citação interna do corpo entra em nao decodificadas.'
      - id: C-04
        statement: 'O gatilho projetado de uma regra é o valor da linha Gatilho: da fonte, sem rotulo repetido.'
      - id: C-05
        statement: 'O extrato projetado nunca é cerca de codigo nem a bala do localizador.'
      - id: C-06
        statement: 'Localizador repetido em duas fontes projeta uma única regra.'
      - id: C-07
        statement: 'A ocorrência repetida de um localizador entra em nao decodificadas com a fonte que ganhou.'
  - id: REQ-03
    statement: 'Entrega com prova.'
    criteria:
      - id: C-08
        statement: 'npm run check devolve exit 0 com a suite completa verde.'
plan:
  - 'P1: Trilho + RED dos dois grupos (consumidor e parser)'
  - 'P2: cura do modo consumidor (#42 #43)'
  - 'P3: cura do parser (ISSUE-LOCAL-0031) + regen do PLAYBOOK'
  - 'P4: mutacao + suite + docs + commit/push/CI + cerimonia'
tasks:
  - id: A-01
    action: 'Escrever os testes RED do modo consumidor'
    covers: [REQ-01]
    done_when: [C-01]
    depends_on: []
    evidence_requirements:
      - id: ER-01
        proves: [C-01]
        method: test
        procedure: 'npx vitest run tests/issue-0042-0043-playbook-consumidor.test.ts'
        expectation:
          kind: boolean_assertion
          expected: true
  - id: A-02
    action: 'Curar o modo consumidor — fonte declarada x candidato e par recebido'
    covers: [REQ-01]
    done_when: [C-02]
    depends_on: [A-01]
    evidence_requirements:
      - id: ER-02
        proves: [C-02]
        method: test
        procedure: 'npx vitest run tests/issue-0042-0043-playbook-consumidor.test.ts'
        expectation:
          kind: boolean_assertion
          expected: true
  - id: A-03
    action: 'Escrever o RED e curar o parser — localizador por declaracao, gatilho, extrato, dedupe'
    covers: [REQ-02]
    done_when: [C-03, C-04, C-05, C-06, C-07]
    depends_on: [A-01]
    evidence_requirements:
      - id: ER-03
        proves: [C-03, C-04, C-05, C-06, C-07]
        method: test
        procedure: 'npx vitest run tests/issue-local-0031-playbook-parser.test.ts'
        expectation:
          kind: boolean_assertion
          expected: true
  - id: A-04
    action: 'Regenerar a projecao, rodar suite e check, commitar e subir com CI'
    covers: [REQ-03]
    done_when: [C-08]
    depends_on: [A-02, A-03]
    evidence_requirements:
      - id: ER-04
        proves: [C-08]
        method: command
        procedure: 'npm run check'
        expectation:
          kind: command_exit
          expected_exit_code: 0
closure_gates:
  - 'RED->GREEN + mutacao PEGA'
  - 'Review de concepcao satisfazendo abertura_paga'
  - 'Flow termina com status complete'
risks:
  - 'a projecao do repo muda no regen — o gate de frescor do pre-commit bloqueia o commit se PLAYBOOK.md e PLAYBOOK.index.json nao forem regenerados no mesmo corte'
  - 'judge-playbook.py consome PLAYBOOK.md e index — conferir os selos apos o regen'
uncertainties:
  - 'ressalva residual: o ISSUE-LOCAL-0032 (onboarding e exit codes) depende de decisao de produto do dono e fica fora deste Trilho'
gates:
  - 'spt_validate retorna valid=true e contract_version=3 antes de goal_start.'
validation:
  - 'node spt-kit/preflight.mjs .agents/PLAN-TASKS/2026-11-23-aud2-p-playbook-gerador.md'
  - 'npx vitest run tests/issue-0042-0043-playbook-consumidor.test.ts tests/issue-local-0031-playbook-parser.test.ts + npm run check'
execution_prompt: |
  /GOAL
  Executar o trilho 2026-11-23-aud2-p-playbook-gerador.md no workspace C:\CodexProjetos\dex-PPIRTV: modo consumidor so por fonte declarada, par recebido conferido, parser que nomeia regra por declaracao. RED->GREEN + mutacao, cerimonia completa.
---

# Trilho P — gerador do Playbook (#42, #43, ISSUE-LOCAL-0031)

Detalhes no frontmatter. Checklist visual:

- [x] A-01 RED do modo consumidor — 11F|3P nos dois arquivos, cada falha é sintoma real
- [x] A-02 cura do modo consumidor — #42 e #43; mutação M1 e M2 PEGA
- [x] A-03 RED + cura do parser + regen do PLAYBOOK — 0031; mutação M3 a M7 PEGA; projeção com 2 regras e 11 não decodificadas
- [x] A-04 suite, check, commit/push/CI — commit 816dfa4 PUSHED; CI 45198113732 SUCCESS 2 runners; npm run check pós-commit exit 0 (1102 passed, 4 skipped)
