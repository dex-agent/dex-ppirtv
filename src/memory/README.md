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

## Graphify Recall

`memory-graph-provider.ts` define um provider opcional para consultar Graphify
como mapa relacional. Ele e opt-in, tolerante a falha, usa timeout curto e
retorna achados marcados com `source: graphify`.

Para habilitar no Bibliotecario padrao, use `PPIRTV_GRAPHIFY_RECALL=1`. Sem
essa flag, o provider nao chama Graphify.

`graphify-out/` e indice derivado, local, regeneravel e deve ficar fora do Git.
Use `.graphifyignore` para excluir `.env`, `.ppirtv/`, build output, caches,
logs e o proprio `graphify-out/`.

Achados vindos do Graphify entram no recall como pistas, por exemplo:

```json
{
  "source": "graphify",
  "question": "planejamento Bibliotecario beforePhase",
  "path": "src/memory/memory-recall.ts",
  "destination": "recall_hint"
}
```

Na v1 ele nao escreve memoria, nao chama `save-result`, nao altera L1/L2/L3,
nao decide veredito, nao promove memoria curada e nao substitui `rg` para
strings exatas.

## Medicao de eficiencia

A bateria controlada de 2026-05-29 mediu Graphify contra `rg` em perguntas
sobre hooks, provider, warnings, mining, store, docs e PLAN-TASKS.

Resultado operacional:

- `rg` continua muito mais rapido para strings exatas.
- Graphify so deve ser contado como ganho quando a pergunta pedir relacao entre
  componentes, vizinhanca tecnica ou pistas de navegacao.
- O grafo precisa estar fresco. Depois de mudar codigo ou docs, rode
  `graphify update . --no-cluster` antes de confiar nos achados.
- Falta de hit Graphify nao e falha de memoria; e sinal para usar fallback `rg`
  ou refinar a pergunta.

## O que a v1 nao faz

- Nao bloqueia avance de fase.
- Nao decide veredito.
- Nao promove memoria curada sozinha.
- Nao substitui `mm_memory_mining`.
- Nao introduz FAISS, Chroma, pgvector ou outro backend externo.

`mm_memory_mining` continua sendo o caminho forte e exclusivo para classificar,
bloquear, promover e escrever memoria curada. Com o default operacional
`auto_classify=true` e `write_policy=auto_write`, achados reutilizaveis,
tropecos recorrentes e regras de prevencao classificados como writable e nao
bloqueados sao gravados automaticamente primeiro; a resposta informa depois os
arquivos em `written[].files` para o usuario poder editar, complementar ou
corrigir.

Diagnostico e validacao controlada devem usar `write_policy=classify_only`.
Graphify e Bibliotecario nao promovem memoria canonica.
