# Regras — fechamento de GOAL em worktree compartilhado

## Regras

- R1: toda leitura de `changed_files`/fingerprint vem do flow JSON por
  variável; valor digitado à mão é invenção e o runtime persiste o digitado.
- R2: commit é sempre seletivo por pathspec classificado por proveniência;
  `git add -A`/`.` em worktree compartilhado é proibido.
- R3: trabalho de janela irmã só entra em commit com confirmação/receipt real
  da irmã (fechamento de coerência); sem confirmação, permanece no working
  tree com classificação registrada.
- R4: a review estrutural cobre o COLETADO (`reviewed_targets` superconjunto
  de `flow.changed_files`), não o commitado; paths de terceiro ganham
  ressalva de proveniência, não omissão.
- R5: gate_check é reexecutado COMPLETO na fase correta após qualquer
  reancoragem — chamada incompleta sobrescreve o `passed` persistido.
- R6: veredito com trabalho de terceiro no coletado é `pronto_com_ressalvas`
  por padrão; a ressalva nomeia owner e paths.

## Limites

- Este workflow não autoriza push (gate final do dono) nem edição de trabalho
  de terceiro; ele fecha o MEU flow deixando o alheio vivo e classificado.
- Runtime de terceiro (`.ppirtv/`, caches) é redigido pelo próprio runtime;
  este workflow não lê nem ecoa conteúdo desses paths.
