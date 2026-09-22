import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

// The 22 Sep 2026 till incident: after Complete the sale WAS recorded on the
// Worker (Telegram "Sale recorded", D1 rows, no duplicates) but the POS order
// stayed open behind the amber money_checkout_recovery_required banner, which
// then refused every further item -- "it works but seems not to close the
// order". Two independent halves produced it, and this file pins both.
//
//   1. Chrome's built-in translation was rewriting the Khmer till into English
//      (the owner's screenshot: "Turn", "Clean the basket", "End of sale").
//      Translate re-parents text nodes React still owns, so React's next
//      commit threw "Failed to execute 'removeChild' on 'Node'" -- Sentry
//      BUSINESS-OS-1A, vendor-react, page pos, role employee.
//   2. The committed close only called setState. orders/active/counter are
//      persisted by effects that run AFTER React commits, so a crashed commit
//      left storage holding the recorded order WITH its checkoutRequestId.
//      Reload restored it, Retry recovered the same receipt, crash again.
//
// Blocking translation is only worth as much as the bootstrap's own admin
// route table, which had itself drifted from src/app/pathRouting.ts, so the
// first section also pins those two tables against each other.
//
// Every assertion executes the REAL production code (the inline bootstrap from
// index.html, and the closeOrder slice from POS.tsx) rather than grepping for
// a string, and each one carries a negative control: the same code with the
// fix deleted must make the assertion fail. A check that cannot fail is not a
// check.

const failures: string[] = []
function expectControlFails(label: string, run: () => void): void {
  try {
    run()
  } catch {
    return
  }
  failures.push(label)
}

// --- A. the admin shell opts out of machine translation -------------------

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const bootstrapMatch = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)
assert.ok(bootstrapMatch, 'the route-aware metadata bootstrap should stay inline in <head>')
const bootstrapSource = bootstrapMatch[1]

interface BootstrapRun {
  route: string | null
  translate: string | null
  metas: Array<{ name: string | null; content: string | null }>
}

function runBootstrap(source: string, hostname: string, pathname: string): BootstrapRun {
  const rootAttributes = new Map<string, string>()
  const appended: Array<{ name: string | null; content: string | null }> = []
  const makeElement = (initial: Record<string, string> = {}) => ({
    attrs: new Map<string, string>(Object.entries(initial)),
    getAttribute(name: string) { return this.attrs.get(name) ?? null },
    setAttribute(name: string, value: string) { this.attrs.set(name, value) },
  })
  const selectors: Record<string, ReturnType<typeof makeElement>> = {
    'meta[name="description"]': makeElement(),
    'meta[name="apple-mobile-web-app-title"]': makeElement(),
    'link[rel="manifest"]': makeElement(),
    'link[rel="apple-touch-icon"]': makeElement(),
  }
  const icons = [makeElement(), makeElement({ sizes: '192x192' }), makeElement({ sizes: '512x512' })]
  const document = {
    title: 'Business OS',
    documentElement: { setAttribute(name: string, value: string) { rootAttributes.set(name, value) } },
    head: {
      appendChild(node: ReturnType<typeof makeElement>) {
        appended.push({ name: node.getAttribute('name'), content: node.getAttribute('content') })
        return node
      },
    },
    createElement(tagName: string) {
      assert.equal(tagName, 'meta', 'the bootstrap should only ever create a meta element')
      return makeElement()
    },
    querySelector(selector: string) { return selectors[selector] || null },
    querySelectorAll(selector: string) { return selector === 'link[rel="icon"]' ? icons : [] },
  }
  vm.runInNewContext(source, { window: { location: { hostname, pathname } }, document })
  return {
    route: rootAttributes.get('data-business-os-initial-route') ?? null,
    translate: rootAttributes.get('translate') ?? null,
    metas: appended,
  }
}

// The bootstrap keeps its own copy of the admin route table (it runs before
// any module loads), and that copy had already drifted from the router's:
// /notes, /promotions, /promos, /review, /review-queue, /fees and
// /delivery-contacts were missing, so an admin reload from any of those pages
// -- AppContext pushes exactly these paths through getAdminPathForPage -- took
// the PUBLIC branch and got no opt-out at all. Drive the check from
// pathRouting.ts's own maps so the next page added there fails here instead of
// in production.
const routingSource = fs.readFileSync(new URL('../src/app/pathRouting.ts', import.meta.url), 'utf8')
function routerBlock(declaration: string): string {
  const start = routingSource.indexOf(declaration)
  assert.ok(start > 0, `${declaration} should still exist in pathRouting.ts`)
  return routingSource.slice(start, routingSource.indexOf('])', start))
}
// Match whole ['segment', 'page'] ENTRIES, never loose quoted tokens: page ids
// carry underscores ('receipt_settings'), so a token-at-a-time scan skips them
// and every later pair falls out of step -- which quietly dropped 'receipts'
// from an earlier draft of this check.
const pageSegments = [...routerBlock('const ADMIN_ROUTE_PAGE_BY_SEGMENT = new Map<string, string>([')
  .matchAll(/\[\s*'([a-z0-9-]+)'\s*,\s*'([a-z0-9_]+)'\s*\]/g)].map((match) => match[1])
const authSegments = [...routerBlock("const ADMIN_AUTH_ROUTE_SEGMENTS = new Set<string>([")
  .matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1])
const adminSegments = [...new Set([...pageSegments, ...authSegments])]
// Positive controls on the instrument itself: a regex that silently matched
// nothing (or half the table) would make every assertion below vacuously true.
assert.equal(pageSegments.length, (routerBlock('const ADMIN_ROUTE_PAGE_BY_SEGMENT = new Map<string, string>([').match(/\n\s*\['/g) || []).length, 'every route entry in the map must be extracted')
assert.ok(adminSegments.length >= 33, `expected the router's full admin segment set, got ${adminSegments.length}`)
for (const expected of ['pos', 'notes', 'promotions', 'promos', 'review', 'review-queue', 'fees', 'delivery-contacts', 'receipts', 'login']) {
  assert.ok(adminSegments.includes(expected), `the extracted router segments should include ${expected}`)
}

function assertAdminBlocksTranslation(source: string): void {
  const adminPaths = ['/', ...adminSegments.map((segment) => `/${segment}`)]
  for (const hostname of ['admin.leangbeauty.com', 'localhost']) {
    for (const pathname of adminPaths) {
      const run = runBootstrap(source, hostname, pathname)
      assert.equal(run.route, 'admin', `${hostname}${pathname} should be the admin shell`)
      assert.equal(run.translate, 'no', `${hostname}${pathname} must set translate="no" on <html>`)
      assert.deepEqual(
        run.metas.filter((meta) => meta.name === 'google'),
        [{ name: 'google', content: 'notranslate' }],
        `${hostname}${pathname} must add exactly one notranslate meta`,
      )
    }
  }
}

assertAdminBlocksTranslation(bootstrapSource)

// The storefront stays translatable: customers read it in their own language
// and it drives its own Google Translate widget (portalTranslateController).
for (const [hostname, pathname] of [
  ['leangbeauty.com', '/'],
  ['leangbeauty.com', '/privacy'],
  ['leangbeauty.com', '/terms'],
  ['leangbeauty.com', '/leang-beauty-phnom-penh'],
  ['leangbeauty.com', '/some-shop'],
] as const) {
  const run = runBootstrap(bootstrapSource, hostname, pathname)
  assert.equal(run.route, 'public', `${hostname}${pathname} should be the storefront`)
  assert.equal(run.translate, null, 'the storefront must never be marked translate="no"')
  assert.deepEqual(run.metas, [], 'the storefront must never receive the notranslate meta')
}

// Negative control: drop one admin segment from the bootstrap's table and the
// parity assertion must fail -- this is the exact drift that shipped.
const bootstrapMissingSegment = bootstrapSource.replace("          '/notes': true,\n", '')
assert.notEqual(bootstrapMissingSegment, bootstrapSource, 'the negative control must actually remove a segment')
assert.equal(runBootstrap(bootstrapMissingSegment, 'admin.leangbeauty.com', '/pos').route, 'admin', 'the control bootstrap must still execute')
expectControlFails(
  'negative control: a bootstrap table missing an admin route still passed the parity assertion',
  () => assertAdminBlocksTranslation(bootstrapMissingSegment),
)

// Negative control: strip the opt-out and the admin assertion must fail.
const bootstrapWithoutOptOut = bootstrapSource
  .replace(/\n\s*var adminNoTranslate = document\.createElement\('meta'\)[\s\S]*?document\.head\.appendChild\(adminNoTranslate\)/, '')
  .replace(/\n\s*document\.documentElement\.setAttribute\('translate', 'no'\)/, '')
assert.notEqual(bootstrapWithoutOptOut, bootstrapSource, 'the negative control must actually remove the opt-out')
// The control must still be a RUNNING bootstrap, otherwise it would "fail"
// for the wrong reason (a syntax error rather than a missing opt-out).
assert.equal(runBootstrap(bootstrapWithoutOptOut, 'admin.leangbeauty.com', '/pos').route, 'admin', 'the control bootstrap must still execute')
expectControlFails(
  'negative control: a bootstrap without the notranslate opt-out still passed the admin assertion',
  () => assertAdminBlocksTranslation(bootstrapWithoutOptOut),
)

// --- B. a committed close is durable BEFORE React renders it --------------

const posSource = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const closeStart = posSource.indexOf('  const closeOrder = (orderId: string, committed = false) => {')
assert.ok(closeStart > 0, 'closeOrder should still be a named arrow in POS.tsx')
const closeEnd = posSource.indexOf('\n  }\n', closeStart) + 4
const closeSource = posSource.slice(closeStart, closeEnd)

interface CloseProbe {
  steps: string[]
  stored: Map<string, string>
  ordersRef: { current: Array<Record<string, unknown>> }
  notices: string[]
}

function runClose(source: string, options: {
  orders: Array<Record<string, unknown>>
  orderId: string
  committed?: boolean
  activeId?: string
}): CloseProbe {
  const steps: string[] = []
  const stored = new Map<string, string>()
  const notices: string[] = []
  const ordersRef = { current: options.orders }
  const env = {
    ordersRef,
    resolvedActiveId: options.activeId ?? options.orderId,
    notify: (message: string) => notices.push(message),
    t: (key: string) => key,
    // Mirrors the real normalizeOrder/createEmptyOrder result closely enough
    // for this slice: a fresh order carries the canonical empty request id.
    normalizeOrder: (order: Record<string, unknown>, index: number) => ({ ...order, id: 'reset-order', label: `Order ${index}`, cart: [], checkoutRequestId: '' }),
    posOrdersStorageKey: 'pos-orders',
    posActiveStorageKey: 'pos-active',
    posCounterStorageKey: 'pos-counter',
    writePosDraft: (key: string, value: string) => { steps.push(`write:${key}`); stored.set(key, value) },
    setOrders: (value: unknown) => { steps.push('setOrders'); void value },
    setActiveId: (value: unknown) => { steps.push('setActiveId'); void value },
    setOrderCounter: (value: unknown) => { steps.push('setOrderCounter'); void value },
  }
  const code = transformSync(source, { loader: 'tsx' }).code
  new Function('env', `with(env) { ${code}; closeOrder(${JSON.stringify(options.orderId)}, ${options.committed === true}) }`)(env)
  return { steps, stored, ordersRef, notices }
}

const recordedOrder = { id: 'order-1', label: 'Order 1', cart: [{ id: 7 }], checkoutRequestId: 'request-1', checkoutPayload: { client_request_id: 'request-1' } }
const secondOrder = { id: 'order-2', label: 'Order 2', cart: [{ id: 9 }] }

function assertCommittedCloseIsDurable(source: string): void {
  // Sole order: the till resets to one empty order and all three keys are on
  // disk before a single setState runs.
  const single = runClose(source, { orders: [{ ...recordedOrder }], orderId: 'order-1', committed: true })
  const firstSetState = single.steps.findIndex((step) => step.startsWith('set'))
  const lastWrite = single.steps.reduce((last, step, index) => (step.startsWith('write:') ? index : last), -1)
  assert.ok(lastWrite >= 0 && firstSetState >= 0, 'a committed close must both persist and re-render')
  assert.ok(lastWrite < firstSetState, `a committed close must persist before it renders, got ${single.steps.join(' > ')}`)
  assert.deepEqual(
    single.steps.filter((step) => step.startsWith('write:')).sort(),
    ['write:pos-active', 'write:pos-counter', 'write:pos-orders'],
    'a committed close persists orders, the active tab and the counter',
  )
  const persisted = JSON.parse(single.stored.get('pos-orders') || '[]') as Array<Record<string, unknown>>
  assert.equal(persisted.length, 1)
  assert.ok(!persisted[0].checkoutRequestId, 'the recorded order must not survive in storage with its pending request id')
  assert.equal(persisted[0].checkoutPayload, undefined, 'the frozen checkout payload must not survive a committed close')
  assert.equal(single.stored.get('pos-active'), String(persisted[0].id), 'the persisted active tab must be the order the reload will show')
  assert.equal(single.stored.get('pos-counter'), '2')
  assert.ok(!single.ordersRef.current[0].checkoutRequestId, 'the ref must not hand the recorded order back to a synchronous caller')

  // Two orders: only the recorded one closes, labels renumber, the remaining
  // tab is the one the reload will open.
  const multi = runClose(source, { orders: [{ ...recordedOrder }, { ...secondOrder }], orderId: 'order-1', committed: true })
  const multiPersisted = JSON.parse(multi.stored.get('pos-orders') || '[]') as Array<Record<string, unknown>>
  assert.deepEqual(multiPersisted.map((order) => order.id), ['order-2'], 'a committed close drops only the recorded order')
  assert.equal(multiPersisted[0].label, 'Order 1', 'remaining tabs renumber from 1')
  assert.equal(multi.stored.get('pos-active'), 'order-2')
  assert.equal(multi.stored.get('pos-counter'), '2')
}

assertCommittedCloseIsDurable(closeSource)

// The uncommitted paths are unchanged: a pending checkout still refuses to
// close behind the recovery banner, and an ordinary tab close still leaves
// persistence to the effects (nothing is written synchronously).
const refused = runClose(closeSource, { orders: [{ ...recordedOrder }, { ...secondOrder }], orderId: 'order-1' })
assert.deepEqual(refused.notices, ['money_checkout_recovery_required'], 'closing a pending checkout by hand is still refused')
assert.deepEqual(refused.steps, [], 'a refused close neither persists nor re-renders')

const plainClose = runClose(closeSource, { orders: [{ ...secondOrder }, { id: 'order-3', label: 'Order 3', cart: [] }], orderId: 'order-3', activeId: 'order-2' })
assert.deepEqual(plainClose.steps.filter((step) => step.startsWith('write:')), [], 'an uncommitted close keeps the effect-only persistence path')
assert.deepEqual(plainClose.steps, ['setOrders', 'setOrderCounter', 'setActiveId'])

// Negative control: drop the synchronous durable write and the committed
// assertion must fail.
const closeWithoutDurableWrite = closeSource.replace(/\n    if \(committed\) \{[\s\S]*?\n    \}\n/, '\n')
assert.notEqual(closeWithoutDurableWrite, closeSource, 'the negative control must actually remove the durable write')
assert.deepEqual(
  runClose(closeWithoutDurableWrite, { orders: [{ ...recordedOrder }], orderId: 'order-1', committed: true }).steps,
  ['setOrders', 'setOrderCounter', 'setActiveId'],
  'the control must still be a running closeOrder that simply skips the durable write',
)
expectControlFails(
  'negative control: closeOrder without the synchronous durable write still passed the committed assertion',
  () => assertCommittedCloseIsDurable(closeWithoutDurableWrite),
)

// --- C. BOTH committed callers go through that one durable close ----------

// Two places learn that a sale is recorded: handleCheckout's finishRecorded
// (normal Complete and the pending-request recovery) and reviewCheckoutPrices
// (the price-review path, which recovers a receipt the same way). Neither may
// grow its own close: the durability proved above lives in closeOrder, so a
// caller that passes anything but `true` silently keeps the effect-only path.
function assertBothCommittedCallers(source: string): void {
  const committedCalls = [...source.matchAll(/closeOrder\(([^)]*?), true\)/g)].map((match) => match[1].trim())
  assert.deepEqual(committedCalls, ['resolvedActiveId', 'orderId'], 'exactly two callers close a recorded sale, and both pass committed=true')
  const finishStart = source.indexOf('    const finishRecorded = (result: unknown) => {')
  assert.ok(finishStart > 0, 'finishRecorded should still be the recorded-sale handler')
  const finishSlice = source.slice(finishStart, source.indexOf('\n    }\n', finishStart))
  assert.match(finishSlice, /setReceiptQueue[\s\S]*closeOrder\(resolvedActiveId, true\)/, 'finishRecorded queues the receipt and then closes the order durably')
  const reviewStart = source.indexOf('  const reviewCheckoutPrices = async')
  assert.ok(reviewStart > 0, 'reviewCheckoutPrices should still exist')
  const reviewSlice = source.slice(reviewStart, source.indexOf('\n  }\n', reviewStart))
  assert.match(reviewSlice, /proof\.committed === true[\s\S]*closeOrder\(orderId, true\)/, 'a receipt found during price review closes the order durably too')
}

assertBothCommittedCallers(posSource)
expectControlFails(
  'negative control: a price-review path that closes without committed=true still passed the caller assertion',
  () => assertBothCommittedCallers(posSource.replace('closeOrder(orderId, true)', 'closeOrder(orderId)')),
)

assert.deepEqual(failures, [], 'every negative control must fail the assertion it disables')

console.log('PASS every admin route blocks machine translation while the storefront stays translatable, and both committed POS closes are durable before render')
