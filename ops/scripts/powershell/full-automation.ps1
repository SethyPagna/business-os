# =============================================================================
#  full-automation.ps1
#
#  Cloudflare-only replacement for the old Docker "verify -> build image ->
#  start container" pipeline. Business OS has no self-hosted backend anymore
#  (see PORTING_STATUS.md) - the only thing to "release" is the Cloudflare
#  Worker + its static frontend assets, and the only thing to "start" is
#  confirming the already-always-on Workers URL is actually serving the new
#  code. This script therefore does, in order:
#
#    1. Remove known stray/archived files that can linger when an update is
#       copied over an existing folder without deleting removed files first
#    2. Install dependencies for the frontend and Cloudflare Worker
#       (`npm ci` when a lockfile exists, so a declared-but-not-installed
#       dependency fails loudly here instead of two steps later at typecheck)
#    3. Typecheck the Cloudflare Worker and the frontend
#    4. Build the frontend (output consumed by wrangler as [assets])
#    5. Apply any pending D1 migrations to the REMOTE database
#    6. Push secrets from cloudflare/.dev.vars to Cloudflare (wrangler secret put),
#       so production always has whatever's in your local .dev.vars
#    7. `wrangler deploy`
#    8. Poll the real public Workers URL's /health endpoint until it
#       reports the freshly deployed version (or timeout)
#
#  Steps 5-7 authenticate automatically via cloudflare/.wrangler-auth.local
#  (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID) if that file exists --
#  no `wrangler login` needed. See cloudflare/README.md.
#
#  Any failed step stops the script with a non-zero exit code and a clear
#  [ERROR] line naming the step, matching run\full-automation.bat's
#  pass/fail messaging.
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File full-automation.ps1
#    (normally invoked via run\full-automation.bat, not directly)
#
#  Env overrides:
#    BUSINESS_OS_REPO_ROOT   - repo root (default: two levels up from this file)
#    BUSINESS_OS_HEALTH_URL  - full health-check URL
#                              (default: https://admin.leangcosmetics.dpdns.org/health,
#                              taken from cloudflare/wrangler.toml's admin route)
#    BUSINESS_OS_HEALTH_TIMEOUT_SEC - seconds to poll before giving up (default: 60)
#    BUSINESS_OS_SKIP_INSTALL - set to 1 to skip the dependency-install step
#                                (e.g. a repeat run right after one that just installed)
# =============================================================================

$ErrorActionPreference = 'Stop'

# See verify-local.ps1's matching comment for the full writeup: on
# PowerShell 7.3+ this defaults to $true, which promotes a native
# command's non-zero exit code straight to a terminating exception under
# $ErrorActionPreference = 'Stop' -- before Invoke-Step's own
# `if ($LASTEXITCODE -ne 0)` check below ever runs. Off restores
# PS 5.1/6-style behavior (exit code only); harmless no-op on versions
# that don't recognize the variable.
$PSNativeCommandUseErrorActionPreference = $false

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Invoke-Step {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [scriptblock]$Action
  )
  Write-Step $Name
  & $Action
  if ($LASTEXITCODE -ne 0) {
    Write-Err "$Name failed (exit code $LASTEXITCODE)."
    exit $LASTEXITCODE
  }
  Write-Ok $Name
}

# ---- Resolve paths ----------------------------------------------------------
if ($env:BUSINESS_OS_REPO_ROOT) {
  $Root = $env:BUSINESS_OS_REPO_ROOT
} else {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}
$CloudflareDir = Join-Path $Root 'cloudflare'
$FrontendDir = Join-Path $Root 'frontend'

if (-not (Test-Path $CloudflareDir)) {
  Write-Err "Cloudflare project not found at $CloudflareDir"
  exit 1
}

$HealthUrl = if ($env:BUSINESS_OS_HEALTH_URL) { $env:BUSINESS_OS_HEALTH_URL } else { 'https://admin.leangcosmetics.dpdns.org/health' }
$HealthTimeoutSec = if ($env:BUSINESS_OS_HEALTH_TIMEOUT_SEC) { [int]$env:BUSINESS_OS_HEALTH_TIMEOUT_SEC } else { 60 }

Write-Host "Business OS full automation (Cloudflare)" -ForegroundColor Yellow
Write-Host "Repo root:   $Root"
Write-Host "Health URL:  $HealthUrl"

# ---- 1. Remove known stray/archived files -----------------------------------
# Copying an updated repo over an EXISTING folder (unzip/tar-extract without
# wiping the destination first) only adds/overwrites files present in the
# archive -- it never deletes a file that a prior session removed, because
# that removal isn't "in" the new archive at all, it's an absence. This is
# exactly why `cloudflare/src/googleDrive.ts` (a byte-identical, unreferenced
# duplicate of `src/lib/googleDrive.ts`, archived to
# ops/old-archive/cloudflare-lib/googleDrive-stray-duplicate.ts) kept coming
# back and re-breaking `tsc --noEmit` even after being removed from the
# archive: the stray copy was never actually deleted from disk, just absent
# from what got copied in. This step deletes it again here so re-applying an
# update this same way can't resurrect it a third time. Safe by construction:
# only ever removes an exact relative path, never globs, and does nothing if
# the path is already gone.
$StaleFiles = @(
  'cloudflare\src\googleDrive.ts'
)
Invoke-Step "Remove known stray files" {
  foreach ($rel in $StaleFiles) {
    $full = Join-Path $Root $rel
    if (Test-Path $full) {
      Remove-Item $full -Force
      Write-Host "  removed stale file: $rel" -ForegroundColor DarkYellow
    }
  }
  $global:LASTEXITCODE = 0
}

# ---- 2. Install dependencies --------------------------------------------------
# `npm ci` reads only package-lock.json, so it fails loudly and immediately if
# package.json and the lockfile ever drift apart again (the concrete bug this
# fixes: @ffmpeg/ffmpeg was declared in package.json but missing from
# package-lock.json, so npm ci silently produced a node_modules without it and
# the failure only surfaced two steps later at typecheck). Falls back to
# `npm install` if there's no lockfile yet. Skippable with
# BUSINESS_OS_SKIP_INSTALL=1 for a repeat run against an already-fresh install.
function Install-Deps($Dir, $Label) {
  Invoke-Step "Install dependencies ($Label)" {
    Push-Location $Dir
    if (Test-Path (Join-Path $Dir 'package-lock.json')) {
      npm ci --no-audit --no-fund
    } else {
      npm install --no-audit --no-fund
    }
    Pop-Location
  }
}

if ($env:BUSINESS_OS_SKIP_INSTALL -eq '1') {
  Write-Host "Skipping dependency install (BUSINESS_OS_SKIP_INSTALL=1)" -ForegroundColor DarkGray
} else {
  Install-Deps $FrontendDir "frontend"
  Install-Deps $CloudflareDir "cloudflare"
}

# ---- 3. Typecheck -----------------------------------------------------------
Invoke-Step "Typecheck frontend" {
  Push-Location $FrontendDir
  npm run typecheck
  Pop-Location
}

Invoke-Step "Typecheck Cloudflare Worker" {
  Push-Location $CloudflareDir
  npm run typecheck
  Pop-Location
}

# ---- 4. Build frontend ------------------------------------------------------
Invoke-Step "Build frontend" {
  Push-Location $FrontendDir
  npm run build
  Pop-Location
}

# ---- 5. Apply pending remote D1 migrations -------------------------------------
Invoke-Step "Apply remote D1 migrations" {
  Push-Location $CloudflareDir
  npm run migrate:remote
  Pop-Location
}

# ---- 6. Push secrets from .dev.vars to Cloudflare ------------------------------
Invoke-Step "Sync secrets (.dev.vars -> Cloudflare)" {
  Push-Location $CloudflareDir
  npm run secrets:sync
  Pop-Location
}

# ---- 7. Deploy the Worker -------------------------------------------------------
Invoke-Step "wrangler deploy" {
  Push-Location $CloudflareDir
  npm run deploy
  Pop-Location
}

# ---- 8. Live health check against the real Workers URL ------------------------
Write-Step "Health check: $HealthUrl (timeout ${HealthTimeoutSec}s)"
$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$lastError = $null
$healthy = $false
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 10
    if ($response.status -eq 'ok') {
      Write-Ok "Health check passed - status=ok, version=$($response.version), time=$($response.time)"
      $healthy = $true
      break
    }
    $lastError = "Unexpected health response: $($response | ConvertTo-Json -Compress)"
  } catch {
    $lastError = $_.Exception.Message
  }
  Start-Sleep -Seconds 3
}

if (-not $healthy) {
  Write-Err "Health check against $HealthUrl did not report healthy within ${HealthTimeoutSec}s."
  if ($lastError) { Write-Err "Last error: $lastError" }
  Write-Err "The deploy step succeeded, but the live URL isn't confirmed healthy - check the Cloudflare dashboard/logs."
  exit 1
}

Write-Host "`nAll steps completed - Business OS is deployed and confirmed healthy at $HealthUrl" -ForegroundColor Green
exit 0
