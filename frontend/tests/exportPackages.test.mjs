import assert from 'node:assert/strict'
import { buildZip } from '../src/utils/csv.js'
import { buildReportManifestRows, buildReportPackageFiles } from '../src/utils/exportPackage.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('buildReportManifestRows normalizes manifest entries', () => {
  const rows = buildReportManifestRows([
    { metric: 'Date range', value: 'Apr 1 - Apr 30' },
    { section: 'Filters', label: 'Branch', value: 'Main' },
  ])

  assert.deepEqual(rows, [
    { Section: 'Report Manifest', Metric: 'Date range', Value: 'Apr 1 - Apr 30' },
    { Section: 'Filters', Metric: 'Branch', Value: 'Main' },
  ])
})

await runTest('buildReportPackageFiles includes context CSV, manifest CSV, and HTML report', async () => {
  const files = buildReportPackageFiles({
    baseName: 'inventory',
    exportStamp: '2026-04-30-120000',
    manifestRows: buildReportManifestRows([{ metric: 'Date range', value: 'April 2026' }]),
    csvFiles: [
      { name: 'inventory-export-context-2026-04-30-120000.csv', content: 'Section,Metric,Value\nContext,Date range,April 2026' },
      { name: 'inventory-stats-2026-04-30-120000.csv', content: 'Section,Metric,Value\nStats,Visible Products,42' },
      { name: 'inventory-calculations-2026-04-30-120000.csv', content: 'Section,Metric,Formula\nCalc,Stock Value,qty * cost' },
    ],
    reportFileName: 'inventory-report.html',
    reportContent: '<html><body>Inventory report</body></html>',
  })

  const names = files.map((file) => file.name)
  assert.deepEqual(names, [
    'inventory-export-context-2026-04-30-120000.csv',
    'inventory-stats-2026-04-30-120000.csv',
    'inventory-calculations-2026-04-30-120000.csv',
    'inventory-manifest-2026-04-30-120000.csv',
    'inventory-report.html',
  ])

  const zipBlob = buildZip(files)
  assert.ok(zipBlob)
  const rawText = Buffer.from(await zipBlob.arrayBuffer()).toString('utf8')
  assert.match(rawText, /inventory-export-context-2026-04-30-120000\.csv/)
  assert.match(rawText, /inventory-stats-2026-04-30-120000\.csv/)
  assert.match(rawText, /inventory-calculations-2026-04-30-120000\.csv/)
  assert.match(rawText, /inventory-manifest-2026-04-30-120000\.csv/)
  assert.match(rawText, /inventory-report\.html/)
  assert.match(rawText, /Inventory report/)
})

if (failed > 0) {
  process.exitCode = 1
}
