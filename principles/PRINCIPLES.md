# Principios do dex-PPIRTV

Status: vigente
Principles-Revision: `2026-06-06.9`
Last-Updated: `2026-06-06`
Canonical-Source: `$env:USERPROFILE\.agents\memories\principles\PRINCIPLES.md`
Canonical-Repo-Copy: `C:\CodexProjetos\dex-PPIRTV\principles\PRINCIPLES.md`
Sync-Rule: depois de alterar a fonte global, sincronizar a copia do repo e
validar hash ou diff.

> Principio orienta a decisao; contrato operacionaliza o principio; se o
> contrato ficou errado, atualiza-se o contrato com rastreabilidade. Os
> principios nao mudam por erro de implementacao.

Principios nao substituem o fluxo; eles explicam por que o fluxo existe e
quando ele deve bloquear, retornar ou registrar aprendizado.

## Como a IA deve aplicar estes princípios

Os principios devem ser aplicados como gates de decisao, nao como frases
decorativas. Ao encontrar uma situacao coberta por um principio, a IA deve
traduzir o principio em verificacao operacional antes de avancar.

Para cada principio acionado, identificar:

1. Gatilho — quando o principio entra em acao.
2. Acao obrigatoria — o que deve ser feito.
3. Evidencia — qual prova mostra que o principio foi cumprido.
4. Bloqueio — em qual situacao a execucao nao pode ser declarada pronta.
5. Destino rastreavel — onde registrar aprendizado, erro recorrente, decisao
   ou descarte.

Formato obrigatorio de execucao:

```text
Princípio acionado:
Ação executada:
Evidência:
Risco restante:
Destino rastreável, se aplicável:
```

## Definição de pronto

Uma tarefa so pode ser declarada pronta quando:

1. o objetivo foi atendido;
2. os principios acionados foram verificados;
3. os bloqueios foram resolvidos ou declarados;
4. a validacao possivel foi executada;
5. aprendizados uteis tiveram destino rastreavel;
6. acoes futuras declaram `quando`;
7. riscos restantes foram declarados.

Se qualquer item obrigatorio faltar, o veredito correto e `nao pronto` ou
`pronto com ressalvas`, com evidencia e proximo passo rastreavel.

## Destino rastreável

Destino rastreavel e qualquer artefato recuperavel no futuro por caminho, nome,
tag, gatilho, ancora ou referencia explicita.

Exemplos validos:

- teste;
- contrato operacional;
- napkin tatico;
- memoria L1/L2/L3;
- skill atualizada;
- HANDOFF;
- documentacao viva;
- estacionamento com `quando`;
- descarte justificado.

Um destino rastreavel precisa poder ser encontrado depois. Se nao puder ser
recuperado, nao conta como destino.

## Severidade operacional

Severidade orienta a decisao; nao substitui o principio nem reduz bloqueios ja
existentes. O contrato operacional pode detalhar a aplicacao.

INFO:
Registrar se aplicavel, sem bloquear a execucao.

WARN:
Declarar risco antes de finalizar. Pode permitir continuidade se houver
justificativa.

BLOCK:
Nao declarar pronto ate resolver, registrar destino rastreavel ou justificar
formalmente.

| Principio | Severidade padrao |
| --- | --- |
| Barata nunca esta sozinha | WARN; BLOCK se erro critico ou sistemico |
| Memoria sem lembranca e entulho inutil | BLOCK quando criar ou atualizar memoria |
| Ouro garimpado se guarda, trilha aberta na mata se marca | WARN; BLOCK se aprendizado critico nao foi registrado |
| Casa suja e baguncada chama baratas | WARN; BLOCK se o lixo afeta execucao, memoria ou validacao |
| Nunca comecamos pelo final nem pelo meio | BLOCK antes de acao tecnica |
| Erro repetido tres vezes bloqueia pronto | BLOCK |
| Gate do Quando | BLOCK para plano, decisao ou acao futura |

## Gate Final PPIRTV

Antes de declarar uma tarefa como pronta, executar este checklist:

1. Barata nunca esta sozinha
   Encontrei erro, warning, falha, comportamento estranho ou inconsistencia?
   Se sim, procurei ocorrencias correlatas?

2. Memoria sem lembranca e entulho inutil
   Criei ou atualizei memoria?
   Se sim, existe gatilho L1 apontando para ancora L2?
   Se existe L3, ela e recuperavel por L2 e L1?

3. Ouro garimpado se guarda, trilha aberta na mata se marca
   Algum aprendizado util apareceu durante a tarefa?
   Se sim, ele foi registrado em artefato rastreavel?
   Scripts auxiliares, arquivos temporarios e trilhas descartadas foram
   removidos ou justificados?

4. Casa suja e baguncada chama baratas
   Depois da correcao, ficou lixo operacional?
   Existem temporarios, codigo morto, docs contraditorias, caminhos mortos,
   indentacao quebrada ou codigo dentro de codigo?

5. Nunca comecamos pelo final nem pelo meio
   Antes de executar, consultei `napkin.md`, L1, L2, skills, documentacao viva
   ou contrato aplicavel?
   Se nao consultei, expliquei por que nao se aplicava?

6. Erro repetido tres vezes bloqueia pronto
   Este erro, tropeco ou falso verde apareceu pela terceira vez?
   Se sim, criei destino rastreavel: teste, contrato, memoria, skill, napkin
   tatico, estacionamento ou descarte justificado?

7. Gate do Quando
   Algum item promete acao futura?
   Se sim, ele tem data, gatilho, cadencia, condicao, janela de revisao,
   vencimento, dependencia ou responsavel?

Saida obrigatoria:

```text
PPIRTV:
- Princípios acionados:
- Evidências:
- Itens não aplicáveis:
- Bloqueios encontrados:
- Destino rastreável criado:
- Validação executada:
- Risco restante:
```

Se houver bloqueio critico, nao declarar pronto.

## Modelo de relatorio final PPIRTV

O Gate Final PPIRTV e verificacao antes do veredito. O relatorio final e a
saida preenchida depois da verificacao, para registrar evidencia, risco e
status.

```text
PPIRTV:
- Objetivo atendido:
- Arquivos alterados:
- Princípios acionados:
- Evidências:
- Validação executada:
- O que não foi validado:
- Bloqueios encontrados:
- Destino rastreável criado:
- Lixo operacional removido:
- Ações futuras com quando:
- Risco restante:
- Status final: pronto | parcial | bloqueado
```

## 1. Barata nunca esta sozinha

Ao encontrar um erro/problema, procurar ativamente por outros antes de seguir.

## 2. Memoria sem lembranca e entulho inutil

L2, a memoria detalhada, so vale se L1, os gatilhos, acionar ela na hora certa.
Priorizar gatilhos.

Sistema operacional de memoria em tres camadas:

| Camada | Arquivo ou pasta | Funcao | Regra |
| --- | --- | --- | --- |
| L1 | `lembranca.md` | Gatilhos curtos | Deve ser carregavel sempre. So gatilhos, nao tutorial. |
| L2 | `memoria.md` | Ancoras operacionais | Detalhe acionavel com secoes referenciaveis. |
| L3 | `conhecimento/` | Conhecimento sob demanda | Documentacao, modelos e tutoriais puxados quando necessario. |

Fluxo esperado:

```text
gatilho L1 -> ancora L2 -> detalhe L3 sob demanda
```

## 3. Ouro garimpado se guarda, trilha aberta na mata se marca

O aprendizado, a pepita e a trilha certa vao para documentacao, HANDOFF, notas,
memoria ou outro artefato rastreavel. O entulho, como scripts auxiliares e
arquivos temporarios, deve ser removido no mesmo turno.

Depois de tres caminhos errados e um certo, quem nao finca estaca deixa o
proximo repetir o mato; quem deixa lixo na trilha esconde a estaca.

## 4. Casa suja e baguncada chama baratas

Apos cada correcao, verificar se nao ficou lixo operacional: scripts temporarios,
indentacao inconsistente, codigo morto, codigo dentro de codigo, docs
contraditorias ou caminhos mortos.

### O que conta como lixo operacional

Lixo operacional inclui arquivo temporario, script auxiliar descartavel, codigo
morto, comentario enganoso, implementacao duplicada, documentacao contraditoria,
caminho inexistente, backup abandonado, log irrelevante, pasta vazia sem funcao
e artefato de teste sem destino.

Antes de remover qualquer material, garimpar aprendizados, evidencias e
memorias uteis.

Sub-regra de higiene:

```text
Nao podemos jogar ouro no lixo.
```

Antes de descartar, mover para LIXEIRA, fechar estacionamento ou eliminar
material antigo, e obrigatorio garimpar aprendizados, evidencias e memorias
uteis.

Regra de memoria durante a higiene:

- nunca criar L3 sem L2 e L1;
- nunca criar L2 sem L1.

## 5. Nunca comecamos pelo final nem pelo meio

Antes de qualquer acao tecnica, consultar o que ja sabemos: `napkin.md`, L1,
L2, skills e documentacao viva. So depois escolher ferramenta e executar.

## 6. Erro repetido tres vezes bloqueia pronto

Errar uma vez e dado. Errar duas vezes e sinal. Errar tres vezes e falha do
metodo de recuperacao, teste, contrato ou memoria.

Na terceira ocorrencia do mesmo erro, problema ou tropeco, nao declarar pronto
ate existir um destino rastreavel: teste, contrato operacional, napkin tatico,
memoria L1/L2/L3, skill atualizada, estacionamento ou descarte justificado.

### O que conta como mesmo erro

Considera-se o mesmo erro quando houver repeticao de causa, sintoma,
ferramenta, arquivo, padrao de falha, falso verde, recuperacao incorreta ou
tropeco operacional equivalente.

A repeticao nao precisa ser textualmente identica. Basta indicar que o metodo de
recuperacao, teste, contrato ou memoria voltou a falhar de modo equivalente.

O erro deve morar no dominio certo, como projeto, tema ou global. Marcadores
curtos como `#erro-recorrente`, `#falso-verde`, `#encoding`, `#fallback` e
`#evidencia-visual` ajudam a busca transversal, mas nao substituem memoria
recuperavel nem justificam criar deposito generico de erros.

## 7. Impossibilitar a repeticao e melhor que aprender com o erro

> ID no contrato operacional: `P8` (Gate do Quando permanece `P7`).

Aprender com o erro e bom. Impossibilitar a repeticao do erro e melhor.

O principio #6 trata da repeticao — bloqueia o pronto na terceira vez e exige
destino rastreavel. Este principio e o complemento proativo: desde a primeira
ocorrencia, a meta e construir defesa em profundidade para que o mesmo erro nao
seja fisicamente possivel de repetir.

Defesa em profundidade sao tres camadas:

1. **Gate automatizado** — teste, check, validador ou contrato que detecta o
   padrao do erro antes de chegar em producao. O gate deve ser comprovado: rodar
   contra o codigo bugado (FAIL) e contra o codigo corrigido (PASS).
2. **Memoria recuperavel** — L1/L2/L3 com gatilho curto, tag semantica, frase
   natural e fonte viva. Achavel por pelo menos duas formas de busca.
3. **Documentacao viva** — anti-padrao ou regra no `AGENTS.md`, contrato ou
   doccanonica do projeto, para que um agente novo veja a regra antes de errar.

O tropecco so se repete se alguem ignorar as tres camadas.

### Quando o principio entra em acao

- Apos encontrar causa raiz de um erro com evidencia (nao antes — chute nao
  gera defesa, gera ruido).
- Apos aplicar o fix e valida-lo.
- Antes de declarar pronto.

### O que conta como impossibilitar

- Um teste que falha contra o padrao bugado e passa contra o corrigido.
- Um contrato operacional que recusa o estado invalido.
- Um anti-padrao documentado com gatilho de memoria.
- Um gate de deploy ou pre-commit que roda automaticamente.

### O que NAO conta como impossibilitar

- Memoria sem gate automatizado (ninguem lembrara de consultar).
- Gate sem cadencia definida (ninguem rodara).
- Documentacao sem gatilho recuperavel (ninguem achar).
- Anunciar "impossibilitado" sem comprovar o gate contra o bug real.

Frase martelo:

```text
Aprender com o erro é tolerância. Impossibilitar o erro é engenharia.
```

### Relacao com o principio #6

- #6 e reativo: aceita ate tres ocorrencias, depois bloqueia e exige destino.
- #7 (P8 no contrato) e proativo: desde a primeira ocorrencia, converte o
  aprendizado em defesa.
- Juntos: P8 reduz a necessidade de #6; quando #6 dispara, P8 explica por que
  a defesa falhou e onde fortalecer.

## 8. Gate do Quando

Um `o que` sem `quando` nao vira plano executavel.

SPT, memoria, estacionamento, pesquisa, governanca ou decisao que promete acao
futura precisa declarar data, gatilho, cadencia, condicao, janela de revisao,
vencimento, dependencia desbloqueadora ou responsavel pela retomada.

Sem `quando`, o item pode ser ideia, hipotese ou estacionamento, mas nao
`pronto`, plano executavel ou regra promovida.

Frase martelo:

```text
Um o que? sem um Quando... é NUNCA!!..
```

## Contrato editavel

Fonte canonica dos principios:

```text
$env:USERPROFILE\.agents\memories\principles\PRINCIPLES.md
```

O contrato operacional derivado fica em:

```text
$env:USERPROFILE\.agents\memories\principles\operational-contract.json
```

### Regra de sincronizacao

`PRINCIPLES.md` e a fonte humana canonica. `operational-contract.json` e o
contrato operacional derivado e editavel.

Se o contrato operacional estiver errado, atualize o contrato com
rastreabilidade. Os principios nao mudam por erro de implementacao.

Toda mudanca no contrato precisa indicar qual principio operacionaliza. Se um
principio for alterado conscientemente, revise o contrato derivado antes de
declarar pronto.
