param(
  [switch]$Preview,
  [switch]$IncludeLockfiles
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

$root = if ($env:BUSINESS_OS_REPO_ROOT) {
  [System.IO.Path]::GetFullPath($env:BUSINESS_OS_REPO_ROOT)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
}
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

$lockfileTargets = @(
  'ops\demo\remotion-mobile-demo\package-lock.json',
  'ops\demo\video-tools\package-lock.json'
) | ForEach-Object { Join-Path $root $_ }

function Get-ProjectListenerProcesses {
  $results = @()
  try {
    $connections = Get-NetTCPConnection -State Listen -LocalPort 4000 -ErrorAction Stop
  } catch {
    return @()
  }

  foreach ($connection in $connections) {
    try {
      $proc = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
      if (-not $proc) { continue }
      $name = [string]$proc.Name
      $isProjectProcess = $name -ieq 'node' -or $name -ieq 'business-os-server'
      if ($isProjectProcess) {
        $results += [pscustomobject]@{
          ProcessId = $proc.Id
          Name = $name
        }
      }
    } catch {
      continue
    }
  }

  return $results
}

function Stop-ProjectProcesses {
  param(
    [switch]$PreviewOnly
  )

  $pm2Path = Get-Command pm2.cmd -ErrorAction SilentlyContinue
  if (-not $pm2Path) {
    $pm2Path = Get-Command pm2 -ErrorAction SilentlyContinue
  }
  if ($pm2Path) {
    if ($PreviewOnly) {
      Write-Host 'Would stop PM2 app "business-os" if it is running.'
    } else {
      try {
        & $pm2Path.Source stop business-os *> $null
        Write-Host 'Stopped PM2 app "business-os" (if it was running).'
      } catch {
        Write-Host 'PM2 stop skipped or failed; continuing with direct process checks.'
      }
    }
  }

  try {
    $packaged = Get-Process business-os-server -ErrorAction SilentlyContinue
    if ($packaged) {
      if ($PreviewOnly) {
        Write-Host 'Would stop packaged process business-os-server.exe.'
      } else {
        $packaged | Stop-Process -Force
        Write-Host 'Stopped packaged process business-os-server.exe.'
      }
    }
  } catch {
    Write-Host 'Packaged server stop skipped; continuing.'
  }

  $projectListeners = Get-ProjectListenerProcesses
  foreach ($listener in $projectListeners) {
    if ($PreviewOnly) {
      Write-Host ("Would stop process PID {0} ({1}) listening on port 4000." -f $listener.ProcessId, $listener.Name)
      continue
    }
    try {
      Stop-Process -Id $listener.ProcessId -Force -ErrorAction Stop
      Write-Host ("Stopped process PID {0} ({1}) that was listening on port 4000." -f $listener.ProcessId, $listener.Name)
    } catch {
      Write-Host ("Could not stop PID {0}; continuing cleanup attempt." -f $listener.ProcessId)
    }
  }

  if (-not $PreviewOnly) {
    Start-Sleep -Milliseconds 800
  }
}

Write-Host ''
Write-Host 'Business OS generated-artifact cleanup'
Write-Host '-------------------------------------'
Write-Host 'This removes reinstallable/generated files only.'
Write-Host 'It does NOT remove source code, .env, or business-os-data.'
if ($Preview) {
  Write-Host 'Preview mode is ON. No files will be removed.'
}
if ($IncludeLockfiles) {
  Write-Host 'Deep cleanup mode: ignored demo package-lock files will be removed.'
  Write-Host 'Production lockfiles in backend/ and frontend/ are preserved.'
}
Write-Host ''

Stop-ProjectProcesses -PreviewOnly:$Preview

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
  try {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
  } catch {
    throw "Failed to remove $resolved. Make sure Business OS is not still using this path. Inner error: $($_.Exception.Message)"
  }
}

if ($IncludeLockfiles) {
  foreach ($target in $lockfileTargets) {
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
    try {
      Remove-Item -LiteralPath $resolved -Force -ErrorAction Stop
    } catch {
      throw "Failed to remove $resolved. Inner error: $($_.Exception.Message)"
    }
  }
}

Write-Host ''
if ($Preview) {
  Write-Host 'Preview complete.'
} else {
  Write-Host 'Cleanup complete.'
}
