// Real route/SQLite regression for the fee edit optimistic-version guard.
// The adversarial case changes updated_at after the handler's pre-read but
// immediately before its UPDATE, proving the SQL predicate owns the final
// write decision and that a lost race emits no audit or broadcast.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')
const { DatabaseSync } = require('node:sqlite')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  return {
    sourcePath,
    outputText: ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: sourcePath,
    }).outputText,
  }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

function namedParams(sql, params) {
  if (params == null || Array.isArray(params)) return params
  const names = new Set([...sql.matchAll(/@(\w+)/g)].map((match) => match[1]))
  return Object.fromEntries([...names].map((name) => [name, params[name] ?? null]))
}

let sqlite
let beforeFeeUpdate
let feeUpdateRuns
let audits
let broadcasts

function dbCompat() {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      return {
        async get(params) {
          const bound = namedParams(sql, params)
          return Array.isArray(bound) ? statement.get(...bound) : bound == null ? statement.get() : statement.get(bound)
        },
        async all(params) {
          const bound = namedParams(sql, params)
          return Array.isArray(bound) ? statement.all(...bound) : bound == null ? statement.all() : statement.all(bound)
        },
        async run(params) {
          if (/^\s*UPDATE fees SET fee_type = @feeType/.test(sql)) {
            if (beforeFeeUpdate) {
              const inject = beforeFeeUpdate
              beforeFeeUpdate = null
              inject(sqlite)
            }
            feeUpdateRuns += 1
          }
          const bound = namedParams(sql, params)
          const result = Array.isArray(bound) ? statement.run(...bound) : bound == null ? statement.run() : statement.run(bound)
          return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
        },
      }
    },
  }
}

const conflictControl = loadReal('lib/conflictControl.ts')
const actorSnapshot = loadReal('lib/actorSnapshot.ts')
const feeOperationReceipt = loadReal('lib/feeOperationReceipt.ts')
const feeRoute = loadReal('routes/fees.ts', {
  hono: require('hono'),
  '../lib/db': { getDb: dbCompat },
  '../lib/auth': {
    requireAuth: async (c, next) => {
      c.set('user', { id: 7, username: 'fee-editor', name: 'Fee Editor' })
      return next()
    },
  },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, audit: async (...args) => { audits.push(args) } },
  '../lib/permissions': { getPermissionTier: () => 'full', getActionTier: () => 'full' },
  '../durable-objects/broadcastHub': { broadcast: async (...args) => { broadcasts.push(args) } },
  '../lib/conflictControl': conflictControl,
  '../lib/actorSnapshot': actorSnapshot,
  '../lib/feeOperationReceipt': feeOperationReceipt,
  '../lib/moneyPrecision': loadReal('lib/moneyPrecision.ts'),
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../lib/businessDateWindow': { businessToday: () => '2026-09-08' },
  '../lib/telegram': { sendTelegramEvent: async () => {}, telegramMoney: () => '' },
  '../lib/branchRoles': loadReal('lib/branchRoles.ts'),
  '../lib/branchEffect': loadReal('lib/branchEffect.ts', { './branchRoles': loadReal('lib/branchRoles.ts'), './sqlBinding': loadReal('lib/sqlBinding.ts') }),
  '../lib/batchCode': { normalizeTypedDate: (value) => String(value || '').slice(0, 10) || null },
  '../index': {},
})
const app = feeRoute.default

function reset() {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE fees (
      id INTEGER PRIMARY KEY,
      fee_type TEXT NOT NULL,
      label TEXT,
      amount_usd REAL NOT NULL,
      amount_khr REAL NOT NULL,
      fee_date TEXT NOT NULL,
      sale_id INTEGER,
      branch_id INTEGER,
      branch_name TEXT,
      delivery_contact_id INTEGER,
      notes TEXT,
      created_by INTEGER,
      created_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE branches (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      role TEXT,
      successor_branch_id INTEGER
    );
    INSERT INTO branches (id, name, is_active) VALUES (2, 'Shop', 1);
    INSERT INTO fees (
      id, fee_type, label, amount_usd, amount_khr, fee_date, branch_id,
      created_by, created_by_name, created_at, updated_at
    ) VALUES (
      1, 'expense', 'original', 10, 0, '2026-09-08', 2,
      7, 'Fee Editor', '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
    );
  `)
  beforeFeeUpdate = null
  feeUpdateRuns = 0
  audits = []
  broadcasts = []
}

async function update(body) {
  const response = await app.request('/1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {}, { waitUntil: () => {}, passThroughOnException: () => {} })
  return { status: response.status, body: await response.json() }
}

function row() {
  return { ...sqlite.prepare('SELECT label, amount_usd, updated_at FROM fees WHERE id = 1').get() }
}

let passed = 0
async function check(name, fn) {
  reset()
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('v1 metadata edits and one-currency edits preserve untouched historical precision', async () => {
    sqlite.exec('UPDATE fees SET amount_usd=1.2345, amount_khr=20.49 WHERE id=1')
    let result = await update({ fee_money_version: 1, label: 'metadata', expectedUpdatedAt: row().updated_at })
    assert.equal(result.status, 200)
    assert.equal(result.body.fee.amount_usd, 1.2345)
    assert.equal(result.body.fee.amount_khr, 20.49)
    result = await update({ fee_money_version: 1, amount_khr: '20.5', expectedUpdatedAt: row().updated_at })
    assert.equal(result.status, 200)
    assert.equal(result.body.fee.amount_usd, 1.2345)
    assert.equal(result.body.fee.amount_khr, 21)
  })
  await check('CUTOVER-LD: an edit keeps the label the fee was recorded under after the rename; a branch change re-stamps it', async () => {
    // The consolidation's end state: branch 2 retired as "Old Shop" (role shop, successor LC Store), LC Store the selling branch.
    sqlite.exec("UPDATE fees SET branch_name='Shop' WHERE id=1; INSERT INTO branches (id, name, is_active, role) VALUES (3, 'LC Store', 1, 'shop'); UPDATE branches SET name='Old Shop', role='shop', is_active=0, successor_branch_id=3 WHERE id=2")
    let result = await update({ label: 'renamed label', expectedUpdatedAt: row().updated_at })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(sqlite.prepare('SELECT branch_name FROM fees WHERE id=1').get().branch_name, 'Shop', 'same branch: the recorded label stays')
    result = await update({ label: 'renamed label', branch_id: 2, expectedUpdatedAt: row().updated_at })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(sqlite.prepare('SELECT branch_name FROM fees WHERE id=1').get().branch_name, 'Shop', 'same branch id sent again: still the recorded label')
    result = await update({ label: 'moved', branch_id: 3, expectedUpdatedAt: row().updated_at })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(sqlite.prepare('SELECT branch_name FROM fees WHERE id=1').get().branch_name, 'LC Store', 'a different branch: stamped with that branch\'s name now')
    // History edits stay allowed, but nothing may be MOVED onto the retired branch.
    result = await update({ label: 'back to the retired branch', branch_id: 2, expectedUpdatedAt: row().updated_at })
    assert.equal(result.status, 409, 'moving an expense onto Old Shop is a new booking addressed to a disabled branch, so it asks for the redirect (CUTOVER-LR)')
    assert.equal(result.body.code, 'branch_redirect_required')
    assert.equal(result.body.redirect.successor_branch_id, 3)
    assert.equal(sqlite.prepare('SELECT branch_id FROM fees WHERE id=1').get().branch_id, 3, 'and changes nothing')
  })
  await check('v1 malformed supplied money and unknown versions produce no writes', async () => {
    const before = row()
    for (const body of [
      ...['amount_usd','amount_khr'].flatMap(field => [null, '', '-0.000000001', 'NaN', true].map(value => ({ [field]: value }))),
      { fee_money_version: null }, { fee_money_version: 0 }, { fee_money_version: '1' },
    ]) {
      // Carry the version so a 400 here can only come from the money rules.
      const refused = await update({ fee_money_version: 1, expectedUpdatedAt: before.updated_at, ...body })
      assert.equal(refused.status, 400)
      assert.equal(refused.body.code === 'expected_updated_at_required', false, 'refused for money, not for a missing version')
      assert.deepEqual(row(), before)
      assert.equal(feeUpdateRuns, 0)
      assert.equal(audits.length, 0)
      assert.equal(broadcasts.length, 0)
    }
  })
  await check('matching version updates the fee and emits one audit/broadcast', async () => {
    const result = await update({
      label: 'ordinary edit', amount_usd: 12,
      expectedUpdatedAt: '2026-09-08T00:00:00.000Z',
    })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(row().label, 'ordinary edit')
    assert.equal(row().amount_usd, 12)
    assert.equal(feeUpdateRuns, 1)
    assert.equal(audits.length, 1)
    assert.equal(broadcasts.length, 1)
  })

  await check('already-stale version is a no-op before the UPDATE', async () => {
    const before = row()
    const result = await update({
      label: 'stale edit', amount_usd: 20,
      expectedUpdatedAt: '2026-09-07T23:59:59.000Z',
    })
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.code, 'write_conflict')
    assert.deepStrictEqual(row(), before)
    assert.equal(feeUpdateRuns, 0)
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
  })

  await check('version change after pre-read cannot be overwritten or falsely audited', async () => {
    beforeFeeUpdate = (db) => db.prepare(`
      UPDATE fees SET label = 'concurrent winner', amount_usd = 99,
        updated_at = '2026-09-08T00:00:01.000Z'
      WHERE id = 1
    `).run()
    const result = await update({
      label: 'losing edit', amount_usd: 30,
      fee_money_version: 1,
      expectedUpdatedAt: '2026-09-08T00:00:00.000Z',
    })
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.code, 'write_conflict')
    assert.equal(result.body.actualUpdatedAt, '2026-09-08T00:00:01.000Z')
    assert.deepStrictEqual(row(), {
      label: 'concurrent winner', amount_usd: 99,
      updated_at: '2026-09-08T00:00:01.000Z',
    })
    assert.equal(feeUpdateRuns, 1)
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
  })

  // N13: the version is mandatory. Before, the guard ran only when the client sent one,
  // so an edit without it overwrote a newer edit silently.
  await check('N13: an edit with no version is refused before any read or write', async () => {
    const before = row()
    for (const body of [{ label: 'blind overwrite' }, { label: 'blind overwrite', expectedUpdatedAt: undefined }, { label: 'x', amount_usd: 50 }]) {
      const result = await update(body)
      assert.equal(result.status, 400, JSON.stringify(result.body))
      assert.equal(result.body.code, 'expected_updated_at_required')
    }
    assert.deepStrictEqual(row(), before)
    assert.equal(feeUpdateRuns, 0)
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
  })

  await check('N13: a stale edit over a newer one is a conflict, not a silent overwrite (snake_case alias too)', async () => {
    sqlite.exec("UPDATE fees SET label='newer edit', updated_at='2026-09-08T00:00:05.000Z' WHERE id=1")
    for (const stale of [{ expectedUpdatedAt: '2026-09-08T00:00:00.000Z' }, { expected_updated_at: '2026-09-08T00:00:00.000Z' }, { expectedUpdatedAt: null }]) {
      const result = await update({ label: 'stale overwrite', ...stale })
      assert.equal(result.status, 409, JSON.stringify(result.body))
      assert.equal(result.body.code, 'write_conflict')
    }
    assert.equal(row().label, 'newer edit')
    assert.equal(feeUpdateRuns, 0)
  })

  await check('N13: a legacy row whose updated_at is NULL stays editable by stating null, and the next edit needs the new version', async () => {
    sqlite.exec(`DROP TABLE fees; CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT NOT NULL, label TEXT, amount_usd REAL NOT NULL, amount_khr REAL NOT NULL, fee_date TEXT NOT NULL, sale_id INTEGER, branch_id INTEGER, branch_name TEXT, delivery_contact_id INTEGER, notes TEXT, created_by INTEGER, created_by_name TEXT, created_at TEXT NOT NULL, updated_at TEXT);
      INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at, updated_at) VALUES (1, 'expense', 'legacy', 10, 0, '2026-09-08', 2, '2026-09-01T00:00:00.000Z', NULL);`)
    assert.equal((await update({ label: 'no version' })).status, 400)
    const first = await update({ label: 'edited legacy', expectedUpdatedAt: null })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.ok(row().updated_at, 'the edit stamps a version')
    assert.equal((await update({ label: 'again', expectedUpdatedAt: null })).status, 409, 'null is now stale')
  })

  await check('N13: the version check also holds when a concurrent writer removes the row after the pre-read', async () => {
    beforeFeeUpdate = (db) => db.prepare('DELETE FROM fees WHERE id = 1').run()
    const result = await update({ label: 'lost edit', expectedUpdatedAt: '2026-09-08T00:00:00.000Z' })
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.reason, 'deleted')
    assert.equal(feeUpdateRuns, 1)
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM fees').get().n, 0)
  })

  await check('deleted versioned row returns a conflict without side effects', async () => {
    beforeFeeUpdate = (db) => db.prepare('DELETE FROM fees WHERE id = 1').run()
    const result = await update({ label: 'lost edit', expectedUpdatedAt: '2026-09-08T00:00:00.000Z' })
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.code, 'write_conflict')
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
  })

  // The legacy row (updated_at NULL, edited by stating null) has no stamp for the predicate to
  // compare against, so `updated_at IS NULL` is the whole guard. Pin that it still lets exactly
  // one of two edits through.
  const legacyRow = () => sqlite.exec(`DROP TABLE fees; CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT NOT NULL, label TEXT, amount_usd REAL NOT NULL, amount_khr REAL NOT NULL, fee_date TEXT NOT NULL, sale_id INTEGER, branch_id INTEGER, branch_name TEXT, delivery_contact_id INTEGER, notes TEXT, created_by INTEGER, created_by_name TEXT, created_at TEXT NOT NULL, updated_at TEXT);
    INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at, updated_at) VALUES (1, 'expense', 'legacy', 10, 0, '2026-09-08', 2, '2026-09-01T00:00:00.000Z', NULL);`)

  await check('N13: two concurrent edits of a NULL-version legacy row -- exactly one wins, the other is refused', async () => {
    legacyRow()
    const [a, b] = await Promise.all([
      update({ label: 'edit A', expectedUpdatedAt: null }),
      update({ label: 'edit B', expectedUpdatedAt: null }),
    ])
    const statuses = [a.status, b.status].sort()
    assert.deepEqual(statuses, [200, 409], JSON.stringify([a.body, b.body]))
    const loser = a.status === 409 ? a : b
    assert.equal(loser.body.code, 'write_conflict')
    assert.equal(row().label, a.status === 200 ? 'edit A' : 'edit B', 'the winner\'s edit is what is stored')
    assert.ok(row().updated_at, 'the winning edit stamped a version')
    assert.equal(audits.length, 1, 'one audit row, for the winner only')
    assert.equal(broadcasts.length, 1)
  })

  await check('N13: a NULL-version legacy row stamped by a competing writer after the pre-read refuses the late edit with no side effects', async () => {
    legacyRow()
    beforeFeeUpdate = (db) => db.prepare("UPDATE fees SET label = 'concurrent winner', updated_at = '2026-09-08T00:00:01.000Z' WHERE id = 1").run()
    const result = await update({ label: 'late edit', expectedUpdatedAt: null })
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.code, 'write_conflict')
    assert.equal(row().label, 'concurrent winner')
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
  })

  console.log(`\n${passed} fee update version-guard checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
