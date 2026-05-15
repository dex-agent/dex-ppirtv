# ADR-0002 - Estado por handles explicitos

## Status

Aceito

## Contexto

O harness precisa manter estado entre chamadas de tools sem depender da memoria
do modelo ou da conexao MCP.

## Decisao

Toda instancia de trabalho retorna um `flow_id`. Tools que operam em um flow
devem receber esse `flow_id`.

## Alternativas

- Estado global unico.
- Estado por conexao.
- Inferir flow pela ultima conversa.

## Consequencias

- Mais verboso.
- Muito mais auditavel.
- Permite multiplos flows simultaneos.
