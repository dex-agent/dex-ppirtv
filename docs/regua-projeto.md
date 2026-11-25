---
schema: regua-projeto-casa
versao: 1
status: candidata
projeto: dex-ppirtv
dono: o dono do repositorio dex-PPIRTV (aprova a promocao de candidata para ativa)
regua-global: dex-regras-desenvolvimento-casa
stacks: [typescript, powershell, python]
medido_em: af6ddd7
medido_em_data: 2026-11-23
---

# Réguas de Desenvolvimento do projeto dex-PPIRTV

Vale para o repositório dex-PPIRTV na revisão `af6ddd7`: como as regras globais e as réguas de stack valem AQUI, com comando, custo medido, ordem e exceção. Não repete nenhuma regra global.

Versão: 1.0.0 · Data: 2026-11-23 · Estado: candidata

## 1. Escopo e autoridade

- **Vale para:** o código do produto (`src/`, TypeScript), as ferramentas de gate
  (`tools/`, `spt-kit/`, Python e Node) e a bancada (PowerShell) do dex-PPIRTV,
  na revisão `af6ddd7`.
- **Hierarquia:** regras globais (R1–R20, canônicas no SKILL da skill
  `dex-regras-desenvolvimento-casa`) → réguas de stack
  (`references/regua-typescript.md`, `references/regua-powershell.md`,
  `references/regua-python.md`) → esta régua. Cada linha daqui cita o número da
  regra que aplica; nenhuma é repetida.
- **O que esta régua NÃO faz:** não muda regra; não substitui os contratos do
  projeto (`AGENTS.md`, Trilho, regras de acampamento do `flow-engine.ts`);
  não instala ferramenta; não embute medidor.
- **Evidência local vence:** regra que contradizer medição daqui vira exceção
  declarada na seção 2.6, com dono e quando. Nunca silêncio.
- **Bússola e GPS:** a régua global dá a direção; esta dá latitude e longitude
  deste repositório. O método do passo é a escala em
  `references/regua-escala-do-passo.md` da skill global.

## 2. Critérios e provas (as coordenadas)

### 2.1 Escala do passo, calibrada aqui

Custos medidos em 2026-11-23 na revisão `af6ddd7`: `npm run check:types` = 5 s;
`npm test` = 191 s (105 arquivos, 1136 aprovados, 4 pulados); um arquivo de
teste isolado (`npx vitest run tests/<arquivo>`) ≈ 0,6 s.

| Nível | Um passo é | Prova no passo (comando) | Custo medido | Reversão | Processo |
| --- | --- | --- | --- | --- | --- |
| Toque | um símbolo, sem comportamento novo | `npm run check:types` | 5 s (2026-11-23, af6ddd7) | `git revert` do commit | sem Trilho (até 2 passos) |
| Lapidação cirúrgica | um eixo, comportamento novo e local | `npx vitest run tests/<arquivo> && npm run check:types` | 0,6 s por arquivo + 5 s (2026-11-23, af6ddd7) | `git revert` do commit | Trilho; itens independentes podem formar lote, cada um com commit e prova |
| Corte | um eixo que cruza arquivos ou irmãos | testes do eixo + `npm run check:types` + vigília por reversão da cura | nao_medido (proxies: 0,6 s por arquivo, 5 s) | `git revert` do commit | Trilho próprio |
| Onda | um cluster inteiro, com tipos e suíte de rede | `npm run check:flow-engine` + `npm test` | nao_medido (a suíte: 191 s, 2026-11-23, af6ddd7) | `git revert` do commit | Trilho dedicado (ledger de acampamento) |
| Maratona | sequência de ondas de um mapa prévio | por onda | nao_medido | por onda | Trilho-mestre + ondas |

### 2.2 Por momento

**Antes de escrever algo novo** (R3 → R7 → R4/R5 → R10)

| Regra | Neste projeto | Comando | Custo | Evidência |
| --- | --- | --- | --- | --- |
| R3 | trabalho de 3+ passos nasce de Trilho em `.agents/PLAN-TASKS/`; preflight do `spt-kit` antes de `goal_start` | `node spt-kit/preflight.mjs <trilho>` | nao_medido | o Trilho |
| R5 | raio de impacto e fronteiras pelo grafo do código | `code-review-graph impact` e `code-review-graph query` | nao_medido | `.agents/CODE-REVIEW-GRAPH-INDEX.md` |
| R10 | a verificação nasce com o código | `npx vitest run tests/<arquivo>` | 0,6 s por arquivo (2026-11-23, af6ddd7) | `tests/` |

**Ao mudar código existente** (R2 → R1 → R8)

| Regra | Neste projeto | Comando | Custo | Evidência |
| --- | --- | --- | --- | --- |
| R2 | sem teste = teste de caracterização antes; tipocheck e execução são provas distintas | `npx vitest run tests/<arquivo>` | 0,6 s por arquivo (2026-11-23, af6ddd7) | `tests/` |
| R1 | tamanho do passo pela escala (seção 2.1): no bloco denso, um eixo por Trilho, um passo por commit | conferência por leitura no Trilho | nao_medido | o Trilho |
| R8 | o que degradou e não foi registrado vira pendência ou Trilho | `rg` e o pre-commit | nao_medido | `.agents/PENDENTES.md` |

**Ao revisar** (R4/R5 → R6 → R9 → R8)

| Regra | Neste projeto | Comando | Custo | Evidência |
| --- | --- | --- | --- | --- |
| R4 | complexidade e aninhamento do que foi tocado | `medir_cc_engine.py --escopo projeto --raiz src --format json` | nao_medido | saída do motor (ficha `medir-cc-engine`) |
| R6 | duplicação: só `.py` tem medidor e gate; em TypeScript é leitura com a lente | `python -B tools/check-duplicacao-delta.py` | no pre-commit | recibo do pre-commit |
| R9 | regex sobre texto livre em gate: o detector lista; o julgamento é da revisão | `medir-toxicidade.py <arquivo> --json` | nao_medido | `julgamento: pendente` da saída |

**Ao criar, ajustar ou portar ferramenta** (R18 → R20 → R17)

| Regra | Neste projeto | Comando | Custo | Evidência |
| --- | --- | --- | --- | --- |
| R18 | livro de ferramentas na raiz antes de criar | `python -B "$USERPROFILE/.agents/skills/dex-toolsbook/scripts/toolsbook.py" --repo . --buscar TOOLSBOOK.json --termos <palavra>` | nao_medido | `TOOLSBOOK.index.md` |
| R17 | mecanismo novo só entra no hook com custo medido: 5 s entrou no commit; 191 s ficou no CI | cronômetro do comando | 5 s e 191 s (2026-11-23, af6ddd7) | seção 2.3 |

### 2.3 O que é "verde" aqui

| Momento | O que roda | Comando | Custo |
| --- | --- | --- | --- |
| No commit | os 5 gates do pre-commit e o gate de capacidade | `sh tools/playbook/hooks/pre-commit` e `npm run check:capacity -- --staged` | nao_medido |
| No CI | instalar, build, tipos, suíte, auditoria canônica, capacidade — matrix Windows e Ubuntu | `.github/workflows/ci.yml` | tipos: 5 s; suíte: 191 s (2026-11-23, af6ddd7); o resto nao_medido |
| Ao fechar um Trilho | `goal_verdict` com evidências e `memoria_viva_reconciled` depois da cadeia `memoria-viva` | cerimônia do PPIRTV | nao_medido |

### 2.4 Tipos de teste, calibrados aqui

Régua: `references/regua-tipos-de-teste.md` da skill global. Proporção por tipo
ainda não foi medida: é `nao_medido`.

| Tipo | Quando é obrigatório | Teto de custo medido | Proporção medida | Onde roda |
| --- | --- | --- | --- | --- |
| unitario | regra pura, sem fronteira real | 0,6 s por arquivo (2026-11-23, af6ddd7) | nao_medido | `tests/*.test.ts` |
| integracao | contrato entre módulos ou com o disco (lock, arquivos) | nao_medido | nao_medido | `tests/` |
| regressao | bug fechado (GitHub ou TRACKER): o teste fixa a classe, não a instância | nao_medido | nao_medido | `tests/` |
| caracterizacao | antes de mexer em código sem teste (`src/flow-engine.ts`) | nao_medido | nao_medido | `tests/` |

### 2.5 Tropeços pagos

| Data | Tropeço | Regra | Evidência | O que mudou |
| --- | --- | --- | --- | --- |
| 2026-11-23 | esta instância nasceu ignorada pelo Git (`.gitignore:29`, regra `docs/*`) e o fiscal respondia `forma_ok` | R16 | `git check-ignore -q docs/regua-projeto.md` (hoje: código 1); ISSUE-LOCAL-0050 do TRACKER | exceção `!docs/regua-projeto.md` no `.gitignore`; o fiscal da régua (hoje 1.2.0) reprova instância ignorada e instância fora do índice; a regra de "documentação publicada" passou a exigir que o Git leve o arquivo |
| 2026-11-23 | o índice publicado linkava arquivo que o Git ignora: em clone limpo do HEAD, 3 de 100 links locais não têm destino; "publicado" estava escrito em três lugares, sem comando | R16 | clone do HEAD af6ddd7 + resolução dos links dos 69 .md rastreados; ISSUE-LOCAL-0050 do TRACKER | as três definições dizem o mesmo, com `git ls-files --error-unmatch` e `git cat-file -e HEAD:` (código 0); o link que nascia quebrado no PLAYBOOK saiu na fonte; ADR 0007 e `INDEX.md` da raiz versionados (decisão do dono); prova a frio da árvore pós-commit: 100 links, 0 quebrados |
| 2026-11-23 | um Trilho com quatro mecanismos independentes (registro de regressão, classificador de runs, classe do lock, gates do pre-commit); 12 de 15 runs vermelhos eram erro conhecido repetido | R1 | `.agents/PLAN-TASKS/2026-11-23-regressao-erros-conhecidos.md` | recorte pela escala do passo: um eixo por Trilho |
| 2026-11-23 | o detector de toxicidade respondia "sem regex" em arquivo TypeScript com 25 linhas de regex | R13 | `medir-toxicidade.py` do registry (cura na skill dona) | lista JS/TS por forma, com julgamento pendente |
| 2026-11-23 | teste de classe do lock: 168 falhas em cascata por um caso que deixou resposta enfileirada no mock | R2 | `tests/lock-classe-transitorios.test.ts` | limpeza das filas após cada caso e premissa do gerador |
| 2026-11-22 | sha de ficha × fim de linha derrubou o CI duas vezes | R16 | runs vermelhos na `main`; motor do livro de ferramentas | o motor ignora fim de linha desde 2026-11-23 |

### 2.6 Exceções declaradas

Nenhuma em 2026-11-23. Pendência de decisão do dono (não é exceção): virar
catraca as medidas que hoje só são relatadas — complexidade acima de 10: 65
funções; 50 linhas ou mais: 108; candidatos a código morto: 12; aninhamento
acima de 3: 2.

| Regra | Evidência local | Dono | Quando revisa |
| --- | --- | --- | --- |

## 3. Rota de manutenção sem duplicação

- **Donos dos instrumentos usados aqui:** livro de ferramentas do registry
  (`~/.agents/skills/TOOLSBOOK.json`: `medir-cc-engine`, `verificar-teto-cc`,
  `medir-toxicidade`, `medir-coesao`, `medir-duplicacao`, `medir-fonte-dona`,
  `crg-cli`) e livro do próprio repo (`TOOLSBOOK.json` na raiz) — ponteiros,
  nunca cópia.
- **Onde consultar o repertório aqui:** `TOOLSBOOK.index.md` na raiz e
  `toolsbook.py --buscar` (comando na seção 2.2).
- **Como esta régua se mantém ponteiro:** muda quando um custo muda de ordem
  de grandeza, quando um gate entra ou sai, ou quando o dono decide uma
  catraca. Quem muda: a sessão que mediu, na mesma entrega.

## 4. Referências e fronteiras documentais

- **Réguas de stack aplicadas:** `references/regua-typescript.md`,
  `references/regua-powershell.md`, `references/regua-python.md` (na skill
  `dex-regras-desenvolvimento-casa`).
- **Âncoras reabríveis usadas em 2026-11-23** (sha do fulltext conferido
  contra o manifesto de cada tema): `mentor-documental-python` — docs.python.org,
  l.11117-11120 (codificação dos fluxos), l.281449 e l.281474 (`-E` e `-I`),
  l.143250 (`ensure_ascii`); sha `7df99afd1e785637`. `mentor-documental-javascript`
  — ECMA-262, l.13498, l.28726, l.28748, l.29013; sha `68ed531fb92d47e5`.
  Tema `teste-de-integracao`, build `971c316328560ffc`: ISTQB l.66312-66324,
  Aniche l.69940 e l.69942; sha `36bea6c602fd118c`.
- **Documentos do projeto:** `AGENTS.md`, `docs/architecture/FLOW_ENGINE_EVOLUTION.md`,
  `CAPACITY.md`, `PLAYBOOK.md`.
- **Localizado × não localizado:** custo do CI por gate e de cada gate do
  pre-commit não foram medidos; `check:flow-engine` não foi cronometrado;
  proporção de testes por tipo não foi medida.

## 5. Validação e recalibração

- **Como validar:** `python -B "$USERPROFILE/.agents/skills/dex-regras-desenvolvimento-casa/scripts/check-regua-projeto.py" --repo .`
  (o fiscal confere a forma; sem ele na máquina o veredito é `nao_verificavel`,
  nunca verde). Resultado de 2026-11-23: `forma_ok`.
- **Promoção para `ativa`:** uso real medido em Trilho deste projeto + decisão
  do dono. Ainda não aconteceu.
- **Recalibrar:** só com medição local comparável (comando + data + revisão).
  Gatilhos: HEAD muito à frente de `af6ddd7` em `src/`, `tests/` ou
  `tools/playbook/hooks/`; gate novo no pre-commit ou no CI; suíte mudando de
  ordem de grandeza (hoje 191 s).
