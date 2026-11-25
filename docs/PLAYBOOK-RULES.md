# Regras publicadas no PLAYBOOK

## Painel de Ferramentas
- `PAINEL-DE-FERRAMENTAS`
- Gatilho: na retomada e antes de implementar, consulte as ferramentas e rotas de conhecimento já disponíveis para o projeto.
1. Abra o índice de documentação (`docs/INDEX.md`, na raiz do repositório) para localizar ferramentas, contratos e guias.
2. No ambiente de trabalho, consulte o painel local em `AGENTS.md` quando disponível.

## Documentação publicada e localizável
- `PPIRTV-DOCUMENTACAO-PUBLICADA-ACHAVEL`
- Gatilho: ao publicar guia, FAQ, runbook ou contrato explicativo, confira se o destinatário consegue encontrá-lo.
1. Vincule o documento no README, no índice de documentação e no mapa da raiz. Registre a rota de uso em `AGENTS.md`.
2. Valide a busca pelo título ou localizador e confira os links no clone entregue.
3. Confirme que o Git leva o documento: `git ls-files --error-unmatch -- <caminho>` e `git cat-file -e HEAD:<caminho>` saem com código 0 (índice e commit). Qualquer outro código não é publicado. Este repositório ignora `docs/*` por padrão: documento novo em `docs/` exige exceção nomeada no `.gitignore`, escrita depois da regra.
