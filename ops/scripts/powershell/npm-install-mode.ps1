param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath
)

$ErrorActionPreference = 'Stop'

$resolvedProject = [System.IO.Path]::GetFullPath($ProjectPath)
$stamp = Join-Path $resolvedProject 'node_modules/.package-lock.json'
$lock = Join-Path $resolvedProject 'package-lock.json'
$pkg = Join-Path $resolvedProject 'package.json'

if ((Test-Path -LiteralPath $stamp) -and
    (Test-Path -LiteralPath $lock) -and
    (Test-Path -LiteralPath $pkg)) {
  $latest = @(
    (Get-Item -LiteralPath $pkg).LastWriteTimeUtc,
    (Get-Item -LiteralPath $lock).LastWriteTimeUtc
  ) | Sort-Object -Descending | Select-Object -First 1
  $installed = (Get-Item -LiteralPath $stamp).LastWriteTimeUtc
  if ($installed -ge $latest) {
    Write-Output 'skip'
    exit 0
  }
}

Write-Output 'install'
