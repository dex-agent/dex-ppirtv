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

- Escolher stack.
- Criar comando local de execucao.
- Implementar handshake/capabilities.
- Expor `tools/list`, `resources/list` e `prompts/list`.
- Criar teste smoke.

## Fase 2 - Modelo de flow e ledger

Objetivo: persistir estado auditavel.

- Criar schema de `Flow`.
- Criar schema de evento de ledger.
- Implementar `flow_create`, `flow_status`, `flow_archive`.
- Salvar dados em `artifacts/` ou diretorio configuravel.

## Fase 3 - Gates PPIRTV

Objetivo: tornar o fluxo controlado.

- Implementar `gate_check`.
- Implementar `flow_advance`.
- Implementar `flow_return`.
- Validar bloqueios por gate incompleto.

## Fase 4 - Reunioes

Objetivo: transformar divergencia, convergencia e transversalidade em rotinas.

- Implementar `meeting_open`.
- Implementar `meeting_record`.
- Criar templates de perguntas.
- Vincular decisoes ao flow.

## Fase 5 - Evidencia, veredito e higiene

Objetivo: impedir conclusoes sem prova.

- Implementar `evidence_attach`.
- Implementar `verdict_record`.
- Implementar `hygiene_scan`.
- Implementar checklist visual.

## Fase 6 - Integracao e hardening

Objetivo: preparar uso real.

- Testar com cliente MCP alvo.
- Validar erros JSON-RPC.
- Documentar instalacao.
- Criar exemplos de uso.
- Revisar seguranca.

## Fase 7 - Release inicial

Objetivo: publicar pacote minimo confiavel.

- Congelar contrato de tools.
- Atualizar docs.
- Rodar suite de testes.
- Criar release.

