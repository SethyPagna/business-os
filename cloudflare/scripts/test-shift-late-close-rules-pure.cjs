// The pure rule library of the late shift close (owner A74, A75, A76): lib/shiftLateClose.ts, row by row from the shared fixture
// scripts/fixtures/shift-late-close-cases.json (the frontend mirror reads the same rows).
// Run: node scripts/test-shift-late-close-rules-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
function loadReal(relPath) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath))
  return mod.exports
}
const lib = loadReal('lib/shiftLateClose.ts')
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'shift-late-close-cases.json'), 'utf8'))
let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log('PASS ' + name) }

check('LATE_REASON_MAX is 500 and the permission key is shift_close_forgotten', () => {
  assert.equal(lib.LATE_REASON_MAX, 500)
  assert.equal(lib.LATE_CLOSE_PERMISSION, 'shift_close_forgotten')
})

check('isLateClose: only a business day before today is late', () => {
  for (const row of cases.isLateClose) assert.equal(lib.isLateClose(row.businessDate, row.today), row.late, JSON.stringify(row))
})

check('lateCloseBounds: the Cambodia day start, 23:59:59 and the next midnight', () => {
  for (const row of cases.bounds) {
    const got = lib.lateCloseBounds(row.businessDate, cases.offsetMinutes)
    if (row.start === null) { assert.equal(got, null, JSON.stringify(row)); continue }
    assert.equal(new Date(got.startMs).toISOString(), row.start)
    assert.equal(new Date(got.lastSecondMs).toISOString(), row.lastSecond)
    assert.equal(new Date(got.endExclusiveMs).toISOString(), row.endExclusive)
    assert.equal(got.endExclusiveMs - got.lastSecondMs, 1000, '23:59:59 is the last second before the next midnight')
  }
})

check('lateReason: trimmed, 1 to 500 characters, text only', () => {
  for (const row of cases.reason) {
    if (row.repeat) assert.equal(lib.lateReason(row.repeat.repeat(row.times)) !== null, row.valid, `${row.times} characters`)
    else assert.equal(lib.lateReason(row.input), row.reason, JSON.stringify(row))
  }
})

check('lateAmendmentReason: "Late close: <reason>"', () => {
  for (const row of cases.amendment) assert.equal(lib.lateAmendmentReason(row.reason), row.text)
})

check('holdsLateClosePermission: strict true, and an administrator always passes', () => {
  for (const row of cases.permission) assert.equal(lib.holdsLateClosePermission(row.merged, row.admin), row.allowed, JSON.stringify(row))
})

console.log(`\nALL ${passed} CHECKS PASSED`)
