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
  assert.equal(queuedPayload.loyalty_accrual, !expected, 'offline payload retains resolved choice')
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
  return new Function('normalizeOrder', 'createEmptyOrder', 'LAYOUT', 'seed', `
    let orders = seed, resolvedActiveId = seed[0].id;
    const setOrders = value => { orders = typeof value === 'function' ? value(orders) : value };
    const setActiveId = id => { resolvedActiveId = id };
    const setOrderCounter = () => {};
    const notify = () => {};
    ${handlerCode}
    return { addNewOrder, closeOrder, state: () => orders };
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
async function offline() {
  const saleSource = fs.readFileSync(path.join(root, 'src/api/saleWriteTransport.ts'), 'utf8')
  const saleAst = ts.createSourceFile('sale.ts', saleSource, ts.ScriptTarget.Latest, true)
  const names = ['queueOfflineSale', 'createSaleWithoutWriteDedupe']
  const picked = saleAst.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => `export ${node.getText(saleAst)}`).join('\n')
  let queued, replayed
  const tables = { sales: { put: async () => {} }, sync_queue: { put: async row => { queued = JSON.parse(JSON.stringify(row)) } } }
  const { queueOfflineSale, createSaleWithoutWriteDedupe } = evaluate(picked, {
    ensureSaleClientRequestId: payload => ({ ...payload, client_request_id: 'test-request' }), findQueuedSale: async () => null,
    buildOfflineSaleReceiptNumber: () => '20260905-120000', isBusinessReceiptNumber: () => false, asText: value => String(value || ''),
    OFFLINE_SALE_QUEUE_CHANNEL: 'sales', getLocalDb: async () => ({ transaction: async (_mode, _sales, _queue, action) => action() }),
    localTable: (_db, name) => tables[name], buildOfflineSaleMirror: payload => payload,
    requestPersistentAppStorage: async () => {}, registerOutboxBackgroundSync: () => {}, emitSyncQueueChanged: () => {},
    apiFetch: async (_method, _path, payload) => { replayed = payload; return {} },
  })
  for (const value of [true, false]) {
    await queueOfflineSale({ loyalty_accrual: value })
    await createSaleWithoutWriteDedupe(queued.payload)
    assert.equal(replayed.loyalty_accrual, value, 'real queue and replay preserve boolean')
  }
  console.log('PASS actual order creation/reset/tab handlers, defaults and draft restore, delayed settings, real offline queue/replay, POS transport wiring')
}
offline().catch(error => { console.error(error); process.exitCode = 1 })
