# 08 - Implementation Plan

## 1. Stack confirmada

Opcoes:

| Stack | Vantagem | Risco |
| --- | --- | --- |
| TypeScript | Ecossistema MCP maduro | Node como dependencia |
| Python | Scripts e testes rapidos | SDK/cliente alvo precisa validacao |
| Go/Rust | Binario forte | Mais custo no MVP |

Decisao do MVP: TypeScript + Node.js 22 + `@modelcontextprotocol/sdk` + Vitest.

Justificativa: o SDK TypeScript MCP ja fornece servidor `stdio`, listagem de
tools/resources/prompts e cliente de teste. As regras PPIRTV ficam em engines
puras para evitar acoplamento com estado de sessao.

## 2. Ordem de implementacao

1. [x] Scaffold MCP.
2. [x] Tool `flow_create`.
3. [x] Store local.
4. [x] Tool `flow_status`.
5. [x] Resources de flow.
6. [x] Gate engine.
7. [x] Meeting engine.
8. [x] Prompts.
9. [x] Testes.
10. [x] Documentacao do MVP.

## 3. Contratos antes de codigo

Antes de implementar cada tool:

- nome;
- descricao;
- input schema;
- output esperado;
- erros;
- exemplos.

## 4. Teste minimo por sprint

| Sprint | Teste |
| --- | --- |
| 1 | Cliente lista tools |
| 2 | Criar flow e recuperar apos restart |
| 3 | Gate bloqueia avanco incompleto |
| 4 | Reuniao gera decisao vinculada |
| 5 | Veredito exige evidencia |
| 6 | Flow completo real |
