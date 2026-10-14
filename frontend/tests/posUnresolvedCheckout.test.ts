import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// A till checkout sent with no confirmed answer survives a confirmed sign-out,
// bound to its account, organization and server, while the cart and every
// other order are cleared. The real AppContext reset runs over the real runtime
// reset, and the till's own order loading (POS.tsx's orders initializer and its
// storage helpers) reads the orders back.

const memory = () => {
  const rows = new Map<string, string>()
  return { rows, get length() { return rows.size }, key: (index: number) => [...rows.keys()][index] ?? null, getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, String(value)) }, removeItem: (key: string) => { rows.delete(key) }, clear: () => rows.clear() }
}
const local = memory(), session = memory()
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: local, sessionStorage: session, location: { origin: 'https://shop.test', hostname: 'shop.test' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, setTimeout, clearTimeout,
} })
const actor = await import('../src/api/actorReadScope.ts')
const { setSyncServerUrl } = await import('../src/api/httpState.ts')
const { appStorageResets } = await import('./appPermissionRefresh.ts')
const { restoreUnresolvedPosCheckouts } = await import('../src/utils/posUnresolvedCheckout.ts')
const resets = appStorageResets(actor)

// ---- the till's order loading, read from POS.tsx ----
const js = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const posSource = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const posTree = ts.createSourceFile('POS.tsx', posSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(test: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => { if (!found && test(node)) found = node; if (!found) ts.forEachChild(node, visit) }
  visit(posTree)
  assert.ok(found)
  return found
}
const ordersInitializer = (find((node) => ts.isCallExpression(node) && node.expression.getText(posTree) === 'useState' && node.typeArguments?.[0]?.getText(posTree) === 'PosOrder[]') as ts.CallExpression).arguments[0].getText(posTree)
const readPosDraft = find((node) => ts.isVariableDeclaration(node) && node.name.getText(posTree) === 'readPosDraft').getText(posTree)
const helpers = ['posStorage', 'readPosStorage'].map((name) => find((node) => ts.isFunctionDeclaration(node) && node.name?.getText(posTree) === name).getText(posTree)).join('\n')
type Order = { id: string; checkoutRequestId?: string; cart?: unknown[] }
function tillOrders(user: { id: number; organization_id: number | null }): Order[] {
  const posStorageScope = String(user?.id || 'anonymous')
  const body = `${js(helpers)}\n${js(`const ${readPosDraft}`)}\nreturn (${js(ordersInitializer).trim().replace(/;$/, '')})()`
  return new Function('user', 'posStorageScope', 'posOrdersStorageKey', 'normalizeOrder', 'restoreUnresolvedPosCheckouts', body)(
    user, posStorageScope, `businessos_pos_orders_${posStorageScope}`, (order: Order) => order, restoreUnresolvedPosCheckouts)
}

// ---- one device ----
const X = 'https://x.example.test', Y = 'https://y.example.test'
const A = { id: 7, organization_id: 3 }, B = { id: 8, organization_id: 3 }, otherOrgA = { id: 7, organization_id: 4 }
const signIn = (user: typeof A, server = X) => { setSyncServerUrl(server); local.setItem('businessos_user', JSON.stringify(user)) }
const owner = { version: 1, actor_id: 7, organization_id: 3, authority: X, runtime: 'cloudflare-workers' }
const cartOrder = { id: 'ord-cart', label: 'Order 1', checkoutRequestId: '', cart: [{ product_id: 1, quantity: 1 }] }
const sentOrder = { id: 'ord-sent', label: 'Order 2', checkoutRequestId: 'req-sale', checkoutPayload: { client_request_id: 'req-sale', offline_owner: owner }, cart: [{ product_id: 2, quantity: 1 }] }
const tillKeys = ['businessos_pos_orders_7', 'businessos_pos_active_7', 'businessos_pos_counter_7']
function seedTill() {
  for (const store of [local, session]) {
    store.setItem('businessos_pos_orders_7', JSON.stringify([cartOrder, sentOrder]))
    store.setItem('businessos_pos_active_7', 'ord-cart')
    store.setItem('businessos_pos_counter_7', '3')
  }
}
const pending = (orders: Order[]) => orders.filter((order) => order.checkoutRequestId === 'req-sale')
const kept = () => [...local.rows.keys()].filter((key) => key.startsWith('businessos_pos_checkout_unresolved_v1:'))

let failed = 0
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

await check('a confirmed sign-out clears the cart and keeps only the unresolved checkout, for the same account only', async () => {
  local.clear(); session.clear(); signIn(A); seedTill()
  await resets.signOut()
  assert.deepEqual(tillKeys.flatMap((key) => [local.getItem(key), session.getItem(key)]), Array(6).fill(null), 'the cart and every other order are cleared, as before')
  assert.equal(local.getItem('businessos_user'), null)
  signIn(B)
  assert.deepEqual(pending(tillOrders(B)), [], 'another account never sees it')
  signIn(A, Y)
  assert.deepEqual(pending(tillOrders(A)), [], 'nor the same account on another server')
  signIn(otherOrgA)
  assert.deepEqual(pending(tillOrders(otherOrgA)), [], 'nor the same id in another organization')
  signIn(A); restoreUnresolvedPosCheckouts(B, '8')
  assert.equal(local.getItem('businessos_pos_orders_8'), null, 'a till open for an account other than the stored one restores nothing')
  signIn(A)
  const orders = tillOrders(A)
  assert.deepEqual(orders.map((order) => order.id), ['ord-sent'], 'the same account signing back in finds the unresolved checkout, and only it')
  assert.deepEqual(pending(orders)[0], { ...sentOrder, label: 'Order 1' }, 'with its request id and frozen request, so the recovery banner checks the receipt')
  assert.equal(local.getItem('businessos_pos_active_7'), 'ord-sent', 'it opens on that order')
  assert.deepEqual(kept(), [], 'put back once')
  assert.deepEqual(pending(tillOrders(A)).length, 1, 'and not twice')
})

await check('a till that opened before the account resolved finds it when the account does', async () => {
  local.clear(); session.clear(); signIn(A); seedTill()
  await resets.signOut()
  signIn(A)
  const effect = (find((node) => ts.isCallExpression(node) && node.expression.getText(posTree) === 'useEffect'
    && node.arguments[0]?.getText(posTree).includes('loadedDraftScopeRef.current = posStorageScope')) as ts.CallExpression).arguments[0].getText(posTree)
  let shown: Order[] = []
  const posStorageScope = '7'
  new Function('user', 'posStorageScope', 'posOrdersStorageKey', 'posActiveStorageKey', 'posCounterStorageKey', 'loadedDraftScopeRef', 'normalizeOrder', 'restoreUnresolvedPosCheckouts', 'setOrders', 'setActiveId', 'setOrderCounter',
    `${js(helpers)}\n${js(`const ${readPosDraft}`)}\nreturn (${js(effect).trim().replace(/;$/, '')})()`)(
    A, posStorageScope, 'businessos_pos_orders_7', 'businessos_pos_active_7', 'businessos_pos_counter_7', { current: 'anonymous' }, (order: Order) => order, restoreUnresolvedPosCheckouts,
    (orders: Order[]) => { shown = orders }, () => {}, () => {})
  assert.deepEqual(pending(shown).map((order) => order.id), ['ord-sent'])
})

await check('another organization signing in on the device keeps it too; the admin resets clear it as before', async () => {
  local.clear(); session.clear(); signIn(A); seedTill()
  signIn(otherOrgA)
  await resets.datasetChange()
  assert.equal(local.getItem('businessos_pos_orders_7'), null, 'the till is cleared')
  signIn(A)
  assert.deepEqual(pending(tillOrders(A)).map((order) => order.id), ['ord-sent'], 'back in its own organization, A finds it')
  local.clear(); session.clear(); signIn(A); seedTill()
  await resets.signOut()
  const methods = readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const adminLiteral = /async function invalidateClientRuntimeState[\s\S]*?resetClientRuntimeState\((\{[\s\S]*?\})\)\.catch/.exec(methods)?.[1]
  assert.ok(adminLiteral)
  await resets.runtimeReset(new Function('mirrorTables', `return (${adminLiteral})`)(undefined))
  assert.deepEqual(kept(), [], 'an admin data reset clears it, as it clears the till')
})

await check('a same-user refresh and session expiry keep the till as it is', async () => {
  for (const reset of [resets.permissionRefresh, resets.sessionExpiry]) {
    local.clear(); session.clear(); signIn(A); seedTill()
    await reset()
    assert.equal(local.getItem('businessos_pos_orders_7'), JSON.stringify([cartOrder, sentOrder]))
    assert.deepEqual(kept(), [])
  }
})

await check('putting it back never loses or doubles it, and waits for a locked session', async () => {
  const keptFor = (organization: number) => `businessos_pos_checkout_unresolved_v1:${encodeURIComponent(JSON.stringify([X, organization, 7]))}`
  const tillOf = (store: typeof local) => JSON.parse(store.getItem('businessos_pos_orders_7') || '[]') as Order[]
  // A's sign-in is confirmed (Login reconciles the read session) before the till opens.
  const signedInAgain = () => { signIn(A); assert.equal(actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker()), true) }
  const signedOutWithSentOrder = async () => { local.clear(); session.clear(); signIn(A); seedTill(); await resets.signOut(); signedInAgain() }

  await signedOutWithSentOrder()
  restoreUnresolvedPosCheckouts(otherOrgA, '7')
  assert.equal(local.getItem('businessos_pos_orders_7'), null, 'a till open for another organization than the stored account restores nothing')

  const write = local.setItem
  local.setItem = (key: string, value: string) => { if (key === 'businessos_pos_orders_7') throw new Error('QuotaExceededError'); write(key, value) }
  try { restoreUnresolvedPosCheckouts(A, '7') } finally { local.setItem = write }
  assert.equal(kept().length, 1, 'when the till cannot keep the orders, the kept copy stays')
  restoreUnresolvedPosCheckouts(A, '7')
  assert.deepEqual(pending(tillOf(local)).map((order) => order.id), ['ord-sent'], 'and the next attempt puts it back')
  assert.deepEqual(kept(), [])

  await signedOutWithSentOrder()
  local.setItem('businessos_pos_orders_7', JSON.stringify([{ ...sentOrder, label: 'Order 1' }]))
  restoreUnresolvedPosCheckouts(A, '7')
  assert.deepEqual(tillOf(local).map((order) => order.id), ['ord-sent'], 'a checkout already in the till is not added again')
  assert.deepEqual(kept(), [])

  local.clear(); session.clear(); signIn(A)
  session.setItem('businessos_pos_orders_7', JSON.stringify([cartOrder, sentOrder]))
  await resets.signOut(); signedInAgain()
  assert.deepEqual(pending(tillOrders(A)).map((order) => order.id), ['ord-sent'], 'a till kept only in sessionStorage keeps it too')

  local.clear(); session.clear(); signedInAgain()
  const foreign = { ...sentOrder, id: 'ord-foreign', checkoutRequestId: 'req-foreign', checkoutPayload: { client_request_id: 'req-foreign', offline_owner: { ...owner, actor_id: 8 } } }
  local.setItem(keptFor(3), JSON.stringify([foreign]))
  restoreUnresolvedPosCheckouts(A, '7')
  assert.equal(local.getItem('businessos_pos_orders_7'), null, 'an order sent by another account is never put in this till, whatever key holds it')

  await signedOutWithSentOrder()
  local.setItem('businessos_read_session', 'another-tab-signed-in')
  assert.equal(actor.isActorSessionQuarantined(), true)
  restoreUnresolvedPosCheckouts(A, '7')
  assert.equal(local.getItem('businessos_pos_orders_7'), null, 'nothing is put back while the session is locked for a check')
  assert.equal(kept().length, 1, 'and the kept copy waits')
  assert.equal(actor.completeActorSessionReconciliation('another-tab-signed-in'), true)
  restoreUnresolvedPosCheckouts(A, '7')
  assert.deepEqual(pending(tillOf(local)).map((order) => order.id), ['ord-sent'], 'until the check confirms the account')
  local.removeItem('businessos_read_session'); actor.completeActorSessionReconciliation(null)
})

if (failed) process.exit(1)
