// Execute production resolver/order normalization, with lifecycle/transport wiring checks.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.join(__dirname, '..')
const pos = fs.readFileSync(path.join(root, 'src/components/pos/POS.tsx'), 'utf8')
function evaluate(source, scope = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('exports', ...Object.keys(scope), output)(exports, ...Object.values(scope))
  return exports
}
const constants = evaluate(fs.readFileSync(path.join(root, 'src/constants.ts'), 'utf8'))
const ast = ts.createSourceFile('POS.tsx', pos, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions = ['normalizeOrder', 'resolveOrderLoyaltyAccrual']
const source = ast.statements.filter(node => ts.isFunctionDeclaration(node) && functions.includes(node.name?.text)).map(node => node.getText(ast).replace(/^export /, '')).map(code => `export ${code}`).join('\n')
const { normalizeOrder, resolveOrderLoyaltyAccrual: resolve } = evaluate(source, constants)
for (const setting of ['false', 'true']) {
  const expected = setting === 'true'
  let draft = normalizeOrder({}, 1)
  assert.equal(resolve(draft.loyaltyAccrual, setting), expected)
  draft.loyaltyAccrual = !resolve(draft.loyaltyAccrual, setting)
  const restored = normalizeOrder(JSON.parse(JSON.stringify(draft)), 1)
  assert.equal(resolve(restored.loyaltyAccrual, setting), !expected)
  assert.equal(resolve(restored.loyaltyAccrual, expected ? 'false' : 'true'), !expected)
  const queuedPayload = JSON.parse(JSON.stringify({ loyalty_accrual: resolve(restored.loyaltyAccrual, setting) }))
  draft = normalizeOrder({}, 1)
  assert.equal(resolve(draft.loyaltyAccrual, setting), expected, 'next sale resets override')
  assert.equal(queuedPayload.loyalty_accrual, !expected, 'serialized request retains resolved choice')
  assert.equal(resolve(normalizeOrder(constants.createEmptyOrder(2), 2).loyaltyAccrual, setting), expected)
}
const delayed = normalizeOrder({})
assert.equal(resolve(delayed.loyaltyAccrual, undefined), true)
assert.equal(resolve(delayed.loyaltyAccrual, 'false'), false)
assert.equal(resolve(delayed.loyaltyAccrual, 'true'), true)
for (const value of ['OFF', ' no ', '0', false]) assert.equal(resolve(undefined, value), false)
assert.match(pos, /resolveOrderLoyaltyAccrual\(active.loyaltyAccrual, settings.loyalty_points_enabled\)/)
assert.match(pos, /loyalty_accrual: loyaltyAccrual/)
assert.match(pos, /patchActive\(\{ loyaltyAccrual: !loyaltyAccrual \}\)/)
assert.match(pos, /const reset = normalizeOrder\(\{\}, 1\)/)
assert.doesNotMatch(pos, /lookupPortalMembership|membershipInfoRef/)
const transport = fs.readFileSync(path.join(root, 'src/api/contactReadTransport.ts'), 'utf8')
assert.match(transport, /apiFetch\('GET', `\/api\/customers\/membership\//)
const handlers = []
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['addNewOrder', 'closeOrder'].includes(node.name.getText(ast))) handlers.push(`const ${node.getText(ast)};`)
  ts.forEachChild(node, visit)
}
visit(ast)
const handlerCode = ts.transpileModule(handlers.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function lifecycle(seed) {
  // A COMMITTED close now persists the draft synchronously before it renders
  // (the Sep 22 2026 till incident: a crashed React commit left the recorded
  // order in storage still carrying its checkoutRequestId). The draft writer
  // and its three keys are part of closeOrder's environment here for that
  // reason; tests/posCommittedCloseDurability.test.ts owns the ordering
  // assertions, this harness only needs the bindings and the stored result.
  return new Function('normalizeOrder', 'createEmptyOrder', 'LAYOUT', 'seed', `
    let orders = seed, resolvedActiveId = seed[0].id;
    const ordersRef = { current: orders };
    const setOrders = value => { orders = typeof value === 'function' ? value(orders) : value; ordersRef.current = orders };
    const setActiveId = id => { resolvedActiveId = id };
    const setOrderCounter = () => {};
    const notify = () => {};
    const t = key => key;
    const drafts = {};
    const posOrdersStorageKey = 'pos-orders', posActiveStorageKey = 'pos-active', posCounterStorageKey = 'pos-counter';
    const writePosDraft = (key, value) => { drafts[key] = value };
    ${handlerCode}
    return { addNewOrder, closeOrder, state: () => orders, drafts: () => drafts };
  `)(normalizeOrder, constants.createEmptyOrder, constants.LAYOUT, seed)
}
for (const setting of ['true', 'false']) {
  const manual = normalizeOrder({ loyaltyAccrual: setting !== 'true' })
  const single = lifecycle([manual])
  single.closeOrder(manual.id)
  assert.equal(resolve(single.state()[0].loyaltyAccrual, setting), setting === 'true')
  const tabs = lifecycle([manual])
  tabs.addNewOrder()
  assert.equal(resolve(tabs.state()[1].loyaltyAccrual, setting), setting === 'true')
  assert.equal(tabs.state()[0].loyaltyAccrual, manual.loyaltyAccrual)
  tabs.closeOrder(tabs.state()[1].id)
  assert.equal(tabs.state()[0].loyaltyAccrual, manual.loyaltyAccrual)
}
const uncertainOrder = normalizeOrder({ checkoutRequestId: 'frozen-request', loyaltyAccrual: false })
const uncertainTabs = lifecycle([uncertainOrder])
uncertainTabs.closeOrder(uncertainOrder.id)
assert.equal(uncertainTabs.state()[0].checkoutRequestId, 'frozen-request', 'ordinary close cannot erase unresolved checkout or loyalty intent')
assert.deepEqual(uncertainTabs.drafts(), {}, 'a refused close writes no draft')
uncertainTabs.closeOrder(uncertainOrder.id, true)
assert.equal(uncertainTabs.state()[0].checkoutRequestId, '', 'known committed close starts a fresh order with the canonical empty request ID')
assert.equal(JSON.parse(uncertainTabs.drafts()['pos-orders'])[0].checkoutRequestId, '', 'the committed close is on disk before React renders it, so a crashed commit cannot restore the recorded order')
async function offline() {
  const saleSource = fs.readFileSync(path.join(root, 'src/api/saleWriteTransport.ts'), 'utf8')
  const ownership = await import('../src/api/offlineQueueOwnership.ts')
  const owner = { version: 1, actor_id: 71, organization_id: null, authority: 'https://shop.example', runtime: 'cloudflare-workers' }
  const foreign = { ...owner, actor_id: 72 }
  const storage = { getItem: () => JSON.stringify({ id: owner.actor_id, organization_id: null }) }
  const priorWindow = globalThis.window
  const priorEvent = globalThis.CustomEvent
  globalThis.window = { location: { origin: owner.authority }, sessionStorage: storage, localStorage: storage, dispatchEvent() {} }
  globalThis.CustomEvent = class {}
  const rows = new Map()
  const sent = []
  let failNetwork = false
  const table = {
    where: () => ({ equals: () => ({ toArray: async () => structuredClone([...rows.values()]) }) }),
    get: async id => structuredClone(rows.get(id)),
    put: async row => rows.set(row._seq, structuredClone(row)),
    delete: async id => rows.delete(id),
  }
  const dependencies = {
    '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
    './offlineQueueOwnership.ts': ownership,
    './actorReadScope.ts': { captureActorReadScope: () => 1, isActorReadScopeCurrent: () => true },
    './lazyLocalDb.ts': { getLocalDb: async () => ({ table: () => table, transaction: async (...args) => args.at(-1)() }) },
    './syncRuntime.ts': { emitSyncQueueChanged() {}, dispatchSyncUpdates() {}, OFFLINE_SALE_SYNC_UPDATE_CHANNELS: [] },
    './http.ts': {
      route: (_channel, run) => run(), isNetErr: () => false, isTransientGatewayError: status => status === 503,
      isWriteBlockedError: () => false, isWriteConflictError: () => false,
      apiFetch: async (method, _path, payload) => {
        if (method === 'GET') return { owner }
        if (failNetwork) throw Object.assign(new Error('unavailable'), { status: 503 })
        sent.push(structuredClone(payload))
        return { id: 1, client_request_id: payload.client_request_id, offline_owner: payload.offline_owner }
      },
    },
  }
  const { createSale, syncPendingSalesQueue } = evaluate(saleSource, { require: id => { assert.ok(id in dependencies, id); return dependencies[id] } })
  try {
  for (const value of [true, false]) {
    const payload = { client_request_id: `test-${value}`, loyalty_accrual: value }
    await createSale(payload)
    assert.equal(sent.at(-1).loyalty_accrual, value, 'online transport preserves explicit loyalty choice')
    assert.equal(rows.size, 0, 'online creation never queues a sale')
    failNetwork = true
    await assert.rejects(createSale(payload), error => error.code === 'sale_confirmation_required')
    failNetwork = false
    assert.equal(payload.loyalty_accrual, value, 'uncertain response retains original draft intent')
    assert.equal(rows.size, 0, 'failed network does not admit new offline work')
    const queued = { _seq: 1, id: payload.client_request_id, channel: 'sales:create', status: 'pending', created_at: '2026-01-01', payload: { ...payload, offline_owner: owner } }
    rows.set(1, structuredClone(queued)) // Historical fixture, not newly queued work.
    const before = sent.length
    await syncPendingSalesQueue({ force: true })
    await syncPendingSalesQueue({ force: true, manualRecovery: true, expectedOwner: foreign, reviewedRows: [queued] })
    assert.equal(sent.length, before, 'automatic or foreign-owner recovery must not send loyalty intent')
    assert.equal(rows.size, 1)
    const result = await syncPendingSalesQueue({ force: true, manualRecovery: true, expectedOwner: owner, reviewedRows: [queued] })
    assert.equal(result.synced, 1)
    assert.equal(sent.at(-1).loyalty_accrual, value, 'explicit original-owner recovery preserves historical boolean')
    assert.equal(rows.size, 0)
    await assert.rejects(createSale({ ...payload, offline_owner: foreign }), /Keep this pending sale/)
    assert.equal(sent.length, before + 1, 'foreign-owned request denied before dispatch')
  }
  } finally {
    if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow
    if (priorEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = priorEvent
  }
  console.log('PASS order lifecycle/defaults, online loyalty intent, no offline admission, owner-gated legacy recovery and POS wiring')
}
module.exports = offline().catch(error => { console.error(error); process.exitCode = 1 })
