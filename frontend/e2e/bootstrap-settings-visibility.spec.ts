import { expect, test, type Browser, type Page } from '@playwright/test'
import { PROJECT_CONTEXT_USE } from '../playwright.config'
import { collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, gotoAdminPage, signIn, type E2EAccount } from './support/session'

/**
 * bootstrap-settings-visibility.spec.ts -- 6.0.1040 (P0.2), "verify first" for cherry-pick 9a3e0394b.
 *
 * GET /api/auth/bootstrap used to hand every account the Settings-only rows (telegram_*, drive_sync_*,
 * audit_log_retention_days); it now hands them to accounts with Settings access alone, as GET /api/settings always did.
 * The claim behind shipping it with no frontend change: no screen outside Settings reads those rows, so a signed-in
 * account without Settings access renders exactly the same. This spec proves it in a browser, on the built app, for the
 * two files the plan names with a visible surface:
 *
 *   NotificationCenter.tsx  the bell: badge, summary line, rows (the Worker's own `system` section shape included)
 *   CatalogPage.tsx / CatalogEditorSurface.tsx  the Website Editor: every field's value (or where /catalog sends the account)
 *
 * One account is signed in five times in fresh contexts, differing only in the bootstrap response:
 *   with-rows              the 05ef61b73 payload: the Settings-only rows ride in bootstrap.settings
 *   without-rows           the 6.0.1040 payload: they do not
 *   khmer                  CONTROL: `language: km` in bootstrap and /api/settings, a row both surfaces DO read
 *   bell-off               CONTROL: notifications_inventory_enabled=false in both, a row the bell reads (its "On" switch)
 *   bell-off-in-bootstrap  CONTROL: the same row in the bootstrap alone must reach the bell the same way, proving the
 *                          path the Settings-only rows used to travel is live
 * with-rows and without-rows must render identically; the controls must differ, or "identical" proves nothing.
 *
 * Accounts: the seeded Employee preset (bell yes, Website Editor no: /catalog shows its first page instead) and a
 * customer_portal holder with no Settings access (bell yes, Website Editor renders). The files that only name a
 * look-alike (storagePolicy.ts: a localStorage cooldown key; entityRecords.ts: audit-record labels) are pinned by
 * tests/bootstrapSettingsReaders.test.ts.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test bootstrap-settings-visibility
 */

test.use({ serviceWorkers: 'block' })

/** Synthetic values; the keys are lib/settingsVisibility.ts SETTINGS_ONLY_KEY_PREFIXES / SETTINGS_ONLY_KEYS. */
const WITHHELD_ROWS: Record<string, string> = {
  telegram_chat_id: '-1001234567890',
  telegram_topic_sales: '12',
  telegram_topic_shift: '7',
  telegram_automation_enabled: 'true',
  telegram_language: 'en',
  telegram_returns_enabled: 'true',
  telegram_summary_sales_enabled: 'true',
  audit_log_retention_days: '30',
  drive_sync_enabled: 'true',
  drive_sync_folder_name: 'BOS Backups',
  drive_sync_account_email: 'owner@example.test',
}
const WITHHELD_KEYS = Object.keys(WITHHELD_ROWS).sort()

/** routes/notifications.ts: the inventory section (buildInventorySection) and the system section (buildSystemSection). */
const NOTIFICATION_SUMMARY = {
  unreadCount: 3,
  unread: 3,
  generatedAt: '2026-11-02T00:00:00.000Z',
  preferences: {},
  sections: [
    {
      id: 'inventory', label: 'Inventory', pageId: 'inventory', count: 2, summary: '1 out of stock • 1 low stock', enabledKey: 'notifications_inventory_enabled',
      items: [
        { id: 'out-1', tone: 'danger', label: 'Rose Water Toner', meta: 'Out of stock', kind: 'inventory_out_of_stock', pageId: 'inventory', anchor: 'product-1' },
        { id: 'low-2', tone: 'warning', label: 'Argan Hair Oil', meta: 'Low stock (3)', kind: 'inventory_low_stock', pageId: 'inventory', anchor: 'product-2' },
      ],
    },
    {
      id: 'system', label: 'System', pageId: 'backup', count: 1, summary: 'Google Drive backup needs attention', enabledKey: 'notifications_system_enabled',
      items: [{
        id: 'system-drive-sync', tone: 'warning', label: 'Google Drive backup is NOT connected',
        meta: 'Only the R2 copies exist. Open Backup settings and connect Google Drive to start the off-site mirror (keeps the last 10).',
        kind: 'system_drive_sync_connect', pageId: 'backup',
      }],
    },
  ],
}

type Variant = 'with-rows' | 'without-rows' | 'khmer' | 'bell-off' | 'bell-off-in-bootstrap'

type Snapshot = {
  /** The path after opening /catalog (the app keeps the URL when it shows the Employee its first page instead). */
  catalogPath: string
  /** Keys the page's bootstrap response carried that only the Settings screen reads. */
  delivered: string[]
  bellBadge: string
  bellPanel: string
  /** Visible text of the signed-in shell after opening /catalog. */
  catalogText: string
  /** label=value of every field on the page after opening /catalog (editor fields start with customer_portal_). */
  catalogFields: string[]
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

async function routeJson(page: Page, variant: Variant, delivered: Set<string>): Promise<void> {
  const settingsFor = (settings: Record<string, string>): Record<string, string> => {
    if (variant === 'khmer') return { ...settings, language: 'km' }
    if (variant === 'bell-off') return { ...settings, notifications_inventory_enabled: 'false' }
    return settings
  }
  const bootstrapOnly = (settings: Record<string, string>): Record<string, string> => (variant === 'bell-off-in-bootstrap' ? { ...settings, notifications_inventory_enabled: 'false' } : settings)
  await page.route('**/api/auth/bootstrap', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as { settings?: Record<string, string> }
    const settings = bootstrapOnly(settingsFor({ ...(body.settings || {}), ...(variant === 'with-rows' ? WITHHELD_ROWS : {}) }))
    for (const key of Object.keys(settings)) if (key in WITHHELD_ROWS) delivered.add(key)
    await route.fulfill({ response, json: { ...body, settings } })
  })
  // GET /api/settings has always filtered those rows for these accounts.
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const body = await response.json() as Record<string, string>
    const filtered = Object.fromEntries(Object.entries(body).filter(([key]) => !(key in WITHHELD_ROWS)))
    return route.fulfill({ response, json: settingsFor(filtered) })
  })
  await page.route('**/api/notifications/summary', (route) => route.fulfill({ json: NOTIFICATION_SUMMARY }))
}

async function openBell(page: Page): Promise<{ badge: string; panel: string }> {
  const bell = page.getByRole('button', { name: /^Notifications$|^ការជូនដំណឹង$/ })
  await expect(bell).toBeVisible({ timeout: 30_000 })
  const badge = squash(await bell.innerText())
  await bell.click()
  const search = page.locator('input[type="search"][aria-label]').first()
  await expect(search).toBeVisible({ timeout: 15_000 })
  const panel = search.locator('xpath=ancestor::div[contains(@class, "fixed")][1]')
  await expect(panel.getByText(/Rose Water Toner/)).toBeVisible({ timeout: 15_000 })
  // Each section's "On" switch is its notifications_*_enabled preference, read from the settings map.
  const switches = await panel.locator('input[type="checkbox"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).checked))
  const text = `${squash(await panel.innerText())} | switches on: ${switches.join(',')}`
  await bell.click()
  await expect(panel).toBeHidden()
  return { badge, panel: text }
}

async function openCatalog(page: Page, canEdit: boolean): Promise<{ path: string; text: string; fields: string[] }> {
  await gotoAdminPage(page, '/catalog')
  const editor = page.locator('#portal-editor-top')
  if (canEdit) await expect(editor).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1_500)
  if (!canEdit) await expect(editor, 'an Employee never gets the Website Editor').toHaveCount(0)
  const fields = await page.locator(`${APP_ROOT} input:not([type="file"]), ${APP_ROOT} textarea, ${APP_ROOT} select`).evaluateAll((nodes) => (
    nodes.map((node) => {
      const field = node as HTMLInputElement
      // bo_field_<n> is a per-render counter the shell gives unnamed fields; only the multiset of values is meaningful.
      const label = (field.name || field.id || field.getAttribute('aria-label') || field.placeholder || field.type).replace(/^bo_field_\d+$/, 'bo_field')
      return `${label}=${field.type === 'checkbox' || field.type === 'radio' ? String(field.checked) : field.value}`
    }).sort()
  ))
  await page.waitForTimeout(1_000)
  return { path: new URL(page.url()).pathname, text: squash(await page.locator(APP_ROOT).innerText()), fields }
}

async function journey(browser: Browser, projectName: string, account: E2EAccount, variant: Variant): Promise<Snapshot> {
  const options = PROJECT_CONTEXT_USE[projectName as keyof typeof PROJECT_CONTEXT_USE]
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' })
  try {
    const page = await context.newPage()
    const health = collectPageHealth(page)
    const delivered = new Set<string>()
    await routeJson(page, variant, delivered)
    await signIn(page, account)
    const bell = await openBell(page)
    const catalog = await openCatalog(page, account === E2E_ACCOUNTS.webmaster)
    expectNoRuntimeErrors(health)
    return { catalogPath: catalog.path, delivered: [...delivered].sort(), bellBadge: bell.badge, bellPanel: bell.panel, catalogText: catalog.text, catalogFields: catalog.fields }
  } finally {
    await context.close()
  }
}

for (const account of [E2E_ACCOUNTS.employee, E2E_ACCOUNTS.webmaster]) {
  test(`${account.username}: the bell and the Website Editor render the same with or without the Settings-only rows in bootstrap`, async ({ browser }, testInfo) => {
    test.setTimeout(420_000)
    const withRows = await journey(browser, testInfo.project.name, account, 'with-rows')
    const withoutRows = await journey(browser, testInfo.project.name, account, 'without-rows')
    const control = await journey(browser, testInfo.project.name, account, 'khmer')
    const bellOff = await journey(browser, testInfo.project.name, account, 'bell-off')
    const bellOffInBootstrap = await journey(browser, testInfo.project.name, account, 'bell-off-in-bootstrap')

    expect(withRows.delivered, 'the 05ef61b73 payload really delivered every Settings-only row to the app').toEqual(WITHHELD_KEYS)
    expect(withoutRows.delivered, 'the 6.0.1040 payload delivers none').toEqual([])

    expect(withoutRows.bellPanel, 'the bell lists the inventory and system rows').toContain('Argan Hair Oil')
    expect(withoutRows.bellBadge, 'the bell badge').toBe(withRows.bellBadge)
    expect(withoutRows.bellPanel, 'the bell panel').toBe(withRows.bellPanel)
    expect(withoutRows.catalogPath, 'where /catalog leaves the account').toBe(withRows.catalogPath)
    expect(withoutRows.catalogFields, 'the Website Editor fields').toEqual(withRows.catalogFields)
    expect(withoutRows.catalogText, 'the Website Editor page text').toBe(withRows.catalogText)

    const editorFields = withoutRows.catalogFields.filter((field) => field.startsWith('customer_portal_'))
    if (account === E2E_ACCOUNTS.webmaster) expect(editorFields.length, 'the editor really rendered its fields').toBeGreaterThan(5)
    else expect(editorFields, 'the Employee never sees an editor field, with or without the rows').toEqual([])

    expect(control.bellPanel, 'CONTROL: a row the surfaces read (language) does change the bell').not.toBe(withoutRows.bellPanel)
    expect(control.catalogText, 'CONTROL: and the editor page').not.toBe(withoutRows.catalogText)
    expect(bellOff.bellPanel, 'CONTROL: the bell honours a row it reads (notifications_inventory_enabled=false)').not.toBe(withoutRows.bellPanel)
    expect(bellOff.bellPanel, 'CONTROL: ... by switching the Inventory section off').toContain('switches on: false,true')
    expect(withoutRows.bellPanel, 'both sections are on by default').toContain('switches on: true,true')
    // The path the Settings-only rows used to travel is live: right after sign-in the app's settings ARE the bootstrap
    // map (GET /api/settings has not replaced it), so a row only the bootstrap carries drives the bell exactly as one
    // from /api/settings. That is why the identical renders above are evidence and not an accident of a refetch.
    expect(bellOffInBootstrap.bellPanel, 'CONTROL: a row only the bootstrap carries reaches the bell').toBe(bellOff.bellPanel)
  })
}
