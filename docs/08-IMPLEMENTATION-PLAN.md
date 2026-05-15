# 08 - Implementation Plan

## 1. Stack a confirmar

Opcoes:

| Stack | Vantagem | Risco |
| --- | --- | --- |
| TypeScript | Ecossistema MCP maduro | Node como dependencia |
| Python | Scripts e testes rapidos | SDK/cliente alvo precisa validacao |
| Go/Rust | Binario forte | Mais custo no MVP |

Recomendacao inicial: TypeScript ou Python, decidido no Sprint 1.

## 2. Ordem de implementacao

1. Scaffold MCP.
2. Tool `flow_create`.
3. Store local.
4. Tool `flow_status`.
5. Resources de flow.
6. Gate engine.
7. Meeting engine.
8. Prompts.
9. Testes.
10. Release.

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

