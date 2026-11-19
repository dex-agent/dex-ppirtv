#!/usr/bin/env bash
# merge-resolve-gate.sh — fonte única do gate de RESOLUÇÃO de merge (issue 21
# P1-2, corte C). No fluxo conflito + resolução manual o git chama SÓ o hook
# pre-commit (MERGE_HEAD fica presente no disco até o commit concluir —
# detector exato); no fluxo git merge --continue o pre-merge-commit (A3f) roda
# no mesmo estado. OS DOIS caminhos delegam AQUI — veredito único, sem
# bifurcação. Estado do worktree = resolução já aplicada: a camada comportamental
# (suíte) roda DIRETO nela.
if [ "$MERGE_CHECK_SKIP" = "1" ]; then
  echo "merge-check gate: SKIP por MERGE_CHECK_SKIP=1"
  exit 0
fi

CONF="$(dirname "$0")/merge-check.conf"
SUITE=""
[ -f "$CONF" ] && . "$CONF"
if [ -z "$SUITE" ]; then
  echo "merge-check gate: resolved-merge sem suíte declarada — nada a rodar, exit 0 (P10)"
  exit 0
fi

echo "merge-check gate: resolved-merge, suíte no worktree ($SUITE)"
if ! $SUITE; then
  echo "merge-check gate: FALHOU — suíte vermelha no worktree resolvido"
  echo "  inspecione fora do hook: $SUITE"
  exit 1
fi
exit 0
