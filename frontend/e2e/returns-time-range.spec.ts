import { expect, test } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'

// UI/transport contract only: synthetic GET reads do not certify D1 filtering
// or export completeness. Block SW only in this intercepted-read spec; the
// separate online-auth-safety spec runs the actual native worker.
test.use({ serviceWorkers: 'block' })

test('Returns exposes endpoint times inside a responsive date-only range picker', async ({ page, context }, testInfo) => {
  const health = collectPageHealth(page)
  const reads: URL[] = []
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== ADMIN_ORIGIN) return route.abort('blockedbyclient')
    if (request.method() === 'GET' && ['/api/returns', '/api/returns/report'].includes(url.pathname)) {
      reads.push(url)
      const body = url.pathname === '/api/returns' ? [] : {
        startDate: url.searchParams.get('startDate'), endDate: url.searchParams.get('endDate'),
        scope: url.searchParams.get('scope') || 'customer',
        totals: { count: 0, refund_usd: 0, refund_khr: 0, compensation_usd: 0,
          compensation_khr: 0, loss_usd: 0, loss_khr: 0 }, days: [], by_reason: [], by_type: [],
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    return route.continue()
  })
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await page.goto(`${ADMIN_ORIGIN}/returns`)
  await expect(page.locator(APP_ROOT)).toBeVisible()
  const trigger = page.getByRole('button', { name: 'Date & time range', exact: true })
  await expect(trigger).toBeVisible()
  await expect(page.locator('[data-date-presets]')).toHaveCount(1)
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: 'Date & time range', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.getByLabel('Start time', { exact: true })).toBeVisible()
    await expect(panel.getByLabel('End time', { exact: true })).toBeVisible()
    await expect(panel.locator('[data-date-time-range-presets]')).toHaveCount(0)
    const rect = await panel.boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.x).toBeGreaterThanOrEqual(0)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1)
    const triggerRect = await trigger.boundingBox()
    expect(triggerRect!.x + triggerRect!.width).toBeLessThanOrEqual(width + 1)
    expect(await trigger.innerText()).not.toMatch(/\d{1,2}:\d{2}/)
    await page.screenshot({ path: testInfo.outputPath(`returns-range-${width}.png`) })
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
  }

  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Date & time range', exact: true })
  for (const [label, value] of [['End Date', '20/09/2026'], ['Start Date', '19/09/2026'], ['Start time', '22:00'], ['End time', '02:00']]) {
    await panel.getByLabel(label, { exact: true }).fill(value)
    await panel.getByLabel(label, { exact: true }).press('Enter')
  }
  for (const path of ['/api/returns', '/api/returns/report']) {
    await expect.poll(() => reads.some(url => url.pathname === path
      && url.searchParams.get('createdFrom') === '2026-09-19 15:00:00'
      && url.searchParams.get('createdTo') === '2026-09-19 19:01:00')).toBe(true)
  }
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(trigger).toContainText('19/09/2026')
  await expect(trigger).toContainText('20/09/2026')
  expect(await trigger.innerText()).not.toMatch(/22:00|02:00/)
  await trigger.click()
  await expect(panel.getByLabel('Start time', { exact: true })).toHaveValue('22:00')
  await expect(panel.getByLabel('End time', { exact: true })).toHaveValue('02:00')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('[data-date-presets]').getByRole('button', { name: 'Today', exact: true }).click()
  await trigger.click()
  await expect(panel.getByLabel('Start time', { exact: true })).toHaveValue('00:00')
  await expect(panel.getByLabel('End time', { exact: true })).toHaveValue('23:59')
  expect(health.pageErrors).toEqual([])
  expect(health.consoleErrors).toEqual([])
  expect(health.failedApiResponses.filter(entry => entry !== '401 /api/auth/bootstrap')).toEqual([])
})
