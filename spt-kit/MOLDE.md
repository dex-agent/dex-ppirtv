# MOLDE SPT v3 — preencher, nunca interpretar

Regras: `RULES.md` (R1-R08). Ordem e gate: `GUIA.md`. Copie o bloco para
`<workspace>\.agents\PLAN-TASKS\YYYY-MM-DD-<slug>.md`, preencha cada marcador
com UMA linha e rode o preflight antes de qualquer goal_start.

---
dex_contract: spt
version: 3
status: 'RASCUNHO'
owner: 'TODO-PREENCHER owner (skill dona da criacao)'
date: 'TODO-PREENCHER YYYY-MM-DD'
workspace: 'TODO-PREENCHER caminho absoluto do workspace'
origin: 'TODO-PREENCHER decisao ou GO que originou este trilho em 1 frase'
goal:
  id: 'TODO-PREENCHER slug-lowercase-com-data'
  title: 'TODO-PREENCHER titulo curto'
  objective: 'TODO-PREENCHER objetivo unico verificavel em 1 frase'
context: 'TODO-PREENCHER contexto operacional minimo'
problem: 'TODO-PREENCHER problema observavel em 1 frase'
decision: 'TODO-PREENCHER decisao tomada em 1 frase'
scope:
  include:
    - 'TODO-PREENCHER item dentro do escopo'
  exclude:
    - 'TODO-PREENCHER item fora do escopo'
requirements:
  - id: REQ-01
    statement: 'TODO-PREENCHER requisito observavel'
    criteria:
      - id: C-01
        statement: 'TODO-PREENCHER UMA condicao verificavel'
plan:
  - 'TODO-PREENCHER passo 1'
tasks:
  - id: A-01
    action: 'TODO-PREENCHER acao executavel'
    covers: [REQ-01]
    done_when: [C-01]
    depends_on: []
    evidence_requirements:
      - id: ER-01
        proves: [C-01]
        method: command
        procedure: 'TODO-PREENCHER comando literal com resultado esperado'
        expectation:
          kind: command_exit
          expected_exit_code: 0
closure_gates:
  - 'TODO-PREENCHER gate de fechamento (memoria, indices, commit)'
risks:
  - 'TODO-PREENCHER risco com mitigacao'
uncertainties:
  - 'Somente com incerteza material real e decisao pendente; senao remover esta linha'
gates:
  - 'spt_validate retorna valid=true e contract_version=3 antes de goal_start.'
validation:
  - 'TODO-PREENCHER comando de validacao literal'
execution_prompt: |
  /GOAL
  TODO-PREENCHER instrução de execução do trilho com workspace.
---
