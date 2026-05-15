# Nota Final - PPIRTV MVP

Data: 2026-05-15

## Reuniao divergente

Pergunta: o que poderia fazer o MVP parecer pronto sem estar pronto?

- Estado implicito por conexao MCP.
- SDK escondendo contrato de tools/resources/prompts.
- Gates aceitando caminho feliz sem `missing`, `next` e `back_to`.
- Documentacao viva ficando atrasada em relacao ao codigo.

## Reuniao convergente

Decisao: implementar TypeScript + SDK MCP, com regras PPIRTV em engine pura e
MCP como adaptador fino.

Motivo: reduz protocolo escrito a mao e preserva testes de dominio sem depender
do transporte.

## Reuniao transversal

Areas afetadas:

- Arquitetura MCP.
- Persistencia local.
- Testes.
- Documentacao.
- Seguranca de ledger.

Gate extra: todo veredito final precisa de teste executado e evidencia
registrada.

## Estacionamento e garimpo vivos

Decisao: manter Estela Estaciona e Gabi Garimpeira como trilho vivo do processo
e do MCP por meio de `parking_lot` e `gold_mining` nos artefatos existentes.

Motivo: esses campos alimentam especialistas sem ampliar o contrato obrigatorio
de tools antes de nova SPEC/ADR/TASKS.

## Governanca de especialistas

Decisao: especialistas vivem sempre em `$env:USERPROFILE\.agents\skills\`.

Fontes canonicas:

- `$env:USERPROFILE\.agents\skills\00-governanca-mesa-de-skills.md`
- `$env:USERPROFILE\.agents\skills\INDEX.md`

Regra de paths: quando houver variavel do sistema, ela vence caminho local
absoluto. Nomes de usuario e computador nao devem virar contrato canonico.

## Veredito operacional

O MVP esta pronto para uso local com ressalva de que ainda nao ha empacotamento
publicado nem cliente MCP externo configurado fora dos testes.
