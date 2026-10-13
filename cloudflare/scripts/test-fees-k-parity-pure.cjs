// Finding K (claude/fees-k-fix-20261013): rules that had to be written twice because one copy lives where the other
// cannot be imported from. Each pair must stay identical; this file fails the moment one side moves alone.
//
// Run (from cloudflare/): node scripts/test-fees-k-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8').replace(/\r\n/g, '\n')
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log('PASS ' + name) }

function constList(source, name) {
  const match = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\] as const').exec(source)
  assert.ok(match, name + ' not found')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}
function constNumber(source, name) {
  const match = new RegExp('export const ' + name + ' = (\\d+)').exec(source)
  assert.ok(match, name + ' not found')
  return Number(match[1])
}

check('the approved delete records the same expense fields as the direct delete (K4)', () => {
  const direct = constList(src('routes/fees.ts'), 'FEE_AUDIT_COLUMNS')
  const approved = constList(src('lib/reviewApply.ts'), 'FEE_DELETE_AUDIT_COLUMNS')
  assert.ok(direct.length >= 9, 'the direct list is the full editable surface')
  assert.deepEqual(approved, direct)
})

check('a reject reason has the same cap and measure as every stock reason (K7)', () => {
  const review = constNumber(src('lib/pendingActions.ts'), 'REVIEW_REASON_MAX_LENGTH')
  const stock = constNumber(src('lib/stockReason.ts'), 'STOCK_REASON_MAX_LENGTH')
  assert.equal(review, stock)
  const route = src('routes/reviewQueue.ts')
  assert.match(route, /reason\.length > REVIEW_REASON_MAX_LENGTH/, 'measured in code units, like stockReasonTooLong')
  assert.match(route, /code: 'reason_too_long' \}, 400\)/, 'the same coded refusal as the stock reason writers')
})

console.log('\n' + passed + ' K parity check(s) passed.')
