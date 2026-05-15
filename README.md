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
Sprint 7 implementado: respostas agora incluem aliases pt-BR e camada
`display` para a Fernanda, preservando os campos tecnicos existentes.
Sprint 8 em andamento: principios operacionais e memoria L1/L2/L3 agora vivem
em arquivos editaveis dentro de `principles/` e alimentam checklist, higiene e
prompts sem remover campos existentes.

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

O processo MCP deve ser iniciado com `cwd` na raiz deste repositorio. Essa raiz
e usada para localizar `.ppirtv/` e `principles/operational-contract.json`.

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

## Saidas humanas e compatibilidade

O contrato tecnico antigo continua valido:

- `missing`
- `next`
- `back_to`
- `parking_lot`
- `gold_mining`

As respostas tambem podem trazer:

- `aliases.faltando`, `aliases.proximo`, `aliases.voltar_para`
- `aliases.estacionamento`, `aliases.garimpo`
- `display.phase_label`, `display.phase_emoji`
- `display.owner`, `display.owner_emoji`
- `display.cooperators`
- `display.active_credits`
- `display.direct_action`
- `display.checklist_visual`
- `suggested_cooperation`

`suggested_cooperation` e apenas sugestao de lente; nao significa que o
especialista foi executado. `active_credits` so aparece quando houver
contribuicao material registrada.

## Principios e memoria recuperavel

- Fonte humana: `principles/PRINCIPLES.md`.
- Contrato operacional editavel: `principles/operational-contract.json`.
- L1: `lembranca.md` para gatilhos curtos.
- L2: `memoria.md` para ancoras operacionais.
- L3: `conhecimento/` para detalhe sob demanda.

`checklist_render` mantem `items` com os gates da fase e adiciona
`operational_principles`. `hygiene_scan` pode apontar achados de principios,
memoria e seguranca sem expor valores sensiveis.

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
