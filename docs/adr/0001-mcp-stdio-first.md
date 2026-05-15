# ADR-0001 - MCP stdio primeiro

## Status

Aceito

## Contexto

O harness PPIRTV deve rodar localmente e guiar agentes sem abrir superficie HTTP
desnecessaria no MVP.

## Decisao

Implementar primeiro como servidor MCP por `stdio`.

## Alternativas

- Streamable HTTP desde o inicio.
- CLI sem MCP.
- Biblioteca embutida em um cliente especifico.

## Consequencias

- Menor superficie de seguranca no MVP.
- Mais simples de testar localmente.
- HTTP pode ser adicionado depois com ADR propria.
