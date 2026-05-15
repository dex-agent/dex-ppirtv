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

### `hygiene_scan`

Primeiro conjunto de checagens:

- docs contraditorias;
- tasks marcadas sem evidencia;
- paths fixos;
- arquivos temporarios;
- dependencias orfas;
- decisoes sem ADR quando necessario.

## 3. Resources detalhados

| URI | Descricao |
| --- | --- |
| `ppirtv://flows` | Lista de flows |
| `ppirtv://flow/{id}` | Estado completo |
| `ppirtv://flow/{id}/checklist` | Checklist visual |
| `ppirtv://flow/{id}/meetings` | Reunioes vinculadas |
| `ppirtv://templates/gates` | Gates padrao |
| `ppirtv://templates/meetings` | Templates de reuniao |

## 4. Prompts detalhados

| Prompt | Argumentos | Saida esperada |
| --- | --- | --- |
| `start-ppirtv-flow` | `goal`, `context` | Flow inicial e perguntas minimas |
| `run-phase-gate` | `flow_id` | Gate aplicado |
| `clean-house-review` | `flow_id` | Checklist de higiene |
| `final-verdict` | `flow_id` | Veredito com risco residual |

