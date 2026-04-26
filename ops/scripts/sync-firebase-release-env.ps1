param(
  [Parameter(Mandatory = $true)]
  [string]$BackendEnv,
  [Parameter(Mandatory = $true)]
  [string]$BackendDir,
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDir
)

$ErrorActionPreference = 'Stop'

# 1. Firebase Release Env Sync
# 1.1 Purpose:
# - Copy referenced Firebase service-account file into release folder.
# - Rewrite release `.env` to use a relative `FIREBASE_SERVICE_ACCOUNT_JSON` path.
# 1.2 Safety:
# - Exits early when required files/values are missing.
# - Does not overwrite unrelated env keys.

if (-not (Test-Path -LiteralPath $BackendEnv)) { return }
if (-not (Test-Path -LiteralPath $ReleaseDir)) { return }

$releaseEnv = Join-Path $ReleaseDir '.env'
if (-not (Test-Path -LiteralPath $releaseEnv)) { return }

$line = Get-Content -LiteralPath $BackendEnv |
  Where-Object { $_ -match '^FIREBASE_SERVICE_ACCOUNT_JSON=' } |
  Select-Object -First 1
if (-not $line) { return }

$rawValue = ($line -replace '^FIREBASE_SERVICE_ACCOUNT_JSON=', '').Trim()
if (-not $rawValue) { return }
if ($rawValue.StartsWith('{')) { return }

$candidatePath = $rawValue
if (-not [System.IO.Path]::IsPathRooted($candidatePath)) {
  $candidatePath = Join-Path $BackendDir $candidatePath
}
if (-not (Test-Path -LiteralPath $candidatePath)) { return }

$destName = Split-Path -Leaf $candidatePath
$destPath = Join-Path $ReleaseDir $destName
Copy-Item -LiteralPath $candidatePath -Destination $destPath -Force

$entry = "FIREBASE_SERVICE_ACCOUNT_JSON=./$destName"
$releaseLines = Get-Content -LiteralPath $releaseEnv
if ($releaseLines -match '^FIREBASE_SERVICE_ACCOUNT_JSON=') {
  $releaseLines = $releaseLines -replace '^FIREBASE_SERVICE_ACCOUNT_JSON=.*', $entry
} else {
  $releaseLines += $entry
}
Set-Content -LiteralPath $releaseEnv -Value $releaseLines

Write-Output $destName
