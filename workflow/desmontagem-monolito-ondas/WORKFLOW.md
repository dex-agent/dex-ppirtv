---
schema: dex.workflow.v1
slug: desmontagem-monolito-ondas
version: 0.1.0
status: ativo
owner: executor PPIRTV (sessao dona); owner do comportamento: $oraculo-refatoracao
created: 2026-11-07
updated: 2026-11-07
origem: captura local da sessao 2026-11-07 (GO do dono: desmontar em picadinhos com fotografia antes/depois); template global PENDENTE (divida declarada no CHANGELOG)
method_contract: dex.workflow.v1 rev 1.7
---

# Desmontagem de monólito por ondas — ESCOTEIRO-ONDA (PPIRTV)

Runbook puro de decomposição do `src/flow-engine.ts` (generalizável a qualquer
monólito do repo) em ondas com fotografia antes/depois comparada por oracle —
cada onda preserva comportamento com prova; nenhuma onda fecha com capacidade
degradada sem explicação.

## Promessa

- Objetivo: encolher o monólito cluster por cluster (onda inteira por ajuste),
  com prova de preservação por onda e trilha auditável (CRG + mapas + ledger).
- Entrega por onda: commit + capture-cut DEPOIS + comparação de capacidades +
  decisão nova no mapa + marker de camping + cerimônia do flow.

## Quando usar

- Toda visita de fix/refatoração que tocar cluster JÁ MAPEADO do monólito (régua ESCOTEIRO-ONDA do `AGENTS.md`).
- Abertura de corte de decomposição (fila de ondas no mapa de decisões).
- Antes de review estrutural/blast radius do monólito (o CRG fresco é pré-requisito).

## Quando NÃO usar

- Mudança de comportamento intencional (não é preservação — é corte de produto com Trilho próprio).
- Extração de meio-cluster ou big-bang (proibidos pela Cláusula de Maratona).
- Repositório sem CRG inicializado (organize o CRG antes — passo 1).

## Pré-requisitos

- CRG inicializado no repo (`.agents/CODE-REVIEW-GRAPH`) e git limpo no HEAD da onda.
- Trilho/SPT da onda aprovado (`spt_validate` verde) — Trilho = plano ANTES; esta receita = execução.
- Mapas de ANTES existentes (se a onda abre nova sessão de desmontagem) ou o da sessão corrente.

## Passos (cada um com ✅ Verificação)

1. **Fotografia ANTES** (só na abertura da sessão de desmontagem, ou se o CRG estiver stale):
   - `code-review-graph build --repo <REPO> --data-dir <REPO>/.agents/CODE-REVIEW-GRAPH` (update incremental pode ser NO-OP preso — build é determinístico)
   - `python -B workflow/manutencao-iterativa-com-evidencia/scripts/capture-cut.py --cut desmontagem-antes-<sha-curto>`
   - Mapas: `.agents/MAPAS/capacidades-<alvo>-<sha>.md` (porta dex-mapa-capacidades) + `.agents/MAPAS/decisoes-<alvo>-<sha>.md` (porta dex-mapa-das-decisoes); o CRG é o mapa relacional (nota: skill `dex-mapa-relacional-dependencias` não existe no registry).
   - **Índice do corte** (ponteiro, nunca cópia): linha nova em `.agents/MAPAS/INDEX.md` ligando o corte → mapas + receipt CRG + suíte — 1 ponto de retomada sem duplicar verdade.
   - ✅ receipt `"status": "captured"` + `built_at_commit == HEAD` (3 números: banco × HEAD × receipt) + linha do corte no `MAPAS/INDEX.md`.
2. **Onda** (cluster inteiro do mapa; nunca pedra minúscula):
   - RED primeiro (teste novo ou molde que reproduza o comportamento atual);
   - cirurgia tsc-drive: lógica NOVA nasce FORA do monólito (módulo próprio ou existente), engine só cola;
   - GREEN pelo oráculo existente/vacina da família.
   - ✅ suíte do cluster verde + `npx tsc --noEmit` limpo.
3. **Commit da onda** (seletivo; CAPACITY + receipt staged; `npm run check` verde).
   - ✅ commit criado; anotar `<sha-onda>`.
4. **Fotografia DEPOIS**: capture-cut `desmontagem-depois-<sha-onda>` (o capture usa HEAD — por isso vem APÓS o commit).
   - ✅ `built_at_commit == <sha-onda>`.
5. **Comparação por oracle** (porta dex-mapa-capacidades, classes exatas):
   - `preservada | acrescentada | degradada | removida | não comparável` — por capacidade, com oracle (suíte por cluster, vacina, espelho); contagem/linhas NUNCA decidem.
   - ✅ nenhuma `degradada` sem causa-raiz + decisão registrada (reverter ou aceitar com ressalva).
6. **Mapa de decisões += D-xx** (onda executada, K/N, evento com `<sha-onda>`, supersede se aplicável) + CHANGELOG do repo + marker de camping no `docs/architecture/FLOW_ENGINE_EVOLUTION.md` (SHRINK/CONTAIN/EXCEPTION pelo modo semântico; `behavior_preserved_by` no ledger) + **linha no histórico** `.agents/MAPAS/HISTORICO-DESMONTAGEM.md` (onda: símbolos que saíram → destino → commit → prova — a superfície "remonte e entenda" em uma página).
   - ✅ `npm run check:flow-engine` verde; marker com o sha da onda.
7. **Cerimônia do flow** da onda (gates → provas por critério → review citada → verdict → mining → memoria-viva → terminal).
   - ✅ verdict registrado + advance terminal.
8. **Fila**: próxima onda declarada no mapa de decisões (D-xx proposta) — a desmontagem é contínua (ESCOTEIRO-ONDA).

## Meta-analise questionadora

(antes de CADA fechamento de onda)

- Quando: antes do verdict de cada onda e entre ondas.
- Perguntas: a comparação usou oracle (não contagem)? alguma capacidade `degradada`? a onda extraiu o cluster INTEIRO (não meio)? o camping pagou o marker com `behavior_preserved_by`? o capture DEPOIS bate com o HEAD do commit da onda?
- Oráculo: o da família do cluster (vacina/suíte) + CRG fresco; registrando fonte e parecer.
- Impacto: onda que fecha com degradada sem explicação = finding material pago antes do verdict.
- Retorno: degradada inexplicada → reverter a onda (git) e re-abrir o mapa.
- Registro: D-xx com K/N + evento; CHANGELOG; ledger de camping.
- Avanço: só com verdes de 1-7.

## Gotchas

- update incremental do CRG pode ser NO-OP preso (banco não alcança HEAD) — use `build`; a pós-condição do capture-cut pega (receipt `failed` com `built_at != HEAD`).
- capture-cut falha com `[WinError 183]` se o diretório do corte já existe — remova o receipt da tentativa inválida e re-capture.
- A linha-alvo pode ter migrado entre cortes — localize por assinatura (grep), nunca por número de linha de baseline.
- Capturas de ANTES nunca são sobrescritas (fotografia é evidência, não estado).
- Ordem obrigatória: onda → commit → capture DEPOIS (o capture fotografa HEAD).

## Índice do pacote

- [RULES.md](RULES.md) — regras R1..R7 desta receita.
- [SCHEMA/SCHEMA.md](SCHEMA/SCHEMA.md) — porta de entrada (sem executor `.zcode/workflows` → sem família rota/fNN; ao ganhar executor, a família nasce na mesma sessão).
- [USAGE.md](USAGE.md) — execuções reais.
- [CHANGELOG.md](CHANGELOG.md) — ledger de lapidação.
- [CAPACITY.md](CAPACITY.md) — fotografia mínima de nascimento.
- Histórico das ondas: `.agents/MAPAS/HISTORICO-DESMONTAGEM.md` (fora do pacote — evidência local do repo).
