# ADR-0003 - Separar tools, resources e prompts

## Status

Aceito

## Contexto

PPIRTV mistura processo, estado, perguntas e decisoes. Se tudo virar tool, o
harness fica dificil de usar e testar.

## Decisao

Separar:

- tools para acoes e transicoes;
- resources para estado e historico;
- prompts para guiar interacao.

## Alternativas

- Apenas tools.
- Apenas prompts.
- CLI textual fora de MCP.

## Consequencias

- Contratos mais claros.
- Melhor descoberta pelo cliente MCP.
- Mais arquivos para manter sincronizados.
