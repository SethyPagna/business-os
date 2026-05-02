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
$DockerScaleEnv = Join-Path $Root 'ops\runtime\docker-scale.env'
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

function Invoke-ProcessWithTimeout($filePath, [string[]]$arguments = @(), [int]$timeoutSeconds = 20) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $filePath
  $psi.Arguments = (($arguments | ForEach-Object {
    $arg = [string]$_
    if ($arg -match '[\s"]') {
      '"' + ($arg -replace '"', '\"') + '"'
    } else {
      $arg
    }
  }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  try {
    [void]$process.Start()
    if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
      try {
        $process.Kill($true)
      } catch {
        try { $process.Kill() } catch {}
      }
      return [pscustomobject]@{
        ExitCode = 124
        TimedOut = $true
        Stdout = ''
        Stderr = "Timed out after ${timeoutSeconds}s"
      }
    }
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      TimedOut = $false
      Stdout = $process.StandardOutput.ReadToEnd()
      Stderr = $process.StandardError.ReadToEnd()
    }
  } catch {
    return [pscustomobject]@{
      ExitCode = 1
      TimedOut = $false
      Stdout = ''
      Stderr = $_.Exception.Message
    }
  } finally {
    $process.Dispose()
  }
}

function Install-WithWinget($id, $label) {
  $winget = Find-Executable @('winget.exe', 'winget')
  if (-not $winget) {
    Fail "$label is missing and winget is not available. Install $label manually, then run run\setup.bat again."
  }

  Write-Step "Installing $label with winget..."
  & $winget install --id $id --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    Fail "winget could not install $label. Install it manually, restart Windows if requested, then run run\setup.bat again."
  }
}

function Ensure-Tool($label, $ids, $fallbacks, $wingetId, [bool]$required = $true) {
  $path = Find-Executable $ids $fallbacks
  if ($path) {
    Write-Ok "$label found: $path"
    return $path
  }

  if ($InstallMissing -and $wingetId -and ($required -or $Mode -eq 'Setup')) {
    Install-WithWinget $wingetId $label
    $path = Find-Executable $ids $fallbacks
    if ($path) {
      Write-Ok "$label found after install: $path"
      return $path
    }
    Write-Warn "$label was installed but is not available in this shell yet. Restart this terminal or Windows, then run run\setup.bat again."
  }

  if ($required) {
    $hint = if ($wingetId) { "Run run\setup.bat on a machine with winget, or install $label manually." } else { "Install $label manually, then run run\setup.bat again." }
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

function Write-DockerScaleProfile {
  Ensure-Directory (Split-Path -Parent $DockerScaleEnv)
  $profile = if ($env:BUSINESS_OS_DOCKER_PROFILE) { $env:BUSINESS_OS_DOCKER_PROFILE } else { 'performance' }
  $profile = ([string]$profile).Trim().ToLowerInvariant()
  if ($profile -notin @('balanced', 'performance', 'maximum')) {
    Write-Warn "Unknown BUSINESS_OS_DOCKER_PROFILE '$profile'. Falling back to performance."
    $profile = 'performance'
  }

  $values = [ordered]@{
    BUSINESS_OS_DOCKER_PROFILE = $profile
    BUSINESS_OS_APP_RUNTIME = 'docker'
    DATABASE_DRIVER = 'sqlite'
    OBJECT_STORAGE_DRIVER = 'local'
    REDIS_QUEUE_BIND_HOST = '127.0.0.1'
    REDIS_QUEUE_PORT = '6379'
    REDIS_QUEUE_MAX_MEMORY = '1536mb'
    REDIS_QUEUE_MEMORY_LIMIT = '1536m'
    REDIS_QUEUE_CPUS = '1.0'
    REDIS_CACHE_BIND_HOST = '127.0.0.1'
    REDIS_CACHE_PORT = '6380'
    REDIS_CACHE_MAX_MEMORY = '768mb'
    REDIS_CACHE_MEMORY_LIMIT = '768m'
    REDIS_CACHE_CPUS = '0.5'
    POSTGRES_BIND_HOST = '127.0.0.1'
    POSTGRES_PORT = '55432'
    POSTGRES_MEMORY_LIMIT = '4608m'
    POSTGRES_CPUS = '4.0'
    POSTGRES_SHM_SIZE = '1g'
    POSTGRES_SHARED_BUFFERS = '1GB'
    POSTGRES_EFFECTIVE_CACHE_SIZE = '3GB'
    POSTGRES_WORK_MEM = '32MB'
    POSTGRES_MAINTENANCE_WORK_MEM = '512MB'
    POSTGRES_MAX_WAL_SIZE = '4GB'
    POSTGRES_CHECKPOINT_TIMEOUT = '20min'
    MINIO_BIND_HOST = '127.0.0.1'
    MINIO_MEMORY_LIMIT = '1536m'
    MINIO_CPUS = '1.5'
    APP_BIND_HOST = '127.0.0.1'
    APP_MEMORY_LIMIT = '1024m'
    APP_CPUS = '1.5'
    IMPORT_WORKER_MEMORY_LIMIT = '2560m'
    IMPORT_WORKER_CPUS = '3.0'
    MEDIA_WORKER_MEMORY_LIMIT = '3072m'
    MEDIA_WORKER_CPUS = '3.5'
    IMPORT_QUEUE_CONCURRENCY = '3'
    MEDIA_QUEUE_CONCURRENCY = '4'
    IMPORT_ROW_BATCH_SIZE = '400'
    IMPORT_BATCH_PAUSE_MS = '20'
    IMPORT_IMAGE_CONCURRENCY = '4'
    RUNTIME_CACHE_ENABLED = '1'
    UPLOAD_CHUNK_MB = '12'
  }

  if ($profile -eq 'balanced') {
    $values['POSTGRES_MEMORY_LIMIT'] = '3072m'
    $values['POSTGRES_CPUS'] = '2.5'
    $values['POSTGRES_SHM_SIZE'] = '768m'
    $values['POSTGRES_SHARED_BUFFERS'] = '768MB'
    $values['POSTGRES_EFFECTIVE_CACHE_SIZE'] = '2GB'
    $values['POSTGRES_WORK_MEM'] = '24MB'
    $values['POSTGRES_MAINTENANCE_WORK_MEM'] = '256MB'
    $values['IMPORT_WORKER_MEMORY_LIMIT'] = '1536m'
    $values['IMPORT_WORKER_CPUS'] = '1.5'
    $values['MEDIA_WORKER_MEMORY_LIMIT'] = '2048m'
    $values['MEDIA_WORKER_CPUS'] = '2.0'
    $values['IMPORT_QUEUE_CONCURRENCY'] = '2'
    $values['MEDIA_QUEUE_CONCURRENCY'] = '3'
    $values['IMPORT_IMAGE_CONCURRENCY'] = '3'
  } elseif ($profile -eq 'maximum') {
    $values['REDIS_QUEUE_MEMORY_LIMIT'] = '2048m'
    $values['REDIS_QUEUE_MAX_MEMORY'] = '2048mb'
    $values['REDIS_QUEUE_CPUS'] = '1.5'
    $values['REDIS_CACHE_MEMORY_LIMIT'] = '1024m'
    $values['REDIS_CACHE_MAX_MEMORY'] = '1024mb'
    $values['REDIS_CACHE_CPUS'] = '0.75'
    $values['POSTGRES_MEMORY_LIMIT'] = '6144m'
    $values['POSTGRES_CPUS'] = '5.0'
    $values['POSTGRES_SHM_SIZE'] = '1536m'
    $values['POSTGRES_SHARED_BUFFERS'] = '1536MB'
    $values['POSTGRES_EFFECTIVE_CACHE_SIZE'] = '4GB'
    $values['POSTGRES_WORK_MEM'] = '48MB'
    $values['POSTGRES_MAINTENANCE_WORK_MEM'] = '768MB'
    $values['MINIO_MEMORY_LIMIT'] = '2048m'
    $values['MINIO_CPUS'] = '2.0'
    $values['IMPORT_WORKER_MEMORY_LIMIT'] = '3584m'
    $values['IMPORT_WORKER_CPUS'] = '4.0'
    $values['MEDIA_WORKER_MEMORY_LIMIT'] = '4096m'
    $values['MEDIA_WORKER_CPUS'] = '4.5'
    $values['IMPORT_QUEUE_CONCURRENCY'] = '4'
    $values['MEDIA_QUEUE_CONCURRENCY'] = '4'
  }

  foreach ($key in @($values.Keys)) {
    $override = [Environment]::GetEnvironmentVariable($key)
    if ($override) { $values[$key] = $override }
  }

  $lines = @(
    '# Generated by Business OS runtime bootstrap. Safe to delete; it will be recreated.',
    '# Secrets are intentionally not stored here.',
    "# Profile: $profile"
  )
  foreach ($entry in $values.GetEnumerator()) {
    $lines += "$($entry.Key)=$($entry.Value)"
  }
  Set-Content -LiteralPath $DockerScaleEnv -Value $lines -Encoding ASCII
  Write-Ok "Docker scale profile ready: $profile ($DockerScaleEnv)"
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
  Write-DockerScaleProfile
}

function Start-DockerDesktop($dockerExe) {
  $dockerDesktop = Find-Executable @() @(
    'C:\Program Files\Docker\Docker\Docker Desktop.exe',
    'C:\Program Files\Docker Desktop\Docker Desktop.exe'
  )
  if (-not $dockerDesktop) {
    Fail 'Docker Desktop is installed incompletely or cannot be started. Open Docker Desktop manually, wait for it to say Running, then run run\start-server.bat again.'
  }

  Write-Step 'Starting Docker Desktop. This can take 1-3 minutes on Windows...'
  try {
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
  } catch {
    Start-Process -FilePath $dockerDesktop | Out-Null
  }
  Wait-DockerEngine $dockerExe 180
}

function Test-DockerEngine($dockerExe) {
  $result = Invoke-ProcessWithTimeout $dockerExe @('info', '--format', '{{.ServerVersion}}') 20
  if ($result.TimedOut) {
    Write-Warn 'Docker CLI did not answer within 20 seconds. Docker Desktop may still be starting.'
    return $false
  }
  return ($result.ExitCode -eq 0)
}

function Wait-DockerEngine($dockerExe, $timeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  $attempt = 0
  do {
    $attempt++
    if (Test-DockerEngine $dockerExe) {
      Write-Ok 'Docker engine is ready.'
      return
    }
    if (($attempt -eq 1) -or (($attempt % 5) -eq 0)) {
      Write-Step "Waiting for Docker engine... attempt $attempt"
    }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  Fail 'Docker Desktop did not become ready. Open Docker Desktop, finish any setup/restart prompts, then run run\start-server.bat again.'
}

function Invoke-Compose($dockerExe, [string[]]$composeArgs) {
  $dockerArgs = @('compose', '--progress', 'quiet', '--env-file', $DockerScaleEnv, '-f', $ComposeFile) + $composeArgs
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
  Remove-StoppedScaleContainers $dockerExe
  Write-Step 'Starting required Redis queue/cache, Postgres, and MinIO services...'
  $code = Invoke-Compose $dockerExe @('up', '-d', '--remove-orphans')
  if ($code -ne 0) {
    Fail 'Docker Compose could not start the required Business OS services.'
  }
  Wait-ScaleServicesHealthy $dockerExe 180
}

function Remove-StoppedScaleContainers($dockerExe) {
  try {
    Write-Step 'Cleaning stopped Business OS Docker service containers...'
    $dockerArgs = @('compose', '--progress', 'quiet', '--env-file', $DockerScaleEnv, '-f', $ComposeFile, 'rm', '-f')
    $result = Invoke-ProcessWithTimeout $dockerExe $dockerArgs 60
    $code = $result.ExitCode
    if ($code -eq 0) {
      Write-Ok 'Stopped Business OS Docker service containers cleaned.'
    } else {
      Write-Warn 'Docker cleanup skipped; continuing startup.'
    }
  } catch {
    Write-Warn 'Docker cleanup skipped; continuing startup.'
  }
}

function Update-ScaleServiceImages($dockerExe) {
  Ensure-ComposeFile
  Write-Step 'Checking for newer Docker service images...'
  $code = Invoke-Compose $dockerExe @('pull', 'redis-queue', 'redis-cache', 'postgres', 'minio')
  if ($code -eq 0) {
    Write-Ok 'Docker service images are available locally.'
  } else {
    Write-Warn 'Docker image update check failed. Startup can still continue with local images if present.'
  }
}

function Get-ServiceHealth($dockerExe, $service) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $containerId = (& $dockerExe compose --env-file $DockerScaleEnv -f $ComposeFile ps -q $service 2>$null | Select-Object -First 1)
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
  $services = @('redis-queue', 'redis-cache', 'postgres', 'minio')
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
      Write-Ok "Scale services ready: redis-queue=$($statuses['redis-queue']), redis-cache=$($statuses['redis-cache']), postgres=$($statuses.postgres), minio=$($statuses.minio)"
      Show-DockerResourceSummary $dockerExe
      return
    }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)

  foreach ($service in $services) {
    Write-Warn "$service health: $(Get-ServiceHealth $dockerExe $service)"
  }
  Fail 'Required Business OS services are not healthy. Open Docker Desktop and run run\docker\doctor.bat for support details.'
}

function Verify-ScaleServices($dockerExe) {
  Ensure-ComposeFile
  Wait-DockerEngine $dockerExe 30
  $services = @('redis-queue', 'redis-cache', 'postgres', 'minio')
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
  Show-DockerResourceSummary $dockerExe
}

function Show-DockerResourceSummary($dockerExe) {
  try {
    $infoJson = & $dockerExe info --format '{{json .}}' 2>$null
    if ($infoJson) {
      $info = $infoJson | ConvertFrom-Json
      $cpuCount = 0
      if ($null -ne $info.NCPU) { $cpuCount = [int]$info.NCPU }
      $memBytes = 0
      if ($null -ne $info.MemTotal) { $memBytes = [double]$info.MemTotal }
      $memGb = if ($memBytes -gt 0) { [Math]::Round($memBytes / 1GB, 1) } else { 0 }
      if ($cpuCount -gt 0 -or $memGb -gt 0) {
        Write-Ok "Docker capacity visible to Business OS: ${cpuCount} CPU, ${memGb}GB RAM."
      }
      if ($cpuCount -gt 0 -and $cpuCount -lt 8) {
        Write-Warn 'Docker Desktop has fewer than 8 CPUs available. Heavy imports will run slower.'
      }
      if ($memGb -gt 0 -and $memGb -lt 12) {
        Write-Warn 'Docker Desktop has less than 12GB RAM available. Use the balanced profile or increase Docker memory for heavy imports.'
      }
    }
  } catch {
    Write-Warn 'Could not read Docker CPU/RAM capacity.'
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
if (($env:BUSINESS_OS_REMOTE_PROVIDER -as [string]).Trim().ToLowerInvariant() -eq 'tailscale') {
  $tailscale = Ensure-Tool 'Tailscale' @('tailscale.exe', 'tailscale') @('C:\Program Files\Tailscale\tailscale.exe', 'C:\Program Files (x86)\Tailscale\tailscale.exe') 'Tailscale.Tailscale' $false
}
$remoteProviderForTools = ($env:BUSINESS_OS_REMOTE_PROVIDER -as [string]).Trim().ToLowerInvariant()
if (-not $remoteProviderForTools -and $Mode -in @('Setup', 'Start')) {
  $remoteProviderForTools = 'cloudflare'
}
if ($remoteProviderForTools -eq 'cloudflare') {
  $cloudflaredRequired = ($Mode -in @('Setup', 'Start'))
  $cloudflared = Ensure-Tool 'Cloudflare Tunnel' @('cloudflared.exe', 'cloudflared') @('C:\Program Files\cloudflared\cloudflared.exe', 'C:\Program Files (x86)\cloudflared\cloudflared.exe', "$env:LOCALAPPDATA\cloudflared\cloudflared.exe") 'Cloudflare.cloudflared' $cloudflaredRequired
}
$docker = Ensure-Tool 'Docker CLI' @('docker.exe', 'docker') @('C:\Program Files\Docker\Docker\resources\bin\docker.exe') 'Docker.DockerDesktop' $true

try {
  Write-Step 'Checking Docker engine readiness...'
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
    Update-ScaleServiceImages $docker
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
