import { expect, test, type Route } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

/**
 * till-hour-request-budget.spec.ts -- what one signed-in till tab costs per hour
 * in /api/sync/owner reads and Dexie downloads (R2, 6.0.895: the foreground
 * offline queue is removed; only a probe of the legacy rows remains).
 *
 * The production session user carries `organization_id` (cloudflare/src/lib/
 * auth.ts SessionUser); the fixture's carries only `organizationId`, and with
 * that shape the old queue banner never confirmed an owner and never read. The
 * bootstrap and login answers are therefore given the production field here.
 *
 * The page clock is faked, so an hour is runFor('01:00:00'): every timer and
 * interval fires as it would. Phases:
 *  - online-hour: a visible, connected tab left alone for an hour;
 *  - reconnects: ten sync socket reconnects;
 *  - owner-unknown-hour: an hour in which /api/sync/owner cannot answer.
 *
 * Opt-in (E2E_TILL_HOUR=1), desktop Chromium only. TILL_HOUR_MEASURE_ONLY=1
 * records without asserting (used on the old build); TILL_HOUR_EVIDENCE_FILE
 * writes the per-phase counts as JSON.
 *
 * RUN:  cd frontend && E2E_TILL_HOUR=1 npx playwright test till-hour-request-budget --project=desktop-chromium
 */

type Hit = { phase: string; path: string }

const MEASURE_ONLY = process.env.TILL_HOUR_MEASURE_ONLY === '1'

async function withProductionUserShape(route: Route): Promise<void> {
  const response = await route.fetch()
  const body = await response.json().catch(() => null) as { user?: Record<string, unknown> } | null
  if (body?.user && body.user.organization_id === undefined) body.user.organization_id = body.user.organizationId ?? null
  await route.fulfill({ response, json: body })
}

test.describe('request budget of one till tab per hour', () => {
  test('online hour, ten reconnects, an hour without an owner answer', async ({ page }) => {
    test.skip(process.env.E2E_TILL_HOUR !== '1', 'opt-in: fakes an hour on the page clock (E2E_TILL_HOUR=1)')
    test.skip(test.info().project.name !== 'desktop-chromium', 'measurement, desktop Chromium only')
    test.setTimeout(600_000)
    const hits: Hit[] = []
    let phase = 'boot'
    let ownerAnswers = true
    await page.route(/\/api\/auth\/(bootstrap|login|me)(\?|$)/, withProductionUserShape)
    await page.route(/\/api\/sync\/owner(\?|$)/, (route) => (ownerAnswers ? route.continue() : route.abort('internetdisconnected')))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/') || url.pathname === '/health' || /vendor-dexie|app-local-db/.test(url.pathname)) hits.push({ phase, path: url.pathname })
    })
    await page.clock.install()
    await page.goto(ADMIN_ORIGIN + '/', { waitUntil: 'load' })
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 120_000 })
    await signIn(page, E2E_ACCOUNTS.cashierA)
    const organizationId = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('businessos_user') || window.localStorage.getItem('businessos_user') || '{}').organization_id)
    expect(organizationId, 'the stored user has the production organization_id').not.toBeUndefined()

    phase = 'online-hour'
    await page.clock.runFor('01:00:00')
    await page.waitForTimeout(2_000)

    phase = 'reconnects'
    for (let index = 0; index < 10; index += 1) {
      await page.evaluate(() => window.dispatchEvent(new Event('sync:reconnected')))
      await page.clock.runFor(60_000)
    }
    await page.waitForTimeout(2_000)

    phase = 'owner-unknown-hour'
    ownerAnswers = false
    await page.evaluate(() => window.dispatchEvent(new Event('sync:reconnected')))
    await page.clock.runFor('01:00:00')
    await page.waitForTimeout(2_000)
    phase = 'done'

    const phases = ['boot', 'online-hour', 'reconnects', 'owner-unknown-hour']
    const summary = Object.fromEntries(phases.map((name) => {
      const rows = hits.filter((hit) => hit.phase === name)
      return [name, {
        api: rows.filter((hit) => hit.path.startsWith('/api/')).length,
        syncOwner: rows.filter((hit) => hit.path === '/api/sync/owner').length,
        dexieChunks: rows.filter((hit) => /vendor-dexie|app-local-db/.test(hit.path)).length,
        byPath: rows.reduce<Record<string, number>>((counts, hit) => ({ ...counts, [hit.path]: (counts[hit.path] || 0) + 1 }), {}),
      }]
    }))
    const evidence = { build: process.env.TILL_HOUR_BUILD_LABEL || 'unlabelled', measuredAt: new Date().toISOString(), summary }
    if (process.env.TILL_HOUR_EVIDENCE_FILE) writeFileSync(process.env.TILL_HOUR_EVIDENCE_FILE, JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(Object.fromEntries(Object.entries(summary).map(([name, row]) => [name, { ...row, byPath: undefined }]))))
    if (MEASURE_ONLY) return

    for (const name of phases) expect(summary[name].syncOwner, `${name}: no queue read of /api/sync/owner`).toBe(0)
  })
})
