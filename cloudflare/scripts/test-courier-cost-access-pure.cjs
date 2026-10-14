'use strict'
// The courier's actual cost sits behind one permission (sales:view_courier_cost, lib/courierCostAccess.ts):
// on for an administrator and for every role that holds Sales until the role editor switches it off, absent
// for a caller with no Sales grant. It gates the sale's own history (the Records trail and the amendment
// ledger), the audit log, and the sale's current row (the list, and every write response that returns the
// sale's canonical snapshot). Amending a sale is not a way to it.
//
// The records are built by the REAL builder (lib/saleRecords.ts), so a change to
// the summary wording or to the change-field names that the redaction relies on
// fails here instead of leaking. Each case has a control (the administrator, or
// the same row with the redaction mutated away) that proves the check can see
// the figure it is looking for.
//
// Run: node scripts/test-courier-cost-access-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(relative, source = null) {
  const file = path.resolve(root, relative)
  if (!source && cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  if (!source) cache.set(file, mod)
  const code = transformSync(source ?? fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const next = (id) => (id.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts') : require(id))
  new Function('require', 'module', 'exports', code)(withProductStockGuard(next), mod, mod.exports)
  return mod.exports
}
const gateSource = fs.readFileSync(path.join(root, 'src/lib/courierCostAccess.ts'), 'utf8')
const access = load('src/lib/courierCostAccess.ts')
const records = load('src/lib/saleRecords.ts')
const creation = load('src/lib/saleCreationSnapshot.ts')

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }

const ADMIN = { role_code: 'admin', role_permissions: '{}' }
const ALL_GRANT = { role_code: 'employee', role_permissions: '{"all":true}' }
const OFF = '"sales:view_courier_cost":false'
const COST_VIEWER = { role_code: 'employee', role_permissions: `{"sales":"view","reports":true,"product_cost_view":true,${OFF}}` }
const AMENDER = { role_code: 'employee', role_permissions: `{"sales":true,"sales:amend":true,"product_cost_view":true,${OFF}}` }
const PLAIN = { role_code: 'employee', role_permissions: `{"sales":"view","reports":true,${OFF}}` }
const DEFAULT_VIEWER = { role_code: 'employee', role_permissions: '{"sales":"view","reports":true}' }
const DEFAULT_STAFF = { role_code: 'employee', role_permissions: '{"sales":true,"sales:amend":false}' }
const DEFAULT_AMENDER = { role_code: 'employee', role_permissions: '{"sales":true,"sales:amend":true}' }

// Every place a figure can hide: a number, a key, and text.
const HIDDEN = [0.83, 1.37, 0.54, 1.91]
const leaks = (value) => {
  const found = []
  const walk = (node, trail) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') {
      const t = node.trim()
      if (/^[[{]/.test(t)) { try { walk(JSON.parse(t), `${trail}(json)`); return } catch { /* text */ } }
      for (const n of HIDDEN) if (new RegExp(`(?<![\\d.])${String(n).replace('.', '\\.')}(?!\\d)`).test(node)) found.push(`${trail} text ${n}`)
      return
    }
    if (typeof node === 'number') { if (HIDDEN.some((n) => Math.abs(n - node) < 1e-9)) found.push(`${trail}=${node}`); return }
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${trail}[${i}]`)); return }
    if (typeof node === 'object') for (const [k, v] of Object.entries(node)) {
      if (/actual_delivery_cost|delivery_actual_cost|^actual_cost_(before|after)$/.test(k)) found.push(`${trail}.${k} (key)`)
      walk(v, `${trail}.${k}`)
    }
  }
  walk(value, '')
  return found
}

// ---- the gate ----------------------------------------------------------------
check('gate: an administrator, an all-grant and every Sales role (until switched off) may read the courier cost', () => {
  for (const [name, user] of [['administrator', ADMIN], ['all-grant', ALL_GRANT], ['Sales view tier', DEFAULT_VIEWER],
    ['Sales full, no amend', DEFAULT_STAFF], ['Sales full with amend', DEFAULT_AMENDER]]) {
    assert.equal(access.canViewCourierCost(user), true, name)
  }
})
check('gate: the switch, a missing Sales grant and a non-staff principal close it; a cost grant or amend never opens it', () => {
  assert.equal(access.canViewCourierCost(COST_VIEWER), false, 'a cost-view grant is not the courier permission')
  assert.equal(access.canViewCourierCost(AMENDER), false, 'amending a sale is not the courier permission')
  assert.equal(access.canViewCourierCost(PLAIN), false)
  assert.equal(access.canViewCourierCost({ role_code: 'employee', role_permissions: '{"reports":true,"dashboard":true,"product_cost_view":true}' }), false, 'no Sales grant')
  assert.equal(access.canViewCourierCost({ role_code: 'customer', role_permissions: '{}' }), false, 'a storefront or customer principal holds no Sales grant')
  assert.equal(access.canViewCourierCost(null), false)
  assert.equal(access.canViewCourierCost({ role_code: 'employee', role_permissions: '{"sales":false,"sales:view_courier_cost":true}' }), false, 'an override can only remove: it never grants past a missing tier')
  assert.equal(access.canViewCourierCost({ role_code: 'employee', role_permissions: '{"sales":true,"sales:view_courier_cost":"no"}' }), true, 'only an explicit false switches it off')
  assert.equal(access.canViewCourierCost({ role_code: 'admin', role_permissions: `{${OFF}}` }), true, 'an administrator is never narrowed')
  assert.equal(access.canViewCourierCost({ role_code: 'employee', role_permissions: `{"sales":true,${OFF}}`, permissions: '{"sales:view_courier_cost":true}' }), true, 'a per-user value overrides the role, key by key')
})

// ---- the records, built by the real builder ----------------------------------------
const SALE = { id: 77, receipt_number: 'R-77', sale_status: 'completed', cashier_name: 'sokha', total_usd: 12, created_at: '2026-10-05T03:00:00.000Z' }
const SNAPSHOT_SALE = {
  ...SALE,
  creation_snapshot_json: creation.buildSaleCreationSnapshot({
    origin: 'sales_import', recordedAt: '2026-10-05T10:00:00.000Z', saleAt: '2026-10-05T03:00:00.000Z', receiptNumber: 'R-77',
    actor: { id: 9, username: 'sokha' }, cashierId: 3, cashierName: 'sokha', saleStatus: 'completed',
    items: [{ product_id: 4, product_name: 'Serum', sku: 'S1', quantity: 1, applied_price_usd: 10, total_usd: 10 }],
    totalUsd: 12, paymentMethod: 'Cash', paymentDetails: [{ method: 'Cash', amount_usd: 12, amount_khr: 0 }],
    amountPaidUsd: 12, amountPaidKhr: 0, changeUsd: 0, changeKhr: 0,
    isDelivery: true, deliveryContactName: 'Dara', deliveryContactPhone: '012', deliveryFeeUsd: 2, deliveryActualCostUsd: 0.83,
  }),
}
const LEDGER = [
  { id: 1, kind: 'delivery_actual_cost_changed', product_name: null, quantity_before: null, quantity_after: null,
    amount_before_usd: 0.83, amount_after_usd: 1.37, total_before_usd: 12, total_after_usd: 12, units_moved: 0, stock_skipped: 0,
    via: 'amend', user_name: 'dara', created_at: '2026-10-05 11:00:00' },
  { id: 2, kind: 'delivery_actual_cost_changed', product_name: null, quantity_before: null, quantity_after: null,
    amount_before_usd: null, amount_after_usd: 1.91, total_before_usd: 12, total_after_usd: 12, units_moved: 0, stock_skipped: 0,
    via: 'undo', user_name: 'dara', created_at: '2026-10-05 11:05:00' },
  { id: 3, kind: 'delivery_fee_changed', product_name: null, quantity_before: null, quantity_after: null,
    amount_before_usd: 2, amount_after_usd: 2.5, total_before_usd: 12, total_after_usd: 12.5, units_moved: 0, stock_skipped: 0,
    via: 'amend', user_name: 'dara', created_at: '2026-10-05 11:10:00' },
]
const built = records.buildSaleRecords({ sale: SNAPSHOT_SALE, ledger: LEDGER })
const costRecords = built.filter((record) => record.kind === 'delivery_cost_changed')

check('control: the builder puts the courier cost in the summary, the change rows and the creation snapshot', () => {
  assert.equal(costRecords.length, 2)
  assert.match(costRecords[0].summary, /^Actual delivery cost \$0\.83 to \$1\.37$/)
  assert.match(costRecords[1].summary, /^Actual delivery cost - to \$1\.91$/, 'an unset side prints "-"')
  assert.ok(leaks(built).length >= 6, `the instrument sees ${leaks(built).length} sightings in the unredacted records`)
  const created = built.find((record) => record.kind === 'sale_created').changes.find((change) => change.field === 'delivery')
  assert.equal(created.after.value.actual_delivery_cost_usd, 0.83)
})

for (const [name, user] of [['cost viewer', COST_VIEWER], ['sales amender with the cost grant, switched off', AMENDER], ['plain reader', PLAIN]]) {
  check(`${name}: no figure survives in the records, in any field or in the text`, () => {
    assert.deepEqual(leaks(access.redactSaleRecords(built, user)), [])
  })
}

check('administrator and a default Sales role: the records are returned untouched (same objects)', () => {
  for (const user of [ADMIN, ALL_GRANT, DEFAULT_VIEWER, DEFAULT_STAFF, DEFAULT_AMENDER]) assert.strictEqual(access.redactSaleRecords(built, user), built)
})

check('a redacted trail keeps every record, kind, actor, time and the customer fee', () => {
  const shown = access.redactSaleRecords(built, PLAIN)
  assert.deepEqual(shown.map((record) => [record.id, record.kind, record.actor_username, record.at]), built.map((record) => [record.id, record.kind, record.actor_username, record.at]))
  const created = shown.find((record) => record.kind === 'sale_created').changes.find((change) => change.field === 'delivery')
  assert.equal(created.after.value.delivery_fee_usd, 2, 'the fee is revenue and stays')
  assert.equal(created.after.value.driver.name, 'Dara')
  const fee = shown.find((record) => record.kind === 'delivery_fee_changed')
  assert.deepEqual(fee.changes.find((change) => change.field === 'delivery_fee_usd'), built.find((record) => record.kind === 'delivery_fee_changed').changes.find((change) => change.field === 'delivery_fee_usd'))
  assert.match(fee.summary, /^Delivery fee \$2\.00 to \$2\.50$/, 'a fee summary keeps its amounts')
})

check('a cost-change summary reads "Actual delivery cost changed" and keeps a replay suffix', () => {
  const shown = access.redactSaleRecords(built, PLAIN).filter((record) => record.kind === 'delivery_cost_changed')
  assert.deepEqual(shown.map((record) => record.summary), ['Actual delivery cost changed', 'Actual delivery cost changed'])
  const replay = { ...costRecords[0], summary: `${costRecords[0].summary} undone` }
  assert.equal(access.redactSaleRecords([replay], PLAIN)[0].summary, 'Actual delivery cost changed undone')
  const unknownActor = { ...costRecords[0], summary: `${costRecords[0].summary}; replay actor and time unavailable` }
  assert.equal(access.redactSaleRecords([unknownActor], PLAIN)[0].summary, 'Actual delivery cost changed; replay actor and time unavailable')
})

check('an event record carrying only the courier cost keeps its place with no rows; a mixed row loses only the cost', () => {
  const state = (value) => ({ state: 'known_value', value })
  const onlyCost = { id: 'event:1', source: 'audit', at: 'x', at_ms: 1, actor_username: 'a', kind: 'delivery_cost_changed', via: 'amend', subject: 'delivery', summary: 'Sale record changed',
    changes: [{ field: 'actual_delivery_cost_usd', before: state(0.83), after: state(1.37) }] }
  const mixed = { ...onlyCost, id: 'event:2', kind: 'delivery_added', changes: [
    { field: 'delivery_fee_usd', before: state(0), after: state(3.25) },
    { field: 'actual_delivery_cost_usd', before: { state: 'known_none' }, after: state(1.91) },
    { field: 'delivery', before: state({ is_delivery: true, delivery_fee_usd: 3, actual_delivery_cost_usd: 0.83 }), after: state({ is_delivery: true, delivery_fee_usd: 3, actual_delivery_cost_usd: 1.37 }) },
  ] }
  const [a, b] = access.redactSaleRecords([onlyCost, mixed], PLAIN)
  assert.deepEqual(a.changes, [])
  assert.deepEqual(b.changes.map((change) => change.field), ['delivery_fee_usd'], 'the composite whose only difference was the cost is not a change a reader may see')
  assert.deepEqual(leaks([a, b]), [])
})

// ---- the amendment ledger ----------------------------------------------------------
const ledger = [
  { id: 1, kind: 'delivery_actual_cost_changed', amount_before_usd: 0.83, amount_after_usd: 1.37, amount_delta_usd: 0.54, total_before_usd: 12, total_after_usd: 12,
    before_json: null, after_json: null, user_name: 'dara', created_at: '2026-10-05 11:00:00', note: null },
  { id: 2, kind: 'delivery_added', amount_before_usd: 0, amount_after_usd: 3.25, amount_delta_usd: 3.25, total_before_usd: 10, total_after_usd: 13.25,
    before_json: JSON.stringify({ delivery_fee_usd: 0, delivery_actual_cost_usd: null, delivery_actual_cost_khr: null }),
    after_json: JSON.stringify({ delivery_fee_usd: 3.25, delivery_actual_cost_usd: 1.91, delivery_actual_cost_khr: 7640 }),
    user_name: 'dara', created_at: '2026-10-05 11:10:00', note: null },
  { id: 3, kind: 'delivery_fee_changed', amount_before_usd: 3.25, amount_after_usd: 3.75, amount_delta_usd: 0.5, total_before_usd: 13.25, total_after_usd: 13.75,
    before_json: JSON.stringify({ total_usd: 13.25 }), after_json: JSON.stringify({ total_usd: 13.75 }), user_name: 'dara', created_at: '2026-10-05 11:20:00', note: 'fee' },
  { id: 4, kind: 'line_removed', product_name: 'Serum', quantity_before: 1, quantity_after: 0, before_json: 'not json', after_json: '', user_name: 'dara', created_at: '2026-10-05 11:30:00' },
]

check('control: the unredacted ledger shows the cost in the amounts and in the snapshot', () => {
  assert.ok(leaks(ledger).length >= 5, `${leaks(ledger).length} sightings`)
})

for (const [name, user] of [['cost viewer', COST_VIEWER], ['plain reader', PLAIN], ['sales amender, switched off', AMENDER]]) {
  check(`${name}: no amendment entry carries a figure, a key or a delta`, () => {
    assert.deepEqual(leaks(access.redactAmendmentEntries(ledger, user)), [])
  })
}

check('administrator and a default Sales role: the ledger is returned untouched', () => {
  for (const user of [ADMIN, DEFAULT_VIEWER, DEFAULT_STAFF, DEFAULT_AMENDER]) assert.strictEqual(access.redactAmendmentEntries(ledger, user), ledger)
})

check('a redacted ledger keeps every entry, the fee amounts and the totals, and marks only what it changed', () => {
  const shown = access.redactAmendmentEntries(ledger, PLAIN)
  assert.deepEqual(shown.map((entry) => [entry.id, entry.kind, entry.user_name, entry.created_at]), ledger.map((entry) => [entry.id, entry.kind, entry.user_name, entry.created_at]))
  const [cost, added, fee, line] = shown
  assert.deepEqual([cost.amount_before_usd, cost.amount_after_usd, cost.amount_delta_usd], [null, null, null])
  assert.deepEqual([cost.total_before_usd, cost.total_after_usd], [12, 12])
  assert.equal(cost.courier_cost_hidden, true)
  assert.deepEqual(JSON.parse(added.after_json), { delivery_fee_usd: 3.25 })
  assert.equal(added.amount_after_usd, 3.25, 'the fee column stays')
  assert.equal(added.courier_cost_hidden, true)
  assert.strictEqual(fee, ledger[2], 'an entry with nothing to hide is the same object')
  assert.strictEqual(line, ledger[3], 'a snapshot that is not JSON is left as it was')
  assert.equal('courier_cost_hidden' in fee, false)
})

// ---- the audit log: a sale amendment's row names the cost in details and new_value -----------
const costAudit = JSON.stringify({ action: 'amend', kind: 'delivery_actual_cost_changed', actual_cost_before: 0.83, actual_cost_after: 1.37, total_before: 12, total_after: 12, notes: null })
const addedAudit = JSON.stringify({ action: 'amend', kind: 'delivery_added', before: { delivery_fee_usd: 0, delivery_actual_cost_usd: null }, after: { delivery_fee_usd: 3.25, delivery_actual_cost_usd: 1.91, delivery_actual_cost_khr: 7640 } })
const feeAudit = JSON.stringify({ action: 'amend', kind: 'delivery_fee_changed', fee_before: 3.25, fee_after: 3.75 })
const auditRows = [
  { id: 1, entity: 'sale', details: costAudit, old_value: null, new_value: costAudit },
  { id: 2, entity: 'sale', details: addedAudit, old_value: null, new_value: addedAudit },
  { id: 3, entity: 'sale', details: feeAudit, old_value: null, new_value: feeAudit },
  { id: 4, entity: 'product', details: 'not json mentioning actual_cost_before', old_value: null, new_value: null },
]
check('control: the audit rows carry the cost in details and in new_value', () => {
  assert.ok(leaks(auditRows).length >= 8, `${leaks(auditRows).length} sightings`)
})
for (const [name, user] of [['cost viewer', COST_VIEWER], ['plain reader', PLAIN]]) {
  check(`${name}: no audit row carries the cost, and the fee amounts and the rows themselves stay`, () => {
    const shown = access.redactAuditRows(auditRows, user)
    assert.deepEqual(leaks(shown), [])
    assert.deepEqual(shown.map((row) => row.id), [1, 2, 3, 4])
    assert.strictEqual(shown[2], auditRows[2], 'a fee row is returned as it was')
    assert.deepEqual(JSON.parse(shown[2].details), { action: 'amend', kind: 'delivery_fee_changed', fee_before: 3.25, fee_after: 3.75 })
    assert.equal(JSON.parse(shown[1].details).after.delivery_fee_usd, 3.25)
    assert.equal(JSON.parse(shown[0].details).total_before, 12)
    assert.strictEqual(shown[3], auditRows[3], 'text that is not JSON is not rewritten')
  })
}
check('administrator and a default Sales role: the audit rows are returned untouched', () => {
  for (const user of [ADMIN, DEFAULT_VIEWER, DEFAULT_STAFF]) assert.strictEqual(access.redactAuditRows(auditRows, user), auditRows)
})

// ---- negative controls: the checks above must catch a plausible wrong gate ---------------
const mutate = (from, to) => {
  assert.equal(gateSource.split(from).length - 1, 1, `mutant anchor must occur once: ${from}`)
  return load('src/lib/courierCostAccess.ts', gateSource.replace(from, to))
}
const GATE_EXPRESSION = "return isAdminControlUser(user) || getActionTier(user, 'sales', 'view_courier_cost') !== 'none'"
const wrongGate = {
  'every caller': 'return true',
  'cost grant opens it': 'return isAdminControlUser(user) || /product_cost_view/.test(String(user && user.role_permissions))',
  'full amender opens it (the retired interim rule)': "return isAdminControlUser(user) || getActionTier(user, 'sales', 'amend') === 'full'",
  'the switch is ignored': "return isAdminControlUser(user) || getActionTier(user, 'sales', 'view') !== 'none'",
  'administrators only': 'return isAdminControlUser(user)',
}
for (const [name, body] of Object.entries(wrongGate)) {
  check(`mutant (${name}): the gate verdicts differ from the rule and this file notices`, () => {
    const bad = mutate(GATE_EXPRESSION, body)
    const verdicts = [ADMIN, DEFAULT_VIEWER, DEFAULT_STAFF, DEFAULT_AMENDER, COST_VIEWER, AMENDER, PLAIN].map((user) => bad.canViewCourierCost(user))
    const rule = [ADMIN, DEFAULT_VIEWER, DEFAULT_STAFF, DEFAULT_AMENDER, COST_VIEWER, AMENDER, PLAIN].map((user) => access.canViewCourierCost(user))
    assert.notDeepEqual(verdicts, rule)
  })
}
check('mutant (every caller): the cost viewer\'s records leak and this file notices', () => {
  const bad = mutate(GATE_EXPRESSION, 'return true')
  assert.notDeepEqual(leaks(bad.redactSaleRecords(built, COST_VIEWER)), [])
  assert.notDeepEqual(leaks(bad.redactAmendmentEntries(ledger, COST_VIEWER)), [])
})
check('mutant (summary text kept): the amounts in the summary are caught', () => {
  const bad = mutate("record.summary.replace(COURIER_COST_SUMMARY, '$1 changed')", 'record.summary')
  assert.ok(leaks(bad.redactSaleRecords(built, PLAIN)).some((hit) => hit.includes('summary')))
})
check('mutant (ledger amounts kept): the cost-change entry amounts are caught', () => {
  const bad = mutate('const costEntry = row.kind === COST_LEDGER_KIND', 'const costEntry = false')
  assert.ok(leaks(bad.redactAmendmentEntries(ledger, PLAIN)).some((hit) => hit.includes('amount_')))
})
check('mutant (khr key kept): the converted riel amount is caught', () => {
  const bad = mutate("'delivery_actual_cost_usd', 'delivery_actual_cost_khr', 'actual_delivery_cost_usd', 'actual_delivery_cost_khr',", "'delivery_actual_cost_usd', 'actual_delivery_cost_usd',")
  assert.ok(leaks(bad.redactAmendmentEntries(ledger, PLAIN)).some((hit) => hit.includes('delivery_actual_cost_khr')))
})

// ---- a write response: the sale's canonical row leaves by the list's rule ----
const saleSnapshot = () => ({
  id: 7, saleStatus: 'completed', deliveryActualCostUsd: 1.37, deliveryActualCostKhr: 5480,
  sale: { id: 7, delivery_fee_usd: 2, delivery_actual_cost_usd: 1.37, delivery_actual_cost_khr: 5480, items: [{ id: 1, total_usd: 10, cost_price_usd: 4 }],
    snapshot_json: JSON.stringify({ delivery: { delivery_fee_usd: 2, actual_delivery_cost_usd: 0.83 } }) },
})
for (const [who, user] of [['a plain reader', PLAIN], ['a cost viewer', COST_VIEWER], ['a full amender with the permission off', AMENDER]]) {
  check(`${who} gets a write response without the cost keys, camelCase and snake_case, at any depth and inside JSON strings`, () => {
    const out = access.projectCourierCostResponse(saleSnapshot(), user)
    assert.deepEqual(leaks(out), [])
    assert.equal(out.sale.delivery_fee_usd, 2, 'the customer delivery fee stays')
    assert.equal(out.sale.items[0].total_usd, 10, 'the rest of the snapshot stays')
    assert.equal(out.id, 7)
  })
}
for (const [who, user] of [['an administrator', ADMIN], ['a default Sales role', DEFAULT_STAFF], ['a full amender with the permission on', DEFAULT_AMENDER]]) {
  check(`control: ${who} gets the write response untouched`, () => {
    const body = saleSnapshot()
    assert.equal(access.projectCourierCostResponse(body, user), body)
    assert.notDeepEqual(leaks(body), [], 'the instrument sees the figure in the untouched body')
  })
}
const deep = (levels, leaf) => { let node = leaf; for (let i = 0; i < levels; i += 1) node = { wrap: node }; return node }
const deepRecord = () => ({ ...built.find((entry) => entry.changes && entry.changes.length), changes: [{ field: 'delivery', before: deep(20, { actual_delivery_cost_usd: 0.83 }), after: deep(20, { actual_delivery_cost_usd: 1.37 }) }] })
check('past the depth cap the response projector drops the subtree instead of passing it through', () => {
  const body = { sale: deep(20, { delivery_actual_cost_usd: 1.37, note: 'x' }) }
  assert.notDeepEqual(leaks(body), [], 'control: the figure is in the deep body')
  assert.deepEqual(leaks(access.projectCourierCostResponse(body, PLAIN)), [])
})
check('past the depth cap a records snapshot is dropped, not passed through', () => {
  assert.notDeepEqual(leaks(deepRecord()), [], 'control: the figures are in the deep snapshot')
  assert.deepEqual(leaks(access.redactSaleRecords([deepRecord()], PLAIN)), [])
})
check('mutant (gate removed): the administrator no longer gets the write response untouched and this file notices', () => {
  const bad = mutate('  if (canViewCourierCost(user)) return body\n', '')
  const body = saleSnapshot()
  assert.notEqual(bad.projectCourierCostResponse(body, ADMIN), body)
})
check('mutant (projector cap passes the subtree through): a response nested past the cap leaks and this file notices', () => {
  const bad = mutate('    if (depth > MAX_STRIP_DEPTH) return null\n', '    if (depth > MAX_STRIP_DEPTH) return input\n')
  assert.notDeepEqual(leaks(bad.projectCourierCostResponse({ sale: deep(20, { delivery_actual_cost_usd: 1.37 }) }, PLAIN)), [])
})
check('mutant (records cap passes through): a snapshot nested past the cap leaks and this file notices', () => {
  const bad = mutate('if (depth > MAX_STRIP_DEPTH) return { value: null, touched: true }', 'if (depth > MAX_STRIP_DEPTH) return { value: input, touched: false }')
  assert.notDeepEqual(leaks(bad.redactSaleRecords([deepRecord()], PLAIN)), [])
})
check('mutant (camelCase twin kept): the camelCase cost keys of a write response are caught', () => {
  const bad = mutate('const fingerprint = (key: string): string => key.toLowerCase().replace(/[\\s_-]/g, \'\')', 'const fingerprint = (key: string): string => key')
  assert.notDeepEqual(leaks(bad.projectCourierCostResponse(saleSnapshot(), PLAIN)), [])
})

console.log(`GREEN courier cost access: ${passed} checks hold`)
