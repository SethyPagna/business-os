// B5 follow-up 1 (Free-plan read cost). The Expenses page no longer reloads on a 'sales' push (every POS sale pushes
// one; ~1.5K rows per sale on a month range). So every Worker writer that changes a courier row the Expenses list
// shows through a sale must broadcast 'fees' itself:
//   - sale create with a courier cost            (POST /)
//   - add delivery / courier-cost amendment      (auditAmendment, kinds delivery_added and delivery_actual_cost_changed)
//   - cancel or restore                          (PATCH /:id/status: the row appears or drops with the sale)
//   - driver change, single and group, and undo  (notifySaleBulkUpdate)
//   - bulk status change                         (notifyBulkStatus)
// DISCRIMINATING: deleting any one of those broadcasts, or either amendment kind, fails its own assertion. The
// control is that a customer-only or payment-only bulk update stays off the fees channel.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, 'src', rel), 'utf8').split(String.fromCharCode(13)).join('')
let failed = 0
function test(name, fn) { try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } }
const between = (source, from, to) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `missing ${from}`)
  const end = source.indexOf(to, start + from.length)
  assert.ok(end > start, `missing ${to} after ${from}`)
  return source.slice(start, end)
}
const FEES = "broadcast(c.env, 'fees'"
const sales = read('routes/sales.ts')

test('sale create broadcasts fees only when it carries a courier cost', () => {
  // W3 Slice A: the bump is awaited first, then the conditional broadcast follows it in waitUntil.
  const block = between(sales, "  await bumpVersions(c.env, ['stock', 'sales'])\n  // A sale that carries a courier cost", "// Owner, 6 Oct 2026: a low")
  assert.ok(block.includes(`if (deliveryActualCostUsd != null) c.executionCtx.waitUntil(${FEES}`), 'the create broadcast is conditional on a courier cost')
})

test('cancel and restore broadcast fees (the courier row appears or drops with the sale)', () => {
  const block = between(sales, "    // The cancel fee is an expense row", "recordStockCrossings")
  assert.ok(block.includes("(oldStatus === 'cancelled') !== (saleStatus === 'cancelled')"), 'crossing the cancelled boundary')
  assert.ok(block.includes(FEES))
})

test('the add-delivery and courier-cost amendments broadcast fees; line amendments do not', () => {
  const set = sales.match(/AMENDMENT_KINDS_THAT_MOVE_COURIER_ROWS = new Set\(\[([^\]]*)\]\)/)
  assert.ok(set, 'the kinds set exists')
  const kinds = set[1].split(',').map((k) => k.trim().replace(/'/g, '')).sort()
  assert.deepEqual(kinds, ['delivery_actual_cost_changed', 'delivery_added'])
  const fn = between(sales, 'async function auditAmendment(', '/**\n * What a sale still owes')
  assert.ok(fn.includes(`AMENDMENT_KINDS_THAT_MOVE_COURIER_ROWS.has(String(details.kind)) ? [${FEES}`))
  // Both routes hand their kind to auditAmendment, which is what the set is keyed on.
  const costBranch = between(sales, "if (kind === 'delivery_actual_cost_changed') {", "return c.json(await committedMutationResponse")
  assert.match(costBranch, /await auditAmendment\(c, user, saleId, sale, \{\s*kind,/)
  const addBranch = sales.slice(sales.indexOf("// ---- Add delivery to a sale that was recorded as a counter sale."), sales.indexOf("// ---- The actual courier cost"))
  assert.match(addBranch, /await auditAmendment\(c, user, saleId, sale, \{\s*kind,/)
  // CONTROL: the delivery-fee-only amendment changes nothing the Expenses list shows, so it stays off the channel.
  assert.ok(!kinds.includes('delivery_fee_changed'))
})

test('a sales import broadcasts fees (it inserts sales with courier costs)', () => {
  const engine = read('lib/importEngine.ts')
  assert.ok(engine.includes("if (job.type === 'sales') await broadcast(env, 'fees', { action: 'import', jobId })"), 'the sales-import finalize step tells the Expenses page')
  assert.ok(read('lib/salesImportCommit.ts').includes('delivery_actual_cost_usd'), 'control: the import really writes courier costs')
})

test('a driver rename or merge and a branch edit broadcast fees (their names are on the Expenses courier rows)', () => {
  const contacts = read('routes/contacts.ts')
  assert.ok(contacts.includes("if (config.table === 'delivery_contacts' && nameChanged && snapshotCarry) c.executionCtx.waitUntil(broadcast(c.env, 'fees'"), 'driver rename')
  assert.ok(contacts.includes("if (config.table === 'delivery_contacts') c.executionCtx.waitUntil(broadcast(c.env, 'fees'"), 'driver merge')
  assert.ok(read('routes/branches.ts').includes("broadcast(c.env, 'fees', { action: 'update' })"), 'branch edit')
})

// notifySaleBulkUpdate and notifyBulkStatus, run for real with the broadcast hub recorded.
function load(rel, sent) {
  const mod = { exports: {} }
  const out = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (name) => {
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {} }
    if (name.endsWith('/broadcastHub')) return { broadcast: async (_env, channel) => { sent.push(channel) } }
    return new Proxy({}, { get: () => () => ({}) })
  }
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports)
  return mod.exports
}

;(async () => {
  const sent = []
  const { notifySaleBulkUpdate } = load('lib/saleBulkUpdate.ts', sent)
  const channelsFor = async (kind) => { sent.length = 0; await notifySaleBulkUpdate({}, kind); return [...sent].sort() }
  try {
    assert.deepEqual(await channelsFor('delivery_contact'), ['deliveryContacts', 'fees', 'sales'], 'a driver change tells the Expenses page')
    assert.ok(!(await channelsFor('customer')).includes('fees'), 'control: a customer change leaves expenses alone')
    assert.ok(!(await channelsFor('payment_method')).includes('fees'), 'control: a payment-method change leaves expenses alone')
    console.log('PASS notifySaleBulkUpdate: a driver change broadcasts fees, customer and payment changes do not')
  } catch (error) { failed += 1; console.error('FAIL notifySaleBulkUpdate'); console.error(error) }
  test('bulk status broadcasts fees', () => {
    const status = read('lib/saleBulkStatus.ts')
    assert.match(status, /\(\['sales', 'products', 'inventory', 'returns', 'fees'\] as const\)\.map\(channel => broadcast/)
  })
  if (failed) process.exit(1)
})()
