# GUIA SPT-Kit — 1 página

## Instalar
1. Aponte para este kit (path central) OU copie `spt-kit/` para `<workspace>\.agents\spt-kit\`.
2. Dependência: Node com o pacote `yaml` (já presente no repo dex-PPIRTV).

## Criar um SPT (ordem)
1. Copie `MOLDE.md` para `<workspace>\.agents\PLAN-TASKS\YYYY-MM-DD-<slug>.md`.
2. Preencha TODO-PREENCHER na ordem: goal → escopo → requisitos/critérios → tasks → ER.
3. Um critério = UMA condição; toda prova cita critério do próprio done_when.
4. Expectation tipada; comando literal com exit esperado.

## Gate único (antes de qualquer goal_start)
```
node spt-kit/preflight.mjs <seu-spt.md>
node scripts/validate-spt.mjs --workspace <workspace> --spt-path <seu-spt.md>
```
Verde = `achados=0` + `valid=true`. Vermelho = corrija o campo apontado e rode de novo.

## Anti-drift
`node spt-kit/preflight.mjs --checksum spt-kit/MOLDE.md` — S09 = molde divergente do registro.

## Quando o SPT muda
Edite, rode o gate novamente; nunca avance com preflight vermelho.
Molde/contrato mudaram? Atualize o sha256 no `SCHEMA/dex.spt.v3.schm.md` no mesmo commit.
