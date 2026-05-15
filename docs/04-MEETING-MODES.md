# 04 - Meeting Modes

## 1. Visao geral

Reunioes sao artefatos estruturados. Elas servem para reduzir risco e produzir
decisoes rastreaveis.

## 2. Reuniao divergente

Quando usar:

- problema mal definido;
- bug recorrente;
- mais de uma abordagem plausivel;
- sensacao de loop.

Saida obrigatoria:

- perguntas abertas;
- hipoteses;
- riscos;
- alternativas;
- criterios para escolher.

## 3. Reuniao convergente

Quando usar:

- alternativas ja foram levantadas;
- e preciso escolher menor trilho;
- escopo esta crescendo.

Saida obrigatoria:

- decisao;
- motivo;
- fora do escopo;
- criterio de pronto;
- risco aceito.

## 4. Reuniao transversal

Quando usar:

- mudanca cruza arquitetura, UX, testes, seguranca, docs ou operacao;
- uma area pode quebrar outra;
- ha dependencias ocultas.

Saida obrigatoria:

- areas afetadas;
- impactos;
- dono por area;
- gates extras;
- plano de rollback.

## 5. Template de registro

```json
{
  "meeting_id": "mtg_...",
  "flow_id": "flow_...",
  "type": "divergent",
  "question": "Por que o teclado regrediu?",
  "findings": [],
  "decisions": [],
  "risks": [],
  "next": "inspect_keyboard_path"
}
```

