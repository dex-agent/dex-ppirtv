# PLAN - Implementacao do PPIRTV MCP Harness

## Fase 0 - Fundacao documental

Objetivo: fechar linguagem, escopo e arquitetura.

- Criar `CONTEXT.md` com glossario.
- Criar `SPEC.md`, `PLAN.md`, `TASKS.md`, `SPRINTS.md`.
- Criar guias numerados em `docs/`.
- Registrar ADRs iniciais.
- Registrar referencias MCP oficiais.

## Fase 1 - Skeleton MCP

Objetivo: criar servidor MCP minimo por `stdio`.

- [x] Escolher stack TypeScript + Node + SDK MCP.
- [x] Criar comando local de execucao.
- [x] Implementar servidor MCP `stdio`.
- [x] Expor `tools/list`, `resources/list` e `prompts/list`.
- [x] Criar teste smoke.

## Fase 2 - Modelo de flow e ledger

Objetivo: persistir estado auditavel.

- [x] Criar schema de `Flow`.
- [x] Criar schema de evento de ledger.
- [x] Implementar `flow_create`, `flow_status`, `flow_archive`.
- [x] Salvar dados em `.ppirtv/`.

## Fase 3 - Gates PPIRTV

Objetivo: tornar o fluxo controlado.

- [x] Implementar `gate_check`.
- [x] Implementar `flow_advance`.
- [x] Implementar `flow_return`.
- [x] Validar bloqueios por gate incompleto.

## Fase 4 - Reunioes

Objetivo: transformar divergencia, convergencia e transversalidade em rotinas.

- [x] Implementar `meeting_open`.
- [x] Implementar `meeting_record`.
- [x] Criar templates de perguntas.
- [x] Vincular decisoes ao flow.

## Fase 5 - Evidencia, veredito e higiene

Objetivo: impedir conclusoes sem prova.

- [x] Implementar `evidence_attach`.
- [x] Implementar `verdict_record`.
- [x] Implementar `hygiene_scan`.
- [x] Implementar checklist visual.

## Fase 6 - Integracao e hardening

Objetivo: preparar uso real.

- [x] Testar com cliente MCP `stdio`.
- [x] Validar erros principais por schemas e respostas estruturadas.
- [x] Documentar instalacao.
- [x] Criar exemplos de uso via flow de teste.
- [x] Revisar seguranca basica de secrets em ledger.

## Fase 7 - Release inicial

Objetivo: publicar pacote minimo confiavel.

- Congelar contrato de tools.
- Atualizar docs.
- Rodar suite de testes.
- Criar release.

## Fase 8 - Refinamento Fernanda no MCP

Objetivo: tornar o harness mais legivel e fiel ao fluxo visual dinamico sem
quebrar o contrato que ja funcionou em Codex e DeepSeek.

- [x] Adicionar aliases pt-BR em respostas de gate, checklist, reuniao, evidencia,
  veredito e higiene.
- [x] Adicionar envelope `display` com fase, emoji, owner, cooperadores, checklist
  visual, acionavel direto e creditos ativos.
- [x] Manter campos tecnicos existentes para compatibilidade.
- [x] Adicionar testes garantindo que campos antigos continuam presentes.
- [x] Adicionar testes MCP simulando saidas humanas menos confusas.
- [x] Documentar exemplos de uso humano e tecnico.

## Fase 9 - Principios e memoria recuperavel

Objetivo: transformar principios em contrato operacional editavel sem quebrar o
MCP existente.

- [x] Criar `principles/PRINCIPLES.md`.
- [x] Criar contrato operacional editavel em `principles/`.
- [x] Registrar ADR dos principios editaveis.
- [x] Expor principios em `checklist_render` sem remover itens atuais.
- [x] Aplicar checagens aditivas em `hygiene_scan`.
- [x] Orientar prompts a consultar L1/L2/L3 antes de executar.
- [x] Testar compatibilidade, checklist, higiene e prompts.

## Fase 10 - Localizacao explicita de principios

Objetivo: permitir que o harness rode em projetos diferentes sem perder o
contrato operacional de principios.

Contrato decidido: `PPIRTV_PRINCIPLES_PATH` explicito vence; sem env var, usar
`cwd/principles/operational-contract.json`; sem contrato local, usar fallback do
proprio harness e tornar esse fallback visivel em `hygiene_scan`.

- [x] Implementar `PPIRTV_PRINCIPLES_PATH`.
- [x] Manter contrato local por `cwd/principles/operational-contract.json`.
- [x] Adicionar fallback para contrato do proprio `dex-PPIRTV`.
- [x] Tornar o fallback visivel em `hygiene_scan`.
- [x] Testar env var, contrato local e fallback.
