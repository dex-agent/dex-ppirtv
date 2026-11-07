---
schema: dex.spt.v3
versao: 1
status: ativo
dono: dex-PPIRTV
fonte-viva: 'contracts/GOAL_SPT_CANONICAL_CONTRACT.md (contrato) + src/spt-contract.ts (zod executavel) + templates/SPEC-PLAN-TASKS.template.md (template) + spt-kit/ (molde, regras, guia, preflight)'
registro: 'rev 3 (2026-11-06, corte spt-kit-cobertura-total: header do MOLDE inequivoco — copiar o BLOCO YAML, nunca o arquivo integral, que gera S00; GUIA e contratos alinhados; preflight ganha S00 com diagnostico, tolerancia a BOM e S10 de shape dos 21 campos); rev 2 (2026-10-31, cura uncertainties — molde ensinava remover campo que o schema exige min 1 item; GO do dono, Trilho skills 2026-10-31-mover-porta-padrao); MOLDE.md sha256:a7e2a2be453f0a4d8bfaa3b15e85b67652d3b338659fb042773b106a829666a9'
---

# dex.spt.v3 — Trilho/SPT SPEC-PLAN-TASKs versão 3

## Identificação

Schema do artefato executor `SPT/Trilho v3`: arquivo Markdown com front matter
YAML estrito (grafo `requirements → criteria → tasks → evidence_requirements`),
corpo humano livre depois do fechamento. Válido por `scripts/validate-spt.mjs`
(zod) e conferido por `spt-kit/preflight.mjs` (regras R1-R08 + anti-drift S09).

## Campos (21)

`dex_contract: spt`, `version: 3`, `status`, `owner`, `date`, `workspace`,
`origin`, `goal{id,title,objective}`, `context`, `problem`, `decision`,
`scope{include,exclude}`, `requirements[]`, `plan[]`, `tasks[]`,
`closure_gates[]`, `risks[]`, `uncertainties[]`, `gates[]`, `validation[]`,
`execution_prompt`.

Expectation tipada: `boolean_assertion | command_exit | hash_equality |
measurement | text`.

## Regras de geração (R1-R08) e anti-drift

Ver `spt-kit/RULES.md`. Codes S01..S09 emitidos pelo preflight.

## Onde nasce um SPT novo

Preencher `spt-kit/MOLDE.md` (nunca redigir de cabeça); ordem e gate único em
`spt-kit/GUIA.md`; verde de primeira é o contrato do kit.

## Mudanças neste schema

Alterou contrato/molde → atualizar o sha256 do MOLDE.md no `registro` acima NO
MESMO COMMIT e rodar `preflight.mjs --checksum spt-kit/MOLDE.md`. Supersede
exige rev nova aqui + registro no tema `schema-padrao` da casa.
