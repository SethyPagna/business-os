param(
  [switch]$Apply,
  [switch]$IncludeCodexHelpers
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$LearnRoot = Join-Path (Split-Path $WorkspaceRoot -Parent) 'LEARN'

function Get-CurrentProcessFamilyIds {
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  $currentId = $PID
  while ($currentId -gt 0 -and $ids.Add([int]$currentId)) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $currentId" -ErrorAction SilentlyContinue
    if (-not $current) {
      break
    }
    $currentId = [int]$current.ParentProcessId
  }
  return $ids
}

function Get-NodeCategory {
  param([string]$CommandLine)

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return ''
  }
  if ($CommandLine -like "*$WorkspaceRoot*") {
    return ''
  }
  if ($CommandLine -like "*$LearnRoot*node_modules*next* start -p *") {
    return 'external-next-server'
  }
  if ($CommandLine -like '*\AppData\Local\Temp\learn-one-*.mjs*') {
    return 'temporary-learn-runner'
  }
  if ($IncludeCodexHelpers -and $CommandLine -like '*xcodebuildmcp*') {
    return 'codex-xcodebuildmcp-helper'
  }
  return ''
}

$currentProcessFamilyIds = Get-CurrentProcessFamilyIds
$allNodes = @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'")
$nodes = @($allNodes | Where-Object { -not $currentProcessFamilyIds.Contains([int]$_.ProcessId) })
$candidates = @()

foreach ($node in $nodes) {
  $category = Get-NodeCategory -CommandLine $node.CommandLine
  if (-not $category) {
    continue
  }

  $process = Get-Process -Id $node.ProcessId -ErrorAction SilentlyContinue
  $candidates += [pscustomobject]@{
    id = $node.ProcessId
    parentId = $node.ParentProcessId
    category = $category
    workingSetMB = if ($process) { [math]::Round($process.WorkingSet64 / 1MB, 1) } else { 0 }
    startedAt = $node.CreationDate
    commandLine = $node.CommandLine
  }
}

$stopped = @()
if ($Apply) {
  foreach ($candidate in $candidates) {
    Stop-Process -Id $candidate.id -Force -ErrorAction SilentlyContinue
    $stopped += $candidate
  }
  Start-Sleep -Seconds 1
}

$remainingNodes = @(
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { -not $currentProcessFamilyIds.Contains([int]$_.ProcessId) }
)
$result = [pscustomobject]@{
  mode = if ($Apply) { 'apply' } else { 'preview' }
  includeCodexHelpers = [bool]$IncludeCodexHelpers
  scannedNodeCount = $allNodes.Count
  scannedExternalNodeCount = $nodes.Count
  candidateCount = $candidates.Count
  stoppedCount = $stopped.Count
  stoppedWorkingSetMB = [math]::Round((($stopped | Measure-Object workingSetMB -Sum).Sum), 1)
  remainingExternalNodeCount = $remainingNodes.Count
  candidates = $candidates
}

$result | ConvertTo-Json -Depth 5
