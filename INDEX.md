# dex-PPIRTV Index

Entrada curta para retomada por IA neste repositorio.

## Carregamento rapido

1. `AGENTS.md` - regras locais e ordem de autoridade.
2. `.agents/PROJECT.md` - identidade e fronteiras do projeto.
3. `.agents/ACTIVE.md` - foco vivo e proximos passos.
4. `.agents/HANDOFF.md` - retomada detalhada.
5. `.agents/napkin.md` - runbook tatico ativo do repo; `.codex/napkin.md` e fonte legada somente leitura, sem papel de redirect.
6. `.agents/PLAN-TASKS/ACTIVE.md` - Trilho ativo, quando houver.

## Mapas sob demanda
- `CAPACITY.md` — mapa de capacidades da raiz (fotografia estática do corte
  `947fdb4`, 2026-10-18): 32 capacidades com estado honesto (17 comprovadas ao
  vivo, 9 parciais, 1 não comprovada), gatilho `MAPA-CAPACIDADES-FOTOGRAFIA`;
  regenerar com a skill `dex-mapa-capacidades`, não editar veredito à mão.


- `docs/architecture/FLOW_ENGINE_EVOLUTION.md` — desenho público vivo,
  invariantes, gate `PPIRTV-FLOW-ENGINE-RESPONSIBILITY-BALANCE`, histórico de
  extrações e próximos seams; o ledger de blobs está em
  `docs/architecture/flow-engine-evolution.json`.
- `docs/architecture/FLOW_ENGINE_DECISIONS_MAP.md` — mapa público das decisões
  D-01..D-29 da desmontagem (2026-11-09): tabela dúvida-comum→decisão + L1/L2
  consumível por LLM (`rg "D-xx"`); localizador
  `PPIRTV-FLOW-ENGINE-DECISIONS-MAP`; fotografia interna completa em
  `.agents/MAPAS/decisoes-desmontagem-flow-engine-261109b.md`.
- `docs/architecture/SYSTEM_SNAPSHOT_AND_EVOLUTION_MAP_2026-08-03.md` —
  fotografia imutável do sistema no HEAD `339e3ca`, medições, limites,
  relógios de versão e mapa sequenciado para a próxima release; localizador
  `PPIRTV-SYSTEM-SNAPSHOT-2026-08-03`.
- `docs/architecture/PPIRTV_VNEXT_ARCHITECTURE_DECISION_2026-08-03.md` —
  decisão entre evolução atual, core vNext isolado e greenfield, incluindo
  recuperação de erros repetidos e gate de novo repositório; localizador
  `PPIRTV-VNEXT-CLEAN-CORE-ARCHITECTURE-DECISION-RESULT`.
- `docs/regua-projeto.md` — régua de desenvolvimento deste projeto (candidata,
  2026-11-23): como as regras globais valem aqui, com custo medido (tipos 5 s,
  suíte 191 s), escala do passo e tipos de teste; fiscal de forma na skill
  global `dex-regras-desenvolvimento-casa`.
- `docs/contracts/PRODUCT_VERSIONING_CONTRACT.md` — separa versão declarada,
  release comprovada, contratos e documentos; localizador
  `PPIRTV-PRODUCT-VERSIONING-CONTRACT`.
- `docs/contracts/MCP_TOOL_EFFECTS_CONTRACT.md` — contrato público das
  annotations das 32 tools, catálogo fail-closed e fronteira de aprovação
  headless; localizador `PPIRTV-MCP-TOOL-EFFECTS-CONTRACT`.
- `docs/contracts/MCP_TOOL_ERROR_ENVELOPE_CONTRACT.md` — envelope de erro
  acionável na fronteira MCP (código desambiguado, números do estado,
  sequência literal com args do schema vivo, sem campos vazios) + inventário
  151 sites/~80 códigos e split do `attempt_regress_count`; localizador
  `PPIRTV-ERRO-QUE-ENSINA-ENVELOPE`.

- `.agents/CODE-REVIEW-GRAPH-INDEX.md` — receipt e localizador
  `CRG-LOCAL-STRUCTURAL-GRAPH` do grafo estrutural CRG criado em
  `.agents/CODE-REVIEW-GRAPH`; usar para impacto, fluxos e revisão, sempre
  confirmando findings na fonte viva.
- `.agents/REPORTS/2026-08-01-mapa-missao-acampamento-flow-engine.md` — mapa
  detalhado do acampamento `src/flow-engine.ts`: regiões, consumidores,
  hotspots, dependências, seams por ondas e primeiro gate recomendado para
  reduzir o monólito sem big bang.
- `.agents/REPORTS/2026-08-04-spt-semantic-noninferiority-contract.md` —
  contrato canônico do piloto A/B por delta único, régua de degradação e
  diagnóstico em lote para evitar correções uma a uma.
- `AGENTS.md#regras-locais` — owner evolutivo e gatilho
  `PPIRTV-FLOW-ENGINE-CAMPING-RULE`: `$refactoring-fowler-rich` +
  `$clean-code` deixam uma pequena responsabilidade mais coesa por visita a
  `src/flow-engine.ts`, somente quando houver seam seguro e prova antes/depois.
- `.agents/REPORTS/2026-07-28-handoff-regressao-cross-repo-hygiene-memory-fechamento.md` -
  confirmacao cross-repo de que o avanço de fase corrigido chega a Validacao,
  mas o fechamento ainda mistura hygiene externa e memoria obrigatoria com
  writer `unconfigured`; inclui flow, evidencias, hashes e RED recomendado.
- `.agents/REPORTS/2026-07-28-handoff-phase-gate-bloqueado-por-fiscais-finais.md` -
  handoff reproduzível do bloqueio de avanço quando fiscais finais são
  injetados no gate de Pensamentos; evidência a confirmar pelo owner antes de
  criar Trilho de correção.
- `.agents/REPORTS/2026-07-28-handoff-memory-mining-v2-duplicacao-promocao-inexequivel.md` -
  handoff reproduzível da mineração V2 que gravou resumos processuais
  duplicados e depois não conseguiu promover candidates
  `destinations_required` pela tool pública; evidência a confirmar pelo owner
  antes de criar Trilho de correção ou recovery do vault.
- `.agents/REPORTS/2026-07-28-handoff-hygiene-scan-sem-filtro-de-escopo.md` -
  handoff reproduzível do bloqueio fiscal quando `hygiene_scan` mistura
  findings externos ao target; evidência a confirmar pelo owner antes de
  qualquer Trilho de correção.
- `.agents/HISTORICO/2026-07-10-context-close-progress-sync-goal-binding.md` -
  fechamento mais recente: R3, sync de checkout e binding literal do objetivo.
- `.agents/HISTORICO/2026-07-10-prompt-retomada.md` - prompt pronto e
  preenchido para a proxima janela.
- `.agents/conhecimento/goal-binding-sync-progress-runbook.md` - runbook L3
  para `goal_start`, sincronizacao e progresso Graphify.

- `.agents/PROJECT-STRUCTURE.md` - estrutura de arquivos, responsabilidades,
  matriz de destinos e regras de indexacao.
- `.agents/lembranca.md` - L1 local, gatilhos curtos.
- `.agents/memoria.md` - ancora legada/compatibilidade; novas unidades L2 V2
  ficam em `.agents/memorias/<slug>.md`.
- `.agents/GATILHOS-VIVOS.md` - lista grande de gatilhos de reuso, incluindo
  achados confirmados por Graphify + fonte direta.
- `.agents/GRAPHIFY/ppirtv-gatilhos-2026-06-30/` - grafo semantico do projeto
  (156 nos, 34 comunidades); query via `graphify query ... --graph graphify-out/graph.json`.
- `.agents/GRAPHIFY/dex-ppirtv-deep-2026-07-29/` - grafo profundo atual do
  codigo, testes, contratos e governanca viva (1212 nos, 3045 arestas,
  50 comunidades); localizador
  `GRAPHIFY-LOCAL::agents-graphify-dex-ppirtv-deep-2026-07-29`.
- `README-ZCODE.md` - carta de retomada para janelas do runtime ZCode
  (GLM-5.2 Coding); bootstrap compartilhado, heap proprio, gatilhos quentes.
- `.agents/PLAYBOOK.md` - ordem de operacao recorrente.
- `.agents/HARNESS.md` - validacoes e comandos confiaveis.
- `.agents/EXAMPLES.md` - exemplos de payload e scripts candidatos.
- `.agents/SCRIPTS/INDEX.md` - scripts operacionais de agente/projeto.
- `.agents/ESTACIONAMENTO.md` - pendencias vivas fora do foco.
- `.agents/LIXEIRA.md` - descartes justificados.
- `.agents/GARIMPO/` - curadoria antes de descartar, promover ou memorizar.
- `.agents/HISTORICO/` - fechamentos de missao.
- `.agents/REPORTS/INDEX.md` - relatorios entregaveis e autopsias; inclui
  `PPIRTV-VNEXT-SIREN-AUTOPSY-REPORT-2026-08-05`, com a reconstrucao do ponto
  saudavel, da ruptura e da evidencia conversacional do vNext.

## Regra De Achabilidade

Todo artefato, script ou achado colocado/relocalizado precisa de destino,
indice ou ponteiro e validacao por busca:

```powershell
rg -n "<slug-ou-gatilho>" INDEX.md .agents
```

Se a busca nao encontra o item pelo nome, gatilho ou finalidade, ele ainda nao
esta organizado para a proxima janela.

## Fontes principais

- `src/INDEX.md` - mapa por módulo do código (núcleo + políticas + SSOTs);
  netos: `src/memory/INDEX.md`, `src/security/INDEX.md`.
- `tools/INDEX.md` - ferramentas de engenharia + o TOOLSBOOK (livro de
  ferramentas por intenção, R18: fonte autorada `TOOLSBOOK.json` NA RAIZ
  contrato `dex.toolsbook.v2`; consulta começa pelo `TOOLSBOOK.index.md` (raiz)).
- `docs/architecture/INDEX.md` - mapa da documentação de arquitetura
  (evolução do flow-engine, snapshot de sistema, decisão vNext).
- `src/` - servidor MCP, núcleo de orquestração (flow-engine) + 5 módulos de
  política (meeting-policy, gate-resolution, fiscal-blockers, ppirtv-checkin,
  memory-promotion) + SSOTs — mapa por módulo em `src/INDEX.md` (pós-maratona
  2026-11-09; o acampamento vive em `docs/architecture/FLOW_ENGINE_EVOLUTION.md`).
- `tests/` - cobertura unit/MCP stdio.
- `docs/` - documentacao tecnica e contratos.
- `docs/INDEX.md` - mapa navegavel da documentacao publica; localizador
  `PPIRTV-PUBLIC-DOCS-INDEX`.
- `docs/guides/MCP_AGENT_QUICKSTART.md` - fluxo minimo, `tools/list` como help,
  evidence, FAQ e troubleshooting para agentes pequenos; localizador
  `PPIRTV-MCP-AGENT-QUICKSTART`.
- `docs/contracts/CROSS_REPO_PROBLEM_REPORT_CONTRACT.md` - formato reproduzivel
  e sanitizado para problemas relatados por repositorios consumidores;
  localizador `PPIRTV-CROSS-REPO-PROBLEM-REPORT`.
- `docs/architecture/SYSTEM_SNAPSHOT_AND_EVOLUTION_MAP_2026-08-03.md` - mapa
  factual e datado do sistema, do benchmark e do caminho de evolução.
- `docs/contracts/PRODUCT_VERSIONING_CONTRACT.md` - regra de classificação
  SemVer e gate de compatibilidade antes de bump/tag/release.
- `docs/contracts/MCP_TOOL_EFFECTS_CONTRACT.md` - efeitos read-only, aditivos e
  mutáveis das 32 tools, com owner e recuperação para cancelamento pelo host.
- `templates/` - templates SPT/GoalEnvelope.
- `spt-kit/` - kit de criação SPT LLM-first (MOLDE 21 slots, RULES R1-R08,
  GUIA 1 página, `preflight.mjs` S01-S09 sem MCP, fixtures RED S03/S09).
- `SCHEMA/dex.spt.v3.schm.md` - schema documental do SPT v3 (padrão `.schm.md`
  da casa; porta de identificação + checksum do molde no `registro`).
- `$env:USERPROFILE\.agents\skills\dex-memoria\SKILL.md` - redirecionador
  global para a fonte completa canonica
  `C:\CodexProjetos\dex-memoria\SKILL.md`; copias locais nao sao autoridade.
- `.agents/lembranca.md`, `.agents/memoria.md`, `.agents/memorias/` e
  `.agents/conhecimento/` - mesma estrutura interna canônica usada no escopo
  global; novas unidades V2 ficam em `memorias/<slug>.md` ou
  `conhecimento/<slug>/README.md`. Para futura consolidacao Git, buscar
  `PPIRTV-GIT-CONSOLIDACAO-SELETIVA-MAIN`.

<!-- DEX_AGENT_INDEX START -->
## Dex Agent

- Projeto: `dex-PPIRTV`
- Instancia: `deep-ppirtv`
- Bot: `@deep_ppirtv_bot`
- Instalacao: `C:\CodexProjetos\dex-PPIRTV\skills\dex-agent`
- Status: `powershell -ExecutionPolicy Bypass -File C:\CodexProjetos\dex-PPIRTV\skills\dex-agent\scripts\status-dex-agent.ps1`
- Start: `powershell -ExecutionPolicy Bypass -File C:\CodexProjetos\dex-PPIRTV\skills\dex-agent\scripts\start-dex-agent.ps1`
- Stop: `powershell -ExecutionPolicy Bypass -File C:\CodexProjetos\dex-PPIRTV\skills\dex-agent\scripts\stop-dex-agent.ps1`
- Contratos: `.agents/DEX_PAI.md`, `.agents/DEX_REDE.md`, o redirecionador
  global `dex-memoria`, `skills/dex-agent/skills/dex-acesso/SKILL.md` e
  `skills/dex-agent/skills/dex-contatos/SKILL.md`.
- Memorizar: pedidos de memoria devem usar `dex-memoria` e seu ciclo de vida completo antes de registrar, resolver ou parar de lembrar.
- Acoes finais automaticas: desligadas por padrao com `FINAL_ACTIONS_AUTO_OFFER=false`; ativar somente por contrato explicito no `.env` da instancia.
- Autoexecucao de fila no startup: desligada por padrao com `STARTUP_QUEUE_AUTO_RUN=false`; usar `/queue` ou o botao `Rodar proximo` para decisao humana quando houver fila recuperada.
- Processos: start/restart/reboot devem usar janela escondida no Windows; se aparecer `cmd.exe` visivel, revisar launcher/runner antes de considerar normal.
- Midia: `skills/dex-agent/skills/dex-print/SKILL.md` e `skills/dex-agent/skills/dex-agent-audio-summary/SKILL.md`
<!-- DEX_AGENT_INDEX END -->




































