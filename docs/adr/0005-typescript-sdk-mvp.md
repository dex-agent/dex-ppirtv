# ADR-0005 - TypeScript SDK no MVP

## Status

Aceito

## Contexto

O projeto precisava sair do contrato documental para um servidor MCP `stdio`
testavel, com tools, resources, prompts e cliente de integracao.

## Decisao

Implementar o MVP com TypeScript em Node.js 22 usando
`@modelcontextprotocol/sdk` e Vitest.

## Alternativas

- Python com SDK MCP.
- JSON-RPC escrito manualmente.
- Go ou Rust com binario unico.

## Consequencias

- Menos codigo proprio de protocolo.
- Testes MCP reais via cliente `stdio` do SDK.
- Dependencia de Node.js no MVP.
- Regras PPIRTV devem permanecer fora da camada MCP para preservar
  testabilidade e manutencao.
