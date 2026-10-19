import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import type { InventoryCheckSession, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'

const harness = await createHarness({ observe: ['api/actorReadScope.ts'] })
const product = { id: 12, name: 'Test variant', quantity: 8, cost_price_usd: 913.27, selling_price_usd: 17, brand: 'Test brand', qty_sold: 4 }
let selected: InventoryCheckSession = { id: 'check-1', branch_id: 1, created_by: 7, title: 'Test check', status: 'open', revision: 1, scope: {}, started_at: '2026-10-19', updated_at: '2026-10-19', progress: { total: 1, done: 0, issue: 0, unstarted: 1 } }
let observation: InventoryCheckSessionItem = { product_id: 12, state: 'unstarted', revision: 0, counted_quantity: null, reason: null, baseline_quantity: 9, current_quantity: 8, stock_changed: true, product_snapshot: product }
const productRequests: Array<Record<string, unknown>> = []
const saves: unknown[][] = []
const creates: unknown[][] = []
let saveFailure: 'none' | 'known' | 'unknown' = 'none'
let failRead = false
let readRevision = '1'
let delayedProducts: ((value: unknown) => void) | null = null
const response = () => ({ items: [product], total: 1, page: 1, pageSize: 20, branches: [{ id: 1, name: 'Test branch' }], stats: { total_products: 1, stock_quantity: 8, qty_sold: 4, unique_customer_count: 2 }, issues: [{ product_id: 12, branch_id: 1, session_id: 'check-1', session_title: 'Test check', created_by: 7, reason: 'All-session issue reason', revision: 1, state: 'issue', counted_quantity: 37 }] })
const app = {
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, inventory_check_show_cost: false } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key,
  settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
}
const doubles = {
  'api/actorReadScope.ts': {
    captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: readRevision }),
    captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }),
    isActorReadScopeCurrent: () => true,
    isActorWriteIdentityCurrent: () => true,
  },
  'api/inventoryChecksTransport.ts': {
    captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
    readInventoryCheckProducts: async (params: Record<string, unknown>) => {
      productRequests.push(params)
      if (failRead) throw new Error('test read failure')
      if (delayedProducts) return new Promise(resolve => { delayedProducts = resolve })
      return response()
    },
    readInventoryCheckSessions: async () => ({ items: [selected], total: 1, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => ({ item: selected, items: [observation] }),
    readInventoryCheckHistory: async () => ({ items: [{ id: 1, product_id: 12, action: 'observe', created_at: '2026-10-19', before: null, after: { state: 'issue', reason: 'History reason' } }], total: 1, page: 1, pageSize: 20 }),
    createInventoryCheckSession: async (...args: unknown[]) => { creates.push(args); return { item: selected, receipt: {} } },
    saveInventoryCheckObservation: async (...args: unknown[]) => {
      saves.push(args)
      if (saveFailure !== 'none') throw Object.assign(new Error('test save failure'), { outcome: saveFailure === 'unknown' ? 'unknown' : 'not_dispatched' })
      const patch = args[2] as Partial<InventoryCheckSessionItem>
      observation = { ...observation, ...patch, revision: observation.revision + 1 }
      return { item: observation, session: selected, receipt: {} }
    },
    changeInventoryCheckSession: async () => { selected = { ...selected, status: selected.status === 'open' ? 'closed' : 'open', revision: selected.revision + 1 }; return { item: selected, receipt: {} } },
  },
}
const mount = () => harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
try {
  const surface = await mount()
  assert.ok(surface.text().includes('Test variant'))
  assert.ok(!surface.text().includes('913.27'), 'denied cost never renders')
  assert.equal(productRequests.at(-1)?.startDate, undefined)
  await surface.click(surface.button('Today'))
  assert.match(String(productRequests.at(-1)?.startDate), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(productRequests.at(-1)?.startDate, productRequests.at(-1)?.endDate, 'the full-day received/sales/customer cohort reaches the actual transport')
  assert.equal(productRequests.at(-1)?.startTime, undefined)
  assert.ok(surface.text().includes('Received dates select products'), 'date cohort and current stock semantics are explicit')
  await surface.click(surface.button('sessions'))
  await surface.click(surface.button('Test check'))
  assert.ok(surface.text().includes('Test check'))
  await surface.click(surface.button('Report issue'))
  await surface.type(surface.field('inventory-check-count-12'), '0')
  await surface.type(surface.field('inventory-check-reason-12'), 'Shelf differs')
  saveFailure = 'unknown'
  await surface.click(surface.button('Save issue'))
  assert.ok(surface.text().includes('Save not confirmed'))
  assert.ok(!surface.text().includes('Counted: 0'), 'unknown acknowledgement never becomes optimistic saved state')
  const first = saves.at(-1)!
  saveFailure = 'none'
  await surface.click(surface.button('Retry'))
  const second = saves.at(-1)!
  assert.deepEqual(second.slice(1), first.slice(1), 'unknown retry retains product, patch, both revisions and request ID')
  assert.ok(surface.text().includes('Counted: 0'), 'confirmed zero survives resumed server observations')
  assert.ok(surface.text().includes('Shelf differs'))
  readRevision = '2'
  await surface.render({})
  assert.ok(surface.text().includes('Test check') && surface.text().includes('Shelf differs'), 'ordinary own-write channel invalidation preserves the selected session')
  await surface.click(surface.button('Test variant'))
  assert.ok(surface.text().includes('Starting stock') && surface.text().includes('Stock changed since'), 'read-only details show fixed baseline and drift')
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'detail close'))
  await surface.click(surface.button('Close session'))
  assert.equal(surface.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'closed session cannot edit')
  await surface.click(surface.button('Resume session'))
  assert.equal(surface.findAll(node => node.getAttribute('data-check-action') === 'done').length, 1)
  await surface.click(surface.button('sessions'))
  await surface.click(surface.button('Test check'))
  assert.equal(surface.findAll(node => node.getAttribute('data-check-action') === 'done').length, 1, 'reselecting the current session returns to its editable product list')
  await surface.click(surface.button('history'))
  assert.ok(surface.text().includes('History reason'), 'session immutable action history is read through the dedicated endpoint')
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'history close'))
  await surface.unmount()

  app.user = { ...app.user, id: 8 }
  const other = await mount()
  await other.click(other.button('sessions'))
  await other.click(other.button('Test check'))
  assert.ok(other.text().includes('Shelf differs'), 'permitted staff can view another account session')
  assert.equal(other.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'another employee cannot edit the creator session')
  await other.unmount()

  app.user = { ...app.user, id: 7 }
  const creation = await mount()
  await creation.click(creation.button('sessions'))
  await creation.click(creation.button('Test check'))
  await creation.click(creation.button('All products'))
  await creation.click(creation.button('Start check'))
  const input = creates.at(-1)?.[1] as { productIds: number[]; scope: Record<string, unknown> }
  assert.deepEqual(input.productIds, [12])
  assert.equal(input.scope.membership, 'visible_page', 'creation records its actual bounded membership')
  await creation.unmount()

  failRead = true
  const failed = await mount()
  assert.ok(failed.text().includes('unavailable'))
  assert.ok(!failed.text().includes('Test variant'), 'failed read never substitutes cached catalog rows')
  await failed.unmount()
  failRead = false

  const switching = await mount()
  await switching.click(switching.button('sessions'))
  await switching.click(switching.button('Test check'))
  await switching.click(switching.button('Edit issue'))
  await switching.type(switching.field('inventory-check-reason-12'), 'Private A draft')
  app.user = { ...app.user, id: 8 }
  await switching.render({})
  assert.equal(switching.findAll(node => node.getAttribute('id') === 'inventory-check-reason-12').length, 0)
  app.user = { ...app.user, id: 7 }
  await switching.render({})
  assert.ok(!switching.text().includes('Private A draft'), 'A→B→A remount never restores private in-memory drafts')
  assert.equal(switching.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'account transition returns to unselected Products')
  await switching.unmount()

  const raced = await mount()
  delayedProducts = () => {}
  await raced.type(raced.field('inventory-check-search'), 'older query')
  const oldResponse = delayedProducts as (value: unknown) => void
  delayedProducts = null
  await raced.type(raced.field('inventory-check-search'), 'newer query')
  assert.equal(productRequests.at(-1)?.query, 'newer query')
  oldResponse({ ...response(), items: [{ ...product, name: 'STALE PRIVATE RESULT' }] })
  await raced.settle()
  assert.ok(!raced.text().includes('STALE PRIVATE RESULT'), 'late query completion cannot publish under a different query')
  await raced.click(raced.button('sessions'))
  await raced.click(raced.button('Test check'))
  await raced.click(raced.button('Edit issue'))
  await raced.type(raced.field('inventory-check-reason-12'), 'Known refusal draft')
  saveFailure = 'known'
  await raced.click(raced.button('Save issue'))
  assert.ok(raced.text().includes('Check not saved'))
  assert.equal((raced.field('inventory-check-reason-12') as unknown as { value: string }).value, 'Known refusal draft')
  saveFailure = 'none'
  const previous = saves.at(-1)!
  await raced.click(raced.button('Retry'))
  assert.deepEqual(saves.at(-1)?.slice(1), previous.slice(1), 'known-refusal retry also keeps frozen expected revisions')
  app.user = { ...app.user, permissions: { ...app.user.permissions, inventory_check_show_cost: false, inventory_check_show_stock: false, inventory_check_show_sales: false } }
  await raced.render({})
  assert.ok(!raced.text().includes('Stock: 8') && !raced.text().includes('Sold: 4'), 'same-account field revocation synchronously detaches protected row values')
  assert.ok(!raced.text().includes('Counted: 0'), 'stock denial also removes the saved count')
  assert.equal(raced.findAll(node => node.getAttribute('id') === 'inventory-check-reason-12').length, 0)
  await raced.unmount()

  const blindOwner = await mount()
  await blindOwner.click(blindOwner.button('sessions'))
  await blindOwner.click(blindOwner.button('Test check'))
  assert.ok(blindOwner.text().includes('Counted: 0'), 'a creator keeps their own entered count while system stock stays hidden')
  assert.ok(!blindOwner.text().includes('Stock: 8'))
  await blindOwner.click(blindOwner.button('Edit issue'))
  await blindOwner.type(blindOwner.field('inventory-check-count-12'), '37')
  await blindOwner.click(blindOwner.button('Save issue'))
  assert.equal((saves.at(-1)?.[2] as { counted_quantity: number }).counted_quantity, 37)
  assert.ok(blindOwner.text().includes('Counted: 37'))
  await blindOwner.unmount()
  app.user = { ...app.user, id: 8 }
  const blindOther = await mount()
  await blindOther.click(blindOther.button('issues'))
  assert.equal(productRequests.at(-1)?.state, 'issue', 'all-session issue filtering belongs to the server population before pagination')
  assert.ok(blindOther.text().includes('All-session issue reason'))
  assert.ok(!blindOther.text().includes('37'), 'all-session issue summaries respect other creator hidden counts')
  assert.equal(blindOther.findAll(node => node.getAttribute('data-check-action') === 'issue').length, 0, 'all-session issue list has no writes before selecting a real session')
  await blindOther.click(blindOther.button('Test check'))
  assert.equal(productRequests.at(-1)?.sessionId, 'check-1')
  assert.equal(productRequests.at(-1)?.branchId, '1', 'issue link resumes its actual branch/session identity')
  assert.ok(!blindOther.text().includes('Counted: 37'), 'stock-blind staff cannot see another creator entered count')
  assert.equal(blindOther.findAll(node => node.getAttribute('data-check-action') === 'issue').length, 0)
  await blindOther.unmount()
  app.user = { ...app.user, role_code: 'admin' }
  const admin = await mount()
  await admin.click(admin.button('sessions'))
  await admin.click(admin.button('Test check'))
  assert.equal(admin.findAll(node => node.getAttribute('data-check-action') === 'done').length, 1, 'administrator authority can edit another creator session')
  await admin.unmount()
  console.log('inventoryChecksPage mounted journeys passed')
} finally { await harness.close() }
