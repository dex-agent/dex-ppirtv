# Bibliotecario

O modulo `src/memory/` implementa o Bibliotecario do Dex-PPIRTV.

Na v1 ele nao e juiz, banco vetorial nem promotor automatico de memoria curada.
Ele fica entre o fluxo PPIRTV e os registros L1/L2/L3 para lembrar antes de uma
fase, registrar depois de uma fase, estacionar achados e preparar garimpo.

## Camadas

- `.ppirtv/memory/`: runtime quente local com recalls, hooks, candidatos e
  estacionamento operacional.
- L1: gatilhos curtos, como `.agents/LEMBRANCA.md`.
- L2: memoria detalhada, como `.agents/MEMORIA.md`.
- L3: conhecimento reutilizavel sob demanda, apontado por L1/L2. A v1 nao varre
  L3 inteiro.

## Hooks

- `beforePhase`: consulta runtime quente e memoria curada L1/L2, ranqueia o que
  parece util e registra `memory_recalled` no ledger via `flow-engine`.
- `afterPhase`: coleta sinais da fase encerrada, registra candidatos e
  estacionamento em `.ppirtv/memory/`, e registra `memory_hook_recorded` no
  ledger via `flow-engine`.

## O que a v1 nao faz

- Nao bloqueia avance de fase.
- Nao decide veredito.
- Nao promove memoria curada sozinha.
- Nao substitui `mm_memory_mining`.
- Nao introduz FAISS, Chroma, pgvector ou outro backend externo.

`mm_memory_mining` continua sendo o caminho forte para classificar, bloquear,
promover e escrever memoria curada quando a politica permite.
