---
name: "dex-PPIRTV playbook"
description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."
type: playbook
generated_by: "tools/playbook/generate-playbook.py"
authority: derived_projection
sources_revision: "sha256:85622a8738518ff28259b95edf6c39bd4b16800bfb7567103e58d952e0a86ac4"
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
- Fonte: `AGENTS.md#L26-L158`
- Selo: `pb-bec7ea45`

### Validacao minima

- Localizador: `PPIRTV-CAPACITY-COMMIT-GATE`
- Gatilho: ndeclarado
- Extrato: ```powershell
- Fonte: `AGENTS.md#L188-L208`
- Selo: `pb-e0535bab`

### Ordens diretas do Comandante Owner o $chato 🗣️

- Localizador: `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Gatilho: 2. $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamento da $estacionamento ao lado da $garimpeiro e tudo que for achado MEMORÁVEL...
- Extrato: ### Mandatory live preflight — `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Rotas (nomes, na ordem):
  - Mantenha $garimpeiro e $estacionamento ativos durante todo...
  - $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamen...
  - Ative o fluxo visual PPIRTV com checklist visual dinâmico u...
  - Sempre finalize o trabalho analisando "com lentes dos espec...
- Fonte: `AGENTS.md#L209-L271`
- Selo: `pb-6255a0ea`

### Dex Agent Local

- Localizador: `PPIRTV-GIT-CONSOLIDACAO-SELETIVA-MAIN`
- Gatilho: - Antes de qualquer consolidacao Git deste repositorio, recupere o gatilho
- Extrato: - Projeto: `dex-PPIRTV`
- Fonte: `AGENTS.md#L272-L316`
- Selo: `pb-90a8ee46`

## Runbook <-> Playbook (procedimentos)

- (napkin ausente nesta copia)

## Plano de execucao vigente

-> `.agents/PLAN-TASKS/ACTIVE.md (local)` - nao viaja no clone.

## Fontes e revisao

| caminho | sha256 | Enviado? |
| --- | --- | --- |
| `AGENTS.md` | `3a6eeddfb17950416806c18c7889c3b544eef8adb8d652e71d530d03782e1b60` | nao |
| `.agents/napkin.md` | `e54020462ff836a9b393a403f14d3a30afe78b121d92a095fc1e97d9571f0d94` | nao |
| `.agents/PLAN-TASKS/ACTIVE.md` | `e41894ae431458f252d3892baf45ae9f93fccd695006c8df4e2e21b81b1ab2c8` | nao |

## Superficie enviada vs local

- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).
- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).
- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.

## Secoes nao decodificadas

- Organizacao De Artefatos E Scripts -> `AGENTS.md#L159` (sem token de localizador)
- Graphify local -> `AGENTS.md#L317` (sem token de localizador)
- Bootstrap (toda janela nova, nesta ordem) -> `AGENTS.md#L350` (sem token de localizador)
- Indexação (doutrina da casa) -> `AGENTS.md#L368` (sem token de localizador)
- Envio a terceiros -> `AGENTS.md#L375` (sem token de localizador)
