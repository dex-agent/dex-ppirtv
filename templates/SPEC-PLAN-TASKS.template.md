# Trilho - <title>

Tipo: SPEC-PLAN-TASKs
Status: RASCUNHO
Owner: <owner>
Data: <yyyy-mm-dd>
Workspace: <absolute-workspace-path>
Origem: <origin>

## GoalEnvelope

```json
{
  "workspace": "<absolute-workspace-path>",
  "spt_path": "<absolute-spt-path>",
  "objective": "<clear-objective>",
  "idempotency_key": "<project-or-repo>:<date-slug>",
  "evidence_required": true,
  "required_evidence": ["<expected-evidence>"],
  "requested_verdict_policy": "evidence_required",
  "source": "<origin>"
}
```

## Contexto

<contexto operacional suficiente para entender o trabalho>

## Problema

<problema concreto que este Trilho resolve>

## Decisao

<decisao de implementacao ou execucao que governa este Trilho>

## Escopo

- <item dentro do escopo>

## Fora de escopo

- <item fora do escopo>

## SPEC

<comportamento, contrato ou resultado esperado>

## PLAN

1. <primeiro passo>
2. <segundo passo>
3. <terceiro passo>

## TASKs

| ID | Status | Prioridade | Tarefa | Criterio de aceite |
| --- | --- | ---: | --- | --- |
| SPT-001 | todo | P1 | <task-summary> | <done-criterion> |

## Expected Evidence

- <expected-evidence>

## Done Criteria

- <done-criterion>

## Riscos

- <risco principal>

## Gates

- `spt_validate` deve retornar `valid=true`.
- `goal_start` deve retornar `flow_id`.
- `goal_status` deve expor `tasks`, `expected_evidence` e `done_criteria`.
- `goal_verdict` positivo deve ter `evidence_ids` rastreaveis.

## Validacao

- <comando ou verificacao real>

## Prompt /GOAL de execucao

```text
/GOAL

Retomar em:
<absolute-workspace-path>

Execute o Trilho:
<absolute-spt-path>
```
