# dex-PPIRTV

Repositorio de especificacao para transformar o metodo **PPIRTV** em um
**harness MCP**: um trilho operacional que guia trabalho tecnico por fases,
gates, retornos, reunioes e evidencias.

## Objetivo

Criar um servidor MCP que ajude clientes/agentes a conduzir ciclos de trabalho
com este fluxo:

```text
P -> P -> I -> R -> T -> V

Pensamentos -> Planejamento -> Implementacao -> Revisao -> Teste -> Validacao
```

O harness nao deve substituir o julgamento tecnico. Ele deve tornar o processo
mais visivel, testavel e menos sujeito a entusiasmo sem evidencia.

## Decisoes iniciais

- O MVP sera um servidor MCP local, preferencialmente `stdio`.
- O estado de fluxo sera explicito por `flow_id`.
- Tools executam transicoes e gates.
- Resources expõem estado, trilhas, templates e historico auditavel.
- Prompts oferecem roteiros de uso controlados pelo usuario.
- Reunioes divergentes, convergentes e transversais serao modos de trabalho
  acionaveis, nao conversa solta.

## Mapa dos documentos

| Documento | Uso |
| --- | --- |
| [CONTEXT.md](CONTEXT.md) | Glossario do dominio PPIRTV |
| [SPEC.md](SPEC.md) | Especificacao funcional e tecnica |
| [PLAN.md](PLAN.md) | Plano por fases |
| [TASKS.md](TASKS.md) | Backlog executavel |
| [SPRINTS.md](SPRINTS.md) | Sprints planejados |
| [REFERENCE.md](REFERENCE.md) | Fontes MCP, decisoes e links |
| [docs/00-INDEX.md](docs/00-INDEX.md) | Ordem de leitura dos guias |

## Status

MVP implementado como servidor MCP local por `stdio`.

## Stack

- TypeScript + Node.js 22.
- `@modelcontextprotocol/sdk` para o servidor MCP.
- Vitest para testes de engine e integracao MCP.
- Persistencia local em arquivos JSON/NDJSON dentro de `.ppirtv/`.

Essa stack foi escolhida porque o SDK TypeScript MCP e maduro para `stdio`,
reduz codigo de protocolo escrito a mao e ainda permite manter as regras PPIRTV
em engines testaveis fora do transporte.

## Como rodar

```bash
npm install
npm run build
npm start
```

Para desenvolvimento:

```bash
npm run dev
```

Para verificacao:

```bash
npm run check
```

## Tools implementadas

- `flow_create`
- `flow_status`
- `flow_advance`
- `flow_return`
- `gate_check`
- `meeting_open`
- `meeting_record`
- `evidence_attach`
- `checklist_render`
- `verdict_record`
- `hygiene_scan`
- `flow_archive`

## Resources implementados

- `ppirtv://flows`
- `ppirtv://flow/{flow_id}`
- `ppirtv://flow/{flow_id}/checklist`
- `ppirtv://flow/{flow_id}/ledger`
- `ppirtv://flow/{flow_id}/meetings`
- `ppirtv://templates/gates`
- `ppirtv://templates/meetings`
- `ppirtv://reference/mcp`

## Prompts implementados

- `start-ppirtv-flow`
- `run-phase-gate`
- `open-divergent-meeting`
- `open-convergent-meeting`
- `open-transversal-meeting`
- `clean-house-review`
- `final-verdict`
