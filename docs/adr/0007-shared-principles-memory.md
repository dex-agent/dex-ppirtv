# ADR-0007 - Fonte canonica compartilhada de principios

## Status

Aceita.

## Contexto

O `dex-PPIRTV` passou a ser usado em mais de um projeto e cliente MCP. A fonte
dos principios dentro do proprio repo funcionava para o harness, mas criava uma
ambiguidade: cada projeto poderia ter uma copia local e o contrato cultural
ficaria fragmentado.

O ecossistema ja possui uma memoria compartilhada em:

```text
$env:USERPROFILE\.agents\memories\principles
```

## Decisao

A fonte humana canonica dos principios passa a ser:

```text
$env:USERPROFILE\.agents\memories\principles\PRINCIPLES.md
```

O contrato operacional canonico passa a ser:

```text
$env:USERPROFILE\.agents\memories\principles\operational-contract.json
```

Ordem de resolucao:

1. `PPIRTV_PRINCIPLES_PATH`, quando configurado explicitamente.
2. `$env:USERPROFILE\.agents\memories\principles\operational-contract.json`.
3. `cwd/principles/operational-contract.json`, quando o projeto tiver contrato
   local.
4. fallback versionado do proprio `dex-PPIRTV` em `principles/`.

## Consequencias

- O contrato cultural deixa de depender de copia por repositorio.
- Projetos ainda podem testar contratos diferentes com `PPIRTV_PRINCIPLES_PATH`.
- Contrato local de projeto continua suportado, mas deixa de ser o default
  canonico.
- O fallback do harness continua existindo para evitar checklist vazio, mas
  `hygiene_scan` deve deixar essa condicao visivel.

## Alternativas rejeitadas

- Copiar `PRINCIPLES.md` inteiro para cada repo: aumenta drift e manutencao.
- Usar apenas `PPIRTV_PRINCIPLES_PATH`: exige configuracao manual em todos os
  clientes e facilita esquecimento.
- Remover o fallback do harness: deixaria clientes novos sem checklist de
  principios quando a memoria compartilhada ainda nao existisse.
