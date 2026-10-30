# RULES SPT v3 — regras de geração R1-R08 (uma verificação cada)

Cada regra é citável por ID em receipts e verificada pelo `preflight.mjs` (código Snn).

Honestidade de cobertura: S00/S04/S05/S06 **antecipam localmente** checagens que o
validador oficial também faz — seu valor é velocidade local e taxonomia uniforme de
erro, NÃO garantia extra. S03 é sentinela lexical (pega padrões conhecidos), não
prova matemática de condição única.

## R1: prova dentro do done_when
Todo `evidence_requirements[].proves` cita só critérios presentes no `done_when` da própria task.
Verificação: preflight compara `proves` contra `done_when` e acusa **S01**.

## R2: critério dentro do covers
Todo critério de `done_when` pertence a um REQ listado no `covers` da mesma task.
Verificação: preflight cruza `done_when` com o mapa critério→REQ e acusa **S02**.

## R3: um critério, uma condição
Cada `criteria[].statement` traz UMA condição verificável, sem segunda oração com verbo.
Verificação: preflight detecta segunda oração após " e " ou ";" e acusa **S03**.
Cobertura declarada: sentinela de padrões CONHECIDOS de critério inchido — não prova
que o critério tem uma condição; atomicidade completa permanece checagem de agente.
shortcut: heurística lexical; lapidar quando houver corpus maior de falsos positivos.

## R4: expectation tipada
Todo `expectation.kind` é um dos cinco tipos canônicos com campo obrigatório preenchido.
Verificação: preflight confere kind e campo (boolean→`expected`, command→`expected_exit_code`) e acusa **S04**.

## R5: fechamento separado de produto
`closure_gates` existe, não vazio, e carrega só gates de fechamento — nunca critério de produto.
Verificação: preflight exige a lista presente e não vazia e acusa **S05**.
Cobertura declarada: presença apenas — separar fechamento de produto é julgamento
de agente; nenhum check mecânico decide o conteúdo de um closure_gate.

## R6: gates do plano declarados
A lista `gates` declara os gates de execução do próprio trilho (validação antes de avançar).
Verificação: preflight exige a lista presente e não vazia e acusa **S06**.
Cobertura declarada: presença apenas — cooperadores vivos são planejamento do
agente; o check não verifica quem foi convocado nem se compareceu.

## R7: line-feeds LF
O arquivo usa apenas LF; CRLF já matou molde inteiro na história da casa.
Verificação: preflight varre bytes em busca de `\r\n` e acusa **S07**.

## R8: IDs estáveis
IDs seguem `REQ-n`, `C-n`, `A-n`, `ER-n`, sem duplicatas, em todo o grafo.
Verificação: preflight confere o padrão e a unicidade e acusa **S08**.

## S09: anti-drift do molde (fora da numeração R)
O sha256 de `MOLDE.md` é registrado em `SCHEMA/dex.spt.v3.schm.md`.
Verificação: `preflight.mjs --checksum <arquivo>` compara e acusa **S09** em divergência.
