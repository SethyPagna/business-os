import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, DEVICE_SETTINGS_KEY, collectPageHealth, expectNoRuntimeErrors, seedDeviceSettings } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * website-editor.spec.ts -- the Website Editor round trip (AB-F; EDITOR-REDESIGN-FINAL E2E-4, E2E-5, AF-3, AF-9)
 * and the ED-0 editor fixes (E2E-2, E2E-6, E2E-11, E2E-12; E2E-15 = collectPageHealth clean in each).
 *
 * The fixture storefront config never echoes a save, exactly like the live
 * Worker for the settings it does not publish, so the only source of the
 * stored values after a reload is the staff settings read (the scope below).
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test website-editor
 */

// Service workers are blocked so page.route sees every request, the multipart upload included.
test.use({ serviceWorkers: 'block' })

const POSTER_FILE = fileURLToPath(new URL('./fixtures/about-poster.png', import.meta.url))
const POSTER = readFileSync(POSTER_FILE)
const POSTER_UPLOAD = '/uploads/about-poster-e2e.png'
const POSTER_STORED = `${POSTER_UPLOAD}?v=e2e1`
const SAVE_DELAY_MS = 1_500
const BROADCAST_RELOAD_SETTLE_MS = 2_500
const FILE_CHOOSER_ATTEMPT_MS = 3_000
/** frontend/src/utils/standaloneNavigation.ts IOS_INSTALL_HINT_DISMISSED_KEY */
const IOS_INSTALL_HINT_DISMISSED_KEY = `${DEVICE_SETTINGS_KEY}:ios-install-hint-dismissed-at-v1`

type SettingsWrite = Record<string, unknown>

type EditorOptions = { seed?: SettingsWrite; language?: 'en' | 'km' }

async function openEditor(page: Page, context: BrowserContext, { seed = {}, language = 'en' }: EditorOptions = {}): Promise<string> {
  const scope = randomUUID()
  const seeded = await context.request.post(`${ADMIN_ORIGIN}/__e2e/settings?scope=${scope}`, { data: seed })
  expect(seeded.ok(), 'the fixture server takes the settings scope').toBe(true)
  await context.addCookies([{ name: 'e2e_settings_scope', value: scope, url: ADMIN_ORIGIN }])
  // An owner who already snoozed the iOS install hint: on ios-webkit it covers the editor's lower buttons.
  await context.addInitScript(({ key, origin }) => {
    if (window.location.origin !== origin) return
    try { window.localStorage.setItem(key, String(Date.now())) } catch { /* blocked storage */ }
  }, { key: IOS_INSTALL_HINT_DISMISSED_KEY, origin: ADMIN_ORIGIN })
  await page.route('**/api/files/upload', (route) => route.fulfill({
    json: { public_path: POSTER_UPLOAD, processing_status: 'ready', cache_version: 'e2e1' },
  }))
  await page.route(`**${POSTER_UPLOAD}*`, (route) => route.fulfill({ body: POSTER, contentType: 'image/png' }))
  await signIn(page, E2E_ACCOUNTS.cashierA)
  if (language !== 'en') await seedDeviceSettings(context, ADMIN_ORIGIN, { language })
  await gotoAdminPage(page, '/catalog')
  await expect(editor(page)).toBeVisible({ timeout: 30_000 })
  return scope
}

const editor = (page: Page): Locator => page.locator('#portal-editor-top')
const saveButton = (page: Page): Locator => editor(page).getByRole('button', { name: 'Save changes' })
const aboutPicture = (page: Page): Locator => page.locator('[data-testid="portal-about-image-field"]')

async function openSection(page: Page, label: string): Promise<void> {
  await editor(page).getByRole('button', { name: label, exact: true }).first().click()
}

// Clicked from the top of the editor: on ios-webkit, scrolling to the sticky bar
// during the click lost the tap (no request and no toast in the trace).
async function clickSave(page: Page): Promise<void> {
  await editor(page).evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await expect(saveButton(page)).toBeEnabled()
  await saveButton(page).click()
}

async function saveAndCapture(page: Page): Promise<SettingsWrite> {
  const request = page.waitForRequest((candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings')
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings')
  await clickSave(page)
  const body = (await request).postDataJSON() as SettingsWrite
  expect((await response).ok()).toBe(true)
  return body
}

async function storedSettings(page: Page, scope: string): Promise<{ settings: SettingsWrite; writes: SettingsWrite[] }> {
  const response = await page.request.get(`${ADMIN_ORIGIN}/__e2e/settings?scope=${scope}`)
  return response.json()
}

async function uploadAboutPicture(page: Page): Promise<void> {
  await openSection(page, 'About')
  const upload = aboutPicture(page).getByRole('button', { name: 'Upload image' })
  await upload.scrollIntoViewIfNeeded()
  await expect(async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: FILE_CHOOSER_ATTEMPT_MS }),
      upload.click({ timeout: FILE_CHOOSER_ATTEMPT_MS }),
    ])
    await chooser.setFiles(POSTER_FILE)
  }, 'the Upload button opens the file chooser').toPass()
  await expect(aboutPicture(page).locator(`img[src*="${POSTER_UPLOAD}"]`)).toBeVisible()
}

test.describe('Website Editor round trip', () => {
  test('E2E-4: a setting the storefront does not publish survives Save, reload and a second Save', async ({ page, context }) => {
    // CATCHES: the reload rebuilding the draft from the public config alone
    // (the logo size and the badge come back as 80 and on), and the next Save
    // writing those defaults over what the owner stored.
    const scope = await openEditor(page, context)
    await openSection(page, 'About')
    await page.locator('#portal-about-title').fill('Our story')
    await openSection(page, 'Media')
    await page.locator('#portal-logo-size').fill('120')
    await openSection(page, 'Display settings')
    await page.getByLabel('Show top seller badges').uncheck()

    const first = await saveAndCapture(page)
    expect(first.customer_portal_logo_size).toBe('120')
    expect(first.customer_portal_show_top_seller_badge).toBe('false')
    expect(first.customer_portal_about_title).toBe('Our story')

    await page.waitForTimeout(BROADCAST_RELOAD_SETTLE_MS)
    await page.reload({ waitUntil: 'load' })
    await expect(editor(page)).toBeVisible({ timeout: 30_000 })
    await openSection(page, 'Media')
    await expect(page.locator('#portal-logo-size')).toHaveValue('120')
    await openSection(page, 'Display settings')
    await expect(page.getByLabel('Show top seller badges')).not.toBeChecked()
    await openSection(page, 'About')
    await expect(page.locator('#portal-about-title')).toHaveValue('Our story')

    await openSection(page, 'Business details')
    await page.locator('#portal-business-tagline').fill('Second save')
    const second = await saveAndCapture(page)
    expect(second.customer_portal_logo_size, 'never the default 80').toBe('120')
    expect(second.customer_portal_show_top_seller_badge, 'never the default on').toBe('false')
    expect(second.customer_portal_about_title).toBe('Our story')
    const { settings } = await storedSettings(page, scope)
    expect(settings.customer_portal_logo_size).toBe('120')
    expect(settings.customer_portal_show_top_seller_badge).toBe('false')
  })

  test('AF-3: the uploaded About picture is saved as this site\'s upload path and is still there after a reload', async ({ page, context }) => {
    // CATCHES: saving the absolute preview URL (the Worker refuses anything but
    // a /uploads/ path) and a reload that loses the picture.
    const scope = await openEditor(page, context)
    await uploadAboutPicture(page)
    await expect(aboutPicture(page).getByRole('textbox')).toHaveCount(0)
    await page.locator('#portal-about-image-alt').fill('Leang Cosmetics poster')

    const first = await saveAndCapture(page)
    expect(first.customer_portal_about_image).toBe(POSTER_STORED)
    expect(first.customer_portal_about_image_alt).toBe('Leang Cosmetics poster')

    await page.waitForTimeout(BROADCAST_RELOAD_SETTLE_MS)
    await page.reload({ waitUntil: 'load' })
    await expect(editor(page)).toBeVisible({ timeout: 30_000 })
    await openSection(page, 'About')
    await expect(aboutPicture(page).locator(`img[src*="${POSTER_UPLOAD}"]`)).toBeVisible()
    await expect(page.locator('#portal-about-image-alt')).toHaveValue('Leang Cosmetics poster')

    await openSection(page, 'Business details')
    await page.locator('#portal-business-tagline').fill('Second save')
    const second = await saveAndCapture(page)
    expect(second.customer_portal_about_image).toBe(POSTER_STORED)
    const { settings } = await storedSettings(page, scope)
    expect(settings.customer_portal_about_image).toBe(POSTER_STORED)
  })

  test('AF-9: a refused About picture is named under its field and in the toast, and the edit stays unsaved', async ({ page, context }) => {
    // CATCHES: the Worker's invalid_about_image reaching the owner only as a
    // generic "Write rejected" banner, with nothing on the field itself.
    await openEditor(page, context)
    await uploadAboutPicture(page)
    await page.route('**/api/settings', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 400, json: { error: 'The About picture must be a picture uploaded to this site.', code: 'invalid_about_image' } })
      : route.fallback()))
    await clickSave(page)
    const message = 'The About picture must be a picture uploaded to this site. Upload it again.'
    await expect(aboutPicture(page).getByRole('alert')).toHaveText(message)
    await expect(page.getByText(message).first()).toBeVisible()
    await expect(saveButton(page)).toBeEnabled()
  })

  test('E2E-5: text typed while a Save is in flight is still there, and still unsaved, after the Save lands', async ({ page, context }) => {
    // CATCHES: marking the whole draft clean when the write returns, then the
    // settings broadcast reload putting the old tagline back.
    const scope = await openEditor(page, context)
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS))
      return route.fallback()
    })
    await openSection(page, 'Business details')
    await page.locator('#portal-business-tagline').fill('Before the save')
    const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings')
    let saveLanded = false
    void response.then(() => { saveLanded = true })
    await clickSave(page)
    await page.locator('#portal-business-tagline').fill('Typed while saving')
    expect(saveLanded, 'the text was typed while the Save was still in flight').toBe(false)
    expect((await response).ok()).toBe(true)

    await page.waitForTimeout(BROADCAST_RELOAD_SETTLE_MS)
    await expect(page.locator('#portal-business-tagline')).toHaveValue('Typed while saving')
    await expect(saveButton(page)).toBeEnabled()
    const { writes } = await storedSettings(page, scope)
    expect(writes.at(-1)?.customer_portal_business_tagline).toBe('Before the save')

    const next = await saveAndCapture(page)
    expect(next.customer_portal_business_tagline).toBe('Typed while saving')
  })
})

const DESKTOP_PROJECT = 'desktop-chromium'
const PREVIEW_GRID_WIDTH = { width: 1280, height: 800 }

async function openSectionByKey(page: Page, key: string): Promise<void> {
  await editor(page).locator(`[data-editor-section="${key}"]`).click()
}

async function chooseOption(page: Page, select: Locator, option: string): Promise<void> {
  await select.scrollIntoViewIfNeeded()
  await select.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

const guardDialog = (page: Page): Locator => page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'Unsaved work on this page' }) })

test.describe('Website Editor fixes (ED-0)', () => {
  test('E2E-2: leaving with an unsaved change asks first, and Discard and leave drops it', async ({ page, context }, testInfo) => {
    // CATCHES: the editor missing from the dirty-work registry -- a sidebar
    // click used to leave at once and the typed shop name was gone.
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, 'the phone bar opens section groups instead of navigating (ios-layout.spec.ts); the guard is the same AppContext code')
    const health = collectPageHealth(page)
    await openEditor(page, context, { seed: { business_name: 'Stored Shop' } })
    await openSection(page, 'Business details')
    const name = page.locator('#portal-business-name')
    await expect(name).toHaveValue('Stored Shop')
    await name.fill('Discarded name')

    const posLink = page.locator('[data-bos-nav-id="pos"]:visible').first()
    await posLink.click()
    await expect(guardDialog(page)).toBeVisible()
    await expect(guardDialog(page).getByRole('listitem')).toHaveText(['Website Editor'])
    await expect(guardDialog(page).getByRole('button', { name: 'Save & Leave' })).toBeVisible()
    await guardDialog(page).getByRole('button', { name: 'Stay' }).click()
    await expect(name).toHaveValue('Discarded name')

    await posLink.click()
    await guardDialog(page).getByRole('button', { name: 'Discard & Leave' }).click()
    await expect(page).toHaveURL(/\/pos(?:[/?#]|$)/)
    await page.locator('[data-bos-nav-id="catalog"]:visible').first().click()
    await expect(guardDialog(page)).toHaveCount(0)
    await expect(editor(page)).toBeVisible()
    await openSection(page, 'Business details')
    await expect(name, 'the discarded edit is gone when the owner comes back').toHaveValue('Stored Shop')
    expectNoRuntimeErrors(health)
  })

  test('E2E-2: closing the tab with an unsaved change raises the browser prompt', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name === 'ios-webkit', 'iOS Safari never shows a beforeunload prompt (AppContext.tsx beforeunload note)')
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await openSection(page, 'Business details')
    await page.locator('#portal-business-name').fill('Unsaved name')
    expectNoRuntimeErrors(health)
    const prompt = page.waitForEvent('dialog')
    void page.close({ runBeforeUnload: true })
    const dialog = await prompt
    expect(dialog.type()).toBe('beforeunload')
    await dialog.accept()
  })

  test('E2E-6: a Khmer editor labels its own fields in Khmer, never with the storefront wording', async ({ page, context }) => {
    // CATCHES: copy() asking the storefront Khmer pack first, which labelled
    // the About title field អំពីយើង ("About us") and the default language ភាសាដើម.
    const health = collectPageHealth(page)
    await openEditor(page, context, { language: 'km' })
    await openSectionByKey(page, 'about')
    await expect(page.locator('label[for="portal-about-title"]')).toHaveText('ចំណងជើង')
    await expect(page.locator('#portal-section-about').getByText('ទំព័រផលិតផល', { exact: true })).toBeVisible()
    await expect(page.locator('label[for="portal-product-caution-default"]')).toHaveText('ការប្រុងប្រយ័ត្ន')
    await openSectionByKey(page, 'faq')
    await expect(page.locator('label[for="portal-faq-title"]')).toHaveText('ចំណងជើង')
    await openSectionByKey(page, 'branding')
    await page.locator('#portal-language').click()
    await expect(page.getByRole('option').first()).toHaveText('អង់គ្លេស (លំនាំដើម)')
    await page.keyboard.press('Escape')
    await openSectionByKey(page, 'media')
    await expect(page.locator('#portal-section-media').getByText('Business OS')).toHaveCount(0)
    expectNoRuntimeErrors(health)
  })

  test('E2E-11: computer columns stop at 8 in the input, the preview and the Save; a stored 1 phone column shows 2 and is sent back as 1', async ({ page, context }, testInfo) => {
    // CATCHES: max="10" -- the preview showed 9 or 10 columns the shop never
    // shows -- and the phone input offering 1, which the shop renders as 2.
    const desktop = testInfo.project.name === DESKTOP_PROJECT
    if (desktop) await page.setViewportSize(PREVIEW_GRID_WIDTH)
    const health = collectPageHealth(page)
    await openEditor(page, context, { seed: { customer_portal_grid_columns_mobile: '1', customer_portal_grid_columns_desktop: '4' } })
    await openSection(page, 'Display settings')
    const computerColumns = page.locator('#portal-grid-desktop')
    await computerColumns.fill('10')
    await expect(computerColumns).toHaveValue('8')
    await expect(page.locator('#portal-grid-mobile')).toHaveValue('2')
    if (desktop) {
      const grid = page.locator('article[data-product-card="true"]').first().locator('xpath=..')
      await expect.poll(() => grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), { message: 'the preview grid at 1280 px' }).toBe(8)
    }
    const saved = await saveAndCapture(page)
    expect(saved.customer_portal_grid_columns_desktop).toBe('8')
    expect(saved.customer_portal_grid_columns_mobile, 'the untouched stored value round-trips').toBe('1')
    expectNoRuntimeErrors(health)
  })

  test('E2E-12: a new post gets a web link and a product link, and the Save carries both', async ({ page, context }) => {
    // CATCHES: the link type read back from empty data, so a new card never
    // showed a link field, and two writes from one render keeping only the
    // product name.
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await openSection(page, 'Display settings')
    const addCard = editor(page).getByRole('button', { name: 'Add promotion card' })
    await addCard.click()
    await chooseOption(page, editor(page).locator('[id^="portal-promo-link-type-"]').nth(0), 'A custom link')
    const webLink = editor(page).locator('input[id^="portal-promo-link-"]:not([id^="portal-promo-link-type-"])').nth(0)
    await expect(webLink).toBeEnabled()
    await webLink.fill('https://example.test/sale')

    await addCard.click()
    await chooseOption(page, editor(page).locator('[id^="portal-promo-link-type-"]').nth(1), 'A product')
    const picker = editor(page).locator('[id^="portal-promo-product-"]').nth(1)
    await picker.scrollIntoViewIfNeeded()
    await picker.click()
    const product = page.getByRole('option').nth(1)
    await expect(product).toBeVisible()
    const productName = String(await product.textContent()).trim()
    await product.click()
    await expect(editor(page).locator('input[id^="portal-promo-link-"]:not([id^="portal-promo-link-type-"])').nth(1)).toBeDisabled()

    const saved = await saveAndCapture(page)
    const cards = JSON.parse(String(saved.customer_portal_promo_items)) as Array<Record<string, unknown>>
    expect(cards[0].linkUrl).toBe('https://example.test/sale')
    expect(cards[1].linkProductName).toBe(productName)
    expect(Number(cards[1].linkProductId), 'the product id is saved with its name').toBeGreaterThan(0)
    expectNoRuntimeErrors(health)
  })
})
