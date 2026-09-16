// The streamed backup must produce the SAME JSON document the old
// build-it-all-in-memory version did.
//
// Why this changed at all: the previous implementation did
//
//   for (const table of BACKUP_TABLES) {
//     const result = await env.DB.prepare(`SELECT * FROM ...`).all()
//     tables[table] = { columns, rows }
//   }
//   await env.ASSETS.put(key, JSON.stringify(payload))
//
// which holds every row of every table as JS objects and then again as one
// serialized string. On a real catalogue that crossed the Worker's 128MB
// ceiling:
//
//   POST /api/system/reset-data - Exceeded Memory Limit
//
// and because a fresh backup is a hard prerequisite in front of every reset,
// EVERY reset mode failed before deleting anything.
//
// Rewriting a backup writer is exactly the kind of change that silently
// breaks restore months later, so this asserts the two things that matter:
//   1. the streamed document parses and deep-equals the object the old code
//      would have produced -- same keys, same nesting, same row order
//   2. the paging cannot drop or duplicate a row at a page boundary
//
// Run: node scripts/test-backup-stream-pure.cjs

const assert = require('assert')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const TABLE_PAGE_SIZE = 500

// --- the two implementations, side by side -----------------------------

// What the old code produced.
function buildInMemory(db, tables, meta) {
  const out = {}
  let rowCount = 0
  for (const table of tables) {
    if (!db[table]) continue
    out[table] = { columns: db[table].columns, rows: db[table].rows }
    rowCount += db[table].rows.length
  }
  return JSON.stringify({
    format: 'business-os-cloudflare-backup',
    formatVersion: 1,
    createdAt: meta.createdAt,
    source: meta.source,
    runtime: 'cloudflare-workers',
    tables: out,
    r2: meta.r2,
    summary: {
      tableCount: Object.keys(out).length,
      rowCount,
      assetCount: meta.r2.assets.length,
      assetsBackedUp: meta.r2.copiedKeys.length,
      assetsSkipped: Math.max(0, meta.r2.assets.length - meta.r2.copiedKeys.length),
    },
  })
}

// Mirrors lib/backup.ts's streamed writer, including its paging.
function buildStreamed(db, tables, meta) {
  const chunks = []
  const write = (t) => chunks.push(t)
  let rowCount = 0
  let tableCount = 0

  write(`{"format":${JSON.stringify('business-os-cloudflare-backup')},"formatVersion":1,`)
  write(`"createdAt":${JSON.stringify(meta.createdAt)},`)
  write(`"source":${JSON.stringify(meta.source)},`)
  write('"runtime":"cloudflare-workers","tables":{')

  for (const table of tables) {
    if (!db[table]) continue
    write(`${tableCount ? ',' : ''}${JSON.stringify(table)}:{"columns":${JSON.stringify(db[table].columns)},"rows":[`)
    tableCount += 1

    let offset = 0
    let rowsInTable = 0
    for (;;) {
      const page = db[table].rows.slice(offset, offset + TABLE_PAGE_SIZE)
      if (!page.length) break
      for (const row of page) {
        write(`${rowsInTable ? ',' : ''}${JSON.stringify(row)}`)
        rowsInTable += 1
      }
      if (page.length < TABLE_PAGE_SIZE) break
      offset += TABLE_PAGE_SIZE
    }
    rowCount += rowsInTable
    write(']}')
  }

  write('},"r2":')
  write(JSON.stringify(meta.r2))
  write(',"summary":')
  write(JSON.stringify({
    tableCount,
    rowCount,
    assetCount: meta.r2.assets.length,
    assetsBackedUp: meta.r2.copiedKeys.length,
    assetsSkipped: Math.max(0, meta.r2.assets.length - meta.r2.copiedKeys.length),
  }))
  write('}')
  return chunks.join('')
}

// --- fixtures ----------------------------------------------------------

const meta = {
  createdAt: '2026-08-25T10:00:00.000Z',
  source: 'manual',
  r2: { bucket: 'business-os-assets', assets: [{ key: 'uploads/a.png' }], assetsPrefix: 'backups/x/assets/', copiedKeys: ['uploads/a.png'], assetCopyProgress: undefined },
}

function makeRows(n, prefix) {
  const rows = []
  for (let i = 0; i < n; i += 1) {
    rows.push({
      id: i + 1,
      // Non-ASCII on purpose: this catalogue is full of Khmer product names
      // and the byte/character distinction matters to the part sizing.
      name: `${prefix} ផលិតផល ${i + 1}`,
      description: i % 3 === 0 ? 'Line one\nLine two with "quotes" and, commas' : null,
      price: (i % 7) * 1.5,
      active: i % 2 === 0,
    })
  }
  return rows
}

const db = {
  settings: { columns: ['key', 'value'], rows: [{ key: 'a', value: '1' }] },
  // Deliberately straddles the page size in both directions.
  products: { columns: ['id', 'name', 'description', 'price', 'active'], rows: makeRows(1201, 'P') },
  sales: { columns: ['id', 'name', 'description', 'price', 'active'], rows: makeRows(TABLE_PAGE_SIZE, 'S') },
  empty_table: { columns: ['id'], rows: [] },
}
const TABLES = ['settings', 'products', 'sales', 'empty_table', 'table_that_does_not_exist']

// --- assertions --------------------------------------------------------

const streamed = buildStreamed(db, TABLES, meta)
const inMemory = buildInMemory(db, TABLES, meta)

check('the streamed document is valid JSON', () => {
  JSON.parse(streamed)
})

check('streamed output deep-equals what the in-memory version produced', () => {
  assert.deepStrictEqual(JSON.parse(streamed), JSON.parse(inMemory))
})

check('every row survives, in order, across page boundaries', () => {
  const parsed = JSON.parse(streamed)
  assert.strictEqual(parsed.tables.products.rows.length, 1201, 'no rows dropped or duplicated')
  assert.deepStrictEqual(parsed.tables.products.rows[0], db.products.rows[0])
  assert.deepStrictEqual(parsed.tables.products.rows[499], db.products.rows[499], 'last row of page 1')
  assert.deepStrictEqual(parsed.tables.products.rows[500], db.products.rows[500], 'first row of page 2')
  assert.deepStrictEqual(parsed.tables.products.rows[1200], db.products.rows[1200], 'final row')
})

check('a table whose size is an exact multiple of the page size terminates', () => {
  // The loop breaks on a short page; an exact multiple returns a full page
  // and then an empty one. Getting this wrong is an infinite loop, not a
  // wrong answer.
  const parsed = JSON.parse(streamed)
  assert.strictEqual(parsed.tables.sales.rows.length, TABLE_PAGE_SIZE)
})

check('an empty table still appears, with an empty rows array', () => {
  const parsed = JSON.parse(streamed)
  assert.deepStrictEqual(parsed.tables.empty_table, { columns: ['id'], rows: [] })
})

check('a table that does not exist is omitted entirely', () => {
  const parsed = JSON.parse(streamed)
  assert.ok(!('table_that_does_not_exist' in parsed.tables))
})

check('summary counts match the rows actually written', () => {
  const parsed = JSON.parse(streamed)
  const actual = Object.values(parsed.tables).reduce((sum, t) => sum + t.rows.length, 0)
  assert.strictEqual(parsed.summary.rowCount, actual)
  assert.strictEqual(parsed.summary.tableCount, Object.keys(parsed.tables).length)
})

check('non-ASCII, newlines and quotes round-trip intact', () => {
  const parsed = JSON.parse(streamed)
  const withText = parsed.tables.products.rows[0]
  assert.ok(withText.name.includes('ផលិតផល'), 'Khmer text preserved')
  assert.ok(String(withText.description).includes('\n'), 'newline preserved')
  assert.ok(String(withText.description).includes('"quotes"'), 'embedded quotes preserved')
})

check('the top-level shape restore reads is unchanged', () => {
  const parsed = JSON.parse(streamed)
  assert.deepStrictEqual(
    Object.keys(parsed).sort(),
    ['createdAt', 'format', 'formatVersion', 'r2', 'runtime', 'source', 'summary', 'tables'],
  )
  assert.strictEqual(parsed.format, 'business-os-cloudflare-backup')
  assert.strictEqual(parsed.formatVersion, 1)
})

// --- the memory property this exists to protect ------------------------

check('no single buffered part approaches the Worker memory ceiling', () => {
  // The point of the rewrite: peak memory is one part, not the database.
  // Mirrors R2StreamWriter: parts of exactly PART_BYTES, only the trailing
  // part shorter (the exact-size rule itself is pinned against the real
  // class in test-backup-r2-parts-pure.cjs).
  const PART_BYTES = 8 * 1024 * 1024
  const parts = []
  let bytes = 0
  const encoder = new TextEncoder()
  for (const piece of [streamed]) {
    for (let i = 0; i < piece.length; i += 4096) {
      let remaining = encoder.encode(piece.slice(i, i + 4096)).byteLength
      while (remaining > 0) {
        const take = Math.min(PART_BYTES - bytes, remaining)
        bytes += take
        remaining -= take
        if (bytes === PART_BYTES) { parts.push(bytes); bytes = 0 }
      }
    }
  }
  const peak = Math.max(...parts, bytes)
  assert.ok(peak <= PART_BYTES, `peak buffered bytes ${peak} must never exceed one part`)
  assert.ok(peak < 16 * 1024 * 1024, `peak buffered bytes ${peak} must stay far below the 128MB Worker limit`)
})

console.log(`\n${passed} backup-stream checks passed`)
