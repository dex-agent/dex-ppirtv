---
name: "dex-PPIRTV playbook"
description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."
type: playbook
generated_by: "tools/playbook/generate-playbook.py"
authority: derived_projection
sources_revision: "sha256:281b9623e59fbb3ab0c1314d36ccbfeec0781d00364bcb5342a87fbc933eb1e9"
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

- Localizador: `PPIRTV-MANUTENCAO-CONTINUA-CRG`
- Gatilho: Formato de ciclo: `Unreleased` ate decisao explicita de versao; gatilhos:
- Extrato: - `PPIRTV-MANUTENCAO-CONTINUA-CRG`: antes de corte de manutencao/reuso, ler workflow/RULES.md e workflow/manutencao-iterativa-com-evidencia...
- Fonte: `AGENTS.md#L26-L163`
- Selo: `pb-8938be6d`

### Validacao minima

- Localizador: `PPIRTV-CAPACITY-COMMIT-GATE`
- Gatilho: ndeclarado
- Extrato: ```powershell
- Fonte: `AGENTS.md#L193-L215`
- Selo: `pb-97348542`

### Ordens diretas do Comandante Owner o $chato 🗣️

- Localizador: `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Gatilho: 2. $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamento da $estacionamento ao lado da $garimpeiro e tudo que for achado MEMORÁVEL...
- Extrato: ### Mandatory live preflight — `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Rotas (nomes, na ordem):
  - Mantenha $garimpeiro e $estacionamento ativos durante todo...
  - $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamen...
  - Ative o fluxo visual PPIRTV com checklist visual dinâmico u...
  - Sempre finalize o trabalho analisando "com lentes dos espec...
- Fonte: `AGENTS.md#L216-L278`
- Selo: `pb-f0d4ceb4`

### Dex Agent Local

- Localizador: `PPIRTV-GIT-CONSOLIDACAO-SELETIVA-MAIN`
- Gatilho: - Antes de qualquer consolidacao Git deste repositorio, recupere o gatilho
- Extrato: - Projeto: `dex-PPIRTV`
- Fonte: `AGENTS.md#L279-L323`
- Selo: `pb-81fb4545`

### Leitura obrigatoria (bootstrap)

- Localizador: `PENDENTES-LEDGER`
- Gatilho: 5. `.agents/PENDENTES.md` — ledger de pendências append-only (schema `dex.pendencias.v2`; gatilho `PENDENTES-LEDGER`)
- Extrato: 1. `AGENTS.md`
- Rotas (nomes, na ordem):
  - `AGENTS.md`
  - `.agents/ACTIVE.md`
  - `.agents/HANDOFF.md`
  - `.agents/PLAN-TASKS/ACTIVE.md`
- Fonte: `AGENTS.md#L402-L409`
- Selo: `pb-cad80448`

## Runbook <-> Playbook (procedimentos)

- (napkin ausente nesta copia)

## Plano de execucao vigente

-> `.agents/PLAN-TASKS/ACTIVE.md (local)` - nao viaja no clone.

## Fontes e revisao

| caminho | sha256 | Enviado? |
| --- | --- | --- |
| `AGENTS.md` | `a80d3741c273d59ca5fd9dfa70648f245553a086155dffa9af1e7d8e80f73015` | nao |
| `.agents/napkin.md` | `fba7a9ec155e9421a227aa9e6459511f9ee4bc076bb1256e0af089acdf43cc1c` | nao |
| `.agents/PLAN-TASKS/ACTIVE.md` | `528091d38293c9a950527ad7cb35b02cc49dc2e77c34fc58ccc683f444a05a38` | nao |

## Superficie enviada vs local

- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).
- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).
- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.

## Secoes nao decodificadas

- Organizacao De Artefatos E Scripts -> `AGENTS.md#L164` (sem token de localizador)
- Graphify local -> `AGENTS.md#L324` (sem token de localizador)
- Bootstrap (toda janela nova, nesta ordem) -> `AGENTS.md#L357` (sem token de localizador)
- Indexação (doutrina da casa) -> `AGENTS.md#L375` (sem token de localizador)
- Envio a terceiros -> `AGENTS.md#L382` (sem token de localizador)
