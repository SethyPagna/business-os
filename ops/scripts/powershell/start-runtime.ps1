param(
  [string]$Root = '',
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'

function Write-Step($message) { Write-Host "[INFO] $message" }
function Write-Ok($message) { Write-Host "[OK] $message" }
function Write-Warn($message) { Write-Host "[WARN] $message" }
function Fail($message, $code = 1) { Write-Host "[ERROR] $message"; exit $code }

if (-not $Root) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
} else {
  $Root = [System.IO.Path]::GetFullPath($Root)
}

$EnvFile = Join-Path $Root 'backend\.env'
$LogDir = Join-Path $Root 'ops\runtime\logs'
$RunLog = Join-Path $LogDir 'start-server.log'
$ComposeFile = Join-Path $Root 'ops\docker\compose.scale.yml'
$DockerEnv = Join-Path $Root 'ops\runtime\docker-scale.env'
$DockerConfig = Join-Path $Root 'ops\runtime\docker-config'
$DockerAppLog = Join-Path $LogDir 'docker-compose-app.log'
$DockerWorkerLog = Join-Path $LogDir 'docker-compose-workers.log'
$CloudflaredLog = Join-Path $LogDir 'cloudflared.log'
$Bootstrap = Join-Path $Root 'ops\scripts\powershell\runtime-bootstrap.ps1'

New-Item -ItemType Directory -Force -Path $LogDir, $DockerConfig | Out-Null
Add-Content -LiteralPath $RunLog -Value "[$(Get-Date -Format s)] Runtime start requested"

function Read-EnvFile($path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $map }
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $key = $parts[0].Trim()
    if (-not $key) { continue }
    $map[$key] = $parts[1]
  }
  return $map
}

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

function Invoke-ProcessLogged($filePath, [string[]]$arguments, $logPath) {
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
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($stdout) { Add-Content -LiteralPath $logPath -Value $stdout }
  if ($stderr) { Add-Content -LiteralPath $logPath -Value $stderr }
  $code = $process.ExitCode
  $process.Dispose()
  return $code
}

function Stop-CloudflaredProcesses($tokenFile, [switch]$AllWhenRepairing) {
  try {
    Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
      Where-Object {
        if ($AllWhenRepairing) { return $true }
        $cmd = [string]$_.CommandLine
        $cmd -match [regex]::Escape($tokenFile) -or $cmd -match 'cloudflare-business-os-leangcosmetics'
      } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Start-Cloudflared($cloudflared, $tokenFile, $originUrl, $logPath, [switch]$RepairMode) {
  if (-not $cloudflared) {
    Write-Warn 'cloudflared was not found. Remote Cloudflare access will be unavailable.'
    return $false
  }
  if (-not (Test-Path -LiteralPath $tokenFile)) {
    Write-Warn "Cloudflare tunnel token file is missing: $tokenFile"
    return $false
  }

  Write-Step "Starting Cloudflare Tunnel connector for $originUrl"
  Stop-CloudflaredProcesses $tokenFile -AllWhenRepairing:$RepairMode

  $args = @(
    'tunnel',
    '--no-autoupdate',
    '--loglevel', 'warn',
    '--logfile', $logPath,
    'run',
    '--url', $originUrl,
    '--token-file', $tokenFile
  )
  $process = Start-Process -FilePath $cloudflared -ArgumentList $args -WindowStyle Hidden -PassThru -ErrorAction Stop
  Start-Sleep -Seconds 5
  $stillRunning = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  if (-not $stillRunning) {
    Write-Warn "Cloudflare Tunnel connector exited immediately. Log: $logPath"
    if (Test-Path -LiteralPath $logPath) {
      Get-Content -LiteralPath $logPath -Tail 40 | ForEach-Object { Write-Host "  $_" }
    }
    return $false
  }
  Write-Ok "Cloudflare Tunnel connector is running (PID $($process.Id))."
  return $true
}

function Wait-HttpOk($url, $timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  $attempt = 0
  do {
    $attempt++
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ([int]$response.StatusCode -eq 200) { return $true }
    } catch {}
    if (($attempt -eq 1) -or (($attempt % 10) -eq 0)) {
      Write-Step "Waiting for $url ... attempt $attempt"
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Test-PublicUrl($baseUrl) {
  try {
    $response = Invoke-WebRequest -Uri "$baseUrl/health" -UseBasicParsing -TimeoutSec 15
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

$envMap = Read-EnvFile $EnvFile
$port = if ($envMap.PORT) { $envMap.PORT } else { '4000' }
$localApi = "http://127.0.0.1:$port"
$publicUrl = if ($envMap.CLOUDFLARE_PUBLIC_URL) { $envMap.CLOUDFLARE_PUBLIC_URL.TrimEnd('/') } else { 'https://leangcosmetics.dpdns.org' }
$adminUrl = if ($envMap.CLOUDFLARE_ADMIN_URL) { $envMap.CLOUDFLARE_ADMIN_URL.TrimEnd('/') } else { 'https://admin.leangcosmetics.dpdns.org' }
$tokenFile = if ($envMap.CLOUDFLARE_TUNNEL_TOKEN_FILE) { $envMap.CLOUDFLARE_TUNNEL_TOKEN_FILE } else { Join-Path $Root 'ops\runtime\secrets\cloudflare-business-os-leangcosmetics.token' }
if (-not [System.IO.Path]::IsPathRooted($tokenFile)) { $tokenFile = Join-Path $Root $tokenFile }
$env:BUSINESS_OS_REMOTE_PROVIDER = 'cloudflare'

Write-Host ''
Write-Host '========================================================================'
Write-Host '  Business OS | Runtime Start'
Write-Host '========================================================================'
Write-Host ''

Write-Step 'Preparing Docker services and runtime profile...'
& powershell -NoProfile -ExecutionPolicy Bypass -File $Bootstrap -Mode Start -InstallMissing -StartServices -RequireServices
if ($LASTEXITCODE -ne 0) { Fail 'Runtime bootstrap failed. Open Docker Desktop, wait until it is running, then retry.' }
$dockerEnvMap = Read-EnvFile $DockerEnv
$importWorkerReplicas = if ($dockerEnvMap.IMPORT_WORKER_REPLICAS) { [int]$dockerEnvMap.IMPORT_WORKER_REPLICAS } else { 2 }
$mediaWorkerReplicas = if ($dockerEnvMap.MEDIA_WORKER_REPLICAS) { [int]$dockerEnvMap.MEDIA_WORKER_REPLICAS } else { 2 }
$importWorkerReplicas = [Math]::Max(1, [Math]::Min(6, $importWorkerReplicas))
$mediaWorkerReplicas = [Math]::Max(1, [Math]::Min(6, $mediaWorkerReplicas))

$docker = Find-Executable @('docker.exe', 'docker') @('C:\Program Files\Docker\Docker\resources\bin\docker.exe')
if (-not $docker) { Fail 'Docker CLI was not found.' }
$env:DOCKER_CONFIG = $DockerConfig
$env:MINIO_LICENSE_HOST_FILE = Join-Path $Root 'ops\runtime\secrets\minio.license'
$env:CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE = $tokenFile
$env:DATABASE_DRIVER = 'sqlite'
$env:OBJECT_STORAGE_DRIVER = 'local'
$env:BUSINESS_OS_REMOTE_PROVIDER = 'cloudflare'
$env:PUBLIC_BASE_URL = $publicUrl
$env:CLOUDFLARE_PUBLIC_URL = $publicUrl
$env:CLOUDFLARE_ADMIN_URL = $adminUrl

Write-Step 'Starting Docker app container...'
$code = Invoke-ProcessLogged $docker @('compose', '--env-file', $DockerEnv, '-f', $ComposeFile, '--progress', 'quiet', '--profile', 'runtime', 'up', '-d', '--remove-orphans', 'app') $DockerAppLog
if ($code -ne 0) {
  if (Test-Path -LiteralPath $DockerAppLog) { Get-Content -LiteralPath $DockerAppLog -Tail 80 }
  Fail "Docker app runtime failed to start. Log: $DockerAppLog"
}

if (-not (Wait-HttpOk "$localApi/health" $TimeoutSeconds)) {
  if (Test-Path -LiteralPath $DockerAppLog) { Get-Content -LiteralPath $DockerAppLog -Tail 120 }
  Fail "Business OS did not become healthy at $localApi/health. Log: $DockerAppLog"
}
Write-Ok "Business OS app is healthy at $localApi"

Write-Step 'Starting Docker import/media workers...'
$code = Invoke-ProcessLogged $docker @('compose', '--env-file', $DockerEnv, '-f', $ComposeFile, '--progress', 'quiet', '--profile', 'runtime', 'up', '-d', '--scale', "import-worker=$importWorkerReplicas", '--scale', "media-worker=$mediaWorkerReplicas", 'import-worker', 'media-worker') $DockerWorkerLog
if ($code -ne 0) {
  Write-Warn "Docker workers could not be started. Large jobs will stay queued. Log: $DockerWorkerLog"
  if (Test-Path -LiteralPath $DockerWorkerLog) { Get-Content -LiteralPath $DockerWorkerLog -Tail 80 }
} else {
  Write-Ok "Docker import/media workers are running or starting (import=$importWorkerReplicas, media=$mediaWorkerReplicas)."
}

$cloudflared = Find-Executable @('cloudflared.exe', 'cloudflared') @(
  'C:\Program Files\cloudflared\cloudflared.exe',
  'C:\Program Files (x86)\cloudflared\cloudflared.exe',
  "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
)
$preTunnelStatus = Test-PublicUrl $publicUrl
$repairTunnel = $preTunnelStatus -ne 200
if ($repairTunnel -and $preTunnelStatus -ne 0) {
  Write-Warn "Cloudflare public health is not passing before connector start (status $preTunnelStatus). Repair mode will replace stale cloudflared processes."
}
$tunnelStarted = Start-Cloudflared $cloudflared $tokenFile $localApi $CloudflaredLog -RepairMode:$repairTunnel
Start-Sleep -Seconds 4
$publicStatus = Test-PublicUrl $publicUrl
if ($publicStatus -eq 200) {
  Write-Ok "Cloudflare public health passed: $publicUrl/health"
} elseif ($tunnelStarted) {
  Write-Warn "Cloudflare connector is running, but public health returned status $publicStatus."
  Write-Warn 'If this remains 1033/530, rotate/reinstall the tunnel token or confirm the Cloudflare hostname routes to this tunnel.'
} else {
  Write-Warn 'Cloudflare connector is not running. Public/admin links will show a tunnel error until it is repaired.'
}

Write-Host ''
Write-Host '[DONE] Business OS runtime is ready.'
Write-Host "  Local Admin:  $localApi"
Write-Host "  Local Portal: $localApi/public"
Write-Host "  Remote Admin: $adminUrl"
Write-Host "  Customer URL: $publicUrl/public"
Write-Host "  Logs:         $LogDir"
Write-Host ''
Write-Host 'Next time: double-click Start Business OS.bat'
Write-Host 'To stop:   run\stop-server.bat'
Write-Host 'Support:   run\docker\doctor.bat'

Add-Content -LiteralPath $RunLog -Value "[$(Get-Date -Format s)] Runtime start completed"
exit 0
