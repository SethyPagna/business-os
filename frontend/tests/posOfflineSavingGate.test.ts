// Owner rule (offline mode cancelled, 26 Sep 2026): with no connection the app shows a banner and BLOCKS saving; the cart
// and drafts stay on the screen. The till used to keep taking the sale, because nothing at the checkout read the
// connection. The REAL POS is mounted here with a seeded cart and the app context's `canWriteToServer` (the signal the
// banner already uses), and with the browser's own `navigator.onLine`:
//   - Complete Sale is disabled with the reason beside it, in the pack of the screen (EN and KM);
//   - the status picker, the quick-add customer save and the quick-add delivery save are blocked the same way;
//   - the handlers refuse on their own (a disabled button is not the only guard), notify the reason and send nothing;
//   - the cart stays editable;
//   - online, the same cart checks out and the quick-add saves are live.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const packs = { en: JSON.parse(read('../src/lang/en.json')), km: JSON.parse(read('../src/lang/km.json')) } as Record<'en' | 'km', Record<string, string>>

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
  }
}

const USER = { id: 7, organization_id: 1, name: 'Cashier', role_code: 'admin' }
const product = {
  id: 11, name: 'Synthetic serum', barcode: '111', unit: 'pcs', selling_price_usd: 5, selling_price_khr: 20500, applied_price_usd: 5, applied_price_khr: 20500,
  stock: 20, stock_quantity: 20, branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: 20 }], is_active: 1, status: 'active', category: 'Care',
}
const cartLine = { ...product, cart_line_id: '11:selling:1:0:D0:1:abcde', quantity: 1, price_mode: 'selling', branch_id: 1 }
const DRAFT_KEYS = ['businessos_pos_orders_7', 'businessos_pos_active_7', 'businessos_pos_counter_7', 'bos_pos_orders', 'bos_pos_active', 'bos_pos_counter']

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
const realFetch = globalThis.fetch
;(globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: unknown) => (
  String(input).includes('/api/sales/money-precision-capability')
    ? new Response(JSON.stringify({ money_precision_version: 1, schema_ready: true, historical_edit_ready: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    : (realFetch as (input: unknown, init?: unknown) => Promise<Response>)(input, init)
)
const browser = globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage; navigator: { onLine: boolean }; addEventListener: (type: string, listener: () => void) => void; removeEventListener: (type: string, listener: () => void) => void } }
const originalListeners = { add: browser.window.addEventListener, remove: browser.window.removeEventListener }

interface Till {
  page: MountedSurface
  app: Record<string, unknown>
  notes: Array<{ type: string; message: string }>
  sales: Array<Record<string, unknown>>
  customers: Array<Record<string, unknown>>
  deliveries: Array<Record<string, unknown>>
}

async function mountTill(language: 'en' | 'km', over: Record<string, unknown> = {}): Promise<Till> {
  for (const key of DRAFT_KEYS) { browser.window.localStorage.removeItem(key); browser.window.sessionStorage.removeItem(key) }
  browser.window.localStorage.setItem('businessos_pos_orders_7', JSON.stringify([{ id: 'order-1', name: 'Order 1', cart: [cartLine], money_precision_version: 1 }]))
  const pack = packs[language]
  const notes: Till['notes'] = []
  const sales: Till['sales'] = []
  const customers: Till['customers'] = []
  const deliveries: Till['deliveries'] = []
  const app = {
    t: (key: string) => pack[key] ?? key, notify: (message: unknown, type: unknown) => { notes.push({ type: String(type), message: String(message) }) },
    user: { ...USER, role_permissions: { all: true } }, authReady: true, page: 'pos', settings: {}, language, syncChannel: null,
    fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100,
    can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true, ...over,
  }
  const page = await harness.mount({
    component: 'components/pos/POS.tsx',
    app,
    doubles: {
      'api/productReadTransport.ts': {
        getProductBootstrap: async () => ({ items: [product], total: 1, page: 1, pageSize: 50, totalPages: 1, filters: {}, initials: [], promotion_rules: [], branches: [{ id: 1, name: 'LC Store', is_default: true, is_active: 1 }] }),
        searchProducts: async () => ({ items: [product], total: 1, page: 1, pageSize: 50, totalPages: 1 }),
        getProductFilters: async () => ({}),
      },
      'api/batchesTransport.ts': { getTrackedBatchProductIds: async () => ({ productIds: [] }), getProductBatches: async () => ({ batches: [] }) },
      'api/lookupTransport.ts': { getCategories: async () => [] },
      'api/contactReadTransport.ts': { getSalesCustomerPicker: async () => [], getDeliveryContacts: async () => [], invalidateCustomerReadCache: () => {}, lookupCustomerMembership: async () => null },
      'api/contactWriteTransport.ts': {
        createCustomer: async (payload: Record<string, unknown>) => { customers.push(payload); return { success: true, id: 90, ...payload } },
        createDeliveryContact: async (payload: Record<string, unknown>) => { deliveries.push(payload); return { success: true, id: 91, ...payload } },
      },
      'api/salesTransport.ts': { createSale: async (payload: Record<string, unknown>) => { sales.push(payload); return { success: true, receiptNumber: 'R-1', id: 5 } } },
    },
  })
  mounted.push(page)
  return { page, app, notes, sales, customers, deliveries }
}

const completeButton = (page: MountedSurface, language: 'en' | 'km'): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && node.textContent.trim() === packs[language].complete_sale, `the ${language} Complete Sale button`)
const statusOptions = (page: MountedSurface): MemoryNode[] => page.findAll((node) => node.getAttribute('data-pos-status-option') !== null)
const reasonNodes = (page: MountedSurface, text: string): MemoryNode[] => page.findAll((node) => node.tagName === 'P' && node.getAttribute('role') === 'status' && node.textContent === text)
const addNewCustomer = (page: MountedSurface): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && /Add New|បន្ថែមថ្មី/.test(node.textContent), 'the customer + Add New button')
const quantityPlus = (page: MountedSurface): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && node.textContent === '+' && /^-\d*\+$/.test((node.parentNode?.textContent ?? '').replace(/\s/g, '')), 'the cart quantity + button')
const byId = (page: MountedSurface, id: string): MemoryNode => page.find((node) => node.getAttribute('id') === id, `#${id}`)
const saveButton = (page: MountedSurface, language: 'en' | 'km'): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && node.textContent.trim() === packs[language].save, 'the quick-add Save button')

try {
  await check('online control: Complete Sale is live with no reason, the picker opens and a pick reaches createSale', async () => {
    const till = await mountTill('en')
    const button = completeButton(till.page, 'en')
    assert.ok(!propsOf(button).disabled, 'enabled online')
    assert.equal(reasonNodes(till.page, packs.en.pos_saving_needs_connection).length, 0, 'no reason online')
    await till.page.click(button)
    const options = statusOptions(till.page)
    assert.equal(options.length, 3)
    const notPaid = options.find((node) => node.getAttribute('data-pos-status-option') === 'awaiting_payment')!
    assert.ok(!propsOf(notPaid).disabled, 'Not Paid is selectable')
    await till.page.click(notPaid)
    assert.equal(till.sales.length, 1, 'the sale was sent')
    assert.equal((till.sales[0].items as Array<{ id: number }>)[0].id, 11)
    assert.ok(!till.notes.some((note) => note.message === packs.en.pos_saving_needs_connection), 'the saving gate never fired')
  })

  await check('offline (the app has no server link): Complete Sale is disabled beside the translated reason, the handler refuses on its own, nothing is sent', async () => {
    const till = await mountTill('en', { canWriteToServer: false })
    const button = completeButton(till.page, 'en')
    assert.equal(propsOf(button).disabled, true)
    const [reason] = reasonNodes(till.page, packs.en.pos_saving_needs_connection)
    assert.ok(reason, 'the reason is on the screen in the pack')
    assert.equal(propsOf(button)['aria-describedby'], reason.getAttribute('id'), 'the button is described by the reason')
    await assert.rejects(() => till.page.click(button), /is disabled/)
    await till.page.call(button, 'onClick', [])
    assert.equal(statusOptions(till.page).length, 0, 'the status picker does not open even when the handler is called')
    assert.equal(till.sales.length, 0)
  })

  await check('offline: the cart stays editable (quantity +1 recomputes the subtotal)', async () => {
    const till = await mountTill('en', { canWriteToServer: false })
    assert.match(till.page.text(), /Subtotal\$5/)
    await till.page.click(quantityPlus(till.page))
    assert.match(till.page.text(), /Subtotal\$10/, 'the cart edit went through')
    assert.ok(till.page.text().includes('Synthetic serum'), 'the line is still in the cart')
  })

  await check('the connection drops while the status picker is open: its options are disabled with the reason, and a handler call still sends nothing', async () => {
    const till = await mountTill('en')
    await till.page.click(completeButton(till.page, 'en'))
    assert.equal(statusOptions(till.page).length, 3)
    till.app.canWriteToServer = false
    await till.page.render({})
    const options = statusOptions(till.page)
    assert.equal(options.length, 3, 'the picker is still open')
    assert.ok(options.every((node) => propsOf(node).disabled === true), 'every option is disabled')
    assert.ok(reasonNodes(till.page, packs.en.pos_saving_needs_connection).length >= 1, 'the reason is shown in the picker')
    const notPaid = options.find((node) => node.getAttribute('data-pos-status-option') === 'awaiting_payment')!
    await till.page.call(notPaid, 'onClick', [])
    assert.equal(till.sales.length, 0, 'handleCheckout refused')
    assert.ok(till.notes.some((note) => note.type === 'error' && note.message === packs.en.pos_saving_needs_connection), 'it said why')
  })

  await check('the browser reports no network while the app still holds a server link: blocked, and live again when the network returns', async () => {
    const listeners = new Map<string, Array<() => void>>()
    browser.window.addEventListener = (type, listener) => { listeners.set(type, [...(listeners.get(type) ?? []), listener]) }
    browser.window.removeEventListener = (type, listener) => { listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener)) }
    browser.window.navigator.onLine = false
    try {
      const till = await mountTill('en')
      assert.equal(propsOf(completeButton(till.page, 'en')).disabled, true, 'blocked on navigator.onLine === false')
      assert.ok(reasonNodes(till.page, packs.en.pos_saving_needs_connection).length === 1)
      assert.ok((listeners.get('online') ?? []).length >= 1 && (listeners.get('offline') ?? []).length >= 1, 'the till listens for the browser online and offline events')
      browser.window.navigator.onLine = true
      await till.page.settle()
      await act(async () => { for (const listener of listeners.get('online') ?? []) listener() })
      await till.page.settle()
      assert.ok(!propsOf(completeButton(till.page, 'en')).disabled, 'live again')
      assert.equal(reasonNodes(till.page, packs.en.pos_saving_needs_connection).length, 0)
    } finally {
      browser.window.navigator.onLine = true
      browser.window.addEventListener = originalListeners.add
      browser.window.removeEventListener = originalListeners.remove
    }
  })

  await check('quick-add customer offline: Save is disabled beside the reason, a handler call notifies it and creates nothing; online it creates', async () => {
    const offline = await mountTill('en', { canWriteToServer: false })
    await offline.page.click(addNewCustomer(offline.page))
    await offline.page.type(byId(offline.page, 'pos-quick-customer-name'), 'Sok Dara')
    const save = saveButton(offline.page, 'en')
    assert.equal(propsOf(save).disabled, true)
    assert.ok(reasonNodes(offline.page, packs.en.pos_saving_needs_connection).length >= 2, 'the reason is on the till and in the dialog')
    await offline.page.call(save, 'onClick', [])
    assert.equal(offline.customers.length, 0, 'no customer was created')
    assert.ok(offline.notes.some((note) => note.message === packs.en.pos_saving_needs_connection))
    await offline.page.unmount()
    mounted.length = 0

    const online = await mountTill('en')
    await online.page.click(addNewCustomer(online.page))
    await online.page.type(byId(online.page, 'pos-quick-customer-name'), 'Sok Dara')
    assert.ok(!propsOf(saveButton(online.page, 'en')).disabled, 'live online')
    assert.equal(reasonNodes(online.page, packs.en.pos_saving_needs_connection).length, 0)
    await online.page.click(saveButton(online.page, 'en'))
    assert.equal(online.customers.length, 1, 'online control: the customer is created')
  })

  await check('quick-add delivery contact: Save is blocked beside the reason, and live without it', async () => {
    const blocked = await harness.mount({
      component: 'components/pos/POSQuickAddModals.tsx',
      props: quickAddProps('no connection'), app: { t: (key: string) => packs.en[key] ?? key }, doubles: {},
    })
    mounted.push(blocked)
    assert.equal(propsOf(saveButton(blocked, 'en')).disabled, true)
    assert.equal(reasonNodes(blocked, 'no connection').length, 1)
    await blocked.unmount()
    mounted.length = 0
    const live = await harness.mount({
      component: 'components/pos/POSQuickAddModals.tsx',
      props: quickAddProps(''), app: { t: (key: string) => packs.en[key] ?? key }, doubles: {},
    })
    mounted.push(live)
    assert.ok(!propsOf(saveButton(live, 'en')).disabled, 'control: with no reason the Save is live')
    assert.equal(reasonNodes(live, 'no connection').length, 0)
  })

  await check('Khmer: the reason is the Khmer pack sentence, wraps instead of clipping, and Complete Sale is disabled', async () => {
    const till = await mountTill('km', { canWriteToServer: false })
    const button = completeButton(till.page, 'km')
    assert.equal(propsOf(button).disabled, true)
    const [reason] = reasonNodes(till.page, packs.km.pos_saving_needs_connection)
    assert.ok(reason, 'the Khmer reason is shown')
    assert.ok(/[ក-៿]/.test(packs.km.pos_saving_needs_connection) && packs.km.pos_saving_needs_connection !== packs.en.pos_saving_needs_connection)
    assert.match(reason.className, /leading-relaxed/)
    assert.doesNotMatch(reason.className, /truncate|line-clamp|whitespace-nowrap/)
    assert.ok(!till.page.text().includes(packs.en.pos_saving_needs_connection), 'no English sentence beside it')
  })

  await check('control: a till context that does not carry canWriteToServer is not blocked (only an explicit no-connection blocks)', async () => {
    const till = await mountTill('en', { canWriteToServer: undefined })
    assert.ok(!propsOf(completeButton(till.page, 'en')).disabled)
    assert.equal(reasonNodes(till.page, packs.en.pos_saving_needs_connection).length, 0)
  })

  await check('copy: the offline banner and the packs say saving needs a connection, in both languages, and promise nothing offline', async () => {
    const appSource = read('../src/App.tsx')
    const context = read('../src/AppContext.tsx')
    for (const language of ['en', 'km'] as const) {
      for (const key of ['offline_mode_active', 'offline_saving_blocked_title', 'pos_saving_needs_connection']) {
        assert.ok(packs[language][key]?.trim(), `${language}.${key} exists`)
      }
    }
    for (const key of ['offline_mode_active', 'offline_saving_blocked_title', 'pos_saving_needs_connection']) {
      assert.ok(/[ក-៿]/.test(packs.km[key]) && packs.km[key] !== packs.en[key], `km.${key} is Khmer, not a copy of the English`)
    }
    assert.match(packs.en.offline_mode_active, /Saving needs a connection/)
    assert.doesNotMatch(packs.en.offline_mode_active, /saved on this device|will sync|sync when/i, 'the banner no longer promises offline saving')
    const core = context.slice(context.indexOf('CORE_ENGLISH_PACK'), context.indexOf('CORE_ENGLISH_PACK') + 12000)
    assert.ok(core.includes(`offline_mode_active: '${packs.en.offline_mode_active}'`), 'the first-paint English pack carries the same sentence as en.json')
    assert.ok(core.includes(`offline_saving_blocked_title: '${packs.en.offline_saving_blocked_title}'`), 'and the same title')
    assert.doesNotMatch(core, /sales are saved on this device and will sync/)
    const banner = appSource.slice(appSource.indexOf('function OfflineModeBanner'), appSource.indexOf('function OfflineModeBanner') + 6000)
    assert.match(banner, /offline \? \(t\('offline_saving_blocked_title'\)/, 'the offline banner title says saving is blocked')
    assert.ok(banner.includes(`t('offline_mode_active') || '${packs.en.offline_mode_active}'`), 'the banner fallback is the same sentence')
  })
} finally {
  browser.window.addEventListener = originalListeners.add
  browser.window.removeEventListener = originalListeners.remove
  browser.window.navigator.onLine = true
  ;(globalThis as unknown as { fetch: unknown }).fetch = realFetch
  await harness.close()
}

function quickAddProps(savingBlockedText: string): Record<string, unknown> {
  const noop = (): void => {}
  return {
    closeAddCustomerModal: noop, closeAddDeliveryModal: noop, customerDuplicateCheck: null, deliveryDuplicateCheck: null,
    clearCustomerDuplicateCheck: noop, clearDeliveryDuplicateCheck: noop, handleAddCustomer: noop, handleAddDelivery: noop,
    handleCreateSeparateCustomer: noop, handleCreateSeparateDelivery: noop, handleUseExistingCustomer: noop, handleUseExistingDelivery: noop,
    onOpenCustomerAddressPresets: noop, newCustomerForm: { name: '', phone: '', address: '', membership_number: '' }, newDeliveryForm: { name: '', phone: '', area: '' },
    savingBlockedText: savingBlockedText || undefined, savingCustomer: false, savingDelivery: false,
    setNewCustomerForm: noop, setNewDeliveryForm: noop, showAddCustomer: false, showAddDelivery: true,
    t: (key: string) => packs.en[key] ?? key,
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nposOfflineSavingGate: all checks passed')
