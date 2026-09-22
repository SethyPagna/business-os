// DELETE /roles/:id reads the version the client holds from the JSON body.
//
// Every other guarded delete (lookups.ts categories/units, products, files)
// takes `expectedUpdatedAt` from the JSON body that apiFetch sends on DELETE
// too; the roles delete alone read only the query string, and the client never
// put the version there, so `assertUpdatedAtMatch` always saw an empty token
// and the guard never ran. Since 22 Sep 2026 Users.tsx sends
// `{ expectedUpdatedAt: role.updated_at }` in the body and the route reads the
// body first, falling back to the query string.
//
// The body-first extraction is executed verbatim from the route source with a
// fake context (a JSON body, a body that fails to parse, an empty body), then
// fed through the real conflictControl.ts; a negative control shows the old
// query-only line fails the same pin.
//
// Run (from cloudflare/): node scripts/test-roles-delete-conflict-body-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

let passed = 0
const check = (name, fn) => { fn(); console.log('PASS', name); passed += 1 }

const control = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'conflictControl.ts'), 'utf8')
const compiled = ts.transpileModule(control, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', compiled)(mod.exports, require, mod)
const { assertUpdatedAtMatch, getExpectedUpdatedAt, WriteConflictError } = mod.exports

const users = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'users.ts'), 'utf8')
const routeStart = users.indexOf("app.delete('/roles/:id'")
assert.ok(routeStart > 0, 'DELETE /roles/:id route present')
const routeSource = users.slice(routeStart, users.indexOf('\n})', routeStart))

// The two statements between the 404 and the guard, executed as written.
const extraction = routeSource.match(/(const query = Object\.fromEntries\(new URL\(c\.req\.url\)\.searchParams\)\s*\n\s*const bodyForConflict = await c\.req\.json<Record<string, unknown>>\(\)\.catch\(\(\) => query\))/)
assert.ok(extraction, 'the route reads the JSON body first and falls back to the query string')
const runExtraction = new Function('c', `return (async () => { ${extraction[1].replace(/<Record<string, unknown>>/, '')}; return bodyForConflict })()`)
const fakeContext = (url, body) => ({
  req: {
    url,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
  },
})

const ROLE = { id: 7, code: 'cashier', is_system: 0, updated_at: '2026-09-22T06:33:25.086Z' }
const STALE = '2026-09-16T12:10:41.000Z'

;(async () => {
  check('the JSON body carries the token even when the query string has none', async () => {
    const body = await runExtraction(fakeContext('https://x/api/roles/7', { expectedUpdatedAt: STALE, userId: 1 }))
    assert.equal(getExpectedUpdatedAt(body), STALE)
  })
  const bodyWithStale = await runExtraction(fakeContext('https://x/api/roles/7', { expectedUpdatedAt: STALE }))
  check('a stale body token is refused (the guard now runs)', () => {
    let error = null
    try { assertUpdatedAtMatch('role', ROLE, getExpectedUpdatedAt(bodyWithStale)) } catch (e) { error = e }
    assert.ok(error instanceof WriteConflictError)
    assert.equal(error.reason, 'updated')
  })
  const bodyCurrent = await runExtraction(fakeContext('https://x/api/roles/7', { expectedUpdatedAt: ROLE.updated_at }))
  check('the current body token passes', () => {
    assertUpdatedAtMatch('role', ROLE, getExpectedUpdatedAt(bodyCurrent))
  })
  const fromQuery = await runExtraction(fakeContext(`https://x/api/roles/7?expectedUpdatedAt=${encodeURIComponent(STALE)}`, new SyntaxError('no body')))
  check('an unparseable body falls back to the query string', () => {
    assert.equal(getExpectedUpdatedAt(fromQuery), STALE)
  })
  const empty = await runExtraction(fakeContext('https://x/api/roles/7', {}))
  check('no token anywhere skips the guard rather than refusing', () => {
    assert.equal(getExpectedUpdatedAt(empty), undefined)
    assertUpdatedAtMatch('role', ROLE, getExpectedUpdatedAt(empty))
  })
  check('negative control: the old query-only guard fails the source pin', () => {
    const old = routeSource.replace(extraction[1], '').replace(
      "assertUpdatedAtMatch('role', existingRole, getExpectedUpdatedAt(bodyForConflict))",
      "assertUpdatedAtMatch('role', existingRole, getExpectedUpdatedAt(Object.fromEntries(new URL(c.req.url).searchParams)))",
    )
    assert.notEqual(old, routeSource)
    assert.ok(!/const bodyForConflict = await c\.req\.json/.test(old))
    assert.ok(/assertUpdatedAtMatch\('role', existingRole, getExpectedUpdatedAt\(bodyForConflict\)\)/.test(routeSource), 'the guard consumes the body-first value')
  })
  console.log(`roles-delete-conflict-body: ${passed} checks passed`)
})().catch((error) => { console.error(error); process.exit(1) })
