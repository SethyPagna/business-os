import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, DEVICE_SETTINGS_KEY, seedDeviceSettings } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * dirty-form-guards.spec.ts -- no form silently loses what someone typed (E2E-COVERAGE gap 20).
 *
 * THE OWNER'S RULE, as two deliberate dialogs (memory: unsaved-changes-two-moments):
 *  - closing a modal by X, Escape or Cancel asks "Discard unsaved changes?" with NO body text and exactly two buttons,
 *    Discard and Back (shared/UnsavedChangesPrompt.tsx, utils/closeGuard.ts UNSAVED_CLOSE_OPTION_SET);
 *  - LEAVING the page (browser Back, a sidebar click) is the older guard, "Unsaved work on this page", with Discard &
 *    Leave and Stay, plus Save & Leave when every dirty item can save itself (App.tsx:2064).
 *
 * WHAT THIS PROVES, per form, per language (en, km) and per project (desktop-chromium, android-chromium, ios-webkit):
 *  1. opened and closed without typing, the form closes with no prompt;
 *  2. text typed, then X: the two-button prompt; Back keeps the text; Discard closes, sends no write, and the next
 *     open does not bring the text back;
 *  3. the same for Escape, and for the form's own Cancel button;
 *  4. text typed in a field that lives OUTSIDE the form's main state still counts as unsaved;
 *  5. browser Back with text typed raises the navigation guard; Stay keeps the text, Discard & Leave leaves with no write.
 * Pages that autosave (Receipt settings, Notes) are held to the opposite promise: what was typed IS written, even when
 * the person leaves a moment later. Settings has an explicit Save and no guard; it is held to "leaving does not lose it".
 *
 * A case that fails because of the APP is kept, marked test.fail with a one-line reason and the file:line, so the
 * report names the form and the run turns red the day it is fixed. No assertion is weakened to make it pass.
 *
 * App tier: the built dist against the fixture server. The reads of these pages that the fixture does not answer are
 * stubbed with page.route (READ_STUBS), additively; fixtureServer.mjs is untouched. Every write the page sends after the
 * form is open is captured and answered 500, so a stray save can never be mistaken for the form working.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test dirty-form-guards --workers=1
 */
test.use({ serviceWorkers: 'block' })

// ---------------------------------------------------------------------------------------------------------------------
// Language. The expected strings come from the same packs the app reads, resolved the way the app resolves them
// (AppContext.tsx:829 t(): the language's string, else English, else the key), so no Khmer is typed into this file
// except the sentence a person types.
// ---------------------------------------------------------------------------------------------------------------------
type Lang = 'en' | 'km'
const LANGS: Lang[] = ['en', 'km']
const PACKS: Record<Lang, Record<string, unknown>> = {
  en: JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')),
  km: JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')),
}
function say(lang: Lang, key: string, fallback: string): string {
  for (const code of lang === 'km' ? (['km', 'en'] as const) : (['en'] as const)) {
    const value = PACKS[code][key]
    if (typeof value === 'string' && value && value !== key) return value
  }
  return fallback
}
/** What a person types. Khmer in km, so a form that mangles non-Latin input shows up too. */
const TYPED: Record<Lang, string> = { en: 'Typed by hand 123', km: 'អត្ថបទសាកល្បង 123' }

/** frontend/src/utils/standaloneNavigation.ts IOS_INSTALL_HINT_DISMISSED_KEY: on ios-webkit the hint covers lower buttons. */
const IOS_INSTALL_HINT_DISMISSED_KEY = `${DEVICE_SETTINGS_KEY}:ios-install-hint-dismissed-at-v1`

/** A predicted app bug fails on its first assertion; do not make each one wait out the full expect timeout. */
const QUICK_MS = 4_000

// ---------------------------------------------------------------------------------------------------------------------
// The API layer: reads the fixture server does not answer, and a capture of every write.
// ---------------------------------------------------------------------------------------------------------------------
type Write = { method: string; path: string; body: string }
type Api = {
  /** Every non-GET request made while `recording` was on, minus the ones a test said it expects. */
  writes: Write[]
  /** The writes a test expects (autosave), kept apart so "no write" stays a strict statement. */
  expected: Write[]
  recording: boolean
  expect: RegExp[]
  /** Every /api path the fixture answered 404 (e2e_unmocked): the list to extend when a page needs another read. */
  unmocked: string[]
}

const PAGED = { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }
const NO_DUPLICATE = { matches: [], duplicateReview: { candidateIds: [], candidateVersions: [], fingerprint: 'v1|' }, allowedActions: [] }
const ADMIN_ROLE = { id: 1, name: 'Administrator', code: 'admin', permissions: { all: true }, is_system: 1, user_count: 4 }

/** Each page's reads, the route's declared EMPTY state (the same rule as fixtureServer.mjs). Matched on the path only. */
const READ_STUBS: Array<[RegExp, unknown | ((url: URL) => unknown)]> = [
  [/^\/api\/(customers|suppliers|delivery-contacts)\/check-duplicate$/, NO_DUPLICATE],
  // GET /api/suppliers?fields=names (the Supplier return picker) is a bare array; the Suppliers tab takes the paged envelope.
  [/^\/api\/suppliers$/, (url: URL) => (url.searchParams.get('fields') === 'names' ? [] : PAGED)],
  [/^\/api\/(customers|delivery-contacts)$/, PAGED],
  [/^\/api\/fees$/, { fees: [], total: 0 }],
  [/^\/api\/fees\/labels$/, { labels: [] }],
  [/^\/api\/fees\/types$/, { types: [] }],
  [/^\/api\/returns$/, []],
  [/^\/api\/returns\/reason-presets$/, { presets: [], reasons: [] }],
  // The typeahead row for fixture sale 9001 (admin-sales.json); picking it loads the sale by id from the fixture's own /api/sales.
  [/^\/api\/returns\/receipt-lookup$/, [{ id: 9001, receipt_number: '20260914-101500', total_usd: 12.5, created_at: '2026-09-14T03:15:00.000Z', customer_name: 'E2E Customer', branch_name: 'Old Shop' }]],
  [/^\/api\/promotions\/rules$/, []],
  [/^\/api\/promotions$/, []],
  [/^\/api\/notes$/, { notes: [] }],
  [/^\/api\/roles$/, [ADMIN_ROLE]],
  [/^\/api\/roles\/defaults$/, {}],
  [/^\/api\/telegram\/status$/, { configured: false }],
]

let lastApi: Api | null = null

function installApi(page: Page): Api {
  const api: Api = { writes: [], expected: [], recording: false, expect: [], unmocked: [] }
  lastApi = api
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (response.status() === 404 && pathname.startsWith('/api/')) api.unmocked.push(pathname)
  })
  void page.route('**/api/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const method = request.method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      const stub = READ_STUBS.find(([pattern]) => pattern.test(pathname))
      if (!stub) return route.fallback()
      const body = stub[1]
      return route.fulfill({ json: typeof body === 'function' ? (body as (url: URL) => unknown)(new URL(request.url())) : body })
    }
    if (!api.recording) return route.fallback()
    const write = { method, path: pathname, body: request.postData() ?? '' }
    if (api.expect.some((pattern) => pattern.test(pathname))) {
      api.expected.push(write)
      const echo = (() => { try { return JSON.parse(write.body) as Record<string, unknown> } catch { return {} } })()
      const note = { id: 1, title: '', content: '', pinned: 0, sort_order: 0, updated_at: '2026-11-03 00:00:00', ...echo }
      return route.fulfill({ json: { note, updatedAt: '2026-11-03 00:00:00', keys: Object.keys(echo) } })
    }
    api.writes.push(write)
    return route.fulfill({ status: 500, json: { error: 'e2e: the form sent a write nobody asked for' } })
  })
  return api
}

test.afterEach(async ({}, testInfo) => {
  if (!lastApi) return
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('api-capture', {
      body: JSON.stringify({ writes: lastApi.writes, expected: lastApi.expected, unmocked: [...new Set(lastApi.unmocked)] }, null, 2),
      contentType: 'application/json',
    })
  }
  lastApi = null
})

async function startSession(page: Page, context: BrowserContext, lang: Lang): Promise<Api> {
  const api = installApi(page)
  await context.addInitScript(({ key, origin }) => {
    if (window.location.origin !== origin) return
    try { window.localStorage.setItem(key, String(Date.now())) } catch { /* blocked storage */ }
  }, { key: IOS_INSTALL_HINT_DISMISSED_KEY, origin: ADMIN_ORIGIN })
  await signIn(page, E2E_ACCOUNTS.cashierA)
  if (lang !== 'en') {
    // The sign-in screen is driven by its English labels, so the language is switched AFTER it, the way website-editor.spec does.
    await seedDeviceSettings(context, ADMIN_ORIGIN, { language: lang })
    await gotoAdminPage(page, '/')
  }
  return api
}

// ---------------------------------------------------------------------------------------------------------------------
// Moving around the way a person does. Every route here pushes a same-document history entry, which is what browser
// Back needs: a page.goto() would make a new document, and Back from it is a reload, not a popstate.
// ---------------------------------------------------------------------------------------------------------------------
type Dest = {
  /** data-bos-nav-id of the page. */
  nav: string
  /** Desktop: index of the hub's section pill. */
  pill?: number
  /** Phone: the section id in data-bos-section. */
  section?: string
  /** Settings has no nav row; it lives under the account menu (navigationConfig.ts ACCOUNT_NAV_IDS). */
  account?: boolean
}
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 768

async function chromeTo(page: Page, lang: Lang, dest: Dest): Promise<void> {
  const account = say(lang, 'account', 'Account')
  const settings = say(lang, 'settings', 'Settings')
  if (!isPhone(page)) {
    if (dest.account) {
      await page.locator('aside').getByRole('button', { name: account, exact: true }).click()
      await page.locator('aside').getByRole('button', { name: settings, exact: true }).click()
    } else {
      await page.locator(`aside [data-bos-nav-id="${dest.nav}"]`).click()
    }
    if (dest.pill !== undefined) await page.locator('.hub-section-pills .chip-rail-item').nth(dest.pill).click()
    return
  }
  // The phone's default "pages" mode: the header Back chevron opens the page menu; a hub's tile unfolds its sections.
  if (dest.account) {
    await page.getByRole('button', { name: account, exact: true }).click()
    await page.getByRole('button', { name: settings, exact: true }).click()
  } else {
    await page.locator('button[aria-controls="mobile-nav-layer"]').click()
    await page.locator(`#mobile-nav-layer [data-bos-nav-id="${dest.nav}"]`).click()
  }
  if (dest.section) await page.locator(`#mobile-nav-layer [data-bos-section="${dest.nav}:${dest.section}"]`).click()
}

// ---------------------------------------------------------------------------------------------------------------------
// Assertions. The prompt checks reuse draft-chip.spec.ts:129-132: the dialog is found by its heading, it has no <p>, and
// its buttons read Discard, Back.
// ---------------------------------------------------------------------------------------------------------------------
const discardPrompt = (page: Page, lang: Lang): Locator => page.getByRole('dialog')
  .filter({ has: page.getByRole('heading', { name: say(lang, 'unsaved_changes_title', 'Discard unsaved changes?'), exact: true }) })

async function expectDiscardPrompt(page: Page, lang: Lang, wait?: number): Promise<Locator> {
  const prompt = discardPrompt(page, lang)
  const discard = say(lang, 'discard', 'Discard')
  const back = say(lang, 'back', 'Back')
  await expect(prompt).toBeVisible({ timeout: wait })
  await expect(prompt.locator('p')).toHaveCount(0)
  // A flow that can park its draft (UnsavedChangesPrompt.tsx:69) adds an icon-only Minimize beside the title when the host
  // supplied the capability. It is not a third answer: the answers (data-unsaved-actions) stay exactly Discard, Back, and
  // with no Minimize the whole dialog has exactly those two buttons, as draft-chip.spec.ts:132 asserts.
  const minimize = await prompt.getByRole('button', { name: new RegExp(`^(${say(lang, 'minimize', 'Minimize')}|Minimize)$`) }).count()
  expect(minimize, 'at most the one Minimize control').toBeLessThanOrEqual(1)
  await expect(prompt.locator('[data-unsaved-actions] button')).toHaveText([discard, back])
  await expect(prompt.getByRole('button')).toHaveCount(2 + minimize)
  if (minimize === 0) await expect(prompt.getByRole('button')).toHaveText([discard, back])
  return prompt
}

/** The older guard, App.tsx:2064. It is a plain div, not role=dialog. */
const navGuard = (page: Page, lang: Lang): Locator => page.locator('div.fixed.inset-0')
  .filter({ has: page.getByRole('heading', { name: say(lang, 'unsaved_work_title', 'Unsaved work on this page'), exact: true }) })

// ---------------------------------------------------------------------------------------------------------------------
// The forms.
// ---------------------------------------------------------------------------------------------------------------------
type Known = {
  /** Why an untouched form does not close quietly. */
  untouched?: string
  /** Why Escape does not behave. */
  escape?: string
  cancel?: string
  back?: string
}
type SecondField = { name: string; field: (root: Locator) => Locator; value?: string; known?: string }
type ModalForm = {
  id: string
  title: string
  dest: Dest
  open: (page: Page, lang: Lang) => Promise<void>
  /** The form's own container, found by something only it has, so it works for a modal and for a hand-rolled overlay. */
  root: (page: Page, lang: Lang) => Locator
  field: (root: Locator) => Locator
  /** The field Escape is pressed in, when the main one swallows it (a suggestion list eats the first Escape: SuggestionTextInput.tsx:167). */
  escapeField?: (root: Locator) => Locator
  /** What shows when the form is open, when that is not the typed field itself (New return opens on a line, not on its notes). */
  ready?: (root: Locator, lang: Lang) => Locator
  /** The steps before the typed field exists (choose a quantity so the notes appear). Runs before every typing and after every reopen. */
  prepare?: (root: Locator, lang: Lang) => Promise<void>
  /** 'x' = the header close control (default); 'backdrop' = a hand-rolled overlay with no X. */
  closeRoute?: 'x' | 'backdrop'
  cancel?: boolean
  second?: SecondField
  known?: Known
}

const byId = (id: string) => (page: Page): Locator => page.getByRole('dialog').filter({ has: page.locator(`#${id}`) })
const addButton = (key: string, fallback: string) => async (page: Page, lang: Lang): Promise<void> => {
  await page.getByRole('button', { name: say(lang, key, fallback), exact: true }).first().click()
}

const K = {
  noKeyboard: (where: string) => `Escape does nothing: this Modal is opened without the keyboard prop, so useDialogKeyboard never runs (shared/Modal.tsx:101; ${where})`,
  rawCancel: (where: string) => `Cancel calls the raw onClose and skips the discard prompt, so typed text is dropped silently (${where})`,
  zUnder: (where: string) => `the navigation guard is z-[70] (App.tsx:2065) and the form is a z-[1050] modal (shared/Modal.tsx:186), so the guard opens UNDER the form and Stay / Discard & Leave cannot be clicked (${where})`,
  noRegistry: (where: string) => `the form declares dirty only to its own X ({ dirty }) and never to dirtyWork, so Back finds an empty registry and leaves with no guard (AppContext.tsx:2632; ${where})`,
}

const FORMS: ModalForm[] = [
  {
    id: 'customer', title: 'Customer',
    dest: { nav: 'contacts', pill: 0, section: 'customers' },
    open: addButton('add_customer', 'Add Customer'),
    root: byId('customer-form-name'),
    field: (root) => root.locator('#customer-form-name'),
    cancel: true,
    second: {
      name: 'a Contact Option address',
      field: (root) => root.locator('#customer-option-0-address'),
      known: 'the Contact Options live in separate state that useFormDirty(form) never sees, so an address typed alone is dropped on X with no prompt (contacts/CustomerFormModal.tsx:130 tracks form only)',
    },
    known: {
      escape: K.noKeyboard('contacts/CustomerFormModal.tsx:230'),
      cancel: K.rawCancel('contacts/CustomerFormModal.tsx:343'),
      back: K.noRegistry('contacts/CustomerFormModal.tsx:230'),
    },
  },
  {
    id: 'supplier', title: 'Supplier',
    dest: { nav: 'contacts', pill: 1, section: 'suppliers' },
    open: addButton('add_supplier', 'Add Supplier'),
    root: byId('supplier-form-name'),
    field: (root) => root.locator('#supplier-form-name'),
    cancel: true,
    second: {
      name: 'the phone number',
      field: (root) => root.locator('#supplier-form-phone'),
      value: '012345678',
      known: 'the first-slot phone writes options[0], which useFormDirty(form) never sees, so a phone typed alone is dropped on X with no prompt (contacts/SuppliersTab.tsx:265 tracks form only)',
    },
    known: {
      escape: K.noKeyboard('contacts/SuppliersTab.tsx:352'),
      cancel: K.rawCancel('contacts/SuppliersTab.tsx:463'),
      back: K.noRegistry('contacts/SuppliersTab.tsx:352'),
    },
  },
  {
    id: 'delivery', title: 'Delivery contact',
    dest: { nav: 'contacts', pill: 2, section: 'delivery' },
    open: addButton('add_delivery_contact', 'Add Delivery'),
    root: byId('delivery-form-name'),
    field: (root) => root.locator('#delivery-form-name'),
    cancel: true,
    second: {
      name: 'a Contact Option phone',
      field: (root) => root.locator('#delivery-option-0-phone'),
      value: '012345678',
      known: 'the Contact Options live in separate state that useFormDirty(form) never sees (contacts/DeliveryTab.tsx:303 tracks form only)',
    },
    known: {
      escape: K.noKeyboard('contacts/DeliveryTab.tsx:392'),
      cancel: K.rawCancel('contacts/DeliveryTab.tsx:464'),
      back: K.noRegistry('contacts/DeliveryTab.tsx:392'),
    },
  },
  {
    id: 'expense', title: 'Expense',
    dest: { nav: 'sales', pill: 2, section: 'fees' },
    open: addButton('add_fee', 'Add Expense'),
    root: byId('fee-label'),
    field: (root) => root.locator('#fee-label'),
    cancel: true,
    // The second currency field: dirty must not depend on which of the two amounts was typed.
    second: { name: 'the riel amount', field: (root) => root.locator('#fee-amount-khr'), value: '4100' },
    known: {
      untouched: 'an untouched form is already dirty: with one sellable branch FeeForm.tsx:427-428 fills branch_id after the first render, past the useFormDirty baseline (FeeForm.tsx:297), so X on a form nobody typed in asks "Discard unsaved changes?"',
      escape: K.noKeyboard('fees/FeesPage.tsx:1131'),
      back: K.zUnder('fees/FeesPage.tsx:1131'),
    },
  },
  {
    id: 'supplier-return', title: 'Supplier return',
    dest: { nav: 'sales', pill: 1, section: 'returns' },
    open: async (page, lang) => {
      // The scope lives in the filter menu (returns/Returns.tsx:1556).
      await page.getByRole('button', { name: say(lang, 'filters', 'Filters') }).first().click()
      const scope = page.getByRole('option', { name: say(lang, 'supplier_returns', 'Supplier Returns'), exact: true })
      if (!(await scope.isVisible())) await page.getByRole('button', { name: say(lang, 'scope', 'Scope'), exact: true }).click()
      await scope.click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: say(lang, 'add_supplier_return', 'Add Supplier Return'), exact: true }).click()
    },
    root: byId('supplier-return-notes'),
    field: (root) => root.locator('#supplier-return-notes'),
    second: { name: 'the riel compensation', field: (root) => root.locator('#supplier-return-compensation-khr'), value: '4100' },
    known: {
      escape: K.noKeyboard('returns/NewSupplierReturnModal.tsx:457'),
      back: K.noRegistry('returns/NewSupplierReturnModal.tsx:460'),
    },
  },
  {
    id: 'return', title: 'New return (sale loaded)',
    dest: { nav: 'sales', pill: 1, section: 'returns' },
    open: async (page, lang) => {
      await page.getByRole('button', { name: say(lang, 'add_return', 'Add Return'), exact: true }).click()
      await page.locator('#return-receipt-search').fill('20260914')
      await page.getByRole('option').filter({ hasText: '20260914-101500' }).getByRole('button').click()
    },
    root: (page, lang) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: say(lang, 'new_return', 'New Return') }) }),
    // With a sale loaded and no quantity chosen the form is still clean (NewReturnModal.tsx:1015); one unit makes it dirty.
    ready: (root, lang) => root.getByRole('button', { name: say(lang, 'increaseQty', 'Increase quantity') }).first(),
    prepare: async (root, lang) => {
      await root.getByRole('button', { name: say(lang, 'increaseQty', 'Increase quantity') }).first().click()
    },
    field: (root) => root.locator('textarea').first(),
    known: {
      escape: K.noKeyboard('returns/NewReturnModal.tsx:1164'),
      back: K.noRegistry('returns/NewReturnModal.tsx:1164'),
    },
  },
  {
    id: 'product', title: 'Product edit',
    dest: { nav: 'products', pill: 0, section: 'products' },
    open: async (page, lang) => {
      await page.getByText('E2E Product 001 Aurelia').filter({ visible: true }).first().click()
      await page.getByRole('button', { name: say(lang, 'edit', 'Edit'), exact: true }).last().click()
    },
    root: byId('product-name'),
    field: (root) => root.locator('#product-name').first(),
    escapeField: (root) => root.locator('#product-barcode'),
    cancel: true,
    known: { back: K.zUnder('products/forms/ProductForm.tsx:1553') },
  },
  {
    id: 'variant', title: 'Product variant',
    dest: { nav: 'products', pill: 0, section: 'products' },
    open: async (page, lang) => {
      await page.getByText('E2E Product 001 Aurelia').filter({ visible: true }).first().click()
      await page.getByRole('button', { name: say(lang, 'add_variant', 'Add variant'), exact: true }).click()
    },
    root: byId('variant-form-name'),
    field: (root) => root.locator('#variant-form-name'),
    cancel: true,
    known: {
      escape: K.noKeyboard('products/forms/VariantFormModal.tsx:306'),
      cancel: K.rawCancel('products/forms/VariantFormModal.tsx:492'),
      back: K.noRegistry('products/forms/VariantFormModal.tsx:306'),
    },
  },
  {
    id: 'cancel-sale', title: 'Cancel sale',
    dest: { nav: 'sales', pill: 0, section: 'sales' },
    open: async (page, lang) => {
      // The way cutover-branch-redirect.spec.ts reaches it: the sale, its Cancelled status, Apply.
      // Discarding the Cancel dialog leaves the sale open behind it, so on a reopen the sale is already there.
      const cancelled = page.getByRole('button', { name: say(lang, 'status_cancelled', 'Cancelled'), exact: true })
      const apply = page.getByRole('button', { name: say(lang, 'apply', 'Apply'), exact: true })
      if (!(await apply.isVisible())) {
        if (!(await cancelled.isVisible())) {
          // Below 768 px the sales list is cards, and the receipt number there is a copy button, not the
          // way in (sales/SalesListSurface.tsx:482 opens the sale from the card). Press the card's padding.
          if (isPhone(page)) {
            await page.locator('.card.cursor-pointer').filter({ hasText: '20260914-101500' }).first().click({ position: { x: 6, y: 6 } })
          } else {
            await page.getByText('20260914-101500').filter({ visible: true }).first().click()
          }
        }
        await cancelled.click()
      }
      await apply.click()
    },
    // The only dialog with a lost-fee riel box (sales/CancelSaleFields.tsx:82).
    root: (page, lang) => page.getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: say(lang, 'cancel_sale_title', 'Cancel sale') }) })
      .filter({ has: page.locator('input[aria-label="KHR"]') }),
    field: (root) => root.locator('textarea').first(),
    // The second currency field: the dirty check lists all five (CancelSaleFields.tsx:32), this proves it for the riel fee.
    second: { name: 'the lost-fee riel amount', field: (root) => root.locator('input[aria-label="KHR"]'), value: '4100' },
    known: {
      escape: 'Escape also reaches the Sale detail sheet behind the dialog (SaleDetailModal.tsx:1431 keeps its own document keydown handler): the sheet closes and the Cancel dialog, with its typed text, gets no discard prompt',
      back: K.noRegistry('sales/CancelSaleModal.tsx:77'),
    },
  },
  {
    id: 'branch', title: 'Branch',
    dest: { nav: 'branches', pill: 0, section: 'overview' },
    open: async (page, lang) => {
      await page.getByRole('button', { name: say(lang, 'edit', 'Edit'), exact: true }).first().click()
    },
    root: byId('branch-name'),
    // The branch name is read-only on an existing branch (BranchForm.tsx:191 readOnly), so the typed field is the location.
    field: (root) => root.locator('#branch-location'),
    cancel: true,
    second: { name: 'the phone number', field: (root) => root.locator('#branch-phone'), value: '012345678' },
    known: {
      escape: K.noKeyboard('branches/Branches.tsx:1837'),
      back: K.zUnder('branches/Branches.tsx:1837'),
    },
  },
  {
    id: 'user', title: 'User',
    dest: { nav: 'settings', pill: 1, section: 'users', account: true },
    open: addButton('add_user', 'Add user'),
    root: byId('user-name'),
    field: (root) => root.locator('#user-name'),
    known: {
      escape: K.noKeyboard('users/Users.tsx:1740'),
      back: K.noRegistry('users/Users.tsx:1740'),
    },
  },
  {
    id: 'role', title: 'Role',
    dest: { nav: 'settings', pill: 1, section: 'users', account: true },
    open: async (page, lang) => {
      await page.getByRole('button', { name: say(lang, 'roles', 'Roles'), exact: true }).click()
      await page.getByRole('button', { name: say(lang, 'create', 'Create'), exact: true }).first().click()
    },
    root: byId('role-name'),
    field: (root) => root.locator('#role-name'),
    known: {
      escape: K.noKeyboard('users/Users.tsx:1911'),
      back: K.noRegistry('users/Users.tsx:1915'),
    },
  },
  {
    id: 'promotion', title: 'Promotion rule',
    dest: { nav: 'promotions', pill: 0, section: 'rules' },
    open: async (page, lang) => {
      await page.getByRole('button', { name: say(lang, 'promo_new_rule', 'New rule') }).first().click()
    },
    // A hand-rolled overlay (promotions/PromotionsPage.tsx:786): no role=dialog, no X; found by the field it holds.
    root: (page) => page.locator('div.fixed.inset-0[class*="z-[1050]"]').filter({ has: page.locator('input[maxlength="120"]') }),
    field: (root) => root.locator('input[maxlength="120"]').first(),
    closeRoute: 'backdrop',
    cancel: true,
    known: {
      escape: 'Escape does nothing: the overlay is hand-rolled and never calls useDialogKeyboard (promotions/PromotionsPage.tsx:786)',
      back: K.noRegistry('promotions/PromotionsPage.tsx:222'),
    },
  },
]

async function openForm(page: Page, lang: Lang, form: ModalForm): Promise<Locator> {
  await form.open(page, lang)
  const root = form.root(page, lang)
  await expect((form.ready ?? form.field)(root, lang)).toBeVisible()
  return root
}

/** Get the form to the point where the typed field is on screen. */
async function arrive(page: Page, lang: Lang, form: ModalForm): Promise<Locator> {
  const root = await openForm(page, lang, form)
  await form.prepare?.(root, lang)
  return root
}

async function requestClose(page: Page, lang: Lang, form: ModalForm, root: Locator): Promise<void> {
  if (form.closeRoute === 'backdrop') {
    // Just right of the panel, mid-height. Not the far corner: this overlay is drawn inside the page so it does NOT cover the
    // sidebar on the left (a click at 4,4 lands on the sidebar header; PromotionsPage.tsx:797 has no portal, unlike
    // shared/Modal.tsx), and not 4 px from the right edge either: the overlay is overflow-y-auto, so when Khmer text makes the
    // panel taller than a phone it carries a scrollbar there, and WebKit sends a click on a scrollbar to nobody.
    const size = page.viewportSize() ?? { width: 1440, height: 900 }
    const panel = await root.locator(':scope > div').first().boundingBox()
    const x = panel ? Math.min(size.width - 4, Math.round(panel.x + panel.width + 6)) : size.width - 12
    await page.mouse.click(x, Math.round(size.height / 2))
    return
  }
  await root.getByRole('button', { name: say(lang, 'close', 'Close'), exact: true }).first().click()
}

// E2E_RAW_FAILURES=1 turns every test.fail mark off, so the error behind each known app bug is printed instead of swallowed.
const RAW = process.env.E2E_RAW_FAILURES === '1'
const markKnown = (reason: string | undefined): void => { test.fail(Boolean(reason) && !RAW, reason ?? '') }
const quick = (reason: string | undefined): number | undefined => (reason ? QUICK_MS : undefined)

for (const lang of LANGS) {
  for (const form of FORMS) {
    test.describe(`${form.title} [${lang}]`, () => {
      const typed = TYPED[lang]
      const discardLabel = say(lang, 'discard', 'Discard')
      const backLabel = say(lang, 'back', 'Back')

      test('opened and closed without typing, it closes with no prompt', async ({ page, context }) => {
        markKnown(form.known?.untouched)
        const api = await startSession(page, context, lang)
        await chromeTo(page, lang, form.dest)
        const root = await openForm(page, lang, form)
        api.recording = true
        await requestClose(page, lang, form, root)
        await expect(discardPrompt(page, lang), 'nothing was typed, so nothing to ask about').toHaveCount(0, { timeout: quick(form.known?.untouched) })
        await expect(root).toHaveCount(0)
        expect(api.writes, 'closing an untouched form writes nothing').toEqual([])
      })

      test(`${form.closeRoute === 'backdrop' ? 'the backdrop' : 'X'} with typed text asks; Back keeps it, Discard drops it, nothing is sent`, async ({ page, context }) => {
        const api = await startSession(page, context, lang)
        await chromeTo(page, lang, form.dest)
        let root = await arrive(page, lang, form)
        api.recording = true
        const field = form.field(root)
        await field.fill(typed)
        await expect(field).toHaveValue(typed)

        await requestClose(page, lang, form, root)
        const prompt = await expectDiscardPrompt(page, lang)
        await prompt.getByRole('button', { name: backLabel, exact: true }).click()
        await expect(prompt).toHaveCount(0)
        await expect(field, 'Back returns to the form with the text intact').toHaveValue(typed)

        await requestClose(page, lang, form, root)
        await (await expectDiscardPrompt(page, lang)).getByRole('button', { name: discardLabel, exact: true }).click()
        await expect(root).toHaveCount(0)
        expect(api.writes, 'neither Back nor Discard is a save').toEqual([])

        root = await arrive(page, lang, form)
        await expect(form.field(root), 'a discarded form does not come back with the old text').not.toHaveValue(typed)
        expect(api.writes).toEqual([])
      })

      test('Escape with typed text asks the same question; Escape on the prompt is Back', async ({ page, context }) => {
        markKnown(form.known?.escape)
        const api = await startSession(page, context, lang)
        await chromeTo(page, lang, form.dest)
        const root = await arrive(page, lang, form)
        api.recording = true
        const field = (form.escapeField ?? form.field)(root)
        await field.fill(typed)
        await field.press('Escape')
        const prompt = await expectDiscardPrompt(page, lang, quick(form.known?.escape))
        await page.keyboard.press('Escape')
        await expect(prompt).toHaveCount(0)
        await expect(field).toHaveValue(typed)

        await field.press('Escape')
        await (await expectDiscardPrompt(page, lang)).getByRole('button', { name: discardLabel, exact: true }).click()
        await expect(root).toHaveCount(0)
        expect(api.writes).toEqual([])
      })

      if (form.cancel) {
        test('Cancel with typed text asks the same question', async ({ page, context }) => {
          markKnown(form.known?.cancel)
          const api = await startSession(page, context, lang)
          await chromeTo(page, lang, form.dest)
          const root = await arrive(page, lang, form)
          api.recording = true
          const field = form.field(root)
          await field.fill(typed)
          const cancel = root.getByRole('button', { name: say(lang, 'cancel', 'Cancel'), exact: true })
          await cancel.click()
          const prompt = await expectDiscardPrompt(page, lang, quick(form.known?.cancel))
          await prompt.getByRole('button', { name: backLabel, exact: true }).click()
          await expect(field).toHaveValue(typed)
          await cancel.click()
          await (await expectDiscardPrompt(page, lang)).getByRole('button', { name: discardLabel, exact: true }).click()
          await expect(root).toHaveCount(0)
          expect(api.writes).toEqual([])
        })
      }

      if (form.second) {
        const second = form.second
        test(`text typed only in ${second.name} still counts as unsaved on X`, async ({ page, context }) => {
          markKnown(second.known)
          const api = await startSession(page, context, lang)
          await chromeTo(page, lang, form.dest)
          const root = await arrive(page, lang, form)
          api.recording = true
          const field = second.field(root)
          await field.scrollIntoViewIfNeeded()
          await field.fill(second.value ?? typed)
          await requestClose(page, lang, form, root)
          const prompt = await expectDiscardPrompt(page, lang, quick(second.known))
          await prompt.getByRole('button', { name: backLabel, exact: true }).click()
          await expect(field).toHaveValue(second.value ?? typed)
          expect(api.writes).toEqual([])
        })
      }

      test('browser Back with typed text raises the navigation guard; Stay keeps it, Discard & Leave leaves, nothing is sent', async ({ page, context }) => {
        markKnown(form.known?.back)
        const api = await startSession(page, context, lang)
        await chromeTo(page, lang, form.dest)
        const root = await arrive(page, lang, form)
        api.recording = true
        const field = form.field(root)
        await field.fill(typed)

        // Stay makes the app walk the history forward again (AppContext.tsx:2730 history.go); wait for that before the second Back.
        const historyIndex = () => page.evaluate(() => (window.history.state as { bosNavigationIndex?: number } | null)?.bosNavigationIndex ?? -1)
        const openedAt = await historyIndex()
        await page.goBack()
        const guard = navGuard(page, lang)
        await expect(guard).toBeVisible({ timeout: quick(form.known?.back) })
        // Save & Leave is offered only when every dirty item can save itself (App.tsx:2078). None of these forms registers a
        // save hook (ProductForm.tsx:1058 and BranchForm.tsx:123 say why), so the guard is Discard & Leave, Stay.
        await expect(guard.getByRole('button')).toHaveText([say(lang, 'discard_and_leave', 'Discard & Leave'), say(lang, 'stay_here', 'Stay')])
        await guard.getByRole('button', { name: say(lang, 'stay_here', 'Stay'), exact: true }).click({ timeout: quick(form.known?.back) })
        await expect(guard).toHaveCount(0)
        await expect(field, 'Stay keeps the form and the text').toHaveValue(typed)
        await expect.poll(historyIndex, { message: 'Stay returns the history to where it was' }).toBe(openedAt)

        await page.goBack()
        await navGuard(page, lang).getByRole('button', { name: say(lang, 'discard_and_leave', 'Discard & Leave'), exact: true }).click()
        await expect(root).toHaveCount(0)
        expect(api.writes, 'leaving is not a save').toEqual([])
      })
    })
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The one deliberate exception, pinned so it stays deliberate: a receipt number typed and nothing else is not worth a
// prompt (returns/NewReturnModal.tsx:1011-1014). The guard starts once a sale is loaded and something is chosen on it.
// ---------------------------------------------------------------------------------------------------------------------
for (const lang of LANGS) {
  test(`New return [${lang}]: a receipt number typed alone closes with no prompt, by design`, async ({ page, context }) => {
    const api = await startSession(page, context, lang)
    await chromeTo(page, lang, { nav: 'sales', pill: 1, section: 'returns' })
    await page.getByRole('button', { name: say(lang, 'add_return', 'Add Return'), exact: true }).click()
    const root = page.getByRole('dialog').filter({ has: page.locator('#return-receipt-search') })
    api.recording = true
    await root.locator('#return-receipt-search').fill('LC-000123')
    await root.getByRole('button', { name: say(lang, 'close', 'Close'), exact: true }).first().click()
    await expect(root).toHaveCount(0)
    await expect(discardPrompt(page, lang)).toHaveCount(0)
    expect(api.writes).toEqual([])
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Pages, not modals.
// ---------------------------------------------------------------------------------------------------------------------
for (const lang of LANGS) {
  const typed = TYPED[lang]
  const settingsDest: Dest = { nav: 'settings', pill: 0, section: 'settings', account: true }
  const settingsField = (page: Page): Locator => page.locator('#settings-business_name')
  const away: Dest = { nav: 'dashboard' }
  /** JSON.stringify escapes nothing in these strings, but a body is JSON, so compare against the encoded form. */
  const encoded = JSON.stringify(typed).slice(1, -1)

  test.describe(`Settings [${lang}]`, () => {
    test('leaving with an unsaved edit raises the navigation guard', async ({ page, context }) => {
      test.fail(!RAW, 'Settings keeps its dirty flag in a private ref (formDirtyRef) and never calls registerDirtyWork: no guard on navigation, no beforeunload prompt, no sidebar dot (utils-settings/Settings.tsx:585)')
      const api = await startSession(page, context, lang)
      await chromeTo(page, lang, settingsDest)
      await settingsField(page).fill(typed)
      api.recording = true
      await chromeTo(page, lang, away)
      await expect(navGuard(page, lang)).toBeVisible({ timeout: QUICK_MS })
    })

    test('leaving and coming back finds the text still there, and nothing was sent', async ({ page, context }) => {
      const api = await startSession(page, context, lang)
      await chromeTo(page, lang, settingsDest)
      await settingsField(page).fill(typed)
      api.recording = true
      await chromeTo(page, lang, away)
      await chromeTo(page, lang, settingsDest)
      await expect(settingsField(page), 'the page stays mounted, so the unsaved edit survives a round trip').toHaveValue(typed)
      expect(api.writes).toEqual([])
    })
  })

  test.describe(`Receipt settings [${lang}]`, () => {
    const footerTab = (page: Page): Locator => page.getByRole('button', { name: say(lang, 'receipt_footer_tab', 'Footer'), exact: true })
    const footerField = (page: Page): Locator => page.locator('#receipt-custom-footer')
    const settingsWrites = (api: Api): Write[] => api.expected.filter((write) => write.method === 'POST' && write.path === '/api/settings')

    test('what is typed is autosaved, so nothing is lost', async ({ page, context }) => {
      const api = await startSession(page, context, lang)
      await chromeTo(page, lang, { nav: 'receipt_settings' })
      api.expect = [/^\/api\/settings$/]
      api.recording = true
      await footerTab(page).click()
      await footerField(page).fill(typed)
      await expect.poll(() => settingsWrites(api).some((write) => write.body.includes(encoded)), {
        message: 'the 900 ms autosave carries the typed footer', timeout: 10_000,
      }).toBe(true)
    })

    test('leaving a moment after typing still saves it', async ({ page, context }) => {
      const api = await startSession(page, context, lang)
      await chromeTo(page, lang, { nav: 'receipt_settings' })
      api.expect = [/^\/api\/settings$/]
      api.recording = true
      await footerTab(page).click()
      await footerField(page).fill(typed)
      await chromeTo(page, lang, away)
      await expect.poll(() => settingsWrites(api).some((write) => write.body.includes(encoded)), {
        message: 'the text typed just before leaving is written', timeout: 10_000,
      }).toBe(true)
    })
  })

  test.describe(`Note [${lang}]`, () => {
    const noteBody = (page: Page): Locator => page.getByPlaceholder(say(lang, 'notes_content_placeholder', 'Write a note…'))
    const noteWrites = (api: Api): Write[] => api.expected.filter((write) => write.method === 'PUT' && /^\/api\/notes\/\d+$/.test(write.path))

    test('text typed in a note is written, even if the person leaves the page straight away', async ({ page, context }) => {
      const api = await startSession(page, context, lang)
      await chromeTo(page, lang, { nav: 'notes' })
      api.expect = [/^\/api\/notes(\/\d+)?$/]
      api.recording = true
      await page.getByRole('button', { name: say(lang, 'notes_new', 'New note'), exact: true }).first().click()
      await noteBody(page).fill(typed)
      await chromeTo(page, lang, away)
      await expect.poll(() => noteWrites(api).some((write) => write.body.includes(encoded)), { message: 'the typed note is written', timeout: 10_000 }).toBe(true)
    })

    test('on a phone, Back to notes right after typing still writes the note', async ({ page, context }) => {
      test.skip(!isPhone(page), 'the Back to notes control exists only below 640 px (notes/NotesPage.tsx:232)')
      const api = await startSession(page, context, lang)
      await chromeTo(page, lang, { nav: 'notes' })
      api.expect = [/^\/api\/notes(\/\d+)?$/]
      api.recording = true
      await page.getByRole('button', { name: say(lang, 'notes_new', 'New note'), exact: true }).first().click()
      await noteBody(page).fill(typed)
      await page.getByRole('button', { name: say(lang, 'notes_back', 'Back to notes'), exact: true }).click()
      await expect.poll(() => noteWrites(api).some((write) => write.body.includes(encoded)), { message: 'the typed note is written', timeout: 10_000 }).toBe(true)
    })
  })
}
