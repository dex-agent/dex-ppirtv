# REFERENCE

## Fontes MCP oficiais consultadas

- Model Context Protocol - Server concepts:
  https://modelcontextprotocol.io/docs/learn/server-concepts
- Model Context Protocol - Tools:
  https://modelcontextprotocol.io/specification/draft/server/tools
- Model Context Protocol - Prompts:
  https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
- Model Context Protocol - Transports:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

## Pontos de projeto derivados das fontes

- Tools sao operacoes com schema e devem ter ordem deterministica quando listadas.
- Resources expõem contexto por URI e podem ser diretos ou parametrizados.
- Prompts sao templates controlados pelo usuario e devem validar argumentos.
- Em HTTP, sessoes podem existir por `MCP-Session-Id`; no desenho do harness,
  mesmo assim o estado de trabalho deve ser explicito por `flow_id`.
- Para estado entre chamadas, o servidor nao deve depender de conexao implicita;
  deve retornar handles explicitos e recebe-los em chamadas futuras.
- MVP local deve favorecer `stdio` por simplicidade e portabilidade.

## Decisoes locais

| Decisao | Estado |
| --- | --- |
| Usar PPIRTV como maquina de estados | Implementado |
| Usar `flow_id` explicito | Implementado |
| Separar tools/resources/prompts | Implementado |
| Persistir ledger local auditavel | Implementado |
| Fazer HTTP somente depois do MVP `stdio` | Mantido fora do MVP |
| Usar TypeScript + Node + SDK MCP | Implementado |

## Governanca local de skills

- Especialistas vivem em `$env:USERPROFILE\.agents\skills\`.
- A governanca canonica da mesa de skills vive em
  `$env:USERPROFILE\.agents\skills\00-governanca-mesa-de-skills.md`.
- A indexacao rapida das skills vive em
  `$env:USERPROFILE\.agents\skills\INDEX.md`.

## Riscos conhecidos

- Virar burocracia sem utilidade pratica.
- Gerar estado demais e atrapalhar o trabalho.
- Misturar prompts com tools e perder testabilidade.
- Tratar reuniao como texto solto em vez de artefato rastreavel.
- Avancar fases sem evidencia real.
