# DOCS

## Regras de manutencao

- `CONTEXT.md` guarda apenas glossario do dominio.
- `SPEC.md` descreve o produto e seus contratos.
- `PLAN.md` mostra fases de implementacao.
- `TASKS.md` e o backlog operacional.
- `SPRINTS.md` agrupa entregas por ciclo.
- `REFERENCE.md` guarda fontes externas, decisoes e links.
- `docs/` contem guias detalhados.
- `docs/adr/` contem decisoes dificeis de reverter.

## Regra de consistencia

Quando uma tool, resource ou prompt mudar, atualizar:

1. `SPEC.md`
2. guia especifico em `docs/`
3. `TASKS.md`
4. `REFERENCE.md`, se houver fonte ou decisao nova

## Regra de evidencia

Nao marcar pronto sem:

- criterio de pronto;
- teste ou limite documentado;
- veredito;
- risco residual.

