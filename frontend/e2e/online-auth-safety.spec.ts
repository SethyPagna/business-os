import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'

const INTENT = 'businessos_unresolved_signout_v1'

async function localOnly(context: BrowserContext) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.origin !== ADMIN_ORIGIN) return route.abort('blockedbyclient')
    }
    return route.continue()
  })
}

async function logoutWithLostRequest(page: Page) {
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Sign-out needs confirmation')
  await expect(page.getByRole('button', { name: /Finish signing out/ })).toBeVisible()
  await expect(page.locator(APP_ROOT)).toBeHidden()
}

test.describe('online-only authentication safety in the built browser', () => {
  test.beforeEach(async ({ context }) => { await localOnly(context) })

  test('signed-out startup and real login render working controls', async ({ page }) => {
    const health = collectPageHealth(page)
    await page.goto(ADMIN_ORIGIN)
    await expect(page.locator('#login-username')).toBeVisible()
    await expect(page.locator('#login-password')).toBeVisible()
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await expect(page.locator(APP_ROOT)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible()
    expect(health.pageErrors).toEqual([])
  })

  test('failed logout survives reload, retains work, and recovers before another login', async ({ page, context }) => {
    await signIn(page, E2E_ACCOUNTS.cashierA)
    const businessWrites: string[] = []
    context.on('request', request => {
      const path = new URL(request.url()).pathname
      if (request.method() !== 'GET' && /^\/api\/(sales|sync\/(?:batch|outbox))/.test(path)) businessWrites.push(path)
    })
    await context.addCookies([{ name: 'e2e_logout_failure', value: '1', url: ADMIN_ORIGIN }])
    await page.evaluate(() => localStorage.setItem('e2e-retained-draft', 'cashier-a-draft'))
    await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'BusinessOS')), { timeout: 30_000 }).toBe(true)
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('BusinessOS')
        open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sync_outbox', 'readwrite')
        for (const actor of [null, 11, 12]) {
          const owner = actor === null ? undefined : { version: 1, actor_id: actor, organization_id: 1,
            authority: location.origin, runtime: 'cloudflare-workers' }
          tx.objectStore('sync_outbox').add({ channel: 'sales:create', status: 'pending',
            created_at: new Date().toISOString(), payload: { receipt_number: `auth-regression-retained-${actor}`, total: 12.5, offline_owner: owner } })
        }
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    const failedLogout = page.waitForResponse(response => response.url().endsWith('/api/auth/logout') && response.status() === 503)
    await logoutWithLostRequest(page)
    await failedLogout
    expect((await context.cookies()).find(cookie => cookie.name === 'bos_session')?.value).toBe('cashier_a')
    await page.reload()
    await expect(page.getByRole('alertdialog')).toContainText('Sign-out needs confirmation')
    await expect(page.locator('#login-username')).toBeHidden()
    await expect(page.locator(APP_ROOT)).toBeHidden()
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).phase, INTENT)).toBe('pending')
    await context.setOffline(true)
    await context.setOffline(false)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('focus'))
      navigator.serviceWorker.controller?.postMessage({ type: 'BUSINESS_OS_SYNC_NOW' })
    })
    await context.clearCookies({ name: 'e2e_logout_failure' })
    await page.getByRole('button', { name: /Finish signing out/ }).click()
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
    await signIn(page, E2E_ACCOUNTS.cashierB)
    await expect(page.locator(APP_ROOT)).toBeVisible()
    await page.reload()
    await expect(page.locator(APP_ROOT)).toBeVisible()
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      if (!registration.active) throw new Error('The built service worker must be active')
      registration.active.postMessage({ type: 'BUSINESS_OS_SYNC_NOW' })
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('focus'))
    })
    // Allow the native worker message and foreground listeners to run before
    // checking the absence of writes; this is a bounded observation window.
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => localStorage.getItem('e2e-retained-draft'))).toBe('cashier-a-draft')
    const retained = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('BusinessOS'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error)
      })
      const rows = await new Promise<any[]>((resolve, reject) => {
        const read = db.transaction('sync_outbox').objectStore('sync_outbox').getAll()
        read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error)
      })
      db.close(); return rows
    })
    expect(retained.filter(row => row.payload?.receipt_number?.startsWith('auth-regression-retained-'))).toHaveLength(3)
    expect(retained.find(row => row.payload?.receipt_number === 'auth-regression-retained-11')?.payload.offline_owner.actor_id).toBe(11)
    expect(retained.find(row => row.payload?.receipt_number === 'auth-regression-retained-12')?.payload.offline_owner.actor_id).toBe(12)
    expect(businessWrites).toEqual([])
    // Server evidence includes service-worker requests outside the page's
    // interception chain. This file sends no business mutations in any case.
    const serverState = await (await context.request.get(`${ADMIN_ORIGIN}/__e2e/state`)).json()
    expect(serverState.requests.filter((request: { method: string; path: string }) =>
      request.method !== 'GET' && /^\/api\/(sales|sync\/(?:batch|outbox))/.test(request.path))).toEqual([])
  })

  test('an unresolved A logout cannot log out a newer B cookie', async ({ page, context }) => {
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await context.addCookies([{ name: 'e2e_logout_failure', value: '1', url: ADMIN_ORIGIN }])
    const failedLogout = page.waitForResponse(response => response.url().endsWith('/api/auth/logout') && response.status() === 503)
    await logoutWithLostRequest(page)
    await failedLogout
    await context.addCookies([{ name: 'bos_session', value: 'cashier_b', url: ADMIN_ORIGIN, httpOnly: true, sameSite: 'Lax' }])
    const logoutCount = async () => {
      const state = await (await context.request.get(`${ADMIN_ORIGIN}/__e2e/state`)).json()
      return state.requests.filter((request: { path: string }) => request.path === '/api/auth/logout').length
    }
    const beforeRetry = await logoutCount()
    await page.reload()
    await expect(page.getByRole('alertdialog')).toContainText('Sign-out needs confirmation')
    await page.getByRole('button', { name: /Finish signing out/ }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Another account is signed in')
    expect(await logoutCount()).toBe(beforeRetry)
    expect((await context.cookies()).find(cookie => cookie.name === 'bos_session')?.value).toBe('cashier_b')
    await expect(page.locator(APP_ROOT)).toBeHidden()
  })
})
