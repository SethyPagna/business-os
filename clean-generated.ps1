param(
  [switch]$Preview
)

$ErrorActionPreference = 'Stop'

<#
  clean-generated.ps1

  Removes generated artifacts that can be recreated by setup/build steps without
  touching source code, release docs, or the live business-os-data folder.

  Use cases:
  - force a clean dependency reinstall
  - clear stale frontend build output
  - reset release packaging artifacts

  Intentionally preserved:
  - all source code
  - backend/.env
  - business-os-data
  - release docs and ops config
#>

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$targets = @(
  'frontend\node_modules',
  'frontend\dist',
  'backend\node_modules',
  'backend\frontend-dist',
  'release',
  'dist-bin',
  'ops\runtime\build',
  'ops\runtime\logs',
  '_release_preserve',
  '_img_tmp',
  '_sharp_tmp',
  'business-os-server.exe'
) | ForEach-Object { Join-Path $root $_ }

Write-Host ''
Write-Host 'Business OS generated-artifact cleanup'
Write-Host '-------------------------------------'
Write-Host 'This removes reinstallable/generated files only.'
Write-Host 'It does NOT remove source code, .env, or business-os-data.'
if ($Preview) {
  Write-Host 'Preview mode is ON. No files will be removed.'
}
Write-Host ''

foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target)) { continue }
  $resolved = (Resolve-Path -LiteralPath $target).Path
  if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside workspace: $resolved"
  }
  if ($Preview) {
    Write-Host "Would remove $resolved"
    continue
  }
  Write-Host "Removing $resolved"
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

Write-Host ''
if ($Preview) {
  Write-Host 'Preview complete.'
} else {
  Write-Host 'Cleanup complete.'
}
