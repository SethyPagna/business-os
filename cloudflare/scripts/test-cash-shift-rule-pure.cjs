// R40: cash needs an open shift. The one pure rule (lib/cashShiftRule.ts) judged against the shared rule table
// (scripts/fixtures/cash-shift-rule-table.json, also read by the frontend parity test).
// Mutants this kills: `> 0` dropped (a $0 Cash row is refused), kind replaced by a name literal, a closed row treated as open,
// exemption ignored or inverted, a refund direction that is not carried, Q2 reopen hint wrong.
// Run: node scripts/test-cash-shift-rule-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const moduleCache = new Map()
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request)
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), request)) + '.ts')
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const rule = load('lib/cashShiftRule.ts')
const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cash-shift-rule-table.json'), 'utf8'))

for (const row of table.verdicts) {
  const verdict = rule.cashShiftVerdict({ cash: row.cash, exempt: row.exempt, state: rule.currentShiftState(row.row), direction: row.direction })
  assert.equal(verdict.allowed, row.allowed, row.name)
  if (!row.allowed) {
    assert.equal(verdict.code, 'shift_required_for_cash', row.name)
    assert.equal(verdict.shift_state, row.shift_state, row.name)
    assert.equal(verdict.direction, row.direction, row.name)
  }
}
for (const row of table.reopenWho) assert.equal(rule.cashShiftReopenWho(row.state, row.canReopen), row.who, `${row.state}/${row.canReopen}`)
for (const row of table.cashTakenNow) {
  assert.deepEqual(rule.cashTakenNow(row.before, row.after, row.kinds || {}), row.cash, row.name)
}
assert.equal(rule.currentShiftState({ closed: true, cancelled: true }), 'cancelled')
assert.equal(rule.currentShiftState(undefined), 'none')
assert.equal(rule.hasCashAmount({ usd: 0, khr: 0 }), false)
assert.equal(rule.hasCashAmount({ usd: 0, khr: 100 }), true)
console.log(`cash shift rule: ${table.verdicts.length} verdicts, ${table.reopenWho.length} reopen hints, ${table.cashTakenNow.length} cash cases ok`)
