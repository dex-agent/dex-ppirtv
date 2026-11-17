---
name: "dex-PPIRTV playbook"
description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."
type: playbook
generated_by: "tools/playbook/generate-playbook.py"
authority: derived_projection
sources_revision: "sha256:8376618c3eafbcfe098bb1d60bf4eee93e700bdcf47fc4cdbb59324ae2bb8e05"
sent_revision: "sha256:c3fe3900353785713ca9fdb1d0ff4a840d2eade60eadca73b9a4ac228bd6dc0f"
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

### Painel de Ferramentas

- Localizador: `PAINEL-DE-FERRAMENTAS`
- Gatilho: - Gatilho: na retomada e antes de implementar, consulte as ferramentas e rotas de conhecimento já disponíveis para o projeto.
- Extrato: - `PAINEL-DE-FERRAMENTAS`
- Rotas (nomes, na ordem):
  - Abra [o índice de documentação](INDEX.md) para localizar fe...
  - No ambiente de trabalho, consulte o painel local em `AGENTS...
- Fonte: `docs/PLAYBOOK-RULES.md#L3-L8`
- Selo: `pb-72414c9b`

### Documentação publicada e localizável

- Localizador: `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL`
- Gatilho: - Gatilho: ao publicar guia, FAQ, runbook ou contrato explicativo, confira se o destinatário consegue encontrá-lo.
- Extrato: - `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL`
- Rotas (nomes, na ordem):
  - Vincule o documento no README, no índice de documentação e...
  - Valide a busca pelo título ou localizador e confira os link...
- Fonte: `docs/PLAYBOOK-RULES.md#L9-L13`
- Selo: `pb-e48a5b0f`

### Painel de Ferramentas

- Localizador: `PAINEL-DE-FERRAMENTAS`
- Gatilho: ### 4. Memorias quentes (L1 vivos — completo em `.agents/GATILHOS-VIVOS.md`)
- Extrato: (consultar ANTES de qualquer pesquisa web — molde de ecossistema
- Fonte: `AGENTS.md#L26-L68`
- Selo: `pb-b04ade35`

### Regras locais

- Localizador: `CONSELHEIRO-ATIVO-PADRAO-REPO`
- Gatilho: mapa quente em `.agents/GATILHOS-VIVOS.md`).
- Extrato: - `CONSELHEIRO-ATIVO-PADRAO-REPO` (GO do dono 2026-11-09): toda sessão de
- Fonte: `AGENTS.md#L69-L237`
- Selo: `pb-01ed2d56`

### Validacao minima

- Localizador: `PPIRTV-CAPACITY-COMMIT-GATE`
- Gatilho: ndeclarado
- Extrato: ```powershell
- Fonte: `AGENTS.md#L287-L309`
- Selo: `pb-3e6f78ec`

### Ordens diretas do Comandante Owner o $chato 🗣️

- Localizador: `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Gatilho: 2. $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamento da $estacionamento ao lado da $garimpeiro e tudo que for achado MEMORÁVEL...
- Extrato: ### Mandatory live preflight — `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Rotas (nomes, na ordem):
  - Mantenha $garimpeiro e $estacionamento ativos durante todo...
  - $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamen...
  - Ative o fluxo visual PPIRTV com checklist visual dinâmico u...
  - Sempre finalize o trabalho analisando "com lentes dos espec...
- Fonte: `AGENTS.md#L310-L372`
- Selo: `pb-5216c380`

### Dex Agent Local

- Localizador: `PPIRTV-GIT-CONSOLIDACAO-SELETIVA-MAIN`
- Gatilho: - Antes de qualquer consolidacao Git deste repositorio, recupere o gatilho
- Extrato: - Projeto: `dex-PPIRTV`
- Fonte: `AGENTS.md#L373-L417`
- Selo: `pb-6d083ff3`

### Bootstrap (toda janela nova, nesta ordem)

- Localizador: `TRACKER-LOCAL`
- Gatilho: operar) → `.agents\GATILHOS-VIVOS.md` (hub de gatilhos quentes de reuso).
- Extrato: 1. Leia o AGENTS global: `$env:USERPROFILE\.agents\AGENTS.md` (PowerShell) /
- Rotas (nomes, na ordem):
  - Leia o AGENTS global: `$env:USERPROFILE\.agents\AGENTS.md`...
  - Leia este `AGENTS.md` inteiro.
  - Leia o estado vivo, nesta ordem: `.agents\ACTIVE.md` → `.ag...
  - Gatilhos L1: `.agents\lembranca.md` — abra L2/L3 somente po...
- Fonte: `AGENTS.md#L451-L472`
- Selo: `pb-620dff48`

### Leitura obrigatoria (bootstrap)

- Localizador: `PENDENTES-LEDGER`
- Gatilho: 5. `.agents/PENDENTES.md` — ledger de pendências append-only (schema `dex.pendencias.v2`; gatilho `PENDENTES-LEDGER`)
- Extrato: 1. `AGENTS.md`
- Rotas (nomes, na ordem):
  - `AGENTS.md`
  - `.agents/ACTIVE.md`
  - `.agents/HANDOFF.md`
  - `.agents/PLAN-TASKS/ACTIVE.md`
- Fonte: `AGENTS.md#L500-L507`
- Selo: `pb-5dd28a00`

## Runbook <-> Playbook (procedimentos)

- (napkin ausente nesta copia)

## Plano de execucao vigente

-> `.agents/PLAN-TASKS/ACTIVE.md (local)` - nao viaja no clone.

## Fontes e revisao

| caminho | sha256 | Enviado? |
| --- | --- | --- |
| `docs/PLAYBOOK-RULES.md` | `3aebb8df98b19a4c1042973c59e14b0a8cfc728777839caa2f2c40c80e76f92c` | sim |
| `AGENTS.md` | `b8a896755e80b369c861b8a3787a76a67e1815a40c23504c5ab6127754d1aa0a` | nao |
| `.agents/napkin.md` | `d3007760834760203f4b8e64bf43260b9d6152a24cb19d7b67a390560621bbc6` | nao |
| `.agents/PLAN-TASKS/ACTIVE.md` | `98dd6e484895045255a4d303c0b5f6cb35397dc50dbba1fc768d44d39c8e696b` | nao |

## Superficie enviada vs local

- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).
- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).
- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.

## Secoes nao decodificadas

- Organizacao De Artefatos E Scripts -> `AGENTS.md#L238` (sem token de localizador)
- Graphify local -> `AGENTS.md#L418` (sem token de localizador)
- Indexação (doutrina da casa) -> `AGENTS.md#L473` (sem token de localizador)
- Envio a terceiros -> `AGENTS.md#L480` (sem token de localizador)
