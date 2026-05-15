# SPEC - PPIRTV MCP Harness

## 1. Visao geral

O projeto `dex-PPIRTV` define um harness MCP para conduzir trabalho tecnico pelo
fluxo PPIRTV. O harness deve oferecer ferramentas, recursos e prompts para criar,
avancar, revisar, testar e validar ciclos de trabalho com evidencia.

## 2. Objetivo do produto

Criar um servidor MCP local que permita a um cliente/agente:

- iniciar um flow com objetivo claro;
- manter a fase atual visivel;
- aplicar gates antes de avancar;
- registrar retornos controlados;
- abrir reunioes divergentes, convergentes e transversais;
- produzir evidencias e vereditos;
- recuperar o estado do trabalho sem depender de memoria solta.

## 3. Requisitos funcionais

| ID | Requisito | Prioridade |
| --- | --- | --- |
| REQ-001 | Criar um novo flow PPIRTV com objetivo, dono opcional e escopo | Alta |
| REQ-002 | Consultar fase atual, historico, riscos, decisoes e proximos gates | Alta |
| REQ-003 | Avancar fase somente quando gate minimo estiver satisfeito | Alta |
| REQ-004 | Registrar retorno para fase anterior com motivo e evidencia | Alta |
| REQ-005 | Registrar reuniao divergente com perguntas, alternativas e riscos | Alta |
| REQ-006 | Registrar reuniao convergente com decisao, criterio e fora do escopo | Alta |
| REQ-007 | Registrar reuniao transversal com areas afetadas e trade-offs | Media |
| REQ-008 | Gerar checklist visual do flow atual | Alta |
| REQ-009 | Emitir veredito estruturado: pronto, pronto com ressalvas, nao pronto ou bloqueado | Alta |
| REQ-010 | Expor templates de prompts PPIRTV por `prompts/list` e `prompts/get` | Media |
| REQ-011 | Expor resources para estado e historico auditavel | Alta |
| REQ-012 | Salvar ledger local em formato legivel por humanos e maquinas | Alta |
| REQ-013 | Permitir replay/resumo de um flow encerrado | Media |
| REQ-014 | Aplicar regra "barata nunca esta sozinha" em achados de bug/residuo | Media |
| REQ-015 | Separar fatos confirmados, inferencias e lacunas | Alta |
| REQ-016 | Expor aliases em portugues para campos tecnicos de gate e residuos | Alta |
| REQ-017 | Expor camada visual da Fernanda com emojis de fase e especialistas | Alta |
| REQ-018 | Registrar cooperadores e `Creditos Ativos` quando houver contribuicao material | Alta |
| REQ-019 | Sugerir cooperacao especializada quando reduzir risco, ambiguidade ou retrabalho | Media |
| REQ-020 | Expor `Acionavel direto` para achados pequenos, claros e dentro do objetivo atual | Media |
| REQ-021 | Ler principios operacionais de arquivo editavel em `principles/` | Alta |
| REQ-022 | Aplicar memoria L1/L2/L3 como contrato de recuperacao em checklist, higiene e prompts | Media |
| REQ-023 | Alertar sobre secrets em configuracoes sem registrar valores sensiveis | Alta |
| REQ-024 | Resolver contrato de principios por `PPIRTV_PRINCIPLES_PATH`, contrato local ou fallback visivel do harness | Alta |

## 4. Requisitos nao funcionais

| ID | Requisito | Criterio |
| --- | --- | --- |
| NFR-001 | Auditabilidade | Toda transicao deve registrar data, ator, motivo e evidencia opcional |
| NFR-002 | Baixo acoplamento | O harness nao deve depender de um cliente MCP especifico |
| NFR-003 | Estado explicito | Nenhuma tool deve depender de estado implicito por conexao |
| NFR-004 | Ordem deterministica | Listas de tools, prompts e resources devem ser estaveis |
| NFR-005 | Seguranca | Nenhuma tool destrutiva sem confirmacao ou contrato claro |
| NFR-006 | Portabilidade | MVP deve rodar localmente via `stdio` |
| NFR-007 | Casa limpa | Docs, ledger, tarefas e decisoes devem ter destinos definidos |
| NFR-008 | Compatibilidade | Campos existentes nao devem ser removidos nem renomeados em refinamento fino |
| NFR-009 | Legibilidade humana | Saidas podem manter campos tecnicos, mas devem oferecer aliases pt-BR quando o cliente exibir para humano |
| NFR-010 | Principios editaveis | Texto e labels de principios devem poder mudar sem recompilar o harness |

## 5. Arquitetura alvo

```text
MCP Client
   |
   | JSON-RPC over stdio
   v
PPIRTV MCP Server
   |
   +-- tools: transicoes, gates, reunioes, vereditos
   +-- resources: estado, ledger, templates, checklists
   +-- prompts: roteiros PPIRTV reutilizaveis
   |
   v
Local Project Store
   +-- flows/
   +-- meetings/
   +-- evidence/
   +-- ledger.ndjson
```

## 6. Modelo de flow

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `flow_id` | string | Identificador explicito retornado ao criar flow |
| `goal` | string | Objetivo concreto do ciclo |
| `phase` | enum | `pensamentos`, `planejamento`, `implementacao`, `revisao`, `teste`, `validacao` |
| `status` | enum | `active`, `blocked`, `complete`, `archived` |
| `scope` | object | Dentro e fora do escopo |
| `gates` | array | Gates esperados por fase |
| `risks` | array | Riscos abertos |
| `decisions` | array | Decisoes tomadas |
| `parking_lot` | array | Achados vivos, residuos e pendencias fora do foco imediato |
| `gold_mining` | array | Pontos cegos, pepitas, armadilhas e heuristicas garimpadas |
| `evidence` | array | Evidencias vinculadas |
| `history` | array | Eventos de transicao |

## 6.1 Estacionamento e garimpo

O MVP nao adiciona tools separadas para estacionamento ou garimpo. Para manter o
contrato enxuto, `meeting_record`, `evidence_attach` e `verdict_record` aceitam
campos opcionais `parking_lot` e `gold_mining`.

Esses campos persistem no flow e no ledger. Eles servem como base para Chato,
Akita Dev Raiz, Tereza Testa, Vera Veredito e demais especialistas sem depender
de memoria solta da conversa.

## 6.2 Camada Fernanda de apresentacao

Refinamento implementado: adicionar uma camada `display` e aliases em portugues nas
respostas, sem remover campos tecnicos existentes.

Exemplo de envelope esperado:

```json
{
  "phase": "planejamento",
  "missing": ["tasks"],
  "next": "complete_gate_planejamento",
  "back_to": "pensamentos",
  "aliases": {
    "fase": "planejamento",
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
    "cooperators": [
      {
        "name": "Chato",
        "reason": "pressionar riscos do gate",
        "material": true
      }
    ],
    "active_credits": [
      "Chato encontrou gate incompleto antes de falso pronto"
    ],
    "direct_action": {
      "available": true,
      "action": "preencher tasks, expected_evidence e done_criteria"
    },
    "checklist_visual": [
      {
        "label": "Tarefas ordenadas",
        "checked": false
      }
    ]
  }
}
```

Regra de compatibilidade:

- `missing`, `next`, `back_to`, `parking_lot` e `gold_mining` continuam
  existindo.
- aliases `faltando`, `proximo`, `voltar_para`, `estacionamento` e `garimpo`
  entram como camada adicional.
- `display` e `active_credits` devem ser opcionais e deterministas.
- nenhuma indicacao automatica de especialista deve fingir execucao; ela deve
  declarar `reason` e `material`.

## 6.3 Principios operacionais editaveis

Os principios do `dex-PPIRTV` vivem em `principles/PRINCIPLES.md`. O contrato
operacional derivado vive em `principles/operational-contract.json` e pode ser
editado sem alterar codigo quando a mudanca for textual, de label, severidade ou
orientacao de prompt.

Status: a ordem abaixo esta implementada e coberta por teste de regressao.

Ordem de resolucao do contrato operacional:

1. `PPIRTV_PRINCIPLES_PATH`, quando configurado, vence tudo e deve apontar para
   um arquivo JSON de contrato operacional.
2. Sem env var, tentar `principles/operational-contract.json` no `cwd` do
   projeto atual.
3. Sem contrato local, usar fallback do proprio `dex-PPIRTV`.
4. Quando o fallback do harness for usado, `hygiene_scan` deve retornar achado
   informativo para nao fingir que o projeto atual possui contrato local.

Primeira camada contratada:

- "barata nunca esta sozinha" orienta higiene e revisao ao redor de achados.
- "memoria sem lembranca e entulho inutil" define memoria como L1 -> L2 -> L3.
- "ouro garimpado se guarda" conecta `gold_mining` a documentacao e handoff.
- "casa limpa" reforca remocao de residuos e secrets fora de ledger.
- "comecar pelo inicio" orienta prompts a consultar fontes vivas antes de
  executar.

Estrutura de memoria:

| Camada | Papel | Arquivo |
| --- | --- | --- |
| L1 | Gatilhos curtos | `lembranca.md` |
| L2 | Ancoras operacionais | `memoria.md` |
| L3 | Conhecimento sob demanda | `conhecimento/` |

`hygiene_scan` pode retornar achados com categoria `principles`, `memory` ou
`security`. Esses achados nao removem nem renomeiam categorias existentes.

Criterios de aceite especificos para REQ-024:

- env var explicita vence contrato local;
- contrato local em `cwd/principles/operational-contract.json` e usado quando a
  env var nao existe;
- fallback do harness mantem `checklist_render` nao vazio quando o projeto nao
  possui contrato local;
- `hygiene_scan` inclui achado informativo em `principles` quando o fallback e
  usado.

## 7. Tools MCP propostas

| Tool | Objetivo |
| --- | --- |
| `flow_create` | Criar flow PPIRTV |
| `flow_status` | Retornar estado resumido |
| `flow_advance` | Tentar avancar fase com gates |
| `flow_return` | Retornar fase com motivo |
| `gate_check` | Avaliar gate especifico |
| `meeting_open` | Abrir reuniao divergente/convergente/transversal |
| `meeting_record` | Registrar resultado de reuniao |
| `checklist_render` | Gerar checklist visual |
| `evidence_attach` | Vincular evidencia |
| `verdict_record` | Registrar veredito |
| `hygiene_scan` | Procurar residuos e inconsistencias conhecidas |
| `flow_archive` | Encerrar e arquivar flow |

## 8. Resources MCP implementadas

| Resource | Conteudo |
| --- | --- |
| `ppirtv://flows` | Lista de flows |
| `ppirtv://flow/{flow_id}` | Estado completo do flow |
| `ppirtv://flow/{flow_id}/checklist` | Checklist visual atual |
| `ppirtv://flow/{flow_id}/ledger` | Eventos auditaveis |
| `ppirtv://flow/{flow_id}/meetings` | Reunioes vinculadas ao flow |
| `ppirtv://templates/gates` | Gates padrao por fase |
| `ppirtv://templates/meetings` | Estruturas de reuniao |
| `ppirtv://reference/mcp` | Referencias MCP adotadas |

## 9. Prompts MCP implementadas

| Prompt | Uso |
| --- | --- |
| `start-ppirtv-flow` | Iniciar trabalho novo com pergunta minima |
| `run-phase-gate` | Aplicar gate da fase atual |
| `open-divergent-meeting` | Levantar riscos e alternativas |
| `open-convergent-meeting` | Fechar decisao e recorte |
| `open-transversal-meeting` | Cruzar areas e impactos |
| `final-verdict` | Preparar veredito com evidencia |
| `clean-house-review` | Revisar casa limpa antes de concluir |

## 10. Regras de gates

| Fase | Gate minimo para avancar |
| --- | --- |
| Pensamentos | Objetivo, risco principal e incertezas nomeadas |
| Planejamento | Escopo, fora do escopo, tarefas e criterio de pronto definidos |
| Implementacao | Mudanca executada ou bloqueio objetivo registrado |
| Revisao | Diferenças revisadas, bugs ao redor procurados |
| Teste | Evidencia real ou limite de teste documentado |
| Validacao | Veredito, riscos residuais e proximo passo registrados |

## 11. Fora do escopo do MVP

- Criar UI propria.
- Executar comandos destrutivos em repositorios de usuario.
- Substituir ferramentas de CI.
- Fazer memoria global automatica.
- Exigir servidor HTTP MCP no MVP.

## 12. Lacunas a confirmar

- Cliente MCP alvo principal.
- Politica de multiusuario.
- Formato canonico de relatorios longos.

## 13. Decisoes implementadas no MVP

- Linguagem: TypeScript em Node.js 22.
- SDK MCP: `@modelcontextprotocol/sdk`.
- Transporte: `stdio`.
- Persistencia: `.ppirtv/flows`, `.ppirtv/meetings`, `.ppirtv/evidence` e
  `.ppirtv/ledger.ndjson`.
- Testes: Vitest com engine tests e integracao MCP por cliente `stdio`.
