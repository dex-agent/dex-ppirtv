# Bibliotecario

O modulo `src/memory/` implementa o Bibliotecario do Dex-PPIRTV.

O Bibliotecario nao e juiz, banco vetorial nem writer de memoria curada.
Ele fica entre o fluxo PPIRTV e os registros L1/L2/L3 para lembrar antes de uma
fase, registrar depois de uma fase, estacionar achados e preparar garimpo.
Quando uma escrita e autorizada, `mm_memory_mining` delega ao selector/writer
canonico Dex Memoria V2; compatibilidade V1 permanece somente para leitura e
restauracao.

## Camadas

- `.ppirtv/memory/`: runtime quente local com recalls, hooks, candidatos e
  estacionamento operacional.
- L1: gatilhos curtos em `.agents/lembranca.md`.
- L2: unidades em `.agents/memorias/<slug>.md`; `.agents/memoria.md` e ancora
  legada/compatibilidade, nao destino de novas unidades V2.
- L3: conhecimento reutilizavel em
  `.agents/conhecimento/<slug>/README.md`, apontado por L1/L2. O recall nao
  carrega L3 inteiro sem demanda.

## Hooks

- `beforePhase`: consulta runtime quente e memoria curada V1+V2, ranqueia o que
  parece util e registra `memory_recalled` no ledger via `flow-engine`. No V2,
  segue somente o unico href Markdown canonico de um gatilho L1 no formato
  `->`: `memorias/<slug>.md` ou `conhecimento/<slug>/README.md`. O wikilink
  companheiro nao e uma segunda rota; unidades orfas nao sao varridas.
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

O provider Graphify nao escreve memoria, nao chama o writer, nao altera
L1/L2/L3, nao decide veredito, nao promove memoria curada e nao substitui `rg`
para strings exatas.

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

## O que o Bibliotecario nao faz

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

No writer V2, a intenção cotidiana explícita escolhe `project`, `global` ou a
rota dual sem exigir os parâmetros internos `v2_*`. Pedido sem destino humano
suficiente retorna `classification_reason=destinations_required`; não retorna
`classifier_unavailable` nem transfere ao cliente a obrigação de estudar o
código. `written[].files` contém somente arquivos reabertos e confirmados pelo
recibo independente de validação; `written_count` conta candidatos escritos,
não o número de rotas.

Diagnostico e validacao controlada devem usar `write_policy=classify_only`.
Graphify e Bibliotecario nao promovem memoria canonica.

## Fronteiras do recall V2

- nomes fisicos L1 sao resolvidos por equivalencia de casing sem ambiguidade;
  os segmentos internos V2 exigem casing canonico portavel;
- metadata `implementation_version`, `layer` e `slug` deve coincidir com a
  rota; L3 tambem exige `owner_skill`;
- destinos sao deduplicados e ordenados antes do limite de oito unidades; se o
  limite for excedido, o recall emite `curated_v2_targets_truncated`;
- cada arquivo curado e limitado a 1 MiB e permanece confinado ao `.agents`;
- o adapter pos-escrita nao escolhe root nem writer: ele reabre recibos e exige
  exatamente um L1 case-equivalent e o destino derivado da camada e do slug.

## Contrato de consumo do recall

`recall-consumption-contract.ts` concentra a política pura que normaliza e
valida as referências que o executor declara ter consumido. O módulo não lê
ledger, não persiste flow e não decide fase; essas responsabilidades continuam
na fachada `FlowEngine`. `flow-engine.ts` mantém re-exports de compatibilidade
para os consumidores públicos existentes.
