# ADR-0004 - Reunioes como artefatos gateados

## Status

Aceito

## Contexto

No uso real, reunioes ajudam a sair de loops, mas podem virar texto solto sem
efeito operacional.

## Decisao

Modelar reunioes divergentes, convergentes e transversais como artefatos
estruturados vinculados a flow.

## Alternativas

- Deixar reunioes apenas como prompts livres.
- Registrar reunioes so em markdown.
- Nao modelar reunioes no MVP.

## Consequencias

- Decisoes ficam rastreaveis.
- Gates podem exigir reuniao em situacoes de risco.
- O MVP ganha um pouco mais de escopo, mas com utilidade clara.
