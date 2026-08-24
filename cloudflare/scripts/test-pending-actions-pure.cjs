// Regression tests for src/lib/pendingActions.ts (the Review/Approval
// queue backing store -- progress.md's "Permissions UI redesign" item,
// step 1). Same approach as test-backup-pure.cjs: transpile the REAL
// source and call the actual exported functions against a real in-memory
// SQLite database running the actual migrations (including
// 0025_pending_actions.sql), not a re-implementation of the logic.
//
// The database is provided via scripts/harness/d1compat.cjs, which
// already shapes itself like lib/db.ts's own D1Compat (get/all/run
// directly on the prepared statement, no separate .first()) -- so this
// test stubs pendingActions.ts's `./db` import to return the harness
// instance directly from getDb(), bypassing the real lib/db.ts (which
// expects a raw D1Database, not this harness's already-D1Compat-shaped
// object). `../index`'s Env import is type-only and is elided by the
// TS transpile, so it needs no stub.
//
// Run (from cloudflare/): node scripts/test-pending-actions-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const fakeEnv = { DB: db }

// d1compat.cjs's `run()` mimics the RAW D1Database result shape (`{success,
// meta: {last_row_id, changes}}`) -- correct for modules that take a raw
// D1Database directly, but pendingActions.ts imports `getDb` from `./db`
// (lib/db.ts), whose real D1Compat.run() already flattens that into
// `{changes, lastInsertRowid}` at the top level (see db.ts's own
// D1CompatStatement.run()). Stubbing `./db`'s getDb() to hand back the raw
// harness db directly (as an earlier version of this test did) skips that
// flattening, so `result.lastInsertRowid`/`result.changes` in
// pendingActions.ts silently read `undefined` -- caught by this file's own
// "returns a real id"/"stamps the reviewer" checks. This thin wrapper
// applies the same flattening db.ts does, so the stub matches the real
// getDb() contract pendingActions.ts is actually written against.
const dbForPendingActions = {
  prepare(sql) {
    const stmt = db.prepare(sql)
    return {
      bind: (params) => { stmt.bind(params); return this },
      get: (params) => stmt.get(params),
      all: (params) => stmt.all(params) ?? [],
      run: (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
}

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

const dbStubModuleObj = { exports: { getDb: () => dbForPendingActions } }

const pending = transpile('lib/pendingActions.ts')
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './db') return dbStubModuleObj.exports
  return originalLoad.call(this, request, parent, isMain)
}
const pendingModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', pending.outputText)(
  pendingModuleObj.exports, require, pendingModuleObj, pending.sourcePath, path.dirname(pending.sourcePath),
)
Module._load = originalLoad

const {
  createPendingAction,
  listPendingActions,
  getPendingAction,
  markPendingActionApproved,
  markPendingActionRejected,
  countOpenPendingActions,
} = pendingModuleObj.exports

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('createPendingAction inserts an open row and returns a real id', async () => {
    const id = await createPendingAction(fakeEnv, {
      section: 'products',
      actionType: 'delete',
      entityType: 'product',
      entityId: 42,
      payload: { id: 42 },
      summary: 'Delete "Matte Lipstick 12"',
      requestedBy: 1,
      requestedByName: 'Cashier One',
    })
    assert.ok(id > 0, 'expected a positive inserted id')
    const row = await getPendingAction(fakeEnv, id)
    assert.strictEqual(row.status, 'open')
    assert.strictEqual(row.section, 'products')
    assert.strictEqual(row.entity_id, 42)
    assert.deepStrictEqual(JSON.parse(row.payload_json), { id: 42 })
  })

  await check('listPendingActions defaults to open only, newest first', async () => {
    const idOld = await createPendingAction(fakeEnv, {
      section: 'contacts', actionType: 'edit', entityType: 'customer', payload: { name: 'A' },
    })
    const idNew = await createPendingAction(fakeEnv, {
      section: 'contacts', actionType: 'edit', entityType: 'customer', payload: { name: 'B' },
    })
    const rows = await listPendingActions(fakeEnv, { section: 'contacts' })
    assert.strictEqual(rows.length, 2)
    // newest first
    assert.strictEqual(rows[0].id, idNew)
    assert.strictEqual(rows[1].id, idOld)
    rows.forEach((r) => assert.strictEqual(r.status, 'open'))
  })

  await check('markPendingActionApproved flips status and stamps the reviewer, once', async () => {
    const id = await createPendingAction(fakeEnv, {
      section: 'inventory', actionType: 'adjust', entityType: 'product', payload: { delta: -5 },
    })
    const ok = await markPendingActionApproved(fakeEnv, id, { reviewedBy: 9, reviewedByName: 'Admin' })
    assert.strictEqual(ok, true)
    const row = await getPendingAction(fakeEnv, id)
    assert.strictEqual(row.status, 'approved')
    assert.strictEqual(row.reviewed_by, 9)
    assert.strictEqual(row.reviewed_by_name, 'Admin')
    assert.ok(row.reviewed_at)
    // Second approve on an already-reviewed row is a no-op, not a silent re-approve.
    const secondOk = await markPendingActionApproved(fakeEnv, id, { reviewedBy: 5, reviewedByName: 'Someone Else' })
    assert.strictEqual(secondOk, false)
    const rowAfter = await getPendingAction(fakeEnv, id)
    assert.strictEqual(rowAfter.reviewed_by, 9, 'a second approve call must not overwrite the first reviewer')
  })

  await check('markPendingActionRejected flips status and records a reason', async () => {
    const id = await createPendingAction(fakeEnv, {
      section: 'returns', actionType: 'delete', entityType: 'return', payload: { id: 7 },
    })
    const ok = await markPendingActionRejected(fakeEnv, id, {
      reviewedBy: 9, reviewedByName: 'Admin', rejectReason: 'Missing receipt reference',
    })
    assert.strictEqual(ok, true)
    const row = await getPendingAction(fakeEnv, id)
    assert.strictEqual(row.status, 'rejected')
    assert.strictEqual(row.reject_reason, 'Missing receipt reference')
  })

  await check('review/reject on a nonexistent id returns false, not a throw', async () => {
    const okApprove = await markPendingActionApproved(fakeEnv, 999999, { reviewedBy: 1, reviewedByName: 'X' })
    assert.strictEqual(okApprove, false)
    const okReject = await markPendingActionRejected(fakeEnv, 999999, { reviewedBy: 1, reviewedByName: 'X' })
    assert.strictEqual(okReject, false)
  })

  await check('countOpenPendingActions matches listPendingActions({status:"open"}) across all sections', async () => {
    const openRows = await listPendingActions(fakeEnv, { status: 'open', section: null })
    const count = await countOpenPendingActions(fakeEnv)
    assert.strictEqual(count, openRows.length)
  })

  await check('listPendingActions("all") includes approved/rejected rows too', async () => {
    const allRows = await listPendingActions(fakeEnv, { status: 'all' })
    const openCount = await countOpenPendingActions(fakeEnv)
    assert.ok(allRows.length > openCount, 'the "all" view should include the approved/rejected rows created above')
    assert.ok(allRows.some((r) => r.status === 'approved'))
    assert.ok(allRows.some((r) => r.status === 'rejected'))
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
