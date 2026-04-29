$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:BUSINESS_OS_REPO_ROOT = $repoRoot
& (Join-Path $repoRoot 'ops\scripts\powershell\clean-generated.ps1') @args
exit $LASTEXITCODE
