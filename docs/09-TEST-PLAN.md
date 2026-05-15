# 09 - Test Plan

## 1. Tipos de teste

| Tipo | Objetivo |
| --- | --- |
| Unitario | Validar engines e schemas |
| Integracao MCP | Validar tools/resources/prompts |
| Golden files | Garantir saidas estaveis |
| Regressao | Evitar quebrar fluxo PPIRTV |
| E2E | Rodar um flow completo |

## 2. Cenarios obrigatorios

### TST-001 - Inicializacao MCP

Resultado esperado:

- servidor inicia via `stdio`;
- cliente lista tools;
- ordem de tools e deterministica.

### TST-002 - Flow explicito

Resultado esperado:

- `flow_create` retorna `flow_id`;
- `flow_status` exige `flow_id`;
- estado persiste.

### TST-003 - Gate bloqueando

Resultado esperado:

- `flow_advance` sem criterio retorna `blocked`;
- resposta inclui `missing`, `next` e `back_to`.

### TST-004 - Reuniao

Resultado esperado:

- reuniao divergente registra alternativas;
- reuniao convergente registra decisao;
- reuniao transversal registra areas afetadas.

### TST-005 - Veredito

Resultado esperado:

- veredito sem evidencia vira `pronto_com_ressalvas` ou `nao_pronto`;
- risco residual aparece na resposta.

### TST-006 - Casa limpa

Resultado esperado:

- `hygiene_scan` encontra paths fixos, docs contraditorias ou tasks sem evidencia.

## 3. Evidencias esperadas

- logs de teste;
- snapshots de JSON;
- flow de exemplo;
- nota de veredito.

