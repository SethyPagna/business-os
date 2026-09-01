# =============================================================================
#  verify-local.ps1
#
#  Local-only counterpart to full-automation.ps1 -- runs everything that
#  can be checked on this machine, and stops before anything that would
#  touch Cloudflare. Useful after pulling/copying in a change when you
#  want to know "does this actually install, typecheck, pass its tests,
#  and build" without cutting a release. Does, in order:
#
#    1. Remove known stray/archived files (same reason as full-automation.ps1
#       step 1 -- see that file's comment; copying an update over an existing
#       folder never deletes a file the update removed, only adds/overwrites)
#    2. Install dependencies for the frontend and Cloudflare Worker
#       (`npm ci` when a lockfile exists, else `npm install`)
#    3. Typecheck the frontend and the Cloudflare Worker (`tsc --noEmit`)
#    4. Run the pure-logic test suites: the frontend's tests\*.test.ts
#       files (run individually via `node`, no vitest/build step needed)
#       and cloudflare\scripts\test-*.cjs. The $KnownFailing list below
#       can exempt named test files with pre-existing failures (reported
#       but not fatal); it is EMPTY as of Aug 31 2026 -- the two files it
#       used to carry (performanceLoadingUx.test.ts,
#       productSearchPagination.test.ts) were re-run and PASS on HEAD, so
#       leaving them exempt would have silently swallowed real
#       regressions. Any failure now fails the run.
#    5. Build the frontend (`vite build`) -- proves the bundle actually
#       compiles; this is the last step full-automation.ps1 also runs
#       before it starts touching Cloudflare (remote migrations, secrets,
#       deploy, live health check), none of which this script does.
#
#  This script never calls wrangler, never touches D1 (local or remote),
#  never pushes secrets, and never deploys. It also does not need
#  cloudflare\.wrangler-auth.local to exist. For an actual release, use
#  run\full-automation.bat / full-automation.ps1 instead.
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File verify-local.ps1
#    (normally invoked via run\verify-local.bat, not directly)
#
#  Env overrides:
#    BUSINESS_OS_REPO_ROOT    - repo root (default: two levels up from this file)
#    BUSINESS_OS_SKIP_INSTALL - set to 1 to skip the dependency-install step
#                                (e.g. a repeat run right after one that just installed)
#    BUSINESS_OS_SKIP_BUILD   - set to 1 to skip the final frontend build
# =============================================================================

$ErrorActionPreference = 'Stop'

# PowerShell 7.3+ defaults $PSNativeCommandUseErrorActionPreference to
# $true, which means a native command's non-zero exit code gets promoted
# to a *terminating* exception under $ErrorActionPreference = 'Stop' --
# thrown by PowerShell itself, before any of this script's own
# `if ($LASTEXITCODE -ne 0)` checks (Invoke-Step, and the per-test-file
# loop in step 4) ever run. That silently defeats the exit-code handling
# already written below on any machine running PS 7.3+. Turning it off
# restores PS 5.1/6-style behavior (native commands only ever set
# $LASTEXITCODE, never throw) for the whole script -- safe because every
# native-command call here already checks $LASTEXITCODE itself. Setting a
# variable a given PowerShell version doesn't recognize (5.1/6, which
# predate this preference) is a harmless no-op, not an error.
$PSNativeCommandUseErrorActionPreference = $false

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

function Invoke-Step {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [scriptblock]$Action
  )
  Write-Step $Name
  try {
    & $Action
  } catch {
    Write-Err "$Name failed: $($_.Exception.Message)"
    exit 1
  }
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
if (-not (Test-Path $FrontendDir)) {
  Write-Err "Frontend project not found at $FrontendDir"
  exit 1
}

Write-Host "Business OS local verify (no Cloudflare/wrangler steps)" -ForegroundColor Yellow
Write-Host "Repo root: $Root"

# The frontend barcode stack requires Node 24+ (@zxing/library 0.22.x declares
# that engine). Fail before npm mutates node_modules so an older runtime cannot
# produce a half-installed release tree or a later, harder-to-diagnose build
# failure.
Invoke-Step "Check Node.js runtime (24+)" {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw "Node.js is not installed or is not on PATH." }
  $nodeVersion = (& node -p "process.versions.node").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) { throw "Could not read the Node.js version." }
  $nodeMajor = [int](($nodeVersion -split '\.')[0])
  if ($nodeMajor -lt 24) {
    throw "Node.js 24 or newer is required; found v$nodeVersion. Upgrade Node.js, reopen the terminal, and run again."
  }
  Write-Host "  Node.js v$nodeVersion" -ForegroundColor DarkGray
  $global:LASTEXITCODE = 0
}


# ---- 1. Remove known stray/archived files -----------------------------------
# Kept in sync with full-automation.ps1's list by hand -- duplicated rather
# than shared so this script has zero dependency on that one and can be run
# completely on its own.
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

# ---- 4. Run pure-logic test suites -------------------------------------------
# Known pre-existing, unrelated failures: reported, but don't fail the run
# on their own; anything else does. EMPTY on purpose (verified Aug 31 2026:
# the two former entries pass on HEAD) -- only add a file here with evidence
# the failure predates your change, and remove it as soon as it's fixed, or
# it will mask the next real regression in that file.
$KnownFailing = @()

Write-Step "Run frontend test suite (tests\*.test.ts)"
$TestsDir = Join-Path $FrontendDir 'tests'
$TestFiles = Get-ChildItem -Path $TestsDir -Filter '*.test.ts' | Sort-Object Name
$UnexpectedFailures = @()
$KnownFailuresSeen = @()
$PassCount = 0

foreach ($file in $TestFiles) {
  Push-Location $FrontendDir
  # Separate bug from the $PSNativeCommandUseErrorActionPreference one
  # above, same underlying cause (native-command output + Stop): merging
  # a native command's stderr into the pipeline via `2>&1` wraps each
  # stderr *line* in an ErrorRecord (category NativeCommandError) even
  # when the command itself exits 0. Under $ErrorActionPreference =
  # 'Stop', simply capturing one of those records is enough to throw --
  # this is what was actually crashing the script (the reported error
  # pointed straight at this line): any test file that writes anything
  # to stderr (a console.error from a failing assertion, a stack trace,
  # even a benign runtime warning) blew up the whole run instead of
  # being tallied as one pass/fail line like the rest. Local-scope
  # 'Continue' for just this one call lets $output capture the merged
  # text as plain strings again and fall through to the exit-code check
  # below, same as intended; nothing outside this foreach needs Stop
  # turned back on early since Pop-Location/the next iteration don't
  # depend on it.
  $ErrorActionPreference = 'Continue'
  $output = node --experimental-strip-types $file.FullName 2>&1
  $exit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Pop-Location
  if ($exit -eq 0) {
    $PassCount += 1
  } elseif ($KnownFailing -contains $file.Name) {
    $KnownFailuresSeen += $file.Name
    Write-Warn "known pre-existing failure: $($file.Name)"
  } else {
    $UnexpectedFailures += $file.Name
    Write-Err "unexpected failure: $($file.Name)"
    $output | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  }
}

Write-Host "  $PassCount/$($TestFiles.Count) passed ($($KnownFailuresSeen.Count) known pre-existing, $($UnexpectedFailures.Count) unexpected)"
if ($UnexpectedFailures.Count -gt 0) {
  Write-Err "Frontend test suite has unexpected failures: $($UnexpectedFailures -join ', ')"
  exit 1
}
Write-Ok "Frontend test suite ($PassCount passed, $($KnownFailuresSeen.Count) known pre-existing failures ignored)"

Invoke-Step "Run Cloudflare pure-logic test scripts" {
  Push-Location $CloudflareDir
  $anyFailed = $false
  Get-ChildItem -Path 'scripts' -Filter 'test-*.cjs' | Sort-Object Name | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) {
      Write-Err "  $($_.Name) failed"
      $anyFailed = $true
    }
  }
  Pop-Location
  $global:LASTEXITCODE = if ($anyFailed) { 1 } else { 0 }
}

# ---- 5. Build frontend --------------------------------------------------------
if ($env:BUSINESS_OS_SKIP_BUILD -eq '1') {
  Write-Host "`nSkipping frontend build (BUSINESS_OS_SKIP_BUILD=1)" -ForegroundColor DarkGray
} else {
  Invoke-Step "Build frontend" {
    Push-Location $FrontendDir
    npm run build
    Pop-Location
  }
}

Write-Host "`nAll local checks passed. Nothing was deployed -- run\full-automation.bat handles that." -ForegroundColor Green
exit 0
