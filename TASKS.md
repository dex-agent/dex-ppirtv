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

## Sprint 7 - Refinamento Fernanda e legibilidade MCP

- [x] Preservar `missing`, `next`, `back_to`, `parking_lot` e `gold_mining` sem renomear nem remover.
- [x] Adicionar aliases pt-BR: `faltando`, `proximo`, `voltar_para`, `estacionamento`, `garimpo`.
- [x] Adicionar `display.phase_label`, `display.phase_emoji`, `display.owner` e `display.owner_emoji`.
- [x] Adicionar `display.cooperators` com `name`, `reason` e `material`.
- [x] Adicionar `display.active_credits` para contribuicoes materiais.
- [x] Adicionar `display.direct_action` para achados pequenos e claros.
- [x] Expandir `checklist_render` com `display.checklist_visual` e andamento por fase.
- [x] Adicionar `suggested_cooperation` deterministico, sem fingir que especialista foi executado.
- [x] Atualizar prompts para pedir termos humanos por padrao e manter `flow_id` explicito.
- [x] Criar testes de compatibilidade para garantir que clientes antigos continuam funcionando.
- [x] Criar testes de legibilidade para gate bloqueado, checklist e veredito.
- [x] Atualizar README/REFERENCE/docs com exemplos de uso humano e tecnico.

## Sprint 8 - Principios, memoria L1/L2/L3 e contrato editavel

- [x] Criar `principles/PRINCIPLES.md` como fonte humana editavel.
- [x] Criar ADR para contrato operacional editavel.
- [x] Criar contrato operacional lido em runtime.
- [x] Atualizar `hygiene_scan` com achados de principios, memoria e secrets.
- [x] Atualizar `checklist_render` com checklist de principios sem remover itens atuais.
- [x] Atualizar prompts com orientacao L1/L2/L3 e inicio pelo contexto vivo.
- [x] Testar que campos antigos continuam presentes.
- [x] Testar que principios aparecem no checklist.
- [x] Testar que prompts carregam orientacao editavel.
- [x] Testar `hygiene_scan` detectando L2 sem L1.
- [x] Testar `hygiene_scan` detectando chave fake com cara de secret sem expor valor.
- [x] Rodar `npm run check`.
- [x] Rodar `git diff --check`.

## Sprint 9 - Localizacao de contrato de principios

Contrato decidido: `PPIRTV_PRINCIPLES_PATH` explicito vence; sem env var, usar
`cwd/principles/operational-contract.json`; sem contrato local, usar fallback do
proprio harness. `hygiene_scan` deve avisar quando esse fallback for usado.

- [x] Implementar `PPIRTV_PRINCIPLES_PATH`.
- [x] Preservar contrato local por `cwd/principles/operational-contract.json`.
- [x] Usar fallback do proprio harness quando o projeto nao tiver contrato local.
- [x] Fazer `hygiene_scan` avisar quando usar fallback.
- [x] Testar contrato via env var.
- [x] Testar contrato local.
- [x] Testar fallback do harness.
- [x] Testar checklist com fallback nao vazio.
- [x] Testar precedencia: env var explicita vence contrato local existente.
- [x] Registrar evidencia da Sprint 9 apos os testes passarem.
- [x] Rodar `npm run check`.
- [x] Rodar `git diff --check`.
