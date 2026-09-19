param([int]$Count = 10)
# COPY ONLY. A successful copy is not deletion approval.
$ErrorActionPreference = 'Stop'
$archiveRoot = 'C:\Users\mrkl6\BusinessOS-Recovery\2026-09-19'
$taskRoot = 'C:\Users\mrkl6\Downloads\bos-supplier-settlement-20260918'
$acl = Get-Acl -LiteralPath $archiveRoot
if (-not $acl.AreAccessRulesProtected) { throw 'Archive ACL must be private first' }
$allowedSids = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18')
foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids) { throw 'Unexpected archive access principal' }
}
$inventory = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'remaining-manifest.json') -Raw | ConvertFrom-Json
$selected = @($inventory.results | Where-Object { $_.disposition -eq 'retain-local-work-or-unbacked-head' -and $_.trackedStatusRecords -gt 0 } | Select-Object -First $Count)
$allRoots = @($inventory.results | ForEach-Object { [IO.Path]::GetFullPath($_.path).TrimEnd('\') })
$snapshotRoot = Join-Path $archiveRoot 'snapshots'
New-Item -ItemType Directory -Path $snapshotRoot -Force | Out-Null
$results = @()
foreach ($entry in $selected) {
    $source = [IO.Path]::GetFullPath($entry.path).TrimEnd('\')
    if ($source -notin $allRoots -or $source -eq $taskRoot -or $source -eq 'C:\Users\mrkl6\Downloads\business-os-v1') { throw 'Invalid snapshot source' }
    $item = Get-Item -LiteralPath $source -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source is a link' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $id = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($source.ToLowerInvariant())))).Replace('-','').Substring(0,16).ToLowerInvariant() } finally { $sha.Dispose() }
    $destination = Join-Path $snapshotRoot $id
    if (Test-Path -LiteralPath $destination) { throw 'Snapshot exists; inspect before overwriting' }
    $nested = @($allRoots | Where-Object { $_ -ne $source -and $_.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase) })
    $excluded = @((Join-Path $source '.git')) + $nested
    New-Item -ItemType Directory -Path $destination | Out-Null
    $record = [pscustomobject]@{source=$source;destination=$destination;head=$entry.head;branch=$entry.branch;nestedRootsExcluded=$nested;gitStorageArchive=(Join-Path $archiveRoot 'git-common');copyOnly=$true;deletionApproved=$false;copyExit=$null}
    $record | ConvertTo-Json -Depth 5 | Out-File -LiteralPath (Join-Path $snapshotRoot ($id+'-metadata.json')) -Encoding utf8
    # DAT retains data (including ADS), attributes and timestamps. No source ACLs
    # are imported into the private recovery tree. Junctions are NOT traversed.
    $copyArgs = @($source,$destination,'/E','/COPY:DAT','/DCOPY:DAT','/XJ','/SL','/R:0','/W:0','/NP','/NFL','/NDL',('/LOG:'+(Join-Path $snapshotRoot ($id+'-copy.log'))),'/XD') + $excluded
    & robocopy @copyArgs | Out-Null
    $record.copyExit=$LASTEXITCODE
    $record | ConvertTo-Json -Depth 5 | Out-File -LiteralPath (Join-Path $snapshotRoot ($id+'-metadata.json')) -Encoding utf8
    if ($record.copyExit -ge 8) { throw "Snapshot copy incomplete: $id" }
    $results += $record
    ConvertTo-Json -InputObject @($results) -Depth 5 | Out-File -LiteralPath (Join-Path $archiveRoot 'first-batch-copy.json') -Encoding utf8
    Write-Output "Copied snapshot $($results.Count)/$($selected.Count): $id (not deletion-approved)"
}
