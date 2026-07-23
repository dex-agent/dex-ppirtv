---
dex_contract: spt
version: 2
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
spec: '<expected-behavior-contract-or-result>'
plan:
  - '<first-step>'
  - '<second-step>'
tasks:
  - '<task-summary>'
expected_evidence:
  - '<expected-evidence>'
done_criteria:
  - '<done-criterion>'
  - 'Project living state is reconciled through memoria-viva for the next resumption.'
  - 'napkin-projeto was evaluated; write only substantial operational learning or report nenhuma escrita necessaria.'
risks:
  - '<primary-risk>'
uncertainties:
  - '<material-uncertainty>'
gates:
  - 'spt_validate must return valid=true.'
  - 'goal_start must return flow_id.'
  - 'goal_verdict positive requires traceable evidence_ids.'
  - 'Final closure must apply memoria-viva and the moderated napkin-projeto gate.'
validation:
  - '<real-command-or-verification>'
execution_prompt: |
  /GOAL
  Execute the trail <absolute-spt-path> in <absolute-workspace-path>.
---

# <human-readable-title>

This Markdown body is for people. Its headings, language, order and level of
detail are free-form and are not read by `spt_validate`.

## Fechamento e retomada

- [ ] `memoria-viva` reconciliou estado, evidencia, bloqueio e proximo passo com `quando`.
- [ ] `napkin-projeto` foi avaliado; houve escrita substancial ou `nenhuma escrita necessaria`.
