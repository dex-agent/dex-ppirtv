---
name: "dex-PPIRTV playbook"
description: "Regras de decisao e procedimentos deste projeto - projecao gerada das fontes citadas. Nao editar a mao."
type: playbook
generated_by: "tools/playbook/generate-playbook.py"
authority: derived_projection
sources_revision: "sha256:4731f9839652689033c395ae8228864312de530c6b34ce4ca374a32c229a67a6"
sent_revision: "sha256:4168c941ed6490071348f65b62ea8abab2c9d42238f2726d6e3042c5986d82e0"
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
  - Abra o índice de documentação (`docs/INDEX.md`, na raiz do...
  - No ambiente de trabalho, consulte o painel local em `AGENTS...
- Fonte: `docs/PLAYBOOK-RULES.md#L3-L8`
- Selo: `pb-72414c9b`

### Documentação publicada e localizável

- Localizador: `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL`
- Gatilho: ao publicar guia, FAQ, runbook ou contrato explicativo, confira se o destinatário consegue encontrá-lo.
- Rotas (nomes, na ordem):
  - Vincule o documento no README, no índice de documentação e...
  - Valide a busca pelo título ou localizador e confira os link...
  - Confirme que o Git leva o documento: `git ls-files --error-...
- Fonte: `docs/PLAYBOOK-RULES.md#L9-L14`
- Selo: `pb-bb6ed9b2`

## Runbook <-> Playbook (procedimentos)

- (napkin ausente nesta copia)

## Plano de execucao vigente

-> `.agents/PLAN-TASKS/ACTIVE.md (local)` - nao viaja no clone.

## Fontes e revisao

| caminho | sha256 | Enviado? |
| --- | --- | --- |
| `docs/PLAYBOOK-RULES.md` | `0230fe2800fb45c04483fc36a3eb8c081fba33d05e0d788a3bdb5bb308feb7ad` | sim |
| `AGENTS.md` | `8bac3dc0c140d45dd6f21069dd533cca7d104f74537a4d42b688f33930e7ec57` | nao |
| `.agents/napkin.md` | `ef0599140f79c0b583648fc2786f21876ee944520c0f1e94012eb0ffabdaec65` | nao |
| `.agents/PLAN-TASKS/ACTIVE.md` | `61d10b587a2c414721992bc32a60363fb3b5d6922e69893455bfd5d525bbcf8c` | nao |

## Superficie enviada vs local

- O clone entrega: raiz commitada (fontes enviadas, PLAYBOOK.md, PLAYBOOK.index.json, tools/).
- Nao viajam: `.agents/` inteiro (napkin, trilhos, auditorias) - itens marcados (local).
- Como reagir: regra completa esta na fonte enviada; procedimento (local) pede data e localizador ao dono.

## Secoes nao decodificadas

- Painel de Ferramentas -> `AGENTS.md#L26` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Regras locais -> `AGENTS.md#L69` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Organizacao De Artefatos E Scripts -> `AGENTS.md#L262` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Validacao minima -> `AGENTS.md#L311` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Ordens diretas do Comandante Owner o $chato 🗣️ -> `AGENTS.md#L334` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Dex Agent Local -> `AGENTS.md#L397` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Graphify local -> `AGENTS.md#L442` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Bootstrap (toda janela nova, nesta ordem) -> `AGENTS.md#L475` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Indexação (doutrina da casa) -> `AGENTS.md#L497` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Envio a terceiros -> `AGENTS.md#L504` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
- Leitura obrigatoria (bootstrap) -> `AGENTS.md#L524` (sem localizador declarado (no titulo, numa linha 'Localizador:' ou sozinho na primeira bala))
