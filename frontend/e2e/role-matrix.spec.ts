import { expect, test, type Locator, type Page } from '@playwright/test'
import en from '../src/lang/en.json' with { type: 'json' }
import adminProducts from './fixtures/admin-products.json' with { type: 'json' }
import { PERMISSION_DEFS } from '../src/components/users/permissionDefinitions.ts'
import { pageErrorsExcludingKnown, ADMIN_ORIGIN } from './support/harness'
import { APP_ROOT } from './support/session'
import { costKeysIn } from './support/costRedaction'
import {
  ADMIN_ROUTES, HUB_PAGES, ROLES, accessFor, deriveRole, expectedAccountPages, expectedHubSections, expectedLanding, expectedNavIds, grant, seesCost,
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
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test e2e/role-matrix.spec.ts --workers=1
 * (Write the path: a bare `role-matrix` is a regex over the whole file path, so in a worktree whose directory name contains it, every spec matches.)
 */

test.use({ serviceWorkers: 'block' })

const EN = en as unknown as Record<string, unknown>
const text = (key: string, fallback: string): string => { const value = EN[key]; return typeof value === 'string' && value && value !== key ? value : fallback }
const squash = (value: string): string => value.replace(/\s+/g, ' ').trim()
const sorted = (values: readonly string[]): string[] => [...values].sort()
/**
 * test.fail(), through one door. A test.fail case also "passes" when it dies for the wrong reason (a bad locator, a timeout), which
 * would falsely confirm a defect. E2E_ROLE_MATRIX_RAW=1 switches every annotation off so the real failure message of each can be
 * read and checked against the reason given.
 */
const knownDefect = (condition: boolean, reason: string): void => { test.fail(condition && process.env.E2E_ROLE_MATRIX_RAW !== '1', reason) }
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
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined)
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
              body.includes(text('access_denied', 'Access Denied')) && body.length < 300,
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

// The Dashboard under the payload the Worker really sends each role. compat.ts:34-35 mounts acquisitionCostResponses on /dashboard and
// /dashboard/*, so a role without product_cost_view gets its cost-shaped keys projected away (stock_value_usd among them), and
// Dashboard.tsx isDashboardSummaryPayload (:727-735) requires stock_value_usd to be finite. The case asks the plain question: does the
// Dashboard load for each role that may open it? The admin and every cost holder are the controls.
const DASHBOARD_FAILED = /did not finish loading|returned incomplete (summary|analytics) data|incomplete data|could not be loaded for this range/i
for (const role of ROLES.filter((entry) => accessFor(entry).canAccessPage('dashboard'))) {
  test(`${role.label}: the Dashboard loads with the payload the Worker sends this role`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page } = session
    // FIXED (PERM-UI, 3 Nov): the Worker removes stock_value_usd (and the other cost-shaped keys) from /api/dashboard for a role without
    // product_cost_view (compat.ts mounts acquisitionCostResponses; acquisitionCostAccess.ts), and the Dashboard used to refuse a payload
    // without it (isDashboardSummaryPayload), so the seeded Manager, who holds dashboard and not cost view, was shown "Dashboard summary
    // unavailable". The validator no longer requires a cost-derived key and the stock-value card is left out without the grant.
    try {
      const slot = await open(page, '/', 'dashboard')
      // The startup read fills the cards a moment after the shell settles.
      await page.waitForTimeout(1_500)
      const shown = squash(await slot.innerText())
      expect(shown.length, 'the Dashboard has content').toBeGreaterThan(0)
      expect(shown.match(DASHBOARD_FAILED)?.[0] ?? null, `the Dashboard shows a load failure (page text: "${shown.slice(0, 240)}")`).toBeNull()
      finish(session)
    } finally { await session.close() }
  })
}

// =====================================================================================================================
// 3. Action buttons
// =====================================================================================================================
const PRODUCT_NAME = 'E2E Product 001 Aurelia'

/**
 * The product detail is a float, not a role="dialog" (ProductDetailModal.tsx draws a bare `modal-panel-safe` panel), so it is found as
 * the panel that carries the product's name. It cannot be found through its Edit button (Edit is the very control under test) or through
 * its links row (a role without Records / Stock Changes gets no links row: the Employee's detail has none).
 */
const productDetailOf = (page: Page): Locator => page.locator('.modal-panel-safe').filter({ hasText: PRODUCT_NAME }).last()

const SALE_RECEIPT = '20260914-101500'

/**
 * Opens the fixture sale's detail. On the desktop table the receipt number is a button; on the phone card it is plain text inside a
 * sideways-scrolling meta row that takes a press as the start of a scroll, so the card is tapped on its own padding instead
 * (SalesListSurface.tsx:462-486 -- the card's mouse and touch handlers open the detail from a tap anywhere on it).
 */
async function openFixtureSale(slot: Locator, projectName: string): Promise<void> {
  if (isPhoneProject(projectName)) {
    await slot.locator('.card:visible').filter({ hasText: SALE_RECEIPT }).last().click({ position: { x: 6, y: 6 } })
    return
  }
  await slot.getByText(SALE_RECEIPT).filter({ visible: true }).first().click()
}

/**
 * Products has no Select-all control until a row is selected: selecting starts with a hold on a row (Products.tsx:862-883, 500 ms,
 * utils/longPress.ts, mouse and touch handlers both). Pointer events from page.mouse reach those handlers on desktop and phone alike.
 */
async function selectFirstProductByHold(page: Page, slot: Locator): Promise<void> {
  const row = slot.getByText(PRODUCT_NAME, { exact: true }).filter({ visible: true }).first()
  await row.scrollIntoViewIfNeeded()
  const box = await row.boundingBox()
  if (!box) throw new Error('the product row has no box to hold')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(800)
  await page.mouse.up()
}

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
        await expect(slot.getByText(PRODUCT_NAME).filter({ visible: true }).first(), 'the fixture catalogue rendered').toBeVisible({ timeout: 30_000 })
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
          await expect(menu, 'the Manage menu closed').toBeHidden()
        }
      }

      if (access.canAccessPage('sales') && grant(access, 'sales', 'view')) {
        const slot = await open(page, '/sales', 'sales')
        await expect(slot.getByText(SALE_RECEIPT).filter({ visible: true }).first(), 'the fixture sales rendered').toBeVisible({ timeout: 30_000 })
        // Export rides the mobile header on a phone, so these two are looked up page-wide.
        await expect.soft(page.getByRole('button', { name: text('export', 'Export'), exact: true }), 'Sales Export = sales:export').toHaveCount(grant(access, 'sales', 'export') ? 1 : 0, BRIEF)
        await expect.soft(page.getByRole('button', { name: text('manage', 'Manage'), exact: true }), 'Sales Manage (Import) = sales:import').toHaveCount(grant(access, 'sales', 'import') ? 1 : 0, BRIEF)

        await openFixtureSale(slot, testInfo.project.name)
        const footer = page.locator('[data-sale-detail-footer-actions]')
        await expect(footer, 'the sale detail opened').toBeVisible({ timeout: 15_000 })
        // Scoped to the open detail so a same-named row action cannot inflate a count.
        const detail = (await page.getByRole('dialog').count()) ? page.getByRole('dialog').last() : page.locator(APP_ROOT)
        await expect.soft(detail.getByRole('button', { name: text('sale_customer_edit_entry', 'Edit customer'), exact: true }), 'Edit customer = sales:customer').toHaveCount(grant(access, 'sales', 'customer') ? 1 : 0, BRIEF)
        await expect.soft(detail.getByRole('button', { name: text('return', 'Return'), exact: true }), 'Return = returns:add').toHaveCount(grant(access, 'returns', 'add') ? 1 : 0, BRIEF)
        await expect.soft(detail.getByText(text('update_status', 'Update status'), { exact: true }), 'Update status = sales:status').toHaveCount(grant(access, 'sales', 'status') ? 1 : 0, BRIEF)
      }
      finish(session)
    } finally { await session.close() }
  })
}

// -- Promotions: New rule ------------------------------------------------------------------------------------------------
// PromotionsPage.tsx:547-560: the Rules section reads for the View tier; New rule needs promotions:manage. The toolbar renders before the
// rule list, so it needs no fixture read.
for (const role of ROLES.filter((entry) => { const access = accessFor(entry); return expectedHubSections(access, 'promotions').some((section) => section.id === 'rules') })) {
  test(`${role.label}: the Promotions rules offer New rule only with promotions:manage`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    try {
      const slot = await open(page, '/promotions', 'promotions')
      await expect(slot.getByRole('heading', { name: text('promo_rules_section', 'Promotion rules') }), 'the Rules section rendered').toBeVisible({ timeout: 30_000 })
      await expect(slot.getByRole('button', { name: text('promo_new_rule', 'New rule') }), 'New rule = promotions:manage').toHaveCount(grant(access, 'promotions', 'manage') ? 1 : 0, BRIEF)
      finish(session)
    } finally { await session.close() }
  })
}

// -- Settings: Save ------------------------------------------------------------------------------------------------------
// Settings.tsx:1209-1219: Save at the Full tier, a read-only "View" badge at the View tier. The tier is read with the app's own
// getPermissionTier, not copied.
for (const role of ROLES.filter((entry) => accessFor(entry).canAccessPage('settings'))) {
  test(`${role.label}: Settings offers Save only at the Full tier`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    // APP BUG, kept as a case: Settings.tsx:1209-1219 hides the header Save for a view-only grant and shows a "View" badge (Part 557), but
    // the page-bottom Save at Settings.tsx:2435 is drawn for every role. Clicking it only raises the view-only notice (:1032-1033); the
    // Worker refuses the POST. Confirmed in the browser, desktop-chromium, 3 Nov.
    knownDefect(access.getPermissionTier('settings') !== 'full', 'Settings.tsx:2435 draws a second Save for every tier; only the header one (:1209) is gated on canEditSettings')
    try {
      const slot = await open(page, '/settings', 'settings')
      const save = slot.getByRole('button', { name: text('save', 'Save'), exact: true })
      await expect(save.or(slot.getByText(text('view_only', 'View'), { exact: true })).first(), 'the Settings header rendered').toBeVisible({ timeout: 30_000 })
      expect(await save.count() > 0, `Save is shown iff the tier is full (tier: ${access.getPermissionTier('settings')})`).toBe(access.getPermissionTier('settings') === 'full')
      finish(session)
    } finally { await session.close() }
  })
}

// -- Products: Edit on the detail ---------------------------------------------------------------------------------------
for (const role of ROLES.filter((entry) => { const access = accessFor(entry); return access.canAccessPage('products') && grant(access, 'products', 'view') })) {
  test(`${role.label}: a product's detail offers Edit only with products:edit`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    const wantEdit = grant(access, 'products', 'edit')
    // APP BUG, kept as a case: ProductDetailModal.tsx:466-470 draws Edit unconditionally (onEdit is a required prop), Products.tsx:5828 passes it
    // with no products:edit check, and openProductFormTab (:4418) opens the form for anyone. The form guards only the price and cost fieldsets
    // (ProductForm.tsx:2028/2059/1998), so a role with View and no Edit gets a form it can type into and the Worker then refuses the save.
    // Found by the locked-employee role (products:edit switched off); every shipped role that can open Products also holds edit.
    knownDefect(!wantEdit, 'ProductDetailModal.tsx:466 draws Edit with no products:edit check; Products.tsx:5828 passes onEdit unconditionally')
    try {
      const slot = await open(page, '/products', 'products')
      await slot.getByText(PRODUCT_NAME, { exact: true }).filter({ visible: true }).first().click()
      const detail = productDetailOf(page)
      await expect(detail, 'the product detail opened').toBeVisible({ timeout: 15_000 })
      await expect(detail.getByRole('button', { name: text('edit', 'Edit'), exact: true }), 'Edit on a product = products:edit').toHaveCount(wantEdit ? 1 : 0, BRIEF)
    } finally { await session.close() }
  })
}

// -- Products: Add variant ----------------------------------------------------------------------------------------------
// Every shipped role that holds products:add holds products:variant too, so the defect needs a role one override away.
const MANAGER = ROLES.find((entry) => entry.id === 'manager') as RoleDef
const VARIANT_OFF = deriveRole(MANAGER, 'manager-no-variant', 'Manager with Add variant switched off', { 'products:variant': false })
for (const role of [...ROLES.filter((entry) => { const access = accessFor(entry); return access.canAccessPage('products') && grant(access, 'products', 'view') }), VARIANT_OFF]) {
  test(`${role.label}: a product's detail offers Add variant only with products:variant`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    const wantVariant = grant(access, 'products', 'variant')
    // APP BUG, kept as a case: Products.tsx:5829 passes onAddVariant when canAddProduct (products:add) alone holds. The grant table has a
    // separate products:variant row (utils/permissionActions.ts, "requires products:add") that no UI source reads, so a role with Add
    // but not Variant is offered the button and the Worker (routes/products.ts POST /variant) refuses it.
    knownDefect(grant(access, 'products', 'add') && !wantVariant, 'Products.tsx:5829 gates Add variant on products:add alone; products:variant is never read by the UI')
    try {
      const slot = await open(page, '/products', 'products')
      await slot.getByText(PRODUCT_NAME, { exact: true }).filter({ visible: true }).first().click()
      const detail = productDetailOf(page)
      await expect(detail, 'the product detail opened').toBeVisible({ timeout: 15_000 })
      await expect(detail.getByRole('button', { name: text('add_variant', 'Add variant'), exact: true }), 'Add variant = products:add and products:variant').toHaveCount(wantVariant ? 1 : 0, BRIEF)
    } finally { await session.close() }
  })
}

// -- Products: bulk Delete ----------------------------------------------------------------------------------------------
for (const role of ROLES.filter((entry) => { const access = accessFor(entry); return access.canAccessPage('products') && grant(access, 'products', 'view') })) {
  test(`${role.label}: selecting products offers a bulk Delete only with products:delete and products:bulk_delete`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    const wantBulkDelete = grant(access, 'products', 'delete') && grant(access, 'products', 'bulk_delete')
    // APP BUG, kept as a case: Products.tsx:5347 draws the bulk toolbar's Delete for any non-empty selection, and selection is open to
    // every role. Neither products:delete nor products:bulk_delete is consulted anywhere in the UI (utils/permissionActions.ts
    // bulk_delete has no reader), and canRemoveProduct (:1498) reaches only the Conflicts tab. The Worker then refuses the delete.
    knownDefect(!wantBulkDelete, 'Products.tsx:5347 shows the bulk Delete for any selection; products:delete and products:bulk_delete are never consulted')
    try {
      const slot = await open(page, '/products', 'products')
      await expect(slot.getByText(PRODUCT_NAME).filter({ visible: true }).first(), 'the fixture catalogue rendered').toBeVisible({ timeout: 30_000 })
      await selectFirstProductByHold(page, slot)
      const toolbar = slot.locator('.bulk-toolbar')
      await expect(toolbar, 'selecting rows opens the bulk toolbar').toBeVisible({ timeout: 10_000 })
      await expect(toolbar.getByRole('button', { name: text('delete_short', 'Delete'), exact: true }), 'bulk Delete = products:delete and products:bulk_delete').toHaveCount(wantBulkDelete ? 1 : 0, BRIEF)
    } finally { await session.close() }
  })
}

// -- Returns ------------------------------------------------------------------------------------------------------------
// /returns is the Sales hub with its Returns section open (pathRouting.ts, SalesHubPage.tsx initialSection). The toolbar renders
// before, and independently of, the returns list.
const RETURNS_ROLES = ROLES.filter((entry) => { const access = accessFor(entry); return access.canAccessPage('sales') && grant(access, 'returns', 'view') })
for (const role of RETURNS_ROLES) {
  test(`${role.label}: the Returns toolbar offers Add Return only with returns:add`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    const wantAdd = grant(access, 'returns', 'add')
    // APP BUG, kept as a case: Returns.tsx:1745 draws the Add Return button with no check at all. canAddReturn (Returns.tsx:391)
    // reaches only the detail's take-back control (:2000). Where an administrator has switched returns:add off, the button is still
    // offered and the Worker then refuses the create.
    knownDefect(!wantAdd, 'Returns.tsx:1745 renders Add Return with no returns:add check; canAddReturn (:391) only gates the take-back control at :2000')
    try {
      const slot = await open(page, '/returns', 'sales')
      await expect(slot.locator('#returns-search'), 'the Returns section rendered').toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: text('add_return', 'Add Return'), exact: true }), 'Add Return = returns:add').toHaveCount(wantAdd ? 1 : 0, BRIEF)
    } finally { await session.close() }
  })

  test(`${role.label}: the Returns toolbar offers Export only with returns:export`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    try {
      const slot = await open(page, '/returns', 'sales')
      await expect(slot.locator('#returns-search'), 'the Returns section rendered').toBeVisible({ timeout: 30_000 })
      // Export rides the mobile header on a phone, so it is looked up page-wide.
      await expect(page.getByRole('button', { name: text('export', 'Export'), exact: true }), 'Returns Export = returns:export').toHaveCount(grant(access, 'returns', 'export') ? 1 : 0, BRIEF)
      finish(session)
    } finally { await session.close() }
  })
}

// -- Contacts -----------------------------------------------------------------------------------------------------------
// CustomersTab.tsx:1083-1150: the toolbar renders before, and independently of, the customer list, so it needs no fixture read.
for (const role of ROLES.filter((entry) => { const access = accessFor(entry); return access.canAccessPage('contacts') && grant(access, 'contacts', 'view') })) {
  test(`${role.label}: the Contacts toolbar buttons match the grants`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    try {
      const slot = await open(page, '/contacts', 'contacts')
      await expect(slot.locator('input').first(), 'the Customers tab rendered').toBeVisible({ timeout: 30_000 })
      const wantImport = grant(access, 'contacts', 'bulk') && grant(access, 'contacts', 'import') && (grant(access, 'contacts', 'add') || grant(access, 'contacts', 'edit'))
      const wantExport = grant(access, 'contacts', 'export')
      await expect.soft(slot.getByRole('button', { name: text('add_customer', 'Add Customer'), exact: true }), 'Add Customer = contacts:add').toHaveCount(grant(access, 'contacts', 'add') ? 1 : 0, BRIEF)
      const manage = slot.getByRole('button', { name: text('manage', 'Manage'), exact: true })
      await expect.soft(manage, 'Manage = Import or Export (the administrator-only gender restore also lives there)').toHaveCount(wantImport || wantExport ? 1 : 0, BRIEF)
      if ((wantImport || wantExport) && await manage.count()) {
        await manage.click()
        const menu = page.locator('[data-portal-menu-content]').last()
        await expect(menu).toBeVisible()
        // "Restore customer gender" is the administrator-only third entry; its rule is not copied here.
        const shown = (await menu.getByRole('button').allInnerTexts()).map(squash).filter((label) => label !== text('customer_gender_restore', 'Restore customer gender'))
        expect.soft(sorted(shown), 'Contacts Manage menu entries').toEqual(sorted([...(wantImport ? [text('import_contacts', 'Import')] : []), ...(wantExport ? [text('export', 'Export')] : [])]))
        await page.keyboard.press('Escape')
        await expect(menu, 'the Manage menu closed').toBeHidden()
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

async function openProductForm(session: Session, tab?: 'pricing'): Promise<Locator> {
  const { page } = session
  const slot = await open(page, '/products', 'products')
  await slot.getByText(PRODUCT_NAME, { exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: text('edit', 'Edit'), exact: true }).filter({ visible: true }).click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog, 'the product edit form opened').toBeVisible({ timeout: 15_000 })
  await expect(dialog.locator('input').first()).toBeVisible()
  if (tab === 'pricing') {
    // ProductForm.tsx:1495 -- prices and costs are on the Pricing tab, not the first one.
    await dialog.getByRole('button', { name: text('pricing', 'Pricing'), exact: true }).click()
    await expect(dialog.getByTestId('product-pricing-grid'), 'the Pricing tab opened').toBeVisible({ timeout: 15_000 })
  }
  return dialog
}

for (const role of EDITORS) {
  test(`${role.label}: the product edit form offers Delete only with products:delete`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { access } = session
    const wantDelete = grant(access, 'products', 'delete')
    // APP BUG, kept as a case: Products.tsx:5969 hands ProductForm `onDelete` for every selected product and ProductForm.tsx:2302
    // draws the trash button on `isEditMode && onDelete` alone. canRemoveProduct (Products.tsx:1498) only reaches the Conflicts tab.
    // A role that may edit but not delete (the Employee default) is offered Delete, then collects the Worker's 403.
    knownDefect(!wantDelete, 'Products.tsx:5969 passes onDelete to ProductForm with no products:delete check; ProductForm.tsx:2302 shows Delete on onDelete alone')
    try {
      const dialog = await openProductForm(session)
      await expect(dialog.getByRole('button', { name: text('delete', 'Delete'), exact: true }), 'Delete in the product form = products:delete').toHaveCount(wantDelete ? 1 : 0, BRIEF)
    } finally { await session.close() }
  })

  test(`${role.label}: the product edit form locks the selling and wholesale price without products:edit + products:price`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { access } = session
    // utils/productMergePriceAccess.ts canChangeProductPrices: administrator, or edit and price both held.
    const wantEditable = access.isAdmin || (grant(access, 'products', 'edit') && grant(access, 'products', 'price'))
    try {
      const dialog = await openProductForm(session, 'pricing')
      // ProductForm.tsx:2028/2059 -- the selling and wholesale fieldsets are disabled, with the read-only hint as their title.
      const locked = await dialog.locator('fieldset[disabled][title*="change product prices"]').count()
      expect.soft(locked > 0, `price fieldsets locked iff the role may not change prices (${locked} locked)`).toBe(!wantEditable)
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
        // /api/auth/* carries the role's own permission NAMES (product_cost_view, inventory_check_show_cost, ...), which
        // isAcquisitionCostKey rightly matches by name; they are grants, not cost data.
        if (new URL(body.url).pathname.startsWith('/api/auth/')) continue
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
        if (pageId === 'products') await expect(slot.getByText(PRODUCT_NAME).filter({ visible: true }).first(), 'the fixture catalogue rendered').toBeVisible({ timeout: 30_000 })
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
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role, false)
    try {
      const dialog = await openProductForm(session, 'pricing')
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
// written against the definition and flip to ordinary passing tests the day the grant lands -- see `knownDefect(!phoneGrant, ...)`.
// P2.8 masks in the Worker's shared projection, not in the browser, so what this tier can show is only what the page does with
// the number it is sent; the forged-call half is the system-tier lane.
const phoneGrant = PERMISSION_DEFS.find((definition) => /full phone/i.test(definition.label) || /full_phone/.test(definition.key))
const PHONE_FULL = '098765432'
const PHONE_TAIL = '98765432'
const PHONE_MASKED = '098 *** 432'
const digitsOf = (value: string): string => value.replace(/\D/g, '')
const NO_PHONE_GRANT = 'P2.8 (claude/p28-phone-permission-20261102, contacts_full_phone) is not in rc/20261104a: no "See full phone numbers" grant exists in permissionDefinitions.ts, so every role is sent full numbers'

test('the permission catalogue defines a "See full phone numbers" grant, off in every non-admin role', () => {
  knownDefect(!phoneGrant, NO_PHONE_GRANT)
  expect(phoneGrant, 'a "See full phone numbers" grant in permissionDefinitions.ts').toBeDefined()
  for (const role of ROLES.filter((entry) => entry.id !== 'admin')) {
    expect(role.grants[phoneGrant?.key ?? ''], `${role.label} does not hold ${phoneGrant?.key}`).not.toBe(true)
  }
})

for (const role of ROLES.filter((entry) => { const access = accessFor(entry); return access.canAccessPage('sales') && grant(access, 'sales', 'view') })) {
  test(`${role.label}: a customer's full phone number is shown on a sale only to a role holding the full-phone grant`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000)
    const session = await begin(browser, testInfo.project.name, role)
    const { page, access } = session
    const mayReadFull = access.isAdmin || (!!phoneGrant && access.hasPermission(phoneGrant.key))
    // What the Worker sends this role: the masked form once the grant exists and the role lacks it; at the base, the raw
    // `s.*` row (routes/sales.ts GET /api/sales) to everybody.
    const sent = phoneGrant && !mayReadFull ? PHONE_MASKED : PHONE_FULL
    knownDefect(!mayReadFull && !phoneGrant, NO_PHONE_GRANT)
    try {
      await page.route(/\/api\/sales(\/search)?(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const response = await route.fetch()
        const rows = await response.json() as Array<Record<string, unknown>>
        return route.fulfill({ response, json: rows.map((row, index) => (index === 0 ? { ...row, customer_id: 5001, customer_name: 'E2E Phone Customer', customer_phone: sent } : row)) })
      })
      const slot = await open(page, '/sales', 'sales')
      await expect(slot.getByText(SALE_RECEIPT).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
      await openFixtureSale(slot, testInfo.project.name)
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
