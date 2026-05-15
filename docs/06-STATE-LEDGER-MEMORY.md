# 06 - State, Ledger and Memory

## 1. Principio

O harness deve lembrar por arquivo auditavel, nao por intuicao do modelo.

## 2. Camadas

| Camada | Conteudo | Mutabilidade |
| --- | --- | --- |
| Flow state | Estado atual de cada flow | Atualizavel |
| Ledger | Eventos append-only | Nao editar manualmente |
| Meetings | Atas estruturadas | Atualizavel ate veredito |
| Evidence | Links e artefatos | Append-only preferencial |
| Templates | Gates e prompts padrao | Versionado |
| Parking lot | Achados vivos e residuos | Append-only preferencial |
| Gold mining | Pontos cegos e pepitas | Append-only preferencial |

## 3. Estrutura sugerida

```text
.ppirtv/
  flows/
    flow_20260515_001.json
  meetings/
    mtg_20260515_001.json
  evidence/
    build-log.txt
  ledger.ndjson
  templates/
    gates.json
    meetings.json
```

Campos `parking_lot` e `gold_mining` vivem dentro dos JSONs de flow, meeting,
evidence e verdict quando aplicavel. O ledger registra os mesmos dados como
evento auditavel.

## 4. Evento de ledger

```json
{
  "event_id": "evt_...",
  "flow_id": "flow_...",
  "type": "phase_advanced",
  "timestamp": "2026-05-15T10:00:00-03:00",
  "actor": "codex",
  "data": {
    "from": "planejamento",
    "to": "implementacao"
  }
}
```

## 5. Politica de memoria

- Memoria viva e o flow atual.
- Ledger e historico, nao fila de trabalho.
- Handoff deve vencer ledger para proximo passo operacional.
- Memoria global, se existir, deve ser ponteiro curto, nao copia de contrato.
