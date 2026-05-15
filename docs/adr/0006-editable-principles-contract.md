# ADR-0006 - Principios editaveis como contrato operacional

## Status

Aceita.

## Contexto

O `dex-PPIRTV` precisa aplicar principios como "barata nunca esta sozinha",
"memoria sem lembranca e entulho inutil" e "nunca comecamos pelo final nem pelo
meio" sem transformar esses principios em constantes escondidas no codigo.

Os principios orientam decisao. O contrato operacional diz como o harness aplica
esses principios em checklist, higiene e prompts. Se o contrato ficar errado, o
contrato muda com rastreabilidade; os principios continuam como fonte humana.

## Decisao

Criar:

- `principles/PRINCIPLES.md` como fonte humana editavel dos principios.
- `principles/operational-contract.json` como contrato operacional editavel
  lido pelo harness em runtime.

O primeiro corte e aditivo:

- `hygiene_scan` pode gerar achados ligados a principios.
- `checklist_render` pode expor checklist de principios alem dos itens de gate.
- prompts podem incluir orientacao derivada do contrato.
- campos MCP existentes continuam intactos.

## Consequencias

- Alterar texto, labels e orientacoes do contrato nao exige mudar codigo.
- Novos tipos de checagem ainda precisam de implementacao explicita.
- O harness passa a ter uma fonte local e rastreavel para L1/L2/L3.
- A regra de seguranca continua: nao gravar secrets em ledger ou evidencia.
