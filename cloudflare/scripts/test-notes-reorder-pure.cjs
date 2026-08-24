// Regression test for the notes drag-to-reorder feature (progress.md,
// "Notes tab: drag-to-reorder no longer works" -- turned out to never
// have existed anywhere in the codebase or its history, so this is new
// work, not a regression fix). Exercises the real routes/notes.ts
// (GET / list ordering + the new PATCH /reorder endpoint) against a real
// in-memory SQLite database with the real migrations applied, including
// 0029_user_notes_sort_order.sql. Same transpile-the-real-source-and-
// run-it approach as test-review-gate-pure.cjs.
//
// Run (from cloudflare/): node scripts/test-notes-reorder-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())

// Same flattening reasoning as test-review-gate-pure.cjs's own `db` stub:
// routes/notes.ts imports getDb from '../lib/db', whose real D1Compat.run()
// flattens D1's raw result into {changes, lastInsertRowid} -- this harness
// wrapper does the same so lastInsertRowid reads correctly.
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: (params) => stmt.get(params),
      all: (params) => stmt.all(params) ?? [],
      run: (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) {
    const results = []
    for (const item of items) {
      const stmt = rawDb.prepare(item.sql)
      const r = stmt.run(item.params || {})
      results.push({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) })
    }
    return results
  },
  exec(sql) {
    rawDb.exec(sql)
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

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

let CURRENT_USER = null
const dbStub = { '../lib/db': { getDb: () => db } }
const authStub = { '../lib/auth': { requireAuth: async (c, next) => { c.set('user', CURRENT_USER); return next() } } }
const conflictStub = {
  '../lib/conflictControl': {
    assertUpdatedAtMatch: () => {},
    getExpectedUpdatedAt: () => undefined,
    writeConflictResponse: (err) => ({ body: { error: String(err) }, status: 409 }),
    WriteConflictError: class WriteConflictError extends Error {},
  },
}

const notesRoute = loadReal('routes/notes.ts', { ...dbStub, ...authStub, ...conflictStub, '../index': {} })
const notesApp = notesRoute.default

const fakeEnv = { DB: {} } // routes/notes.ts only ever reaches the db via getDb(c.env), which is stubbed above -- the raw env value itself is never read.
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

const USER_A = { id: 1, username: 'alice' }
const USER_B = { id: 2, username: 'bob' }

async function req(user, method, url, body) {
  CURRENT_USER = user
  const res = await notesApp.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function resetNotes() {
  db.exec('DELETE FROM user_notes;')
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('fresh notes with no manual order sort newest-first (unchanged pre-existing behavior)', async () => {
    resetNotes()
    const first = (await req(USER_A, 'POST', '/', { title: 'First', content: '' })).json.note
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = (await req(USER_A, 'POST', '/', { title: 'Second', content: '' })).json.note

    const { json } = await req(USER_A, 'GET', '/')
    assert.strictEqual(json.notes.length, 2)
    assert.strictEqual(json.notes[0].id, second.id, 'most-recently-created note should list first when nothing has been manually reordered')
    assert.strictEqual(json.notes[1].id, first.id)
  })

  await check('PATCH /reorder persists a manual drag order that overrides updated_at ordering', async () => {
    resetNotes()
    const noteA = (await req(USER_A, 'POST', '/', { title: 'A', content: '' })).json.note
    await new Promise((resolve) => setTimeout(resolve, 5))
    const noteB = (await req(USER_A, 'POST', '/', { title: 'B', content: '' })).json.note
    await new Promise((resolve) => setTimeout(resolve, 5))
    const noteC = (await req(USER_A, 'POST', '/', { title: 'C', content: '' })).json.note

    // Natural order (newest first) would be C, B, A -- drag A to the top.
    const { status, json } = await req(USER_A, 'PATCH', '/reorder', { orderedIds: [noteA.id, noteB.id, noteC.id] })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.deepStrictEqual(json.notes.map((n) => n.id), [noteA.id, noteB.id, noteC.id], 'reorder response should reflect the new order immediately')

    const relisted = await req(USER_A, 'GET', '/')
    assert.deepStrictEqual(relisted.json.notes.map((n) => n.id), [noteA.id, noteB.id, noteC.id], 'a fresh GET after reorder must persist the same order, not fall back to updated_at')
  })

  await check('pinned notes still sort ahead of unpinned ones regardless of sort_order', async () => {
    resetNotes()
    const noteA = (await req(USER_A, 'POST', '/', { title: 'A', content: '' })).json.note
    const noteB = (await req(USER_A, 'POST', '/', { title: 'B', content: '' })).json.note
    // Put B first via drag...
    await req(USER_A, 'PATCH', '/reorder', { orderedIds: [noteB.id, noteA.id] })
    // ...then pin A, which should still jump ahead of unpinned B.
    await req(USER_A, 'PUT', `/${noteA.id}`, { pinned: true })

    const { json } = await req(USER_A, 'GET', '/')
    assert.strictEqual(json.notes[0].id, noteA.id, 'pinned note must sort first even though it has a higher (later) sort_order than the unpinned one')
    assert.strictEqual(json.notes[1].id, noteB.id)
  })

  await check('reorder is scoped per-user -- cannot reorder or leak into another user\'s notes', async () => {
    resetNotes()
    const aNote1 = (await req(USER_A, 'POST', '/', { title: 'A1', content: '' })).json.note
    const aNote2 = (await req(USER_A, 'POST', '/', { title: 'A2', content: '' })).json.note
    const bNote1 = (await req(USER_B, 'POST', '/', { title: 'B1', content: '' })).json.note

    // User B tries to reorder using an id that belongs to user A -- should
    // be silently skipped (not an error, not applied), same "your own data
    // only" scoping as every other route in this file.
    const { status } = await req(USER_B, 'PATCH', '/reorder', { orderedIds: [aNote1.id, bNote1.id] })
    assert.strictEqual(status, 200)

    const aList = await req(USER_A, 'GET', '/')
    assert.strictEqual(aList.json.notes.length, 2, 'user A\'s note count must be unaffected by user B\'s reorder attempt')
    const stolenNote = await db.prepare('SELECT sort_order FROM user_notes WHERE id = @id').get({ id: aNote1.id })
    assert.strictEqual(stolenNote.sort_order, 0, 'user A\'s note sort_order must be untouched by user B\'s reorder call (still the default)')
    void aNote2
  })

  await check('reorder with an empty/missing orderedIds is rejected with 400', async () => {
    resetNotes()
    const { status, json } = await req(USER_A, 'PATCH', '/reorder', {})
    assert.strictEqual(status, 400, JSON.stringify(json))
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
