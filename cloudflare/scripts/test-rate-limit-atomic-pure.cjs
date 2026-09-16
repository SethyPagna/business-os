// Actual TypeScript helpers + D1Compat, executing their SQL in local SQLite.
// No network, D1 binding, secrets, or package changes. Requires Node 22.13+.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function loadHelpers() {
  const cache = new Map()
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const filename = path.join(root, 'src/lib', `${name}.ts`)
    const source = process.env.SECURITY_TEST_BASE && ['rateLimit', 'verification'].includes(name)
      ? execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:cloudflare/src/lib/${name}.ts`], { cwd: root, encoding: 'utf8' })
      : fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const module = { exports: {} }
    cache.set(name, module.exports)
    new Function('exports', 'require', 'module', output)(module.exports, (request) => {
      if (request.startsWith('./')) return load(request.slice(2))
      throw new Error(`Unexpected helper dependency: ${request}`)
    }, module)
    return module.exports
  }
  return { ...load('rateLimit'), ...load('verification'), ...load('ephemeralRetention') }
}

function schema(sqlite) {
  const initial = fs.readFileSync(path.join(root, 'migrations/0001_init.sql'), 'utf8')
  sqlite.exec(initial.match(/CREATE TABLE verification_codes \([\s\S]*?\n\);/)[0])
  sqlite.exec(fs.readFileSync(path.join(root, 'migrations/0003_verification_codes.sql'), 'utf8'))
  sqlite.exec(fs.readFileSync(path.join(root, 'migrations/0004_rate_limit_events.sql'), 'utf8'))
  sqlite.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
}

// Delay every binding operation to expose the read-then-write race in the
// original helper. Batch statements execute together in a real transaction.
function binding(sqlite) {
  const plans = []
  const defer = () => new Promise((resolve) => setImmediate(resolve))
  const execute = (sql, values, mode) => {
    plans.push(...sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map((row) => row.detail))
    const statement = sqlite.prepare(sql)
    if (mode === 'first') return statement.get(...values) ?? null
    if (mode === 'all') return { results: statement.all(...values) }
    const result = statement.run(...values)
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
  }
  return {
    plans,
    prepare(sql) {
      return { bind: (...values) => ({
        sql, values,
        first: async () => { await defer(); return execute(sql, values, 'first') },
        all: async () => { await defer(); return execute(sql, values, 'all') },
        run: async () => { await defer(); return execute(sql, values, 'run') },
      }) }
    },
    async batch(statements) {
      await defer()
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(({ sql, values }) => execute(sql, values, 'run'))
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
}

if (!isMainThread) {
  const sqlite = new DatabaseSync(workerData.file)
  sqlite.exec('PRAGMA busy_timeout = 10000')
  const helper = loadHelpers()
  parentPort.postMessage('ready')
  parentPort.once('message', async () => {
    try {
      const result = await helper.checkRateLimit({ DB: binding(sqlite) }, 'parallel', 'same', 20, 60_000)
      parentPort.postMessage(result)
    } catch (error) { throw error } finally { sqlite.close() }
  })
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}

async function main() {
  const helper = loadHelpers()
  const sqlite = new DatabaseSync(':memory:')
  schema(sqlite)
  const DB = binding(sqlite)
  const env = { DB, BUSINESS_OS_ADMIN_URL: 'https://admin.example.invalid' }
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  const check = (bucket = 'test', key = 'client', max = 20, window = 60_000) => helper.checkRateLimit(env, bucket, key, max, window)
  const clear = () => sqlite.exec('DELETE FROM rate_limit_events; DELETE FROM verification_codes')
  const rateRow = (timestamp, bucket = 'test', key = 'client') => sqlite.prepare('INSERT INTO rate_limit_events(bucket, client_key, created_at) VALUES (?, ?, ?)').run(bucket, key, timestamp)
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n
  const issue = (user = 1, ip = 'ip') => helper.issuePasswordResetLink(env, user, 'test@example.invalid', env.BUSINESS_OS_ADMIN_URL, ip)
  const originalWarn = console.warn
  // Email is deliberately disabled; any accidental fetch fails this suite.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Network forbidden in security fixture') }
  console.warn = () => {}
  try {
    const sequential = []
    for (let i = 0; i < 25; i++) sequential.push(await check())
    assert.equal(sequential.filter((r) => r.allowed).length, 20, 'sequential: exactly 20 of 25 admitted')
    assert.equal(count('rate_limit_events'), 20, 'denials do not grow the event table')
    assert.deepEqual(sequential[24], { allowed: false, retryAfterSeconds: 60 })
    clear()
    const concurrent = await Promise.all(Array.from({ length: 25 }, () => check()))
    assert.equal(concurrent.filter((r) => r.allowed).length, 20, 'concurrent: exactly 20 of 25 admitted')
    assert.equal(count('rate_limit_events'), 20)
    assert.equal((await check('other')).allowed, true)
    assert.equal((await check('test', 'other')).allowed, true)
    assert.ok(DB.plans.some((p) => /SEARCH.*idx_rate_limit_events_lookup.*created_at>/.test(p)), 'indexed timestamp range search')
    console.log('PASS sequential/concurrent quotas, denial storage, retry header, key/bucket isolation, index range')

    for (const invalid of [0, -1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '20', null]) {
      await assert.rejects(() => check('invalid', 'client', invalid), RangeError)
      await assert.rejects(() => check('invalid', 'client', 20, invalid), RangeError)
    }
    await assert.rejects(() => check('invalid', 'client', 20, Number.MAX_SAFE_INTEGER), RangeError)
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM rate_limit_events WHERE bucket='invalid'").get().n, 0)
    await assert.rejects(() => helper.checkRateLimit({ DB: { prepare() { throw new Error('storage unavailable') } } }, 'x', 'x', 1, 1000), /storage unavailable/)
    console.log('PASS invalid limits/windows and storage errors fail closed')

    now = Date.parse('2026-09-05T00:00:30.500Z')
    clear()
    rateRow('2026-09-04 23:59:30.500') // exact cutoff: expired
    rateRow('2026-09-04 23:59:30') // legacy whole second: expired
    rateRow('2026-09-04 23:59:31') // legacy whole second: active
    assert.equal((await check('test', 'client', 2)).allowed, true)
    assert.equal((await check('test', 'client', 2)).allowed, false)
    now += 60_000
    assert.equal((await check('test', 'client', 2)).allowed, true, 'events at exact cutoff expire')
    clear()
    now = Date.parse('2026-09-05T12:00:00.123Z')
    assert.equal((await check('test', 'client', 1, 1)).allowed, true)
    assert.equal((await check('test', 'client', 1, 1)).allowed, false)
    now++
    assert.equal((await check('test', 'client', 1, 1)).allowed, true)
    console.log('PASS midnight, legacy SQLite timestamps, exact cutoff and millisecond windows')

    clear()
    const perUser = await Promise.all(Array.from({ length: 10 }, () => issue()))
    assert.equal(perUser.filter((r) => r.issued).length, 3)
    assert.equal(count('verification_codes'), 3)
    const live = sqlite.prepare('SELECT code_hash FROM verification_codes WHERE consumed_at IS NULL').get().code_hash
    assert.deepEqual(await issue(), { issued: false, sent: false })
    assert.equal(sqlite.prepare('SELECT code_hash FROM verification_codes WHERE consumed_at IS NULL').get().code_hash, live, 'denial preserves latest link')
    assert.equal((await issue(2, 'another-ip')).issued, true)
    clear()
    const perIp = await Promise.all(Array.from({ length: 15 }, (_, i) => issue(i + 1)))
    assert.equal(perIp.filter((r) => r.issued).length, 8)
    assert.equal(count('verification_codes'), 8)
    assert.equal((await issue(99, 'other-ip')).issued, true)
    assert.equal((await issue(100, null)).issued, true)
    assert.ok(DB.plans.some((p) => /SEARCH.*idx_verification_codes_user_purpose.*created_at>/.test(p)))
    assert.ok(DB.plans.some((p) => /SEARCH.*idx_verification_codes_ip_created.*created_at>/.test(p)))
    console.log('PASS atomic reset per-user/per-IP quotas, isolation, denied-link preservation and index ranges')

    clear()
    await issue()
    sqlite.exec("CREATE TRIGGER reject_reset_update BEFORE UPDATE ON verification_codes BEGIN SELECT RAISE(ABORT, 'constraint failed: fixture rollback'); END")
    await assert.rejects(() => issue(), /fixture rollback/)
    assert.equal(count('verification_codes'), 1, 'failed invalidation rolls back new link')
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM verification_codes WHERE consumed_at IS NULL').get().n, 1)
    sqlite.exec('DROP TRIGGER reject_reset_update')
    clear()
    let loseResponse = true
    let newerHash
    const retryEnv = { ...env, DB: { ...DB, async batch(statements) {
      const results = await DB.batch(statements)
      if (loseResponse) {
        loseResponse = false
        await issue() // Another request wins before the adapter retries.
        newerHash = sqlite.prepare('SELECT code_hash FROM verification_codes WHERE consumed_at IS NULL').get().code_hash
        throw new Error('network: committed response lost')
      }
      return results
    } } }
    assert.deepEqual(await helper.issuePasswordResetLink(retryEnv, 1, 'test@example.invalid', env.BUSINESS_OS_ADMIN_URL, 'ip'), { issued: false, sent: false })
    assert.equal(count('verification_codes'), 2, 'adapter retry cannot duplicate a usable token')
    assert.equal(sqlite.prepare('SELECT code_hash FROM verification_codes WHERE consumed_at IS NULL').get().code_hash, newerHash, 'retry cannot invalidate a newer admitted link')
    console.log('PASS atomic rollback and ambiguous-response retry without duplicate tokens')

    async function seedToken(token, expiry, created = '2026-09-04 23:59:00', user = 1, purpose = 'password_reset_link', ip = 'ip') {
      const hash = require('node:crypto').createHash('sha256').update(token).digest('hex')
      sqlite.prepare('INSERT INTO verification_codes(user_id, purpose, code_hash, expires_at, created_at, requester_ip) VALUES (?, ?, ?, ?, ?, ?)').run(user, purpose, hash, expiry, created, ip)
    }
    clear()
    now = Date.parse('2026-09-05T00:05:00Z')
    for (let i = 0; i < 3; i++) await seedToken(`old${i}`, '2026-09-05 00:30:00')
    assert.equal((await issue()).issued, false, 'reset quota crosses midnight with legacy timestamps')
    now = Date.parse('2026-09-05T00:14:00Z')
    assert.equal((await issue()).issued, true, 'reset legacy entries at exact cutoff expire')
    clear()
    for (let i = 0; i < 3; i++) await seedToken(`purpose${i}`, '2026-09-05 00:30:00', '2026-09-05 00:13:00', 1, 'other-purpose', 'other-ip')
    assert.equal((await issue()).issued, true, 'user quota is purpose isolated')
    console.log('PASS reset midnight/cutoff and purpose isolation')

    for (const expiry of ['2026-09-05 00:15:00', '2026-09-05T00:15:00.000Z', '2026-09-05T08:15:00+08:00']) {
      clear()
      await seedToken('valid', expiry)
      const results = await Promise.all(Array.from({ length: 10 }, () => helper.consumePasswordResetLink(env, 'valid')))
      assert.equal(results.filter((r) => r.ok).length, 1, `UTC expiry + one-time consumption: ${expiry}`)
    }
    for (const expiry of ['2026-09-05 00:14:00', '2026-09-05T00:13:59.999Z', 'invalid', '', '2026-02-30 00:00:00', '2026-09-05 24:00:00']) {
      clear()
      await seedToken('expired', expiry)
      assert.deepEqual(await helper.consumePasswordResetLink(env, 'expired'), { ok: false, reason: 'expired' }, expiry)
    }
    console.log('PASS UTC/ISO/offset expiry, malformed dates, exact expiration and concurrent single use')

    // Use the real retention helper. Irrelevant absent tables are expected and
    // independently caught by it; assert the two owned tables' actual results.
    clear()
    now = realNow()
    await check()
    rateRow('2000-01-01 00:00:00')
    await issue()
    await seedToken('cleanup-expired', '2000-01-01 00:00:00')
    const originalError = console.error
    console.error = () => {}
    let retention
    try { retention = await helper.maybeRunScheduledEphemeralRetention(env) } finally { console.error = originalError }
    assert.equal(retention.deleted.rate_limit_events, 1)
    assert.equal(retention.deleted.verification_codes, 1)
    assert.equal(count('rate_limit_events'), 1)
    assert.equal(count('verification_codes'), 1)
    assert.match(sqlite.prepare('SELECT expires_at FROM verification_codes').get().expires_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/)
    console.log('PASS actual scheduled cleanup removes expired rows and preserves new active rows')

    const cleanup = async () => {
      sqlite.exec('DELETE FROM settings') // Make each independent fixture due.
      const previousError = console.error
      console.error = () => {}
      try { return await helper.maybeRunScheduledEphemeralRetention(env) }
      finally { console.error = previousError }
    }
    clear()
    now = Date.parse('2026-09-05T00:30:00.500Z')
    for (let i = 0; i < 3; i++) assert.equal((await issue()).issued, true)
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM verification_codes WHERE consumed_at IS NOT NULL').get().n, 2)
    assert.equal((await cleanup()).deleted.verification_codes, 0, 'cleanup retains consumed active quota history')
    assert.equal(count('verification_codes'), 3)
    assert.equal((await issue()).issued, false, 'cleanup cannot reopen per-user quota')
    clear()
    for (let i = 0; i < 8; i++) assert.equal((await issue(i + 1)).issued, true)
    sqlite.exec("UPDATE verification_codes SET consumed_at = '2026-09-05 00:30:00.500'")
    assert.equal((await cleanup()).deleted.verification_codes, 0)
    assert.equal((await issue(99)).issued, false, 'cleanup cannot reopen per-IP quota')

    clear()
    // Cross-midnight one-hour boundary, with millisecond precision.
    const recent = '2026-09-04 23:30:00.501'
    const boundary = '2026-09-04 23:30:00.500'
    const old = '2026-09-04 23:00:00'
    await seedToken('recent-consumed', '2026-09-05T00:00:00Z', recent)
    await seedToken('recent-expired', '2026-09-05 00:00:00', recent)
    await seedToken('boundary-consumed', '2026-09-06 00:00:00', boundary)
    await seedToken('old-consumed', 'not-a-date', old)
    await seedToken('old-expired-iso', '2026-09-05T00:30:00.500Z', old)
    await seedToken('old-expired-sqlite', '2026-09-05 00:30:00.500', old)
    await seedToken('old-expired-offset', '2026-09-05T08:30:00.500+08:00', old)
    await seedToken('old-valid-iso', '2026-09-05T00:30:00.501Z', old)
    await seedToken('old-valid-sqlite', '2026-09-05 00:30:00.501', old)
    await seedToken('old-valid-offset', '2026-09-05T08:30:00.501+08:00', old)
    await seedToken('old-invalid-expiry', 'not-a-date', old)
    for (const token of ['recent-consumed', 'boundary-consumed', 'old-consumed']) {
      const hash = require('node:crypto').createHash('sha256').update(token).digest('hex')
      sqlite.prepare('UPDATE verification_codes SET consumed_at = ? WHERE code_hash = ?').run('2026-09-05 00:30:00.500', hash)
    }
    const cleaned = await cleanup()
    assert.equal(cleaned.deleted.verification_codes, 5)
    const remaining = new Set(sqlite.prepare('SELECT code_hash FROM verification_codes').all().map((row) => row.code_hash))
    const expected = ['recent-consumed', 'recent-expired', 'old-valid-iso', 'old-valid-sqlite', 'old-valid-offset', 'old-invalid-expiry']
    assert.deepEqual(remaining, new Set(expected.map((token) => require('node:crypto').createHash('sha256').update(token).digest('hex'))))
    // Throttling still applies after a completed sweep.
    assert.deepEqual(await helper.maybeRunScheduledEphemeralRetention(env), { skipped: true, reason: 'ran-recently' })
    console.log('PASS actual cleanup preserves one-hour quota history, user/IP denial, mixed UTC expiry and sweep throttle')
  } finally {
    Date.now = realNow
    globalThis.fetch = originalFetch
    console.warn = originalWarn
    sqlite.close()
  }

  // Independent SQLite connections contend for the same file, as separate
  // isolates do. The barrier ensures all 25 helpers start before any finishes.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-security-atomic-'))
  const file = path.join(temp, 'rate.sqlite')
  const shared = new DatabaseSync(file)
  shared.exec('PRAGMA journal_mode=WAL')
  schema(shared)
  const workers = []
  try {
    const pending = Array.from({ length: 25 }, () => {
      const worker = new Worker(__filename, { workerData: { file } })
      workers.push(worker)
      let readyResolve
      const ready = new Promise((resolve) => { readyResolve = resolve })
      const result = new Promise((resolve, reject) => {
        worker.on('error', reject)
        worker.on('message', (message) => message === 'ready' ? readyResolve() : resolve(message))
      })
      return { ready, result }
    })
    await Promise.all(pending.map((p) => p.ready))
    workers.forEach((worker) => worker.postMessage('start'))
    const results = await Promise.all(pending.map((p) => p.result))
    assert.equal(results.filter((r) => r.allowed).length, 20)
    assert.equal(shared.prepare('SELECT COUNT(*) n FROM rate_limit_events').get().n, 20)
    console.log('PASS 25 concurrent worker connections admit exactly 20 and store exactly 20')
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()))
    shared.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
  console.log('All atomic rate-limit and verification SQLite tests passed')
}
