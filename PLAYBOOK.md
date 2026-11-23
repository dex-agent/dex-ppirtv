---
name: "dex-PPIRTV playbook"
description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."
type: playbook
generated_by: "tools/playbook/generate-playbook.py"
authority: derived_projection
sources_revision: "sha256:28d7b2e7f94aa842457891f9fea510a613225c74643b073c5c718868cf53fac5"
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
- Gatilho: na retomada e antes de implementar, consulte as ferramentas e rotas de conhecimento já disponíveis para o projeto.
- Rotas (nomes, na ordem):
  - Abra [o índice de documentação](INDEX.md) para localizar fe...
  - No ambiente de trabalho, consulte o painel local em `AGENTS...
- Fonte: `docs/PLAYBOOK-RULES.md#L3-L8`
- Selo: `pb-72414c9b`

### Documentação publicada e localizável

- Localizador: `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL`
- Gatilho: ao publicar guia, FAQ, runbook ou contrato explicativo, confira se o destinatário consegue encontrá-lo.
- Rotas (nomes, na ordem):
  - Vincule o documento no README, no índice de documentação e...
  - Valide a busca pelo título ou localizador e confira os link...
- Fonte: `docs/PLAYBOOK-RULES.md#L9-L13`
- Selo: `pb-e48a5b0f`

## Runbook <-> Playbook (procedimentos)

- (napkin ausente nesta copia)

## Plano de execucao vigente

-> `.agents/PLAN-TASKS/ACTIVE.md (local)` - nao viaja no clone.

## Fontes e revisao

| caminho | sha256 | Enviado? |
| --- | --- | --- |
| `docs/PLAYBOOK-RULES.md` | `3aebb8df98b19a4c1042973c59e14b0a8cfc728777839caa2f2c40c80e76f92c` | sim |
| `AGENTS.md` | `5aa0e4500535c5277ef7c19cb3863634bcc3a7f08830bad330b0af7778133f2b` | nao |
| `.agents/napkin.md` | `13b4a2aebef108b99c6dc7b29334ee8d301eed4c1cce523a0ea7d4c0a96f7a7f` | nao |
| `.agents/PLAN-TASKS/ACTIVE.md` | `cf111cbe2deef0606fd5d0498c3e9a4344e147c12e41211f6c72a3d286bf944b` | nao |

## Superficie enviada vs local

- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).
- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).
- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.

## Secoes nao decodificadas

- Painel de Ferramentas -> `AGENTS.md#L26` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Regras locais -> `AGENTS.md#L69` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Organizacao De Artefatos E Scripts -> `AGENTS.md#L240` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Validacao minima -> `AGENTS.md#L289` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Ordens diretas do Comandante Owner o $chato 🗣️ -> `AGENTS.md#L312` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Dex Agent Local -> `AGENTS.md#L375` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Graphify local -> `AGENTS.md#L420` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Bootstrap (toda janela nova, nesta ordem) -> `AGENTS.md#L453` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Indexação (doutrina da casa) -> `AGENTS.md#L475` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Envio a terceiros -> `AGENTS.md#L482` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Leitura obrigatoria (bootstrap) -> `AGENTS.md#L502` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
