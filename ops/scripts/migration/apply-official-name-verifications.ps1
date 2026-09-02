param(
  [string]$ReviewCsv = 'C:\Users\mrkl6\Downloads\review_official_names.csv',
  # Kept well within D1's SQL-size limit while avoiding one CLI request per row.
  [int]$BatchSize = 20,
  [switch]$Apply,
  [switch]$SkipPreflight,
  [int]$StartBatch = 0,
  [int]$MaxBatches = 0
)

$ErrorActionPreference = 'Stop'

function SqlLiteral([string]$Value) {
  if ($null -eq $Value) { $Value = '' }
  return "'" + ($Value -replace "'", "''") + "'"
}

function Invoke-D1File([string]$Sql) {
  $tempSql = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "official-name-verification-$([guid]::NewGuid().ToString('N')).sql")
  try {
    [System.IO.File]::WriteAllText($tempSql, $Sql, [System.Text.UTF8Encoding]::new($false))
    $result = & npx wrangler d1 execute business-os --remote --file $tempSql --json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "D1 command failed: $result" }
    $jsonText = $result | Out-String
    $jsonStart = $jsonText.IndexOf("[`r`n[")
    if ($jsonStart -lt 0) { $jsonStart = $jsonText.IndexOf('[') }
    if ($jsonStart -lt 0) { throw "D1 returned no JSON: $jsonText" }
    if ($jsonText[$jsonStart] -ne '[') { $jsonStart += 2 }
    return ($jsonText.Substring($jsonStart) | ConvertFrom-Json)
  } finally {
    if (Test-Path -LiteralPath $tempSql) { Remove-Item -LiteralPath $tempSql -Force }
  }
}

function Build-VerificationCte($Batch) {
  $values = foreach ($row in $Batch) {
    "($($row.id), $(SqlLiteral $row.barcode), $(SqlLiteral $row.shop_name), $(SqlLiteral $row.proposed_official_name))"
  }
  return "WITH verified(id, barcode, shop_name, official_name) AS (VALUES $($values -join ', '))"
}

$rows = Import-Csv -LiteralPath $ReviewCsv |
  Where-Object {
    $_.confidence -eq 'high' -and
    $_.id -match '^\d+$' -and
    -not [string]::IsNullOrWhiteSpace($_.barcode) -and
    -not [string]::IsNullOrWhiteSpace($_.shop_name) -and
    -not [string]::IsNullOrWhiteSpace($_.proposed_official_name)
  }

if (-not $rows.Count) { throw 'No high-confidence official-name rows found.' }

$batches = @()
for ($start = 0; $start -lt $rows.Count; $start += $BatchSize) {
  $end = [Math]::Min($start + $BatchSize - 1, $rows.Count - 1)
  $batches += ,@($rows[$start..$end])
}
if ($StartBatch -gt 0) { $batches = @($batches | Select-Object -Skip $StartBatch) }
if ($MaxBatches -gt 0) { $batches = @($batches | Select-Object -First $MaxBatches) }

if (-not $SkipPreflight) {
  $eligible = 0
  foreach ($batch in $batches) {
    $cte = Build-VerificationCte $batch
    $json = Invoke-D1File @"
$cte
SELECT COUNT(*) AS eligible
FROM products p
INNER JOIN verified v ON v.id = p.id AND v.barcode = p.barcode
WHERE COALESCE(p.description, '') = 'Official Product Name:' || char(10) || v.shop_name;
"@
    $eligible += [int]$json[0].results[0].eligible
  }

  Write-Host "High-confidence mappings: $($rows.Count)"
  Write-Host "Safe live matches (same id, barcode and original description): $eligible"
}

if (-not $Apply) {
  Write-Host 'Dry run only. Re-run with -Apply to write the safe matches.'
  exit 0
}

$changed = 0
foreach ($batch in $batches) {
  $cte = Build-VerificationCte $batch
  $json = Invoke-D1File @"
$cte
UPDATE products
SET description = 'Official Product Name:' || char(10) || (
      SELECT v.official_name FROM verified v WHERE v.id = products.id AND v.barcode = products.barcode
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM verified v
  WHERE v.id = products.id
    AND v.barcode = products.barcode
    AND COALESCE(products.description, '') = 'Official Product Name:' || char(10) || v.shop_name
);
"@
  $changed += [int]$json[-1].meta.changes
}

Write-Host "Updated official-name descriptions: $changed"
Write-Host "Skipped because the live record no longer matched the reviewed id/barcode/description: $($rows.Count - $changed)"
