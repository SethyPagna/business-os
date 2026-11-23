// A late close adds no statement and changes no statement shape (A76): the one last-activity read of the close, bounded with `until`, is the
// same single statement as an unbounded one; only the four "createdTo" values change. That is why the fingerprint of the close
// (scripts/read-budget/fingerprints/api_shifts_id_close.json) keeps its hash. Runs the REAL lib/shiftReconciliation.ts against a recording db.
// Run: node scripts/test-shift-late-close-read-shape-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', 'src')
const cache = new Map()
const seen = []
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const out = ts.transpileModule(fs.readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (name) => {
    if (name.endsWith('/db')) return { getDb: () => ({ prepare: (sql) => ({ get: async (params) => { seen.push({ sql, params }); return {} }, all: async () => [] }) }) }
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      if (fs.existsSync(path.join(root, target))) return load(target)
      return new Proxy({}, { get: () => () => ({}) })
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports)
  return mod.exports
}

async function main() {
  const lib = load('lib/shiftReconciliation.ts')
  const shift = { id: 1, scope_mode: 'per_account', user_id: 7, branch_id: 1, opened_at: '2026-11-22T13:00:00.000Z', closed_at: null, opening_float_usd: 1, opening_float_khr: 1 }
  const now = Date.parse('2026-11-23T10:00:00.000Z')
  seen.length = 0
  await lib.shiftLastActivityMs({}, shift, now)
  const sameDay = seen.splice(0)
  await lib.shiftLastActivityMs({}, shift, now, { until: '2026-11-22T17:00:00.000Z' })
  const late = seen.splice(0)
  assert.equal(sameDay.length, 1, 'the unbounded read is one statement')
  assert.equal(late.length, 1, 'the bounded read is one statement')
  assert.equal(late[0].sql, sameDay[0].sql, 'the statement text is identical, so its fingerprint is')
  assert.deepEqual(Object.keys(late[0].params), Object.keys(sameDay[0].params), 'the same bound parameters')
  const changed = Object.keys(late[0].params).filter((key) => late[0].params[key] !== sameDay[0].params[key])
  assert.deepEqual(changed, ['s_createdTo', 'r_createdTo', 'f_createdTo', 'e_createdTo'], 'only the upper bound of each table changes')
  assert.ok(String(late[0].params.s_createdTo).startsWith('2026-11-22 17:00:00'), 'and it is the bound handed in')
  const route = fs.readFileSync(path.join(root, 'routes', 'shifts.ts'), 'utf8')
  assert.ok(/shiftLastActivityMs\(env, shift, nowMs, \{ until: late\.until \}\)/.test(route), 'the route hands the bound to that one read')
  console.log('PASS the bounded last-activity read is the same single statement with the same parameters')
}
main().catch((error) => { console.error(error); process.exit(1) })
