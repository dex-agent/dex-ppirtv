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

- [ ] Escolher stack do servidor MCP.
- [ ] Criar scaffold do projeto.
- [ ] Implementar servidor `stdio`.
- [ ] Declarar capabilities de tools/resources/prompts.
- [ ] Expor tool `flow_create` fake/minima.
- [ ] Criar teste smoke de inicializacao.

## Sprint 2 - Flow e ledger

- [ ] Criar schema de `Flow`.
- [ ] Criar schema de `LedgerEvent`.
- [ ] Implementar persistencia local.
- [ ] Implementar `flow_create`.
- [ ] Implementar `flow_status`.
- [ ] Implementar `flow_archive`.
- [ ] Testar recuperacao apos reiniciar servidor.

## Sprint 3 - Gates PPIRTV

- [ ] Implementar gates por fase.
- [ ] Implementar `flow_advance`.
- [ ] Implementar `flow_return`.
- [ ] Testar bloqueio de avanco sem gate.
- [ ] Testar retorno com motivo.

## Sprint 4 - Reunioes

- [ ] Implementar reuniao divergente.
- [ ] Implementar reuniao convergente.
- [ ] Implementar reuniao transversal.
- [ ] Registrar decisoes e alternativas.
- [ ] Testar reuniao vinculada a flow.

## Sprint 5 - Evidencia e veredito

- [ ] Implementar `evidence_attach`.
- [ ] Implementar `verdict_record`.
- [ ] Implementar `checklist_render`.
- [ ] Implementar `hygiene_scan`.
- [ ] Testar veredito `pronto_com_ressalvas`.

## Sprint 6 - Integracao real

- [ ] Configurar cliente MCP alvo.
- [ ] Rodar flow PPIRTV completo de exemplo.
- [ ] Registrar evidencias.
- [ ] Revisar seguranca e paths.
- [ ] Atualizar docs finais.
