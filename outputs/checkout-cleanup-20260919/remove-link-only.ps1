param([switch]$Apply, [switch]$ExternalOnly)
$ErrorActionPreference = 'Stop'
$taskRoot = 'C:\Users\mrkl6\Downloads\bos-supplier-settlement-20260918'
$downloadsRoot = 'C:\Users\mrkl6\Downloads'
$logPrefix = if ($ExternalOnly) { 'link-external' } else { 'link' }
$externalPaths = @(
    'C:\Users\mrkl6\.codex\worktrees\private-read-integrated-tests',
    'C:\Users\mrkl6\.codex\worktrees\storage-fixture-tests'
)
foreach ($name in @('ee-barcode','ee-holds','ee-sargable','ee-shift-credit','ee-tg-actor','fix-i18n','head-cert-base','s4-adj','sec-11','sec-9-hygiene')) {
    $externalPaths += Join-Path 'C:\Users\mrkl6\Downloads\bos-rc-workers' $name
}
$inventory = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$ignoredInventory = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ignored-manifest.json') -Raw | ConvertFrom-Json
$registered = @(& git -C $taskRoot worktree list --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'Worktree inventory failed' }
$allPaths = @($registered | Where-Object { $_.StartsWith('worktree ') } | ForEach-Object { [IO.Path]::GetFullPath($_.Substring(9)).TrimEnd('\') })
$processes = @(Get-CimInstance Win32_Process)
$team = (& node (Join-Path $taskRoot 'agent-team/scripts/team-state.mjs') status | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Claim inventory failed' }
$claims = @($team.claims | Where-Object { -not $_.stale })
$remoteHeads = @{}
$remoteLines = @(& git -C $taskRoot ls-remote --heads origin)
if ($LASTEXITCODE -ne 0) { throw 'Remote verification failed' }
foreach ($line in $remoteLines) { $parts = $line -split '\s+'; $remoteHeads[$parts[1]] = $parts[0] }
$sharedLinks = @()
foreach ($root in $allPaths) {
    foreach ($relative in @('', 'frontend', 'cloudflare', 'node_modules', 'frontend/node_modules', 'cloudflare/node_modules')) {
        $probe = if ($relative) { Join-Path $root $relative } else { $root }
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                foreach ($target in @($item.Target)) { if ($target) { $sharedLinks += [pscustomobject]@{path=$probe;target=[IO.Path]::GetFullPath($target).TrimEnd('\')} } }
            }
        }
    }
}
function Check-Candidate($row) {
    $candidate = [IO.Path]::GetFullPath($row.path).TrimEnd('\')
    $inBoundary = if ($ExternalOnly) { $candidate -in $externalPaths } else { [IO.Path]::GetDirectoryName($candidate) -eq $downloadsRoot }
    if (-not $inBoundary -or $candidate -eq $taskRoot -or $candidate -eq (Join-Path $downloadsRoot 'business-os-v1')) { throw 'Outside approved boundary or retained workspace' }
    if ($candidate -notin $allPaths) { throw 'Not currently registered' }
    $rootItem = Get-Item -LiteralPath $candidate -Force
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Root is a link' }
    if (@($allPaths | Where-Object { $_ -ne $candidate -and $_.StartsWith($candidate+'\',[StringComparison]::OrdinalIgnoreCase) }).Count) { throw 'Nested worktree' }
    if (@($sharedLinks | Where-Object { $_.target -eq $candidate -or $_.target.StartsWith($candidate+'\',[StringComparison]::OrdinalIgnoreCase) }).Count) { throw 'Inbound dependency link' }
    if (@($claims | Where-Object { $_.worktree -and [IO.Path]::GetFullPath($_.worktree).TrimEnd('\') -eq $candidate }).Count) { throw 'Active claim' }
    if (@($processes | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains($candidate) -or $_.CommandLine.Contains($candidate.Replace('\','/'))) }).Count) { throw 'Process reference' }
    $entry = @($inventory.results | Where-Object { [IO.Path]::GetFullPath($_.path).TrimEnd('\') -eq $candidate })
    if ($entry.Count -ne 1 -or $entry[0].disposition -ne 'review-ignored-data-and-active-use') { throw 'Unexpected inventory classification' }
    $head = & git -C $candidate rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $head -ne $entry[0].head) { throw 'HEAD changed' }
    $dirty = @(& git -C $candidate status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count) { throw 'Dirty worktree' }
    $ignored = @(& git -C $candidate ls-files --others --ignored --exclude-standard --directory)
    if ($LASTEXITCODE -ne 0 -or -not $ignored.Count) { throw 'Ignored list unavailable/changed' }
    $links = @()
    foreach ($relative in $ignored) {
        if ($relative -notin @('node_modules/','frontend/node_modules/','cloudflare/node_modules/')) { throw 'Non-dependency local data present' }
        $linkPath = [IO.Path]::GetFullPath((Join-Path $candidate $relative.TrimEnd('/')))
        if (-not $linkPath.StartsWith($candidate+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Link outside candidate' }
        $linkItem = Get-Item -LiteralPath $linkPath -Force
        if (-not ($linkItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $linkItem.LinkType -ne 'Junction' -or @($linkItem.Target).Count -ne 1) { throw 'Not an ordinary single-target junction' }
        $target = [IO.Path]::GetFullPath([string]$linkItem.Target[0]).TrimEnd('\')
        if ($target.StartsWith($candidate+'\',[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $target)) { throw 'Unsafe/missing dependency target' }
        $links += [pscustomobject]@{path=$linkPath;target=$target}
    }
    $remoteRef = $null; $remoteSha = $null
    foreach ($ref in $entry[0].remoteRefs) {
        $testRef = $ref.Replace('refs/remotes/origin/','refs/heads/')
        if ($remoteHeads.ContainsKey($testRef)) {
            & git -C $taskRoot merge-base --is-ancestor $head $remoteHeads[$testRef]
            if ($LASTEXITCODE -eq 0) { $remoteRef=$testRef; $remoteSha=$remoteHeads[$testRef]; break }
        }
    }
    if (-not $remoteRef) { throw 'No live remote branch contains HEAD' }
    return [pscustomobject]@{path=$candidate;head=$head;branch=$entry[0].branch;remote=$remoteRef;remoteSha=$remoteSha;links=$links;removed=$false}
}
$results = @(); $skipped = @()
if ($Apply) {
    $rows = Get-Content -LiteralPath (Join-Path $PSScriptRoot ($logPrefix+'-preflight.json')) -Raw | ConvertFrom-Json
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot ($logPrefix+'-removed.json'))) { throw 'Existing execution log: inspect rather than overwrite' }
} else {
    $rows = @($ignoredInventory.results | Where-Object {
        $_.classification -eq 'dependency-links-only-review' -and
        (($ExternalOnly -and [IO.Path]::GetFullPath($_.path).TrimEnd('\') -in $externalPaths) -or
         (-not $ExternalOnly -and [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($_.path)) -eq $downloadsRoot))
    })
}
foreach ($row in $rows) {
    try { $checked = Check-Candidate $row }
    catch {
        if ($Apply) { throw }
        $skipped += [pscustomobject]@{path=$row.path;reason=$_.Exception.Message}; continue
    }
    if ($Apply) {
        # Save recovery/link metadata before any mutation; never recurse into a junction.
        $checked | ConvertTo-Json -Depth 6 | Out-File -LiteralPath (Join-Path $PSScriptRoot ($logPrefix+'-current-operation.json')) -Encoding utf8
        foreach ($link in $checked.links) {
            [IO.Directory]::Delete($link.path, $false)
            if ((Test-Path -LiteralPath $link.path) -or -not (Test-Path -LiteralPath $link.target)) { throw 'Junction removal verification failed' }
        }
        $remaining = @(& git -C $checked.path ls-files --others --ignored --exclude-standard)
        if ($LASTEXITCODE -ne 0 -or $remaining.Count) { throw 'Unexpected residual ignored data' }
        & git -C $taskRoot worktree remove -- $checked.path
        if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $checked.path)) { throw 'Git refused or did not finish removal' }
        & git -C $taskRoot cat-file -e ($checked.head+'^{commit}')
        if ($LASTEXITCODE -ne 0) { throw 'Recovery commit missing' }
        $checked.removed = $true
    }
    $results += $checked
    $filename = if ($Apply) { $logPrefix+'-removed.json' } else { $logPrefix+'-preflight.json' }
    ConvertTo-Json -InputObject @($results) -Depth 6 | Out-File -LiteralPath (Join-Path $PSScriptRoot $filename) -Encoding utf8
    if ($results.Count % 20 -eq 0) { Write-Output "Processed $($results.Count) candidates; Apply=$Apply" }
}
if (-not $Apply) { ConvertTo-Json -InputObject @($skipped) -Depth 4 | Out-File -LiteralPath (Join-Path $PSScriptRoot ($logPrefix+'-skipped.json')) -Encoding utf8 }
Write-Output "Completed: $($results.Count); skipped: $($skipped.Count); Apply=$Apply"
