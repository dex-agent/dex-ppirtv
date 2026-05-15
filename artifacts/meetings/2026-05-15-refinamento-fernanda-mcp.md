# Reuniao de Refinamento - Fernanda no MCP

Data: 2026-05-15

## Objetivo

Definir ajustes finos para deixar o `dex-ppirtv` mais claro em Codex e DeepSeek
sem quebrar o core MCP que ja esta funcionando.

## Kant liderando

Regra principal: mudanca cirurgica e compativel.

- Nao renomear campos existentes.
- Nao remover `missing`, `next`, `back_to`, `parking_lot` ou `gold_mining`.
- Adicionar aliases e camada de apresentacao em vez de trocar o contrato.
- Especialista sugerido nao pode parecer especialista executado.
- Credito ativo so entra quando houver contribuicao material.

## Especialistas convocados

- Kant: simplicidade, compatibilidade e criterio verificavel.
- Chato: riscos de falso pronto e confusao de contrato.
- Paula Planeja / Sprinter: transformar decisao em SPEC, PLAN e TASKS.
- Dora Docs: manter fonte viva coerente.
- Estela Estaciona: guardar residuos que nao entram no sprint.
- Gabi Garimpeira: separar pepitas de ruido.
- Tereza Testa: exigir teste de compatibilidade e legibilidade antes de pronto.
- Vera Veredito: nao aprovar sem evidencia de teste.

## Avaliacao dos 7 itens

| Item | Decisao | Corte seguro |
| --- | --- | --- |
| Emojis nas fases e especialistas | Entra | `display.phase_emoji` e `display.owner_emoji` |
| Cooperadores visiveis quando uteis | Entra | `display.cooperators[]` com motivo |
| Acionavel direto | Entra | `display.direct_action` opcional |
| `next` e `back_to` | Mantem | aliases `proximo` e `voltar_para` entram sem substituir |
| Indicacoes automaticas de cooperacao | Entra com limite | `suggested_cooperation`, nunca como execucao fingida |
| Andamento ao vivo em checklist visual | Entra | `display.checklist_visual` derivado do gate |
| Creditos Ativos | Entra | `display.active_credits[]`, so quando material |

## Decisao travada

Escolha feita: criar uma camada de apresentacao Fernanda, preservando o contrato
tecnico existente.

Caminho fora do corte: renomear tools, remover campos em ingles, criar tools
novas para estacionamento/garimpo ou executar especialistas automaticamente.

## Riscos

- Confundir `suggested_cooperation` com especialista realmente executado.
- Inflar respostas MCP com display grande demais.
- Quebrar clientes que ja usam `structuredContent.result`.
- Duplicar conceitos entre aliases e campos tecnicos.

## Definicao de pronto do refinamento

- Testes antigos continuam passando.
- Teste novo confirma campos antigos e aliases juntos.
- Gate bloqueado retorna termos tecnicos e humanos.
- Checklist visual mostra fase, emoji, andamento e itens.
- Creditos ativos so aparecem quando fornecidos ou inferidos com motivo claro.
- Docs explicam diferenca entre contrato tecnico e apresentacao humana.

## Fechamento de implementacao

Status: implementado no Sprint 7.

Evidencia:

- `npm run check`: 14 testes passaram.
- Gate bloqueado preserva `missing`, `next` e `back_to` e adiciona aliases.
- `checklist_render` retorna `display.checklist_visual`.
- `suggested_cooperation` usa `material=false` por padrao.
- `active_credits` so aparece quando fornecido por contribuicao material.
