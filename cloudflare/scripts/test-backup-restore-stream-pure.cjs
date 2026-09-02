// Tests for lib/backupRestoreStream.ts -- the streaming reader that lets
// restore apply a backup one row at a time instead of loading the whole
// document into memory (progress.md 10.1). The write path already streams; a
// database big enough to have OOMed the backup would OOM restoring it, which
// is the worse failure.
//
// The scanner's safety contract, which these tests pin:
//   1. It reads the SAME bytes the writer emits (a row is JSON.stringify(row),
//      rows comma-separated inside "rows":[...]), for EVERY table.
//   2. It only finds token BOUNDARIES (string/escape aware); row CONTENT is
//      parsed by the trusted built-in JSON.parse. So braces, brackets, quotes,
//      escapes, commas, newlines and unicode INSIDE a string value never
//      miscount, and a corrupt/truncated document throws (loud, safe) rather
//      than silently mis-restoring.
//   3. It is chunk-boundary safe: feeding the document one character at a time,
//      or split at any random offset, yields byte-identical events.
//
// Run: node scripts/test-backup-restore-stream-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function loadTs(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
}

const { BackupDocumentScanner } = loadTs('src/lib/backupRestoreStream.ts')

let passed = 0
let failed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error && error.message ? error.message : error) }
}

// Build a document byte-for-byte the way backup.ts::writeBackupDocument does,
// so the test proves the scanner reads exactly what the writer writes.
function buildDoc(tables, { includeTail = true } = {}) {
  let s = '{"format":"business-os-cloudflare-backup","formatVersion":1,'
  s += '"createdAt":"2026-08-27T00:00:00.000Z","source":"manual",'
  s += '"runtime":"cloudflare-workers","tables":{'
  let tableCount = 0
  for (const t of tables) {
    s += `${tableCount ? ',' : ''}${JSON.stringify(t.name)}:{"columns":${JSON.stringify(t.columns)},"rows":[`
    let rowCount = 0
    for (const row of t.rows) {
      s += `${rowCount ? ',' : ''}${JSON.stringify(row)}`
      rowCount += 1
    }
    s += ']}'
    tableCount += 1
  }
  s += '}'
  if (includeTail) {
    s += ',"r2":' + JSON.stringify({ bucket: 'business-os-assets', assets: [], copiedKeys: [] })
    s += ',"summary":' + JSON.stringify({ tableCount, rowCount: 0 })
    s += '}'
  }
  return s
}

// Feed `text` to a fresh scanner in chunks of size `size` (or a list of split
// points), collecting all events.
function scanChunks(text, splitter) {
  const scanner = new BackupDocumentScanner()
  const events = []
  const chunks = typeof splitter === 'function' ? splitter(text) : sliceEvery(text, splitter)
  for (const c of chunks) for (const ev of scanner.push(c)) events.push(ev)
  scanner.end()
  return events
}

function sliceEvery(text, size) {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

function rowsOf(events, table) {
  return events.filter((e) => e.type === 'row' && e.table === table).map((e) => e.row)
}
function tablesOf(events) {
  return events.filter((e) => e.type === 'table').map((e) => ({ table: e.table, columns: e.columns }))
}

// --- the adversarial fixture ------------------------------------------------

const TRICKY = [
  {
    name: 'products',
    columns: ['id', 'name', 'meta', 'note', 'price'],
    rows: [
      { id: 1, name: 'Anastasia {Blush} Stick', meta: { tags: ['a', 'b}', 'c]'], nested: { x: 1 } }, note: 'has "quotes" and , commas', price: 12.5 },
      { id: 2, name: 'Line\nbreak\tand \\backslash\\', meta: null, note: 'emoji 💄 and khmer អក្សរ', price: 0 },
      { id: 3, name: 'ends with brace }', meta: [], note: '][{}"', price: -3.14 },
    ],
  },
  {
    name: 'branches',
    columns: ['id', 'label'],
    rows: [
      { id: 10, label: 'Shop' },
      { id: 20, label: 'Warehouse, #2' },
    ],
  },
  {
    name: 'empty_table',
    columns: ['id'],
    rows: [],
  },
]

check('reads every table and row from a single-chunk feed', () => {
  const doc = buildDoc(TRICKY)
  const events = scanChunks(doc, doc.length + 10) // one chunk
  const tbls = tablesOf(events)
  assert.deepEqual(tbls.map((t) => t.table), ['products', 'branches', 'empty_table'])
  assert.deepEqual(tbls[0].columns, ['id', 'name', 'meta', 'note', 'price'])
  assert.deepEqual(rowsOf(events, 'products'), TRICKY[0].rows)
  assert.deepEqual(rowsOf(events, 'branches'), TRICKY[1].rows)
  assert.deepEqual(rowsOf(events, 'empty_table'), [])
})

check('char-by-char feed yields byte-identical events (chunk-boundary safety)', () => {
  const doc = buildDoc(TRICKY)
  const whole = scanChunks(doc, doc.length + 10)
  const perChar = scanChunks(doc, 1)
  assert.deepEqual(perChar, whole)
})

check('every fixed chunk size 1..17 yields identical events', () => {
  const doc = buildDoc(TRICKY)
  const ref = scanChunks(doc, doc.length + 10)
  for (let size = 1; size <= 17; size += 1) {
    assert.deepEqual(scanChunks(doc, size), ref, `chunk size ${size} diverged`)
  }
})

check('random split points yield identical events (fuzz)', () => {
  const doc = buildDoc(TRICKY)
  const ref = scanChunks(doc, doc.length + 10)
  let seed = 123456789
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let trial = 0; trial < 200; trial += 1) {
    const splitter = (text) => {
      const chunks = []
      let i = 0
      while (i < text.length) {
        const step = 1 + Math.floor(rnd() * 6)
        chunks.push(text.slice(i, i + step))
        i += step
      }
      return chunks
    }
    assert.deepEqual(scanChunks(doc, splitter), ref, `fuzz trial ${trial} diverged`)
  }
})

check('the "rows" boundary scan is not fooled by braces/brackets inside strings', () => {
  const doc = buildDoc([{ name: 'x', columns: ['a'], rows: [{ a: '}}}]]],{"fake":true},[[[' }] }])
  const events = scanChunks(doc, 3)
  assert.deepEqual(rowsOf(events, 'x'), [{ a: '}}}]]],{"fake":true},[[[' }])
})

check('a table whose rows come before/after other body keys still reads rows', () => {
  // Our writer emits columns then rows, but the scanner tolerates an extra
  // unrecognised body key without losing rows.
  const doc =
    '{"tables":{"t":{"columns":["a"],"extra":{"nested":[1,2,3]},"rows":[{"a":1},{"a":2}]}}}'
  const events = scanChunks(doc, 4)
  assert.deepEqual(rowsOf(events, 't'), [{ a: 1 }, { a: 2 }])
})

check('scoped backup (subset of tables) reads cleanly', () => {
  const doc = buildDoc([{ name: 'settings', columns: ['k', 'v'], rows: [{ k: 'x', v: 'y' }] }])
  const events = scanChunks(doc, 5)
  assert.deepEqual(rowsOf(events, 'settings'), [{ k: 'x', v: 'y' }])
})

check('captures r2/summary metadata as meta events without holding the tables', () => {
  const doc = buildDoc(TRICKY)
  const events = scanChunks(doc, 4)
  const metas = events.filter((e) => e.type === 'meta')
  const byKey = Object.fromEntries(metas.map((m) => [m.key, m.value]))
  assert.ok(byKey.r2 && byKey.r2.bucket === 'business-os-assets', 'r2 metadata should be captured')
  assert.ok(byKey.summary && typeof byKey.summary.tableCount === 'number', 'summary metadata should be captured')
  assert.equal(byKey.format, 'business-os-cloudflare-backup', 'streamed validation receives the format marker')
  assert.equal(byKey.formatVersion, 1, 'streamed validation receives the format version')
  // meta must come AFTER all the table rows (it follows tables in the document)
  const lastRowIdx = events.map((e) => e.type).lastIndexOf('row')
  const firstTailMetaIdx = events.findIndex((e) => e.type === 'meta' && (e.key === 'r2' || e.key === 'summary'))
  assert.ok(firstTailMetaIdx > lastRowIdx, 'r2/summary meta events should follow the row stream')
})

check('rejects a corrupt r2 metadata tail before it can masquerade as a complete document', () => {
  const doc = buildDoc(TRICKY)
  const corruptedTail = doc.replace('"r2":', '"r2":GARBAGE')
  assert.throws(() => scanChunks(corruptedTail, 7), /trailing content|Expected/)
})

check('a truncated document (cut mid-rows) throws on end()', () => {
  const doc = buildDoc(TRICKY)
  const cut = doc.slice(0, doc.indexOf('"branches"') + 20)
  let threw = false
  try {
    const scanner = new BackupDocumentScanner()
    scanner.push(cut)
    scanner.end()
  } catch (_) { threw = true }
  assert.ok(threw, 'end() must reject a truncated backup')
})

check('a corrupted row (invalid JSON in a bracket-balanced region) throws', () => {
  // Bracket-balanced so the boundary scanner accepts it, but not valid JSON,
  // so JSON.parse -- the trusted backstop -- throws instead of mis-restoring.
  const doc = '{"tables":{"t":{"columns":["a"],"rows":[{a:1}]}}}'
  let threw = false
  try { scanChunks(doc, 6) } catch (_) { threw = true }
  assert.ok(threw, 'an unparseable row must throw, never be silently dropped')
})

check('empty tables object yields identity metadata and ends clean', () => {
  const doc = '{"format":"x","tables":{}}'
  const events = scanChunks(doc, 2)
  assert.deepEqual(events, [{ type: 'meta', key: 'format', value: 'x' }])
})

check('trailing non-whitespace after the top-level object is rejected', () => {
  assert.throws(() => scanChunks(buildDoc([]) + '{"second":true}', 7), /trailing content/)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
