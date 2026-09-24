import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { chromium, expect, type Browser, type BrowserContext } from '@playwright/test'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const fixed = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const legacy = execFileSync('git', ['show', '5b81a2c3:frontend/public/sw.js'], { encoding: 'utf8' })
const dirtyGuard = buildSync({ stdin: { contents: `import { restartIntoLatestApp } from './src/utils/appUpdate.ts'; import { registerDirtyWork } from './src/utils/dirtyWork.ts'; registerDirtyWork({key:'test',pageId:'sales',label:'unsaved',isDirty:()=>true}); window.tryRestart=restartIntoLatestApp;`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0].text

test('failed or changed incumbent proof cannot prune generations using stale persisted metadata', async () => {
  for (const mode of ['silent', 'invalid', 'changes-during-persist']) {
    const handlers: Record<string, any> = {}
    const shell = 'business-os-app-shell-proof-test'
    const rows = new Map<string, Response>([['/__business_os_incumbent__', new Response(JSON.stringify({ schema: 1, current: shell, previous: 'business-os-app-shell-stale' }))]])
    const keys = [shell, 'business-os-static-proof-test', 'business-os-static-old', 'business-os-static-newer']
    let skips = 0
    const self: any = { location: { origin: 'https://app.test' }, clients: { matchAll: async () => [] }, addEventListener: (type: string, handler: any) => { handlers[type] = handler }, skipWaiting: async () => { skips++ }, registration: {} }
    self.registration.active = { postMessage(_: any, ports: MessagePort[]) {
      if (mode === 'silent') return
      ports[0].postMessage({ type: 'BUSINESS_OS_APP_VERSION', version: mode === 'invalid' ? '../private' : 'business-os-app-shell-old' })
    } }
    const caches = { keys: async () => keys, open: async () => ({ match: async (key: string) => rows.get(key)?.clone(), delete: async (key: string) => rows.delete(key), put: async (key: string, value: Response) => { rows.set(key, value); if (mode === 'changes-during-persist') self.registration.active = {} } }) }
    const context = vm.createContext({ self, caches, Response, MessageChannel, setTimeout, clearTimeout, URL, console })
    vm.runInContext(fixed.replaceAll('__BUSINESS_OS_BUILD_HASH__', 'proof-test'), context)
    vm.runInContext('precacheAppShell = async () => {}', context)
    let pending: Promise<void> | undefined
    handlers.install({ waitUntil: (promise: Promise<void>) => { pending = promise } })
    await pending
    assert.equal(skips, 0, mode)
    assert.equal(rows.has('/__business_os_incumbent__'), false, mode)
    const retained = await vm.runInContext('caches.keys().then(cacheNamesToRetain)', context)
    assert.deepEqual([...retained], keys, mode)
  }
})

for (const poisonBeforeInstall of [false, true]) test(`native legacy migration (${poisonBeforeInstall ? 'poisoned' : 'healthy'}) retains drafts and chunks; future update waits`, { timeout: 60000 }, async () => {
  let worker = legacy.replaceAll('__BUSINESS_OS_BUILD_HASH__', 'actual-old')
  let missing = false
  let waitingBuild = false
  let posts = 0
  // The fixed worker only admits a document with the app's mount point as its shell.
  const html = '<!doctype html><div id="root"><input id="draft"><main>APP</main></div>'
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') posts++
    const path = new URL(req.url!, 'http://localhost').pathname
    res.setHeader('Cache-Control', 'no-store')
    if (path === '/sw.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(worker); return }
    if (path.startsWith('/assets/')) {
      if (missing) { res.writeHead(404); res.end(); return }
      res.setHeader('Content-Type', path.includes('poison') ? 'text/html' : 'text/javascript')
      res.end(path.includes('poison') ? html : 'export const retained = 42'); return
    }
    if (path.endsWith('.json')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ assets: waitingBuild ? ['/assets/newer-XyZ123.js'] : [], metadata: true })); return }
    if (path.endsWith('.png')) { res.setHeader('Content-Type', 'image/png'); res.end('icon'); return }
    res.setHeader('Content-Type', 'text/html'); res.end(html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  // If the launch throws (e.g. no Chromium here), close the listening server
  // and rethrow the launch error; left open, it keeps this file -- and the
  // whole test chain -- waiting forever instead of failing.
  let browser: Browser | undefined
  let context: BrowserContext
  try {
    browser = await chromium.launch()
    context = await browser.newContext({ serviceWorkers: 'allow' })
  } catch (error) {
    await browser?.close().catch(() => {})
    await new Promise<void>(resolve => server.close(() => resolve()))
    throw error
  }
  try {
    const draft = await context.newPage()
    await draft.goto(origin)
    await draft.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready })
    await draft.waitForFunction(() => !!navigator.serviceWorker.controller)
    const metadata = await context.newPage()
    await metadata.goto(origin + '/sales')
    await draft.fill('#draft', 'unsaved checkout')
    await draft.addScriptTag({ content: dirtyGuard })
    await draft.evaluate(async () => {
      ;(window as any).draftMemory = 'keep-memory'
      localStorage.setItem('recovery-sentinel', 'original-owner')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('migration-proof', 1)
        r.onupgradeneeded = () => r.result.createObjectStore('recovery')
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
      })
      await new Promise<void>(resolve => { const tx = db.transaction('recovery', 'readwrite'); tx.objectStore('recovery').put('unsent-original-owner', 'pending'); tx.oncomplete = () => resolve() })
      db.close()
      await fetch('/assets/old-AbCd12.js?revision=exact')
    })
    // A newer WAITING worker/cache is not the actual incumbent.
    worker = legacy.replaceAll('__BUSINESS_OS_BUILD_HASH__', 'abandoned-waiting')
    waitingBuild = true
    await draft.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    await expect.poll(() => draft.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true)
    await draft.evaluate(async () => {
      const newer = await caches.open('business-os-static-abandoned-waiting')
      await newer.put('/assets/poison-XyZ123.js', await fetch('/index.html'))
    })
    assert.deepEqual(await draft.evaluate(async () => Promise.all(['actual-old', 'abandoned-waiting'].map(async name => !!await (await caches.open(`business-os-static-${name}`)).match('/assets/newer-XyZ123.js')))), [false, true], 'only the waiting build precached its lazy chunk; incumbent does not have it')
    if (poisonBeforeInstall) {
      await metadata.goto(origin + '/business-os-build.json')
      await expect.poll(() => draft.evaluate(async () => (await (await caches.open('business-os-app-shell-actual-old')).match('/index.html'))?.headers.get('content-type'))).toBe('application/json')
    }
    missing = true
    waitingBuild = false
    worker = fixed.replaceAll('__BUSINESS_OS_BUILD_HASH__', 'migration-fixed')
    await draft.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    const version = () => draft.evaluate(() => new Promise<string | null>(resolve => {
      const ch = new MessageChannel(); const timer = setTimeout(() => { ch.port1.close(); ch.port2.close(); resolve(null) }, 500)
      ch.port1.onmessage = e => { clearTimeout(timer); ch.port1.close(); ch.port2.close(); resolve(e.data.version) }
      navigator.serviceWorker.controller?.postMessage({ type: 'BUSINESS_OS_APP_VERSION_REQUEST' }, [ch.port2])
    }))
    await expect.poll(version, { timeout: 15000 }).toBe('business-os-app-shell-migration-fixed')
    assert.equal(await draft.inputValue('#draft'), 'unsaved checkout')
    assert.equal(await draft.evaluate(() => (window as any).tryRestart()), 'blocked', 'real app update utility retains its dirty-work guard')
    assert.deepEqual(await draft.evaluate(() => [(window as any).draftMemory, localStorage.getItem('recovery-sentinel')]), ['keep-memory', 'original-owner'])
    assert.equal(await draft.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('migration-proof'); r.onsuccess = () => resolve(r.result) })
      const value = await new Promise(resolve => { const r = db.transaction('recovery').objectStore('recovery').get('pending'); r.onsuccess = () => resolve(r.result) }); db.close(); return value
    }), 'unsent-original-owner')
    assert.equal(await draft.evaluate(async () => (await fetch('/assets/old-AbCd12.js?revision=exact')).text()), 'export const retained = 42')
    assert.equal(await draft.evaluate(async () => (await fetch('/assets/newer-XyZ123.js')).text()), 'export const retained = 42')
    assert.equal(await draft.evaluate(async () => (await fetch('/assets/poison-XyZ123.js')).status), 404)
    assert.equal(await draft.evaluate(async () => (await fetch('/assets/old-AbCd12.js?revision=other')).status), 404)
    await metadata.goto(origin + '/sales')
    assert.equal(await metadata.locator('main').innerText(), 'APP')
    await metadata.goto(origin + '/business-os-build.json')
    await metadata.goto(origin + '/sales')
    assert.equal(await metadata.locator('main').innerText(), 'APP', 'late metadata navigation cannot poison migrated controller')
    await context.setOffline(true)
    assert.equal(await draft.evaluate(async () => (await fetch('/assets/old-AbCd12.js?revision=exact')).text()), 'export const retained = 42')
    await context.setOffline(false)
    worker = fixed.replaceAll('__BUSINESS_OS_BUILD_HASH__', 'next-capable')
    await draft.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    await expect.poll(() => draft.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true)
    assert.equal(await version(), 'business-os-app-shell-migration-fixed')
    assert.equal(posts, 0)
  } finally {
    await context.close(); await browser.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
