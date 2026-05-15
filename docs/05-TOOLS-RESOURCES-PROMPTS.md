# 05 - Tools, Resources and Prompts

## 1. Separacao de responsabilidades

| Tipo MCP | Papel no harness |
| --- | --- |
| Tools | Executam transicoes e registros |
| Resources | Exibem estado, templates e historico |
| Prompts | Guiam interacoes e reunioes |

## 2. Tools detalhadas

### `flow_create`

Entrada:

```json
{
  "goal": "string",
  "scope": {
    "in": ["string"],
    "out": ["string"]
  }
}
```

Saida:

```json
{
  "flow_id": "flow_20260515_001",
  "phase": "pensamentos",
  "status": "active"
}
```

### `flow_advance`

Entrada:

```json
{
  "flow_id": "flow_20260515_001",
  "evidence": ["artifact://..."]
}
```

Saida aprovada:

```json
{
  "advanced": true,
  "from": "planejamento",
  "to": "implementacao"
}
```

Saida bloqueada:

```json
{
  "advanced": false,
  "status": "blocked",
  "missing": ["criterio_de_pronto"]
}
```

### `meeting_open`

Tipos aceitos:

- `divergent`
- `convergent`
- `transversal`

### Campos transversais de estacionamento e garimpo

As tools `meeting_record`, `evidence_attach` e `verdict_record` aceitam:

```json
{
  "parking_lot": ["achados vivos fora do foco imediato"],
  "gold_mining": ["pontos cegos, pepitas, armadilhas ou heuristicas"]
}
```

Esses campos nao criam novo fluxo paralelo. Eles alimentam o proprio flow,
ficam no ledger e servem como base para especialistas, revisao, higiene e
veredito.

### Aliases e camada Fernanda

As respostas preservam os campos tecnicos e adicionam nomes humanos quando
aplicavel:

```json
{
  "missing": ["tasks"],
  "next": "complete_gate_planejamento",
  "back_to": "pensamentos",
  "aliases": {
    "faltando": ["tasks"],
    "proximo": "complete_gate_planejamento",
    "voltar_para": "pensamentos",
    "estacionamento": [],
    "garimpo": []
  },
  "display": {
    "phase_label": "Planejamento",
    "phase_emoji": "🗂️",
    "owner": "Paula Planeja",
    "owner_emoji": "📋",
    "cooperators": [],
    "active_credits": [],
    "direct_action": {
      "available": true,
      "action": "Completar: tasks"
    }
  },
  "suggested_cooperation": [
    {
      "name": "Paula Planeja",
      "reason": "fechar escopo, tarefas, evidencias esperadas e criterio de pronto",
      "material": false
    }
  ]
}
```

`suggested_cooperation` nao significa execucao do especialista. Creditos ativos
so aparecem quando `active_credits` foi registrado por tool ou artefato.

### `hygiene_scan`

Primeiro conjunto de checagens:

- docs contraditorias;
- tasks marcadas sem evidencia;
- paths fixos;
- arquivos temporarios;
- dependencias orfas;
- decisoes sem ADR quando necessario.
- principios sem fonte editavel;
- memoria L1/L2/L3 documentada sem gatilhos recuperaveis;
- valores com cara de segredo em configuracoes, sem expor o valor.

### Principios operacionais

O contrato operacional deriva de `principles/PRINCIPLES.md` e pode ajustar
labels, severidades, orientacoes de prompt e checklist sem alterar codigo. A
localizacao do arquivo e resolvida em runtime.

Status: a ordem abaixo esta implementada e coberta por teste de regressao.

Ordem de localizacao:

1. `PPIRTV_PRINCIPLES_PATH`, quando configurado, com precedencia sobre qualquer
   contrato local.
2. `principles/operational-contract.json` no `cwd` do projeto atual.
3. fallback do proprio `dex-PPIRTV`.

Quando o fallback do harness for usado, `hygiene_scan` retorna um achado
informativo em `principles` para deixar a dependencia visivel.

`checklist_render` mantem `items` com os gates da fase atual e adiciona
`operational_principles` para os principios aplicaveis. A camada
`display.checklist_visual` pode renderizar gates e principios juntos.

## 2.1 Tools implementadas no MVP

`flow_create`, `flow_status`, `flow_advance`, `flow_return`, `gate_check`,
`meeting_open`, `meeting_record`, `evidence_attach`, `checklist_render`,
`verdict_record`, `hygiene_scan` e `flow_archive`.

## 2.2 Refinamento Fernanda implementado

`gate_check`, `flow_advance`, `flow_status`, `meeting_open`,
`meeting_record`, `evidence_attach`, `checklist_render`, `verdict_record`,
`hygiene_scan` e `flow_archive` podem retornar aliases e `display`.

## 3. Resources detalhados

| URI | Descricao |
| --- | --- |
| `ppirtv://flows` | Lista de flows |
| `ppirtv://flow/{flow_id}` | Estado completo |
| `ppirtv://flow/{flow_id}/checklist` | Checklist visual |
| `ppirtv://flow/{flow_id}/ledger` | Ledger filtrado por flow |
| `ppirtv://flow/{flow_id}/meetings` | Reunioes vinculadas |
| `ppirtv://templates/gates` | Gates padrao |
| `ppirtv://templates/meetings` | Templates de reuniao |
| `ppirtv://reference/mcp` | Referencias MCP adotadas |

## 4. Prompts detalhados

| Prompt | Argumentos | Saida esperada |
| --- | --- | --- |
| `start-ppirtv-flow` | `goal`, `context` | Flow inicial e perguntas minimas |
| `run-phase-gate` | `flow_id` | Gate aplicado |
| `clean-house-review` | `flow_id` | Checklist de higiene |
| `final-verdict` | `flow_id` | Veredito com risco residual |
| `open-divergent-meeting` | `flow_id` | Roteiro divergente |
| `open-convergent-meeting` | `flow_id` | Roteiro convergente |
| `open-transversal-meeting` | `flow_id` | Roteiro transversal |

Prompts devem lembrar o cliente de consultar fonte viva, L1, L2, skills e docs
antes da acao tecnica, preservando `flow_id` explicito.
