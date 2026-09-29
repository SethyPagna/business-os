import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * website-editor.spec.ts -- the Website Editor round trip (AB-F; EDITOR-REDESIGN-FINAL E2E-4, E2E-5, AF-3, AF-9).
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

type SettingsWrite = Record<string, unknown>

async function openEditor(page: Page, context: BrowserContext): Promise<string> {
  const scope = randomUUID()
  const seeded = await context.request.post(`${ADMIN_ORIGIN}/__e2e/settings?scope=${scope}`, { data: {} })
  expect(seeded.ok(), 'the fixture server takes the settings scope').toBe(true)
  await context.addCookies([{ name: 'e2e_settings_scope', value: scope, url: ADMIN_ORIGIN }])
  await page.route('**/api/files/upload', (route) => route.fulfill({
    json: { public_path: POSTER_UPLOAD, processing_status: 'ready', cache_version: 'e2e1' },
  }))
  await page.route(`**${POSTER_UPLOAD}*`, (route) => route.fulfill({ body: POSTER, contentType: 'image/png' }))
  await signIn(page, E2E_ACCOUNTS.cashierA)
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

async function saveAndCapture(page: Page): Promise<SettingsWrite> {
  const request = page.waitForRequest((candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings')
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/settings')
  await expect(saveButton(page)).toBeEnabled()
  await saveButton(page).click()
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
  const chooser = page.waitForEvent('filechooser')
  await aboutPicture(page).getByRole('button', { name: 'Upload image' }).click()
  await (await chooser).setFiles(POSTER_FILE)
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
    await saveButton(page).click()
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
    await saveButton(page).click()
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
