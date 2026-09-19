param([switch]$Apply, [switch]$BatchTwo)
$ErrorActionPreference = 'Stop'
$taskRoot = 'C:\Users\mrkl6\Downloads\bos-supplier-settlement-20260918'
$downloadsRoot = 'C:\Users\mrkl6\Downloads'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$allPaths = @($manifest.results | ForEach-Object { [IO.Path]::GetFullPath($_.path).TrimEnd('\') })
$processes = @(Get-CimInstance Win32_Process)
$team = (& node (Join-Path $taskRoot 'agent-team/scripts/team-state.mjs') status | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Cannot check agent claims' }
$activeClaims = @($team.claims | Where-Object { -not $_.stale })
$outcomes = @()
# Only these three independently checked, remotely archived clean worktrees.
$approvedNames = @('bos-active-data-completeness-20260908', 'bos-backend-gate-merge-harness-20260908', 'bos-canonical-branch-i18n-20260908')
if ($BatchTwo) {
    if ($Apply) {
        $preflight = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'preflight-batch-two.json') -Raw | ConvertFrom-Json
        $approvedNames = @(foreach ($planned in $preflight) { [IO.Path]::GetFileName([string]$planned.path) })
        if ($approvedNames.Count -ne $preflight.Count) { throw 'Preflight enumeration mismatch' }
        $priorLog = Join-Path $PSScriptRoot 'removed-batch-two.json'
        if (Test-Path -LiteralPath $priorLog) {
            $priorRecords = Get-Content -LiteralPath $priorLog -Raw | ConvertFrom-Json
            foreach ($prior in $priorRecords) {
                if (-not $prior.removed -or (Test-Path -LiteralPath $prior.path)) { throw 'Prior removal log mismatch' }
                $outcomes += $prior
            }
            $priorNames = @($outcomes | ForEach-Object { [IO.Path]::GetFileName([string]$_.path) })
            $approvedNames = @($approvedNames | Where-Object { $_ -notin $priorNames })
        }
        Write-Output "Remaining checked names: $($approvedNames.Count)"
    } else {
        $approvedNames = @($manifest.results | Where-Object {
            $_.disposition -eq 'review-active-use-before-removal' -and
            [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($_.path)) -eq $downloadsRoot -and
            (Test-Path -LiteralPath $_.path)
        } | ForEach-Object { [IO.Path]::GetFileName($_.path) })
    }
}
$remoteHeads = @{}
$remoteLines = @(& git -C $taskRoot ls-remote --heads origin)
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify current remote branches' }
foreach ($line in $remoteLines) { $parts = $line -split '\s+'; $remoteHeads[$parts[1]] = $parts[0] }
foreach ($name in $approvedNames) {
    $candidate = [IO.Path]::GetFullPath((Join-Path $downloadsRoot $name)).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($candidate) -ne $downloadsRoot -or $candidate -eq $taskRoot) { throw 'Invalid cleanup boundary' }
    $entry = @($manifest.results | Where-Object { [IO.Path]::GetFullPath($_.path).TrimEnd('\') -eq $candidate })
    if ($entry.Count -ne 1 -or $entry[0].disposition -ne 'review-active-use-before-removal') { throw "Unapproved inventory state: $name" }
    if (-not (Test-Path -LiteralPath $candidate)) { throw "Missing candidate: $name" }
    $item = Get-Item -LiteralPath $candidate -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked root: $name" }
    if (@($allPaths | Where-Object { $_ -ne $candidate -and $_.StartsWith($candidate + '\', [StringComparison]::OrdinalIgnoreCase) }).Count) { throw "Nested worktree: $name" }
    if (@($activeClaims | Where-Object { $_.worktree -and [IO.Path]::GetFullPath($_.worktree).TrimEnd('\') -eq $candidate }).Count) { throw "Active agent: $name" }
    if (@($processes | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains($candidate) -or $_.CommandLine.Contains($candidate.Replace('\','/'))) }).Count) { throw "Process reference: $name" }
    $links = @(Get-ChildItem -LiteralPath $candidate -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($links.Count) { throw "Reparse point inside candidate: $name" }
    $head = & git -C $candidate rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $head -ne $entry[0].head) { throw "Changed HEAD: $name" }
    $dirty = @(& git -C $candidate status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count) { throw "Dirty candidate: $name" }
    $ignored = @(& git -C $candidate ls-files --others --ignored --exclude-standard)
    if ($LASTEXITCODE -ne 0 -or $ignored.Count) { throw "Ignored data: $name" }
    $ref = @($entry[0].remoteRefs | Where-Object { $_ -like 'refs/remotes/origin/archive/*' -and $remoteHeads.ContainsKey($_.Replace('refs/remotes/origin/', 'refs/heads/')) })[0]
    if (-not $ref) { throw "No archive ref: $name" }
    $remoteRef = $ref.Replace('refs/remotes/origin/', 'refs/heads/')
    $remoteSha = $remoteHeads[$remoteRef]
    & git -C $taskRoot merge-base --is-ancestor $head $remoteSha
    if ($LASTEXITCODE -ne 0) { throw "Remote no longer contains commit: $name" }
    $outcome = [ordered]@{path=$candidate;head=$head;branch=$entry[0].branch;remote=$remoteRef;remoteSha=$remoteSha;removed=$false;recovery='git worktree add using retained local branch or recorded commit'}
    if ($Apply) {
        # No --force: Git must independently refuse dirty/locked worktrees.
        & git -C $taskRoot worktree remove -- $candidate
        if ($LASTEXITCODE -ne 0) { throw "Git refused removal: $name" }
        if (Test-Path -LiteralPath $candidate) { throw "Removal incomplete: $name" }
        & git -C $taskRoot cat-file -e ($head + '^{commit}')
        if ($LASTEXITCODE -ne 0) { throw "Recovery commit missing: $name" }
        $outcome.removed = $true
    }
    $outcomes += [pscustomobject]$outcome
    $suffix = if ($Apply) { 'removed' } else { 'preflight' }
    if ($BatchTwo) { $suffix += '-batch-two' }
    $outcomes | ConvertTo-Json -Depth 5 | Out-File -LiteralPath (Join-Path $PSScriptRoot ($suffix + '.json')) -Encoding utf8
    Write-Output "$suffix : $name"
}
