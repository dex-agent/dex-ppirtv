---
dex_contract: spt
version: 3
status: 'FIXTURE'
owner: 'fixture'
date: '2026-10-30'
workspace: 'C:\fixture'
origin: 'fixture S03 do preflight'
goal: { id: fixture-s03-261030, title: 'fixture', objective: 'disparar S03 sem outros achados' }
context: 'fixture'
problem: 'fixture'
decision: 'fixture'
scope: { include: ['x'], exclude: ['y'] }
requirements:
  - id: REQ-01
    statement: 'fixture'
    criteria:
      - id: C-01
        statement: 'O comando roda e retorna exit zero no final.'
plan: ['fixture']
tasks:
  - id: A-01
    action: 'fixture'
    covers: [REQ-01]
    done_when: [C-01]
    depends_on: []
    evidence_requirements:
      - id: ER-01
        proves: [C-01]
        method: command
        procedure: 'fixture'
        expectation: { kind: command_exit, expected_exit_code: 0 }
closure_gates: ['fixture']
risks: ['fixture']
uncertainties: ['fixture']
gates: ['fixture']
validation: ['fixture']
execution_prompt: |
  /GOAL fixture
---
