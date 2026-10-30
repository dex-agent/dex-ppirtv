---
name: "dex-PPIRTV playbook"
description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."
type: playbook
generated_by: "tools/playbook/generate-playbook.py"
authority: derived_projection
sources_revision: "sha256:e644cb6611987da3e0834a3b79eeb650206ad80aa8713380fe21022cf23d4dcc"
sent_revision: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
do_not_edit: true
---
# Playbook - dex-PPIRTV

## Como usar este playbook

Projecao GERADA das regras de decisao deste repo; a decisao completa mora na fonte citada.
Executar uma regra exige ler a fonte; extratos terminam em '...' quando truncados.
Regenerar apos editar fonte: `python -B tools/playbook/generate-playbook.py --repo . --write`.
Verificar frescor: `python -B tools/playbook/generate-playbook.py --repo . --check` (exit 0 limpo, exit 2 drift).
Ativar trava de commit: `git config core.hooksPath tools/playbook/hooks`.
Destinatario do projeto: `--check-sent` valida as fontes enviadas neste clone.

## Regras de decisao (plaquinhas)

### Regras locais

- Localizador: `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL`
- Gatilho: Formato de ciclo: `Unreleased` ate decisao explicita de versao; gatilhos:
- Extrato: - Manter `CHANGELOG.md` atualizado. Owner: `$projeto-manter-changelog`.
- Fonte: `AGENTS.md#L26-L167`
- Selo: `pb-dc9e879d`

### Validacao minima

- Localizador: `PPIRTV-CAPACITY-COMMIT-GATE`
- Gatilho: ndeclarado
- Extrato: ```powershell
- Fonte: `AGENTS.md#L197-L219`
- Selo: `pb-085a874b`

### Ordens diretas do Comandante Owner o $chato 🗣️

- Localizador: `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Gatilho: 2. $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamento da $estacionamento ao lado da $garimpeiro e tudo que for achado MEMORÁVEL...
- Extrato: ### Mandatory live preflight — `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Rotas (nomes, na ordem):
  - Mantenha $garimpeiro e $estacionamento ativos durante todo...
  - $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamen...
  - Ative o fluxo visual PPIRTV com checklist visual dinâmico u...
  - Sempre finalize o trabalho analisando "com lentes dos espec...
- Fonte: `AGENTS.md#L220-L282`
- Selo: `pb-c82e689d`

### Dex Agent Local

- Localizador: `PPIRTV-GIT-CONSOLIDACAO-SELETIVA-MAIN`
- Gatilho: - Antes de qualquer consolidacao Git deste repositorio, recupere o gatilho
- Extrato: - Projeto: `dex-PPIRTV`
- Fonte: `AGENTS.md#L283-L327`
- Selo: `pb-b3450f8f`

### Leitura obrigatoria (bootstrap)

- Localizador: `PENDENTES-LEDGER`
- Gatilho: 5. `.agents/PENDENTES.md` — ledger de pendências append-only (schema `dex.pendencias.v2`; gatilho `PENDENTES-LEDGER`)
- Extrato: 1. `AGENTS.md`
- Rotas (nomes, na ordem):
  - `AGENTS.md`
  - `.agents/ACTIVE.md`
  - `.agents/HANDOFF.md`
  - `.agents/PLAN-TASKS/ACTIVE.md`
- Fonte: `AGENTS.md#L406-L413`
- Selo: `pb-b6ab4d64`

## Runbook <-> Playbook (procedimentos)

- (napkin ausente nesta copia)

## Plano de execucao vigente

-> `.agents/PLAN-TASKS/ACTIVE.md (local)` - nao viaja no clone.

## Fontes e revisao

| caminho | sha256 | Enviado? |
| --- | --- | --- |
| `AGENTS.md` | `644368d81dac6000091dc4f947a114c78cac37d9908072ae892594cdb024c76a` | nao |
| `.agents/napkin.md` | `3a7b694c4a68ca0263be4ee1259f5f5d8d0f9a4f92f01a17e12d27153aff8929` | nao |
| `.agents/PLAN-TASKS/ACTIVE.md` | `a4b3ab90c62acd8098053d51c7e5c92d08048b997849114a9f7b9dbb3d2e36f9` | nao |

## Superficie enviada vs local

- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).
- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).
- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.

## Secoes nao decodificadas

- Organizacao De Artefatos E Scripts -> `AGENTS.md#L168` (sem token de localizador)
- Graphify local -> `AGENTS.md#L328` (sem token de localizador)
- Bootstrap (toda janela nova, nesta ordem) -> `AGENTS.md#L361` (sem token de localizador)
- Indexação (doutrina da casa) -> `AGENTS.md#L379` (sem token de localizador)
- Envio a terceiros -> `AGENTS.md#L386` (sem token de localizador)
