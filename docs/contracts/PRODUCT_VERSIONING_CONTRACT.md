# Product versioning contract

`LOCALIZER: PPIRTV-PRODUCT-VERSIONING-CONTRACT`

| Campo | Valor |
| --- | --- |
| Contract version | `1.0.0` |
| Owner | release owner do `dex-PPIRTV` |
| Maintainer | `$projeto-manter-changelog` para o registro, não para decidir o bump |
| Effective from | `2026-08-03` |

## Objetivo

Impedir que versão do pacote, versão de contrato, nome de perfil e versão de
documento sejam tratados como se fossem o mesmo número. Este contrato decide
como classificar uma futura release; ele não executa bump, tag, publicação,
commit ou push.

## Autoridades e estados

| Superfície | Autoridade | Regra |
| --- | --- | --- |
| Versão declarada | `package.json` e raiz de `package-lock.json` | devem ser iguais |
| Versão liberada | tag Git `vX.Y.Z` mais receipt de release/publicação | arquivo de pacote sozinho não prova release |
| Mudança acumulada | `CHANGELOG.md` em `Unreleased` | descreve mudança confirmada, não decide bump |
| Contrato público | campo de versão do contrato/receipt | evolui independentemente do pacote |
| Documento | `Document version` no próprio documento | evolui independentemente do runtime |

Se tag e receipt não existirem, use “versão declarada”, nunca “última versão
lançada”. Se a publicação em registry não foi consultada, declare a lacuna; não
a substitua por inferência local.

## Classificação SemVer do produto

- `PATCH`: correção retrocompatível, sem nova capacidade pública e sem quebra
  de schema, default, erro esperado ou comportamento suportado.
- `MINOR`: capacidade pública nova e retrocompatível. Adições de tools ou
  campos opcionais podem entrar aqui somente depois de provar que consumidores
  anteriores continuam funcionando.
- `MAJOR`: remoção, renomeação ou mudança incompatível de tool, schema,
  default, erro, persistência, protocolo ou comportamento público.

Enquanto o produto estiver em `0.x`, instabilidade esperada não é licença para
esconder uma quebra. O relatório deve continuar classificando o impacto como
breaking. O owner decide entre restaurar compatibilidade/migração ou promover a
versão maior; o changelog não toma essa decisão sozinho.

## Relógios independentes

- `SPT v3` é versão do contrato de Trilho, não `dex-ppirtv 3.0.0`.
- `ppirtv.trace.receipt.v1` é versão de um receipt, não do produto.
- `compact` e `full` são perfis de execução, não versões.
- `Dex Memoria V2` e `Dex Method vNext` são gerações/nome de iniciativa, não
  números SemVer do pacote.
- Um snapshot documental `1.0.0` pode descrever um produto `0.1.0` sem
  conflito, pois os owners e ciclos são diferentes.

## Gate obrigatório antes de escolher a próxima release

1. Congelar a base comparável por tag ou commit e registrar a limitação se não
   houver tag anterior.
2. Comparar nomes de tools, schemas de entrada/saída, defaults, erros,
   persistência e rotas suportadas.
3. Procurar consumidores reais, quickstarts, testes E2E e contratos que
   dependem do comportamento anterior.
4. Classificar cada mudança como `PATCH`, `MINOR` ou `MAJOR` e registrar a
   evidência. A maior severidade vence o conjunto da release.
5. Definir migração e rollback para qualquer mudança incompatível.
6. Só então alterar `package.json`, `package-lock.json`, changelog e tag no
   mesmo Trilho de release autorizado.
7. Provar build, suíte, E2E, `tools/list` real e instalação/launcher afetado.

## Estado do snapshot de 2026-08-03

- Versão declarada: `0.1.0`.
- Tag Git de release: ausente.
- Estado: `Unreleased`.
- Comparação nominal com a base `0.1.0`: 27 tools antigas, 32 atuais, cinco
  adições e zero remoções.
- Candidata condicional: `0.2.0`, se a auditoria completa provar
  retrocompatibilidade ou uma migração preservada.
- Gate aberto: a exigência de SPT v3 para nova execução deve ser classificada
  contra o comportamento público anterior. Se for uma quebra deliberada, a
  candidata `0.2.0` não pode ser publicada como se fosse apenas aditiva.

Portanto, este contrato define a regra e a candidata, mas mantém a versão
declarada em `0.1.0` até o gate de compatibilidade e uma autorização de release.

## Versionamento de documentos

Documentos estáveis usam sua própria versão:

- `PATCH`: clareza, typo ou exemplo sem mudança normativa;
- `MINOR`: seção ou orientação nova compatível;
- `MAJOR`: mudança normativa incompatível no modo como o documento deve ser
  consumido.

Snapshots datados são imutáveis. Uma nova fotografia do sistema recebe novo
arquivo e data; uma correção factual pequena neste snapshot incrementa apenas
a versão documental e deve ficar explícita no próprio arquivo.

## Critério de pronto de uma release

- [ ] número derivado da classificação, não escolhido por sensação;
- [ ] `package.json` e `package-lock.json` iguais;
- [ ] `CHANGELOG.md` move somente mudanças confirmadas de `Unreleased`;
- [ ] tag e receipt de release identificáveis;
- [ ] compatibilidade e migração documentadas;
- [ ] build, suíte, E2E e `tools/list` real verdes;
- [ ] snapshot público atualizado por novo arquivo quando a arquitetura mudar;
- [ ] commit, push e publicação executados somente por autorização vigente.

## Relacionados

- [Snapshot do sistema em 2026-08-03](../architecture/SYSTEM_SNAPSHOT_AND_EVOLUTION_MAP_2026-08-03.md).
- [Canonical GOAL/SPT contract](GOAL_SPT_CANONICAL_CONTRACT.md).
- [MCP quickstart for agents](../guides/MCP_AGENT_QUICKSTART.md).

