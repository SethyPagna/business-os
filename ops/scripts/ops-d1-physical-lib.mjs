// Pure core of the d1-physical-export ops task (.github/workflows/ops.yml) and of its local loader
// (ops/scripts/latest-data/load-d1-physical-export.mjs). No I/O here: the job script supplies `query`
// (one guarded read-only statement -> rows) and `emit` (one encrypted chunk file), the tests supply fakes.
//
// What it exports: EVERY physical table of the database -- d1_migrations included -- except FTS5 virtual
// tables and their shadow tables, `sqlite_*` internals and `_cf_*` tables (those refuse reads with
// SQLITE_AUTH). `sqlite_sequence` is read as an optional extra: a refused read is recorded, not fatal.
//
// How it reads: rowid keyset paging only. A page is
//   SELECT CAST(rowid AS TEXT) AS r, quote("a") AS c0, ... FROM "t" WHERE rowid > <last> ORDER BY rowid LIMIT <n>
// so every page is one b-tree seek plus n rows, whatever the table size; there is never an OFFSET, a LIKE, a
// GLOB or a bound parameter (the numbers are validated integer literals). Page size adapts: it starts small,
// grows while pages stay light, shrinks when a page is heavy, and halves on a retryable D1 refusal (the CPU
// reset, code 7429, among them).
//
// How values travel: quote() is SQLite's own lossless literal writer (integers exact to 64 bits, reals with
// full precision, blobs as X'..', text quoted), so a value is one self-describing string and its type
// survives. A table's file lines are `[rowid,[quoted values...]]`, one JSON array per row; the table's
// sha256 is over those lines in rowid order, which the loader recomputes from the rebuilt database.

import crypto from 'node:crypto'
import { OpsError } from './ops-common.mjs'

export const FORMAT = 'business-os-d1-physical-export/1'
export const CHUNK_KIND = 'd1-physical-chunk'
export const MANIFEST_KIND = 'd1-physical-manifest'

export const LIMITS = Object.freeze({
  pageRowsStart: 250,
  pageRowsMax: 500,
  pageRowsMin: 1,
  targetPageBytes: 2 * 1024 * 1024,
  slowPageMs: 150,
  chunkBytes: 6 * 1024 * 1024,
  attempts: 5,
  schemaPageRows: 100,
})

export const IDENT = /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/
const RID = /^-?\d{1,19}$/
const ROWID_NAMES = ['rowid', '_rowid_', 'oid']
const SHADOW_SUFFIXES = ['_data', '_idx', '_content', '_docsize', '_config']

export const MASTER_COLUMNS = Object.freeze(['type', 'name', 'tbl_name', 'sql'])

// ------------------------------------------------------------------ SQL builders

export function quoteIdent(name) {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new OpsError('identifier-unsupported', 'A table or column name is not a plain identifier.')
  return `"${name}"`
}

// The first rowid alias that no column shadows (a column called rowid hides the real one), or null.
export function ridColumnFor(columns) {
  const taken = new Set(columns.map((c) => String(c).toLowerCase()))
  return ROWID_NAMES.find((name) => !taken.has(name)) || null
}

export function pageSql({ table, columns, rid = 'rowid', afterRid = null, limit }) {
  if (!ROWID_NAMES.includes(rid)) throw new OpsError('identifier-unsupported', 'Not a rowid name.')
  if (!Number.isInteger(limit) || limit < LIMITS.pageRowsMin || limit > LIMITS.pageRowsMax) throw new OpsError('page-limit-invalid', 'The page size is out of range.')
  if (afterRid !== null && !RID.test(afterRid)) throw new OpsError('keyset-invalid', 'The keyset value is not an integer.')
  if (!Array.isArray(columns) || !columns.length) throw new OpsError('identifier-unsupported', 'A page needs columns.')
  const select = columns.map((column, i) => `quote(${quoteIdent(column)}) AS c${i}`).join(', ')
  const where = afterRid === null ? '' : ` WHERE ${rid} > ${afterRid}`
  return `SELECT CAST(${rid} AS TEXT) AS r, ${select} FROM ${quoteIdent(table)}${where} ORDER BY ${rid} LIMIT ${limit}`
}

export function probeSql(table) {
  return `SELECT * FROM ${quoteIdent(table)} LIMIT 1`
}

export function maxRidSql(table, rid = 'rowid') {
  if (!ROWID_NAMES.includes(rid)) throw new OpsError('identifier-unsupported', 'Not a rowid name.')
  return `SELECT CAST(MAX(${rid}) AS TEXT) AS m FROM ${quoteIdent(table)}`
}

// One row, checked before anything is read: quote() must write full-precision reals, blobs and
// quote-doubled text the way the loader parses them.
export const PREFLIGHT_SQL = "SELECT quote(0.30000000000000004) AS real_value, quote(9223372036854775807) AS big_value, quote('a''b') AS text_value, quote(x'00ff') AS blob_value, quote(NULL) AS null_value"
// real_value is checked by value (SQLite writes it as 3.000000000000000445e-01 or 0.30000000000000004 depending on version).
export const PREFLIGHT_EXPECTED = Object.freeze({
  big_value: '9223372036854775807',
  text_value: "'a''b'",
  blob_value: "X'00FF'",
  null_value: 'NULL',
})

export function preflightProblem(rows) {
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null
  if (!row) return 'preflight-no-row'
  if (typeof row.real_value !== 'string' || !/^[0-9.]+(?:e[+-]?\d+)?$/.test(row.real_value) || Number(row.real_value) !== 0.1 + 0.2) return 'preflight-quote-unexpected'
  for (const [key, want] of Object.entries(PREFLIGHT_EXPECTED)) {
    if (row[key] !== want) return 'preflight-quote-unexpected'
  }
  return null
}

// ----------------------------------------------------------- schema classification

// masterRows: sqlite_master rows { type, name, tbl_name, sql }. Returns what to export and what to skip.
export function classifySchema(masterRows) {
  const rows = masterRows.filter((r) => r && typeof r.name === 'string' && typeof r.type === 'string')
  const isTable = (r) => r.type === 'table'
  const virtual = new Set(rows.filter((r) => isTable(r) && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(String(r.sql || ''))).map((r) => r.name))
  const shadowOf = (name) => {
    for (const v of virtual) {
      if (SHADOW_SUFFIXES.some((suffix) => name === `${v}${suffix}`)) return v
    }
    return null
  }
  const tables = []
  const excluded = []
  const issues = []
  let sequence = false
  for (const r of rows.filter(isTable)) {
    if (r.name === 'sqlite_sequence') { sequence = true; continue }
    if (r.name.startsWith('sqlite_')) { excluded.push({ name: r.name, reason: 'sqlite-internal' }); continue }
    if (r.name.startsWith('_cf_')) { excluded.push({ name: r.name, reason: 'cloudflare-internal' }); continue }
    if (virtual.has(r.name)) { excluded.push({ name: r.name, reason: 'fts-virtual' }); continue }
    if (shadowOf(r.name)) { excluded.push({ name: r.name, reason: 'fts-shadow' }); continue }
    const sql = String(r.sql || '')
    if (!IDENT.test(r.name)) { issues.push({ table: r.name, code: 'identifier-unsupported' }); continue }
    if (/\bWITHOUT\s+ROWID\b/i.test(sql)) { issues.push({ table: r.name, code: 'without-rowid-unsupported' }); continue }
    if (/\bGENERATED\s+ALWAYS\b/i.test(sql) || /\bAS\s*\(/i.test(sql)) { issues.push({ table: r.name, code: 'generated-columns-unsupported' }); continue }
    tables.push({ name: r.name, sql })
  }
  // The loader needs a virtual table's own DDL (its data is rebuilt, not copied); shadows and internals it must not see.
  const excludedNames = new Set(excluded.filter((e) => e.reason !== 'fts-virtual').map((e) => e.name))
  const schema = rows
    .filter((r) => typeof r.sql === 'string' && r.sql && r.name !== 'sqlite_sequence' && !excludedNames.has(r.name) && !excludedNames.has(r.tbl_name))
    .map((r) => ({ type: r.type, name: r.name, tbl_name: r.tbl_name, sql: r.sql }))
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { tables, excluded, issues, schema, sequence }
}

// ------------------------------------------------------------------- line format

export function encodeLine(row, columnCount) {
  if (!row || typeof row.r !== 'string' || !RID.test(row.r)) throw new OpsError('page-row-malformed', 'A page row has no integer rowid.')
  const values = []
  for (let i = 0; i < columnCount; i += 1) {
    const value = row[`c${i}`]
    if (typeof value !== 'string') throw new OpsError('page-row-malformed', 'A page row has a missing value.')
    values.push(value)
  }
  return JSON.stringify([row.r, values])
}

export function decodeLines(text, columnCount) {
  const out = []
  if (!text) return out
  if (!text.endsWith('\n')) throw new OpsError('chunk-malformed', 'A chunk does not end with a newline.')
  for (const line of text.slice(0, -1).split('\n')) {
    const parsed = JSON.parse(line)
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || !RID.test(parsed[0]) || !Array.isArray(parsed[1]) || parsed[1].length !== columnCount) {
      throw new OpsError('chunk-malformed', 'A chunk line has the wrong shape.')
    }
    out.push({ rid: parsed[0], values: parsed[1] })
  }
  return out
}

// quote()'s text -> a JS value to bind: null, bigint, number (a real), string, Uint8Array.
export function parseQuoted(text) {
  if (typeof text !== 'string') throw new OpsError('bad-quoted-value', 'Not text.')
  if (text === 'NULL') return null
  if (/^-?\d+$/.test(text)) {
    const n = BigInt(text)
    if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) throw new OpsError('bad-quoted-value', 'An integer outside 64 bits.')
    return n
  }
  if (/^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text)
  const blob = /^X'([0-9A-Fa-f]*)'$/.exec(text)
  if (blob) {
    if (blob[1].length % 2) throw new OpsError('bad-quoted-value', 'An odd-length blob.')
    return new Uint8Array(Buffer.from(blob[1], 'hex'))
  }
  if (/^'(?:[^']|'')*'$/s.test(text)) return text.slice(1, -1).replace(/''/g, "'")
  throw new OpsError('bad-quoted-value', 'Not a quote() literal.')
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

export const EMPTY_SHA256 = sha256Hex('')

// ---------------------------------------------------------------- the engine

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function nextLimit(limit, bytes) {
  if (bytes > LIMITS.targetPageBytes) return Math.max(LIMITS.pageRowsMin, Math.floor((limit * LIMITS.targetPageBytes) / bytes))
  if (bytes < LIMITS.targetPageBytes / 2) return Math.min(LIMITS.pageRowsMax, limit * 2)
  return limit
}

// A fixed kebab-case code for anything thrown: an OpsError's own, else 'internal-error' (the message may hold data).
function errorCode(err) {
  return err && typeof err.code === 'string' && /^[a-z][a-z0-9-]{2,63}$/.test(err.code) ? err.code : 'internal-error'
}

// query(sql) -> { ok, rows, meta, retryable, errorCodes }   (one guarded read-only statement)
// emit({ seq, text, rows }) -> { file, bytes }             (writes one encrypted chunk, returns its name and size)
// Never throws for a D1 refusal: the manifest's `issues` carries fixed codes, the table's `failed` flag its state.
export async function exportAll({ query, emit, pause = sleepMs, concurrency = 3, now = () => new Date().toISOString(), runId = 'local', commit = 'unknown' }) {
  const startedAt = now()
  const manifest = {
    format: FORMAT, kind: MANIFEST_KIND, database: 'business-os', runId, commit, startedAt, finishedAt: null,
    tables: [], excluded: [], skipped: [], schema: [], sequence: null, issues: [], changedDuringExport: [],
    totals: { tables: 0, rows: 0, plainBytes: 0, encryptedBytes: 0, files: 0, statements: 0, rowsRead: 0, retries: 0, slowestStatementMs: 0 },
  }
  const totals = manifest.totals
  const flag = (table, code) => { manifest.issues.push(table ? { table, code } : { code }) }

  // sql: the statement, or a function that builds it afresh for each attempt (a retry may use a smaller page).
  const run = async (sql, tableLabel, onRetry) => {
    let last = null
    for (let attempt = 1; attempt <= LIMITS.attempts; attempt += 1) {
      totals.statements += 1
      last = await query(typeof sql === 'function' ? sql() : sql)
      if (last && last.ok) {
        const meta = last.meta || {}
        totals.rowsRead += Number(meta.rows_read || 0)
        totals.slowestStatementMs = Math.max(totals.slowestStatementMs, Number(meta.duration || 0))
        return last
      }
      if (!last || !last.retryable || attempt === LIMITS.attempts) break
      totals.retries += 1
      if (onRetry) onRetry()
      await pause(500 * attempt * attempt)
    }
    flag(tableLabel, last && last.retryable ? 'statement-kept-failing' : 'statement-refused')
    return null
  }

  // Keyset paging over any table whose columns are known; onRows gets each page's rows.
  const pageAll = async ({ table, columns, rid, tableLabel, onRows, startLimit = LIMITS.pageRowsStart }) => {
    let limit = startLimit
    let afterRid = null
    let pages = 0
    let asked = limit
    // A refused page lowers the ceiling for the rest of the table: a CPU reset is never provoked twice at one size.
    let ceiling = startLimit === LIMITS.pageRowsStart ? LIMITS.pageRowsMax : startLimit
    for (;;) {
      const result = await run(() => { asked = limit; return pageSql({ table, columns, rid, afterRid, limit }) }, tableLabel, () => {
        limit = Math.max(LIMITS.pageRowsMin, Math.floor(limit / 2))
        ceiling = limit
      })
      if (!result) return { ok: false, pages, lastRid: afterRid }
      pages += 1
      const rows = result.rows || []
      const bytes = await onRows(rows)
      if (rows.length) {
        const last = rows[rows.length - 1].r
        if (afterRid !== null && BigInt(last) <= BigInt(afterRid)) { flag(tableLabel, 'keyset-not-advancing'); return { ok: false, pages, lastRid: afterRid } }
        afterRid = last
      }
      if (rows.length < asked) return { ok: true, pages, lastRid: afterRid }
      // D1 reports its own execution time: a slow page (wide rows, heavy text) caps the table's page size before D1's
      // CPU limit can reset the database.
      if (Number(result.meta && result.meta.duration) > LIMITS.slowPageMs) ceiling = Math.max(LIMITS.pageRowsMin, Math.min(ceiling, Math.floor(asked / 2)))
      limit = Math.min(nextLimit(asked, bytes), ceiling)
    }
  }

  const work = async () => {
    // 1. quote() behaves as the loader expects.
    const pre = await run(PREFLIGHT_SQL, null)
    if (!pre) return
    const preProblem = preflightProblem(pre.rows)
    if (preProblem) { flag(null, preProblem); return }

    // 2. The schema.
    const master = []
    const schemaPaging = await pageAll({
      table: 'sqlite_master', columns: MASTER_COLUMNS, rid: 'rowid', tableLabel: null, startLimit: LIMITS.schemaPageRows,
      onRows: async (rows) => {
        let bytes = 0
        for (const row of rows) {
          const [type, name, tbl, sql] = MASTER_COLUMNS.map((_, i) => parseQuoted(row[`c${i}`]))
          master.push({ type, name, tbl_name: tbl, sql })
          bytes += String(sql || '').length + 60
        }
        return bytes
      },
    })
    if (!schemaPaging.ok) return
    const classified = classifySchema(master)
    manifest.excluded = classified.excluded
    manifest.schema = classified.schema
    for (const issue of classified.issues) flag(issue.table, issue.code)

    // 3. Every table.
    let seq = 0
    const exportTable = async (entry) => {
      const record = {
        name: entry.name, rows: 0, columns: [], ridColumn: null, sha256: EMPTY_SHA256, plainBytes: 0,
        firstRid: null, lastRid: null, pages: 0, chunks: [], failed: false,
      }
      manifest.tables.push(record)
      const fail = (code) => { record.failed = true; if (code) flag(entry.name, code) }
      const probe = await run(probeSql(entry.name), entry.name)
      if (!probe) { fail(); return }
      const probeRows = probe.rows || []
      if (probeRows.length) {
        record.columns = Object.keys(probeRows[0])
        if (!record.columns.every((c) => IDENT.test(c))) { fail('identifier-unsupported'); return }
        record.ridColumn = ridColumnFor(record.columns)
        if (!record.ridColumn) { fail('rowid-shadowed'); return }
        const hash = crypto.createHash('sha256')
        let rowLines = []
        let lineBytes = 0
        const flush = async () => {
          if (!rowLines.length) return
          const text = `${rowLines.join('\n')}\n`
          seq += 1
          const mine = seq
          const written = await emit({ seq: mine, text, rows: rowLines.length })
          hash.update(text)
          record.chunks.push({ seq: mine, file: written.file, rows: rowLines.length, plainBytes: Buffer.byteLength(text), encryptedBytes: written.bytes, sha256: sha256Hex(text) })
          record.plainBytes += Buffer.byteLength(text)
          totals.files += 1
          totals.encryptedBytes += written.bytes
          rowLines = []
          lineBytes = 0
        }
        const paged = await pageAll({
          table: entry.name, columns: record.columns, rid: record.ridColumn, tableLabel: entry.name,
          onRows: async (rows) => {
            let bytes = 0
            for (const row of rows) {
              const line = encodeLine(row, record.columns.length)
              if (record.firstRid === null) record.firstRid = row.r
              record.lastRid = row.r
              rowLines.push(line)
              const size = Buffer.byteLength(line) + 1
              bytes += size
              lineBytes += size
              record.rows += 1
              if (lineBytes >= LIMITS.chunkBytes) await flush()
            }
            return bytes
          },
        })
        record.pages = paged.pages
        await flush()
        record.sha256 = hash.digest('hex')
        if (!paged.ok) { record.failed = true; return }
      }
      const max = await run(maxRidSql(entry.name, record.ridColumn || 'rowid'), entry.name)
      if (!max) { record.failed = true; return }
      const maxRow = (max.rows || [])[0]
      const maxRid = maxRow && typeof maxRow.m === 'string' ? maxRow.m : null
      const grew = maxRid !== null && RID.test(maxRid) && (record.lastRid === null || BigInt(maxRid) > BigInt(record.lastRid))
      if (grew) manifest.changedDuringExport.push(entry.name)
    }

    const queue = [...classified.tables]
    const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, async () => {
      while (queue.length) {
        const entry = queue.shift()
        try {
          await exportTable(entry)
        } catch (err) {
          const record = manifest.tables.find((t) => t.name === entry.name)
          if (record) record.failed = true
          flag(entry.name, errorCode(err))
        }
      }
    })
    await Promise.all(lanes)
    manifest.tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    // 4. sqlite_sequence, when D1 lets it be read.
    if (classified.sequence) {
      const before = manifest.issues.length
      const seqRows = []
      const paged = await pageAll({
        table: 'sqlite_sequence', columns: ['name', 'seq'], rid: 'rowid', tableLabel: 'sqlite_sequence',
        onRows: async (rows) => {
          let bytes = 0
          for (const row of rows) { seqRows.push([parseQuoted(row.c0), String(parseQuoted(row.c1))]); bytes += 40 }
          return bytes
        },
      })
      if (paged.ok) manifest.sequence = seqRows
      else {
        // Not every D1 lets sqlite_sequence be read; the loader then restarts each counter at its table's max id.
        manifest.issues.splice(before)
        manifest.skipped.push({ name: 'sqlite_sequence', reason: 'read-refused' })
      }
    }
  }
  try {
    await work()
  } catch (err) {
    // A malformed page or a bug must still leave a manifest that says what is complete.
    flag(null, errorCode(err))
  }

  totals.tables = manifest.tables.length
  totals.rows = manifest.tables.reduce((n, t) => n + t.rows, 0)
  totals.plainBytes = manifest.tables.reduce((n, t) => n + t.plainBytes, 0)
  for (const t of manifest.tables) if (t.failed && !manifest.issues.some((i) => i.table === t.name)) flag(t.name, 'table-incomplete')
  manifest.finishedAt = now()
  return manifest
}

// The verdict a manifest implies: ok only when nothing was flagged and no table failed.
export function manifestVerdict(manifest) {
  const codes = [...new Set(manifest.issues.map((i) => i.code))]
  const failed = manifest.tables.filter((t) => t.failed).length
  return { ok: codes.length === 0 && failed === 0 && manifest.tables.length > 0, codes, failedTables: failed }
}
