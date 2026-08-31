// Pure test for src/lib/userIdentity.ts cascadeUserRename.
//
// Loads the REAL module (transpiled, not reimplemented). userIdentity.ts has
// only a type-only import (`import type { D1Compat }`), which transpilation
// erases, so no stubbing is needed. The cascade is exercised against a fake db
// that records every UPDATE it is handed.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'userIdentity.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'userIdentity.ts',
})
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
  moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
)
const { cascadeUserRename, USER_NAME_SNAPSHOTS } = moduleObj.exports

// Fake db: records each prepared UPDATE + its bound params; can be told to throw
// for a given table (to simulate a table absent in some environment).
function makeRecordingDb({ throwFor = new Set() } = {}) {
  const calls = []
  return {
    calls,
    prepare(sql) {
      return {
        run: async (params) => {
          calls.push({ sql, params })
          const table = (sql.match(/UPDATE\s+(\w+)/) || [])[1]
          if (throwFor.has(table)) throw new Error(`no such table: ${table}`)
          return { changes: 1, lastInsertRowid: 0 }
        },
      }
    },
  }
}
const tableOf = (sql) => (sql.match(/UPDATE\s+(\w+)/) || [])[1]

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function run() {
  await check('USER_NAME_SNAPSHOTS covers the id-linked snapshots and EXCLUDES audit_logs', () => {
    assert.ok(Array.isArray(USER_NAME_SNAPSHOTS) && USER_NAME_SNAPSHOTS.length >= 14, 'expected the full id-linked snapshot set')
    assert.ok(USER_NAME_SNAPSHOTS.some((s) => s.table === 'sales' && s.idColumn === 'cashier_id' && s.nameColumn === 'cashier_name'), 'sales cashier snapshot present')
    assert.ok(USER_NAME_SNAPSHOTS.some((s) => s.table === 'returns' && s.idColumn === 'cashier_id'), 'returns cashier snapshot present')
    assert.ok(USER_NAME_SNAPSHOTS.some((s) => s.table === 'inventory_movements' && s.idColumn === 'user_id' && s.nameColumn === 'user_name'), 'inventory_movements user snapshot present')
    assert.ok(!USER_NAME_SNAPSHOTS.some((s) => s.table === 'audit_logs'), 'audit_logs must NOT be rewritten on rename (point-in-time record)')
  })

  await check('cascade issues one guarded UPDATE per snapshot table, all bound to the new username + id', async () => {
    const db = makeRecordingDb()
    const updated = await cascadeUserRename(db, 3, 'Za')
    assert.strictEqual(db.calls.length, USER_NAME_SNAPSHOTS.length, 'one UPDATE per snapshot table')
    assert.strictEqual(updated, USER_NAME_SNAPSHOTS.length, 'returns the summed change count (fake db reports 1 per table)')
    for (const call of db.calls) {
      assert.strictEqual(call.params.id, 3, 'each UPDATE is scoped to the renamed user id')
      assert.strictEqual(call.params.name, 'Za', 'each UPDATE binds the new username')
      assert.ok(/IS NULL OR/.test(call.sql) && /!= @name/.test(call.sql), 'fills NULL snapshots but skips rows already correct (no needless churn)')
      assert.ok(!/audit_logs/.test(call.sql), 'never touches audit_logs')
    }
    const tablesHit = db.calls.map((c) => tableOf(c.sql)).sort()
    assert.deepStrictEqual(tablesHit, USER_NAME_SNAPSHOTS.map((s) => s.table).sort(), 'every snapshot table is hit exactly once')
  })

  await check('a table absent in this environment is skipped, the rest still cascade', async () => {
    const db = makeRecordingDb({ throwFor: new Set(['file_assets']) })
    const updated = await cascadeUserRename(db, 4, 'Rath')
    assert.strictEqual(db.calls.length, USER_NAME_SNAPSHOTS.length, 'still attempts every table')
    assert.strictEqual(updated, USER_NAME_SNAPSHOTS.length - 1, 'the throwing table contributes no change but does not abort the cascade')
  })

  await check('no-op guards: blank username or non-finite id cascade nothing', async () => {
    const blank = makeRecordingDb()
    assert.strictEqual(await cascadeUserRename(blank, 3, '   '), 0, 'blank/whitespace username -> no cascade')
    assert.strictEqual(blank.calls.length, 0, 'no UPDATE issued for a blank username')
    const badId = makeRecordingDb()
    assert.strictEqual(await cascadeUserRename(badId, Number.NaN, 'X'), 0, 'non-finite user id -> no cascade')
    assert.strictEqual(badId.calls.length, 0, 'no UPDATE issued for a non-finite id')
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((err) => { console.error(err); process.exit(1) })
