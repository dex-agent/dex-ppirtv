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

### `hygiene_scan`

Primeiro conjunto de checagens:

- docs contraditorias;
- tasks marcadas sem evidencia;
- paths fixos;
- arquivos temporarios;
- dependencias orfas;
- decisoes sem ADR quando necessario.

## 2.1 Tools implementadas no MVP

`flow_create`, `flow_status`, `flow_advance`, `flow_return`, `gate_check`,
`meeting_open`, `meeting_record`, `evidence_attach`, `checklist_render`,
`verdict_record`, `hygiene_scan` e `flow_archive`.

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
