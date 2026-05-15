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
| `evidence` | array | Evidencias vinculadas |
| `history` | array | Eventos de transicao |

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

## 8. Resources MCP propostas

| Resource | Conteudo |
| --- | --- |
| `ppirtv://flows` | Lista de flows |
| `ppirtv://flow/{flow_id}` | Estado completo do flow |
| `ppirtv://flow/{flow_id}/checklist` | Checklist visual atual |
| `ppirtv://flow/{flow_id}/ledger` | Eventos auditaveis |
| `ppirtv://templates/gates` | Gates padrao por fase |
| `ppirtv://templates/meetings` | Estruturas de reuniao |
| `ppirtv://reference/mcp` | Referencias MCP adotadas |

## 9. Prompts MCP propostas

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

- Linguagem de implementacao final: TypeScript, Python ou outra.
- Cliente MCP alvo principal.
- Persistencia final: arquivos JSON/NDJSON ou banco local.
- Politica de multiusuario.
- Formato canonico de relatorios longos.

