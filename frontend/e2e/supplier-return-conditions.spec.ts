import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { ADMIN_ORIGIN } from './support/harness'

test.use({ serviceWorkers: 'block' })
for (const language of ['en', 'km']) test(`supplier sources and frozen retry in ${language}`, async ({ page, context }, testInfo) => {
  const words = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
  const label = (key: string) => words[key] ?? key
  const settings = JSON.parse(readFileSync(new URL('./fixtures/admin-settings.json', import.meta.url), 'utf8'))
  let settingsLanguage = 'en'
  let outcome: 'unknown' | 'malformed' | 'success' = 'unknown'
  const writes: Record<string, unknown>[] = []
  const sourceReads: number[][] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const serum = { id: 5, name: 'Serum', sku: 'SER-5', barcode: '1234567890128', category: 'Skincare', display_quantity: .75, cost_price_usd: 4, cost_price_khr: 16400 }
  await page.setViewportSize({ width: 1440, height: 900 })
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== ADMIN_ORIGIN) return route.abort('blockedbyclient')
    const answer = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'GET') {
      if (url.pathname === '/api/settings') return answer({ ...settings, language: settingsLanguage })
      if (url.pathname === '/api/returns') return answer([])
      if (url.pathname === '/api/returns/report') return answer({ startDate: url.searchParams.get('startDate'), endDate: url.searchParams.get('endDate'),
        scope: url.searchParams.get('scope') || 'customer', totals: { count: 0, refund_usd: 0, refund_khr: 0, compensation_usd: 0, compensation_khr: 0, loss_usd: 0, loss_khr: 0 }, days: [], by_reason: [], by_type: [] })
      if (url.pathname === '/api/branches') return answer([{ id: 1, name: 'Store', is_active: 1, is_default: 1 }])
      if (url.pathname === '/api/suppliers') return answer([{ id: 4, name: 'Glow Co' }])
      if (url.pathname === '/api/inventory/summary') return answer([serum])
      if (url.pathname === '/api/returns/supplier-options') {
        sourceReads.push(String(url.searchParams.get('product_ids')).split(',').map(Number))
        return answer({ supplier_condition_version: 1, branch_id: 1, financial_visibility: true, financial_editable: true,
          items: [{ product_id: 5, branch_id: 1, product_name: serum.name, ordinary_available: .5, ordinary_unlotted: .1,
            return_cost_usd: 4, return_cost_khr: 16400,
            ordinary_receipts: [{ batch_id: 2, batch_number: 7, received_at: '2026-10-01', lot_code: null, available: .4, source_cost_usd: 2 }],
            tagged_sources: [{ damaged_lot_id: 8, stock_condition: 'damaged', batch_id: 2, batch_number: 7, received_at: '2026-10-01', lot_code: null,
              available: .25, source_cost_usd: 3, source: 'return' }] }] })
      }
    }
    if (request.method() === 'POST' && url.pathname === '/api/settings') {
      const body = request.postDataJSON() as { language?: string }
      if (body.language) settingsLanguage = body.language
      return answer({ success: true })
    }
    if (request.method() === 'POST' && url.pathname === '/api/returns/supplier') {
      const body = request.postDataJSON() as Record<string, unknown>
      writes.push(body)
      if (outcome === 'unknown') return answer({ error: 'Unconfirmed write', code: 'unknown_outcome' }, 503)
      if (outcome === 'malformed') return answer({ success: true, id: 91 })
      return answer({ success: true, id: 91, returnNumber: body.return_number })
    }
    return route.continue()
  })
  await page.goto(ADMIN_ORIGIN)
  await expect(page.getByRole('button', { name: /Switch organization|Change/i })).toBeVisible()
  await page.locator('#login-username').fill('admin')
  await page.locator('#login-password').fill('e2e-password')
  await page.getByRole('button', { name: /^Login$/ }).click()
  await expect(page.locator('#app-root')).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('businessos_user') || 'null')?.username)).toBe('e2e_admin')
  await page.goto(`${ADMIN_ORIGIN}/returns`)
  if (language === 'km') await page.getByRole('button', { name: 'Switch to Khmer', exact: true }).click()
  await page.getByRole('button', { name: label('filters'), exact: true }).click()
  await page.getByRole('button', { name: label('scope'), exact: true }).click()
  await page.getByRole('option', { name: label('supplier_returns'), exact: true }).click()
  await page.getByRole('button', { name: `Close ${label('filters')}`, exact: true }).click()
  await page.getByRole('button', { name: label('add_supplier_return'), exact: true }).click()
  const form = page.getByRole('dialog', { name: label('return_to_supplier'), exact: true })
  await expect(form).toBeVisible()
  await expect(form.locator('#supplier-return-branch')).toBeVisible()
  await expect(form.getByText('damaged', { exact: true })).toBeVisible()
  await expect(form).toContainText('01/10/2026')
  await expect(form).toContainText(`${label('supplier_source_cost')}: $3.00`)
  const ordinary = form.getByRole('spinbutton', { name: `${label('quantity')}: Serum · ${label('stock_ordinary')}`, exact: true })
  const tagged = form.getByRole('spinbutton', { name: `${label('quantity')}: Serum · damaged · #8`, exact: true })
  await ordinary.fill('.25')
  await tagged.fill('.125')
  await form.locator('#supplier-return-search').fill('no matching product')
  await expect(form.getByRole('list', { name: label('supplier_return_items') })).toContainText('damaged')
  await form.locator('#supplier-return-search').fill('')
  await expect(tagged).toHaveValue('.125')
  await form.locator('#supplier-return-supplier').fill('Glow')
  await page.getByRole('option', { name: /Glow Co/ }).click()
  await form.locator('#supplier-return-reason').fill('Return selected sources')
  for (const width of [testInfo.project.name === 'desktop-chromium' ? 1440 : 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const rect = await form.boundingBox()
    expect(rect!.x).toBeGreaterThanOrEqual(-1)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1)
    expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await expect(form.locator('#supplier-return-branch')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`supplier-${language}-${width}.png`) })
  }
  const save = form.getByRole('button', { name: label('save'), exact: true })
  await save.focus()
  await page.keyboard.press('Enter')
  await expect(form.getByRole('status')).toContainText(label('supplier_pending_unknown'))
  const original = structuredClone(writes[0])
  expect(original.items).toEqual([
    { product_id: 5, product_name: 'Serum', quantity: .25, cost_price_usd: 4, cost_price_khr: 16400, stock_condition: 'ordinary' },
    { product_id: 5, product_name: 'Serum', quantity: .125, cost_price_usd: 4, cost_price_khr: 16400, stock_condition: 'damaged', damaged_lot_id: 8 },
  ])
  await expect(form.locator('#supplier-return-reason')).toBeDisabled()
  outcome = 'malformed'
  await form.getByRole('button', { name: label('retry'), exact: true }).click()
  await expect.poll(() => writes.length).toBeGreaterThan(1)
  await expect(form).toBeVisible()
  await expect(form.getByRole('status')).toContainText(label('supplier_pending_unknown'))
  outcome = 'success'
  await form.getByRole('button', { name: label('retry'), exact: true }).click()
  await expect(form).not.toBeVisible()
  expect(writes.every(body => JSON.stringify(body) === JSON.stringify(original))).toBe(true)
  expect(sourceReads.every(ids => ids.length <= 25)).toBe(true)
  expect(errors).toEqual([])
})
