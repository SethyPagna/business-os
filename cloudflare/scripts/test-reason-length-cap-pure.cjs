// P3-L2 (2026-09-14): every reason writer caps at the same 500 characters.
//
// PATCH /api/inventory/movements/:id/reason has refused a reason longer than
// 500 since it was built, and the stock-session parser caps at 500 too. The
// other two writers -- POST /api/inventory/adjust and POST /api/batches --
// took whatever they were sent. That asymmetry is not cosmetic: a reason
// written through either of those wires could be longer than the editor is
// allowed to save, so correcting it afterwards was impossible.
//
// The guard is read OUT of the two routes and executed, rather than merely
// matched, so a future edit that moves the boundary to >= or to 501 fails
// here instead of passing a shape check.
//
// Run: node scripts/test-reason-length-cap-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8')

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const GUARD = /if \(reason && reason\.length > (\d+)\) return c\.json\(\{ error: '([^']+)', code: '([^']+)' \}, 400\)/

const writers = [
  ['POST /api/inventory/adjust', 'cloudflare/src/routes/inventory.ts'],
  ['POST /api/batches', 'cloudflare/src/routes/batches.ts'],
]

for (const [label, file] of writers) {
  check(`${label} refuses a reason over 500 characters, with a code`, () => {
    const source = read(file)
    const match = source.match(GUARD)
    assert.ok(match, `${file} has no reason-length guard`)
    const [, limit, message, code] = match
    assert.equal(limit, '500', `${label} must use the same limit as the reason editor`)
    assert.equal(code, 'reason_too_long')
    assert.match(message, /too long/i)
    // Run the real predicate: 500 passes, 501 is refused, and a null or
    // blank reason never trips this guard (the required-reason check is a
    // separate rule, and /api/batches allows no reason at all).
    const refuses = new Function('reason', `return !!(reason && reason.length > ${limit})`)
    assert.equal(refuses('x'.repeat(500)), false)
    assert.equal(refuses('x'.repeat(501)), true)
    assert.equal(refuses(''), false)
    assert.equal(refuses(null), false)
  })
}

check('the reason editor and the session parser still set that same 500', () => {
  const inventory = read('cloudflare/src/routes/inventory.ts')
  assert.match(inventory, /if \(reason\.length > 500\) return c\.json\(\{ error: 'Reason is too long' \}, 400\)/)
  const session = read('cloudflare/src/lib/stockSession.ts')
  assert.match(session, /const reason = text\(expanded\('reason'\), 'reason', 500\)/)
  // And the one input the operator types into stops at the same number, so
  // the cap is never discovered only after the write is attempted.
  const field = read('frontend/src/components/shared/StockReasonField.tsx')
  assert.match(field, /maxLength=\{500\}/)
})

if (failed > 0) {
  console.error(`${failed} reason-length cap check(s) failed`)
  process.exitCode = 1
}
