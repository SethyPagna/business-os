import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildZip, buildZipInWorker } from '../src/utils/csv.ts'
import { buildReportManifestRows, buildReportPackageFiles } from '../src/utils/exportPackage.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

// Minimal local-only ZIP reader for these tests -- buildZip now compresses
// entries with deflate (falling back to stored per-file when that doesn't
// help), so a raw-bytes substring check no longer proves anything about the
// actual file content. This reads each local file entry's name + method +
// sizes straight from the header layout buildZip writes, and decompresses
// with the runtime's own DecompressionStream when the entry used deflate --
// the same API zipReader.ts uses server-side to read these same two methods.
async function readZipEntries(blob: Blob): Promise<Array<{ name: string; content: string }>> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries: Array<{ name: string; content: string }> = []
  let offset = 0
  const decoder = new TextDecoder()
  while (offset < bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const uncompressedSize = view.getUint32(offset + 22, true)
    const nameLength = view.getUint16(offset + 26, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength
    const name = decoder.decode(bytes.subarray(nameStart, dataStart))
    const compressedBytes = bytes.subarray(dataStart, dataStart + compressedSize)
    let contentBytes: Uint8Array
    if (method === 8) {
      const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      contentBytes = new Uint8Array(await new Response(stream).arrayBuffer())
    } else {
      contentBytes = compressedBytes
    }
    assert.equal(contentBytes.length, uncompressedSize, `${name} decompresses to its recorded uncompressed size`)
    entries.push({ name, content: decoder.decode(contentBytes) })
    offset = dataStart + compressedSize
  }
  return entries
}

async function runTest(name: string, fn: TestCallback): Promise<void> {
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

  const zipBlob = await buildZip(files)
  assert.ok(zipBlob)
  const entries = await readZipEntries(zipBlob)
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.content]))
  assert.ok('inventory-export-context-2026-04-30-120000.csv' in byName)
  assert.ok('inventory-stats-2026-04-30-120000.csv' in byName)
  assert.ok('inventory-calculations-2026-04-30-120000.csv' in byName)
  assert.ok('inventory-manifest-2026-04-30-120000.csv' in byName)
  assert.ok('inventory-report.html' in byName)
  assert.match(byName['inventory-report.html'], /Inventory report/)
})

await runTest('zip builder supports row-based export descriptors', async () => {
  const zipBlob = await buildZip([
    {
      filename: 'contacts-customers.csv',
      rows: [
        { Name: 'Leang', Phone: '123' },
        { Name: 'Sophea', Phone: '456' },
      ],
    },
  ])

  assert.ok(zipBlob)
  const entries = await readZipEntries(zipBlob)
  const entry = entries.find((item) => item.name === 'contacts-customers.csv')
  assert.ok(entry, 'contacts-customers.csv entry is present')
  assert.match(entry.content, /Name,Phone/)
  assert.match(entry.content, /Leang,123/)
})

await runTest('zip builder compresses text content smaller than storing it raw', async () => {
  // A repetitive CSV is exactly the shape deflate should shrink a lot --
  // this is the actual point of switching off STORE-only, so assert the
  // size win directly rather than just that the round-trip still works.
  const repeatedRow = 'Name,Phone,Address,Notes\n'
    + Array.from({ length: 200 }, (_, index) => `Customer ${index},012345678${index % 10},123 Main Street,Regular customer with a long note field`).join('\n')
  const zipBlob = await buildZip([{ name: 'big-contacts.csv', content: repeatedRow }])
  assert.ok(zipBlob)
  const uncompressedSize = new TextEncoder().encode(repeatedRow).length
  assert.ok(zipBlob.size < uncompressedSize, 'a large repetitive CSV comes out smaller than its own raw content once zip overhead is included')
  const entries = await readZipEntries(zipBlob)
  assert.equal(entries[0]?.content, repeatedRow, 'decompresses back to byte-identical content')
})

await runTest('zip worker path keeps a synchronous fallback oracle', async () => {
  const zipBlob = await buildZipInWorker([
    { name: 'fallback.csv', content: 'A,B\n1,2' },
  ], { timeoutMs: 10 })

  assert.ok(zipBlob)
  const entries = await readZipEntries(zipBlob)
  assert.ok(entries.some((entry) => entry.name === 'fallback.csv' && entry.content === 'A,B\n1,2'))

  const csvSource = fs.readFileSync(new URL('../src/utils/csv.ts', import.meta.url), 'utf8')
  const workerSource = fs.readFileSync(new URL('../src/utils/csvExportWorker.ts', import.meta.url), 'utf8')
  assert.match(csvSource, /new Worker\(new URL\('\.\/csvExportWorker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/)
  assert.match(csvSource, /finish\(buildZip\(files\)\)/)
  assert.match(csvSource, /ZIP_EXPORT_WORKER_TIMEOUT_MS = 30000/)
  assert.match(workerSource, /import \{ buildZip \} from '\.\/csv\.ts'/)
})

if (failed > 0) {
  process.exitCode = 1
}
