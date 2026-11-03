import { expect, test, type Locator, type Page } from '@playwright/test'
import en from '../src/lang/en.json' with { type: 'json' }
import adminProducts from './fixtures/admin-products.json' with { type: 'json' }
import { PERMISSION_DEFS } from '../src/components/users/permissionDefinitions.ts'
import { pageErrorsExcludingKnown, ADMIN_ORIGIN } from './support/harness'
import { APP_ROOT } from './support/session'
import { costKeysIn } from './support/costRedaction'
import {
  ADMIN_ROUTES, HUB_PAGES, ROLES, accessFor, expectedAccountPages, expectedHubSections, expectedLanding, expectedNavIds, grant, seesCost,
  type RoleAccess, type RoleDef,
} from './support/roleMatrix'
import { isPhoneProject, openAsRole, type RoleSession } from './support/roleSession'

/**
 * role-matrix.spec.ts -- E2E-P1, Gap #16 (app tier): does each role see exactly what the definitions grant it?
 *
 * One real sign-in per role per project (see support/roleSession.ts for how a fixture account is given a role), then, for
 * every role:
 *
 *   navigation   the sidebar rows / phone home tiles, the account menu and every hub section the role is offered
 *   routes       a direct URL to each of the 15 admin routes either renders the page or lands on the first page the role
 *                may open, with the denied page's slot holding only the Access Denied panel; never blank, never a crash
 *   controls     the Products and Sales buttons, and the Delete / price controls inside a product, against permissionActions.ts
 *   cost         no acquisition-cost key in any response body the page received, and no cost in the DOM even when the
 *                server leaks it (the DOM is the last line of defence)
 *   phones       full phone numbers are not shown to a role without the "See full phone numbers" grant
 *
 * Widths: desktop-chromium runs at 1280 px, android-chromium at 390 px (support/roleSession.ts VIEWPORT_BY_PROJECT).
 *
 * Every expectation comes from support/roleMatrix.ts, which runs the app's own pure functions over roles built from the real
 * definitions. A mismatch is therefore either an app bug (kept, marked test.fail with a one-line reason, reported) or a wrong
 * expectation (fixed here). The admin control proves every locator can see its control, so an absence is never a bad locator.
 *
 * App tier only: the fixture server answers; nothing here proves the Worker refuses a forged call (system-tier lane).
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test role-matrix --workers=1
 */

test.use({ serviceWorkers: 'block' })

const EN = en as unknown as Record<string, unknown>
const text = (key: string, fallback: string): string => { const value = EN[key]; return typeof value === 'string' && value && value !== key ? value : fallback }
const squash = (value: string): string => value.replace(/\s+/g, ' ').trim()
const sorted = (values: readonly string[]): string[] => [...values].sort()
/** A few seconds: used after the page has settled, where "absent" must fail fast instead of waiting 15 s. */
const BRIEF = { timeout: 5_000 }

/** The shell's active page slot (App.tsx PageSlot: data-bos-page-slot / data-bos-active-page). */
const activeSlot = (page: Page): Locator => page.locator('[data-bos-page-slot][data-bos-active-page="true"]')
const activePageId = async (page: Page): Promise<string> => (await activeSlot(page).first().getAttribute('data-bos-page-slot', { timeout: 1_000 }).catch(() => null)) ?? ''

/** Go to a real URL and wait until page `pageId` is the active slot, has left its loader, and the network is quiet. */
async function open(page: Page, path: string, pageId: string): Promise<Locator> {
  await page.goto(`${ADMIN_ORIGIN}${path}`, { waitUntil: 'load' })
  await expect(page.locator(APP_ROOT)).toBeVisible({ timeout: 30_000 })
  return settle(page, pageId)
}
async function settle(page: Page, pageId: string): Promise<Locator> {
  await expect.poll(() => activePageId(page), { message: `${pageId} becomes the active page`, timeout: 30_000 }).toBe(pageId)
  const slot = activeSlot(page)
  await expect(slot.locator('.business-os-initial-shell'), `${pageId} has left its loader`).toHaveCount(0, { timeout: 30_000 })
  // Bounded: a page that polls never goes idle, and a settle must not borrow the 45 s navigation budget.
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
  return slot
}

type Session = RoleSession & { projectName: string; phone: boolean }
async function begin(browser: import('@playwright/test').Browser, projectName: string, role: RoleDef, redact = true): Promise<Session> {
  const session = await openAsRole(browser, projectName, role, { redact })
  return { ...session, projectName, phone: isPhoneProject(projectName) }
}
const finish = (session: Session): void => {
  expect.soft(pageErrorsExcludingKnown(session.health), 'uncaught page errors').toEqual([])
}

// =====================================================================================================================
// 1. Navigation
// =====================================================================================================================
async function readDesktopNav(session: Session, access: RoleAccess): Promise<void> {
  const { page } = session
  await expect(page.locator('aside nav [data-bos-nav-id]').first(), 'the sidebar has rendered').toBeVisible({ timeout: 30_000 })
  const wantIds = expectedNavIds(access)
  await expect.poll(
    async () => sorted(await page.locator('aside nav [data-bos-nav-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-bos-nav-id') || ''))),
    { message: 'sidebar rows equal the pages the role may open (NAV_ITEMS through canAccessPage, minus Account pages)', timeout: 15_000 },
  ).toEqual(sorted(wantIds))

  // Settings and Receipt Settings live under the Account row, not in the sidebar.
  await page.locator('aside').getByRole('button', { name: text('account', 'Account'), exact: true }).click()
  const panel = page.locator('aside [data-bos-profile-action="true"]').locator('xpath=..')
  await expect(panel).toBeVisible()
  const entries = (await panel.getByRole('button').allInnerTexts()).map(squash)
  const wantPages = expectedAccountPages(access)
  const accountPages = [['settings', text('settings', 'Settings')], ['receipt_settings', text('receipt_settings', 'Receipt Settings')]] as const
  expect.soft(
    accountPages.filter(([, label]) => entries.includes(label)).map(([id]) => id),
    `account menu pages (entries: ${entries.join(' | ')})`,
  ).toEqual(wantPages)
  await page.keyboard.press('Escape')
}

async function readPhoneNav(session: Session, access: RoleAccess): Promise<void> {
  const { page } = session
  const layer = page.locator('#mobile-nav-layer')
  await page.locator('header[data-bos-mobile-header]').getByRole('button', { name: text('back', 'Back'), exact: true }).click()
  await expect(layer, 'the page menu opens').toBeVisible({ timeout: 15_000 })
  const wantIds = sorted([...expectedNavIds(access), ...(access.canAccessPage('settings') ? ['settings'] : [])])
  await expect.poll(
    async () => sorted(await layer.locator('[data-bos-nav-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-bos-nav-id') || ''))),
    { message: 'home tiles equal the pages the role may open (NAV_ITEMS through canAccessPage, plus Settings)', timeout: 15_000 },
  ).toEqual(wantIds)

  const tiles = await layer.locator('[data-bos-nav-id]').evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute('data-bos-nav-id') || '', expandable: node.hasAttribute('aria-expanded') })))
  for (const tile of tiles) {
    const wantSections = expectedHubSections(access, tile.id).map((section) => section.id)
    expect.soft(tile.expandable, `tile ${tile.id} unfolds sections iff the role is offered some (${wantSections.join(',') || 'none'})`).toBe(wantSections.length > 0)
    if (!wantSections.length || !tile.expandable) continue
    await layer.locator(`[data-bos-nav-id="${tile.id}"]`).click()
    await expect.poll(
      async () => sorted(await layer.locator(`[data-bos-section^="${tile.id}:"]`).evaluateAll((nodes) => nodes.map((node) => (node.getAttribute('data-bos-section') || '').split(':')[1]))),
      { message: `sections under ${tile.id}`, timeout: 10_000 },
    ).toEqual(sorted(wantSections))
  }
}

for (const role of ROLES) {
  test(`${role.label}: the sidebar, account menu and hub sections show exactly what the definitions grant`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000)
    const session = await begin(browser, testInfo.project.name, role)
    try {
      if (session.phone) await readPhoneNav(session, session.access)
      else await readDesktopNav(session, session.access)
      finish(session)
    } finally { await session.close() }
  })
}

// =====================================================================================================================
// 2. Direct URLs
// =====================================================================================================================
for (const role of ROLES) {
  test(`${role.label}: a direct URL to each of the ${ADMIN_ROUTES.length} admin routes renders, or lands on a page the role may open, never blank or a crash`, async ({ browser }, testInfo) => {
    test.setTimeout(420_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    try {
      for (const route of ADMIN_ROUTES) {
        const landing = expectedLanding(access, route.page)
        const denied = landing !== route.page
        const where = `${route.path} (${route.page}${denied ? `, denied -> ${landing}` : ''})`
        await page.goto(`${ADMIN_ORIGIN}${route.path}`, { waitUntil: 'load' })
        await expect(page.locator(APP_ROOT)).toBeVisible({ timeout: 30_000 })
        const slot = await settle(page, landing)

        const shown = squash(await slot.innerText())
        const controls = await slot.locator('button, input, select, textarea, a, table, img').count()
        expect.soft(shown.length > 0 || controls > 0, `${where} is not a blank page`).toBe(true)
        expect.soft(shown, `${where} did not hit the page error boundary`).not.toContain('Page failed to load')

        if (denied) {
          // The denied page is never a dead end (App.tsx moves the shell on), and if its slot is still mounted it holds
          // nothing but the refusal -- the page itself must not have rendered for this role.
          const deniedSlot = page.locator(`[data-bos-page-slot="${route.page}"]`)
          if (await deniedSlot.count()) {
            const body = squash((await deniedSlot.first().textContent()) || '')
            expect.soft(
              body.startsWith(text('access_denied', 'Access Denied')) && body.length < 300,
              `${where}: the denied page's slot holds only the Access Denied panel (it holds "${body.slice(0, 120)}")`,
            ).toBe(true)
            expect.soft(await deniedSlot.first().getAttribute('data-bos-active-page'), `${where}: the denied slot is not the active one`).toBe('false')
          }
        } else {
          expect.soft(shown.includes(text('access_denied', 'Access Denied')), `${where} does not show Access Denied to a role that may open it`).toBe(false)
          if (!session.phone && HUB_PAGES.includes(route.page)) {
            // Desktop shows a hub's sections as pills, and only when there are two or more.
            const sections = expectedHubSections(access, route.page)
            const want = sections.length > 1 ? sorted(sections.map((section) => text(section.key, section.label))) : []
            await expect.poll(
              async () => sorted((await slot.locator('.hub-section-pill').allInnerTexts()).map(squash)),
              { message: `${where}: hub section pills`, timeout: 10_000 },
            ).toEqual(want)
          }
        }
      }
      finish(session)
    } finally { await session.close() }
  })
}

// =====================================================================================================================
// 3. Action buttons
// =====================================================================================================================
const PRODUCT_NAME = 'E2E Product 001 Aurelia'

/** Products' Manage menu, as HeaderActions.tsx builds it: [label, the action that shows it]. */
function manageEntries(access: RoleAccess): Array<[string, boolean]> {
  const lookups = grant(access, 'products', 'manage_lookups')
  return [
    [text('categories', 'Categories'), lookups],
    [text('brand', 'Brand'), lookups],
    [text('units', 'Units'), lookups],
    [text('reasons', 'Reasons'), grant(access, 'inventory', 'edit_reasons')],
    [text('import', 'Import'), grant(access, 'products', 'import')],
    [text('export', 'Export'), grant(access, 'products', 'export')],
    [text('wire_images_title', 'Wire images to products'), grant(access, 'products', 'image')],
    [text('merge_duplicate_products', 'Merge duplicate products'), grant(access, 'products', 'merge_duplicates')],
    [text('zero_quantity_cleanup_title', 'Remove 0-quantity products'), grant(access, 'products', 'zero_qty_cleanup')],
  ]
}

for (const role of ROLES) {
  test(`${role.label}: the Products and Sales buttons match the grants`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    try {
      if (access.canAccessPage('products')) {
        const slot = await open(page, '/products', 'products')
        await expect(slot.getByText(PRODUCT_NAME).first(), 'the fixture catalogue rendered').toBeVisible({ timeout: 30_000 })
        const entries = manageEntries(access)
        const wantAdjust = grant(access, 'products', 'add') || grant(access, 'inventory', 'adjust')
        await expect.soft(slot.getByRole('button', { name: /^Adjust stock/ }), 'Adjust stock = products:add or inventory:adjust').toHaveCount(wantAdjust ? 1 : 0, BRIEF)
        const wantManage = entries.some(([, shown]) => shown)
        const manage = slot.getByRole('button', { name: text('manage', 'Manage'), exact: true })
        await expect.soft(manage, 'Manage appears iff the role has at least one entry to put behind it').toHaveCount(wantManage ? 1 : 0, BRIEF)
        if (wantManage && await manage.count()) {
          await manage.click()
          const menu = page.locator('[data-portal-menu-content]').last()
          await expect(menu).toBeVisible()
          const shown = (await menu.getByRole('button').allInnerTexts()).map(squash)
          expect.soft(sorted(shown), 'Manage menu entries').toEqual(sorted(entries.filter(([, on]) => on).map(([label]) => label)))
          await page.keyboard.press('Escape')
        }
      }

      if (access.canAccessPage('sales') && grant(access, 'sales', 'view')) {
        const slot = await open(page, '/sales', 'sales')
        await expect(slot.getByText('20260914-101500').first(), 'the fixture sales rendered').toBeVisible({ timeout: 30_000 })
        // Export rides the mobile header on a phone, so these two are looked up page-wide.
        await expect.soft(page.getByRole('button', { name: text('export', 'Export'), exact: true }), 'Sales Export = sales:export').toHaveCount(grant(access, 'sales', 'export') ? 1 : 0, BRIEF)
        await expect.soft(page.getByRole('button', { name: text('manage', 'Manage'), exact: true }), 'Sales Manage (Import) = sales:import').toHaveCount(grant(access, 'sales', 'import') ? 1 : 0, BRIEF)

        await slot.getByText('20260914-101500').first().click()
        const footer = page.locator('[data-sale-detail-footer-actions]')
        await expect(footer, 'the sale detail opened').toBeVisible({ timeout: 15_000 })
        await expect.soft(page.getByRole('button', { name: text('sale_customer_edit_entry', 'Edit customer'), exact: true }), 'Edit customer = sales:customer').toHaveCount(grant(access, 'sales', 'customer') ? 1 : 0, BRIEF)
        await expect.soft(page.getByRole('button', { name: text('return', 'Return'), exact: true }), 'Return = returns:add').toHaveCount(grant(access, 'returns', 'add') ? 1 : 0, BRIEF)
        await expect.soft(page.getByText(text('update_status', 'Update status'), { exact: true }), 'Update status = sales:status').toHaveCount(grant(access, 'sales', 'status') ? 1 : 0, BRIEF)
      }
      finish(session)
    } finally { await session.close() }
  })
}

// -- inside a product ---------------------------------------------------------------------------------------------------
/** Roles that open the product edit form: those that may open Products and hold products:edit. */
const EDITORS = ROLES.filter((role) => {
  const access = accessFor(role)
  return access.canAccessPage('products') && grant(access, 'products', 'edit')
})

async function openProductForm(session: Session): Promise<Locator> {
  const { page } = session
  const slot = await open(page, '/products', 'products')
  await slot.getByText(PRODUCT_NAME, { exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: text('edit', 'Edit'), exact: true }).filter({ visible: true }).click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog, 'the product edit form opened').toBeVisible({ timeout: 15_000 })
  await expect(dialog.locator('input').first()).toBeVisible()
  return dialog
}

for (const role of EDITORS) {
  test(`${role.label}: the product edit form offers Delete only with products:delete`, async ({ browser }, testInfo) => {
    test.setTimeout(150_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { access } = session
    const wantDelete = grant(access, 'products', 'delete')
    // APP BUG, kept as a case: Products.tsx:5969 hands ProductForm `onDelete` for every selected product and ProductForm.tsx:2302
    // draws the trash button on `isEditMode && onDelete` alone. canRemoveProduct (Products.tsx:1498) only reaches the Conflicts tab.
    // A role that may edit but not delete (the Employee default) is offered Delete, then collects the Worker's 403.
    test.fail(!wantDelete, 'Products.tsx:5969 passes onDelete to ProductForm with no products:delete check; ProductForm.tsx:2302 shows Delete on onDelete alone')
    try {
      const dialog = await openProductForm(session)
      await expect(dialog.getByRole('button', { name: text('delete', 'Delete'), exact: true }), 'Delete in the product form = products:delete').toHaveCount(wantDelete ? 1 : 0, BRIEF)
    } finally { await session.close() }
  })

  test(`${role.label}: the product edit form locks the selling and wholesale price without products:edit + products:price`, async ({ browser }, testInfo) => {
    test.setTimeout(150_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { access } = session
    // utils/productMergePriceAccess.ts canChangeProductPrices: administrator, or edit and price both held.
    const wantEditable = access.isAdmin || (grant(access, 'products', 'edit') && grant(access, 'products', 'price'))
    try {
      const dialog = await openProductForm(session)
      const locked = dialog.locator('fieldset[disabled][title*="change product prices"]')
      await expect.soft(locked, 'price fieldsets are disabled with the read-only hint iff the role may not change prices').toHaveCount(wantEditable ? 0 : 2, BRIEF)
      finish(session)
    } finally { await session.close() }
  })
}

// =====================================================================================================================
// 4. Cost
// =====================================================================================================================
// E2E Product 001's acquisition cost. Verified unique among every price, quantity and threshold in admin-products.json, so a hit
// in the DOM can only be the cost.
const PROBE_COST = '13.15'
const hasProbeCost = (value: string): boolean => new RegExp(`(?<![\\d.])${PROBE_COST.replace('.', '\\.')}(?!\\d)`).test(value)
const costProduct = (adminProducts as { items: Array<{ name: string; cost_price_usd: number }> }).items[0]
if (costProduct.name !== PRODUCT_NAME || costProduct.cost_price_usd.toFixed(2) !== PROBE_COST) throw new Error('admin-products.json no longer starts with the cost probe product')

const COST_PAGES: Array<[string, string]> = [['/', 'dashboard'], ['/products', 'products'], ['/sales', 'sales'], ['/pos', 'pos'], ['/inventory', 'inventory']]

for (const role of ROLES) {
  test(`${role.label}: no acquisition-cost key is in any response body the pages received, unless the role may view costs`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    try {
      for (const [path, pageId] of COST_PAGES) await open(page, path, expectedLanding(access, pageId))
      const leaks: string[] = []
      for (const body of session.bodies) {
        if (body.status >= 400) continue
        let parsed: unknown
        try { parsed = JSON.parse(body.text) } catch { continue }
        const keys = costKeysIn(parsed)
        if (keys.length) leaks.push(`${new URL(body.url).pathname}: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ` (+${keys.length - 3})` : ''}`)
      }
      if (seesCost(access)) {
        expect(leaks.length, 'CONTROL: a role that may view costs does receive cost keys, so the capture can see them').toBeGreaterThan(0)
      } else {
        expect(sorted([...new Set(leaks)]), `cost-bearing keys among ${session.bodies.length} captured /api/ bodies`).toEqual([])
      }
      finish(session)
    } finally { await session.close() }
  })

  test(`${role.label}: even when the server leaks cost, no screen shows it unless the role may view costs`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    // redact = false: the fixture's admin-shaped bodies, cost included, go to every role. The DOM is the last line of defence.
    const session = await begin(browser, testInfo.project.name, role, false)
    const { page, access } = session
    try {
      const shownOn: string[] = []
      for (const [path, pageId] of COST_PAGES) {
        const landing = expectedLanding(access, pageId)
        if (landing !== pageId) continue
        const slot = await open(page, path, landing)
        if (pageId === 'products') await expect(slot.getByText(PRODUCT_NAME).first(), 'the fixture catalogue rendered').toBeVisible({ timeout: 30_000 })
        if (hasProbeCost(await slot.innerText())) shownOn.push(pageId)
        if (pageId === 'products' && !session.phone && grant(access, 'products', 'view')) {
          await expect.soft(slot.getByRole('columnheader', { name: new RegExp(`^${text('cost', 'Cost')}`) }), 'the Cost column exists iff the role may view costs').toHaveCount(seesCost(access) ? 1 : 0, BRIEF)
        }
      }
      if (seesCost(access)) expect(shownOn, 'CONTROL: the Products screen shows the cost to a role that may view it').toContain('products')
      else expect(shownOn, `screens that printed ${PROBE_COST}, the cost of ${PRODUCT_NAME}`).toEqual([])
      finish(session)
    } finally { await session.close() }
  })
}

for (const role of EDITORS) {
  test(`${role.label}: even when the server leaks cost, the product form holds the cost only for a role that may view it`, async ({ browser }, testInfo) => {
    test.setTimeout(150_000)
    const session = await begin(browser, testInfo.project.name, role, false)
    try {
      const dialog = await openProductForm(session)
      const values = await dialog.locator('input, textarea').evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
      const holdsCost = values.some((value) => /^13\.15/.test(value.trim()))
      expect(holdsCost, `form values: ${values.filter(Boolean).slice(0, 12).join(' | ')}`).toBe(seesCost(session.access))
      finish(session)
    } finally { await session.close() }
  })
}

// =====================================================================================================================
// 5. Full phone numbers
// =====================================================================================================================
// Owner, 14 Oct 2026 and round 1 (2 Nov, answer 3): a separate "See full phone numbers" grant, off by default for every non-admin
// role. At b6ebf551d it does not exist (P2.8, claude/p28-phone-permission-20261102, is not in rc/20261104a), so these cases are
// written against the definition and flip to ordinary passing tests the day the grant lands -- see `test.fail(!phoneGrant, ...)`.
// P2.8 masks in the Worker's shared projection, not in the browser, so what this tier can show is only what the page does with
// the number it is sent; the forged-call half is the system-tier lane.
const phoneGrant = PERMISSION_DEFS.find((definition) => /full phone/i.test(definition.label) || /full_phone/.test(definition.key))
const PHONE_FULL = '098765432'
const PHONE_TAIL = '98765432'
const PHONE_MASKED = '098 *** 432'
const digitsOf = (value: string): string => value.replace(/\D/g, '')
const NO_PHONE_GRANT = 'P2.8 (claude/p28-phone-permission-20261102, contacts_full_phone) is not in rc/20261104a: no "See full phone numbers" grant exists in permissionDefinitions.ts, so every role is sent full numbers'

test('the permission catalogue defines a "See full phone numbers" grant, off in every non-admin role', () => {
  test.fail(!phoneGrant, NO_PHONE_GRANT)
  expect(phoneGrant, 'a "See full phone numbers" grant in permissionDefinitions.ts').toBeDefined()
  for (const role of ROLES.filter((entry) => entry.id !== 'admin')) {
    expect(role.grants[phoneGrant?.key ?? ''], `${role.label} does not hold ${phoneGrant?.key}`).not.toBe(true)
  }
})

for (const role of ROLES.filter((entry) => { const access = accessFor(entry); return access.canAccessPage('sales') && grant(access, 'sales', 'view') })) {
  test(`${role.label}: a customer's full phone number is shown on a sale only to a role holding the full-phone grant`, async ({ browser }, testInfo) => {
    test.setTimeout(150_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    const mayReadFull = access.isAdmin || (!!phoneGrant && access.hasPermission(phoneGrant.key))
    // What the Worker sends this role: the masked form once the grant exists and the role lacks it; at the base, the raw
    // `s.*` row (routes/sales.ts GET /api/sales) to everybody.
    const sent = phoneGrant && !mayReadFull ? PHONE_MASKED : PHONE_FULL
    test.fail(!mayReadFull && !phoneGrant, NO_PHONE_GRANT)
    try {
      await page.route(/\/api\/sales(\/search)?(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const response = await route.fetch()
        const rows = await response.json() as Array<Record<string, unknown>>
        return route.fulfill({ response, json: rows.map((row, index) => (index === 0 ? { ...row, customer_id: 5001, customer_name: 'E2E Phone Customer', customer_phone: sent } : row)) })
      })
      const slot = await open(page, '/sales', 'sales')
      await expect(slot.getByText('20260914-101500').first()).toBeVisible({ timeout: 30_000 })
      await slot.getByText('20260914-101500').first().click()
      await expect(page.locator('[data-sale-detail-footer-actions]'), 'the sale detail opened').toBeVisible({ timeout: 15_000 })
      const screen = digitsOf(await page.locator(APP_ROOT).innerText())
      const received = session.bodies.some((body) => body.text.includes(PHONE_FULL))
      if (mayReadFull) {
        expect(screen.includes(PHONE_TAIL), 'CONTROL: a role that may read full numbers sees it on screen, so the probe can see a number').toBe(true)
      } else {
        expect(screen.includes(PHONE_TAIL), 'the full number is on screen').toBe(false)
        expect(received, 'a response body carried the full number').toBe(false)
      }
      finish(session)
    } finally { await session.close() }
  })
}
