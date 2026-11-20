import { expect, test, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, seedDeviceSettings } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

/**
 * admin-alert-pin.spec.ts -- pop-ups for real bell alerts, pinned in the bell until resolved.
 *
 * Covers (frontend/src/components/shared/notificationAlerts.ts + NotificationCenter.tsx): the first load pops ONE "N alerts need attention";
 * a new real alert pops once for 10 s and then stays pinned in the bell; the same answer again changes nothing; an alert that left and
 * stayed away pops again when it returns; a failed read (500 or dropped request) resolves nothing (round-4 review S4); an informational
 * item never pops. Until now only tests/adminNotifyPin.test.ts pinned this, on a fake clock and a fake React.
 *
 * The Worker is stubbed: GET /api/notifications/summary is answered by page.route from a mutable `bell.reply`, in the section shape
 * routes/notifications.ts really sends (inventory items; the portal section for an informational item).
 *
 * TIME: Playwright's clock (page.clock), never a real wait. It is installed before the app boots and paused once the first answer is
 * on screen, so the 10 s pop-up (a window.setTimeout) is measured to the millisecond with runFor, not raced against a loaded runner.
 * A re-read is what the tab does by itself: the bell re-reads from scheduleRefresh's 2 h idle timer, so fastForward(2 h) fires that one
 * timer, which is also longer than the 10 min "stayed away" period that makes an alert count as resolved. (The panel's refresh button is
 * not used: the panel being open blocks pop-ups by design, so a read through it can never pop.)
 *
 * "No pop-up" is only asserted after the read was answered AND handled: the stub counts finished answers, and an init-script spy on
 * window.setTimeout sees the app re-arm its refresh timer, which loadSummary does only after it has taken an answer in.
 *
 * Three more cases (a portal review, a sale status change, a till sale) are added on the composed tree later.
 */

test.use({ serviceWorkers: 'block' })

type Item = { id: string; tone: 'danger' | 'warning' | 'info'; label: string; meta: string; kind: string; pageId: string; anchor?: string }
type Reply = ReturnType<typeof answer> | 500 | 'abort'

const SUMMARY_URL = /\/api\/notifications\/summary(\?.*)?$/
const stock = (id: string, tone: 'danger' | 'warning', label: string, meta: string): Item => (
  { id, tone, label, meta, kind: tone === 'danger' ? 'inventory_out_of_stock' : 'inventory_low_stock', pageId: 'inventory', anchor: id }
)
const A1 = stock('out-1', 'danger', 'Rose Water Toner', 'Out of stock')
const A2 = stock('out-2', 'danger', 'Jasmine Soap', 'Out of stock')
const A3 = stock('low-3', 'warning', 'Argan Hair Oil', 'Low stock (3)')
const A4 = stock('low-4', 'warning', 'Shea Butter', 'Low stock (2)')
const NEW = stock('out-5', 'danger', 'Camellia Serum', 'Out of stock')
const INFO: Item = { id: 'portal-7', tone: 'info', label: 'Sokha Chan', meta: 'Pending review', kind: 'portal_pending_review', pageId: 'catalog' }
// Four at once: more than three new alerts in one load collapse into the single "N alerts need attention" pop-up.
const BASE = [A1, A2, A3, A4]

/** A real Worker answer: it always carries generatedAt, and leaves a section out when it has no items. */
function answer(stockItems: Item[], portalItems: Item[] = []) {
  const sections = []
  if (stockItems.length) sections.push({ id: 'inventory', label: 'Inventory', pageId: 'inventory', count: stockItems.length, summary: `${stockItems.length} stock alerts`, enabledKey: 'notifications_inventory_enabled', items: stockItems })
  if (portalItems.length) sections.push({ id: 'portal', label: 'Website Editor', pageId: 'catalog', count: portalItems.length, summary: `${portalItems.length} pending customer submissions`, items: portalItems })
  const total = stockItems.length + portalItems.length
  return { unreadCount: total, unread: total, generatedAt: '2026-11-20T09:00:00.000Z', preferences: {}, sections }
}

type Bell = { reply: Reply; answered: number }

// Every pop-up the stack draws is a [data-toast-type] node (App.tsx Notification). Only alert text counts, so an unrelated notice
// (say a connection note after a dropped request) can never make a "no pop-up" or "one pop-up" assertion lie.
const alertToasts = (page: Page) => page.locator('[data-toast-type]').filter({ hasText: /need attention|stock|Pending review/ })
const bellButton = (page: Page) => page.getByRole('button', { name: 'Notifications', exact: true })
const rowOf = (page: Page, id: string) => page.locator(`[data-notification-item-id="${id}"]`)
const panel = (page: Page) => page.locator('[data-notification-as-of]')
const armedCount = (page: Page) => page.evaluate(() => (window as unknown as { __armed: number[] }).__armed.length)

/** Waits until the real browser has run everything queued behind the last answer (React renders and effects use the same queue). */
const flush = (page: Page) => page.evaluate(async () => {
  for (let round = 0; round < 3; round += 1) {
    await new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(0) })
  }
})

/** The app took an answer in: loadSummary re-armed its refresh timer (2 h, or 15 s steps after a failure). A dropped request waits out a 450 ms retry on the paused clock, so it is nudged. */
async function handled(page: Page, armedBefore: number, nudge = false): Promise<void> {
  await expect.poll(async () => {
    if ((await armedCount(page)) > armedBefore) return true
    if (nudge) await page.clock.runFor(1_000)
    return (await armedCount(page)) > armedBefore
  }, { message: 'the app must take the answer in (its refresh timer is re-armed)', timeout: 30_000, intervals: [100] }).toBe(true)
  await flush(page)
}

/** One re-read the way an idle tab does it: the 2 h refresh timer fires, the stub answers `reply`, the app handles it. */
async function readAgain(page: Page, bell: Bell, reply: Reply): Promise<void> {
  bell.reply = reply
  const answeredBefore = bell.answered
  const armedBefore = await armedCount(page)
  await page.clock.fastForward(2 * 60 * 60 * 1000)
  await expect.poll(() => bell.answered, { message: 'the stubbed bell read must have been answered' }).toBeGreaterThan(answeredBefore)
  await handled(page, armedBefore, reply === 'abort')
}

/** Open the bell, check what it lists, close it. Reads the panel's own load in too, so the next re-read starts from a quiet app. */
async function bellShows(page: Page, present: Item[], absent: Item[] = []): Promise<void> {
  // Let any pop-up run its 10 s first: on a wide screen the pop-up stack sits over the header, where its buttons could take the bell's click.
  await page.clock.runFor(10_500)
  const armedBefore = await armedCount(page)
  await bellButton(page).click()
  await expect(panel(page)).toBeVisible()
  for (const item of present) await expect(rowOf(page, item.id), `${item.label} is listed in the bell`).toBeVisible()
  for (const item of absent) await expect(rowOf(page, item.id), `${item.label} has left the bell`).toHaveCount(0)
  await bellButton(page).click()
  await expect(panel(page)).toHaveCount(0)
  await handled(page, armedBefore)
}

/** Signed-in admin on a clean device whose first bell read lists BASE: one "4 alerts need attention" pop-up, then the clock is paused. */
async function openApp(page: Page): Promise<Bell> {
  const bell: Bell = { reply: answer(BASE), answered: 0 }
  await page.clock.install()
  // After the clock, so it wraps the clock's setTimeout: records each re-arm of the bell's refresh timer (2 h) or its failure retry (15 s steps).
  await page.addInitScript(() => {
    const spy = window as unknown as { __armed: number[] }
    spy.__armed = []
    const timer = window.setTimeout
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (ms === 7_200_000 || (typeof ms === 'number' && ms >= 15_000 && ms <= 90_000 && ms % 15_000 === 0)) spy.__armed.push(ms)
      return timer.call(window, handler, ms, ...rest)
    }) as typeof window.setTimeout
  })
  await seedDeviceSettings(page.context(), ADMIN_ORIGIN, { language: 'en' })
  await page.route(SUMMARY_URL, async (route) => {
    const reply = bell.reply
    if (reply === 'abort') await route.abort('failed')
    else if (reply === 500) await route.fulfill({ status: 500, json: { error: 'boom' } })
    else await route.fulfill({ json: reply })
    bell.answered += 1
  })
  await signIn(page, E2E_ACCOUNTS.admin)
  await expect(alertToasts(page)).toHaveCount(1)
  await expect(alertToasts(page)).toContainText('4 alerts need attention')
  await page.clock.pauseAt(Date.now() + 5_000)
  return bell
}

test.describe('admin alerts: pop-up once, pinned in the bell until resolved', () => {
  test('first load with existing alerts: one "N alerts need attention" pop-up, all listed in the bell', async ({ page }) => {
    // CATCHES: one pop-up per alert (a wall of four) or none at all on first load; alerts missing from the bell.
    await openApp(page)
    await expect(alertToasts(page)).toHaveCount(1)
    await expect(alertToasts(page)).toHaveText(/4 alerts need attention/)
    await bellShows(page, BASE)
  })

  test('a new real alert pops with its own text for 10 s, then stays pinned in the bell', async ({ page }) => {
    // CATCHES: a new alert with no pop-up, a pop-up with the wrong or truncated text, one that lasts longer or shorter than 10 s, or an alert that leaves the bell with its pop-up.
    const bell = await openApp(page)
    await readAgain(page, bell, answer([...BASE, NEW]))
    const popup = alertToasts(page)
    await expect(popup).toHaveCount(1)
    await expect(popup).toContainText('Camellia Serum: Out of stock')
    await page.clock.runFor(9_500)
    await expect(popup, 'still up just before 10 s').toHaveCount(1)
    await page.clock.runFor(600)
    await expect(popup, 'gone just after 10 s').toHaveCount(0)
    await bellShows(page, [...BASE, NEW])
    await bellButton(page).click()
    await expect(rowOf(page, NEW.id).locator('[data-notification-pin]')).toBeVisible()
  })

  test('re-reading the same answer pops nothing', async ({ page }) => {
    // CATCHES: an alert that pops again on every poll (the announced memory not kept, or not read back).
    const bell = await openApp(page)
    await readAgain(page, bell, answer(BASE))
    await expect(alertToasts(page)).toHaveCount(0)
    await bellShows(page, BASE)
    // Control: the stack is alive, so the silence above was real. A new alert still pops, alone.
    await readAgain(page, bell, answer([...BASE, NEW]))
    await expect(alertToasts(page)).toHaveCount(1)
    await expect(alertToasts(page)).toContainText('Camellia Serum')
  })

  test('a resolved alert leaves the bell; when it returns it pops again', async ({ page }) => {
    // CATCHES: a resolved alert that stays in the bell, or one that never pops again after it was fixed and came back.
    const bell = await openApp(page)
    const rest = [A2, A3, A4]
    await readAgain(page, bell, answer(rest))
    await expect(alertToasts(page)).toHaveCount(0)
    await bellShows(page, rest, [A1])
    // Gone for 2 h on a second answer: longer than the 10 min repeat interval, so it counts as resolved.
    await readAgain(page, bell, answer(rest))
    await expect(alertToasts(page)).toHaveCount(0)
    await readAgain(page, bell, answer(BASE))
    await expect(alertToasts(page)).toHaveCount(1)
    await expect(alertToasts(page)).toContainText('Rose Water Toner: Out of stock')
    await bellShows(page, BASE)
  })

  for (const failure of [500, 'abort'] as const) {
    test(`a failed read (${failure === 500 ? 'HTTP 500' : 'dropped request'}) resolves nothing: no pop-up when the same alerts are read again`, async ({ page }) => {
      // CATCHES: S4. A failed read counted as an empty, real answer, so after two of them (a quiet period apart) every alert counted as resolved and popped again on recovery.
      const bell = await openApp(page)
      await readAgain(page, bell, failure)
      await readAgain(page, bell, failure)
      await expect(alertToasts(page)).toHaveCount(0)
      await readAgain(page, bell, answer(BASE))
      await expect(alertToasts(page), 'recovery with the same alerts is not news').toHaveCount(0)
      await bellShows(page, BASE)
    })
  }

  test('an informational item appearing new never pops', async ({ page }) => {
    // CATCHES: info or success items (a pending portal review, a delivery waiting) popping up like warnings and dangers.
    const bell = await openApp(page)
    await readAgain(page, bell, answer(BASE, [INFO]))
    await expect(alertToasts(page)).toHaveCount(0)
    await bellShows(page, [...BASE, INFO as Item])
    // Control: a real alert in the next answer does pop, so the silence above was not a dead pop-up stack.
    await readAgain(page, bell, answer([...BASE, NEW], [INFO]))
    await expect(alertToasts(page)).toHaveCount(1)
    await expect(alertToasts(page)).toContainText('Camellia Serum')
  })
})
