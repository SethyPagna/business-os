import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import { chromium, expect } from '@playwright/test'

const source = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const start = source.indexOf('function isValidDocumentResponse')
const end = source.indexOf('async function mapWithConcurrency', start)
const guards = new Function('self', `${source.slice(start, end)};return {isValidDocumentResponse,isValidStaticResponse}`)({ location: { origin: 'https://app.test' } })

// Serialized into the page. An incumbent can terminate after postMessage but
// before replying. Every probe must settle so expect.poll can try its successor.
function probeControllerVersion(dropReply: boolean) {
  return new Promise<{ version: string | null, reason: string }>(resolve => {
    const channel = new MessageChannel()
    let done = false
    const finish = (version: string | null, reason: string) => {
      if (done) return
      done = true
      clearTimeout(deadline)
      navigator.serviceWorker.removeEventListener('controllerchange', changed)
      channel.port1.onmessage = null
      channel.port1.close()
      channel.port2.close()
      resolve({ version, reason })
    }
    const changed = () => finish(null, 'controllerchange')
    const deadline = setTimeout(() => finish(null, 'deadline'), 250)
    navigator.serviceWorker.addEventListener('controllerchange', changed)
    channel.port1.onmessage = event => {
      if (!dropReply) finish(event.data.version, 'reply')
    }
    const controller = navigator.serviceWorker.controller
    if (!controller) { finish(null, 'no-controller'); return }
    try { controller.postMessage({ type: 'BUSINESS_OS_APP_VERSION_REQUEST' }, [channel.port2]) }
    catch { finish(null, 'post-failed') }
  })
}
test('document routing preserves SPA paths but bypasses resources and private paths', () => {
  const routes = source.slice(source.indexOf('function isNeverCachedPath'), source.indexOf('function isCacheableStaticPath'))
  const isDocument = new Function(`${routes};return isAppDocumentPath`)()
  for (const path of ['/', '/index.html', '/sales', '/sales/', '/catalog/item', '/shop-name']) assert.equal(isDocument(path), true, path)
  for (const path of ['/business-os-build.json', '/manifest.json', '/export.csv', '/assets/chunk.js', '/download.pdf', '/api/private', '/files/private', '/uploads/private', '/portal/uploads/private', '/business-os-build%2Ejson', '/invalid%']) assert.equal(isDocument(path), false, path)
})
test('HTML shell admission is independent of static transport admission', () => {
  const response = (mime: string, extra = {}) => ({ ok: true, type: 'basic', redirected: false, headers: new Headers({ 'content-type': mime }), ...extra })
  for (const mime of ['application/json', 'image/png', 'text/plain', '', 'text/html-malformed']) assert.equal(guards.isValidDocumentResponse(response(mime)), false)
  assert.equal(guards.isValidDocumentResponse(response('Text/HTML; charset=utf-8')), true)
  assert.equal(guards.isValidDocumentResponse(response('text/html', { redirected: true })), false)
  assert.equal(guards.isValidDocumentResponse(response('text/html', { type: 'opaque' })), false)
  for (const [path, mime] of [['/manifest.json', 'application/json'], ['/icon.png', 'image/png'], ['/assets/a.js', 'text/javascript'], ['/assets/a.css', 'text/css']]) assert.equal(guards.isValidStaticResponse(new Request(`https://app.test${path}`), response(mime)), true)
  assert.equal(guards.isValidStaticResponse(new Request('https://app.test/assets/a.js'), response('text/html')), false)
})

// Discovered by test:utils, deliberately using a real browser and worker rather
// than page routing (which bypasses the cache behavior this regression needs).
test('native SW metadata poisoning negative control, upgrade, recovery and offline shell', { timeout: 60000 }, async () => {
  const oldSource = source
    .replace(/return isValidTransportResponse\(response\)[\s\S]*?=== 'text\/html';/, 'return isValidTransportResponse(response);')
    .replace('if (!isAppDocumentPath(url.pathname))\n            return;', '')
    .replace("const revalidate = fetch('/index.html',", 'const revalidate = fetch(request,')
  assert.notEqual(oldSource, source)
  let worker = oldSource.replaceAll('__BUSINESS_OS_BUILD_HASH__', 'old-poison')
  let failSales = false
  const html = '<!doctype html><title>shell</title><main id="app">REAL APP SHELL</main>'
  const server = http.createServer((req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname
    res.setHeader('Cache-Control', 'no-store')
    if (path === '/sales' && failSales) { res.writeHead(503); res.end('temporarily offline'); return }
    if (/^\/(api|files|uploads)\//.test(path)) { res.setHeader('Content-Type', 'application/json'); res.end('{"private":true}'); return }
    if (path === '/sw.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(worker); return }
    if (path.endsWith('.json')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ metadata: true, assets: [], eager: [], required: [] })); return }
    if (path.endsWith('.png')) { res.setHeader('Content-Type', 'image/png'); res.end('icon'); return }
    res.setHeader('Content-Type', 'text/html'); res.end(html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  let browser
  try {
    browser = await chromium.launch()
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    const page = await context.newPage()
    await page.goto(origin + '/sales')
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready })
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    // Deliberately lose a real response. The old unbounded promise could never
    // yield another poll; this must terminate and release both message ports.
    assert.deepEqual(await page.evaluate(probeControllerVersion, true), { version: null, reason: 'deadline' })
    assert.equal((await page.evaluate(probeControllerVersion, false)).version, 'business-os-app-shell-old-poison')
    await page.goto(origin + '/business-os-build.json')
    await page.waitForFunction(async () => (await (await caches.open('business-os-app-shell-old-poison')).match('/index.html'))?.headers.get('content-type')?.includes('application/json'))
    failSales = true // keep the already-poisoned cache when background refresh fails
    await page.goto(origin + '/sales')
    assert.match(await page.locator('body').innerText(), /"metadata":true/, 'old worker must reproduce the observed poisoning')

    // The poisoned tab has no app JS. A browser registration update still
    // installs the replacement; its prior-shell check must activate unaided.
    worker = source.replaceAll('__BUSINESS_OS_BUILD_HASH__', 'fixed-shell')
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    await page.waitForFunction(async () => (await caches.keys()).includes('business-os-app-shell-fixed-shell'))
    const probes: Array<{ version: string | null, reason: string }> = []
    try {
      await expect.poll(async () => {
        const result = await page.evaluate(probeControllerVersion, probes.length === 0)
        probes.push(result)
        return result.version
      }).toBe('business-os-app-shell-fixed-shell')
      assert.ok(probes.length >= 2, 'a lost first reply must cause another probe, not a false success')
      assert.equal(probes[0].version, null)
    } catch (error) {
      console.error('SW upgrade diagnostic', { probes, registration: await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return { active: registration?.active?.state, waiting: registration?.waiting?.state, installing: registration?.installing?.state, caches: await caches.keys() }
      }) })
      throw error
    }
    failSales = false
    await page.goto(origin + '/sales?view=shift#history')
    assert.equal(await page.locator('#app').innerText(), 'REAL APP SHELL')
    const shellMime = () => page.evaluate(async () => (await (await caches.open('business-os-app-shell-fixed-shell')).match('/index.html'))?.headers.get('content-type'))
    assert.deepEqual(await page.evaluate(async () => {
      const cache = await caches.open('business-os-app-shell-fixed-shell')
      return Promise.all(['/manifest.json', '/icon.png'].map(async path => (await cache.match(path))?.headers.get('content-type')))
    }), ['application/json', 'image/png'], 'install still caches non-HTML manifests/icons')
    for (const path of ['/api/private', '/files/private', '/uploads/private']) {
      await page.goto(origin + path)
      assert.match(await page.locator('body').innerText(), /"private":true/)
      assert.equal(await page.evaluate(async path => !!(await caches.match(path)), path), false)
    }
    await page.goto(origin + '/business-os-build.json')
    assert.match(await page.locator('body').innerText(), /"metadata":true/, 'resource navigation must show its real network response')
    assert.match(await shellMime() || '', /text\/html/)
    await page.goto(origin + '/sales')
    await page.reload()
    assert.equal(await page.locator('#app').innerText(), 'REAL APP SHELL')
    await page.evaluate(async () => { const cache = await caches.open('business-os-app-shell-fixed-shell'); await cache.put('/index.html', await fetch('/business-os-build.json')) })
    await page.reload()
    assert.equal(await page.locator('#app').innerText(), 'REAL APP SHELL', 'already-poisoned current cache must self-heal')
    assert.match(await shellMime() || '', /text\/html/)
    await context.setOffline(true)
    await page.reload()
    assert.equal(await page.locator('#app').innerText(), 'REAL APP SHELL', 'valid shell still boots offline')
    await assert.rejects(page.goto(origin + '/business-os-build.json'), 'offline metadata must not masquerade as the app')
    await context.close()
  } finally {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
