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
  'node_modules',
  'ops\node_modules',
  'release',
  'output',
  'dist-bin',
  'ops\runtime\build',
  '.playwright-cli',
  'ops\.playwright-cli',
  'run\cv-render-check-word',
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

function Get-PathSizeBytes {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer) { return [int64]$item.Length }
  $total = (Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if ($null -eq $total) { return 0 }
  return [int64]$total
}

function Format-Bytes {
  param(
    [Parameter(Mandatory = $true)]
    [int64]$Bytes
  )

  if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
  return ("$Bytes B")
}

$cleanupResults = @()

function Add-CleanupResult {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [int64]$Bytes,
    [Parameter(Mandatory = $true)]
    [string]$Mode
  )

  $script:cleanupResults += [pscustomobject]@{
    Path = $Path
    Bytes = $Bytes
    Size = Format-Bytes -Bytes $Bytes
    Mode = $Mode
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
  $bytes = Get-PathSizeBytes -Path $resolved
  if ($Preview) {
    Write-Host ("Would remove {0} ({1})" -f $resolved, (Format-Bytes -Bytes $bytes))
    Add-CleanupResult -Path $resolved -Bytes $bytes -Mode 'preview'
    continue
  }
  Write-Host ("Removing {0} ({1})" -f $resolved, (Format-Bytes -Bytes $bytes))
  try {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
    Add-CleanupResult -Path $resolved -Bytes $bytes -Mode 'removed'
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
    $bytes = Get-PathSizeBytes -Path $resolved
    if ($Preview) {
      Write-Host ("Would remove {0} ({1})" -f $resolved, (Format-Bytes -Bytes $bytes))
      Add-CleanupResult -Path $resolved -Bytes $bytes -Mode 'preview'
      continue
    }
    Write-Host ("Removing {0} ({1})" -f $resolved, (Format-Bytes -Bytes $bytes))
    try {
      Remove-Item -LiteralPath $resolved -Force -ErrorAction Stop
      Add-CleanupResult -Path $resolved -Bytes $bytes -Mode 'removed'
    } catch {
      throw "Failed to remove $resolved. Inner error: $($_.Exception.Message)"
    }
  }
}

Write-Host ''
$totalBytes = [int64](($cleanupResults | Measure-Object -Property Bytes -Sum).Sum)
if ($cleanupResults.Count -gt 0) {
  Write-Host 'Cleanup target summary:'
  $cleanupResults | Sort-Object -Property Bytes -Descending | Format-Table -AutoSize Path, Size, Mode
  if ($Preview) {
    Write-Host ("Total bytes that would be removed: {0}" -f (Format-Bytes -Bytes $totalBytes))
  } else {
    Write-Host ("Total bytes removed: {0}" -f (Format-Bytes -Bytes $totalBytes))
  }
} else {
  Write-Host 'No cleanup targets found.'
}
Write-Host ''
if ($Preview) {
  Write-Host 'Preview complete.'
} else {
  Write-Host 'Cleanup complete.'
}
