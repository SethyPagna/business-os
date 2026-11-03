import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, DEVICE_SETTINGS_KEY, collectPageHealth, expectNoRuntimeErrors, seedDeviceSettings } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * website-editor.spec.ts -- the Website Editor round trip (AB-F; EDITOR-REDESIGN-FINAL E2E-4, E2E-5, AF-3, AF-9),
 * the ED-0 editor fixes (E2E-2, E2E-6, E2E-11, E2E-12; E2E-15 = collectPageHealth clean in each)
 * and the ED-1a bar (E2E-1 bar part, E2E-3, E2E-13: EDITOR-REDESIGN-REFRESH section C).
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
// The bar's Save: its name is Save, Saving or Saved by state ("Saving" does not contain "Save", so a plain name match loses it
// mid-write). Scoped to the bar so the review dialog's own Save button, which renders inside the aside, never makes it ambiguous.
const saveButton = (page: Page): Locator => page.locator('#portal-editor-bar').getByRole('button', { name: /^Sav(?:e|ing|ed)$/ })
const statusLine = (page: Page): Locator => editor(page).locator('#portal-editor-status')
const reviewDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Save these changes?' })
const aboutPicture = (page: Page): Locator => page.locator('[data-testid="portal-about-image-field"]')

// A section by its id (shop, contact, products, posts, about, faq, features): through the picker below 768 px, the chips from 768 px.
async function openSection(page: Page, id: string): Promise<void> {
  const picker = editor(page).locator('button[aria-haspopup="menu"]')
  if (await picker.isVisible()) {
    await picker.click()
    await editor(page).locator(`[role="menuitemradio"][data-editor-section="${id}"]`).click()
  } else {
    await editor(page).locator(`[role="tab"][data-editor-section="${id}"]`).click()
  }
  await expect(page.locator(`#portal-section-${id}`)).toBeVisible()
}

// Waits until the element stops moving. Scrolling a far field into view also slides the app's top header away, and a tap aimed before that
// has finished lands on the field's neighbour (on WebKit it opened a help popover instead of the language list).
async function settled(locator: Locator): Promise<void> {
  await expect.poll(async () => {
    const top = async () => Math.round((await locator.boundingBox())!.y)
    const first = await top()
    await locator.page().waitForTimeout(200)
    return first === await top()
  }, { message: 'the field has stopped moving' }).toBe(true)
}

// Save opens the review ("Save these changes?"); the write happens when it is confirmed.
async function confirmReview(page: Page): Promise<void> {
  await expect(reviewDialog(page)).toBeVisible()
  await reviewDialog(page).getByRole('button', { name: 'Save', exact: true }).click()
}

// Clicked from the top of the editor: on ios-webkit, scrolling to the sticky bar
// during the click lost the tap (no request and no toast in the trace). Includes the review's Save.
async function clickSave(page: Page): Promise<void> {
  await editor(page).evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await expect(saveButton(page)).toBeEnabled()
  // Scrolling to the top also slides the app header away and the sticky bar with it: a tap aimed before that stops is lost (one full ios run lost
  // the second Save of E2E-5, the review never opened; the same test passed 4 of 4 alone).
  await settled(saveButton(page))
  await saveButton(page).click()
  await confirmReview(page)
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
  await openSection(page, 'about')
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
    await openSection(page, 'about')
    await page.locator('#portal-about-title').fill('Our story')
    await openSection(page, 'shop')
    await page.locator('#portal-logo-size').fill('120')
    await openSection(page, 'products')
    await page.getByLabel('Show top seller badges').uncheck()

    const first = await saveAndCapture(page)
    expect(first.customer_portal_logo_size).toBe('120')
    expect(first.customer_portal_show_top_seller_badge).toBe('false')
    expect(first.customer_portal_about_title).toBe('Our story')

    await page.waitForTimeout(BROADCAST_RELOAD_SETTLE_MS)
    await page.reload({ waitUntil: 'load' })
    await expect(editor(page)).toBeVisible({ timeout: 30_000 })
    await openSection(page, 'shop')
    await expect(page.locator('#portal-logo-size')).toHaveValue('120')
    await openSection(page, 'products')
    await expect(page.getByLabel('Show top seller badges')).not.toBeChecked()
    await openSection(page, 'about')
    await expect(page.locator('#portal-about-title')).toHaveValue('Our story')

    await openSection(page, 'shop')
    await page.locator('#portal-business-tagline').fill('Second save')
    const second = await saveAndCapture(page)
    // A Save sends only the keys that differ from the settings this tab holds (AppContext.saveSettings -> sendChangedSettings), so
    // an untouched stored value is absent from the second POST. What must never happen is the default riding in its place.
    expect(second.customer_portal_logo_size ?? '120', 'never the default 80').toBe('120')
    expect(second.customer_portal_show_top_seller_badge ?? 'false', 'never the default on').toBe('false')
    expect(second.customer_portal_about_title ?? 'Our story').toBe('Our story')
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
    await openSection(page, 'about')
    await expect(aboutPicture(page).locator(`img[src*="${POSTER_UPLOAD}"]`)).toBeVisible()
    await expect(page.locator('#portal-about-image-alt')).toHaveValue('Leang Cosmetics poster')

    await openSection(page, 'shop')
    await page.locator('#portal-business-tagline').fill('Second save')
    const second = await saveAndCapture(page)
    expect(second.customer_portal_about_image ?? POSTER_STORED, 'untouched, so absent or unchanged; never the preview URL').toBe(POSTER_STORED)
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
    // Held until the text has been typed: a timed delay raced the review's extra click on a slow WebKit (the Save landed first).
    let releaseWrite = () => {}
    const writeHeld = new Promise<void>((resolve) => { releaseWrite = resolve })
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await writeHeld
      return route.fallback()
    })
    await openSection(page, 'shop')
    await page.locator('#portal-business-tagline').fill('Before the save')
    const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings')
    let saveLanded = false
    void response.then(() => { saveLanded = true })
    await clickSave(page)
    await page.locator('#portal-business-tagline').fill('Typed while saving')
    expect(saveLanded, 'the text was typed while the Save was still in flight').toBe(false)
    releaseWrite()
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

async function chooseOption(page: Page, select: Locator, option: string): Promise<void> {
  await select.scrollIntoViewIfNeeded()
  await settled(select)
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
    await openSection(page, 'shop')
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
    await openSection(page, 'shop')
    await expect(name, 'the discarded edit is gone when the owner comes back').toHaveValue('Stored Shop')
    expectNoRuntimeErrors(health)
  })

  test('E2E-2: closing the tab with an unsaved change raises the browser prompt', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name === 'ios-webkit', 'iOS Safari never shows a beforeunload prompt (AppContext.tsx beforeunload note)')
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await openSection(page, 'shop')
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
    await openSection(page, 'about')
    await expect(page.locator('label[for="portal-about-title"]')).toHaveText('ចំណងជើង')
    await openSection(page, 'products')
    await expect(page.locator('#portal-section-products').getByText('ទំព័រផលិតផល', { exact: true })).toBeVisible()
    await expect(page.locator('label[for="portal-product-caution-default"]')).toHaveText('ការប្រុងប្រយ័ត្ន')
    await openSection(page, 'faq')
    await expect(page.locator('label[for="portal-faq-title"]')).toHaveText('ចំណងជើង')
    await openSection(page, 'features')
    await page.locator('#portal-language').scrollIntoViewIfNeeded()
    await settled(page.locator('#portal-language'))
    await page.locator('#portal-language').click()
    await expect(page.getByRole('option').first()).toHaveText('អង់គ្លេស (លំនាំដើម)')
    await page.keyboard.press('Escape')
    await openSection(page, 'shop')
    await expect(page.locator('#portal-section-shop').getByText('Business OS')).toHaveCount(0)
    expectNoRuntimeErrors(health)
  })

  test('E2E-11: with automatic columns off, computer columns stop at 8 in the input, the preview and the Save; a stored 1 phone column shows 2 and is sent back as 1', async ({ page, context }, testInfo) => {
    // CATCHES: max="10" -- the preview showed 9 or 10 columns the shop never
    // shows -- and the phone input offering 1, which the shop renders as 2.
    const desktop = testInfo.project.name === DESKTOP_PROJECT
    if (desktop) await page.setViewportSize(PREVIEW_GRID_WIDTH)
    const health = collectPageHealth(page)
    await openEditor(page, context, { seed: { customer_portal_grid_columns_auto: 'false', customer_portal_grid_columns_mobile: '1', customer_portal_grid_columns_desktop: '4' } })
    await openSection(page, 'products')
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
    expect(saved.customer_portal_grid_columns_mobile ?? '1', 'the untouched stored 1 is never rewritten as the 2 the input shows (a Save sends only changed keys)').toBe('1')
    expect(saved.customer_portal_grid_columns_auto ?? 'false', 'the switch stays off').toBe('false')
    expectNoRuntimeErrors(health)
  })

  test('E2E-11b: automatic columns are on by default, grey out the fixed counts, drive the preview, and turning them off frees the inputs', async ({ page, context }, testInfo) => {
    // CATCHES: a column input that still looks editable while it does nothing (the old "looks wired but is not"
    // gap), an unset switch read as off (a stored 2 would keep the old grid), and a Save that drops the switch.
    const desktop = testInfo.project.name === DESKTOP_PROJECT
    if (desktop) await page.setViewportSize(PREVIEW_GRID_WIDTH)
    const health = collectPageHealth(page)
    await openEditor(page, context, { seed: { customer_portal_grid_columns_mobile: '1', customer_portal_grid_columns_desktop: '2' } })
    await openSection(page, 'products')
    const automatic = page.locator('#portal-grid-auto')
    await expect(automatic).toBeChecked()
    await expect(page.locator('#portal-grid-desktop')).toBeDisabled()
    await expect(page.locator('#portal-grid-mobile')).toBeDisabled()
    if (desktop) {
      const grid = page.locator('article[data-product-card="true"]').first().locator('xpath=..')
      await expect.poll(() => grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), { message: 'the preview grid at 1280 px follows the screen, not the stored 2' }).toBe(5)
    }
    await automatic.uncheck()
    await expect(page.locator('#portal-grid-desktop')).toBeEnabled()
    await expect(page.locator('#portal-grid-mobile')).toBeEnabled()
    if (desktop) {
      const grid = page.locator('article[data-product-card="true"]').first().locator('xpath=..')
      await expect.poll(() => grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), { message: 'off: the stored 2 applies again' }).toBe(2)
    }
    const saved = await saveAndCapture(page)
    expect(saved.customer_portal_grid_columns_auto).toBe('false')
    expectNoRuntimeErrors(health)
  })

  test('E2E-11c: announcement bar -- the stored message fills the fields, the preview follows typing and cannot be closed, bad input is flagged, and the Save carries all six', async ({ page, context }) => {
    // CATCHES: a field that does not load what is stored, a preview that ignores typing or draws a close button
    // (the owner could not tell what visitors see), a javascript: link or a reversed range saved without a warning,
    // and a Save that drops one of the six settings.
    const health = collectPageHealth(page)
    await openEditor(page, context, {
      seed: {
        customer_portal_announcement_enabled: 'true',
        customer_portal_announcement_text_en: 'Sample sale',
        customer_portal_announcement_text_km: 'ការលក់',
        customer_portal_announcement_link: 'https://example.test/news',
        customer_portal_announcement_start: '2026-11-10',
        customer_portal_announcement_end: '2026-11-12',
      },
    })
    await openSection(page, 'posts')
    await expect(page.locator('#portal-announcement-enabled')).toBeChecked()
    await expect(page.locator('#portal-announcement-text-en')).toHaveValue('Sample sale')
    await expect(page.locator('#portal-announcement-text-km')).toHaveValue('ការលក់')
    await expect(page.locator('#portal-announcement-link')).toHaveValue('https://example.test/news')
    await expect(page.locator('#portal-announcement-start')).toHaveValue('10/11/2026')
    await expect(page.locator('#portal-announcement-end')).toHaveValue('12/11/2026')

    const preview = page.locator('[data-portal-announcement="true"]')
    await expect(preview).toContainText('Sample sale')
    await expect(preview.locator('button'), 'the preview has no close button').toHaveCount(0)
    await page.locator('#portal-announcement-text-en').fill('Sample sale extended')
    await expect(preview).toContainText('Sample sale extended')

    const link = page.locator('#portal-announcement-link')
    await link.fill('javascript:alert(1)')
    await expect(page.getByTestId('portal-announcement-link-issue')).toBeVisible()
    await expect(preview.locator('a'), 'the preview does not make a link of it').toHaveCount(0)
    await link.fill('https://example.test/new')
    await expect(page.getByTestId('portal-announcement-link-issue')).toHaveCount(0)
    await expect(preview.locator('a[href="https://example.test/new"]')).toHaveCount(1)

    const end = page.locator('#portal-announcement-end')
    await end.fill('01/11/2026')
    await end.press('Tab')
    await expect(page.getByTestId('portal-announcement-range-issue')).toBeVisible()
    await end.fill('12/11/2026')
    await end.press('Tab')
    await expect(page.getByTestId('portal-announcement-range-issue')).toHaveCount(0)

    await page.locator('#portal-announcement-text-km').fill('ការលក់ថ្មី')
    const start = page.locator('#portal-announcement-start')
    await start.fill('11/11/2026')
    await start.press('Tab')
    await end.fill('13/11/2026')
    await end.press('Tab')
    await page.locator('#portal-announcement-enabled').uncheck()
    await expect(preview, 'switched off, the preview bar goes').toHaveCount(0)
    await page.locator('#portal-announcement-enabled').check()
    await expect(preview).toContainText('Sample sale extended')
    await page.locator('#portal-announcement-enabled').uncheck()

    const saved = await saveAndCapture(page)
    expect(saved, 'a Save sends the changed keys; all six changed here').toMatchObject({
      customer_portal_announcement_enabled: 'false',
      customer_portal_announcement_text_en: 'Sample sale extended',
      customer_portal_announcement_text_km: 'ការលក់ថ្មី',
      customer_portal_announcement_link: 'https://example.test/new',
      customer_portal_announcement_start: '2026-11-11',
      customer_portal_announcement_end: '2026-11-13',
    })
    expectNoRuntimeErrors(health)
  })

  test('E2E-11d: announcement bar -- a new bar starts off and empty, clearing a field clears the preview', async ({ page, context }) => {
    // CATCHES: a bar that starts on with nothing to say, a cleared text box that the preview keeps showing (an
    // "||" fallback to the saved value).
    await openEditor(page, context)
    await openSection(page, 'posts')
    await expect(page.locator('#portal-announcement-enabled')).not.toBeChecked()
    await expect(page.locator('#portal-announcement-text-en')).toHaveValue('')
    const preview = page.locator('[data-portal-announcement="true"]')
    await expect(preview).toHaveCount(0)
    await page.locator('#portal-announcement-enabled').check()
    await page.locator('#portal-announcement-text-en').fill('Sample message')
    await expect(preview).toContainText('Sample message')
    await page.locator('#portal-announcement-text-en').fill('')
    await expect(preview, 'cleared text, no bar').toHaveCount(0)
  })

  test('E2E-12: a new post gets a web link and a product link, and the Save carries both', async ({ page, context }) => {
    // CATCHES: the link type read back from empty data, so a new card never
    // showed a link field, and two writes from one render keeping only the
    // product name.
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await openSection(page, 'posts')
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
    await settled(picker)
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

const holdUploads = (page: Page): { release: () => void } => {
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  // Registered after openEditor's own fulfil, so it runs first: the upload stays in flight until released.
  void page.route('**/api/files/upload', async (route) => {
    await held
    await route.fulfill({ json: { public_path: POSTER_UPLOAD, processing_status: 'ready', cache_version: 'e2e1' } })
  })
  return { release }
}

test.describe('Website Editor bar (ED-1a)', () => {
  for (const language of ['en', 'km'] as const) {
    test(`E2E-1: at 320, 360 and 390 px the bar is one row of at most 56 px, nothing scrolls sideways and every control is at least 44 px (${language})`, async ({ page, context }) => {
      // CATCHES: a two-row bar (the old tab strip plus a button grid), a status line that pushes the row taller, Khmer
      // words that widen the picker past the screen, and a control a finger cannot hit.
      const health = collectPageHealth(page)
      await openEditor(page, context, { language })
      for (const width of [320, 360, 390]) {
        await page.setViewportSize({ width, height: 800 })
        const row = page.getByTestId('editor-bar-row')
        await expect(row).toBeVisible()
        await expect(row.locator('button[aria-haspopup="menu"]'), `the picker replaces the chips at ${width} px`).toBeVisible()
        const box = (await row.boundingBox())!
        expect(box.height, `row height at ${width} px`).toBeLessThanOrEqual(56)
        // An edit, so the status line has its words ("Unsaved changes") and Save its dot: the two things the phone bar once lost an edge of.
        await page.locator('#portal-business-tagline').fill(`Bar check ${width}`)
        await expect(statusLine(page)).not.toHaveText('')
        // The aside clips sideways (so the bar can stick); a box that sticks out of it is cut off there, whatever the bar's own box says.
        const aside = (await editor(page).boundingBox())!
        const inside = (name: string, rect: { x: number; width: number }) => {
          expect(rect.x, `${name} starts inside the editor at ${width} px`).toBeGreaterThanOrEqual(aside.x - 0.5)
          expect(rect.x + rect.width, `${name} ends inside the editor at ${width} px`).toBeLessThanOrEqual(aside.x + aside.width + 0.5)
        }
        inside('the bar', (await page.locator('#portal-editor-bar').boundingBox())!)
        inside('the status line', (await statusLine(page).boundingBox())!)
        const buttons = row.locator('button')
        for (let index = 0; index < await buttons.count(); index += 1) {
          const control = (await buttons.nth(index).boundingBox())!
          inside(`control ${index}`, control)
          expect(control.height, `control ${index} height at ${width} px`).toBeGreaterThanOrEqual(43.5)
          expect(control.width, `control ${index} width at ${width} px`).toBeGreaterThanOrEqual(43.5)
          expect(control.y, `control ${index} sits inside the one row`).toBeGreaterThanOrEqual(box.y - 0.5)
          expect(control.y + control.height, `control ${index} sits inside the one row`).toBeLessThanOrEqual(box.y + box.height + 0.5)
        }
        // The bar is full-bleed on a phone (-mx-4), so the aside's own scrollWidth is 16 px wider than its box by design and the
        // aside clips it; what must hold is that neither the document nor the page's scroller moves sideways and the bar stays on screen.
        const overflow = await page.evaluate(() => {
          const scroller = document.querySelector('.page-scroll') as HTMLElement
          const bar = (document.querySelector('#portal-editor-bar') as HTMLElement).getBoundingClientRect()
          return {
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            scroller: scroller.scrollWidth - scroller.clientWidth,
            barLeft: bar.left,
            barRight: bar.right,
            viewport: window.innerWidth,
          }
        })
        expect(overflow.page, `the page does not scroll sideways at ${width} px`).toBeLessThanOrEqual(0)
        expect(overflow.scroller, `the page scroller does not scroll sideways at ${width} px`).toBeLessThanOrEqual(0)
        expect(overflow.barLeft, `the bar starts on screen at ${width} px`).toBeGreaterThanOrEqual(-0.5)
        expect(overflow.barRight, `the bar ends on screen at ${width} px`).toBeLessThanOrEqual(overflow.viewport + 0.5)
        // The open menu is as wide as its longest word: a menu only as wide as the picker button wrapped the Khmer names onto two lines.
        await row.locator('button[aria-haspopup="menu"]').click()
        const heights = await editor(page).getByRole('menuitemradio').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)))
        expect(heights, `seven entries at ${width} px`).toHaveLength(7)
        expect(Math.max(...heights), `every section name fits on one line in the open menu at ${width} px`).toBeLessThanOrEqual(48)
        await page.keyboard.press('Escape')
      }
      expectNoRuntimeErrors(health)
    })
  }

  for (const language of ['en', 'km'] as const) {
    test(`E2E-1: at 320 px the picker keeps its chevron and markers inside its button and clear of Save, on FAQ and on Contact (${language})`, async ({ page, context }) => {
      // CATCHES: a picker label that cannot shrink, so on the narrowest phone (the bar sits 26 px inside the aside) the chevron crossed the
      // button's edge and the blue dot was drawn under Save, which hides the one signal that a section has unsaved work.
      const health = collectPageHealth(page)
      await openEditor(page, context, { language, seed: { business_legal_name: '', business_registration_number: '' } })
      await page.setViewportSize({ width: 320, height: 800 })
      const picker = editor(page).locator('button[aria-haspopup="menu"]')
      await expect(picker).toBeVisible()
      // Save is the last button of the row, whatever language names it.
      const saveInRow = page.getByTestId('editor-bar-row').locator('button').last()
      // Everything the picker draws besides its words: the section icon and the chevron (svg), the blue dot, and for Contact the amber triangle (svg).
      const drawings = picker.locator('svg, span.rounded-full')
      const checkPicker = async (state: string, expectedDrawings: number) => {
        await expect(drawings, `${state}: what the picker draws`).toHaveCount(expectedDrawings)
        const button = (await picker.boundingBox())!
        const save = (await saveInRow.boundingBox())!
        expect(button.x + button.width, `${state}: the picker ends before Save starts`).toBeLessThanOrEqual(save.x + 0.5)
        for (let index = 0; index < expectedDrawings; index += 1) {
          const box = (await drawings.nth(index).boundingBox())!
          expect(box.width, `${state}: drawing ${index} is visible`).toBeGreaterThan(0)
          expect(box.x, `${state}: drawing ${index} starts inside the picker`).toBeGreaterThanOrEqual(button.x - 0.5)
          expect(box.x + box.width, `${state}: drawing ${index} ends inside the picker`).toBeLessThanOrEqual(button.x + button.width + 0.5)
          expect(box.x + box.width, `${state}: drawing ${index} stays clear of Save`).toBeLessThanOrEqual(save.x + 0.5)
        }
        const aside = (await editor(page).boundingBox())!
        expect(button.x + button.width, `${state}: the picker ends inside the editor`).toBeLessThanOrEqual(aside.x + aside.width + 0.5)
      }
      await openSection(page, 'contact')
      await checkPicker('Contact, seller details missing', 3)
      await page.locator('#portal-business-phone').fill('012 345 678')
      await expect(picker).toHaveAccessibleName(/Unsaved changes|មិនទាន់រក្សាទុក/)
      await checkPicker('Contact, unsaved and seller details missing', 4)
      await openSection(page, 'faq')
      await page.locator('#portal-faq-title').fill(language === 'km' ? 'សំណួរដែលគេសួរញឹកញាប់' : 'Questions')
      await checkPicker('FAQ, unsaved', 3)
      expectNoRuntimeErrors(health)
    })
  }

  test('E2E-1: the picker opens a menu of seven radio items at first paint, Escape closes it, and the choice is the next landing', async ({ page, context }) => {
    // CATCHES: a menu that fills in after a prerequisite, a closed menu that loses the keyboard, and a section the
    // editor forgets between visits.
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await page.setViewportSize({ width: 390, height: 800 })
    const picker = editor(page).locator('button[aria-haspopup="menu"]')
    await expect(picker).toHaveAccessibleName('Sections: Shop')
    await picker.click()
    const items = editor(page).getByRole('menuitemradio')
    await expect(items).toHaveCount(7)
    await expect(items.first()).toHaveAttribute('aria-checked', 'true')
    await expect(editor(page).getByRole('menuitemradio', { checked: true })).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(items).toHaveCount(0)
    await expect(picker).toBeFocused()

    await openSection(page, 'faq')
    await expect(picker).toHaveAccessibleName('Sections: FAQ')
    expect(await page.evaluate(() => window.localStorage.getItem('business-os-website-editor-section-v1'))).toBe('faq')
    await page.reload({ waitUntil: 'load' })
    await expect(editor(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#portal-section-faq')).toBeVisible()
    await expect(page.locator('#portal-section-shop')).toBeHidden()
    expectNoRuntimeErrors(health)
  })

  test('E2E-1: a scroll while the picker is open does not close it; the menu follows the button', async ({ page, context }) => {
    // CATCHES: a menu that closes on any scroll event. A scroll event is delivered a frame late, so one from just before the tap (a finger
    // still gliding the page) closed the menu the instant it opened; with a sticky bar the button rarely moves at all.
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await page.setViewportSize({ width: 390, height: 800 })
    const picker = editor(page).locator('button[aria-haspopup="menu"]')
    await picker.click()
    const menu = editor(page).getByRole('menu')
    await expect(menu).toBeVisible()
    await page.locator('.page-scroll').evaluate((node) => { node.scrollTop = 40 })
    await page.waitForTimeout(300)
    await expect(menu, 'a scroll does not close the open menu').toBeVisible()
    const gap = await page.evaluate(() => {
      const button = document.querySelector('#portal-editor-bar button[aria-haspopup="menu"]') as HTMLElement
      const list = document.querySelector('#portal-editor-top [role="menu"]') as HTMLElement
      return list.getBoundingClientRect().top - button.getBoundingClientRect().bottom
    })
    expect(Math.abs(gap - 4), 'and it stays 4 px under the button it belongs to').toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expectNoRuntimeErrors(health)
  })

  test('E2E-1: from 768 px the sections are tabs, the open one shows its word and the arrow keys move between them', async ({ page, context }) => {
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await page.setViewportSize({ width: 1280, height: 800 })
    const tabs = editor(page).getByRole('tablist').getByRole('tab')
    await expect(tabs).toHaveCount(7)
    expect((await page.getByTestId('editor-bar-row').boundingBox())!.height).toBeLessThanOrEqual(52)
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(0)).toHaveText('Shop')
    await expect(tabs.nth(2), 'a closed tab is icon-only').toHaveText('')
    await expect(tabs.nth(2)).toHaveAccessibleName('Products')
    await expect(tabs.nth(2)).toHaveAttribute('title', 'Products')
    await tabs.nth(0).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toBeFocused()
    await expect(page.locator('#portal-section-contact')).toBeVisible()
    await page.keyboard.press('End')
    await expect(page.locator('#portal-section-features')).toBeVisible()
    await page.keyboard.press('Home')
    await expect(page.locator('#portal-section-shop')).toBeVisible()
    expectNoRuntimeErrors(health)
  })

  test('the bar stays in view while the page scrolls under it, in every section', async ({ page, context }) => {
    // CATCHES: a sticky bar inside a scroll container. overflow-x: hidden on the editor's aside made it the sticky scrollport (a
    // box that never scrolls), so the bar scrolled away with the page and Save was out of reach from the middle of a long section.
    const health = collectPageHealth(page)
    await openEditor(page, context)
    for (const id of ['products', 'features']) {
      await openSection(page, id)
      const scrolled = await page.locator('.page-scroll').evaluate((node) => {
        node.scrollTop = 900
        return node.scrollTop
      })
      expect(scrolled, 'the page really scrolled').toBeGreaterThan(300)
      // Pinned to the top of the page scroller (its own top edge, plus sm:top-2): measured against the scroller, not the screen, because
      // a phone's browser chrome can leave the shell a few px off the viewport edge.
      const offset = await page.evaluate(() => {
        const scroller = document.querySelector('.page-scroll') as HTMLElement
        return document.getElementById('portal-editor-bar')!.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      })
      expect(offset, 'the bar is not above the scroller top').toBeGreaterThanOrEqual(-1)
      expect(offset, 'and has not scrolled away with the page').toBeLessThanOrEqual(12)
      await page.locator('.page-scroll').evaluate((node) => { node.scrollTop = 0 })
    }
    expectNoRuntimeErrors(health)
  })

  test('E2E-3: while an upload is held Save is aria-disabled, says why, and still takes keyboard focus; when it lands Save is pressable', async ({ page, context }) => {
    // CATCHES: a Save that quietly works mid-upload (the old path then refused with a toast), a disabled attribute
    // that drops Save out of the tab order, and a reason that only appears on hover.
    const health = collectPageHealth(page)
    await openEditor(page, context)
    const upload = holdUploads(page)
    await openSection(page, 'about')
    const button = aboutPicture(page).getByRole('button', { name: 'Upload image' })
    await button.scrollIntoViewIfNeeded()
    await expect(async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: FILE_CHOOSER_ATTEMPT_MS }),
        button.click({ timeout: FILE_CHOOSER_ATTEMPT_MS }),
      ])
      await chooser.setFiles(POSTER_FILE)
    }, 'the Upload button opens the file chooser').toPass()

    await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(statusLine(page)).toHaveText('Wait for uploads to finish')
    await expect(statusLine(page), 'visible without hovering anything').toBeVisible()
    await expect(saveButton(page)).toHaveAttribute('aria-describedby', 'portal-editor-status')
    await saveButton(page).focus()
    await expect(saveButton(page)).toBeFocused()
    const writes: string[] = []
    page.on('request', (candidate) => { if (candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings') writes.push(candidate.url()) })
    await saveButton(page).press('Enter')
    await expect(reviewDialog(page), 'a press on a blocked Save is ignored').toHaveCount(0)
    expect(writes).toHaveLength(0)

    upload.release()
    await expect(aboutPicture(page).locator(`img[src*="${POSTER_UPLOAD}"]`)).toBeVisible()
    await expect(saveButton(page)).not.toHaveAttribute('aria-disabled', 'true')
    await expect(statusLine(page)).toHaveText('Unsaved changes')
    expectNoRuntimeErrors(health)
  })

  test('E2E-13: Save opens a review that lists Shop and FAQ in order; Cancel writes nothing; Save sends only the changed values', async ({ page, context }) => {
    // CATCHES: a review that lists sections in click order, a Cancel that still writes, and a review that widens or
    // narrows what the Save sends (the payload filter is the one it always was).
    const health = collectPageHealth(page)
    await openEditor(page, context, { seed: { customer_portal_business_tagline: 'Stored tagline', customer_portal_faq_title: 'Stored FAQ' } })
    await openSection(page, 'faq')
    await page.locator('#portal-faq-title').fill('Questions')
    await openSection(page, 'shop')
    await page.locator('#portal-business-tagline').fill('Fresh tagline')
    await expect(statusLine(page)).toHaveText('Unsaved changes')

    const writes: string[] = []
    page.on('request', (candidate) => { if (candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings') writes.push(candidate.url()) })
    await editor(page).evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await saveButton(page).click()
    const dialog = reviewDialog(page)
    await expect(dialog).toBeVisible()
    const rows = dialog.locator('dl > div')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Shop')
    await expect(rows.nth(0)).toContainText('Changes: 1')
    await expect(rows.nth(1)).toContainText('FAQ')
    await expect(rows.nth(1)).toContainText('Changes: 1')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(writes, 'Cancel does nothing').toHaveLength(0)
    await expect(saveButton(page)).not.toHaveAttribute('aria-disabled', 'true')

    const saved = await saveAndCapture(page)
    expect(saved.customer_portal_business_tagline).toBe('Fresh tagline')
    expect(saved.customer_portal_faq_title).toBe('Questions')
    expect(saved, 'the private assistant keys ride only when changed').not.toHaveProperty('customer_portal_ai_prompt')
    expect(saved, 'the private assistant keys ride only when changed').not.toHaveProperty('customer_portal_ai_provider_id')
    expect(writes).toHaveLength(1)
    expectNoRuntimeErrors(health)
  })

  test('the bar walks idle, changed, saving, saved and back to idle; Ctrl+S opens the same review', async ({ page, context }) => {
    const health = collectPageHealth(page)
    const scope = await openEditor(page, context)
    // The write is held until the test has seen "Saving": a timed delay races a loaded machine (the click alone can outlast it).
    let releaseWrite = () => {}
    const writeHeld = new Promise<void>((resolve) => { releaseWrite = resolve })
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await writeHeld
      return route.fallback()
    })
    await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(statusLine(page)).toHaveText('')
    await openSection(page, 'shop')
    await page.locator('#portal-business-tagline').fill('Ctrl S tagline')
    await expect(saveButton(page)).not.toHaveAttribute('aria-disabled', 'true')
    await expect(statusLine(page)).toHaveText('Unsaved changes')

    await page.keyboard.press('Control+s')
    await expect(reviewDialog(page)).toBeVisible()
    await reviewDialog(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(saveButton(page)).toHaveAttribute('aria-busy', 'true')
    await expect(saveButton(page)).toHaveAccessibleName('Saving')
    await expect(statusLine(page)).toHaveText('Saving')
    releaseWrite()
    await expect(saveButton(page)).toHaveAccessibleName('Saved')
    await expect(statusLine(page)).toHaveText('Saved')
    await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(statusLine(page), 'the Saved flash lasts about 2 s, then the bar is idle').toHaveText('', { timeout: 6_000 })
    await expect(saveButton(page)).toHaveAccessibleName('Save')
    const { writes } = await (await page.request.get(`${ADMIN_ORIGIN}/__e2e/settings?scope=${scope}`)).json() as { writes: SettingsWrite[] }
    expect(writes.at(-1)?.customer_portal_business_tagline).toBe('Ctrl S tagline')
    expectNoRuntimeErrors(health)
  })

  test('a refused Save opens the section holding the field, focuses it and says why under it', async ({ page, context }) => {
    // CATCHES: a refusal that only toasts while the person stays on another section with no idea which field is wrong.
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await openSection(page, 'contact')
    await page.locator('#portal-google-map-embed').fill('this is not a map link')
    await openSection(page, 'shop')
    await page.locator('#portal-business-tagline').fill('Edits are kept')
    await clickSave(page)

    await expect(page.locator('#portal-section-contact')).toBeVisible()
    await expect(page.locator('#portal-google-map-embed')).toBeFocused()
    // Centring the field must move the page scroller only. scrollIntoView also scrolled the app shell around it, which pushed the sticky bar
    // half out of the top of the screen (about half of it hidden on a 360 px phone).
    await expect(page.locator('#portal-editor-bar'), 'the bar is still on screen after the field is focused').toBeInViewport({ ratio: 0.85 })
    await expect(page.locator('#portal-google-map-embed-error')).toHaveAttribute('role', 'alert')
    await expect(page.locator('#portal-google-map-embed-error')).toContainText('Google Maps')
    await expect(saveButton(page), 'back to changed, edits kept').not.toHaveAttribute('aria-disabled', 'true')
    await openSection(page, 'shop')
    await expect(page.locator('#portal-business-tagline')).toHaveValue('Edits are kept')
    expectNoRuntimeErrors(health)
  })

  test('a bad announcement link is refused before the Save is sent, and Posts opens on the link', async ({ page, context }) => {
    const health = collectPageHealth(page)
    await openEditor(page, context)
    const writes: string[] = []
    page.on('request', (candidate) => { if (candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings') writes.push(candidate.url()) })
    await openSection(page, 'posts')
    await page.locator('#portal-announcement-link').fill('javascript:alert(1)')
    await openSection(page, 'shop')
    await clickSave(page)
    await expect(page.locator('#portal-section-posts')).toBeVisible()
    await expect(page.locator('#portal-announcement-link')).toBeFocused()
    await expect(page.getByTestId('portal-announcement-link-issue')).toBeVisible()
    expect(writes, 'the Worker was never asked').toHaveLength(0)
    expectNoRuntimeErrors(health)
  })

  test('closed tabs and the picker button carry their markers in the accessible name, and every section is a tab panel named by what opened it', async ({ page, context }) => {
    // CATCHES: an aria-label that replaces the inner text, so a screen reader never heard "unsaved changes" or "seller details missing" (the blue
    // dot and the amber triangle were the only carriers), and panels nothing names.
    const health = collectPageHealth(page)
    await openEditor(page, context, { seed: { business_legal_name: '', business_registration_number: '' } })
    await page.setViewportSize({ width: 1280, height: 800 })
    await openSection(page, 'faq')
    await page.locator('#portal-faq-title').fill('Questions')
    await openSection(page, 'shop')
    const tabs = editor(page).getByRole('tablist').getByRole('tab')
    await expect(tabs.nth(1), 'Contact: the amber marker is in its name').toHaveAccessibleName('Contact, Seller details missing')
    await expect(tabs.nth(5), 'FAQ: the dot is in its name').toHaveAccessibleName('FAQ, Unsaved changes')
    await expect(tabs.nth(5)).toHaveAttribute('title', 'FAQ, Unsaved changes')
    await expect(tabs.nth(0), 'the open tab is named by its own text').toHaveAccessibleName('Shop')
    await expect(page.locator('#portal-section-shop')).toHaveAttribute('role', 'tabpanel')
    await expect(page.locator('#portal-section-shop')).toHaveAttribute('aria-labelledby', 'portal-tab-shop')
    await expect(page.locator('#portal-tab-faq')).toHaveAttribute('aria-controls', 'portal-section-faq')

    await page.setViewportSize({ width: 390, height: 800 })
    const picker = editor(page).locator('button[aria-haspopup="menu"]')
    await expect(picker).toHaveAccessibleName('Sections: Shop')
    await openSection(page, 'contact')
    await expect(picker, 'the picker button names the open section and its markers').toHaveAccessibleName('Sections: Contact, Seller details missing')
    await expect(page.locator('#portal-section-contact')).toHaveAttribute('role', 'tabpanel')
    await expect(page.locator('#portal-section-contact')).toHaveAttribute('aria-labelledby', 'portal-section-picker')
    await expect(page.locator('#portal-section-picker')).toBeVisible()
    expectNoRuntimeErrors(health)
  })

  test('a stored bad announcement link does not block an unrelated edit: a FAQ-only Save goes through', async ({ page, context }) => {
    // CATCHES: the pre-save announcement check refusing EVERY Save by a config holder because of a value that was already stored (a FAQ title
    // typed by someone who cannot even see the bar), instead of only a Save that edited an announcement key.
    const health = collectPageHealth(page)
    const scope = await openEditor(page, context, {
      seed: {
        customer_portal_announcement_enabled: 'true',
        customer_portal_announcement_text_en: 'Sample sale',
        customer_portal_announcement_link: 'javascript:alert(1)',
      },
    })
    await openSection(page, 'faq')
    await page.locator('#portal-faq-title').fill('Questions')
    const saved = await saveAndCapture(page)
    expect(saved.customer_portal_faq_title).toBe('Questions')
    expect(saved, 'the stored bad link is neither re-sent nor refused').not.toHaveProperty('customer_portal_announcement_link')
    await expect(statusLine(page)).toHaveText('Saved')
    const { settings } = await storedSettings(page, scope)
    expect(settings.customer_portal_faq_title).toBe('Questions')

    // ...but the moment this draft touches the bar, the check applies again.
    await openSection(page, 'posts')
    await page.locator('#portal-announcement-text-en').fill('Sample sale, today')
    await openSection(page, 'faq')
    const writes: string[] = []
    page.on('request', (candidate) => { if (candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings') writes.push(candidate.url()) })
    await clickSave(page)
    await expect(page.locator('#portal-announcement-link')).toBeFocused()
    expect(writes, 'an announcement edit with a bad stored link is refused before the write').toHaveLength(0)
    expectNoRuntimeErrors(health)
  })

  test('the leave guard\'s Save & Leave saves without the review', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, 'the phone bar opens section groups instead of navigating (ios-layout.spec.ts); the guard is the same AppContext code')
    const health = collectPageHealth(page)
    await openEditor(page, context)
    await openSection(page, 'shop')
    await page.locator('#portal-business-tagline').fill('Saved on the way out')
    const request = page.waitForRequest((candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings')
    await page.locator('[data-bos-nav-id="pos"]:visible').first().click()
    await guardDialog(page).getByRole('button', { name: 'Save & Leave' }).click()
    expect(((await request).postDataJSON() as SettingsWrite).customer_portal_business_tagline).toBe('Saved on the way out')
    await expect(reviewDialog(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/pos(?:[/?#]|$)/)
    expectNoRuntimeErrors(health)
  })
})
