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

### TST-007 - Compatibilidade e legibilidade Fernanda

Resultado esperado:

- campos antigos `missing`, `next`, `back_to`, `parking_lot` e `gold_mining`
  continuam presentes quando aplicavel;
- aliases `faltando`, `proximo`, `voltar_para`, `estacionamento` e `garimpo`
  aparecem junto dos campos tecnicos;
- `checklist_render` retorna `display.checklist_visual`;
- `suggested_cooperation` tem `material=false` por padrao;
- `display.active_credits` nao finge execucao sem contribuicao material.

### TST-008 - Principios operacionais editaveis

Resultado esperado:

- `principles/PRINCIPLES.md` e contrato operacional existem;
- `checklist_render` retorna `operational_principles`;
- `display.checklist_visual` inclui itens de principios sem remover gates;
- prompts incluem orientacao derivada do contrato editavel;
- `hygiene_scan` retorna achados de memoria, principios ou seguranca quando
  detectar violacao.

## 3. Evidencias esperadas

- logs de teste;
- snapshots de JSON;
- flow de exemplo;
- nota de veredito.

## 4. Evidencia executada no MVP

Comando:

```bash
npm run check
```

Resultado:

- 2 arquivos de teste passaram.
- 17 testes passaram.
- Cobertura executada: inicializacao MCP, listagem de tools/resources/prompts,
  `flow_create`, persistencia/restart, gate bloqueando, avanco valido, retorno,
  reunioes divergente/convergente/transversal, evidencia, veredito,
  `hygiene_scan`, gate persistido pelo runbook, estacionamento/garimpo em
  reuniao, aliases pt-BR, checklist visual, principios operacionais, prompts
  com orientacao L1/L2/L3, deteccao de L2 sem L1, deteccao de chave fake com
  cara de secret sem expor valor, creditos materiais e flow E2E.
