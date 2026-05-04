param(
  [ValidateSet('All', 'Check', 'Cloudflare', 'Test', 'Release', 'Start', 'Git')]
  [string]$Action = 'All',
  [string]$Version = '',
  [switch]$ApplyCloudflare,
  [switch]$NoGit
)

$ErrorActionPreference = 'Stop'

function Resolve-Root {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}

$Root = Resolve-Root
$PolicyPath = Join-Path $Root 'ops\automation\business-os-automation.json'
$DockerRelease = Join-Path $Root 'ops\scripts\powershell\docker-release.ps1'
$CloudflareVerify = Join-Path $Root 'ops\scripts\runtime\verify-cloudflare-automation.mjs'
$R2Verify = Join-Path $Root 'ops\scripts\runtime\verify-r2-object-store.mjs'

function Write-Step($message) { Write-Host "[STEP] $message" }
function Write-Ok($message) { Write-Host "[OK] $message" }
function Fail($message, $code = 1) { Write-Host "[ERROR] $message"; exit $code }

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )
  Write-Step $Label
  & $Command
  if ($LASTEXITCODE -ne 0) { Fail "$Label failed." $LASTEXITCODE }
  Write-Ok $Label
}

function Get-ReleaseVersion {
  if ($Version) { return $Version }
  $pkg = Get-Content -Raw (Join-Path $Root 'backend\package.json') | ConvertFrom-Json
  return "v$($pkg.version)-$(Get-Date -Format 'yyyyMMddHHmm')"
}

function Invoke-CloudflareCheck {
  $cloudflareArgs = @($CloudflareVerify, '--policy', $PolicyPath)
  if ($ApplyCloudflare) { $cloudflareArgs += '--apply' }
  Invoke-Checked 'Cloudflare DNS, Access, WAF, and country/rate-limit readiness check' {
    node @cloudflareArgs
  }
}

function Invoke-TestGate {
  Invoke-Checked 'Frontend utility suite' {
    npm.cmd --prefix frontend run test:utils
  }
  Invoke-Checked 'Backend utility suite' {
    npm.cmd --prefix backend run test:utils
  }
  Invoke-Checked 'Frontend i18n verification' {
    npm.cmd --prefix frontend run verify:i18n
  }
  Invoke-Checked 'Frontend UI verification' {
    npm.cmd --prefix frontend run verify:ui
  }
  Invoke-Checked 'Frontend performance verification' {
    npm.cmd --prefix frontend run verify:performance
  }
  Invoke-Checked 'Frontend production build' {
    npm.cmd --prefix frontend run build
  }
  Invoke-Checked 'Docker release contract verification' {
    node ops\scripts\verify-docker-release.js
  }
  Invoke-Checked 'Secret hygiene verification' {
    node ops\scripts\verify-secret-hygiene.js
  }
  Invoke-Checked 'Live R2 object write/read/delete verification' {
    node $R2Verify
  }
  Invoke-Checked 'Git whitespace check' {
    git diff --check
  }
}

function Invoke-DockerReleaseAndStart {
  $tag = Get-ReleaseVersion
  Invoke-Checked "Docker release build business-os:$tag" {
    powershell -NoProfile -ExecutionPolicy Bypass -File $DockerRelease -Action Release -Version $tag
  }
  Invoke-Checked "Docker release start business-os:$tag" {
    powershell -NoProfile -ExecutionPolicy Bypass -File $DockerRelease -Action Start -Image "business-os:$tag"
  }
  Invoke-HealthCheck
  Invoke-ServiceWorkerCheck
}

function Invoke-HealthCheck {
  $policy = Get-Content -Raw $PolicyPath | ConvertFrom-Json
  $healthUrl = $policy.release.healthUrl
  Write-Step "Docker health check $healthUrl"
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 20
  if ($health.status -ne 'ok') { Fail "Health check failed for $healthUrl" }
  Write-Ok "/health is ok"
}

function Invoke-ServiceWorkerCheck {
  $policy = Get-Content -Raw $PolicyPath | ConvertFrom-Json
  $swUrl = $policy.release.serviceWorkerUrl
  Write-Step "Service worker security check $swUrl"
  $content = (& curl.exe -fsS $swUrl) -join "`n"
  if ($LASTEXITCODE -ne 0) { Fail "Unable to fetch /sw.js" $LASTEXITCODE }
  if (-not $content.Contains('/api/sync/outbox')) { Fail '/sw.js is missing /api/sync/outbox replay.' }
  if (-not $content.Contains("credentials: 'include'")) { Fail '/sw.js is missing cookie credentials.' }
  if ($content.Contains('OFFLINE_AUTH_SESSION_TOKEN_KEY')) { Fail '/sw.js still contains retired offline auth token storage.' }
  if (-not $content.Contains('BUSINESS_OS_APP_UPDATE_AVAILABLE')) { Fail '/sw.js is missing update notification support.' }
  if (-not $content.Contains("pathname.startsWith('/api/')")) { Fail '/sw.js does not explicitly bypass API caching.' }
  if (-not $content.Contains("pathname.startsWith('/uploads/')")) { Fail '/sw.js does not explicitly bypass upload/media caching.' }
  if (-not $content.Contains("pathname.startsWith('/portal/uploads/')")) { Fail '/sw.js does not explicitly bypass portal media caching.' }
  Write-Ok '/sw.js secure offline sync check passed'
}

function Invoke-GitPublish {
  if ($NoGit) {
    Write-Ok 'Git publish skipped by -NoGit.'
    return
  }
  Push-Location $Root
  try {
    $changes = git status --short
    if (-not $changes) {
      Write-Ok 'No git changes to commit.'
      return
    }
    Invoke-Checked 'Git commit' {
      git add -A
      git commit -m "Automated verified Business OS release"
    }
    Invoke-Checked 'Git push origin main' {
      git push origin main
    }
  } finally {
    Pop-Location
  }
}

Push-Location $Root
try {
  if (-not (Test-Path -LiteralPath $PolicyPath)) { Fail "Missing automation policy: $PolicyPath" }
  switch ($Action) {
    'Check' {
      Invoke-CloudflareCheck
      Invoke-TestGate
      Invoke-HealthCheck
      Invoke-ServiceWorkerCheck
    }
    'Cloudflare' { Invoke-CloudflareCheck }
    'Test' { Invoke-TestGate }
    'Release' { Invoke-TestGate; Invoke-DockerReleaseAndStart }
    'Start' { Invoke-DockerReleaseAndStart }
    'Git' { Invoke-GitPublish }
    default {
      Invoke-CloudflareCheck
      Invoke-TestGate
      Invoke-DockerReleaseAndStart
      Invoke-GitPublish
    }
  }
} finally {
  Pop-Location
}
