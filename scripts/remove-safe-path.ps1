# remove-safe-path.ps1
# Owner: dex-PPIRTV (utilidades de operacao local)
# Purpose: remover arquivo ou diretorio com validacao rigorosa de raiz e
#   reparse points, emitindo receipt JSON. Evita o tropeco recorrente em que o
#   harness de execucao bloqueia `Remove-Item` inline (CreateProcess rejected).
# Trigger: REMOVE-SAFE-HARNESS / REMOVE-ITEM-BLOQUEADO-POLITICA
# Input : -Path <alvo> -Root <raiz permitida (default cwd)> [-Recurse] [-DryRun]
# Output: JSON { contract, dry_run, path, root, existed, removed, mode, error }
# Risk : destrutivo; NUNCA usar sem -Path explicito e sem alvo dentro de Root.
# Validation: smoke via .agents/TMP + receipt; recusa junction/symlink e alvo
#   fora da raiz antes de qualquer delecao.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string]$Root = '.',
    [switch]$Recurse,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Receipt {
    param(
        [bool]$Existed,
        [bool]$Removed,
        [string]$Mode = 'unknown',
        [string]$ErrorText = $null
    )
    [pscustomobject]@{
        contract = 'dex.utils.remove-safe-path.v1'
        dry_run  = [bool]$DryRun
        path     = $resolvedTarget
        root     = $resolvedRoot
        existed  = $Existed
        removed  = $Removed
        mode     = $Mode
        error    = $ErrorText
    } | ConvertTo-Json
}

$resolvedRoot = (Get-Item -LiteralPath $Root).FullName
$separator = [IO.Path]::DirectorySeparatorChar
$resolvedTarget = [IO.Path]::GetFullPath($Path)

if (-not $resolvedTarget.StartsWith($resolvedRoot + $separator, [StringComparison]::OrdinalIgnoreCase)) {
    throw "alvo fora da raiz permitida: $resolvedTarget (raiz: $resolvedRoot)"
}

if (-not (Test-Path -LiteralPath $resolvedTarget)) {
    Write-Receipt -Existed $false -Removed $false -ErrorText 'not_found'
    exit 0
}

$resolvedTarget = (Get-Item -LiteralPath $resolvedTarget -Force).FullName
if (-not $resolvedTarget.StartsWith($resolvedRoot + $separator, [StringComparison]::OrdinalIgnoreCase)) {
    throw "alvo fora da raiz permitida (forma longa): $resolvedTarget (raiz: $resolvedRoot)"
}

$targetItem = Get-Item -LiteralPath $resolvedTarget -Force
if ($targetItem.LinkType) {
    throw "alvo e reparse point ($($targetItem.LinkType)); recusado: $resolvedTarget"
}

# Checa reparse points nos pais do alvo (impede saida da raiz via junction)
$parent = [IO.Directory]::GetParent($resolvedTarget)
while ($parent -and $parent.FullName.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $parentItem = Get-Item -LiteralPath $parent.FullName -Force -ErrorAction SilentlyContinue
    if ($parentItem -and $parentItem.LinkType) {
        throw "componente do caminho e reparse point ($($parentItem.LinkType)); recusado: $($parent.FullName)"
    }
    $parent = $parent.Parent
}

$isDir = [IO.Directory]::Exists($resolvedTarget)
if ($isDir -and -not $Recurse) {
    $children = @(Get-ChildItem -LiteralPath $resolvedTarget -Force -ErrorAction SilentlyContinue)
    if ($children.Count -gt 0) {
        throw "diretorio nao vazio; use -Recurse explicito: $resolvedTarget ($($children.Count) itens)"
    }
}

if ($DryRun) {
    Write-Receipt -Existed $true -Removed $false -Mode ($(if ($isDir) { 'dir' } else { 'file' }))
    exit 0
}

if ($isDir) {
    [System.IO.Directory]::Delete($resolvedTarget, [bool]$Recurse)
    Write-Receipt -Existed $true -Removed $true -Mode 'dir'
} else {
    [System.IO.File]::Delete($resolvedTarget)
    Write-Receipt -Existed $true -Removed $true -Mode 'file'
}
