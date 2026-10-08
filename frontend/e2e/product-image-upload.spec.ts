import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

test.use({ serviceWorkers: 'block' })
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return
  const layout = await page.evaluate(() => {
    const rect = (element: Element) => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
    return {
      viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height },
      notices: Array.from(document.querySelectorAll('[role="status"]')).map(element => ({ text: element.textContent, rect: rect(element), parentClass: element.parentElement?.className, parentZ: element.parentElement && getComputedStyle(element.parentElement).zIndex })),
      actions: Array.from(document.querySelectorAll('[role="dialog"] button')).filter(element => element.getBoundingClientRect().height > 0).map(element => {
        const b = element.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
        return { text: element.textContent, rect: rect(element), hitTag: hit?.tagName, hitRole: hit?.closest('[role]')?.getAttribute('role'), hitText: hit?.textContent?.slice(0, 180) }
      }),
    }
  }).catch(error => ({ captureError: String(error) }))
  await testInfo.attach('image-upload-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' })
})
// Real built UI/transport/decoder, synthetic API storage only. Worker byte/key
// persistence is separately verified by native upload-route fixtures.
for (const language of ['en', 'km'] as const) test(`Product image file/capture/Library previews and saved edit in ${language}`, async ({ page }, testInfo) => {
  const labels = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const original = JSON.parse(readFileSync(new URL('./fixtures/admin-products.json', import.meta.url), 'utf8'))
  let product = { ...original.items[0], image_path: '', image_gallery: [] }
  await page.addInitScript(({ denyStorage, staleOrigin }) => {
    const key = 'businessos_public_asset_base_url'
    localStorage.setItem(key, staleOrigin)
    if (denyStorage) {
      const remove = Storage.prototype.removeItem; const set = Storage.prototype.setItem
      Storage.prototype.removeItem = function (name) { if (name === key) throw new DOMException('Blocked', 'SecurityError'); return remove.call(this, name) }
      Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Quota', 'QuotaExceededError'); return set.call(this, name, value) }
    }
  }, { denyStorage: language === 'km', staleOrigin: ADMIN_ORIGIN.replace('127.0.0.1', '127.0.0.2') })
  let explicitCurrentBase = false
  const authorizedAssetOrigin = ADMIN_ORIGIN.replace('127.0.0.1', '127.0.0.3')
  const paths: string[] = []
  const saves: Record<string, unknown>[] = []
  let created: Record<string, unknown> | null = null
  const errors: string[] = []
  let recordImageFlow = false
  let lastApiActivity = Date.now()
  const pendingApi = new Set<import('@playwright/test').Request>()
  page.on('request', request => { if (recordImageFlow && request.url().includes('/api/')) { try { if (request.frame() !== page.mainFrame()) return } catch { return }; pendingApi.add(request); lastApiActivity = Date.now() } })
  page.on('requestfinished', request => { pendingApi.delete(request); lastApiActivity = Date.now() })
  page.on('requestfailed', request => { pendingApi.delete(request); lastApiActivity = Date.now() })
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) { pendingApi.clear(); lastApiActivity = Date.now() } })
  const alerts: string[] = []
  page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') { await dialog.accept(); return }; alerts.push(dialog.message()); await dialog.dismiss() })
  let refuseNextUnsupported = false
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/\/api\/auth\/(?:bootstrap|me|login)(?:\?|$)/, async route => {
    const response = await route.fetch(); const json = await response.json()
    if (json.user) json.user.username = 'admin'
    if (explicitCurrentBase && json.system) json.system.publicAssetBaseUrl = authorizedAssetOrigin
    await route.fulfill({ response, json })
    for (const request of pendingApi) if (request.url() === route.request().url()) pendingApi.delete(request)
    lastApiActivity = Date.now()
  })
  await page.route(/\/api\/products\/(?:bootstrap|search|by-ids)(?:\?|$)/, route => {
    const url = new URL(route.request().url())
    const empty = url.searchParams.get('query')?.includes('Brand New Upload')
    return route.fulfill({ json: { ...original, items: empty ? [] : [product, ...(created ? [created] : [])], total: empty ? 0 : created ? 2 : 1 } })
  })
  await page.route(/\/api\/inventory\/(?:bootstrap|products\/search)(?:\?|$)/, route => route.fulfill({ json: {
    ...original, products: { ...original, items: [product] }, items: [product], total: 1, movements: [], brands: [], categories: [], stats: {},
  } }))
  await page.route(/\/api\/products(?:\?|$)/, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    created = { ...route.request().postDataJSON(), id: 2000 }
    await route.fulfill({ json: { success: true, id: 2000, product: created } })
  })
  await page.route(/\/api\/products\/2000(?:\?|$)/, route => route.fulfill({ json: { success: true, product: created, ...created } }))
  await page.route(/\/api\/products\/1000(?:\?|$)/, async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON(); saves.push(body)
      product = { ...product, ...body, updated_at: '2026-10-08T06:00:00Z' }
    }
    await route.fulfill({ json: { success: true, product, ...product } })
  })
  await signIn(page, E2E_ACCOUNTS.admin)
  if (language === 'km') await page.getByRole('button', { name: 'Switch to Khmer' }).click()
  await page.goto(`${ADMIN_ORIGIN}/products`)
  recordImageFlow = true
  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 8, 8)
    return { png: canvas.toDataURL('image/png').split(',')[1], jpeg: canvas.toDataURL('image/jpeg').split(',')[1] }
  })
  const png = Buffer.from(images.png, 'base64')
  const jpeg = Buffer.from(images.jpeg, 'base64')
  await page.route('**/api/products/upload-image', async route => {
    expect(route.request().method()).toBe('POST')
    const body = route.request().postDataBuffer()!
    expect(route.request().headers()['content-type']).toMatch(/^multipart\/form-data;.*boundary=/)
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'))
    expect(body.subarray(0, headerEnd).toString()).toContain('name="image"')
    expect(headerEnd).toBeGreaterThan(0)
    const boundary = body.subarray(0, body.indexOf(Buffer.from('\r\n'))).toString()
    const fileEnd = body.indexOf(Buffer.from(`\r\n${boundary}`), headerEnd + 4)
    // WebKit interception can omit multipart file bytes; decoder and Worker native tests prove bytes.
    expect(fileEnd).toBeGreaterThanOrEqual(headerEnd + 4)
    if (refuseNextUnsupported) {
      expect(body.subarray(0, headerEnd).toString()).toMatch(/Content-Type: image\/heic/i)
      refuseNextUnsupported = false
      await route.fulfill({ status: 400, json: { error: 'This file type is not supported. Upload a JPEG, PNG, WebP, GIF or AVIF image.' } })
      return
    }
    const path = `/uploads/ordinary-${paths.length + 1}.png`; paths.push(path)
    await route.fulfill({ json: { public_path: path, cache_version: 'probe' } })
  })
  const libraryPath = '/uploads/library # %20 សាកល្បង.png'
  await page.route(/\/api\/files(?:\?|$)/, route => route.fulfill({ json: { items: [{
    id: 501, public_path: libraryPath, original_name: 'Synthetic Library Photo', media_type: 'image', mime_type: 'image/png', byte_size: png.length,
  }], total: 1 } }))
  await page.route('**/uploads/**', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.2') return route.fulfill({ status: 404, body: 'Obsolete public origin' })
    const pathname = url.pathname
    const identity = '/uploads/' + pathname.slice('/uploads/'.length).split('/').map(decodeURIComponent).join('/')
    await route.fulfill(identity === libraryPath || paths.includes(identity)
      ? { body: png, contentType: 'image/png' } : { status: 404, body: 'Unknown stored image identity' })
  })
  async function decodedGallery(count: number) {
    const gallery = page.getByRole('dialog').last().locator('img[alt^="product-"]')
    await expect(gallery).toHaveCount(count)
    await expect.poll(() => gallery.evaluateAll(imgs => imgs.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 8))).toBe(true)
    return gallery
  }
  async function pick(button: string, name: string, mimeType: string, buffer: Buffer, count: number) {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: button, exact: true }).click()
    const chooser = await chooserPromise
    expect(await chooser.element().getAttribute('capture')).toBe(button === labels.take_photo ? 'environment' : null)
    await chooser.setFiles({ name, mimeType, buffer })
    await decodedGallery(count)
    await expect(page.getByRole('dialog').last().getByRole('button', { name: labels.save, exact: true })).toBeEnabled()
  }
  // Products Add is the shared Add Stock session; new identity opens ProductForm.
  await page.getByRole('button', { name: labels.add, exact: true }).click()
  await page.getByRole('textbox', { name: labels.stock_session_search, exact: true }).fill('Brand New Upload')
  await page.getByRole('option', { name: labels.create_named_product.replace('{name}', 'Brand New Upload'), exact: true }).click()
  await pick(labels.choose_file, 'ordinary.png', 'image/png', png, 1)
  await pick(labels.take_photo, 'ordinary.jpg', 'image/jpeg', jpeg, 2)
  await page.getByRole('button', { name: labels.open_files, exact: true }).last().click()
  await page.getByText('Synthetic Library Photo', { exact: true }).waitFor()
  await page.getByRole('dialog').last().getByRole('button', { name: labels.select, exact: true }).click()
  await decodedGallery(3)
  await page.screenshot({ path: testInfo.outputPath(`create-image-${language}.png`), fullPage: true })
  // Deliberately undecodable HEIC container: frontend decoder fallback may send
  // original bytes; emulate the Worker's documented unsupported-codec refusal.
  refuseNextUnsupported = true
  const heicChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: labels.choose_file, exact: true }).click()
  await (await heicChooser).setFiles({ name: 'unsupported.heic', mimeType: 'image/heic', buffer: Buffer.from('000000186674797068656963000000006d69663168656963', 'hex') })
  await expect.poll(() => alerts.at(-1)).toBe(labels.product_image_unsupported_type)
  await decodedGallery(3)
  await expect(page.getByRole('button', { name: labels.choose_file, exact: true })).toBeEnabled()
  // Zero-stock create completes through the real receiving session UI; the
  // fixture records its persisted gallery without inventing a stock receipt.
  await page.getByRole('dialog').last().getByRole('button', { name: labels.save, exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: labels.add_product, exact: true }).click()
  await page.locator('#stock-session-supplier').fill('Synthetic Supplier')
  await page.getByRole('dialog').last().getByRole('spinbutton', { name: labels.stock_line_qty, exact: true }).fill('0')
  await page.getByRole('dialog').last().getByRole('button', { name: labels.add, exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: labels.next, exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: labels.next, exact: true }).click()
  const refreshedAfterCreate = Promise.all([
    page.waitForResponse(response => response.url().includes('/api/products/possible-duplicates')),
    page.waitForResponse(response => response.url().includes('/api/inventory/tagged-lots?')),
  ])
  await page.getByRole('dialog').last().getByRole('button', { name: labels.complete_session, exact: true }).click()
  await Promise.all((await refreshedAfterCreate).map(response => response.finished()))
  await expect.poll(() => created?.image_gallery).toEqual([...paths.slice(0, 2), libraryPath])
  expect(created?.image_path).toBe(paths[0])
  await expect.poll(() => ({ pending: [...pendingApi].map(request => request.url()), quiet: Date.now() - lastApiActivity >= 500 })).toEqual({ pending: [], quiet: true })
  await page.reload()
  await page.getByText('Brand New Upload', { exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: labels.edit, exact: true }).filter({ visible: true }).click()
  await decodedGallery(3)
  await expect.poll(() => ({ pending: [...pendingApi].map(request => request.url()), quiet: Date.now() - lastApiActivity >= 500 })).toEqual({ pending: [], quiet: true })
  await page.reload()
  await page.getByText(product.name, { exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: labels.edit, exact: true }).filter({ visible: true }).click()
  await pick(labels.choose_file, 'plain-edit.png', 'image/png', png, 1)
  await pick(labels.take_photo, 'plain-edit.jpg', 'image/jpeg', jpeg, 2)
  await page.getByRole('dialog').last().getByRole('button', { name: labels.save, exact: true }).click()
  await expect(page.getByRole('dialog').last()).toContainText(labels.save_changes)
  const refreshedAfterSave = page.waitForResponse(response => response.url().includes('/api/products/search?'))
  await page.getByRole('dialog').last().getByRole('button', { name: labels.save, exact: true }).click()
  await (await refreshedAfterSave).finished()
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0].image_gallery).toEqual(paths.slice(-2))
  expect(saves[0].image_path).toBe(paths.at(-2))
  await expect.poll(() => ({ pending: [...pendingApi].map(request => request.url()), quiet: Date.now() - lastApiActivity >= 500 })).toEqual({ pending: [], quiet: true })
  await page.reload()
  await page.getByText(product.name, { exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: labels.edit, exact: true }).filter({ visible: true }).click()
  await decodedGallery(2)
  explicitCurrentBase = true
  await expect.poll(() => ({ pending: [...pendingApi].map(request => request.url()), quiet: Date.now() - lastApiActivity >= 500 })).toEqual({ pending: [], quiet: true })
  await page.reload()
  await expect.poll(() => page.evaluate(() => (window as any).api?.getPublicAssetBaseUrl?.())).toBe(authorizedAssetOrigin)
  await page.getByText(product.name, { exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: labels.edit, exact: true }).filter({ visible: true }).click()
  const explicitlyConfiguredGallery = await decodedGallery(2)
  expect(await explicitlyConfiguredGallery.evaluateAll(imgs => imgs.every(img => new URL((img as HTMLImageElement).src).hostname === '127.0.0.3'))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`reopened-image-${language}.png`), fullPage: true })
  if (errors.length) await testInfo.attach('raw-pageerrors', { body: JSON.stringify(errors), contentType: 'application/json' })
  expect(errors).toEqual([])
})
