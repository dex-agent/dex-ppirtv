---
schema: dex.workflow.v1
slug: fechamento-goal-worktree-compartilhado
version: 1.0.0
status: ativo
owner: executor PPIRTV; revisor de fechamento
created: 2026-11-06
updated: 2026-11-06
origem: Trilho .agents/PLAN-TASKS/2026-11-06-faxina-dividas-estacionadas.md (flow_20261106220636718_3171_0001); decifrado no flow 3086 (vrd_3136, commits d500f81+d41f2cb)
---

# Fechamento de GOAL em worktree compartilhado — PPIRTV

Documentos irmãos: [RULES.md](RULES.md) · [SCHEMA/SCHEMA.md](SCHEMA/SCHEMA.md) · [USAGE.md](USAGE.md) · [CHANGELOG.md](CHANGELOG.md) · [CAPACITY.md](CAPACITY.md)

## Promessa

Fechar um GOAL PPIRTV (gate → review → verdict → advance terminal) quando o
`flow.changed_files` coleta o worktree VIVO e ele contém trabalho de janela
paralela (irmã), sem perder nem commitar trabalho de terceiro sem confirmação.

## Quando usar

- Use quando: GOAL correndo em repo com trabalho paralelo NÃO commitado no
  working tree (janela irmã, stashes vivos, arquivos untracked de outra
  sessão) e o gate de implementação/revisão acusa `review_required` que
  "rearma" a cada advance.
- Use quando: o diff do seu Trilho e o diff do worktree divergem e o runtime
  fiscal aponta arquivos que você não escreveu.
- NÂO use quando: o worktree está limpo (só o seu diff) — cerimônia padrão
  basta; este workflow não adiciona nada.
- NÂO use quando: o trabalho de terceiro é ruído confirmado descartável
  (resíduo auditado) — trate como lixo com trilha, não como worktree
  compartilhado.

## Pré-requisitos

- GOAL oficial ativo com flow PPIRTV em fase implementação/revisão
  (MCP `mcp__dex_ppirtv__*` vivo ou harness `scripts/call-mcp-tool.mjs`).
- Flow JSON legível (`.ppirtv/flows/<flow_id>.json`) — TODA leitura de
  fingerprint/changed_files por variável, nunca digitada à mão.
- `git status --porcelain` do worktree lido e classificado por proveniência
  (meu Trilho × terceiro × runtime).
- Janela irmã identificável (owner humano/sessão) quando há trabalho vivo
  de terceiro — fechamento de coerência exige confirmação DELA.

Comando de entrada (classificação do worktree):

```bash
git status --porcelain=v1 -uall
node -e "const f=require('./.ppirtv/flows/<flow_id>.json'); console.log(f.changed_files.join('\n'))"
```

## Passos

1. Leia o `changed_files` do flow JSON e o `git status` do worktree; classifique
   cada path por proveniência: (a) do meu Trilho, (b) de janela irmã, (c) de
   runtime (`.ppirtv/`, caches — redigido pelo próprio runtime).
   ✅ Verificação: cada path tem uma classe declarada; nenhum path "sem dono".

2. Faça o commit SELETIVO do seu trabalho por pathspec — `git add -- <paths
   do meu Trilho>` + commit; NUNCA `git add -A`/`.` em worktree compartilhado.
   ✅ Verificação: `git show --stat HEAD` contém só paths da classe (a);
   trabalho da irmã continua no working tree intocado.

3. Ancore o gate de implementação com `provided.changed_files` = lista COMPLETA
   coletada do flow (todas as classes) e avance; o fingerprint recalculado
   passa a cobrir o coletado, não o commitado.
   ✅ Verificação: gate retorna fingerprint não-stale; advance não rearma
   `review_required` com lista nova.

4. Escreva a review estrutural (kind `code_review`) cobrindo TODOS os
   `flow.changed_files` em `reviewed_targets` — superconjunto não dói.
   Arquivos da irmã: revise o que der, DECLARE ressalva de proveniência
   (autor terceiro, review parcial) no `observed_result`.
   ✅ Verificação: `satisfies` cobre `diff_reviewed` + `barata_scan`;
   `scope_reference` aponta 1 path; `reviewed_targets` ⊇ `changed_files`.

5. Reancore o gate de revisão COMPLETO (uma chamada incompleta na fase errada
   SOBRESCREVE o `passed` persistido) e avance para validação.
   ✅ Verificação: gate_check da fase revisão com resultado `passed`
   persistido; fingerprint do gate == fingerprint do flow JSON.

6. Registre o verdict com `evidence_ids` = evidências ER-* + a ÚLTIMA review
   válida; veredito esperado `pronto_com_ressalvas` quando há trabalho de
   terceiro no coletado (a ressalva É a honestidade do fechamento).
   ✅ Verificação: verdict aceito; ressalva nomeia a irmã e os paths dela.

7. Fechamento de coerência: comunique a janela irmã (owner humano) e commit os
   paths DELA apenas com confirmação/receipt real dela — ou deixe no working
   tree para a própria irmã fechar. Registre a decisão no Trilho.
   ✅ Verificação: commit de coerência (se houver) traz receipts da irmã no
   corpo; working tree final sem trabalho órfão sem classificação.

8. Termine a cerimônia: attach pós-verdict + re-mining + gate de validação
   (com `memoria_viva_reconciled` da cadeia memoria-viva) + advance terminal.
   ✅ Verificação: flow COMPLETE; checklist visual 100% com saídas reais.

## Meta-analise questionadora

- quando: fechamento de GOAL cujo `flow.changed_files` coleta o worktree VIVO compartilhado com janela irmã (trabalho paralelo não commitado).
- perguntas: E SE?? a irmã commitar no meio do meu verdict (sha256+git log antes; se mudou, re-ateste 1x e cite só a prova fresca) · E SE?? o fp do gate divergir do flow JSON (prevalece o JSON; fp digitado à mão é final inventado e o runtime persiste o digitado) · E SE?? a irmã descartar o trabalho antes do advance terminal (fingerprint ancora no coletado; declare divergência coletado×disco com data) · E SE?? review_required rearma em loop (relaia `flow.changed_files` do JSON — a review cobre a lista ATUAL).
- oraculo: $chato fiscal de fechamento + $questionador (E SE?? adversarial); causa-raiz decifrada no flow 3086 (gate-resolution.ts isStructuredReviewEvidence/needsReviewCoherence).
- impacto: sem este método o flow NÃO fecha (review_required rearma a cada advance) ou fecha engolindo trabalho de terceiro sem confirmação.
- retorno: verdict `pronto_com_ressalvas` com ressalva de proveniência; working tree 100% classificado; irmã fecha o próprio fluxo sem conflito de commit.
- registro: flow 3086 (vrd_3136; commits d500f81+d41f2cb); Trilho 2026-11-06-faxina-dividas-estacionadas task A-06; espelho memória ppirtv-flow-worktree-compartilhado-review-cobre-coletado.
- avanco: reusar na próxima sessão com worktree compartilhado; medir com 3+ janelas paralelas antes de generalizar; promover o molde de ressalva de proveniência para a cerimônia canônica quando houver 2 fluxos confirmados.

## Gotchas

- `review_required` rearma a cada advance → tropeço: repetir a mesma review;
  Faça em vez disso: releia `flow.changed_files` do JSON e cubra a lista nova.
- Commitar tudo com `git add -A` → tropeço: engole trabalho de terceiro sem
  confirmação; Faça em vez disso: pathspec seletivo por classe de proveniência.
- Review só do MEU diff → tropeço: gate fiscal reprova (`needsReviewCoherence`);
  Faça em vez disso: `reviewed_targets` superconjunto dos changed_files com
  ressalva de proveniência nos paths de terceiro.
- Confiar no exit 0 do gate → tropeço: chamada incompleta na fase errada
  persiste `passed` falso; Faça em vez disso: re-rodar o gate COMPLETO na fase
  certa e conferir o fp persistido contra o flow JSON.
