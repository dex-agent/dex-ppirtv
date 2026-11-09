---
name: "dex-PPIRTV playbook"
description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."
type: playbook
generated_by: "tools/playbook/generate-playbook.py"
authority: derived_projection
sources_revision: "sha256:a431e0c5ddef632b78574951f62442d05588db6d6a34c5f3eefccb3e7d68d18e"
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
- Fonte: `AGENTS.md#L69-L233`
- Selo: `pb-a4b7a55a`

### Validacao minima

- Localizador: `PPIRTV-CAPACITY-COMMIT-GATE`
- Gatilho: ndeclarado
- Extrato: ```powershell
- Fonte: `AGENTS.md#L263-L285`
- Selo: `pb-c525bb53`

### Ordens diretas do Comandante Owner o $chato 🗣️

- Localizador: `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Gatilho: 2. $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamento da $estacionamento ao lado da $garimpeiro e tudo que for achado MEMORÁVEL...
- Extrato: ### Mandatory live preflight — `PPIRTV-CHATO-LIVE-PREFLIGHT`
- Rotas (nomes, na ordem):
  - Mantenha $garimpeiro e $estacionamento ativos durante todo...
  - $chato 🗣️ quero que o $dex-memoria v2 fique no estacionamen...
  - Ative o fluxo visual PPIRTV com checklist visual dinâmico u...
  - Sempre finalize o trabalho analisando "com lentes dos espec...
- Fonte: `AGENTS.md#L286-L348`
- Selo: `pb-9864e092`

### Dex Agent Local

- Localizador: `PPIRTV-GIT-CONSOLIDACAO-SELETIVA-MAIN`
- Gatilho: - Antes de qualquer consolidacao Git deste repositorio, recupere o gatilho
- Extrato: - Projeto: `dex-PPIRTV`
- Fonte: `AGENTS.md#L349-L393`
- Selo: `pb-234246a9`

### Bootstrap (toda janela nova, nesta ordem)

- Localizador: `TRACKER-LOCAL`
- Gatilho: operar) → `.agents\GATILHOS-VIVOS.md` (hub de gatilhos quentes de reuso).
- Extrato: 1. Leia o AGENTS global: `$env:USERPROFILE\.agents\AGENTS.md` (PowerShell) /
- Rotas (nomes, na ordem):
  - Leia o AGENTS global: `$env:USERPROFILE\.agents\AGENTS.md`...
  - Leia este `AGENTS.md` inteiro.
  - Leia o estado vivo, nesta ordem: `.agents\ACTIVE.md` → `.ag...
  - Gatilhos L1: `.agents\lembranca.md` — abra L2/L3 somente po...
- Fonte: `AGENTS.md#L427-L448`
- Selo: `pb-ea6ceb8a`

### Leitura obrigatoria (bootstrap)

- Localizador: `PENDENTES-LEDGER`
- Gatilho: 5. `.agents/PENDENTES.md` — ledger de pendências append-only (schema `dex.pendencias.v2`; gatilho `PENDENTES-LEDGER`)
- Extrato: 1. `AGENTS.md`
- Rotas (nomes, na ordem):
  - `AGENTS.md`
  - `.agents/ACTIVE.md`
  - `.agents/HANDOFF.md`
  - `.agents/PLAN-TASKS/ACTIVE.md`
- Fonte: `AGENTS.md#L476-L483`
- Selo: `pb-0ab6f570`

## Runbook <-> Playbook (procedimentos)

- (napkin ausente nesta copia)

## Plano de execucao vigente

-> `.agents/PLAN-TASKS/ACTIVE.md (local)` - nao viaja no clone.

## Fontes e revisao

| caminho | sha256 | Enviado? |
| --- | --- | --- |
| `docs/PLAYBOOK-RULES.md` | `3aebb8df98b19a4c1042973c59e14b0a8cfc728777839caa2f2c40c80e76f92c` | sim |
| `AGENTS.md` | `d65c47554bb88f0c236a6d6e0f0a6bc2492371fd0bebffe2bbb5a3e2071edfbd` | nao |
| `.agents/napkin.md` | `f741a49fc3efafbeca3e66f5483d41d4ce29f3b076ed289c3bf1508ce828315f` | nao |
| `.agents/PLAN-TASKS/ACTIVE.md` | `dccfc0060f7dd2e8c5303ea6af378cfec8920410c9598a43cc80cb72d24d3554` | nao |

## Superficie enviada vs local

- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).
- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).
- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.

## Secoes nao decodificadas

- Organizacao De Artefatos E Scripts -> `AGENTS.md#L234` (sem token de localizador)
- Graphify local -> `AGENTS.md#L394` (sem token de localizador)
- Indexação (doutrina da casa) -> `AGENTS.md#L449` (sem token de localizador)
- Envio a terceiros -> `AGENTS.md#L456` (sem token de localizador)
