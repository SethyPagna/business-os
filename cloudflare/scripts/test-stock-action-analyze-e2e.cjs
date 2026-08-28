// Drives the real multi-invocation stock_actions ANALYZE path from a ranged
// R2 CSV read through persisted review rows and the final conflict seal.
// This is deliberately broader than the resolver/seal unit tests: Screen 2
// reads these exact import_job_rows + summary_json records.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const LIB_DIR = path.join(__dirname, '..', 'src', 'lib')

function instantiate(file, requireShim) {
  const filePath = path.join(LIB_DIR, file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    mod.exports, requireShim, mod, filePath, path.dirname(filePath),
  )
  return mod.exports
}

const moduleCache = new Map()
function realLib(name) {
  if (!moduleCache.has(name)) moduleCache.set(name, instantiate(`${name}.ts`, shim))
  return moduleCache.get(name)
}
function shim(request) {
  if (request === '../index') return {}
  if (request === './db') return { getDb: (env) => env.DB }
  if (request === './cache') return { bumpVersion: async () => {} }
  if (request === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
  if (request.startsWith('./')) {
    const name = request.slice(2)
    if (fs.existsSync(path.join(LIB_DIR, `${name}.ts`))) return realLib(name)
  }
  return require(request)
}

const originalLoad = Module._load
Module._load = function patched(request, parent, isMain) {
  if (request === '../index' || request === './db' || request === './cache' || request === '../durable-objects/broadcastHub') return shim(request)
  if (request.startsWith('./') && fs.existsSync(path.join(LIB_DIR, `${request.slice(2)}.ts`))) return realLib(request.slice(2))
  return originalLoad.call(this, request, parent, isMain)
}
const engine = instantiate('importEngine.ts', shim)
Module._load = originalLoad

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

function makeAssets(csv) {
  let bytes = Buffer.from(csv, 'utf8')
  let rangedReads = 0
  return {
    stats: () => ({ rangedReads, size: bytes.byteLength }),
    replace(nextCsv) { bytes = Buffer.from(nextCsv, 'utf8') },
    async get(key, options) {
      if (key !== 'imports/stock-actions.csv') return null
      const range = options?.range
      const offset = Number(range?.offset || 0)
      const length = Number(range?.length || bytes.byteLength)
      const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + length))
      if (range) rangedReads += 1
      return {
        size: bytes.byteLength,
        async arrayBuffer() { return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) },
      }
    },
  }
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildCrossWindowCsv() {
  const header = ['name', 'barcode', 'shop', 'warehouse', 'date', 'action', 'selling_price', 'vip_price', 'cost_price', 'batch']
  const rows = []
  rows.push(['Anchor Serum', 'ANCHOR', '1', '', '08/27/2026', 'add', '12', '', '4', 'LOT-A'])
  // 149 distinct, valid rows ensure the other Anchor row lands in the next
  // 150-row classification window. They are new products and therefore
  // preview as creates; analyze must not write any of them to products.
  for (let i = 0; i < 149; i += 1) {
    rows.push([`Filler ${i}`, `F${i}`, '1', '', '08/27/2026', 'add', '5', '', '2', `FILL-${i}`])
  }
  rows.push(['Anchor Serum', 'ANCHOR', '1', '', '08/27/2026', 'add', '12', '', '7', 'LOT-B'])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

async function seedJob(db, id, csvSize, cancelRequested = 0, mode = 'direct') {
  await db.prepare(`INSERT INTO import_jobs
      (id, type, status, phase, policy_json, cancel_requested, created_at, updated_at)
    VALUES (@id, 'stock_actions', 'queued', 'queued', @policy, @cancel, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run({ id, policy: JSON.stringify({ stock_action_mode: mode }), cancel: cancelRequested })
  await db.prepare(`INSERT INTO import_job_files (job_id, kind, stored_path, original_name, byte_size)
    VALUES (@id, 'csv', 'imports/stock-actions.csv', 'stock-actions.csv', @size)`).run({ id, size: csvSize })
}

async function drainAnalyze(env, jobId) {
  const queue = env.__queue
  queue.push({ jobId, kind: 'analyze' })
  let invocations = 0
  while (queue.length) {
    const message = queue.shift()
    if (message.jobId !== jobId || message.kind !== 'analyze') continue
    invocations += 1
    if (invocations > 30) throw new Error('Analyze continuation did not converge')
    await engine.runImportAnalyze(env, jobId, 0)
  }
  return invocations
}

;(async () => {
  const rawDb = openDb(loadAll())
  const db = asProductionDb(rawDb)
  const csv = buildCrossWindowCsv()
  const assets = makeAssets(csv)
  const queue = []
  const env = {
    DB: db,
    ASSETS: assets,
    IMPORT_QUEUE: { send: async (message) => queue.push(message) },
    __queue: queue,
  }
  await db.prepare(`INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1), (2, 'Warehouse', 1, 0)`).run({})
  await db.prepare(`INSERT INTO products
      (id, name, barcode, selling_price_usd, cost_price_usd, stock_quantity, is_active)
    VALUES (10, 'Anchor Serum', 'ANCHOR', 12, 4, 0, 1)`).run({})
  await db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 0), (10, 2, 0)`).run({})
  await seedJob(db, 'analyze-e2e', Buffer.byteLength(csv))

  const invocations = await drainAnalyze(env, 'analyze-e2e')
  assert.ok(invocations >= 4, 'materialization and two classify windows ran as separate invocations')
  assert.ok(assets.stats().rangedReads >= 2, 'the CSV was consumed through bounded R2 range reads')

  const job = await db.prepare(`SELECT status, phase, total_rows, processed_rows, failed_rows,
      warning_count, summary_json, lease_token FROM import_jobs WHERE id = @id`).get({ id: 'analyze-e2e' })
  const summary = JSON.parse(job.summary_json)
  assert.strictEqual(job.status, 'awaiting_review')
  assert.strictEqual(job.phase, 'awaiting_review')
  assert.strictEqual(job.total_rows, 151)
  assert.strictEqual(job.processed_rows, 0)
  assert.strictEqual(job.failed_rows, 0)
  assert.strictEqual(job.lease_token, null, 'every continuation releases its single-writer lease')
  assert.strictEqual(summary.requires_stock_action_confirmation, true)
  assert.strictEqual(summary.stock_action_confirmation_rows, 2)
  assert.strictEqual(summary.total, 151)
  assert.strictEqual(summary.updated, 2)
  assert.strictEqual(summary.created, 149)
  assert.strictEqual(job.warning_count, 2)

  const sourceCount = await db.prepare(`SELECT COUNT(*) AS n FROM import_job_source_rows WHERE job_id = @id`).get({ id: 'analyze-e2e' })
  const reviewCount = await db.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'analyze'`).get({ id: 'analyze-e2e' })
  assert.strictEqual(sourceCount.n, 151)
  assert.strictEqual(reviewCount.n, 151, 'Screen 2 has one persisted review result per source row')

  const anchorRows = await db.prepare(`SELECT row_number, action, result_json FROM import_job_rows
    WHERE job_id = @id AND phase = 'analyze'
      AND json_extract(result_json, '$.data.identityKey') = 'product:10'
    ORDER BY row_number`).all({ id: 'analyze-e2e' })
  assert.deepStrictEqual(anchorRows.map((row) => row.row_number), [2, 152])
  for (const row of anchorRows) {
    const result = JSON.parse(row.result_json)
    assert.strictEqual(row.action, 'update')
    assert.ok(result.warnings.some((warning) => warning.kind === 'stock_action_conflict'))
    assert.ok(result.data.conflicts.length > 0)
  }

  // Analyze is preview-only: even 149 create verdicts cannot mutate live data.
  assert.strictEqual((await db.prepare(`SELECT COUNT(*) AS n FROM products`).get({})).n, 1)
  assert.strictEqual((await db.prepare(`SELECT COUNT(*) AS n FROM product_batches`).get({})).n, 0)
  assert.strictEqual((await db.prepare(`SELECT COUNT(*) AS n FROM inventory_movements`).get({})).n, 0)

  // Cancellation is checked before R2 materialization or review writes.
  await seedJob(db, 'analyze-cancelled', Buffer.byteLength(csv), 1)
  const readsBeforeCancel = assets.stats().rangedReads
  await drainAnalyze(env, 'analyze-cancelled')
  const cancelled = await db.prepare(`SELECT status, phase, lease_token FROM import_jobs WHERE id = @id`).get({ id: 'analyze-cancelled' })
  assert.strictEqual(cancelled.status, 'cancelled')
  assert.strictEqual(cancelled.phase, 'cancelled')
  assert.strictEqual(cancelled.lease_token, null)
  assert.strictEqual(assets.stats().rangedReads, readsBeforeCancel)
  assert.strictEqual((await db.prepare(`SELECT COUNT(*) AS n FROM import_job_source_rows WHERE job_id = @id`).get({ id: 'analyze-cancelled' })).n, 0)

  // The analyzer rejects oversized RECONCILE stock sheets before
  // classification, so an operator cannot spend time reviewing a job the
  // apply path will refuse later (reconcile's delta math needs one live
  // snapshot, so its 480-row cap is real). DIRECT mode is different since
  // Part 388: its M4 continuation engine handles up to 25,000 rows across
  // windows, so the same 481-row file must sail through analyze -- the
  // 21k-row history migration file depends on exactly that.
  const header = 'name,barcode,shop,warehouse,date,action,selling_price,vip_price,cost_price,batch'
  const oversizedCsv = `${header}\n${Array.from({ length: 481 }, (_, i) => `Raw ${i},R${i},1,,08/27/2026,add,5,,2,B${i}`).join('\n')}\n`
  assets.replace(oversizedCsv)
  await seedJob(db, 'analyze-oversized-direct', Buffer.byteLength(oversizedCsv), 0, 'direct')
  await drainAnalyze(env, 'analyze-oversized-direct')
  const directOversized = await db.prepare(`SELECT status, phase FROM import_jobs WHERE id = @id`).get({ id: 'analyze-oversized-direct' })
  assert.strictEqual(directOversized.status, 'awaiting_review', '481 direct rows must reach review (continuation engine handles them)')
  await seedJob(db, 'analyze-oversized', Buffer.byteLength(oversizedCsv), 0, 'reconcile')
  await assert.rejects(() => drainAnalyze(env, 'analyze-oversized'), /481 rows.*at most 480 rows/)
  const oversized = await db.prepare(`SELECT status, phase, last_error, lease_token FROM import_jobs WHERE id = @id`).get({ id: 'analyze-oversized' })
  assert.strictEqual(oversized.status, 'failed')
  assert.strictEqual(oversized.phase, 'failed')
  assert.match(oversized.last_error, /481 rows.*at most 480 rows/)
  assert.strictEqual(oversized.lease_token, null)
  assert.strictEqual((await db.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE job_id = @id`).get({ id: 'analyze-oversized' })).n, 0)

  console.log('PASS stock_actions analyze runs CSV -> bounded materialization -> cross-window sealed Screen 2 data, with preview-only and cancellation guards')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
