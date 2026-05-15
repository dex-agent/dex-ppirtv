# TASKS

## Sprint 0 - Documentacao

- [x] Criar repositorio local.
- [x] Criar glossario `CONTEXT.md`.
- [x] Criar `SPEC.md`.
- [x] Criar `PLAN.md`.
- [x] Criar `TASKS.md`.
- [x] Criar `SPRINTS.md`.
- [x] Criar `REFERENCE.md`.
- [x] Criar guias numerados em `docs/`.
- [x] Criar ADRs iniciais.
- [x] Validar consistencia dos links.

## Sprint 1 - Skeleton MCP

- [x] Escolher stack do servidor MCP.
- [x] Criar scaffold do projeto.
- [x] Implementar servidor `stdio`.
- [x] Declarar capabilities de tools/resources/prompts.
- [x] Expor tool `flow_create`.
- [x] Criar teste smoke de inicializacao.

## Sprint 2 - Flow e ledger

- [x] Criar schema de `Flow`.
- [x] Criar schema de `LedgerEvent`.
- [x] Implementar persistencia local.
- [x] Implementar `flow_create`.
- [x] Implementar `flow_status`.
- [x] Implementar `flow_archive`.
- [x] Testar recuperacao apos reiniciar servidor.

## Sprint 3 - Gates PPIRTV

- [x] Implementar gates por fase.
- [x] Implementar `flow_advance`.
- [x] Implementar `flow_return`.
- [x] Testar bloqueio de avanco sem gate.
- [x] Testar retorno com motivo.

## Sprint 4 - Reunioes

- [x] Implementar reuniao divergente.
- [x] Implementar reuniao convergente.
- [x] Implementar reuniao transversal.
- [x] Registrar decisoes e alternativas.
- [x] Testar reuniao vinculada a flow.

## Sprint 5 - Evidencia e veredito

- [x] Implementar `evidence_attach`.
- [x] Implementar `verdict_record`.
- [x] Implementar `checklist_render`.
- [x] Implementar `hygiene_scan`.
- [x] Testar veredito sem evidencia rebaixado e com evidencia aprovado.

## Sprint 6 - Integracao real

- [x] Configurar cliente MCP `stdio` em teste.
- [x] Rodar flow PPIRTV completo de exemplo em teste E2E.
- [x] Registrar evidencias.
- [x] Revisar seguranca e paths.
- [x] Atualizar docs finais.
