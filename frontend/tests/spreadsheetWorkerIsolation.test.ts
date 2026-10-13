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

console.log(`ALL PASS spreadsheetWorkerIsolation (${passed} checks)`)
