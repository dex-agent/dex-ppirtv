# GOAL/SPT Canonical Contract

Status: vivo
Owner: dex-PPIRTV
Data: 2026-05-24

Este contrato define o formato canonico para criar prompts `/GOAL`,
`GoalEnvelope` e Trilhos `SPEC-PLAN-TASKs` executaveis pelo `dex-ppirtv`.

## Fronteira /goal e /GOAL

`/goal` do CodeWhale e contexto ou meta de sessao. Ele ajuda o cliente a manter
o objetivo humano visivel, mas nao inicia execucao PPIRTV.

`/GOAL` PPIRTV so esta ativo depois de uma chamada real bem-sucedida para a
tool oficial `goal_start`. Texto do modelo, checklist manual ou chamada a tools
antigas nao substituem `goal_start`.

## Tools oficiais

As tools oficiais para clientes como `dex-code` sao:

- `spt_validate`
- `goal_start`
- `goal_status`
- `ppirtv_checkout`
- `goal_resume`
- `goal_gate_check`
- `goal_advance`
- `goal_progress_record`
- `goal_meeting_open`
- `goal_meeting_add_turn`
- `goal_meeting_close`
- `goal_regress`
- `evidence_add`
- `goal_verdict`
- `mm_memory_mining`
- `mm_pipeline_run`

Tools internas como `flow_create`, `flow_advance`, `gate_check`,
`meeting_open`, `meeting_record`, `evidence_attach` e `verdict_record`
continuam existindo por compatibilidade, mas nao devem ser usadas como
substituto silencioso das tools oficiais de `/GOAL`.

`flow_create` e uma rota legacy/advisory: nao cria `goal_binding`, nao ativa um
GOAL oficial e nao recebe `mode`. Sua resposta usa recibo lean por padrao, com
`advisory=true` e `official_goal=false`; `detail:"full"` preserva o payload
historico apenas para compatibilidade. Pedido de GOAL oficial continua seguindo
`spt_validate -> goal_start`.

As wrappers vivas `goal_gate_check`, `goal_advance`, `goal_meeting_open` e
`goal_meeting_add_turn`/`goal_meeting_close` encapsulam explicitamente as tools
internas antigas para clientes oficiais. O cliente deve preferir `goal_*` para
gates, avancos e reunioes de GOAL. A antiga wrapper `goal_meeting_record` nao
faz parte do contrato fiscal novo.

`mm_memory_mining` fecha o ciclo de aprendizados do flow. `mm_pipeline_run`
orquestra varios flows PPIRTV em sequencia quando o usuario pedir mais de um
SPT, mais de um flow ou execucao em lote no mesmo ciclo. Multi-flow nao e
obrigatorio para GOALs comuns de um unico SPT e nao substitui edicao de codigo,
compilacao, teste externo ou evidencia real quando o SPT exigir.

O Bibliotecario e a camada de memoria operacional do `dex-ppirtv`. Ele roda
como hook de apoio em avancos de fase: `afterPhase` registra aprendizados,
candidatos e estacionamento ao sair da fase; `beforePhase` recupera lembrancas
uteis ao entrar na proxima fase. Na v1, ele nao bloqueia, nao decide veredito,
nao promove memoria canonica sozinho e nao substitui `mm_memory_mining`.
Falha do Bibliotecario deve virar warning rastreavel, nao quebra de
`goal_advance` ou `flow_advance`.

Graphify Recall, quando existir, e apenas acelerador opcional de lembranca do
Bibliotecario. Ele nao e memoria canonica, nao altera L1/L2/L3, nao substitui
`rg` para busca exata e todo achado dele deve ser marcado como `source:
graphify` para permitir medicao separada.

## Trilho/SPT canonico v2

Um Trilho canonico e um arquivo Markdown salvo em:

```text
<workspace>\.agents\PLAN-TASKS\YYYY-MM-DD-<slug>.md
```

O SPT v2 separa duas responsabilidades:

- a camada de maquina e um front matter YAML obrigatorio no topo do arquivo;
- a camada humana e o Markdown livre depois do fechamento do front matter.

`spt_validate` le e valida somente a camada estruturada. Titulos, idioma,
ordem, tabelas e listas do corpo humano nao participam da validacao nem da
extracao. O formato v2 e unico: nao existe fallback, autodeteccao ou janela de
compatibilidade V1/V2. Trilhos V1 historicos continuam como registro, mas
precisam ser migrados ou regenerados antes de uma nova execucao.

Campos obrigatorios do front matter:

- `dex_contract: spt` e `version: 2`;
- `status`, `owner`, `date`, `workspace` e `origin`;
- `goal.id`, `goal.title` e `goal.objective`;
- `context`, `problem` e `decision`;
- `scope.include` e `scope.exclude`;
- `spec`, `plan` e `tasks`;
- `expected_evidence` e `done_criteria`;
- `risks`, `uncertainties`, `gates` e `validation`;
- `execution_prompt`.

Exemplo minimo executavel:

```yaml
---
dex_contract: spt
version: 2
status: RASCUNHO
owner: sprinter
date: '2026-07-09'
workspace: 'C:\CodexProjetos\dex-PPIRTV'
origin: 'reuniao PPIRTV'
goal:
  id: exemplo-spt-v2
  title: 'Exemplo SPT v2'
  objective: 'Executar um objetivo verificavel sem depender do Markdown humano.'
context: 'Contexto operacional suficiente para iniciar o flow.'
problem: 'O contrato antigo dependia de headings literais.'
decision: 'Usar somente front matter YAML v2.'
scope:
  include:
    - 'src/'
  exclude:
    - 'Mudancas fora deste objetivo.'
spec: 'Resultado ou comportamento esperado.'
plan:
  - 'Executar o menor passo verificavel.'
tasks:
  - 'Implementar a mudanca planejada.'
expected_evidence:
  - 'npm run check'
done_criteria:
  - 'A suite passa e o objetivo foi demonstrado.'
risks:
  - 'Falso pronto sem evidencia.'
uncertainties:
  - 'Consumidor externo ainda pode emitir V1.'
gates:
  - 'spt_validate retorna valid=true.'
validation:
  - 'npm run check'
execution_prompt: |
  /GOAL
  Execute este Trilho pelo MCP PPIRTV.
---

# Texto livre para pessoas
```

Use aspas quando um scalar YAML contiver `:`, `#`, backslashes ou outro
conteudo ambiguo. O parser tolera BOM UTF-8, exige `---` no inicio logico do
arquivo, usa schema estrito e rejeita campos desconhecidos.

### Revisao PPI do Trilho

`ppi` pode ser usado como revisor e formatador operacional do SPT antes de
`goal_start`, especialmente quando houver campo faltante, escopo difuso,
risco de memoria/governanca/segredo/runtime, ou quando `spt_validate` retornar
`valid=false`.

O acionamento de `ppi` pode ser automatico nesses casos, mas ele nao substitui
`spt_validate`, nao inicia `/GOAL` sozinho e nao cria decisao de execucao sem
Trilho. O papel dele e devolver o menor ajuste verificavel: preencher campos
canonicos, cortar escopo, explicitar evidencias, reforcar gates e apontar a
proxima acao minima.

Veredito esperado do PPI:

- `PPI: pode avancar`
- `PPI: voltar para Pensamentos`
- `PPI: voltar para Planejamento`
- `PPI: bloquear`

### Fechamento operacional e retomada

O schema continua SPT v2. O fechamento abaixo e um gate operacional depois do
veredito e nao adiciona campos ao front matter:

1. Use `memoria-viva` em todo fechamento de Trilho/SPT para reconciliar a
   menor camada local que permite retomada sem o chat. Atualize, conforme o
   drift real, `.agents/ACTIVE.md`, `.agents/HANDOFF.md`,
   `.agents/PLAN-TASKS/ACTIVE.md` e os indices aplicaveis. O estado deve deixar
   objetivo/status, evidencia, bloqueio e proximo passo com `quando`.
2. Avalie `napkin-projeto` em todo fechamento, mas escreva somente quando o
   bloco produziu avanco substancial, mudanca operacional, gotcha, comando
   confiavel ou regra `Faca em vez disso:` com valor recorrente. Progresso
   trivial, ata e diario de sessao nao entram.
3. Quando a fonte viva ja estiver coerente ou nao houver item elegivel para o
   napkin, registre `nenhuma escrita necessaria` em vez de fabricar conteudo.

`memoria-viva` guarda o estado recuperavel do projeto; `napkin-projeto` guarda
como operar melhor naquele repositorio. Um nao substitui o outro.

## Trilho Multi-Flow / Pipeline SPT

Um Trilho Multi-Flow e um SPT coordenador que descreve uma fila de trabalhos
menores. Ele tambem deve ser salvo em `.agents\PLAN-TASKS` e seguir o formato
canonico acima.

Use Trilho Multi-Flow somente quando o pedido envolver mais de um SPT, mais de
um flow, uma fila de trabalhos ou execucao em lote. Para um unico SPT, mantenha
o fluxo canonico simples: Trilho -> `spt_validate` -> `goal_start` -> gates ->
evidencias -> `goal_verdict`.

O Trilho coordenador pode usar `mm_pipeline_run` para criar e executar flows
PPIRTV independentes em sequencia. Cada item do pipeline deve ter, no minimo:

- `goal`
- `scope_in`
- `scope_out`
- `tasks`
- `expected_evidence`
- `done_criteria`

Quando houver SPT filho para um item, o Trilho coordenador deve apontar o
`spt_path` desse filho no proprio Markdown do coordenador ou na documentacao do
item. O SPT filho tambem deve existir em `.agents\PLAN-TASKS` e passar em
`spt_validate` antes de ser tratado como execucao canonica de codigo real.

Regras:

- `mm_pipeline_run` pronto significa que a orquestracao PPIRTV do pipeline
  passou; nao significa que codigo real foi editado, compilado ou testado.
- Se os flows forem gerados antes dos SPTs filhos, o resultado e relatorio
  operacional de pipeline, nao execucao canonica completa de cada SPT filho.
- Para codigo real, cada item precisa de evidencia propria: patch aplicado,
  validacao de encoding quando houver Delphi legado, compilacao/teste ou
  limitacao explicita, e `goal_verdict` com `evidence_ids`.
- Se `stop_on_failure=true`, falha em um item deixa os seguintes como
  `pending`.
- Se `auto_memory_mining=true`, a mineracao deve ocorrer depois do veredito do
  item para enxergar `gold_mining` e `parking_lot` registrados nele.
- Bloqueio de mineracao pos-veredito deve retornar item `bloqueado`, sem sucesso
  falso.

O Trilho coordenador deve registrar depois da execucao:

- `pipeline_id`
- `flow_ids`
- status por item
- evidencias e comandos reais, quando existirem
- bloqueios e itens `pending`
- riscos residuais
- proximo passo por item

Regra dura:

```text
mm_pipeline_run PRONTO nao significa codigo real PRONTO.
```

## GoalEnvelope

`GoalEnvelope` e o payload estruturado enviado pelo cliente para `goal_start`:

```json
{
  "workspace": "<absolute-workspace-path>",
  "spt_path": "<absolute-spt-path>",
  "objective": "<clear-objective>",
  "idempotency_key": "<project-or-repo>:<date-slug>",
  "evidence_required": true,
  "required_evidence": [],
  "requested_verdict_policy": "evidence_required",
  "source": "<origin>"
}
```

Regras:

- `workspace` deve ser absoluto, existir e corresponder ao `project_root` do
  store ativo. Divergencia falha antes de criar flow ou anexar ledger.
- `spt_path` deve apontar para um arquivo dentro de `.agents\PLAN-TASKS`.
- `objective` deve nomear o resultado esperado do ciclo e corresponder a
  `goal.objective` do front matter v2.
- `idempotency_key` deve ser estavel para retry e nao pode duplicar flows. O
  primeiro `goal_start` vincula o envelope, `goal.id`, o fingerprint do front
  matter e o SHA-256 dos bytes exatos do documento iniciado. O fingerprint
  continua sendo o gate semantico de retry; o SHA documental e recibo imutavel
  de proveniencia e nao bloqueia alteracoes apenas no corpo Markdown humano.
- `evidence_required=true` exige evidencia rastreavel antes de conclusao
  positiva.
- `required_evidence` lista evidencias esperadas para o veredito.
- `requested_verdict_policy=evidence_required` faz `goal_verdict` recusar
  `pronto` e `pronto_com_ressalvas` sem `evidence_ids` existentes.
- `source` identifica a origem, por exemplo `dex-code`.
- `flow_role` e opcional para compatibilidade e aceita somente `execution`,
  `reconciliation` ou `recovery`. O valor e uma declaracao do chamador, fica
  persistido uma unica vez em `goal_binding.flow_role` e participa do gate de
  retry. Ausencia, valor historico invalido ou binding antigo aparece como
  `unknown`; o runtime nunca infere `execution` por data, source ou texto.
  Retry que omite o campo preserva o papel existente; retry que fornece papel
  divergente falha com `GOAL_BINDING_MISMATCH` antes de mutacao.

## Campos de ledger

Ao iniciar um GOAL com `goal_start`, o flow e o ledger precisam preservar:

- `workspace`
- `spt_path`
- `objective`
- `flow_id`
- `idempotency_key`
- `evidence_required`
- `required_evidence`
- `requested_verdict_policy`
- `source`
- `flow_role`, somente quando declarado
- `goal_id`
- `spt_contract_fingerprint`
- `spt_document_sha256_at_start`
- `tasks`
- `expected_evidence`
- `done_criteria`

`tasks`, `expected_evidence` e `done_criteria` vem exclusivamente do front
matter v2 e sao obrigatorios antes de sair da fase Planejamento.

## Rastreamento reverso

`ppirtv_trace` reconstrói proveniencia sem criar indice ou storage paralelo.
A tool aceita exatamente um seletor exato entre `flow_id`, `goal_id`,
`idempotency_key`, `evidence_id`, `meeting_id`, `verdict_id`, `event_id` e
`spt_path`. Zero resultado e sucesso vazio; seletores que alcançam varios flows
retornam todos os matches em ordem deterministica.

O receipt `ppirtv.trace.receipt.v1` usa somente metadados allowlisted, declara
`consistency=non_transactional_read` e `mutated=false`, e representa as fontes
reais com localizadores `file`, `json_pointer` ou `ndjson_record`. Payloads de
evidence, meeting, verdict e ledger nao fazem parte do receipt. Historico sem
os novos campos e classificado como `legacy_derived`, `unresolved` ou `unbound`
sem reescrita; bindings novos e completos usam `explicit`.

Cada match do receipt v1 preserva `goal_id`, `flow_id`, `classification` e
`locators` e acrescenta metadados aditivos:

- `flow_role`: `execution`, `reconciliation`, `recovery` ou `unknown`;
- `binding_integrity.status`: `coherent`, `drifted`, `legacy`,
  `unverifiable` ou `not_applicable`;
- `binding_integrity.reason_code`: causa allowlisted ou `null`;
- `binding_integrity.fields_compared`: somente `goal_id` e hashes de
  `spt_contract_fingerprint`, com valores `registered`, `current` e `match`.

Objetos do receipt v1 sao abertos a campos aditivos; consumidores devem ignorar
campos desconhecidos. Remocao, renomeacao ou mudanca incompativel dos campos
existentes exige nova versao do receipt.

O `reason_code` usa a primeira falha estrutural encontrada nesta precedencia:
`goal_binding_absent`, `workspace_drift`, `spt_path_missing`,
`spt_path_outside_plan_tasks`, `spt_contract_invalid`,
`spt_contract_unreadable`, `spt_contract_fingerprint_missing`,
`spt_contract_fingerprint_drift`, `goal_id_invalid`, `goal_id_drift`,
`spt_document_sha256_invalid` ou
`legacy_binding_without_explicit_identity`. Binding coerente usa `null`.

`unresolved` continua fail-closed e nao vira binding coerente. Somente no caso
`spt_contract_fingerprint_drift`, quando o `goal_id` registrado e estavel e o
SPT atual continua parseavel, o receipt preserva a identidade declarada e
mostra a comparacao; por isso o seletor exato `goal_id` tambem pode localizar
esse match unresolved. Workspace divergente, path ausente/externo, SPT
invalido, `goal_id` conflitante ou SHA inicial invalido continuam com
`goal_id=null`.

Para seletor `spt_path` sem match:

- path inexistente em `PLAN-TASKS` emite `spt_path_missing`;
- SPT schema-valido, no workspace ativo e com varredura completa dos flows
  emite `spt_valid_without_goal_binding`;
- flow ilegivel torna a ausencia indeterminada e emite
  `spt_binding_indeterminate_due_to_unreadable_flows`;
- contrato cujo workspace diverge emite
  `spt_workspace_mismatch_without_goal_binding`.

Eventos de memoria operacional tambem podem aparecer no ledger quando houver
avanco de fase:

- `memory_hook_recorded`: resultado de `afterPhase` para a fase que esta
  sendo encerrada;
- `memory_recalled`: resultado de `beforePhase` para a nova fase;
- `memory_recall_reused`: recall executado na nova fase com conteudo
  deduplicado, preservando referencias sem duplicar `memory_recalled`;
- `memory_recall_consumed`: confirmacao opcional e idempotente de referencias
  realmente usadas pelo executor na fase;
- `memory_hook_warning`: falha tolerada do Bibliotecario ou provider auxiliar;
- `memory_mined`: permanece reservado para `mm_memory_mining`.

Quando Graphify Recall participar, os itens de `memory_recalled` devem manter
marcadores minimos e sanitizados:

- `source: graphify`
- `question`
- `path`
- `destination`
- `observation`

Nao registrar payload bruto sensivel, `.env`, tokens, Authorization headers ou
runtime privado em artefato publico.

## Fases PPIRTV

| Fase | Nome | Gate minimo |
| --- | --- | --- |
| 🧠 | Pensamentos | objetivo, contexto, riscos e incertezas |
| 🗂️ | Planejamento | escopo, fora de escopo, tasks, expected_evidence e done_criteria |
| 🛠️ | Implementação | mudanca executada ou bloqueio objetivo e arquivos alterados |
| 🔎 | Revisão | diff revisado, barata scan e riscos de regressao |
| 🧪 | Teste | teste real ou limitacao explicita e evidencia anexada |
| ✅ | Validação | veredito, risco residual, proximo passo e casa limpa |

## Validacao

Fluxo canonico:

1. Criar Trilho SPT v2 em `.agents\PLAN-TASKS` usando
   `templates/SPEC-PLAN-TASKS.template.md`.
2. Montar `GoalEnvelope`.
3. Chamar `spt_validate`.
4. Se `valid=false`, corrigir o SPT. Nao iniciar GOAL.
5. Chamar `goal_start`.
6. Considerar GOAL ativo apenas se `goal_start` retornar `flow_id`.
7. Abrir reunioes vivas com `goal_meeting_open` quando houver incerteza,
   decisao, divergencia ou risco material.
8. Registrar contribuicoes com `goal_meeting_add_turn` e fechar decisoes com
   `goal_meeting_close`.
9. Rodar gates persistidos com `goal_gate_check`.
10. Avancar fases com `goal_advance`.
11. Acompanhar com `goal_status`.
12. Conferir `ppirtv_checkin`: PPIRTV, COO, Bibliotecario, Graphify e PPI
    precisam aparecer como visiveis/configurados/desabilitados/falhando. Se algo
    nao estiver visivel, o motor deve registrar o ajuste possivel ou acionar PPI
    com acao concreta.
13. Conferir a telemetria do Bibliotecario no ledger ou no retorno do turno
    quando o cliente a expuser.
14. Minerar memoria com `mm_memory_mining` quando houver garimpo ou
    estacionamento relevante.
15. Registrar evidencias reais com `evidence_add`, seguindo o contrato minimo
    de evidencia.
16. Chamar `goal_verdict` com `evidence_ids` rastreaveis.
17. Conferir `ppirtv_checkout` e seus blockers antes do fechamento humano.
18. Aplicar `memoria-viva` para reconciliar o estado de retomada com o
    veredito e o checkout finais.
19. Avaliar `napkin-projeto` pelo gate moderado; escrever somente aprendizado
    operacional substancial ou registrar `nenhuma escrita necessaria`.

### Contrato lean ponta a ponta

O runtime usa o modo canonico `compact` quando `goal_start.mode` e omitido.
Pedidos `lean`, `basico` ou com cerimonia minima podem continuar enviando
`mode: "lean"`; esse alias e persistido como `compact`. Nao existe um terceiro
perfil de fases. O perfil compacto executa:

```text
concepcao -> implementacao -> revisao -> validacao
```

O perfil `full` de seis fases so e ativado por `mode: "full"` explicito. Perfil
de fases e detalhe de resposta sao contratos separados: tools de status e
mutacao retornam `lean` por default mesmo em flow `full`; `detail:"full"` e o
opt-in para diagnostico completo. `goal_status`, `goal_advance`, `evidence_add`
e `ppirtv_checkout` devem manter somente campos acionaveis e contagens por
default. `checklist_render` usa `visual-only` por default e so inclui principios
e arrays completos de governanca com `detail:"full"`.

Retry idempotente sem `mode` preserva o perfil ja persistido e nao migra um
flow vivo. Depois de `evidence_add`, o recibo deve recalcular blockers e expor
uma unica visao coerente; status externo e checkout aninhado nao podem divergir.

Recall automatico e consumo pelo executor sao estados diferentes:

- `recall_executed=true`: o hook Bibliotecario/Graphify rodou;
- `consumption_confirmed=false`: nenhum uso foi comprovado ainda;
- `goal_advance.recall_consumption.references`: referencias do ultimo recall
  realmente usadas na fase atual;
- `graphify_references`: subconjunto usado que deve corresponder a itens
  `source: graphify`;
- `worked=true`: somente depois de consumo confirmado, nunca apenas por recall.

Confirmar consumo e opcional e nao cria gate, reuniao ou tool adicional.
Referencia inexistente nao promove o estado e deve falhar explicitamente.

### Modo advisory e modo fiscal

O PPIRTV pode operar como orientador (`advisory`) em fluxos leves. Em GOALs
oficiais com risco material, ele vira fiscal/bloqueante.

O modo fiscal e acionado por sinais como:

- `pronto_com_ressalvas` com risco material;
- risco de produto, regressao ou erro recorrente;
- mudanca de codigo sem review material;
- `hygiene_scan` com warning/error material;
- memoria L1/L2/L3 exigida sem promocao ou candidato;
- Bibliotecario/Graphify exigido, vazio, ausente ou falhando;
- tentativa de passar gate com `provided=true` sem evidencia coerente.

Quando fiscal, o motor deve expor:

- `blockers`;
- `phase_blockers`;
- `closure_blockers`;
- `phase_advance_allowed`;
- `required_cooperation`;
- `fiscal_policy.meeting_policy`;
- `ppirtv_checkin`;
- `ppirtv_checkout`;
- `librarian_status`;
- `memory_mining.memory_required_but_empty`, quando aplicavel.

Gate de fase e gate de fechamento sao contratos distintos:

- `goal_gate_check` e `goal_gate_preflight` avaliam somente os requisitos da
  fase solicitada; fiscal de review, memoria, hygiene, cooperacao ou
  Bibliotecario que ainda nao pode existir naquela fase permanece em
  `closure_blockers`, sem contaminar `missing`;
- `goal_advance` pode sair da fase quando `phase_blockers=[]` e
  `phase_advance_allowed=true`, mesmo que o status global continue `blocked`
  por `closure_blockers`;
- `next_step` e `phase_next_required_action` indicam a transicao local
  permitida, enquanto `next_required_action` preserva a acao fiscal de
  fechamento; uma orientacao nao substitui a outra;
- `ppirtv_checkout` preserva `phase_blockers`, `closure_blockers` e
  `phase_advance_allowed` no topo do recibo, inclusive nos detalhes `lean` e
  `compact`;
- na fase terminal, o GOAL oficial somente conclui com veredito canonico
  positivo e sem `closure_blockers`. Falha nesse gate nao executa hook
  pos-fase nem grava `flow_completed`; flows manuais legados sem `goal_binding`
  preservam sua compatibilidade;
- `goal_verdict` positivo autoriza a tentativa de fechamento, mas nao publica
  `status=complete` no GOAL oficial. A conclusao publica nasce apenas da
  transicao terminal que reavalia blockers frescos, inclusive uma cooperacao
  elegivel ainda nao vinculada por `meeting_id` ao veredito. O proprio recibo
  positivo publica `next_required_action.tool=goal_advance`,
  `phase_advance_allowed` e `closure_blockers`, sem depender de descricao de
  tool ou prompt que o cliente possa ter armazenado em cache.
  `phase_advance_allowed=true` inclui a transicao terminal protegida quando o
  gate local e os blockers de fechamento estiverem satisfeitos;
- terminalizacao e serializada pelo flow lock e idempotente: depois de
  `flow_completed`, retries retornam reutilizacao sem repetir hook ou ledger.
  Tentativas bloqueadas antes da conclusao registram
  `goal_terminal_blocked` com assinatura dos blockers no historico e ledger,
  alimentando o monitor de repeticao sem tratar gate local passado como
  progresso terminal;
- metadados de review aceitos por `goal_verdict` permanecem no veredito
  vinculados ao conjunto exato de `changed_files` revisado. Qualquer mudanca
  posterior registrada em `changed_files` invalida a prova persistida, mesmo
  que o conjunto volte depois ao valor anterior. Vereditos pre-upgrade sem
  snapshot explicito podem reconstruir o conjunto revisado apenas do historico
  anterior ao proprio `verdict_recorded`; ausencia de trilha continua
  fail-closed. Caminhos de review sao comparados com separadores e casing
  normalizados. Evidencia estruturada de review somente permanece valida
  quando `reviewed_targets` cobre todos os `changed_files` correntes e nao
  houve mutacao posterior. Reenvio identico de `changed_files` pelo gate de
  implementacao preserva a prova; nova declaracao por `updateFlowFacts`
  inaugura outra geracao e exige novo review, mesmo quando os nomes dos
  arquivos permanecem iguais.

Se `blockers` existir, `display.direct_action` deve apontar o bloqueio real,
por exemplo `Bloqueado: required_cooperation, review_required`; nao pode
mostrar `Gate pronto para avancar`. A regra vale recursivamente para
subpayloads como checklist, evidence/status e archive de flow bloqueado.
Quando o gate local estiver satisfeito, `phase_direct_action` pode indicar o
avanco permitido sem apagar o bloqueio global exibido por `display.direct_action`.

`librarian_status` deve ser estruturado sempre, inclusive quando desabilitado,
com `bibliotecario.status`, `graphify.status`, `functional_tested`,
`recall_executed` e `consumption_confirmed`. `functional_tested` prova que a
rota de recall operou; nao prova consumo. Estado
ausente/null e falso silencio operacional. `disabled` significa reportado, nao
participacao funcional.

`ppirtv_checkin` e obrigatorio no inicio: deve conferir PPIRTV, COO,
Bibliotecario, Graphify e PPI, ajustar o que puder tornar visivel e expor
`initial_adjustment_required`/`direct_action` quando houver bloqueio fiscal.
Tambem deve expor `trail_alignment` para conferir MCP cwd, workspace, SPT,
objetivo e contrato de evidencia antes de partir.

`ppirtv_checkout` e obrigatorio no fim: deve preservar blockers, evidencias,
reunioes, review, testes, garimpo, memoria e destino. Antes do fechamento
humano total, a continuidade local deve estar reconciliada por `memoria-viva`
e o gate moderado de `napkin-projeto` deve ter resultado explicito, inclusive
`nenhuma escrita necessaria`. Arquivar flow bloqueado nao transforma bloqueio
em sucesso; deve dizer que foi arquivado com bloqueios preservados.

`required_cooperation` material deve gerar contrato acionavel:
`meeting_required`, `regress_required`, `back_to`, `next_required_action` e
`can_retry_verdict=false` ate existir reuniao/regresso rastreavel ou decisao
material equivalente.

Para evitar loop ruim, o maximo fiscal inicial e 3 regressos por flow. Ao
atingir `max_regressions`, o motor deve marcar `regress_limit_reached=true` e
exigir `next_required_action.type="open_decision_meeting"` em vez de mandar
regressar novamente.

`checklist_render` deve tratar principios dependentes de prova como tri-state:
`checked`, `blocked`/`unchecked` ou `pending`. Hygiene, memoria, regresso e
review nao podem nascer verdes sem evidencia material.

`hygiene_scan` nao deve abrir `.env`. A presenca de `.env` deve ser reportada
somente como indicador agregado, por exemplo `.env:present_not_read`, com
`sensitive_content_read=false`, sem nome de chave e sem valor.

`pronto_com_ressalvas` nao pode ser aceito quando a propria ressalva confessa
ausencia dos fiscais que deveriam decidir a ressalva.

### COO obrigatorio e reuniao viva

Em GOAL material, COO nao e opcional. A mesa minima obrigatoria deve aparecer em
`required_cooperation` conforme fase e risco:

- `ancora-fluxo`: indica fase correta, regresso e cooperadores da fase;
- `chato`: pressiona lacunas, falso pronto e contradicoes;
- `questionador`: testa premissas e perguntas principais;
- `entrevista-me`: extrai contexto faltante;
- `garimpeiro`: separa ruido, ponto cego, dica de ouro e memoria candidata;
- `dex-memoria`: classifica/promove memoria exigida pelo contrato L1/L2/L3;
- `estacionamento`: segura itens vivos que ainda nao devem virar pronto;
- `reuniao`: conduz divergencia, convergencia e transversalidade;
- `sprinter`: transforma decisao em Trilho executavel;
- `duda-dev`: implementa codigo real quando a fatia estiver recortada;
- `mapeador-implementacao`: preserva escopo, invariantes e ordem tecnica;
- `revisor-codigo`: valida diff, riscos e review material;
- `tio-testador`: prova comportamento executado;
- `validador-pronto`: fecha veredito com evidencia.

A politica de reuniao deve rotacionar integrantes e repertorio. A mesa precisa
provocar, desviar, procurar pontos cegos e buscar saidas nao tentadas; reuniao
decorativa ou sempre com a mesma voz nao substitui gate.

### Contrato minimo de evidencia

Toda evidencia registrada com `evidence_add` ou anexada a um Trilho deve
informar, no proprio conteudo ou metadados:

- data e hora da coleta, preferencialmente em ISO 8601;
- origem da evidencia: comando, ferramenta, usuario, screenshot, teste, build,
  MCP ou arquivo;
- objetivo validado;
- `spt_path` ou nome do Trilho/SPT;
- `flow_id`;
- fase PPIRTV relacionada;
- comando ou procedimento executado, quando houver;
- resultado observado;
- limitacao ou risco residual, quando houver.

Evidencia sem data/hora, origem, objetivo, SPT/Trilho e `flow_id` e fraca para
veredito positivo. Pode ser usada como anotacao auxiliar, mas nao deve sustentar
`pronto` ou `pronto_com_ressalvas` sozinha.

Fluxo multi-flow, somente quando solicitado ou quando o objetivo tiver mais de
um SPT/flow:

1. Criar o Trilho coordenador.
2. Criar ou validar os SPTs filhos quando o item representar codigo real.
3. Chamar `mm_pipeline_run` com a fila.
4. Registrar `pipeline_id`, `flow_ids`, status por item e evidencias no Trilho
   coordenador.
5. Para item que exige codigo real, continuar no SPT filho ate haver patch,
   validacao e veredito proprio com evidencia rastreavel.

## Especialistas vivos e creditos

Especialistas podem aparecer como `suggested_cooperators` em reunioes, mas isso
nao vira credito material. Credito ativo so nasce no ciclo
`goal_meeting_add_turn`/`goal_meeting_close`, em `evidence_add` ou em
`goal_verdict` quando `cooperators[].material=true` e a contribuicao mudou
decisao, risco, teste, documentacao ou veredito.

`goal_status` deve expor cooperadores, creditos ativos, estacionamento
(`parking_lot`), garimpo (`gold_mining`), `goal_learning_links` e
`memory_mining` quando existirem. Reuniao decorativa sem registro util nao
substitui gate, evidencia nem decisao rastreavel.

`goal_status` e `ppirtv_checkout` podem expor `blocker_diagnostics` como campo
aditivo. Esse diagnostico deve separar blocker de gate de fase
(`phase_gate_requirements`) de blocker fiscal/material
(`fiscal_material_policy`) e indicar a origem por blocker. Diagnostico nao
altera a regra de bloqueio: GOAL oficial continua sem concluir sem veredito
canonico, evidencia e gates satisfeitos.

Em GOALs oficiais, Estela e Gabi trabalham juntas: item em `parking_lot` deve
receber garimpo vinculado. Se houver pepita, o flow preserva o item estacionado,
promove a pepita para `gold_mining` e registra o rastro estruturado em
`goal_learning_links`.

`goal_verdict` positivo deve reutilizar a prestacao de contas mais recente de
`mm_memory_mining` e nao pode promover `write_policy=classify_only` para
`auto_write`. Se memoria for exigida e ainda nao tiver sido minerada
explicitamente, o veredito bloqueia e pede a acao de memoria em vez de escrever
por efeito colateral. Candidate util sem rota valida bloqueia o veredito.

### Auto-gravacao de memoria

- Somente `mm_memory_mining` pode escrever memoria curada L1/L2/L3.
- Default operacional: `auto_classify=true`, `write_policy=auto_write`.
- `goal_verdict` nao escreve L1/L2/L3 implicitamente; ele consome a mineracao
  existente e preserva `classify_only` quando esse foi o modo executado.
- `goal_verdict` pode registrar `review_findings`, `verdict_gold_mining` e
  `verdict_parking_lot`; esses campos alimentam garimpo, estacionamento e a
  proxima rodada de `mm_memory_mining`, sem escrever memoria por efeito
  colateral.
- Achado que merece memoria de reuso, tropeço recorrente ou prevencao de erro
  deve ser gravado automaticamente quando classificado como writable e nao
  bloqueado; o usuario e informado depois com os arquivos gravados para poder
  editar, complementar ou corrigir.
- `written=[]` nunca pode ser silencioso. A resposta deve expor
  `write_decisions`, `edit_queue` e, se aplicavel, `destination_warnings`.
- Todo item estacionado deve ter garimpo vinculado em
  `goal_learning_links.garimpo_vinculado`, separando `ponto_cego`,
  `dica_de_ouro`, `armadilha`, `heuristica` e `nao_promover`.
- Diagnostico e validacao controlada de consumidor devem usar
  `write_policy=classify_only`.
- `auto_classify=false` com `write_policy=auto_write` e invalido.
- Graphify e Bibliotecario nao promovem memoria canonica.
- Escrita L1/L2/L3 exige candidato classificado como writable e nao bloqueado.
- Toda memoria ativa usa um gatilho L1 e exatamente um destino: L2 para
  memoria leve ou operacional OU L3 para conhecimento profundo; L3 direto
  exige `owner_skill`, permanece recuperavel por L1 e nao cria L2 artificial.
- Se memoria for exigida e nada for escrito/classificado, expor
  `memory_required_but_empty=true`.

`auto_classify=false` nao e atalho para gravar sem classificacao: ele desliga a
classificacao/escrita automatica e so pode ser usado com
`write_policy=classify_only`. Candidate sem evidencia minima nao vira memoria
curada; item de `parking_lot` precisa de promocao rastreavel ou evidencia real
para escrever L1/L2.

## Auto-continuacao

Auto-continuacao deve ser:

- visivel para o usuario;
- limitada por objetivo, fase ou budget;
- cancelavel por nova instrucao;
- rastreavel por status, evidencias e proximo passo.

Ela nao pode executar SPT inteiro de forma invisivel por hook.

## Erros esperados

- `BLOQUEADO_TOOLS_AUSENTES`: alguma tool oficial nao apareceu em `list_tools`.
- `SPT_INVALIDO`: `spt_validate` retornou campos faltantes.
- `GOAL_NAO_ATIVO`: ainda nao houve `goal_start` real com `flow_id`.
- `EVIDENCIA_AUSENTE`: tentativa de veredito positivo sem `evidence_ids`.
- `MEMORY_MINING_BLOCKED_VERDICT`: mineracao encontrou candidate util sem rota
  valida antes de veredito positivo.
- `MEMORY_HOOK_WARNING`: Bibliotecario ou provider auxiliar falhou de forma
  tolerada durante `beforePhase` ou `afterPhase`.
- `GRAPHIFY_RECALL_UNAVAILABLE`: Graphify Recall estava habilitado ou esperado,
  mas nao havia grafo, executavel, resposta valida ou tempo suficiente.
- `PIPELINE_ITEM_BLOCKED`: item do `mm_pipeline_run` bloqueou em gate ou
  mineracao pos-veredito.
- `PIPELINE_PRONTO_NAO_CODIGO_PRONTO`: pipeline completou orquestracao, mas a
  execucao de codigo real ainda nao tem evidencia propria.
