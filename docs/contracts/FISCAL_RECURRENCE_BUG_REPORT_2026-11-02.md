# Bug - suíte verde interpretada como risco recorrente

Data: 2026-11-02. Severidade sugerida: **S3 moderada**: aceite válido era
bloqueado, com workaround de reformular a justificativa. Prioridade sugerida:
próximo ciclo de correção. Formato: projeto-descrever-bug.

## Comportamento Observado

O fiscal inferia recorrência a partir de palavras em `rationale`, `next_step`
e `residual_risks`. Texto como `Regressao 51/51 verde.`, negação de recorrência
ou citação de manual podia exigir contadores de tentativas sem risco declarado.
O problema foi reproduzido no baseline `f4443d38dc4199c2601d4c777f4e3d6e5877fbe9`.

## Comportamento Esperado

Suíte de regressão aprovada não declara risco recorrente. O fiscal deve usar
fatos estruturados, preservar regressões reais e validar entradas na fronteira.

## Passos Para Reproduzir

1. Criar um flow sintético com binding GOAL e uma evidência válida, como no
   fixture de `tests/fiscal-recurrence.test.ts`.
2. Submeter `goalVerdict` positivo com `rationale: "Regressao 51/51 verde."`,
   sem declarar risco recorrente, e com evidência e próximo passo válidos.
3. No baseline, observar exigência indevida de tentativas/contadores.
4. Na versão corrigida, executar
   `npx vitest run tests/fiscal-recurrence.test.ts`: o caso aceita o texto,
   enquanto os casos com fatos reais continuam exercitando os bloqueios.

## Ambiente

Windows, Node.js 24, TypeScript/Vitest, servidor MCP stdio direto `dist/index.js`.
Versão declarada do pacote: 0.1.0; revisão afetada confirmada: baseline acima.
Primeira revisão que introduziu o defeito: não determinada.

## Evidencias

| Prova | Resultado observado no fechamento |
| --- | --- |
| RED antes de editar a implementação | 16 falharam, 1 passou |
| `tests/fiscal-recurrence.test.ts` | 24 passaram |
| Fiscal GOAL | 26 passaram |
| Fronteira MCP real | 10 passaram; schema boolean opcional conferido |
| `npm run check` | exit 0; 769 passaram, 4 skipped, 59 arquivos |
| `npm run check:flow-engine` | SHRINK: -17 linhas não vazias, -1 decisão |

Os logs integrais e receipts originais são estado local de manutenção, não
publicados neste PR. A evidência portátil são os testes versionados e seus
asserts; esta tabela registra o resultado da execução, não substitui nova CI.

## Impacto

Bloqueio indevido de aceite e incentivo a alterar a linguagem para passar no
fiscal. Frequência em produção não medida; os contraexemplos sintéticos incluem
acentos, negação, citação, inglês, tentativas documentadas e risco resolvido.
Não há evidência de perda de dados ou exposição de credenciais neste incidente.

## Area Provavel

Causa confirmada em `src/verdict-fiscal-policy.ts`: inferência lexical de
recorrência. `src/flow-engine.ts` orquestra a persistência; `src/server.ts`
expõe e valida o contrato MCP.

## Confirmado

- `recurring_risk?: boolean` substitui a inferência textual deste sinal.
- `true` pendente sobrevive a omissão/reload; `false` encerra o relato; um
  verdict registrado encerra o relato atendido. O histórico não é apagado.
- O teto de regressões persistidas continua valendo com `false`, omissão ou
  contador menor; o fast-track mechanical também respeita esses fatos.
- Entradas booleanas/contadores inválidos são rejeitadas antes de persistir
  parte do relato conjunto. Não foi criada promessa de transação entre arquivos.
- Foram atualizados callers, schema, contratos e asserts relacionados.

## Achado irmão - fingerprint stale após recall

O check integral também reproduziu `REVIEW_SNAPSHOT_FINGERPRINT_MISMATCH` em
`tests/git-porcelain-quoting.test.ts` e `tests/env-snapshot-sensitive.test.ts`.
No primeiro `goal_status` full com recall ativo, o reload após o hook descartava
o fingerprint calculado e retornava o persistido antigo. Uma revisão baseada
nesse status era corretamente rejeitada pela validação estrita.

Reprodução portátil: executar `npx vitest run tests/git-porcelain-quoting.test.ts`.
O teste ativa `PPIRTV_GRAPHIFY_RECALL=1` e compara o fingerprint retornado com
o snapshot estrito atual. Correção: recalcular após o reload, preservando a
validação estrita, sem desativar o recall ou afrouxar a revisão.

## Inferido

Outras frases contendo os padrões antigos poderiam produzir o mesmo falso
positivo. Não se extrapola a frequência nem a todas as outras heurísticas
lexicais do fiscal, que não foram redesenhadas neste corte.

## Lacunas

- Quatro testes condicionais ficaram skipped; não são prova de aprovação.
- CI remota e processos MCP antigos não foram verificados no fechamento local.
- Atualizar o código não reinicia processos que já carregaram uma versão antiga.
- Não houve acesso a `.pilot-data`, migração, merge, deploy ou alteração de serviço.

## Aceite e rastreabilidade

PPI concluído no flow `flow_20261102090725252_2950_0001`, verdict
`vrd_20261102092735589_2993_0002`: `pronto_com_ressalvas`, avanço terminal
`complete`, blockers e closure_blockers vazios no readback. Esses IDs são
localizadores do runtime de manutenção, não links públicos nem prova de CI.

Revisão independente contribuiu materialmente com os casos de mechanical,
validação conjunta de sinais e diagnóstico do fingerprint pós-recall.
Lentes aplicadas: Chato/Chatinho, Burrinha, Ponytail e dex-anti-autossabotagem.

Próximo passo: revisar o diff e a CI deste PR antes de decidir o merge.
