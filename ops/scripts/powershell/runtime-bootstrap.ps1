param(
  [ValidateSet('Setup', 'Start', 'Verify', 'Scale')]
  [string]$Mode = 'Verify',
  [switch]$InstallMissing,
  [switch]$StartServices,
  [switch]$RequireServices,
  [ValidateSet('up', 'down', 'status', 'logs')]
  [string]$ScaleAction = 'status'
)

$ErrorActionPreference = 'Stop'

function Write-Step($message) {
  Write-Host "[INFO] $message"
}

function Write-Ok($message) {
  Write-Host "[OK] $message"
}

function Write-Warn($message) {
  Write-Host "[WARN] $message"
}

function Fail($message, $code = 1) {
  Write-Host "[ERROR] $message"
  exit $code
}

function Resolve-RepoRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
  return $root.Path
}

$Root = Resolve-RepoRoot
$ComposeFile = Join-Path $Root 'ops\docker\compose.scale.yml'
$DockerConfig = Join-Path $Root 'ops\runtime\docker-config'
$SecretDir = Join-Path $Root 'ops\runtime\secrets'
$RuntimeLicense = Join-Path $SecretDir 'minio.license'
$RootLicense = Join-Path $Root 'minio.license'

function Find-Executable($names, $fallbacks = @()) {
  foreach ($name in $names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }
  foreach ($candidate in $fallbacks) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return ''
}

function Install-WithWinget($id, $label) {
  $winget = Find-Executable @('winget.exe', 'winget')
  if (-not $winget) {
    Fail "$label is missing and winget is not available. Install $label manually, then run setup.bat again."
  }

  Write-Step "Installing $label with winget..."
  & $winget install --id $id --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    Fail "winget could not install $label. Install it manually, restart Windows if requested, then run setup.bat again."
  }
}

function Ensure-Tool($label, $ids, $fallbacks, $wingetId, [bool]$required = $true) {
  $path = Find-Executable $ids $fallbacks
  if ($path) {
    Write-Ok "$label found: $path"
    return $path
  }

  if ($InstallMissing -and $wingetId) {
    Install-WithWinget $wingetId $label
    $path = Find-Executable $ids $fallbacks
    if ($path) {
      Write-Ok "$label found after install: $path"
      return $path
    }
    Write-Warn "$label was installed but is not available in this shell yet. Restart this terminal or Windows, then run setup.bat again."
  }

  if ($required) {
    $hint = if ($wingetId) { "Run setup.bat on a machine with winget, or install $label manually." } else { "Install $label manually, then run setup.bat again." }
    Fail "$label was not found. $hint"
  }

  Write-Warn "$label was not found. Continuing without it."
  return ''
}

function Ensure-Directory($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

function Prepare-DockerRuntime {
  Ensure-Directory $DockerConfig
  Ensure-Directory $SecretDir

  if (Test-Path -LiteralPath $RootLicense) {
    Copy-Item -LiteralPath $RootLicense -Destination $RuntimeLicense -Force
    Write-Ok 'MinIO license copied into ignored runtime secret storage.'
  } elseif (-not (Test-Path -LiteralPath $RuntimeLicense)) {
    New-Item -ItemType File -Force -Path $RuntimeLicense | Out-Null
    Write-Ok 'MinIO runtime license placeholder created.'
  }

  $env:DOCKER_CONFIG = $DockerConfig
  $env:MINIO_LICENSE_HOST_FILE = $RuntimeLicense
}

function Start-DockerDesktop($dockerExe) {
  $dockerDesktop = Find-Executable @() @(
    'C:\Program Files\Docker\Docker\Docker Desktop.exe',
    'C:\Program Files\Docker Desktop\Docker Desktop.exe'
  )
  if (-not $dockerDesktop) {
    Fail 'Docker Desktop is installed incompletely or cannot be started. Open Docker Desktop manually, wait for it to say Running, then run start-server.bat again.'
  }

  Write-Step 'Starting Docker Desktop...'
  try {
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
  } catch {
    Start-Process -FilePath $dockerDesktop | Out-Null
  }
  Wait-DockerEngine $dockerExe 180
}

function Test-DockerEngine($dockerExe) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $dockerExe info --format '{{.ServerVersion}}' > $null 2> $null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldPreference
  return ($code -eq 0)
}

function Wait-DockerEngine($dockerExe, $timeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    if (Test-DockerEngine $dockerExe) {
      Write-Ok 'Docker engine is ready.'
      return
    }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  Fail 'Docker Desktop did not become ready. Open Docker Desktop, finish any setup/restart prompts, then run start-server.bat again.'
}

function Invoke-Compose($dockerExe, [string[]]$composeArgs) {
  $dockerArgs = @('compose', '-f', $ComposeFile) + $composeArgs
  $process = Start-Process -FilePath $dockerExe -ArgumentList $dockerArgs -Wait -NoNewWindow -PassThru
  return $process.ExitCode
}

function Ensure-ComposeFile {
  if (-not (Test-Path -LiteralPath $ComposeFile)) {
    Fail "Scale service Compose file is missing: $ComposeFile"
  }
}

function Start-ScaleServices($dockerExe) {
  Ensure-ComposeFile
  Write-Step 'Starting required Redis, Postgres, and MinIO services...'
  $code = Invoke-Compose $dockerExe @('up', '-d')
  if ($code -ne 0) {
    Fail 'Docker Compose could not start the required Business OS services.'
  }
  Wait-ScaleServicesHealthy $dockerExe 180
}

function Get-ServiceHealth($dockerExe, $service) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $containerId = (& $dockerExe compose -f $ComposeFile ps -q $service 2>$null | Select-Object -First 1)
  if (-not $containerId) {
    $ErrorActionPreference = $oldPreference
    return 'missing'
  }
  $health = (& $dockerExe inspect -f '{{.State.Health.Status}}' $containerId 2>$null | Select-Object -First 1)
  if (-not $health) {
    $running = (& $dockerExe inspect -f '{{.State.Running}}' $containerId 2>$null | Select-Object -First 1)
    $ErrorActionPreference = $oldPreference
    if ($running -eq 'true') { return 'running' }
    return 'stopped'
  }
  $ErrorActionPreference = $oldPreference
  return ([string]$health).Trim()
}

function Wait-ScaleServicesHealthy($dockerExe, $timeoutSeconds = 90) {
  $services = @('redis', 'postgres', 'minio')
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    $statuses = @{}
    $allHealthy = $true
    foreach ($service in $services) {
      $health = Get-ServiceHealth $dockerExe $service
      $statuses[$service] = $health
      if ($health -notin @('healthy', 'running')) { $allHealthy = $false }
    }
    if ($allHealthy) {
      Write-Ok "Scale services ready: redis=$($statuses.redis), postgres=$($statuses.postgres), minio=$($statuses.minio)"
      return
    }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)

  foreach ($service in $services) {
    Write-Warn "$service health: $(Get-ServiceHealth $dockerExe $service)"
  }
  Fail 'Required Business OS services are not healthy. Open Docker Desktop and run ops\run\bat\scale-services.bat status for support details.'
}

function Verify-ScaleServices($dockerExe) {
  Ensure-ComposeFile
  Wait-DockerEngine $dockerExe 30
  $services = @('redis', 'postgres', 'minio')
  $failed = @()
  foreach ($service in $services) {
    $health = Get-ServiceHealth $dockerExe $service
    if ($health -in @('healthy', 'running')) {
      Write-Ok "$service is $health"
    } else {
      $failed += "$service=$health"
    }
  }
  if ($failed.Count -gt 0) {
    if ($RequireServices) {
      Fail "Required scale services are not ready: $($failed -join ', ')"
    }
    Write-Warn "Scale services are not ready: $($failed -join ', ')"
  }
}

function Invoke-ScaleAction($dockerExe) {
  Ensure-ComposeFile
  switch ($ScaleAction) {
    'up' {
      Start-ScaleServices $dockerExe
    }
    'down' {
      Write-Step 'Stopping Business OS scale services...'
      $code = Invoke-Compose $dockerExe @('down')
      if ($code -ne 0) { Fail 'Docker Compose could not stop scale services.' }
    }
    'status' {
      $code = Invoke-Compose $dockerExe @('ps')
      if ($code -ne 0 -and $RequireServices) { Fail 'Could not read scale service status.' }
    }
    'logs' {
      $code = Invoke-Compose $dockerExe @('logs', '--tail=200')
      if ($code -ne 0 -and $RequireServices) { Fail 'Could not read scale service logs.' }
    }
  }
}

Write-Host ''
Write-Host '========================================================================'
Write-Host "  Business OS | Runtime Bootstrap ($Mode)"
Write-Host '========================================================================'
Write-Host ''

Prepare-DockerRuntime

$node = Ensure-Tool 'Node.js' @('node.exe', 'node') @('C:\Program Files\nodejs\node.exe') 'OpenJS.NodeJS.LTS' ($Mode -eq 'Setup')
$git = Ensure-Tool 'Git' @('git.exe', 'git') @('C:\Program Files\Git\cmd\git.exe') 'Git.Git' ($Mode -eq 'Setup')
$openssl = Ensure-Tool 'OpenSSL' @('openssl.exe', 'openssl') @('C:\Program Files\OpenSSL-Win64\bin\openssl.exe', 'C:\Program Files\OpenSSL-Win32\bin\openssl.exe') 'ShiningLight.OpenSSL.Light' $false
$tailscale = Ensure-Tool 'Tailscale' @('tailscale.exe', 'tailscale') @('C:\Program Files\Tailscale\tailscale.exe', 'C:\Program Files (x86)\Tailscale\tailscale.exe') 'Tailscale.Tailscale' $false
$docker = Ensure-Tool 'Docker CLI' @('docker.exe', 'docker') @('C:\Program Files\Docker\Docker\resources\bin\docker.exe') 'Docker.DockerDesktop' $true

try {
  if (-not (Test-DockerEngine $docker)) {
    if ($Mode -in @('Setup', 'Start') -or $StartServices -or $RequireServices) {
      Start-DockerDesktop $docker
    } else {
      Fail 'Docker Desktop is not running. Start Docker Desktop, then run this command again.'
    }
  } else {
    Write-Ok 'Docker engine is reachable.'
  }
} catch {
  if ($Mode -in @('Setup', 'Start') -or $StartServices -or $RequireServices) {
    Start-DockerDesktop $docker
  } else {
    Fail 'Docker Desktop is not reachable. Start Docker Desktop, then run this command again.'
  }
}

switch ($Mode) {
  'Setup' {
    Start-ScaleServices $docker
  }
  'Start' {
    Start-ScaleServices $docker
  }
  'Verify' {
    if ($RequireServices -or $StartServices) {
      Start-ScaleServices $docker
    } else {
      Verify-ScaleServices $docker
    }
  }
  'Scale' {
    Invoke-ScaleAction $docker
  }
}

Write-Host ''
Write-Ok 'Runtime bootstrap complete.'
exit 0
