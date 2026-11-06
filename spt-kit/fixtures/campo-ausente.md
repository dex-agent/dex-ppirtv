---
dex_contract: spt
version: 3
status: 'RASCUNHO'
owner: 'sprinter'
date: '2026-11-06'
workspace: 'C:\CodexProjetos\dex-PPIRTV'
origin: 'fixture do kit'
goal:
  id: fixture-do-kit
  title: 'fixture'
  objective: 'provar comportamento do preflight'
context: 'ctx'
problem: 'prob'
decision: 'dec'
scope:
  include: ['a']
  exclude: ['b']
requirements:
  - id: REQ-01
    statement: 'req'
    criteria:
      - id: C-01
        statement: 'condicao unica'
plan: ['passo']
tasks:
  - id: A-01
    action: 'acao'
    covers: [REQ-01]
    done_when: [C-01]
    depends_on: []
    evidence_requirements:
      - id: ER-01
        proves: [C-01]
        method: command
        procedure: 'true'
        expectation:
          kind: command_exit
          expected_exit_code: 0
closure_gates: ['gate']
risks: ['risco']
uncertainties: ['ressalva']
gates: ['gate']
validation: ['true']
---
