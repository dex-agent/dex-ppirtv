# SCHEMA — porta de entrada (desmontagem-monolito-ondas)

Sem executor `.zcode/workflows/*.dwf.ts` — a família `rota`/`fNN` não nasce (rev 1.7: gatilho único é o executor); ao ganhar executor, a família nasce na mesma sessão.

## Entradas

- `alvo`: monólito/recorte (default `src/flow-engine.ts`).
- `onda`: cluster do mapa (ex.: `3a-copia-goal-start`, `sentinela-3792`, `meetings`).
- `trilho`: path do SPT aprovado da onda (obrigatório; `spt_validate` verde).
- `capture`: identificador do corte (formato `desmontagem-antes|depois-<sha-curto>`).

## Saídas

- commit `<sha-onda>` (onda + CAPACITY/receipt + docs no mesmo commit seletivo).
- receipt capture-cut ANTES (sessão) e DEPOIS (por onda) com `built_at == HEAD` do respectivo corte.
- comparação de capacidades (classes exatas por oracle) arquivada no MAPAS.
- mapa de decisões atualizado (D-xx + evento) + CHANGELOG + marker de camping.

## Critérios rotulados (criterios de pronto)

- C-ESTRUTURA: onda inteira do cluster; lógica nova fora do monólito.
- C-PROVA: RED→GREEN pelo oráculo; behavior_preserved_by no ledger de camping.
- C-FOTOGRAFIA: capture antes/depois com 3 números conferindo; ANTES preservada.
- C-COMPARACAO: nenhuma degradada sem causa-raiz registrada e decisão no mapa.
- C-CERIMONIA: verdict + advance terminal do flow da onda; fila atualizada.

## Convenções internas

- receipts: `.agents/receipts/manutencao-continua/<capture>/receipt.json` (formato do irmão manutencao-iterativa; mesma ferramenta capture-cut.py).
- mapas: `.agents/MAPAS/{capacidades,decisoes}-<alvo>-<sha>.md`.
