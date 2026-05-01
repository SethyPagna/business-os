param(
  [ValidateSet('Start', 'Stop', 'Monitor', 'RepairOnce')]
  [string]$Mode = 'Monitor',
  [string]$Root = '',
  [string]$TailscalePath = 'tailscale',
  [int]$IntervalSeconds = 60,
  [string]$Regions = '3,20,4,7'
)

$ErrorActionPreference = 'Continue'

if (-not $Root) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}

$runtimeDir = Join-Path $Root 'ops\runtime'
$logDir = Join-Path $runtimeDir 'logs'
$pidFile = Join-Path $runtimeDir 'tailscale-health-monitor.pid'
$logPath = Join-Path $logDir 'tailscale-health-monitor.log'

function Ensure-RuntimeDirs {
  if (-not (Test-Path -LiteralPath $runtimeDir)) {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  }
  if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }
}

function Write-MonitorLog {
  param([string]$Message)
  try {
    Ensure-RuntimeDirs
    if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt 1048576)) {
      Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    }
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  } catch {
    # Health logging must never stop the application runtime.
  }
}

function Resolve-TailscalePath {
  param([string]$Candidate)
  if ($Candidate -and (Test-Path -LiteralPath $Candidate)) {
    return (Resolve-Path -LiteralPath $Candidate).Path
  }
  if ($Candidate) {
    $cmd = Get-Command $Candidate -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
      return $cmd.Source
    }
  }
  foreach ($path in @(
    (Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Tailscale\tailscale.exe')
  )) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      return $path
    }
  }
  return $null
}

function Get-NetcheckText {
  $output = @()
  $exitCode = 1
  try {
    $output = @(& $script:ResolvedTailscalePath netcheck 2>&1)
    $exitCode = $LASTEXITCODE
  } catch {
    $output = @($_.Exception.Message)
    $exitCode = 1
  }
  return @{
    ExitCode = $exitCode
    Text = (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
  }
}

function Test-TailscaleRelayHealth {
  $result = Get-NetcheckText
  $text = [string]$result.Text
  $badRelay = (
    $text -match 'Nearest DERP:\s+unknown' -or
    $text -match 'no response to latency probes' -or
    $text -match 'could not connect' -or
    $text -match 'not running' -or
    $text -match 'logged out'
  )
  return @{
    Healthy = (($result.ExitCode -eq 0) -and (-not $badRelay))
    Text = $text
  }
}

function Invoke-DerpWarmup {
  param([string]$Region)
  $job = Start-Job -ScriptBlock {
    param($CommandPath, $DerpRegion)
    try {
      & $CommandPath debug derp $DerpRegion 2>$null | Out-Null
    } catch {}
  } -ArgumentList $script:ResolvedTailscalePath, $Region

  if (Wait-Job $job -Timeout 12 | Out-Null) {
    Receive-Job $job -ErrorAction SilentlyContinue | Out-Null
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}

function Repair-TailscaleRelay {
  Write-MonitorLog 'relay repair started'
  try { & $script:ResolvedTailscalePath debug rebind 2>$null | Out-Null } catch {}
  try { & $script:ResolvedTailscalePath debug restun 2>$null | Out-Null } catch {}

  foreach ($region in $script:RegionList) {
    Invoke-DerpWarmup -Region $region
    Start-Sleep -Seconds 1
    $check = Test-TailscaleRelayHealth
    if ($check.Healthy) {
      Write-MonitorLog ("relay repair succeeded via DERP region {0}" -f $region)
      return $true
    }
  }

  $final = Test-TailscaleRelayHealth
  if ($final.Healthy) {
    Write-MonitorLog 'relay repair succeeded after final netcheck'
    return $true
  }
  Write-MonitorLog ('relay repair failed: ' + (($final.Text -replace '\s+', ' ').Trim()))
  return $false
}

function Stop-MonitorProcess {
  Ensure-RuntimeDirs
  if (Test-Path -LiteralPath $pidFile) {
    $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
    $oldPid = 0
    if ([int]::TryParse($raw, [ref]$oldPid) -and $oldPid -gt 0 -and $oldPid -ne $PID) {
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }

  $scriptNamePattern = 'tailscale-health-monitor\.ps1'
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
      ([string]$_.CommandLine) -match $scriptNamePattern -and
      ([string]$_.CommandLine) -match '\-Mode\s+Monitor'
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Ensure-RuntimeDirs
$script:ResolvedTailscalePath = Resolve-TailscalePath -Candidate $TailscalePath
$script:RegionList = @($Regions -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })

if (-not $script:ResolvedTailscalePath) {
  Write-MonitorLog 'tailscale executable not found'
  Write-Output '[WARN] Tailscale CLI not found; health monitor not started.'
  exit 1
}

switch ($Mode) {
  'Start' {
    Stop-MonitorProcess
    $scriptPath = $PSCommandPath
    $powershellExe = (Get-Process -Id $PID).Path
    if (-not $powershellExe) { $powershellExe = 'powershell.exe' }

    $argumentList = @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', ('"{0}"' -f $scriptPath),
      '-Mode', 'Monitor',
      '-Root', ('"{0}"' -f $Root),
      '-TailscalePath', ('"{0}"' -f $script:ResolvedTailscalePath),
      '-IntervalSeconds', ([string][Math]::Max(30, $IntervalSeconds)),
      '-Regions', ('"{0}"' -f ($script:RegionList -join ','))
    ) -join ' '

    $process = Start-Process -FilePath $powershellExe -ArgumentList $argumentList -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pidFile -Encoding ASCII -Value $process.Id
    Write-MonitorLog ("monitor started pid={0}" -f $process.Id)
    Write-Output ("[OK] Tailscale health monitor running (PID {0})." -f $process.Id)
    exit 0
  }
  'Stop' {
    Stop-MonitorProcess
    Write-MonitorLog 'monitor stopped'
    Write-Output '[OK] Tailscale health monitor stopped.'
    exit 0
  }
  'RepairOnce' {
    $healthy = Test-TailscaleRelayHealth
    if ($healthy.Healthy) {
      Write-MonitorLog 'repair skipped because relay is healthy'
      Write-Output '[OK] Tailscale relay health passed.'
      exit 0
    }
    Write-MonitorLog ('relay unhealthy before repair: ' + (($healthy.Text -replace '\s+', ' ').Trim()))
    if (Repair-TailscaleRelay) {
      Write-Output '[OK] Tailscale relay health repaired.'
      exit 0
    }
    Write-Output '[WARN] Tailscale relay health repair failed.'
    exit 1
  }
  'Monitor' {
    Set-Content -LiteralPath $pidFile -Encoding ASCII -Value $PID
    Write-MonitorLog ("monitor loop started pid={0}" -f $PID)
    $lastRepairAt = [DateTime]::MinValue
    $repairCooldownSeconds = 300
    while ($true) {
      try {
        $health = Test-TailscaleRelayHealth
        if (-not $health.Healthy) {
          if (((Get-Date) - $lastRepairAt).TotalSeconds -ge $repairCooldownSeconds) {
            Write-MonitorLog ('relay unhealthy: ' + (($health.Text -replace '\s+', ' ').Trim()))
            $lastRepairAt = Get-Date
            Repair-TailscaleRelay | Out-Null
          } else {
            Write-MonitorLog 'relay unhealthy; repair cooldown active'
          }
        }
      } catch {
        Write-MonitorLog ('monitor error: ' + $_.Exception.Message)
      }
      Start-Sleep -Seconds ([Math]::Max(30, $IntervalSeconds))
    }
  }
}
