// Every route that MOVES stock needs a documented cause -- the same rule
// POST /inventory/adjust has enforced since it grew `if (!reason) return
// c.json(...)`.
//
// Before this test the rule existed on exactly one of the five stock-moving
// routes. Inventory.tsx refused a transfer without a reason in the browser
// (Inventory.tsx's `transfer_reason_required` notify), but nothing behind it
// did: POST /inventory/transfer and POST /inventory/move-row both accepted
// `reason === null` and wrote the movement anyway, and POST /branches/transfer
// and POST /branches/transfer-bulk only read an OPTIONAL `note` which they
// folded into a boilerplate sentence. So a stale tab, a replayed offline
// write, or any direct API caller could move stock between branches with no
// recorded cause at all -- a frontend-only validation with no backend half.
//
// What is exercised here, on all four transfer/move routes:
//   1. The guard exists, inside the route, and refuses BEFORE the route's
//      atomic write -- a 400 that lands after db.batch() would report a
//      transfer that had already happened.
//   2. The refusal is the EXACT English of the `transfer_reason_required`
//      pack key, in every route, byte-identical -- the convention
//      branchRoleGuards' TRANSFER_DIRECTION_ERROR already follows, and what
//      a client-side mapping keys off. Pinned here so the wording cannot
//      drift away from the pack. Note the mapping does NOT cover this
//      sentence yet (BRANCH_RULE_MESSAGE_KEYS in
//      frontend/src/api/branchRuleErrors.ts carries only the two
//      branch-role refusals), so a rejection that outruns the UI still
//      surfaces in English until one entry is added there.
//   3. The tolerant cut, RUN rather than read: each route's own reason
//      expression is lifted out of the source and evaluated against the
//      payload shapes that actually reach it. A new client sends `reason`; a
//      cached PWA build or a queued offline replay still sends the legacy
//      `note`, and a non-empty one is accepted as the reason for this
//      release. Blank/whitespace/absent on BOTH is rejected everywhere.
//   4. The operator's reason is stored in inventory_movements.reason AS
//      TYPED -- not wrapped in "Transfer out to <branch> - <reason>". The
//      column is the audit trail's reason field; a boilerplate sentence in
//      it makes every reason-based read (the Stock Change ledger, any
//      export) show machine prose instead of what the operator wrote, and
//      makes the two legs of one transfer disagree about their own reason.
//
// Run: node scripts/test-inventory-transfer-reason-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const readWorker = (relPath) => fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8').replace(/\r\n/g, '\n')
const readRepo = (relPath) => fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8').replace(/\r\n/g, '\n')

let failures = 0
function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}`)
    console.error(error && error.message ? error.message : error)
  }
}

const inventorySource = readWorker('routes/inventory.ts')
const branchesSource = readWorker('routes/branches.ts')

// One route's body: from its `app.post('<path>'` to the next top-level
// `app.<verb>(` registration, so an assertion about "this route" can never be
// satisfied by a neighbouring one.
function routeSlice(source, marker, label) {
  const start = source.indexOf(marker)
  assert.ok(start > 0, `${label}: route ${marker} must still exist`)
  const rest = source.indexOf('\napp.', start + marker.length)
  return source.slice(start, rest === -1 ? source.length : rest)
}

const ROUTES = [
  { label: 'POST /inventory/transfer', source: inventorySource, marker: "app.post('/transfer'" },
  { label: 'POST /inventory/move-row', source: inventorySource, marker: "app.post('/move-row'" },
  { label: 'POST /branches/transfer', source: branchesSource, marker: "app.post('/transfer'" },
  { label: 'POST /branches/transfer-bulk', source: branchesSource, marker: "app.post('/transfer-bulk'" },
].map((route) => ({ ...route, body: routeSlice(route.source, route.marker, route.label) }))

// The one English sentence, read out of the pack rather than restated here --
// a copy in this file would go stale exactly when the pack was reworded.
const en = JSON.parse(readRepo('frontend/src/lang/en.json'))
const km = JSON.parse(readRepo('frontend/src/lang/km.json'))
const REFUSAL = en.transfer_reason_required

runTest('the refusal sentence is a real, translated pack key', () => {
  assert.equal(typeof REFUSAL, 'string')
  assert.ok(REFUSAL.trim().length > 0, 'en.transfer_reason_required must not be empty')
  assert.ok(km.transfer_reason_required, 'km.json must carry transfer_reason_required')
  assert.notEqual(km.transfer_reason_required, REFUSAL, 'the Khmer entry must actually be Khmer, not the English copied over')
})

runTest('every transfer/move route refuses a missing reason', () => {
  for (const route of ROUTES) {
    assert.ok(
      route.body.includes('if (!reason) return c.json('),
      `${route.label}: needs the same \`if (!reason) return c.json(...)\` guard POST /adjust has`,
    )
    assert.ok(
      route.body.includes(`if (!reason) return c.json({ error: '${REFUSAL}' }, 400)`),
      `${route.label}: the refusal must be the exact English of transfer_reason_required (${JSON.stringify(REFUSAL)})`,
    )
  }
})

runTest('the refusal lands before the route moves any stock', () => {
  for (const route of ROUTES) {
    const guardAt = route.body.indexOf('if (!reason) return c.json(')
    assert.ok(guardAt > 0, `${route.label}: guard must be inside the route`)
    // Every one of these routes commits through db.batch(); /move-row also
    // drains lots through removeStockAcrossBatches/receiveBatchStock first.
    for (const write of ['db.batch(', 'removeStockAcrossBatches(', 'receiveBatchStock(', 'applyStockDelta(']) {
      const writeAt = route.body.indexOf(write)
      if (writeAt === -1) continue
      assert.ok(guardAt < writeAt, `${route.label}: the reason guard must run before \`${write}\`, not after the stock has moved`)
    }
  }
})

// The tolerant cut, executed. Each route's own `const reason = ...`
// expression is lifted out and run -- a text match would pass on an
// expression that reads the fields and then throws them away.
const PAYLOADS = [
  { name: 'new client sends reason', body: { reason: 'Restocking Shop' }, expect: 'Restocking Shop' },
  { name: 'reason wins over a stale note', body: { reason: 'Restocking Shop', note: 'legacy' }, expect: 'Restocking Shop' },
  { name: 'legacy note is accepted (cached build / offline replay)', body: { note: 'Bulk branch change' }, expect: 'Bulk branch change' },
  { name: 'padding is trimmed', body: { reason: '   Restock   ' }, expect: 'Restock' },
  { name: 'blank reason falls through to the note', body: { reason: '   ', note: 'Bulk branch change' }, expect: 'Bulk branch change' },
  { name: 'blank on both is nothing', body: { reason: '   ', note: '  ' }, expect: null },
  { name: 'empty strings are nothing', body: { reason: '', note: '' }, expect: null },
  { name: 'absent on both is nothing', body: {}, expect: null },
]

runTest('every route parses reason the same way, with the legacy note fallback', () => {
  for (const route of ROUTES) {
    const match = route.body.match(/\n\s*const reason = (.+)\n/)
    assert.ok(match, `${route.label}: needs its own \`const reason = ...\` line`)
    const expression = match[1].trim()
    assert.ok(expression.includes('body.reason'), `${route.label}: must read the new \`reason\` field`)
    assert.ok(expression.includes('body.note'), `${route.label}: must still accept the legacy \`note\` field (tolerant cut)`)
    const parse = new Function('body', `return ${expression}`)
    for (const payload of PAYLOADS) {
      assert.strictEqual(
        parse(payload.body),
        payload.expect,
        `${route.label}: ${payload.name}`,
      )
    }
    // ...and the guard's own predicate agrees about what "no reason" means.
    for (const payload of PAYLOADS) {
      assert.strictEqual(
        !parse(payload.body),
        payload.expect === null,
        `${route.label}: the !reason guard must reject exactly the blank cases (${payload.name})`,
      )
    }
  }
})

runTest('the operator reason is stored as typed, not wrapped in boilerplate', () => {
  for (const route of ROUTES) {
    // Every inventory_movements insert in the route must bind the plain
    // `reason` binding, never a template that decorates it.
    for (const wrapper of [
      'reason: `Transfer out to',
      'reason: `Transfer in from',
      'reason: reason ? `Moved to',
      'reason: reason ? `Moved from',
      '${reason ? ` - ${reason}` : \'\'}',
    ]) {
      assert.ok(
        !route.body.includes(wrapper),
        `${route.label}: inventory_movements.reason must hold what the operator typed, found boilerplate ${JSON.stringify(wrapper)}`,
      )
    }
    const movementInserts = (route.body.match(/INSERT INTO inventory_movements/g) || []).length
    assert.ok(movementInserts >= 2, `${route.label}: expected both movement legs to still be written`)
  }
})

if (failures) {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
}
console.log('\nAll transfer-reason tests passed')
