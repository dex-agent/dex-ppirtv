# Uso — fechamento de GOAL em worktree compartilhado

## Exemplos executados

- **2026-11-06, flow 3086 (dex-PPIRTV)** — GOAL do Trilho spt-kit: o gate
  rearma `review_required` porque `flow.changed_files` coletou 19 arquivos do
  worktree VIVO, incluindo 3 de janela irmã (`.agents/` de outra sessão).
  Executado: commit seletivo `d500f81` (16 arquivos do Trilho, pathspec);
  review cobrindo os 19 com ressalva de proveniência; verdict `vrd_3136`
  `pronto_com_ressalvas`; fechamento de coerência `d41f2cb` (3 arquivos da
  irmã com receipts reais dela no SYNC-LAB); advance terminal COMPLETE.
  Prova: `git log --format='%h %s' d500f81^..d41f2cb` e o flow JSON de 3086.
- **2026-11-06, fluxo geminado** — mesmo padrão no flow da irmã: o trabalho
  DELA era o "terceiro" do MEU flow e vice-versa; os dois fechamentos de
  coerência se cruzaram sem conflito porque cada um commitou só o próprio
  pathspec na hora própria.
