// P4-4a: audit() must cost exactly ONE D1 round trip.
//
// Before this fix audit() (lib/audit.ts) did THREE sequential awaited D1
// calls per invocation -- lookupAuditDeviceInfo (SELECT), resolveAuditActorName
// (SELECT), then the INSERT -- and it is awaited at 135+ call sites across
// routes/*.ts, so every one of those request paths paid for three network
// round trips where one would do. This test keeps the OLD three-step body as
// an inline oracle (it is deleted from the source, so this is the only place
// it still runs), runs it against a freshly seeded SQLite database, then runs
// the REAL (post-fix) lib/audit.ts audit() against an identically seeded
// database, and asserts:
//   1. the two produce byte-identical audit_logs rows (same user_name
//      resolution, same device_name/device_tz, same fallbacks), and
//   2. the real audit() issues exactly ONE statement execution per call,
//      where the oracle issues three (when userId is set) or one (when it
//      is not, since the old code short-circuited both lookups on !userId).
//
// This is RED against the pre-fix source: the pre-fix audit() IS the oracle
// body, so asserting the real module needs only one statement fails there
// with "expected 3 to equal 1".
//
// Run: node scripts/test-audit-single-roundtrip-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// ---------------------------------------------------------------------------
// A statement-execution counter around the harness D1Compat. Each get/run/all
// call is one D1 round trip in production (prepare() is client-side only); a
// batch() call is one round trip regardless of how many statements it holds.
// ---------------------------------------------------------------------------
function countingDb(inner) {
  let statements = 0
  const wrap = (stmt) => ({
    bind(params) { stmt.bind(params); return this },
    get(params) { statements += 1; return stmt.get(params) },
    all(params) { statements += 1; return stmt.all(params) },
    run(params) { statements += 1; return stmt.run(params) },
  })
  return {
    db: {
      prepare(sql) { return wrap(inner.prepare(sql)) },
      exec(sql) { return inner.exec(sql) },
      async batch(items) { statements += 1; return inner.batch(items) },
    },
    stats: () => ({ statements }),
  }
}

function seed(rawDb, { userId, username, sessionDeviceName, sessionDeviceTz, revoked = false }) {
  if (userId != null) {
    rawDb.prepare(
      'INSERT INTO users (id, username, name, password, is_active) VALUES (@id, @username, @name, @password, 1)',
    ).run({ id: userId, username, name: `${username} Full Name`, password: 'x' })
    if (sessionDeviceName !== undefined) {
      rawDb.prepare(`
        INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, expires_at, revoked_at, last_seen_at)
        VALUES (@user_id, 'hash', @device_name, @device_tz, '2999-01-01', @revoked_at, @last_seen_at)
      `).run({
        user_id: userId,
        device_name: sessionDeviceName,
        device_tz: sessionDeviceTz,
        revoked_at: revoked ? '2020-01-01' : null,
        last_seen_at: '2026-01-01 00:00:00',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// The pre-fix body, verbatim (ported from the git history of lib/audit.ts
// before P4-4a). This is the oracle: it is gone from the real source, this is
// the only place left that exercises it.
// ---------------------------------------------------------------------------
async function oldLookupAuditDeviceInfo(db, userId) {
  if (!userId) return { device_name: null, device_tz: null }
  try {
    const row = await db.prepare(`
      SELECT device_name, device_tz
      FROM user_sessions
      WHERE user_id = @user_id AND revoked_at IS NULL
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 1
    `).get({ user_id: userId })
    return { device_name: row?.device_name ?? null, device_tz: row?.device_tz ?? null }
  } catch (_) {
    return { device_name: null, device_tz: null }
  }
}

function oldTrimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}
function oldResolveActorUsername(row, fallback) {
  return oldTrimmed(row?.username) || oldTrimmed(fallback) || null
}
const OLD_ACTOR_USERNAME_SQL = 'SELECT username FROM users WHERE id = @user_id'

async function oldResolveAuditActorName(db, userId, provided) {
  if (!userId) return oldResolveActorUsername(null, provided)
  try {
    const row = await db.prepare(OLD_ACTOR_USERNAME_SQL).get({ user_id: userId })
    return oldResolveActorUsername(row, provided)
  } catch (_) {
    return oldResolveActorUsername(null, provided)
  }
}

async function oldAudit(db, userId, userName, action, entity, entityId, details = null) {
  try {
    const detailsStr = details != null
      ? (typeof details === 'object' ? JSON.stringify(details) : String(details))
      : null
    const { device_name: deviceName, device_tz: deviceTz } = await oldLookupAuditDeviceInfo(db, userId)
    const actorName = await oldResolveAuditActorName(db, userId, userName)
    await db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value, device_name, device_tz)
      VALUES (@user_id, @user_name, @action, @entity, @entity_id, @details, @table_name, @record_id, @new_value, @device_name, @device_tz)
    `).run({
      user_id: userId,
      user_name: actorName,
      action,
      entity,
      entity_id: entityId,
      details: detailsStr,
      table_name: entity,
      record_id: entityId,
      new_value: detailsStr,
      device_name: deviceName,
      device_tz: deviceTz,
    })
  } catch (_) {
    // Swallow -- matches the real function's "audit failures must never crash".
  }
}

// ---------------------------------------------------------------------------
// Load the REAL (post-fix) audit() from src/lib/audit.ts.
// ---------------------------------------------------------------------------
function loadRealAudit() {
  const sourcePath = path.join(cloudflareRoot, 'src', 'lib', 'audit.ts')
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  const requireShim = (request) => {
    if (request === './db') return { getDb: (env) => env.DB }
    // Not used by the post-fix source (the SQL-JOIN resolution replaced it),
    // but kept so this loader also works when pointed at the pre-fix source
    // (see the "red on old code" check this file's harness runs manually).
    if (request === './actorSnapshot') {
      const actorSourcePath = path.join(cloudflareRoot, 'src', 'lib', 'actorSnapshot.ts')
      const actorOutput = ts.transpileModule(fs.readFileSync(actorSourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: actorSourcePath,
      }).outputText
      const actorMod = { exports: {} }
      new Function('exports', 'require', 'module', actorOutput)(actorMod.exports, require, actorMod)
      return actorMod.exports
    }
    return require(request)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    mod.exports, requireShim, mod, sourcePath, path.dirname(sourcePath),
  )
  return mod.exports
}
const realAudit = loadRealAudit()
assert.equal(typeof realAudit.audit, 'function', 'lib/audit.ts must export audit()')

function lastAuditRow(rawDb) {
  return rawDb.prepare('SELECT user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value, device_name, device_tz FROM audit_logs ORDER BY id DESC LIMIT 1').get({})
}

function freshHarness(seedOpts) {
  const rawDb = openDb(MIGRATION_SQLS)
  seed(rawDb, seedOpts)
  const counter = countingDb(rawDb)
  return { rawDb, counter }
}

async function scenario(name, seedOpts, callArgs) {
  const oldH = freshHarness(seedOpts)
  await oldAudit(oldH.counter.db, ...callArgs)
  const oldRow = lastAuditRow(oldH.rawDb)
  const oldStats = oldH.counter.stats()

  const newH = freshHarness(seedOpts)
  await realAudit.audit({ DB: newH.counter.db }, ...callArgs)
  const newRow = lastAuditRow(newH.rawDb)
  const newStats = newH.counter.stats()

  check(`${name}: new audit() row is byte-identical to the old three-step row`, () => {
    assert.deepEqual(newRow, oldRow)
  })
  check(`${name}: new audit() issues exactly 1 statement`, () => {
    assert.equal(newStats.statements, 1, `expected 1, got ${newStats.statements}`)
  })
  return { oldStats, newStats }
}

async function main() {
  // 1. Live user with an active session and a device -- the common case.
  {
    const { oldStats } = await scenario(
      'active user + active session',
      { userId: 7, username: 'za', sessionDeviceName: 'iPhone 14', sessionDeviceTz: 'Asia/Phnom_Penh' },
      [7, 'Za Sethy (client-provided, must lose)', 'stock.adjust', 'product', 42, { qty: 3 }],
    )
    check('active user + active session: old oracle needed 3 round trips (the regression this fixes)', () => {
      assert.equal(oldStats.statements, 3, `expected the old body to cost 3, got ${oldStats.statements}`)
    })
  }

  // 2. Live user, but their most recent session is revoked -- device falls
  // back to null exactly like the old lookup finding no matching row.
  await scenario(
    'active user, only a revoked session',
    { userId: 8, username: 'sok', sessionDeviceName: 'Android', sessionDeviceTz: 'Asia/Bangkok', revoked: true },
    [8, null, 'sale.create', 'sale', 'S-1', null],
  )

  // 3. Live user, no session row at all.
  await scenario(
    'active user, no session row',
    { userId: 9, username: 'ra' },
    [9, 'ignored client name', 'return.create', 'return', 'R-1', { note: 'x' }],
  )

  // 4. Deleted/unknown account id -- falls back to the caller-provided name,
  // exactly like resolveActorUsername(undefined, provided).
  await scenario(
    'unknown user id falls back to the caller-provided name',
    { userId: null },
    [999, 'Legacy Import Name', 'legacy.import', 'legacy', 1, null],
  )

  // 5. No userId, no provided name at all -- both must store null, not "null"
  // or an empty string.
  await scenario(
    'no userId and no provided name stores null',
    { userId: null },
    [null, null, 'cron.tick', 'system', null, null],
  )

  // 6. No userId, but a provided name -- the null-user fast path.
  await scenario(
    'no userId, provided name is used verbatim (trimmed)',
    { userId: null },
    [null, '  scheduled-worker  ', 'audit_log_retention_auto_delete', 'audit_log', null, { deleted: 5 }],
  )

  console.log(`\nOK ${passed} checks`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
