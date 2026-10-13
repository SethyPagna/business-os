// D1 (OPUS-SECURITY-AUDIT-WHOLE-APP): an imported .xlsx/.xls is parsed by
// SheetJS 0.18.5 (prototype-pollution and ReDoS advisories) only inside a
// per-file worker that is terminated after the result, a timeout or a cancel,
// and only a string crosses back. This is the behavioural half;
// spreadsheetWorkerIsolation.test.ts is the source half.
//
// The browser's Worker is replaced by a node:worker_threads adapter that runs
// the REAL src/utils/spreadsheetParse.worker.ts (real SheetJS, real structured
// clone, real transfer, real terminate), so the worker file itself is what is
// under test, not a replica of it.
//
// Run: node tests/spreadsheetWorkerParse.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker as NodeWorker } from 'node:worker_threads'
import * as XLSX from 'xlsx'
import {
  SPREADSHEET_FAILURES,
  SPREADSHEET_MAX_BYTES,
  isImportFileReadInFlight,
  parseImportFile,
  parseSpreadsheetInWorker,
  readSpreadsheetReply,
  spreadsheetParseTimeoutMs,
  subscribeToImportFileReads,
} from '../src/utils/spreadsheetImport.ts'
import type { SpreadsheetWorkerHandle } from '../src/utils/spreadsheetImport.ts'
import { parseCsvRows } from '../src/utils/csvImport.ts'
import { workbookToDelimitedText } from '../src/utils/spreadsheetWorkbook.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const workerEntry = pathToFileURL(path.join(here, '..', 'src', 'utils', 'spreadsheetParse.worker.ts')).href
const enPack = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'en.json'), 'utf8')) as Record<string, string>
const kmPack = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>

const prototypeKeysBefore = Object.getOwnPropertyNames(Object.prototype).sort().join()

let passed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const BROWSER_SHIM = `
const { parentPort, workerData } = require('node:worker_threads')
globalThis.self = {
  addEventListener(type, listener) { parentPort.on('message', (data) => listener({ data })) },
  postMessage(message) { parentPort.postMessage(message) },
}
import(workerData.entry)
`

type Spawned = { handle: SpreadsheetWorkerHandle & { terminated: boolean }; exited: Promise<number> }
const spawned: Spawned[] = []

function adapt(code: string, workerData?: unknown): () => SpreadsheetWorkerHandle {
  return () => {
    const worker = new NodeWorker(code, { eval: true, workerData })
    const handle = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      onmessageerror: null as ((event: unknown) => void) | null,
      terminated: false,
      postMessage(message: unknown, transfer?: Transferable[]) { worker.postMessage(message, transfer as never) },
      terminate() { handle.terminated = true; void worker.terminate() },
    }
    worker.on('message', (data) => handle.onmessage?.({ data }))
    worker.on('error', (error) => handle.onerror?.({ error }))
    worker.on('messageerror', (error) => handle.onmessageerror?.({ error }))
    const exited = new Promise<number>((resolve) => worker.once('exit', resolve))
    spawned.push({ handle: handle as unknown as Spawned['handle'], exited })
    return handle as unknown as SpreadsheetWorkerHandle
  }
}

const realWorker = adapt(BROWSER_SHIM, { entry: workerEntry })
const hangingWorker = adapt('setInterval(() => {}, 1000)')

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => Promise.race([
  promise,
  new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms)),
])

function failureOf(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  return promise.then(
    () => { throw new Error('expected a rejection') },
    (error) => error as Error & { code?: string },
  )
}

const text = (v: string): XLSX.CellObject => ({ t: 's', v })

function sheetFrom(rows: XLSX.CellObject[][]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {}
  rows.forEach((row, r) => row.forEach((cell, c) => { sheet[XLSX.utils.encode_cell({ r, c })] = cell }))
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: Math.max(...rows.map((row) => row.length)) - 1 } })
  return sheet
}

function fixtureBytes(): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheetFrom([
    [text('name'), text('barcode'), text('qty'), text('padded'), text('big'), text('date'), text('flag'), text('note')],
    [
      text('ស្តុកចូល Serum'), { t: 's', v: '0123456789012', z: '@' }, { t: 'n', v: -5 },
      { t: 'n', v: 748485110011, z: '0000000000000' }, { t: 'n', v: 8850006330012 },
      { t: 'd', v: new Date(2026, 8, 1) }, { t: 'b', v: true }, text('=SUM(A1)'),
    ],
    [],
    [text('He said "hi", ok'), text('line one\nline two'), { t: 'n', v: 3.5 }, { t: 'b', v: false }, text(''), text(''), text(''), text('end')],
  ]), 'Products')
  XLSX.utils.book_append_sheet(workbook, sheetFrom([
    [text('sku'), text('stock')],
    [text('B-1'), { t: 'n', v: 12 }],
  ]), 'Second')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true, cellDates: true }) as ArrayBuffer
}

function oldMainThreadParse(bytes: ArrayBuffer, sheetName?: string): string {
  return workbookToDelimitedText(XLSX.read(bytes, { type: 'array', cellDates: true }), sheetName)
}

const fileOf = (bytes: ArrayBuffer | Uint8Array | string, name: string) => new File([bytes as BlobPart], name)

const HUGE_SPAN_WORKBOOK = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="S"><Table>
<Row><Cell><Data ss:Type="String">a</Data></Cell></Row>
<Row ss:Index="1048576"><Cell ss:Index="16384"><Data ss:Type="String">z</Data></Cell></Row>
</Table></Worksheet></Workbook>`

await check('a real workbook parsed through the worker equals the old main-thread parse, byte for byte', async () => {
  const bytes = fixtureBytes()
  const expected = oldMainThreadParse(bytes.slice(0))
  const secondExpected = oldMainThreadParse(bytes.slice(0), 'Second')
  assert.notEqual(expected, secondExpected, 'the fixture has two distinguishable sheets')

  const parsed = await parseImportFile(fileOf(bytes.slice(0), 'fixture.xlsx'), undefined, { createWorker: realWorker })
  assert.equal(parsed.name, 'fixture.xlsx')
  assert.equal(parsed.content, expected)
  const second = await parseImportFile(fileOf(bytes.slice(0), 'fixture.xlsx'), 'Second', { createWorker: realWorker })
  assert.equal(second.content, secondExpected, 'sheetName still selects the sheet')
  const missing = await parseImportFile(fileOf(bytes.slice(0), 'fixture.xlsx'), 'No such sheet', { createWorker: realWorker })
  assert.equal(missing.content, expected, 'an unknown sheet name still falls back to the first sheet')

  const lines = parsed.content.split('\n')
  assert.equal(lines[0], 'name,barcode,qty,padded,big,date,flag,note')
  assert.ok(parsed.content.includes('ស្តុកចូល Serum'), 'Khmer text is untouched')
  assert.ok(lines[1].includes(',0123456789012,'), 'a Text barcode keeps its leading zero')
  assert.ok(lines[1].includes(',-5,'), 'a negative quantity is not apostrophe-mangled')
  assert.ok(lines[1].includes(',0748485110011,'), 'a zero-padded numeric barcode keeps its leading zero')
  assert.ok(lines[1].includes(',8850006330012,'), 'a 13-digit numeric barcode is plain digits')
  assert.match(lines[1], /,\d{4}-\d{2}-\d{2},/, 'a date cell becomes a calendar date')
  assert.ok(lines[1].includes(',TRUE,'), 'booleans are TRUE/FALSE')
  assert.ok(lines[1].endsWith(',=SUM(A1)'), 'a formula-looking string is carried literally')
  assert.equal(parseCsvRows(parsed.content).length, 2, 'the blank row is skipped')
  assert.ok(parsed.content.endsWith('"He said ""hi"", ok","line one\nline two",3.5,FALSE,,,,end'), 'commas, quotes and newlines are machine-quoted')
})

await check('the parse leaves the UI thread untouched: Object.prototype is unchanged and the bytes were transferred', async () => {
  const bytes = fixtureBytes()
  const sent: { transfer: unknown }[] = []
  const factory = (): SpreadsheetWorkerHandle => {
    const inner = realWorker()
    const original = inner.postMessage.bind(inner)
    inner.postMessage = ((message: unknown, transfer?: unknown) => { sent.push({ transfer }); original(message, transfer as never) }) as SpreadsheetWorkerHandle['postMessage']
    return inner
  }
  const content = await parseSpreadsheetInWorker(bytes, undefined, { createWorker: factory })
  assert.equal(typeof content, 'string')
  assert.equal(bytes.byteLength, 0, 'the file bytes were transferred to the worker, not copied')
  assert.equal(Array.isArray(sent[0]?.transfer) && sent[0].transfer.length, 1)
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(), prototypeKeysBefore)
})

await check('the worker is terminated after a result and after a failure', async () => {
  const before = spawned.length
  await parseSpreadsheetInWorker(fixtureBytes(), undefined, { createWorker: realWorker })
  const ok = spawned[before]
  assert.equal(ok.handle.terminated, true)
  assert.equal(await withTimeout(ok.exited, 15_000, 'worker exit'), 1, 'terminate() ends the thread')

  const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).buffer
  const error = await failureOf(parseSpreadsheetInWorker(garbage, undefined, { createWorker: realWorker }))
  assert.equal(error.code, SPREADSHEET_FAILURES.unreadable.key)
  assert.equal(error.message, enPack[SPREADSHEET_FAILURES.unreadable.key])
  const failed = spawned[spawned.length - 1]
  assert.equal(failed.handle.terminated, true)
  await withTimeout(failed.exited, 15_000, 'worker exit')
})

await check('a workbook that would freeze the UI thread is stopped by the timeout and its worker killed', async () => {
  const nearbyCells = HUGE_SPAN_WORKBOOK.replace('<Row ss:Index="1048576"><Cell ss:Index="16384">', '<Row><Cell>')
  const control = await parseImportFile(fileOf(new TextEncoder().encode(nearbyCells), 'near.xls'), undefined, { createWorker: realWorker })
  assert.equal(control.content, 'a\nz', 'the same file with its far cell moved next to the other parses at once')

  const bytes = new TextEncoder().encode(HUGE_SPAN_WORKBOOK)
  const started = Date.now()
  const error = await failureOf(parseImportFile(fileOf(bytes, 'span.xls'), undefined, { createWorker: realWorker, timeoutMs: 3_000 }))
  assert.equal(error.code, SPREADSHEET_FAILURES.timeout.key)
  assert.equal(error.message, enPack[SPREADSHEET_FAILURES.timeout.key])
  assert.ok(Date.now() - started < 30_000, 'the main thread got control back')
  const worker = spawned[spawned.length - 1]
  assert.equal(worker.handle.terminated, true)
  await withTimeout(worker.exited, 15_000, 'killed worker exit')
})

await check('a worker that never answers times out, is terminated, and reports the timeout message', async () => {
  const error = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: hangingWorker, timeoutMs: 150 }))
  assert.equal(error.code, 'spreadsheet_import_timeout')
  const worker = spawned[spawned.length - 1]
  assert.equal(worker.handle.terminated, true)
  await withTimeout(worker.exited, 15_000, 'hung worker exit')
})

await check('cancelling terminates the worker; an already-cancelled import never creates one', async () => {
  const controller = new AbortController()
  const pending = failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: hangingWorker, signal: controller.signal, timeoutMs: 60_000 }))
  setTimeout(() => controller.abort(), 100)
  const error = await pending
  assert.equal(error.name, 'AbortError')
  const worker = spawned[spawned.length - 1]
  assert.equal(worker.handle.terminated, true)
  await withTimeout(worker.exited, 15_000, 'cancelled worker exit')

  let created = 0
  const aborted = new AbortController()
  aborted.abort()
  const early = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, {
    signal: aborted.signal,
    createWorker: () => { created += 1; return hangingWorker() },
  }))
  assert.equal(early.name, 'AbortError')
  assert.equal(created, 0)
})

await check('with no Worker available an Excel file is refused with the translated message, never parsed inline', async () => {
  assert.equal(typeof (globalThis as { Worker?: unknown }).Worker, 'undefined', 'this runtime has no browser Worker, like a very old iOS')
  const error = await failureOf(parseImportFile(fileOf(fixtureBytes(), 'fixture.xlsx')))
  assert.equal(error.code, SPREADSHEET_FAILURES.unavailable.key)
  assert.equal(error.message, enPack[SPREADSHEET_FAILURES.unavailable.key])

  const throwing = await failureOf(parseSpreadsheetInWorker(fixtureBytes(), undefined, { createWorker: () => { throw new Error('SecurityError') } }))
  assert.equal(throwing.code, SPREADSHEET_FAILURES.unavailable.key)
})

await check('a worker that fails to start, fails to receive, or sends malformed data is a clean refusal', async () => {
  const handleOf = (setup: (handle: { onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onmessageerror: ((e: unknown) => void) | null }) => void, postThrows = false) => () => {
    const handle = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      onmessageerror: null as ((e: unknown) => void) | null,
      terminated: 0,
      postMessage() { if (postThrows) throw new Error('DataCloneError'); queueMicrotask(() => setup(handle)) },
      terminate() { handle.terminated += 1 },
    }
    created.push(handle)
    return handle as unknown as SpreadsheetWorkerHandle
  }
  const created: { terminated: number }[] = []

  const loadFailure = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: handleOf((h) => h.onerror?.({})) }))
  assert.equal(loadFailure.code, 'spreadsheet_import_load_failed')
  const postFailure = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: handleOf(() => {}, true) }))
  assert.equal(postFailure.code, 'spreadsheet_import_unavailable')
  const cloneFailure = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: handleOf((h) => h.onmessageerror?.({})) }))
  assert.equal(cloneFailure.code, 'spreadsheet_import_unreadable')
  const errorReply = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: handleOf((h) => h.onmessage?.({ data: { type: 'error' } })) }))
  assert.equal(errorReply.code, 'spreadsheet_import_unreadable')
  const malformed = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: handleOf((h) => h.onmessage?.({ data: 'not a reply' })) }))
  assert.equal(malformed.code, 'spreadsheet_import_unreadable')
  assert.ok(created.every((handle) => handle.terminated === 1), 'every one of them was terminated exactly once')
})

await check('a worker file that fails to load asks for a reload, which is not the "browser cannot run workers" message', async () => {
  const missing = adapt("import('file:///no/such/spreadsheetParse.worker.mjs')")
  const error = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: missing }))
  assert.equal(error.code, 'spreadsheet_import_load_failed')
  assert.equal(error.message, enPack.spreadsheet_import_load_failed)
  assert.match(enPack.spreadsheet_import_load_failed, /reload/i)
  assert.notEqual(enPack.spreadsheet_import_load_failed, enPack.spreadsheet_import_unavailable)
  const worker = spawned[spawned.length - 1]
  assert.equal(worker.handle.terminated, true)
  await withTimeout(worker.exited, 15_000, 'failed worker exit')
})

await check('a file over the size cap is refused before it is read or a worker is made', async () => {
  assert.equal(SPREADSHEET_MAX_BYTES, 25 * 1024 * 1024, 'the cap matches the 25 MB upload cap')
  assert.match(enPack.spreadsheet_import_too_large, /25 MB/)
  assert.match(kmPack.spreadsheet_import_too_large, /25 MB/)
  let read = 0
  let created = 0
  const huge = { name: 'huge.xlsx', size: SPREADSHEET_MAX_BYTES + 1, arrayBuffer() { read += 1; return Promise.resolve(new ArrayBuffer(8)) } } as unknown as File
  const error = await failureOf(parseImportFile(huge, undefined, { createWorker: () => { created += 1; return hangingWorker() } }))
  assert.equal(error.code, 'spreadsheet_import_too_large')
  assert.equal(error.message, enPack.spreadsheet_import_too_large)
  assert.equal(read, 0, 'the oversized file was never read into memory')
  assert.equal(created, 0)

  const bytesError = await failureOf(parseSpreadsheetInWorker(new ArrayBuffer(SPREADSHEET_MAX_BYTES + 1), undefined, { createWorker: () => { created += 1; return hangingWorker() } }))
  assert.equal(bytesError.code, 'spreadsheet_import_too_large')
  assert.equal(created, 0)
  let madeAtCap = 0
  const atCapAbort = new AbortController()
  const atCapBytes = parseSpreadsheetInWorker(new ArrayBuffer(SPREADSHEET_MAX_BYTES), undefined, { signal: atCapAbort.signal, createWorker: () => { madeAtCap += 1; return hangingWorker() } })
  assert.equal(madeAtCap, 1, 'bytes exactly at the cap are handed to a worker')
  atCapAbort.abort()
  await failureOf(atCapBytes)


  const atCap = { name: 'edge.xlsx', size: SPREADSHEET_MAX_BYTES, arrayBuffer() { return Promise.resolve(fixtureBytes()) } } as unknown as File
  const parsed = await parseImportFile(atCap, undefined, { createWorker: realWorker })
  assert.ok(parsed.content.startsWith('name,barcode,qty'), 'a file exactly at the cap is accepted')

  const bigCsv = { name: 'big.csv', size: SPREADSHEET_MAX_BYTES * 2, arrayBuffer() { return Promise.resolve(new TextEncoder().encode('a,b\n1,2\n').buffer) } } as unknown as File
  assert.equal((await parseImportFile(bigCsv)).content, 'a,b\n1,2\n', 'the cap is for Excel files only')
})

await check('the in-flight read flag is up while a file is read and down after a result, a failure or a refusal', async () => {
  const seen: boolean[] = []
  const unsubscribe = subscribeToImportFileReads(() => seen.push(isImportFileReadInFlight()))
  assert.equal(isImportFileReadInFlight(), false)
  const pending = parseImportFile(fileOf(fixtureBytes(), 'fixture.xlsx'), undefined, { createWorker: realWorker })
  assert.equal(isImportFileReadInFlight(), true, 'up as soon as the read starts')
  await pending
  assert.equal(isImportFileReadInFlight(), false)

  await failureOf(parseImportFile(fileOf(fixtureBytes(), 'fixture.xlsx')))
  assert.equal(isImportFileReadInFlight(), false, 'down after a refusal')
  await failureOf(parseImportFile(fileOf(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), 'broken.xlsx'), undefined, { createWorker: realWorker }))
  assert.equal(isImportFileReadInFlight(), false, 'down after a failed parse')
  await parseImportFile(fileOf('a,b\n', 'x.csv'))
  assert.equal(isImportFileReadInFlight(), false, 'down after a CSV')

  const overlapping = [
    parseImportFile(fileOf(fixtureBytes(), 'one.xlsx'), undefined, { createWorker: realWorker }),
    parseImportFile(fileOf(fixtureBytes(), 'two.xlsx'), undefined, { createWorker: realWorker }),
  ]
  await overlapping[0]
  await overlapping[1]
  assert.equal(isImportFileReadInFlight(), false, 'two overlapping reads both release it')
  unsubscribe()
  assert.equal(seen[0], true)
  assert.equal(seen[seen.length - 1], false)
  const afterUnsubscribe = seen.length
  await parseImportFile(fileOf('a\n', 'y.csv'))
  assert.equal(seen.length, afterUnsubscribe, 'an unsubscribed listener hears nothing')
})

await check('a late second message cannot settle a finished import twice', async () => {
  const handles: { terminated: number }[] = []
  const factory = () => {
    const handle = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null,
      onmessageerror: null,
      terminated: 0,
      postMessage(message: { id: string }) {
        queueMicrotask(() => {
          handle.onmessage?.({ data: { id: message.id, type: 'result', content: 'first' } })
          handle.onmessage?.({ data: { id: message.id, type: 'result', content: 'second' } })
        })
      },
      terminate() { handle.terminated += 1 },
    }
    handles.push(handle)
    return handle as unknown as SpreadsheetWorkerHandle
  }
  assert.equal(await parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: factory }), 'first')
  assert.equal(handles[0].terminated, 1)
})

await check('a result is re-validated as plain data: extra keys, __proto__ and constructor never cross', () => {
  const hostile = JSON.parse('{"id":"x","type":"result","content":"a,b\\n1,2","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototype":{"polluted":"yes"},"extra":1}') as unknown
  assert.ok(Object.prototype.hasOwnProperty.call(hostile, '__proto__'), 'the fixture really carries an own __proto__ key')
  const clean = readSpreadsheetReply(hostile, 'x')
  assert.deepEqual(clean, { content: 'a,b\n1,2' })
  assert.deepEqual(Object.keys(clean as object), ['content'])
  assert.equal(Object.getPrototypeOf(clean), Object.prototype)
  assert.equal(Object.prototype.hasOwnProperty.call(clean, '__proto__'), false)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)

  for (const bad of [
    null, undefined, 'text', 42, [], () => {},
    { id: 'y', type: 'result', content: 'wrong id' },
    { id: 'x', type: 'error', content: 'wrong type' },
    { id: 'x', type: 'result' },
    { id: 'x', type: 'result', content: { rows: [] } },
    { id: 'x', type: 'result', content: ['a'] },
    { id: 'x', type: 'result', content: () => 'a' },
    Object.create({ id: 'x', type: 'result', content: 'inherited fields do not count' }),
  ]) assert.equal(readSpreadsheetReply(bad, 'x'), null, `rejects ${typeof bad}`)
})

await check('a worker whose realm is polluted and that sends hostile keys cannot reach this thread', async () => {
  const polluting = `
    const { parentPort } = require('node:worker_threads')
    Object.prototype.polluted = 'yes'
    parentPort.on('message', (message) => {
      parentPort.postMessage(JSON.parse('{"id":"' + message.id + '","type":"result","content":"a,b\\\\n1,2","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}'))
    })
  `
  const content = await parseSpreadsheetInWorker(new ArrayBuffer(8), undefined, { createWorker: adapt(polluting) })
  assert.equal(content, 'a,b\n1,2')
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'the pollution stayed in the dead worker')
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(), prototypeKeysBefore)
})

await check('hostile sheet and cell names parse to plain text without touching this realm', async () => {
  const xml = HUGE_SPAN_WORKBOOK
    .replace('ss:Name="S"', 'ss:Name="__proto__"')
    .replace('<Row ss:Index="1048576"><Cell ss:Index="16384"><Data ss:Type="String">z</Data></Cell></Row>', '<Row><Cell><Data ss:Type="String">constructor</Data></Cell><Cell><Data ss:Type="String">__proto__</Data></Cell></Row>')
  const parsed = await parseImportFile(fileOf(new TextEncoder().encode(xml), 'proto.xls'), undefined, { createWorker: realWorker })
  assert.equal(parsed.content, 'a,\nconstructor,__proto__')
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(), prototypeKeysBefore)
})

await check('CSV and TSV never touch a worker', async () => {
  let created = 0
  const options = { createWorker: () => { created += 1; return hangingWorker() } }
  const csv = await parseImportFile(fileOf('name,qty\nស្តុក,3\n', 'stock.csv'), undefined, options)
  assert.equal(csv.content, 'name,qty\nស្តុក,3\n')
  const tsv = await parseImportFile(fileOf('a\tb\n1\t2\n', 'x.tsv'), undefined, options)
  assert.equal(tsv.content, 'a\tb\n1\t2\n')
  assert.equal(created, 0)
})

await check('the time allowed grows with the file and is capped', () => {
  assert.equal(spreadsheetParseTimeoutMs(0), 20_000)
  assert.equal(spreadsheetParseTimeoutMs(1), 23_000)
  assert.equal(spreadsheetParseTimeoutMs(1_048_576), 23_000)
  assert.equal(spreadsheetParseTimeoutMs(10 * 1_048_576), 50_000)
  assert.equal(spreadsheetParseTimeoutMs(500 * 1_048_576), 120_000)
})

await check('the refusal messages exist in both language packs and the English fallback equals the pack', () => {
  for (const failure of Object.values(SPREADSHEET_FAILURES)) {
    assert.equal(enPack[failure.key], failure.english, `${failure.key}: the in-code English equals en.json`)
    assert.ok(kmPack[failure.key] && kmPack[failure.key] !== enPack[failure.key], `${failure.key}: km.json has its own text`)
    assert.match(kmPack[failure.key], /[ក-៿]/, `${failure.key}: km.json is Khmer`)
  }
})

await Promise.all(spawned.map((entry) => withTimeout(entry.exited, 20_000, 'every worker to exit')))
assert.ok(spawned.length > 8, 'the suite really spawned workers')
console.log(`ALL PASS spreadsheetWorkerParse (${passed} checks, ${spawned.length} workers spawned and reaped)`)
