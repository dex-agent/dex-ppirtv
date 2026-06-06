# Principles Sync Contract

Status: vigente
Revision: `2026-06-06.1`
Last-Updated: `2026-06-06`

## Fonte canonica

```text
$env:USERPROFILE\.agents\memories\principles\PRINCIPLES.md
$env:USERPROFILE\.agents\memories\principles\operational-contract.json
```

## Copia canonica do repo

```text
C:\CodexProjetos\dex-PPIRTV\principles\PRINCIPLES.md
C:\CodexProjetos\dex-PPIRTV\principles\operational-contract.json
```

## Regra

A fonte global e a fonte de verdade operacional. A copia do repo deve ficar
sincronizada byte-a-byte apos qualquer mudanca aprovada nos principios ou no
contrato operacional.

Toda manutencao deve atualizar:

- `Principles-Revision` e `Last-Updated` em `PRINCIPLES.md`;
- `version`, `principles_revision` e `updated_at` em
  `operational-contract.json`;
- esta revisao quando a regra de sincronizacao mudar.

## Validacao minima

```powershell
$globalPrinciples = "$env:USERPROFILE\.agents\memories\principles\PRINCIPLES.md"
$localPrinciples = "C:\CodexProjetos\dex-PPIRTV\principles\PRINCIPLES.md"
$globalContract = "$env:USERPROFILE\.agents\memories\principles\operational-contract.json"
$localContract = "C:\CodexProjetos\dex-PPIRTV\principles\operational-contract.json"

(Get-FileHash -Algorithm SHA256 -LiteralPath $globalPrinciples).Hash -eq
  (Get-FileHash -Algorithm SHA256 -LiteralPath $localPrinciples).Hash

(Get-FileHash -Algorithm SHA256 -LiteralPath $globalContract).Hash -eq
  (Get-FileHash -Algorithm SHA256 -LiteralPath $localContract).Hash

Get-Content -Raw -LiteralPath $localContract | ConvertFrom-Json | Out-Null
```

## Gate Final PPIRTV

- Principio acionado: fonte canonica e copia local de principios.
- Acao executada: sincronizar global -> repo.
- Evidencia: hashes SHA256 iguais e contrato JSON parseavel.
- Risco restante: copia pode divergir em manutencao futura se edicao for feita
  direto no repo.
- Destino rastreavel: este contrato e os metadados de revisao nos dois arquivos.
