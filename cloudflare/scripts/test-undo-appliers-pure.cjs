// Real-SQLite (not mocked) test of the server-side undo/redo applier slice
// (K1) -- lib/undoAppliers.ts's 'branch.update' applier and the shared write it
// replays through, lib/branchWrites.ts's branchUpdateStatements. Same rigor as
// the other *-pure.cjs scripts: real better-sqlite3 (the engine D1 runs), the
// REAL transpiled source (not a reimplementation), and a source-lock proving
// the live route and the applier share one write definition so they cannot
// drift.
//
// Covers, all against real rows: (1) branchUpdateStatements restores a branch's
// fields from an undo payload and reapplies them from a redo payload, and emits
// the "clear other defaults" statement only when is_default is truthy; (2) the
// real 'branch.update' applier, run through a minimal D1-compatible wrapper,
// updates the row and throws (leaving state untouched) when the branch is gone
// or the id is missing; (3) resolveUndoApplier recognizes a proper payload and
// returns null for an unknown/absent applier (the fall-through-to-client case);
// (4) routes/branches.ts's PUT actually calls branchUpdateStatements, so the
// route and the applier replay through the same SQL.
//
// Run: node scripts/test-undo-appliers-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

// --- load real TS modules with a controlled require shim -------------------

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

// toDbBool copied from lib/db.ts (verbatim) -- branchWrites imports only this
// one symbol from the heavy db module, so stub the rest of db out.
function toDbBool(value, fallback = 1) {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 1 : 0
}

const branchWrites = loadModule('lib/branchWrites.ts', (id) => {
  if (id === './db') return { toDbBool }
  return require(id)
})
const { branchUpdateStatements } = branchWrites

// A D1-compatible getDb stub over better-sqlite3 -- enough of the surface the
// applier uses: prepare(sql).get(params) with an array (positional ?) binding,
// and db.batch([{sql, params}]) with @named params. audit + broadcast are
// no-ops (the applier composes them; the test asserts the DB effect, not the
// side channels, which have their own coverage).
let sharedDb = null
function wrapDb(sqlite) {
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      return {
        get: (params) => (Array.isArray(params) ? stmt.get(...params) : stmt.get(params || {})),
        all: (params) => (Array.isArray(params) ? stmt.all(...params) : stmt.all(params || {})),
        run: (params) => (Array.isArray(params) ? stmt.run(...params) : stmt.run(params || {})),
      }
    },
    batch(statements) {
      const tx = sqlite.transaction((stmts) => {
        for (const s of stmts) {
          const st = sqlite.prepare(s.sql)
          if (s.params == null) st.run()
          else if (Array.isArray(s.params)) st.run(...s.params)
          else st.run(s.params)
        }
      })
      tx(statements)
      return Promise.resolve()
    },
  }
}

const undoAppliers = loadModule('lib/undoAppliers.ts', (id) => {
  if (id === './db') return { getDb: () => wrapDb(sharedDb) }
  if (id === './audit') return { audit: async () => {} }
  if (id === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
  if (id === './branchWrites') return branchWrites
  return require(id)
})
const { resolveUndoApplier, registeredUndoAppliers } = undoAppliers

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE branches (
    id INTEGER PRIMARY KEY, name TEXT, location TEXT, phone TEXT, manager TEXT,
    notes TEXT, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    updated_at TEXT
  )`)
  return db
}

function readBranch(db, id) {
  return db.prepare('SELECT name, location, phone, manager, notes, is_default, is_active FROM branches WHERE id = ?').get(id)
}

function runStatements(db, statements) {
  for (const s of statements) {
    const st = db.prepare(s.sql)
    if (s.params == null) st.run()
    else st.run(s.params)
  }
}

// --- checks ----------------------------------------------------------------

async function main() {
await check('branchUpdateStatements restores prior field values (an undo of an edit)', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO branches (id, name, location, phone, manager, notes, is_default, is_active) VALUES (2, 'Shop RENAMED', 'New Loc', '070', 'Bob', 'edited', 0, 1)`).run()
  // undo_payload carries the PRE-edit snapshot.
  const undoFields = { name: 'Shop', location: 'Old Loc', phone: '012', manager: 'Alice', notes: 'orig', is_default: 0, is_active: 1 }
  runStatements(db, branchUpdateStatements(2, undoFields))
  assert.deepStrictEqual(readBranch(db, 2), { name: 'Shop', location: 'Old Loc', phone: '012', manager: 'Alice', notes: 'orig', is_default: 0, is_active: 1 })
})

await check('branchUpdateStatements reapplies later values (a redo) and clears other defaults only when is_default is set', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO branches (id, name, is_default, is_active) VALUES (1, 'Warehouse', 1, 1)`).run()
  db.prepare(`INSERT INTO branches (id, name, is_default, is_active) VALUES (2, 'Shop', 0, 1)`).run()
  // Redo makes branch 2 the default: the reset statement must be present and
  // demote branch 1.
  const redoStatements = branchUpdateStatements(2, { name: 'Shop', is_default: true, is_active: 1 })
  assert.ok(redoStatements.some((s) => /UPDATE branches SET is_default = 0/.test(s.sql)), 'expected the clear-other-defaults statement')
  runStatements(db, redoStatements)
  assert.strictEqual(readBranch(db, 1).is_default, 0)
  assert.strictEqual(readBranch(db, 2).is_default, 1)

  // A non-default edit must NOT emit the reset statement (it would demote the
  // real default branch for an unrelated edit).
  const plain = branchUpdateStatements(2, { name: 'Shop', is_default: 0, is_active: 1 })
  assert.ok(!plain.some((s) => /UPDATE branches SET is_default = 0/.test(s.sql)), 'a non-default edit must not clear defaults')
})

await check('the real branch.update applier updates the target row through the D1 wrapper', async () => {
  const db = freshDb()
  db.prepare(`INSERT INTO branches (id, name, location, is_default, is_active) VALUES (2, 'Shop RENAMED', 'x', 0, 1)`).run()
  sharedDb = db
  const applier = resolveUndoApplier({ applier: 'branch.update', id: 2, fields: { name: 'Shop', location: 'Old Loc', is_default: 0, is_active: 1 } })
  assert.ok(applier && applier.name === 'branch.update')
  await applier.run({ applier: 'branch.update', id: 2, fields: { name: 'Shop', location: 'Old Loc', is_default: 0, is_active: 1 } }, { env: {}, user: { id: 9, name: 'Admin' }, direction: 'undo' })
  assert.deepStrictEqual(readBranch(db, 2), { name: 'Shop', location: 'Old Loc', phone: null, manager: null, notes: null, is_default: 0, is_active: 1 })
})

await check('the branch.update applier throws (and changes nothing) when the branch is gone or the id is missing', async () => {
  const db = freshDb()
  sharedDb = db
  const applier = resolveUndoApplier({ applier: 'branch.update', id: 999, fields: { name: 'Ghost' } })
  await assert.rejects(() => applier.run({ applier: 'branch.update', id: 999, fields: { name: 'Ghost' } }, { env: {}, user: null, direction: 'undo' }), /no longer exists/)
  await assert.rejects(() => applier.run({ applier: 'branch.update', id: 0, fields: {} }, { env: {}, user: null, direction: 'undo' }), /branch id/)
})

await check('resolveUndoApplier recognizes a registered applier and falls through (null) otherwise', () => {
  assert.strictEqual(resolveUndoApplier({ applier: 'branch.update', id: 1 })?.name, 'branch.update')
  assert.strictEqual(resolveUndoApplier({ applier: 'not.registered', id: 1 }), null)
  assert.strictEqual(resolveUndoApplier({ id: 1 }), null)            // no applier field -> client replay
  assert.strictEqual(resolveUndoApplier({}), null)
  assert.strictEqual(resolveUndoApplier(null), null)
  assert.ok(registeredUndoAppliers().includes('branch.update'))
})

await check('source lock: routes/branches.ts replays the same write via branchUpdateStatements', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8')
  assert.ok(/branchUpdateStatements\(/.test(routeSrc), 'branches.ts must call the shared branchUpdateStatements')
  assert.ok(/from '\.\.\/lib\/branchWrites'/.test(routeSrc), 'branches.ts must import branchWrites')
})

}

main().then(() => {
  console.log(`\n${passed} check(s) passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
