# Contrato — fechamento de GOAL em worktree compartilhado

## Contrato

### Entradas

- Flow PPIRTV ativo (`.ppirtv/flows/<flow_id>.json`) com `changed_files`
  coletados do worktree VIVO.
- `git status --porcelain -uall` do worktree compartilhado.
- Classificação de proveniência por path: meu Trilho / janela irmã / runtime.
- Trilho/SPT do GOAL corrente (evidências ER-* e critérios).

### Saídas

- Commit(s) seletivo(s) do trabalho do próprio Trilho (pathspec).
- Review estrutural válida cobrindo TODOS os `flow.changed_files`
  (`reviewed_targets` superconjunto) com ressalva nos paths de terceiro.
- `goal_verdict` (tipicamente `pronto_com_ressalvas`) + advance terminal;
  flow COMPLETE.
- Working tree final: trabalho de terceiro ou commitado com receipt da irmã,
  ou vivo no tree com classificação registrada no Trilho.

### Critérios de pronto

- Todo path do `changed_files` tem classe de proveniência declarada.
- `reviewed_targets` ⊇ `flow.changed_files` do JSON na hora da review.
- Fingerprint do gate persistido == fingerprint do flow JSON.
- Verdict registrado com ressalva de proveniência quando há coletado de
  terceiro; advance terminal executado com `memoria_viva_reconciled` real.
- Nenhum commit contém path de terceiro sem receipt/confirmacão da irmã.
