---
dex_contract: spt
version: 3
status: RASCUNHO
owner: '<owner>'
date: '<yyyy-mm-dd>'
workspace: '<absolute-workspace-path>'
origin: '<origin>'
goal:
  id: '<stable-lowercase-goal-id>'
  title: '<human-readable-title>'
  objective: '<clear-objective>'
context: '<operational-context>'
problem: '<concrete-problem>'
decision: '<implementation-or-execution-decision>'
scope:
  include:
    - '<in-scope-item>'
  exclude:
    - '<out-of-scope-item>'
requirements:
  - id: REQ-01
    statement: '<observable requirement>'
    criteria:
      - id: C-01
        statement: '<minimum condition that must be demonstrated>'
plan:
  - '<first-step>'
  - '<second-step>'
tasks:
  - id: A-01
    action: '<one executable action>'
    covers: [REQ-01]
    done_when: [C-01]
    depends_on: []
    evidence_requirements:
      - id: ER-01
        proves: [C-01]
        method: test
        procedure: '<reproducible procedure>'
        expectation:
          kind: command_exit
          expected_exit_code: 0
closure_gates:
  - 'Review and test have independent receipts tied to the evaluated revision_set.'
  - 'Checkout findings were delivered to garimpeiro and every active parking item received a canonical estacionamento receipt.'
  - 'Project living state is reconciled through memoria-viva for the next resumption.'
  - 'napkin-projeto was evaluated; write only substantial operational learning or report nenhuma escrita necessaria.'
risks:
  - '<primary-risk>'
uncertainties:
  - '<material-uncertainty>'
gates:
  - 'spt_validate must return valid=true and contract_version=3.'
  - 'goal_start must return flow_id.'
  - 'A positive goal_verdict requires passed criterion_proof coverage for every minimum criterion.'
  - 'Final closure must apply memoria-viva and collect owner receipts for garimpeiro, estacionamento, napkin-projeto and dex-memoria.'
validation:
  - '<real-command-or-verification>'
execution_prompt: |
  /GOAL
  Execute the trail <absolute-spt-path> in <absolute-workspace-path>.
---

# <human-readable-title>

This Markdown body is a human projection. The YAML graph above is the single
machine authority. Do not maintain a second hand-written requirements matrix
that can contradict it.

## Estado visual

- [ ] A-01 — evidence: `<evidence_id after execution>`
- [ ] C-01 — covered by a passed proof bound to `ER-01`

## Fechamento e retomada

- [ ] `revisor-codigo` emitiu receipt ligado à revision avaliada.
- [ ] `tio-testador` emitiu receipt independente ligado à mesma revision.
- [ ] `validador-pronto` consolidou a matriz sem substituir review ou teste.
- [ ] `garimpeiro` classificou e deduplicou os achados do checkout.
- [ ] `estacionamento` persistiu itens ativos com owner e `quando` ou respondeu `nenhuma escrita necessaria`.
- [ ] `memoria-viva` reconciliou estado, evidencia, bloqueio e proximo passo com `quando`.
- [ ] `napkin-projeto` foi avaliado; houve escrita substancial ou `nenhuma escrita necessaria`.
- [ ] `dex-memoria` gravou memoráveis e `consciencia-memorias` validou, ou houve `nenhuma escrita necessaria`.
