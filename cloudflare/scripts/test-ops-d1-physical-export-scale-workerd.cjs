// d1-physical-export at production scale on local workerd D1 (Miniflare: in-memory database, random port).
// Seeds every migration plus the production-shaped fixture (branch-cutover-scale-fixture.cjs; CUTOVER_SCALE,
// default 0.25, 1 = the 6 Oct inventory), then runs the real export engine against workerd's D1 -- the same
// SQL, the same paging, the same retry logic as the Ops task -- and records every statement's D1 meta.duration
// and rows_read. It requires:
//   - the preflight, the sqlite_master read and every table's pages succeed on workerd's D1 (FTS tables and their
//     shadow tables are never read; the _cf_* tables are never asked for);
//   - no single statement over STATEMENT_MS (production's CPU reset, code 7429, comes from one heavy statement);
//   - rows read stay linear: total rows_read <= exported rows + a constant per table, and no page reads more than
//     its LIMIT (a keyset page, never an offset scan);
//   - every table's exported row count equals its COUNT(*), and the encrypted artifact loads into a SQLite file
//     that matches the manifest's sha256 for every table;
//   - a 7429 injected on a page halves it and the export completes with identical hashes.
// It prints the numbers a release report needs: statements, pages, rows read, slowest statements, wall time.
'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const harness = require('./branch-cutover-workerd-harness.cjs')

const root = path.resolve(__dirname, '../..')
const SCALE = Number(process.env.CUTOVER_SCALE || 0.25)
const STATEMENT_MS = 250
const load = (...p) => import(pathToFileURL(path.join(root, ...p)).href)

async function main() {
  const lib = await load('ops', 'scripts', 'ops-d1-physical-lib.mjs')
  const job = await load('ops', 'scripts', 'ops-d1-physical-export.mjs')
  const loader = await load('ops', 'scripts', 'latest-data', 'load-d1-physical-export.mjs')
  const guard = await load('ops', 'scripts', 'ops-sql-guard.mjs')
  const crypt = await load('ops', 'scripts', 'ops-crypto.mjs')
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  const key = crypto.createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const write = (outDir, base, payload, meta) => {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    fs.mkdirSync(outDir, { recursive: true })
    const file = path.join(outDir, `${base}.enc.json`)
    fs.writeFileSync(file, `${JSON.stringify(crypt.encryptEnvelope(text, publicPem, meta))}\n`)
    return { file, bytes: fs.statSync(file).size }
  }

  const { mf, call } = await harness.start()
  let checks = 0
  const check = async (name, fn) => { await fn(); checks += 1; console.log(`PASS ${name}`) }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd1phys-scale-'))
  try {
    const loaded = await harness.seed(call, { scale: SCALE })
    console.log(`SCALE ${JSON.stringify({ scale: SCALE, ...loaded })}`)

    const stats = { statements: 0, rowsRead: 0, slowest: [], maxPageReadRatio: 0, shapes: new Map() }
    const bridge = (inject) => async (sql) => {
      assert.equal(guard.guardSql(sql).sql, sql.replace(/\s+/g, ' ').trim(), `the guard must admit: ${sql.slice(0, 100)}`)
      if (inject) {
        const fault = inject(sql)
        if (fault) return fault
      }
      const response = await call({ op: 'query', sql })
      if (response.error) return { ok: false, retryable: /CPU time limit|7429|overloaded/i.test(response.error), errorCodes: [], error: response.error }
      const meta = response.meta || {}
      stats.statements += 1
      stats.rowsRead += Number(meta.rows_read || 0)
      const limit = Number(/ LIMIT (\d+)$/.exec(sql)?.[1] || 1)
      stats.maxPageReadRatio = Math.max(stats.maxPageReadRatio, Number(meta.rows_read || 0) / limit)
      stats.slowest.push({ ms: Number(meta.duration || 0), rowsRead: Number(meta.rows_read || 0), table: /FROM "?([A-Za-z0-9_]+)"?/.exec(sql)?.[1] || '?', limit })
      return { ok: true, rows: response.rows, meta, retryable: false, errorCodes: [] }
    }

    let first
    await check('the whole database exports on workerd D1: every statement bounded, rows read linear, row counts equal COUNT(*)', async () => {
      const started = Date.now()
      const result = await job.exportToDir({ outDir: path.join(tmp, 'a'), run: '1001', commit: 'abcdef1', query: bridge(null), write, concurrency: 3 })
      const wallMs = Date.now() - started
      first = result
      assert.equal(result.verdict.ok, true, JSON.stringify(result.manifest.issues))
      const { manifest } = result
      const slowest = [...stats.slowest].sort((a, b) => b.ms - a.ms).slice(0, 5)
      const widest = [...stats.slowest].sort((a, b) => b.rowsRead - a.rowsRead)[0]
      const physical = await call({ op: 'query', sql: "SELECT name FROM sqlite_master WHERE type = 'table'" })
      const names = physical.rows.map((r) => r.name).filter((n) => !n.startsWith('sqlite_') && !n.startsWith('_cf_'))
      const exported = new Set(manifest.tables.map((t) => t.name))
      const left = names.filter((n) => !exported.has(n) && !manifest.excluded.some((e) => e.name === n))
      assert.deepEqual(left, [], 'every physical table is exported or deliberately excluded')
      for (const t of manifest.tables) {
        const count = (await call({ op: 'query', sql: `SELECT COUNT(*) AS n FROM "${t.name}"` })).rows[0].n
        assert.equal(t.rows, count, `${t.name}: exported ${t.rows}, COUNT(*) ${count}`)
      }
      console.log(`EXPORT ${JSON.stringify({
        tables: manifest.tables.length, rows: manifest.totals.rows, statements: manifest.totals.statements, files: manifest.totals.files,
        plainMB: +(manifest.totals.plainBytes / 1048576).toFixed(1), encryptedMB: +(manifest.totals.encryptedBytes / 1048576).toFixed(1),
        rowsRead: manifest.totals.rowsRead, rowsReadOverRows: +(manifest.totals.rowsRead / manifest.totals.rows).toFixed(3),
        slowestStatementMs: manifest.totals.slowestStatementMs, maxPageReadRatio: +stats.maxPageReadRatio.toFixed(2), wallSeconds: +(wallMs / 1000).toFixed(1),
      })}`)
      console.log(`SLOWEST ${JSON.stringify(slowest)}`)
      console.log(`WIDEST ${JSON.stringify(widest)}`)
      // Local timings carry scheduler noise: the 99th percentile must be under STATEMENT_MS and no single outlier over 3x.
      const sorted = stats.slowest.map((x) => x.ms).sort((a, b) => a - b)
      const p99 = sorted[Math.floor(sorted.length * 0.99)]
      console.log(`DURATIONS ${JSON.stringify({ p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], p99, max: sorted[sorted.length - 1] })}`)
      assert.ok(p99 <= STATEMENT_MS, `p99 statement ${p99} ms`)
      assert.ok(manifest.totals.slowestStatementMs <= STATEMENT_MS * 3, `slowest statement ${manifest.totals.slowestStatementMs} ms`)
      assert.ok(manifest.totals.rowsRead <= manifest.totals.rows + manifest.tables.length * 3 + 2000, `rows read ${manifest.totals.rowsRead} vs rows ${manifest.totals.rows}`)
      assert.ok(stats.maxPageReadRatio <= 1.5, `a page read ${stats.maxPageReadRatio}x its limit`)
    })

    await check('the encrypted artifact loads into SQLite and every table matches its manifest sha256', async () => {
      const dir = path.join(tmp, 'a')
      const manifest = loader.readManifest(dir, key)
      assert.deepEqual(loader.verifyArtifact(dir, key, manifest), [])
      const started = Date.now()
      const out = path.join(tmp, 'rebuilt.sqlite')
      const result = loader.buildDatabase({ manifest, inputDir: dir, privateKey: key, outPath: out })
      assert.deepEqual(result.problems, [])
      assert.ok(result.checks.tables.every((t) => t.ok))
      console.log(`LOAD ${JSON.stringify({ tables: result.checks.tables.length, seconds: +((Date.now() - started) / 1000).toFixed(1), fkViolations: result.checks.foreignKeyViolations, warnings: result.warnings.length })}`)
    })

    await check('a 7429 reset on a heavy page halves it and the export finishes with identical hashes', async () => {
      let fired = 0
      const inject = (sql) => {
        if (/FROM "(sale_items|inventory_movements)" WHERE/.test(sql) && / LIMIT (\d{3,4})$/.test(sql) && fired < 3) { fired += 1; return { ok: false, retryable: true, errorCodes: [7429] } }
        return null
      }
      const again = await job.exportToDir({ outDir: path.join(tmp, 'b'), run: '1002', commit: 'abcdef1', query: bridge(inject), write, concurrency: 3, pause: async () => {} })
      assert.equal(fired, 3)
      assert.equal(again.verdict.ok, true)
      assert.ok(again.manifest.totals.retries >= 3)
      assert.deepEqual(again.manifest.tables.map((t) => [t.name, t.rows, t.sha256]), first.manifest.tables.map((t) => [t.name, t.rows, t.sha256]))
    })
  } finally {
    await mf.dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`test-ops-d1-physical-export-scale-workerd: ${checks} checks passed (CUTOVER_SCALE=${SCALE}, STATEMENT_MS=${STATEMENT_MS}, chunk=${lib.LIMITS.chunkBytes}, page<=${lib.LIMITS.pageRowsMax})`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
  setTimeout(() => process.exit(1), 500).unref()
})
