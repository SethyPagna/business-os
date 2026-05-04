param(
  [ValidateSet('Release', 'Install', 'Start', 'Update', 'Backup', 'Restore', 'Doctor')]
  [string]$Action = 'Doctor',
  [string]$Version = '',
  [string]$Image = '',
  [string]$BackupPath = ''
)

$ErrorActionPreference = 'Stop'

function Write-Step($message) { Write-Host "[INFO] $message" }
function Write-Ok($message) { Write-Host "[OK] $message" }
function Write-Warn($message) { Write-Host "[WARN] $message" }
function Fail($message, $code = 1) { Write-Host "[ERROR] $message"; exit $code }

function Resolve-Root {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}

$Root = Resolve-Root
$ComposeFile = Join-Path $Root 'ops\docker\compose.release.yml'
$ScaleComposeFile = Join-Path $Root 'ops\docker\compose.scale.yml'
$Dockerfile = Join-Path $Root 'ops\docker\Dockerfile.release'
$RuntimeDir = Join-Path $Root 'ops\runtime\docker-release'
$SecretDir = Join-Path $RuntimeDir 'secrets'
$BackupDir = Join-Path $RuntimeDir 'backups'
$EnvFile = Join-Path $RuntimeDir 'docker-release.env'
$DockerConfig = Join-Path $RuntimeDir 'docker-config'
$DefaultImage = 'business-os'
$DockerKitDir = Join-Path (Join-Path $Root 'release') 'business-os'
$OldDockerKitDir = Join-Path (Join-Path $Root 'release') 'business-os-docker'
$ReleaseProjectName = 'business-os'
$OldReleaseProjectName = 'business-os-release'
$RouteContractScript = Join-Path $Root 'ops\scripts\runtime\check-route-contract.mjs'
$RouteContractLog = Join-Path $RuntimeDir 'route-contract.log'

function Ensure-Dir($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
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
      try { $process.Kill($true) } catch { try { $process.Kill() } catch {} }
      return [pscustomobject]@{ ExitCode = 124; TimedOut = $true; Stdout = ''; Stderr = "Timed out after ${timeoutSeconds}s" }
    }
    return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false; Stdout = $process.StandardOutput.ReadToEnd(); Stderr = $process.StandardError.ReadToEnd() }
  } catch {
    return [pscustomobject]@{ ExitCode = 1; TimedOut = $false; Stdout = ''; Stderr = $_.Exception.Message }
  } finally {
    $process.Dispose()
  }
}

function Resolve-Docker {
  $docker = Find-Executable @('docker.exe', 'docker') @('C:\Program Files\Docker\Docker\resources\bin\docker.exe')
  if (-not $docker) { Fail 'Docker CLI was not found. Install Docker Desktop first.' }
  return $docker
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$DockerArgs,
    [switch]$AllowFailure
  )
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  & $docker @DockerArgs
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) { Fail "Docker command failed: docker $($DockerArgs -join ' ')" $code }
  return $code
}

function Invoke-Compose {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$ComposeArgs,
    [switch]$AllowFailure
  )
  $dockerArgs = @('compose', '--env-file', $EnvFile, '-f', $ComposeFile) + $ComposeArgs
  return Invoke-Docker -DockerArgs $dockerArgs -AllowFailure:$AllowFailure
}

function Test-PostgresAppSchemaReady($envMap) {
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  $dbName = if ($envMap.POSTGRES_DB) { [string]$envMap.POSTGRES_DB } else { 'business_os' }
  $dbUser = if ($envMap.POSTGRES_USER) { [string]$envMap.POSTGRES_USER } else { 'business_os' }
  $sql = "SELECT (to_regclass('public.products') IS NOT NULL AND to_regclass('public.settings') IS NOT NULL AND to_regclass('public.users') IS NOT NULL)::int;"
  $output = & $docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres psql -U $dbUser -d $dbName -Atc $sql 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  return (($output | Select-Object -First 1) -as [string]).Trim() -eq '1'
}

function New-Secret([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
}

function Read-EnvFile {
  $map = @{}
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $map }
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line.Split('=', 2)
    $map[$parts[0]] = $parts[1]
  }
  return $map
}

function Get-EnvValue($primary, $secondary, [string]$key, [string]$fallback = '') {
  if ($primary -and $primary.ContainsKey($key) -and [string]$primary[$key]) { return $primary[$key] }
  if ($secondary -and $secondary.ContainsKey($key) -and [string]$secondary[$key]) { return $secondary[$key] }
  return $fallback
}

function Get-MinIntSetting($value, [int]$minimum) {
  $parsed = 0
  if ([int]::TryParse([string]$value, [ref]$parsed) -and $parsed -ge $minimum) {
    return [string]$parsed
  }
  return [string]$minimum
}

function Write-EnvFile($values) {
  Ensure-Dir $RuntimeDir
  $lines = @(
    '# Generated by Business OS Docker release automation.',
    '# Do not commit this file. It contains runtime-only settings.',
    "BUSINESS_OS_IMAGE=$($values.BUSINESS_OS_IMAGE)",
    "BUSINESS_OS_DOCKER_DATA_MODE=$($values.BUSINESS_OS_DOCKER_DATA_MODE)",
    "BUSINESS_OS_PUBLIC_URL=$($values.BUSINESS_OS_PUBLIC_URL)",
    "BUSINESS_OS_ADMIN_URL=$($values.BUSINESS_OS_ADMIN_URL)",
    "POSTGRES_DB=$($values.POSTGRES_DB)",
    "POSTGRES_USER=$($values.POSTGRES_USER)",
    "POSTGRES_PASSWORD=$($values.POSTGRES_PASSWORD)",
    "MINIO_ROOT_USER=$($values.MINIO_ROOT_USER)",
    "MINIO_ROOT_PASSWORD=$($values.MINIO_ROOT_PASSWORD)",
    "S3_ENDPOINT=$($values.S3_ENDPOINT)",
    "S3_REGION=$($values.S3_REGION)",
    "S3_ACCESS_KEY_ID=$($values.S3_ACCESS_KEY_ID)",
    "S3_SECRET_ACCESS_KEY=$($values.S3_SECRET_ACCESS_KEY)",
    "S3_BUCKET=$($values.S3_BUCKET)",
    "R2_PUBLIC_BASE_URL=$($values.R2_PUBLIC_BASE_URL)",
    "CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE=$($values.CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE)",
    'APP_BIND_HOST=127.0.0.1',
    'APP_PORT=4000',
    "DATABASE_DRIVER=$($values.DATABASE_DRIVER)",
    "OBJECT_STORAGE_DRIVER=$($values.OBJECT_STORAGE_DRIVER)",
    "DATABASE_URL=$($values.DATABASE_URL)",
    "BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED=$($values.BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED)",
    "ANALYTICS_ENGINE=$($values.ANALYTICS_ENGINE)",
    "PARQUET_STORE=$($values.PARQUET_STORE)",
    "IMPORT_QUEUE_CONCURRENCY=$($values.IMPORT_QUEUE_CONCURRENCY)",
    "MEDIA_QUEUE_CONCURRENCY=$($values.MEDIA_QUEUE_CONCURRENCY)",
    "IMPORT_BATCH_PAUSE_MS=$($values.IMPORT_BATCH_PAUSE_MS)",
    "IMPORT_WORKER_REPLICAS=$($values.IMPORT_WORKER_REPLICAS)",
    "MEDIA_WORKER_REPLICAS=$($values.MEDIA_WORKER_REPLICAS)",
    "GOOGLE_LOGIN_CLIENT_ID=$($values.GOOGLE_LOGIN_CLIENT_ID)",
    "GOOGLE_LOGIN_CLIENT_SECRET=$($values.GOOGLE_LOGIN_CLIENT_SECRET)",
    "GOOGLE_LOGIN_CLIENT_SECRET_FILE=$($values.GOOGLE_LOGIN_CLIENT_SECRET_FILE)",
    "GOOGLE_LOGIN_REDIRECT_URI=$($values.GOOGLE_LOGIN_REDIRECT_URI)",
    "GOOGLE_DRIVE_CLIENT_ID=$($values.GOOGLE_DRIVE_CLIENT_ID)",
    "GOOGLE_DRIVE_CLIENT_SECRET=$($values.GOOGLE_DRIVE_CLIENT_SECRET)",
    "GOOGLE_DRIVE_OAUTH_REDIRECT_URI=$($values.GOOGLE_DRIVE_OAUTH_REDIRECT_URI)",
    'JOB_QUEUE_DRIVER=bullmq',
    'BUSINESS_OS_RUNTIME=docker'
  )
  Set-Content -LiteralPath $EnvFile -Value $lines -Encoding ASCII
  Write-Ok "Docker release env ready: $EnvFile"
}

function Ensure-Env {
  Ensure-Dir $RuntimeDir
  Ensure-Dir $SecretDir
  Ensure-Dir $BackupDir
  Ensure-Dir $DockerConfig

  $existing = Read-EnvFile
  $imageHasTag = $Image -and ([string]$Image -match ':[^/:]+$')
  $tag = if ($Version) {
    $Version
  } elseif ($imageHasTag) {
    ([string]$Image -split ':')[-1]
  } else {
    if ($existing.BUSINESS_OS_IMAGE) { ($existing.BUSINESS_OS_IMAGE -split ':')[-1] } else { 'latest' }
  }
  $imageBase = if ($Image) {
    if ($imageHasTag) { ([string]$Image -replace ':[^/:]+$', '') } else { $Image }
  } else {
    if ($existing.BUSINESS_OS_IMAGE) { ($existing.BUSINESS_OS_IMAGE -replace ':[^/:]+$', '') } else { $DefaultImage }
  }
  $defaultTokenFile = Join-Path $SecretDir 'cloudflare-tunnel.token'
  $sourceTokenFile = Join-Path (Join-Path $Root 'ops\runtime\secrets') 'cloudflare-business-os-leangcosmetics.token'
  $tokenFile = if ($existing.CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE) { $existing.CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE } else { $defaultTokenFile }
  $tokenLooksEmpty = -not (Test-Path -LiteralPath $tokenFile) -or ((Get-Item -LiteralPath $tokenFile -ErrorAction SilentlyContinue).Length -le 0)
  if ($tokenLooksEmpty -and (Test-Path -LiteralPath $sourceTokenFile) -and ((Get-Item -LiteralPath $sourceTokenFile).Length -gt 0)) {
    $tokenFile = $sourceTokenFile
  }

  if (-not (Test-Path -LiteralPath $tokenFile)) {
    New-Item -ItemType File -Force -Path $tokenFile | Out-Null
    Write-Warn "Cloudflare token file created empty: $tokenFile"
    Write-Warn 'Paste the tunnel token into that file before starting the public release runtime.'
  }

  $postgresPassword = if ($existing.POSTGRES_PASSWORD) { $existing.POSTGRES_PASSWORD } else { New-Secret 36 }
  $databaseUrl = "postgres://business_os:$postgresPassword@postgres:5432/business_os"
  $values = [ordered]@{
    BUSINESS_OS_IMAGE = "$imageBase`:$tag"
    BUSINESS_OS_DOCKER_DATA_MODE = 'postgres'
    BUSINESS_OS_PUBLIC_URL = if ($existing.BUSINESS_OS_PUBLIC_URL) { $existing.BUSINESS_OS_PUBLIC_URL } else { 'https://leangcosmetics.dpdns.org' }
    BUSINESS_OS_ADMIN_URL = if ($existing.BUSINESS_OS_ADMIN_URL) { $existing.BUSINESS_OS_ADMIN_URL } else { 'https://admin.leangcosmetics.dpdns.org' }
    POSTGRES_DB = if ($existing.POSTGRES_DB) { $existing.POSTGRES_DB } else { 'business_os' }
    POSTGRES_USER = if ($existing.POSTGRES_USER) { $existing.POSTGRES_USER } else { 'business_os' }
    POSTGRES_PASSWORD = $postgresPassword
    MINIO_ROOT_USER = if ($existing.MINIO_ROOT_USER) { $existing.MINIO_ROOT_USER } else { 'businessos' }
    MINIO_ROOT_PASSWORD = if ($existing.MINIO_ROOT_PASSWORD) { $existing.MINIO_ROOT_PASSWORD } else { New-Secret 36 }
    S3_BUCKET = if ($existing.S3_BUCKET) { $existing.S3_BUCKET } else { 'business-os-assets' }
    CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE = $tokenFile
    DATABASE_DRIVER = 'postgres'
    OBJECT_STORAGE_DRIVER = if ($existing.OBJECT_STORAGE_DRIVER) { $existing.OBJECT_STORAGE_DRIVER } else { 'r2' }
    S3_ENDPOINT = if ($existing.S3_ENDPOINT) { $existing.S3_ENDPOINT } else { 'https://743e5b727d139e85ed11679097f6f99e.r2.cloudflarestorage.com' }
    S3_REGION = if ($existing.S3_REGION) { $existing.S3_REGION } else { 'auto' }
    S3_ACCESS_KEY_ID = if ($existing.S3_ACCESS_KEY_ID) { $existing.S3_ACCESS_KEY_ID } else { '' }
    S3_SECRET_ACCESS_KEY = if ($existing.S3_SECRET_ACCESS_KEY) { $existing.S3_SECRET_ACCESS_KEY } else { '' }
    R2_PUBLIC_BASE_URL = if ($existing.R2_PUBLIC_BASE_URL) { $existing.R2_PUBLIC_BASE_URL } else { '' }
    DATABASE_URL = $databaseUrl
    BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED = if ((Get-PostgresCutoverBlockerSummary) -match '"blockerCount"\s*:\s*0') { '1' } else { if ($existing.BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED) { $existing.BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED } else { '0' } }
    ANALYTICS_ENGINE = if ($existing.ANALYTICS_ENGINE) { $existing.ANALYTICS_ENGINE } else { 'duckdb' }
    PARQUET_STORE = if ($existing.PARQUET_STORE) { $existing.PARQUET_STORE } else { 'r2' }
    IMPORT_QUEUE_CONCURRENCY = Get-MinIntSetting $existing.IMPORT_QUEUE_CONCURRENCY 2
    MEDIA_QUEUE_CONCURRENCY = Get-MinIntSetting $existing.MEDIA_QUEUE_CONCURRENCY 3
    IMPORT_BATCH_PAUSE_MS = '0'
    IMPORT_WORKER_REPLICAS = Get-MinIntSetting $existing.IMPORT_WORKER_REPLICAS 2
    MEDIA_WORKER_REPLICAS = Get-MinIntSetting $existing.MEDIA_WORKER_REPLICAS 2
    GOOGLE_LOGIN_CLIENT_ID = if ($existing.GOOGLE_LOGIN_CLIENT_ID) { $existing.GOOGLE_LOGIN_CLIENT_ID } else { '784691087631-2ugaidgt6umv80i9qvfo08ddu12n4a9b.apps.googleusercontent.com' }
    GOOGLE_LOGIN_CLIENT_SECRET = if ($existing.GOOGLE_LOGIN_CLIENT_SECRET) { $existing.GOOGLE_LOGIN_CLIENT_SECRET } else { '' }
    GOOGLE_LOGIN_CLIENT_SECRET_FILE = if ($existing.GOOGLE_LOGIN_CLIENT_SECRET_FILE) { $existing.GOOGLE_LOGIN_CLIENT_SECRET_FILE } else { 'ops/runtime/secrets/google-login-client-secret.txt' }
    GOOGLE_LOGIN_REDIRECT_URI = if ($existing.GOOGLE_LOGIN_REDIRECT_URI) { $existing.GOOGLE_LOGIN_REDIRECT_URI } else { 'https://admin.leangcosmetics.dpdns.org/api/auth/oauth/callback' }
    GOOGLE_DRIVE_CLIENT_ID = if ($existing.GOOGLE_DRIVE_CLIENT_ID) { $existing.GOOGLE_DRIVE_CLIENT_ID } else { '' }
    GOOGLE_DRIVE_CLIENT_SECRET = if ($existing.GOOGLE_DRIVE_CLIENT_SECRET) { $existing.GOOGLE_DRIVE_CLIENT_SECRET } else { '' }
    GOOGLE_DRIVE_OAUTH_REDIRECT_URI = if ($existing.GOOGLE_DRIVE_OAUTH_REDIRECT_URI) { $existing.GOOGLE_DRIVE_OAUTH_REDIRECT_URI } else { '' }
  }
  Write-EnvFile $values
  return $values
}

function Get-BaseDataServices($envMap) {
  $services = @('postgres', 'redis-queue', 'redis-cache')
  if ($envMap.OBJECT_STORAGE_DRIVER -eq 'minio') {
    $services += 'minio'
  }
  return $services
}

function Stop-OfflineStorageWhenR2($envMap) {
  if ($envMap.OBJECT_STORAGE_DRIVER -eq 'minio') { return }
  Invoke-Compose -ComposeArgs @('stop', 'minio') -AllowFailure | Out-Null
}

function Get-PostgresCutoverBlockerSummary {
  $node = Find-Executable @('node.exe', 'node') @('C:\Program Files\nodejs\node.exe')
  $analyzer = Join-Path $Root 'backend\src\db\cutoverReadiness.js'
  if (-not $node -or -not (Test-Path -LiteralPath $analyzer)) {
    return ''
  }
  $rootJson = $Root | ConvertTo-Json -Compress
  $script = @"
const root = $rootJson;
const { analyzePostgresCutoverReadiness } = require(root + '/backend/src/db/cutoverReadiness');
const report = analyzePostgresCutoverReadiness({ repoRoot: root, packagedRuntime: false });
console.log(JSON.stringify({
  blockerCount: report.blockerCount,
  byCode: report.summary.byCode,
  byFile: report.summary.byFile.slice(0, 12)
}, null, 2));
process.exit(report.ready ? 0 : 2);
"@
  $result = Invoke-ProcessWithTimeout $node @('-e', $script) 20
  $text = (($result.Stdout, $result.Stderr) -join [Environment]::NewLine).Trim()
  return $text
}

function Assert-PostgresCutoverReadyForApp($envMap) {
  if (($envMap.DATABASE_DRIVER -ne 'postgres') -or (@('r2', 'minio') -notcontains $envMap.OBJECT_STORAGE_DRIVER)) {
    Fail 'Docker release app startup requires DATABASE_DRIVER=postgres and OBJECT_STORAGE_DRIVER=r2 or minio.'
  }

  $verified = [string]$envMap.BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED
  $summary = Get-PostgresCutoverBlockerSummary
  if ($verified -ne '1') {
    Invoke-Compose -ComposeArgs @('stop', 'app', 'import-worker', 'media-worker', 'cloudflared') -AllowFailure | Out-Null
    $details = if ($summary) { "`nCurrent cutover blockers:`n$summary" } else { '' }
    Fail ("Postgres migration finished, but the app data layer is not cut over yet. " +
      "Business OS will not start the app/workers/Cloudflare because that would crash or tempt a hidden retired-data fallback. " +
      "Complete the Postgres repository and shared object-storage adapter cutover, then set BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED=1 only after route-contract verification passes." +
      $details)
  }

  if ($summary -and $summary -match '"blockerCount"\s*:\s*([1-9][0-9]*)') {
    Invoke-Compose -ComposeArgs @('stop', 'app', 'import-worker', 'media-worker', 'cloudflared') -AllowFailure | Out-Null
    Fail ("BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED=1 is set, but retired live data-layer references are still present. " +
      "Refusing to start production Docker until the source scan is clean.`nCurrent cutover blockers:`n$summary")
  }
}

function Ensure-DockerReady {
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  Write-Step 'Checking Docker engine readiness...'
  $result = Invoke-ProcessWithTimeout $docker @('info', '--format', '{{.ServerVersion}}') 20
  if ($result.TimedOut) {
    Fail 'Docker CLI did not answer within 20 seconds. Open Docker Desktop, wait until it says Running, then retry.'
  }
  if ($result.ExitCode -ne 0) {
    Fail 'Docker Desktop is not running. Open Docker Desktop, wait until it says Running, then retry.'
  }
  Write-Ok 'Docker engine is reachable.'
}

function Get-VersionTag {
  if ($Version) { return $Version }
  $pkg = Get-Content -Raw (Join-Path $Root 'backend\package.json') | ConvertFrom-Json
  return "v$($pkg.version)-$(Get-Date -Format 'yyyyMMddHHmm')"
}

function Get-ImageBundlePath($baseRoot) {
  return Join-Path (Join-Path $baseRoot 'images') 'business-os-image.tar'
}

function Test-DockerImageExists($imageName) {
  if (-not $imageName) { return $false }
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  $result = Invoke-ProcessWithTimeout $docker @('image', 'inspect', $imageName, '--format', '{{.Id}}') 20
  return ($result.ExitCode -eq 0)
}

function Save-ReleaseImageBundle($imageName) {
  $bundlePath = Get-ImageBundlePath $DockerKitDir
  Ensure-Dir ([System.IO.Path]::GetDirectoryName($bundlePath))
  Write-Step "Saving local Docker image bundle: $bundlePath"
  Invoke-Docker -DockerArgs @('save', '-o', $bundlePath, $imageName) | Out-Null
  Set-Content -LiteralPath (Join-Path ([System.IO.Path]::GetDirectoryName($bundlePath)) 'business-os-image.txt') -Encoding UTF8 -Value (@(
    "image=$imageName",
    "createdAt=$((Get-Date).ToString('o'))",
    'purpose=Copy this release folder locally or through Google Drive, then Start Business OS.bat loads this local image bundle.'
  ))
  Write-Ok 'Local Docker image bundle saved for offline/local/Google Drive installs.'
}

function Ensure-ReleaseImageAvailable($imageName) {
  if (Test-DockerImageExists $imageName) {
    Write-Ok "Release image is already available locally: $imageName"
    return
  }

  $candidates = @(
    (Get-ImageBundlePath $Root),
    (Get-ImageBundlePath $DockerKitDir)
  ) | Select-Object -Unique

  foreach ($bundlePath in $candidates) {
    if (-not (Test-Path -LiteralPath $bundlePath)) { continue }
    Write-Step "Loading local Docker image bundle: $bundlePath"
    Invoke-Docker -DockerArgs @('load', '-i', $bundlePath) | Out-Null
    if (Test-DockerImageExists $imageName) {
      Write-Ok "Release image loaded locally: $imageName"
      return
    }
  }

  Fail "Release image is not available. Copy the full release\\business-os folder, including images\\business-os-image.tar, then run Start Business OS.bat again."
}

function Test-ReleaseContents {
  $compose = Get-Content -Raw $ComposeFile
  if ($compose -match '\.\./\.\.:/app' -or $compose -match 'node_modules') {
    Fail 'Release Compose must not bind-mount source folders or node_modules.'
  }
  if ($compose -match 'OBJECT_STORAGE_DRIVER:\s*"\$\{OBJECT_STORAGE_DRIVER:-local\}"') {
    Fail 'Release Compose must not ship local storage defaults.'
  }
  if ($compose -notmatch 'business_os_runtime:/runtime') {
    Fail 'Release Compose must keep runtime scratch state inside a Docker volume.'
  }
}

function Copy-Directory($source, $destination) {
  if (-not (Test-Path -LiteralPath $source)) { return }
  Ensure-Dir $destination
  Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
}

function Remove-RetiredReleaseOutputs {
  $retired = @(
    $OldDockerKitDir,
    (Join-Path (Join-Path $Root 'release') 'BusinessOS-Setup-v6.0.0.exe')
  )
  foreach ($target in $retired) {
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $resolved = (Resolve-Path -LiteralPath $target).Path
    $releaseRoot = (Join-Path $Root 'release')
    if (-not $resolved.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Fail "Refusing to remove retired release output outside release folder: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    Write-Ok "Removed retired standalone release output: $resolved"
  }
}

function Write-DockerReleaseKit($imageName) {
  Remove-RetiredReleaseOutputs
  $preserveRuntime = Join-Path $env:TEMP "business-os-docker-kit-runtime-$([guid]::NewGuid().ToString('N'))"
  $existingRuntime = Join-Path $DockerKitDir 'ops\runtime\docker-release'
  if (Test-Path -LiteralPath $existingRuntime) {
    Ensure-Dir $preserveRuntime
    Copy-Item -LiteralPath $existingRuntime -Destination $preserveRuntime -Recurse -Force
  }
  if (-not (Test-Path -LiteralPath (Join-Path $preserveRuntime 'docker-release'))) {
    $oldExistingRuntime = Join-Path $OldDockerKitDir 'ops\runtime\docker-release'
    if (Test-Path -LiteralPath $oldExistingRuntime) {
      Ensure-Dir $preserveRuntime
      Copy-Item -LiteralPath $oldExistingRuntime -Destination $preserveRuntime -Recurse -Force
    }
  }

  if (Test-Path -LiteralPath $DockerKitDir) {
    Remove-Item -LiteralPath $DockerKitDir -Recurse -Force
  }
  Ensure-Dir $DockerKitDir
  Ensure-Dir (Join-Path $DockerKitDir 'run\docker')
  Ensure-Dir (Join-Path $DockerKitDir 'ops\docker')
  Ensure-Dir (Join-Path $DockerKitDir 'ops\scripts\powershell')
  Ensure-Dir (Join-Path $DockerKitDir 'ops\scripts\runtime')

  Copy-Item -LiteralPath (Join-Path $Root 'Start Business OS.bat') -Destination (Join-Path $DockerKitDir 'Start Business OS.bat') -Force
  Copy-Directory (Join-Path $Root 'run\docker') (Join-Path $DockerKitDir 'run\docker')
  Copy-Item -LiteralPath $ComposeFile -Destination (Join-Path $DockerKitDir 'ops\docker\compose.release.yml') -Force
  Copy-Item -LiteralPath $Dockerfile -Destination (Join-Path $DockerKitDir 'ops\docker\Dockerfile.release') -Force
  Copy-Item -LiteralPath (Join-Path $Root 'ops\scripts\powershell\docker-release.ps1') -Destination (Join-Path $DockerKitDir 'ops\scripts\powershell\docker-release.ps1') -Force
  Copy-Directory (Join-Path $Root 'ops\scripts\runtime') (Join-Path $DockerKitDir 'ops\scripts\runtime')

  if (Test-Path -LiteralPath (Join-Path $preserveRuntime 'docker-release')) {
    Ensure-Dir (Join-Path $DockerKitDir 'ops\runtime')
    Copy-Item -LiteralPath (Join-Path $preserveRuntime 'docker-release') -Destination (Join-Path $DockerKitDir 'ops\runtime') -Recurse -Force
  }

  $kitEnvDir = Join-Path $DockerKitDir 'ops\runtime\docker-release'
  Ensure-Dir $kitEnvDir
  $kitSecretsDir = Join-Path $kitEnvDir 'secrets'
  Ensure-Dir $kitSecretsDir
  $kitEnvFile = Join-Path $kitEnvDir 'docker-release.env'
  $kitToken = Join-Path $kitSecretsDir 'cloudflare-tunnel.token'
  if (-not (Test-Path -LiteralPath $kitToken)) {
    New-Item -ItemType File -Force -Path $kitToken | Out-Null
  }
  $sourceTokenFile = Join-Path (Join-Path $Root 'ops\runtime\secrets') 'cloudflare-business-os-leangcosmetics.token'
  if ((Test-Path -LiteralPath $sourceTokenFile) -and ((Get-Item -LiteralPath $sourceTokenFile).Length -gt 0)) {
    $kitTokenEmpty = -not (Test-Path -LiteralPath $kitToken) -or ((Get-Item -LiteralPath $kitToken).Length -le 0)
    if ($kitTokenEmpty) {
      Copy-Item -LiteralPath $sourceTokenFile -Destination $kitToken -Force
      Write-Ok 'Cloudflare tunnel token copied into ignored Docker release secret storage.'
    }
  }
  $kitExisting = @{}
  if (Test-Path -LiteralPath $kitEnvFile) {
    foreach ($line in Get-Content -LiteralPath $kitEnvFile) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $parts = $line.Split('=', 2)
      $kitExisting[$parts[0]] = $parts[1]
    }
  }
  $sourceExisting = Read-EnvFile
  $postgresPassword = if ($kitExisting.POSTGRES_PASSWORD) { $kitExisting.POSTGRES_PASSWORD } else { New-Secret 36 }
  $databaseUrl = "postgres://business_os:$postgresPassword@postgres:5432/business_os"
  $values = [ordered]@{
    BUSINESS_OS_IMAGE = $imageName
    BUSINESS_OS_DOCKER_DATA_MODE = 'postgres'
    BUSINESS_OS_PUBLIC_URL = if ($kitExisting.BUSINESS_OS_PUBLIC_URL) { $kitExisting.BUSINESS_OS_PUBLIC_URL } else { 'https://leangcosmetics.dpdns.org' }
    BUSINESS_OS_ADMIN_URL = if ($kitExisting.BUSINESS_OS_ADMIN_URL) { $kitExisting.BUSINESS_OS_ADMIN_URL } else { 'https://admin.leangcosmetics.dpdns.org' }
    POSTGRES_DB = if ($kitExisting.POSTGRES_DB) { $kitExisting.POSTGRES_DB } else { 'business_os' }
    POSTGRES_USER = if ($kitExisting.POSTGRES_USER) { $kitExisting.POSTGRES_USER } else { 'business_os' }
    POSTGRES_PASSWORD = $postgresPassword
    MINIO_ROOT_USER = if ($kitExisting.MINIO_ROOT_USER) { $kitExisting.MINIO_ROOT_USER } else { 'businessos' }
    MINIO_ROOT_PASSWORD = if ($kitExisting.MINIO_ROOT_PASSWORD) { $kitExisting.MINIO_ROOT_PASSWORD } else { New-Secret 36 }
    S3_ENDPOINT = Get-EnvValue $kitExisting $sourceExisting 'S3_ENDPOINT' 'https://743e5b727d139e85ed11679097f6f99e.r2.cloudflarestorage.com'
    S3_REGION = Get-EnvValue $kitExisting $sourceExisting 'S3_REGION' 'auto'
    S3_ACCESS_KEY_ID = Get-EnvValue $kitExisting $sourceExisting 'S3_ACCESS_KEY_ID'
    S3_SECRET_ACCESS_KEY = Get-EnvValue $kitExisting $sourceExisting 'S3_SECRET_ACCESS_KEY'
    S3_BUCKET = Get-EnvValue $kitExisting $sourceExisting 'S3_BUCKET' 'business-os-assets'
    R2_PUBLIC_BASE_URL = Get-EnvValue $kitExisting $sourceExisting 'R2_PUBLIC_BASE_URL'
    CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE = $kitToken
    DATABASE_DRIVER = 'postgres'
    OBJECT_STORAGE_DRIVER = Get-EnvValue $kitExisting $sourceExisting 'OBJECT_STORAGE_DRIVER' 'r2'
    DATABASE_URL = $databaseUrl
    BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED = '1'
    ANALYTICS_ENGINE = 'duckdb'
    PARQUET_STORE = Get-EnvValue $kitExisting $sourceExisting 'PARQUET_STORE' 'r2'
    IMPORT_QUEUE_CONCURRENCY = '2'
    MEDIA_QUEUE_CONCURRENCY = '3'
    IMPORT_BATCH_PAUSE_MS = '0'
    IMPORT_WORKER_REPLICAS = '2'
    MEDIA_WORKER_REPLICAS = '2'
    GOOGLE_LOGIN_CLIENT_ID = Get-EnvValue $kitExisting $sourceExisting 'GOOGLE_LOGIN_CLIENT_ID' '784691087631-2ugaidgt6umv80i9qvfo08ddu12n4a9b.apps.googleusercontent.com'
    GOOGLE_LOGIN_CLIENT_SECRET = Get-EnvValue $kitExisting $sourceExisting 'GOOGLE_LOGIN_CLIENT_SECRET'
    GOOGLE_LOGIN_CLIENT_SECRET_FILE = Get-EnvValue $kitExisting $sourceExisting 'GOOGLE_LOGIN_CLIENT_SECRET_FILE' 'ops/runtime/secrets/google-login-client-secret.txt'
    GOOGLE_LOGIN_REDIRECT_URI = Get-EnvValue $kitExisting $sourceExisting 'GOOGLE_LOGIN_REDIRECT_URI' 'https://admin.leangcosmetics.dpdns.org/api/auth/oauth/callback'
    GOOGLE_DRIVE_CLIENT_ID = Get-EnvValue $kitExisting $sourceExisting 'GOOGLE_DRIVE_CLIENT_ID'
    GOOGLE_DRIVE_CLIENT_SECRET = Get-EnvValue $kitExisting $sourceExisting 'GOOGLE_DRIVE_CLIENT_SECRET'
    GOOGLE_DRIVE_OAUTH_REDIRECT_URI = Get-EnvValue $kitExisting $sourceExisting 'GOOGLE_DRIVE_OAUTH_REDIRECT_URI'
  }
  $oldRuntimeDir = $RuntimeDir
  $oldEnvFile = $EnvFile
  try {
    $script:RuntimeDir = $kitEnvDir
    $script:EnvFile = $kitEnvFile
    Write-EnvFile $values
  } finally {
    $script:RuntimeDir = $oldRuntimeDir
    $script:EnvFile = $oldEnvFile
  }

  Save-ReleaseImageBundle $imageName

  @"
Business OS Docker Release
==========================

Use this folder on a laptop where you do not want to expose source code.

1. Double-click Start Business OS.bat.
2. If Docker Desktop is missing, install it and restart Windows if Docker asks.
3. Put the Cloudflare tunnel token in:
   ops\runtime\docker-release\secrets\cloudflare-tunnel.token
4. Start again and open:
   https://admin.leangcosmetics.dpdns.org
   https://leangcosmetics.dpdns.org/public

This folder contains launcher/support scripts, Docker configuration, and a
local Docker image bundle at:
  images\business-os-image.tar

The app itself runs from this Docker image:
  $imageName

No remote image service is required for local/Google Drive installs. If the
image is missing on a laptop, install/start loads images\business-os-image.tar.

Live app data is stored in Docker-managed Postgres plus R2 object storage.
Emergency/offline mode uses the same object layout with local MinIO.

Moving data safely:
1. Preferred: run run\docker\backup.bat on the old laptop.
2. Copy the newest backup folder from ops\runtime\docker-release\backups,
   or choose the matching Google Drive datasync-N folder.
3. On the new laptop run:
   run\docker\restore.bat -BackupPath "C:\path\to\backup-folder"

Google Drive and local backups use the same folder format, so a selected
datasync-N folder can be restored after Business OS validates its manifest,
checksums, Postgres data, object assets, and app version metadata.

Loose old data folders are not imported automatically by this release.
Use a verified backup folder instead so old local data cannot overwrite newer
Docker data by accident.
"@ | Set-Content -LiteralPath (Join-Path $DockerKitDir 'README.txt') -Encoding UTF8

  if (Test-Path -LiteralPath $preserveRuntime) {
    Remove-Item -LiteralPath $preserveRuntime -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Ok "Docker release kit ready: $DockerKitDir"
}

function Invoke-Release {
  Ensure-DockerReady
  Test-ReleaseContents
  $tag = Get-VersionTag
  $imageName = if ($Image) { $Image } else { $DefaultImage }
  $fullImage = "$imageName`:$tag"
  Write-Step "Building Docker release image $fullImage"
  Invoke-Docker -DockerArgs @('build', '-f', $Dockerfile, '-t', $fullImage, '-t', "$imageName`:latest", $Root) | Out-Null
  Ensure-Env | Out-Null
  $envMap = Read-EnvFile
  $envMap.BUSINESS_OS_IMAGE = $fullImage
  Write-EnvFile $envMap
  Write-DockerReleaseKit $fullImage
  Write-Ok "Release image built: $fullImage"
  Write-Ok 'Docker release is source-free and configured for Postgres, R2/offline object storage, Redis jobs/cache.'
}

function Invoke-Install {
  Ensure-DockerReady
  $envMap = Ensure-Env
  Ensure-ReleaseImageAvailable $envMap.BUSINESS_OS_IMAGE
  Write-Step 'Pulling base service images when available...'
  Invoke-Compose -ComposeArgs (@('pull') + (Get-BaseDataServices $envMap) + @('cloudflared')) -AllowFailure | Out-Null
  Stop-OfflineStorageWhenR2 $envMap
  Write-Step 'Starting database, queues, and object storage checks when configured...'
  Invoke-Compose -ComposeArgs (@('up', '-d') + (Get-BaseDataServices $envMap))
  Write-Ok 'Base Docker services are installed.'
}

function Invoke-Start {
  Ensure-DockerReady
  Ensure-Env | Out-Null
  $envMap = Read-EnvFile
  Ensure-ReleaseImageAvailable $envMap.BUSINESS_OS_IMAGE
  if (Test-Path -LiteralPath $ScaleComposeFile) {
    Write-Step 'Stopping retired source app/worker containers that could occupy port 4000...'
    Invoke-Docker -DockerArgs @('compose', '-f', $ScaleComposeFile, 'stop', 'app', 'import-worker', 'media-worker', 'cloudflared') -AllowFailure | Out-Null
  }
  Write-Step 'Stopping retired Docker release containers if they exist...'
  Invoke-Docker -DockerArgs @('compose', '-p', $OldReleaseProjectName, '--env-file', $EnvFile, '-f', $ComposeFile, 'down', '--remove-orphans') -AllowFailure | Out-Null
  if (($envMap.BUSINESS_OS_DOCKER_DATA_MODE -ne 'postgres') -and ($envMap.DATABASE_DRIVER -ne 'postgres')) {
    Fail 'Docker release requires Postgres plus R2 or offline MinIO runtime mode. Restore a verified backup package before starting.'
  }
  Stop-OfflineStorageWhenR2 $envMap
  Write-Step 'Starting Postgres, Redis, and object storage checks when configured...'
  Invoke-Compose -ComposeArgs (@('up', '-d') + (Get-BaseDataServices $envMap))
  Start-Sleep -Seconds 2
  if (Test-PostgresAppSchemaReady $envMap) {
    Write-Ok 'Postgres live schema is ready.'
  } else {
    Write-Warn 'Postgres live schema is missing. The app will create the final schema during startup; restore a verified backup if this volume should already contain data.'
  }
  Assert-PostgresCutoverReadyForApp $envMap
  Write-Step 'Starting Business OS Docker release runtime...'
  $importReplicas = if ($envMap.IMPORT_WORKER_REPLICAS) { [int]$envMap.IMPORT_WORKER_REPLICAS } else { 1 }
  $mediaReplicas = if ($envMap.MEDIA_WORKER_REPLICAS) { [int]$envMap.MEDIA_WORKER_REPLICAS } else { 1 }
  $importReplicas = [Math]::Max(1, [Math]::Min(6, $importReplicas))
  $mediaReplicas = [Math]::Max(1, [Math]::Min(6, $mediaReplicas))
  Invoke-Compose -ComposeArgs @(
    'up', '-d',
    '--remove-orphans',
    '--force-recreate',
    '--scale', "import-worker=$importReplicas",
    '--scale', "media-worker=$mediaReplicas"
  )
  Test-ReleaseHealth
  Write-Ok 'Docker release runtime is healthy.'
}

function Get-ComposeVolumeName($volumeKey) {
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  $names = & $docker volume ls `
    --filter "label=com.docker.compose.project=$ReleaseProjectName" `
    --filter "label=com.docker.compose.volume=$volumeKey" `
    --format '{{.Name}}' 2>$null
  if ($LASTEXITCODE -eq 0) {
    $name = @($names | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
    if ($name) { return [string]$name }
  }
  return "$ReleaseProjectName`_$volumeKey"
}

function Invoke-VolumeTar($volumeName, $targetDir, $archiveName, [switch]$Restore) {
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  $targetDir = [System.IO.Path]::GetFullPath($targetDir)
  Ensure-Dir $targetDir
  if ($Restore) {
    Invoke-Docker -DockerArgs @(
      'run', '--rm',
      '-v', "${volumeName}:/runtime",
      '-v', "${targetDir}:/backup:ro",
      'alpine:3.20',
      'sh', '-lc',
      "set -e; find /runtime -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar -xzf /backup/$archiveName -C /runtime"
    )
  } else {
    Invoke-Docker -DockerArgs @(
      'run', '--rm',
      '-v', "${volumeName}:/runtime:ro",
      '-v', "${targetDir}:/backup",
      'alpine:3.20',
      'sh', '-lc',
      "set -e; cd /runtime; tar -czf /backup/$archiveName ."
    )
  }
}

function Get-FileSha256($path) {
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-BackupManifest($target, $envMap, $files) {
  $manifest = [ordered]@{
    format = 'business-os-backup-v2'
    createdAt = (Get-Date).ToString('o')
    source = 'docker-release'
    app = @{
      image = $envMap.BUSINESS_OS_IMAGE
      publicUrl = $envMap.BUSINESS_OS_PUBLIC_URL
      adminUrl = $envMap.BUSINESS_OS_ADMIN_URL
    }
    drivers = @{
      database = 'postgres'
      objectStorage = $envMap.OBJECT_STORAGE_DRIVER
      queue = 'bullmq'
      cache = 'redis'
      analytics = if ($envMap.ANALYTICS_ENGINE) { $envMap.ANALYTICS_ENGINE } else { 'duckdb' }
      parquetStore = if ($envMap.PARQUET_STORE) { $envMap.PARQUET_STORE } else { $envMap.OBJECT_STORAGE_DRIVER }
    }
    database = @{
      file = 'postgres.sql'
      kind = 'pg_dump'
      db = $envMap.POSTGRES_DB
      user = $envMap.POSTGRES_USER
    }
    objectStorage = @{
      file = 'objects-manifest.jsonl'
      kind = 'object-manifest'
      bucket = $envMap.S3_BUCKET
      driver = $envMap.OBJECT_STORAGE_DRIVER
    }
    parquet = @{
      manifest = 'parquet-manifest.json'
      store = if ($envMap.PARQUET_STORE) { $envMap.PARQUET_STORE } else { $envMap.OBJECT_STORAGE_DRIVER }
    }
    files = $files
  }
  $manifestPath = Join-Path $target 'manifest.json'
  Set-Content -LiteralPath $manifestPath -Encoding UTF8 -Value ($manifest | ConvertTo-Json -Depth 8)
  Set-Content -LiteralPath (Join-Path $target 'backup.json') -Encoding UTF8 -Value ($manifest | ConvertTo-Json -Depth 8)

  $checksumLines = @()
  foreach ($file in $files) {
    $relative = $file['path']
    $hash = $file['sha256']
    if ($hash) { $checksumLines += "$hash  $relative" }
  }
  Set-Content -LiteralPath (Join-Path $target 'checksums.sha256') -Encoding ASCII -Value $checksumLines
}

function Assert-PostgresObjectStorageMode($envMap) {
  if (($envMap.DATABASE_DRIVER -ne 'postgres') -or (@('r2', 'minio') -notcontains $envMap.OBJECT_STORAGE_DRIVER)) {
    Fail 'Docker release backup/restore requires DATABASE_DRIVER=postgres and OBJECT_STORAGE_DRIVER=r2 or minio. Run run\docker\install.bat or run\docker\start.bat to rewrite the release env.'
  }
}

function Test-ReleaseHealth {
  $envMap = Read-EnvFile
  $port = if ($envMap.APP_PORT) { $envMap.APP_PORT } else { '4000' }
  $url = "http://127.0.0.1:$port/health"
  Write-Step "Waiting for Docker release health at $url"
  $deadline = (Get-Date).AddSeconds(180)
  $healthy = $false
  do {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ([int]$response.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    } catch {}
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  if (-not $healthy) {
    Invoke-Compose -ComposeArgs @('logs', '--tail', '120', 'app') -AllowFailure
    Fail "Docker release app did not become healthy at $url"
  }

  if (Test-Path -LiteralPath $RouteContractScript) {
    Write-Step 'Checking Docker release API route contract...'
    $node = Find-Executable @('node.exe', 'node') @('C:\Program Files\nodejs\node.exe')
    if ($node) {
      $contract = Invoke-ProcessWithTimeout $node @($RouteContractScript, "http://127.0.0.1:$port") 30
      Set-Content -LiteralPath $RouteContractLog -Encoding UTF8 -Value (($contract.Stdout, $contract.Stderr) -join [Environment]::NewLine)
      if ($contract.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $RouteContractLog) { Get-Content -LiteralPath $RouteContractLog -Tail 80 }
        Fail "Docker release route contract failed. Log: $RouteContractLog"
      }
      Write-Ok 'Docker release API route contract passed.'
    } else {
      Write-Warn 'Node.js was not found on the host, so the route contract smoke could not run.'
    }
  }
  return $true
}

function Invoke-Backup {
  Ensure-DockerReady
  $envMap = Ensure-Env
  Assert-PostgresObjectStorageMode $envMap
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $target = Join-Path $BackupDir $stamp
  Ensure-Dir $target
  Invoke-Compose -ComposeArgs (@('up', '-d') + (Get-BaseDataServices $envMap))
  Write-Step "Backing up Postgres to $target"
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  & $docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres pg_dump --clean --if-exists --no-owner --no-privileges -U $envMap.POSTGRES_USER $envMap.POSTGRES_DB | Set-Content -LiteralPath (Join-Path $target 'postgres.sql') -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { Fail 'Postgres backup failed.' }
  Write-Step 'Writing object storage manifest...'
  $objectManifest = @{
    generatedAt = (Get-Date).ToString('o')
    driver = $envMap.OBJECT_STORAGE_DRIVER
    endpoint = $envMap.S3_ENDPOINT
    bucket = $envMap.S3_BUCKET
    note = if ($envMap.OBJECT_STORAGE_DRIVER -eq 'r2') { 'R2 object payloads stay in R2; this host backup records the object-store source for validation.' } else { 'Offline MinIO payloads are captured in minio.tgz.' }
  }
  Set-Content -LiteralPath (Join-Path $target 'objects-manifest.jsonl') -Encoding UTF8 -Value (($objectManifest | ConvertTo-Json -Compress))
  if ($envMap.OBJECT_STORAGE_DRIVER -eq 'minio') {
    Write-Step 'Backing up offline MinIO objects...'
    $minioVolume = Get-ComposeVolumeName 'business_os_minio'
    Invoke-VolumeTar $minioVolume $target 'minio.tgz'
  }
  Set-Content -LiteralPath (Join-Path $target 'parquet-manifest.json') -Encoding UTF8 -Value (@{
    generatedAt = (Get-Date).ToString('o')
    engine = if ($envMap.ANALYTICS_ENGINE) { $envMap.ANALYTICS_ENGINE } else { 'duckdb' }
    store = if ($envMap.PARQUET_STORE) { $envMap.PARQUET_STORE } else { $envMap.OBJECT_STORAGE_DRIVER }
    note = 'Parquet snapshots use the configured object store.'
  } | ConvertTo-Json -Depth 4)
  $files = @(
    @{ path = 'postgres.sql'; sha256 = Get-FileSha256 (Join-Path $target 'postgres.sql') },
    @{ path = 'objects-manifest.jsonl'; sha256 = Get-FileSha256 (Join-Path $target 'objects-manifest.jsonl') },
    @{ path = 'parquet-manifest.json'; sha256 = Get-FileSha256 (Join-Path $target 'parquet-manifest.json') }
  )
  if (Test-Path -LiteralPath (Join-Path $target 'minio.tgz')) {
    $files += @{ path = 'minio.tgz'; sha256 = Get-FileSha256 (Join-Path $target 'minio.tgz') }
  }
  Write-BackupManifest $target $envMap $files
  Write-Ok "Backup created in Docker/Drive-compatible format: $target"
}

function Invoke-Update {
  Ensure-DockerReady
  $envMap = Ensure-Env
  $previousFile = Join-Path $RuntimeDir 'previous-image.txt'
  Set-Content -LiteralPath $previousFile -Value $envMap.BUSINESS_OS_IMAGE -Encoding ASCII
  Invoke-Backup
  Write-Step 'Ensuring release image is available locally...'
  Ensure-ReleaseImageAvailable $envMap.BUSINESS_OS_IMAGE
  Invoke-Compose -ComposeArgs (@('pull') + (Get-BaseDataServices $envMap) + @('cloudflared')) -AllowFailure | Out-Null
  Write-Step 'Restarting release runtime...'
  Invoke-Start
  $code = Invoke-Compose -ComposeArgs @('ps') -AllowFailure
  if ($code -ne 0) {
    $previous = Get-Content -Raw $previousFile
    Write-Warn "Update health failed. Rolling back to $previous"
    $envMap.BUSINESS_OS_IMAGE = $previous.Trim()
    Write-EnvFile $envMap
    Invoke-Compose -ComposeArgs @('up', '-d', '--remove-orphans')
    Fail 'Update rolled back because health checks failed.'
  }
  Write-Ok 'Update completed.'
}

function Invoke-Restore {
  if (-not $BackupPath) { Fail 'Set -BackupPath to a backup folder containing manifest.json, postgres.sql, and objects-manifest.jsonl.' }
  $BackupPath = [System.IO.Path]::GetFullPath($BackupPath)
  $manifest = Join-Path $BackupPath 'manifest.json'
  $sql = Join-Path $BackupPath 'postgres.sql'
  $objectsManifest = Join-Path $BackupPath 'objects-manifest.jsonl'
  $minioArchive = Join-Path $BackupPath 'minio.tgz'
  if (-not (Test-Path -LiteralPath $manifest)) { Write-Warn 'Backup manifest.json not found; continuing only if required final backup files are present.' }
  if (-not (Test-Path -LiteralPath $sql)) { Fail "Backup does not contain postgres.sql: $BackupPath" }
  if (-not (Test-Path -LiteralPath $objectsManifest)) { Fail "Backup does not contain objects-manifest.jsonl: $BackupPath" }
  Ensure-DockerReady
  $envMap = Ensure-Env
  Assert-PostgresObjectStorageMode $envMap
  Write-Warn 'Restore will replace Docker Postgres data after validation. Object assets are validated from the configured object store.'
  Invoke-Compose -ComposeArgs @('stop', 'app', 'import-worker', 'media-worker', 'cloudflared') -AllowFailure | Out-Null
  Invoke-Compose -ComposeArgs (@('up', '-d') + (Get-BaseDataServices $envMap))
  if ($envMap.OBJECT_STORAGE_DRIVER -eq 'minio' -and (Test-Path -LiteralPath $minioArchive)) {
    Write-Step 'Restoring offline MinIO objects...'
    $minioVolume = Get-ComposeVolumeName 'business_os_minio'
    Invoke-VolumeTar $minioVolume $BackupPath 'minio.tgz' -Restore
  }
  Write-Step 'Restoring Postgres dump...'
  $docker = Resolve-Docker
  $env:DOCKER_CONFIG = $DockerConfig
  Get-Content -LiteralPath $sql | & $docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres psql -U $envMap.POSTGRES_USER $envMap.POSTGRES_DB
  if ($LASTEXITCODE -ne 0) { Fail 'Postgres restore failed.' }
  Invoke-Compose -ComposeArgs @('up', '-d', '--remove-orphans')
  Test-ReleaseHealth
  Write-Ok 'Restore completed.'
}

function Invoke-Doctor {
  $envMap = Ensure-Env
  Test-ReleaseContents
  Ensure-DockerReady
  Invoke-Docker -DockerArgs @('compose', '--env-file', $EnvFile, '-f', $ComposeFile, 'config', '--quiet') | Out-Null
  Invoke-Compose -ComposeArgs @('ps') -AllowFailure | Out-Null
  if ([string]$envMap.BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED -ne '1') {
    $summary = Get-PostgresCutoverBlockerSummary
    Write-Warn 'Docker infrastructure is ready, but the Business OS app is not startable in Postgres-only mode yet.'
    Write-Warn 'Postgres migration can run, but live app routes still need the Postgres repository/object-storage adapter cutover.'
    if ($summary) { Write-Host $summary }
  }
  Write-Ok 'Docker release diagnostics completed.'
  Write-Ok 'Docker release uses local image bundles, Postgres data volumes, R2/offline object storage, Redis services, and no source bind mount.'
}

Set-Location $Root
switch ($Action) {
  'Release' { Invoke-Release }
  'Install' { Invoke-Install }
  'Start' { Invoke-Start }
  'Update' { Invoke-Update }
  'Backup' { Invoke-Backup }
  'Restore' { Invoke-Restore }
  'Doctor' { Invoke-Doctor }
}
