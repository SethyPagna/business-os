// Drives the REAL chunked import engine end to end.
//
// Everything else in this repo tests the import in pieces: the census calls
// classifyProducts directly and models the write path itself, and the pure
// tests exercise individual functions. Nothing had ever run
// runImportAnalyze -> runImportApply the way the queue actually does, which
// means the parts most recently changed had never been exercised together:
//
//   * byte-ranged CSV materialization (migration-free, importCsv change)
//   * the dedupe ledger table          (migration 0051)
//   * the image-match tables           (migration 0052)
//   * the single-writer lease          (migration 0053)
//   * sales group windowing in SQL
//
// This harness supplies the three things the engine needs from the platform
// and then turns the crank until the job finishes:
//
//   env.DB           -> real SQLite with the real migrations
//   env.ASSETS       -> the real CSV file, served with REAL RANGE SUPPORT,
//                       because ranged reads are the thing being verified
//   env.IMPORT_QUEUE -> a list; the loop below plays messages back, which is
//                       what makes this a genuine multi-invocation run
//                       rather than one long call
//
// Usage: node scripts/harness/run_import_e2e.cjs "<path to products csv>"
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')

const LIB_DIR = path.join(__dirname, '..', '..', 'src', 'lib')

function transpile(file, dir = LIB_DIR) {
  const p = path.join(dir, file)
  const { outputText } = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  })
  return { outputText, p }
}

function instantiate(file, requireShim, dir = LIB_DIR) {
  const { outputText, p } = transpile(file, dir)
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    mod.exports, requireShim, mod, p, path.dirname(p),
  )
  return mod.exports
}

// Pure siblings loaded for real -- stubbing them would hand back undefined
// for the very logic under test.
const cache = new Map()
function realLib(name) {
  if (!cache.has(name)) cache.set(name, instantiate(`${name}.ts`, shim))
  return cache.get(name)
}

let broadcastCalls = 0
let bumpCalls = 0

function shim(request) {
  if (request === '../index') return {}
  // The engine only ever calls getDb(env); handing back env.DB is the whole
  // adapter. runD1BatchInChunks lives in importEngine itself.
  if (request === './db') return { getDb: (env) => env.DB }
  if (request === './cache') return { bumpVersion: async () => { bumpCalls += 1 } }
  if (request === '../durable-objects/broadcastHub') return { broadcast: async () => { broadcastCalls += 1 } }
  if (request.startsWith('./')) {
    const name = request.slice(2)
    const file = path.join(LIB_DIR, `${name}.ts`)
    if (fs.existsSync(file)) return realLib(name)
  }
  return require(request)
}

const originalLoad = Module._load
Module._load = function patched(request, parent, isMain) {
  if (request === '../index' || request === './db' || request === './cache' || request === '../durable-objects/broadcastHub') {
    return shim(request)
  }
  if (request.startsWith('./') && fs.existsSync(path.join(LIB_DIR, `${request.slice(2)}.ts`))) {
    return realLib(request.slice(2))
  }
  return originalLoad.call(this, request, parent, isMain)
}
const engine = instantiate('importEngine.ts', shim)
Module._load = originalLoad

// --- platform fakes ---------------------------------------------------------

/**
 * Makes the harness DB speak production's contract.
 *
 * The harness's D1Compat returns D1's NATIVE shape from run(),
 * { success, meta: { changes } }, whereas src/lib/db.ts -- which the engine
 * actually uses -- unwraps it to { changes, lastInsertRowid }. Handing the
 * engine the raw harness DB makes every `result.changes` undefined.
 *
 * That is not a cosmetic difference. The lease decides whether a chunk may
 * run by comparing `result.changes === 1`, so with the wrong shape NO
 * invocation can ever claim the job and the entire import silently does
 * nothing -- which is exactly what the first run of this harness produced.
 * A fake that does not match the real contract tests the fake.
 */
function asProductionDb(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql)
      return {
        all: (params) => stmt.all(params),
        get: (params) => stmt.get(params),
        async run(params) {
          const result = await stmt.run(params)
          return {
            changes: Number(result?.meta?.changes ?? result?.changes ?? 0),
            lastInsertRowid: Number(result?.meta?.last_row_id ?? result?.lastInsertRowid ?? 0),
          }
        },
      }
    },
    batch: (statements) => db.batch(statements),
  }
}

/**
 * R2 stand-in with REAL range support.
 *
 * Ranged reads are precisely what the materialization change introduced, so
 * a fake that ignored `range` and returned the whole object would hide the
 * bug it exists to catch.
 */
function makeAssets(csvBuffer) {
  const store = new Map([['imports/e2e/source.csv', csvBuffer]])
  let rangedReads = 0
  let bytesRead = 0
  return {
    stats: () => ({ rangedReads, bytesRead }),
    async get(key, options) {
      const buf = store.get(key)
      if (!buf) return null
      const range = options && options.range
      let slice = buf
      if (range && typeof range.offset === 'number') {
        rangedReads += 1
        slice = buf.subarray(range.offset, range.offset + (range.length ?? buf.length - range.offset))
      }
      bytesRead += slice.byteLength
      const body = slice
      return {
        size: buf.byteLength, // full object size, as R2 reports for a ranged get
        async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) },
        async text() { return Buffer.from(body).toString('utf8') },
        body: null,
      }
    },
    async put(key, value) { store.set(key, Buffer.from(value)); return {} },
    async delete(key) { store.delete(key) },
    async list() { return { objects: [], truncated: false } },
  }
}

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: node scripts/harness/run_import_e2e.cjs "<path to products csv>"')
    process.exit(1)
  }
  const csvBuffer = fs.readFileSync(csvPath)
  const db = openDb(loadAll())
  const jobId = 'e2e-job-1'

  const queue = []
  const assets = makeAssets(csvBuffer)
  const env = {
    DB: asProductionDb(db),
    ASSETS: assets,
    CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
    IMPORT_QUEUE: { send: async (msg) => { queue.push(msg) } },
  }

  // Minimum viable job + file rows, matching what the upload route writes.
  await db.prepare(`INSERT INTO branches (name, is_active, is_default) VALUES ('Main', 1, 1)`).run({})
  await db.prepare(`
    INSERT INTO import_jobs (id, type, status, phase, policy_json, created_at, updated_at)
    VALUES (@id, 'products', 'queued', 'queued', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run({ id: jobId })
  await db.prepare(`
    INSERT INTO import_job_files (job_id, kind, stored_path, original_name, byte_size)
    VALUES (@id, 'csv', 'imports/e2e/source.csv', 'products.csv', @size)
  `).run({ id: jobId, size: csvBuffer.byteLength })

  const t0 = Date.now()
  let invocations = 0
  const MAX_INVOCATIONS = 5000

  async function drain(kind, run) {
    queue.length = 0
    queue.push({ jobId, kind })
    let count = 0
    while (queue.length) {
      const msg = queue.shift()
      if (msg.jobId !== jobId) continue
      count += 1
      invocations += 1
      if (invocations > MAX_INVOCATIONS) throw new Error('runaway: engine never reported done')
      await run(env, jobId, 0)
    }
    return count
  }

  const analyzeInvocations = await drain('analyze', engine.runImportAnalyze)
  const afterAnalyze = await db.prepare(`SELECT status, chunk_cursor, LENGTH(COALESCE(chunk_state_json,'')) AS state_len FROM import_jobs WHERE id = @id`).get({ id: jobId })
  const analyzeRows = await db.prepare(`SELECT action, COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'analyze' GROUP BY action`).all({ id: jobId })

  // Approve everything, exactly as the review screen does before apply.
  await db.prepare(`UPDATE import_jobs SET status = 'ready', phase = 'ready' WHERE id = @id`).run({ id: jobId })
  const applyInvocations = await drain('apply', engine.runImportApply)

  const elapsed = Date.now() - t0
  const products = (await db.prepare(`SELECT COUNT(*) AS n FROM products`).get({})).n
  const sourceRows = (await db.prepare(`SELECT COUNT(*) AS n FROM import_job_source_rows WHERE job_id = @id`).get({ id: jobId })).n
  const signatures = (await db.prepare(`SELECT COUNT(*) AS n FROM import_job_row_signatures WHERE job_id = @id`).get({ id: jobId })).n
  const finalJob = await db.prepare(`SELECT status, phase, last_error, LENGTH(COALESCE(chunk_state_json,'')) AS state_len, lease_token FROM import_jobs WHERE id = @id`).get({ id: jobId })
  const applyRows = await db.prepare(`SELECT action, COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'apply' GROUP BY action`).all({ id: jobId })

  const fmt = (rows) => rows.map((r) => `${r.action}=${r.n}`).join(' ')

  console.log('=== END-TO-END CHUNKED IMPORT ===')
  console.log(`csv bytes           : ${csvBuffer.byteLength.toLocaleString()}`)
  console.log(`materialized rows   : ${sourceRows.toLocaleString()}`)
  console.log(`analyze invocations : ${analyzeInvocations}`)
  console.log(`apply invocations   : ${applyInvocations}`)
  console.log(`ranged R2 reads     : ${assets.stats().rangedReads}`)
  console.log(`bytes read from R2  : ${assets.stats().bytesRead.toLocaleString()}  (whole-file reads would be ${(csvBuffer.byteLength * (analyzeInvocations + applyInvocations)).toLocaleString()})`)
  console.log(`analyze verdicts    : ${fmt(analyzeRows)}`)
  console.log(`apply verdicts      : ${fmt(applyRows)}`)
  console.log(`products created    : ${products.toLocaleString()}`)
  console.log(`dedupe ledger rows  : ${signatures.toLocaleString()}`)
  console.log(`chunk_state after analyze : ${afterAnalyze.state_len} chars`)
  console.log(`chunk_state at end        : ${finalJob.state_len} chars`)
  console.log(`final status        : ${finalJob.status} / ${finalJob.phase}`)
  console.log(`lease released      : ${finalJob.lease_token === null ? 'yes' : 'NO -- still held: ' + finalJob.lease_token}`)
  console.log(`last_error          : ${finalJob.last_error || '(none)'}`)
  console.log(`wall clock          : ${(elapsed / 1000).toFixed(1)}s`)

  const problems = []
  if (finalJob.last_error) problems.push(`job recorded an error: ${finalJob.last_error}`)
  if (finalJob.lease_token !== null) problems.push('lease was not released at the end')
  if (sourceRows === 0) problems.push('nothing was materialized')
  if (products === 0) problems.push('no products were created')
  if (assets.stats().rangedReads === 0) problems.push('no RANGED reads -- materialization fell back to whole-file')
  console.log(problems.length ? `\nPROBLEMS:\n  ${problems.join('\n  ')}` : '\nOK -- ran to completion with no recorded error')
  if (problems.length) process.exitCode = 1
}

void main().catch((error) => {
  console.error('E2E RUN FAILED:', error && error.stack ? error.stack : error)
  process.exitCode = 1
})
