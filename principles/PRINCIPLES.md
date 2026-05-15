# Principios do dex-PPIRTV

> Principio orienta a decisao; contrato operacionaliza o principio; se o
> contrato ficou errado, atualiza-se o contrato com rastreabilidade. Os
> principios nao mudam por erro de implementacao.

Principios nao substituem o fluxo; eles explicam por que o fluxo existe e
quando ele deve bloquear, retornar ou registrar aprendizado.

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

## 5. Nunca comecamos pelo final nem pelo meio

Antes de qualquer acao tecnica, consultar o que ja sabemos: `napkin.md`, L1,
L2, skills e documentacao viva. So depois escolher ferramenta e executar.

## Contrato editavel

O contrato operacional derivado fica em
[`principles/operational-contract.json`](operational-contract.json).

Atualize o contrato quando a operacionalizacao estiver errada, mantendo este
arquivo como fonte humana dos principios.
