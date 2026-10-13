// D1 (OPUS-SECURITY-AUDIT-WHOLE-APP): SheetJS 0.18.5 has prototype-pollution
// and ReDoS advisories and no fixed npm release, so an untrusted .xlsx/.xls
// must never be parsed on the UI thread. Every read of one happens inside a
// per-file module worker that is terminated after the result, a timeout or a
// cancel; the main thread only ever receives a string.
//
// This file is the source-level half of that guarantee (the behavioural half is
// spreadsheetWorkerParse.test.ts). It reads files and imports nothing under
// test, so it is meaningful against any revision of the import path.
//
// Run: node tests/spreadsheetWorkerIsolation.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const importSource = stripComments(fs.readFileSync(path.join(srcRoot, 'utils', 'spreadsheetImport.ts'), 'utf8'))

check('the main-thread import module never reads a workbook', () => {
  assert.doesNotMatch(importSource, /\bXLSX\.(?:read|readFile|readSync)\b/, 'XLSX.read must not run on the UI thread')
  assert.doesNotMatch(importSource, /\bsheet_to_(?:json|csv|txt|html|formulae)\b/, 'no SheetJS sheet conversion on the UI thread')
  assert.doesNotMatch(importSource, /from\s+['"]xlsx['"]|import\(\s*['"]xlsx['"]\s*\)|require\(\s*['"]xlsx['"]\s*\)/, 'the UI-thread module must not load SheetJS at all')
})

check('the import module parses through a per-file module worker', () => {
  assert.ok(
    importSource.includes("new Worker(new URL('./spreadsheetParse.worker.ts', import.meta.url), { type: 'module' })"),
    'the worker is created with the literal form Vite bundles as its own chunk',
  )
  assert.match(importSource, /\.terminate\(\)/, 'the worker is terminated')
  assert.match(importSource, /setTimeout\(/, 'a timeout bounds the parse')
})

check('only the worker side reads workbooks; only the exporter and worker side load SheetJS', () => {
  const readers: string[] = []
  const loaders: string[] = []
  for (const file of walk(srcRoot)) {
    const relative = path.relative(srcRoot, file).replace(/\\/g, '/')
    const source = stripComments(fs.readFileSync(file, 'utf8'))
    if (/\bXLSX\.(?:read|readFile|readSync)\s*\(/.test(source)) readers.push(relative)
    if (/from\s+['"]xlsx['"]|import\(\s*['"]xlsx['"]\s*\)/.test(source)) loaders.push(relative)
  }
  assert.deepEqual(readers, ['utils/spreadsheetWorkbook.ts'], `workbook reads: ${readers.join(', ')}`)
  assert.deepEqual(loaders.sort(), ['utils/spreadsheetWorkbook.ts', 'utils/xlsxExport.ts'], `SheetJS importers: ${loaders.join(', ')}`)
})

check('the worker entry is a thin adapter over the workbook module', () => {
  const worker = stripComments(fs.readFileSync(path.join(srcRoot, 'utils', 'spreadsheetParse.worker.ts'), 'utf8'))
  assert.match(worker, /addEventListener\(\s*'message'/)
  assert.match(worker, /from\s+'\.\/spreadsheetWorkbook\.ts'/)
  assert.doesNotMatch(worker, /from\s+'react|document\.|window\./, 'a worker has no DOM and no React')
})

check('a refused Excel file reaches the person in every import dialog (nothing hangs or fails silently)', () => {
  const dialogs = stripComments(fs.readFileSync(path.join(srcRoot, 'api', 'browserDialogs.ts'), 'utf8'))
  assert.match(dialogs, /try \{\s*resolve\(await parseImportFile\(file\)\)\s*\} catch \(error\) \{\s*reject\(error\)/, 'the file picker rejects instead of leaving its promise pending')

  const surfaces: [string, RegExp][] = [
    ['components/sales/SalesImportModal.tsx', /notifyReadFailed = \(error: unknown\): void => \{\s*notify\(/],
    ['components/sales/SalesImportModal.tsx', /handlePickFile = \(\) => readImportFile\(\s*async \(\) => getImportApi\(\)\.openCSVDialog\?\.\(\),[\s\S]{0,300}notifyReadFailed,\s*\)/],
    ['components/sales/SalesImportModal.tsx', /handleDropFile = async \(file: File\) => readImportFile\(\s*\(signal\) => parseImportFile\(file, undefined, \{ signal \}\),[\s\S]{0,300}notifyReadFailed,\s*\)/],
    ['components/inventory/InventoryImportModal.tsx', /notifyReadFailed = \(error: unknown\): void => \{\s*notify\(/],
    ['components/inventory/InventoryImportModal.tsx', /handlePickFile = \(\) => readImportFile\(\s*async \(\) => getImportApi\(\)\.openCSVDialog\?\.\(\),[\s\S]{0,300}notifyReadFailed,\s*\)/],
    ['components/inventory/InventoryImportModal.tsx', /handleDropFile = async \(file: File\) => readImportFile\(\s*\(signal\) => parseImportFile\(file, undefined, \{ signal \}\),[\s\S]{0,300}notifyReadFailed,\s*\)/],
    ['components/contacts/ContactImportModal.tsx', /notifyReadFailed = \(error: unknown\): void => \{\s*notify\(/],
    ['components/contacts/ContactImportModal.tsx', /handlePickFile = \(\): Promise<void> => readImportFile\(\s*async \(\) => getContactImportApi\(\)\.openCSVDialog\?\.\(\),[\s\S]{0,300}notifyReadFailed,\s*\)/],
    ['components/contacts/ContactImportModal.tsx', /handleDropFile = async \(file: File\): Promise<void> => readImportFile\(\s*\(signal\) => parseImportFile\(file, undefined, \{ signal \}\),[\s\S]{0,300}notifyReadFailed,\s*\)/],
    ['components/products/import/BulkImportModal.tsx', /handlePickCSV = async \(\) => \{[\s\S]{0,200}try \{\s*const picked = await getProductImportApi\(\)\.openCSVDialog\(\)[\s\S]{0,300}\} catch \(error\) \{\s*notify\(/],
    ['components/products/import/BulkImportModal.tsx', /handleDropCSV = async \(file: File\) => \{[\s\S]{0,200}try \{\s*const parsed = await parseImportFile\(file\)[\s\S]{0,400}\} catch \(error\) \{\s*notify\(/],
    ['components/products/import/ImportHub.tsx', /try \{\s*const parsed = await parseImportFile\(file\)[\s\S]{0,900}\} catch \(error\) \{\s*entries\.push\(\{[\s\S]{0,200}status: 'error', error: error instanceof Error \? error\.message/],
    ['components/products/import/StockActionImportModal.tsx', /try \{\s*const parsed = await parseImportFile\(file\)[\s\S]{0,400}\} catch \(err\) \{\s*setError\(err instanceof Error \? err\.message/],
    ['components/products/import/DatedStockReconciliationModal.tsx', /try \{\s*const result = await openCSVDialog\(\)[\s\S]{0,900}\} catch \(e\) \{\s*setError\(e instanceof Error \? e\.message/],
  ]
  for (const [relative, pattern] of surfaces) {
    const source = stripComments(fs.readFileSync(path.join(srcRoot, relative), 'utf8'))
    assert.match(source, pattern, `${relative}: ${pattern.source.slice(0, 60)}`)
  }
})

check('a file still being read holds the Inventory, Sales and Contacts dialogs still (SF-1)', () => {
  const source = (relative: string) => stripComments(fs.readFileSync(path.join(srcRoot, relative), 'utf8'))
  const hook = source('components/shared/useImportFileRead.ts')
  assert.match(hook, /useSyncExternalStore\(subscribeToImportFileReads, isImportFileReadInFlight\)/, 'the busy flag comes from the file-read store, which also covers the native picker')
  assert.match(hook, /useEffect\(\(\) => gate\.cancel, \[gate\]\)/, 'closing the dialog cancels the read in flight')

  const inventory = source('components/inventory/InventoryImportModal.tsx')
  assert.match(inventory, /const \{ readingFile, read: readImportFile, cancel: cancelFileRead \} = useImportFileRead\(\)/)
  assert.match(inventory, /if \(nextAction === inventoryAction\) return\s*cancelFileRead\(\)\s*setInventoryAction\(nextAction\)/, 'switching the action drops a file still being read')
  assert.match(inventory, /disabled=\{loading \|\| readingFile\}/, 'the action chips are held')
  assert.match(inventory, /loading=\{readingFile\}/, 'the file picker and drop zone are held')
  assert.match(inventory, /disabled=\{loading \|\| analyzingCsv \|\| readingFile \|\|/, 'Import is held')

  const sales = source('components/sales/SalesImportModal.tsx')
  assert.match(sales, /const \{ readingFile, read: readImportFile \} = useImportFileRead\(\)/)
  assert.match(sales, /loading=\{readingFile\}/)
  assert.match(sales, /disabled=\{loading \|\| analyzingCsv \|\| readingFile \|\|/)

  const contacts = source('components/contacts/ContactImportModal.tsx')
  assert.match(contacts, /const \{ readingFile, read: readImportFile \} = useImportFileRead\(\)/)
  assert.match(contacts, /onClick=\{handlePickFile\} disabled=\{readingFile\}/)
  assert.match(contacts, /onClick=\{\(\) => setFilesOpen\(true\)\} disabled=\{readingFile\}/, 'the Library picker cannot race a file being read')
  assert.equal((contacts.match(/if \(loading \|\| readingFile\) return/g) || []).length, 3, 'the three drop-zone handlers ignore input while reading')
  assert.match(contacts, /disabled=\{!canImportContacts \|\| loading \|\| analyzingCsv \|\| readingFile \|\| !rowCount\}/)
})

console.log(`ALL PASS spreadsheetWorkerIsolation (${passed} checks)`)
