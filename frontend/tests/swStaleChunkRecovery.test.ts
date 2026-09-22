// Sep 23 2026 production incident, reproduced in headless Chromium.
//
// After a deploy, a tab holding the previous build asked for a hashed chunk
// the deploy had deleted. The service worker recognised it (isStaleBuildAsset),
// answered "404 Stale build asset", and the app's one-shot recovery guard
// (utils/chunkReloadGuard.ts) reloaded with __bos_reload/__bos_server_build.
// That reload landed on the SAME dead shell, the same two chunks 404'd again,
// the guard refused a second reload for the same live build, and the page died
// in RootErrorBoundary ("The app could not start").
//
// Why: recoverStaleShell refreshes the cached shell by reading /index.html
// from WORKER context. That read is not the navigation the browser would make
// -- this host answers a plain same-origin document read with a bot challenge
// (curl gets 403 "Just a moment") and an edge POP can still be serving the
// previous document -- so the refresh silently no-ops, and appShellFallback
// then answers the recovery navigation out of the very cache that is known
// stale. Recovery was a race with no fallback.
//
// The fixture below is that shape, not a mock of it: two real build
// generations of a tiny app that uses the real lazyRetry + chunkReloadGuard,
// a static host with wrangler's not_found_handling = "single-page-application"
// (an unknown /assets/* is index.html at 200 text/html), and a document route
// that answers non-navigation reads with the challenge page once the new
// generation is live.
//
// Three cases, so a green run means something:
//   - fixed worker + deploy    -> the guard's FIRST reload gets the new shell
//                                 and the catalog mounts (the fix)
//   - ef0489c1 worker + deploy -> stays on the dead shell (negative control:
//                                 the exact worker that was live at 21:23Z)
//   - fixed worker + no deploy -> no recovery reload at all, healthy build
//                                 untouched (positive control)
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'

const FRONTEND = new URL('../', import.meta.url)
const fixedWorker = fs.readFileSync(new URL('public/sw.js', FRONTEND), 'utf8')
// The worker that was actually deployed when this failed, not a hand-reverted
// copy of it: a control the fix cannot accidentally satisfy.
const brokenWorker = execFileSync('git', ['show', 'ef0489c1:frontend/public/sw.js'], { encoding: 'utf8' })

const BUILD = { old: 'aaaaaaaaaaaaaaa1', new: 'bbbbbbbbbbbbbbb2' } as const
type Generation = 'old' | 'new'

function bundleEntry(generation: Generation): string {
  return buildSync({
    stdin: {
      contents: [
        "import React, { Suspense } from 'react'",
        "import { createRoot } from 'react-dom/client'",
        "import { lazyRetry } from './src/utils/lazyImport.ts'",
        // The lazy chunk is loaded by URL so esbuild leaves the dynamic import
        // external -- the browser must really fetch it through the worker.
        ';(window as any).React = React',
        "const Catalog = lazyRetry(() => import((window as any).__LAZY_URL__), 'public-catalog-secondary-tabs')",
        'class Boundary extends React.Component<{ children?: unknown }, { failed: boolean }> {',
        '  state = { failed: false }',
        '  static getDerivedStateFromError() { return { failed: true } }',
        "  render() { return this.state.failed ? React.createElement('div', { id: 'boot-error' }, 'The app could not start') : this.props.children }",
        '}',
        'createRoot(document.getElementById("root")).render(React.createElement(Boundary, null,',
        "  React.createElement(Suspense, { fallback: React.createElement('div', { id: 'pending' }) }, React.createElement(Catalog))))",
        ';(window as any).__SHELL_GENERATION = ' + JSON.stringify(generation),
      ].join('\n'),
      resolveDir: fileURLToPath(FRONTEND),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: {
      __FRONTEND_BUILD_HASH__: JSON.stringify(BUILD[generation]),
      'process.env.NODE_ENV': '"production"',
    },
  }).outputFiles[0].text
}

const entryScript: Record<Generation, string> = { old: bundleEntry('old'), new: bundleEntry('new') }
const chunkScript = (generation: Generation) =>
  `export default () => window.React.createElement('main', { id: 'catalog' }, 'CATALOG-${generation}')\n`
const document_ = (generation: Generation) =>
  '<!doctype html><html><head><meta charset="utf-8">'
  + `<script>window.__LAZY_URL__="/assets/catalog-secondary-tabs-${generation}.js"</script>`
  + `<link rel="modulepreload" href="/assets/catalog-products-${generation}.js">`
  + `<script type="module" src="/assets/app-${generation}.js"></script>`
  + '</head><body><div id="root"></div></body></html>'

type Outcome = {
  recoveryReloads: number
  shellGeneration: string | null
  catalog: string | null
  bootError: boolean
}

async function runScenario(workerSource: string, deploy: boolean): Promise<Outcome> {
  let generation: Generation = 'old'
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const isNavigation = String(request.headers['sec-fetch-mode'] || '') === 'navigate'
    const build = BUILD[generation]
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    if (path === '/sw.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(workerSource.replaceAll('__BUSINESS_OS_BUILD_HASH__', build))
      return
    }
    if (path === '/business-os-build.json') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ hash: build }))
      return
    }
    if (path === '/business-os-precache.json') {
      response.setHeader('Content-Type', 'application/json')
      const entry = [`/assets/app-${generation}.js`]
      response.end(JSON.stringify({ assets: entry, eager: entry, deferred: [], required: entry }))
      return
    }
    if (path.endsWith('manifest.json')) {
      response.setHeader('Content-Type', 'application/json')
      response.end('{}')
      return
    }
    if (path.endsWith('.png')) {
      response.setHeader('Content-Type', 'image/png')
      response.end('icon')
      return
    }
    if (path.startsWith('/assets/')) {
      if (path === `/assets/app-${generation}.js`) {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(entryScript[generation])
        return
      }
      if (path === `/assets/catalog-secondary-tabs-${generation}.js` || path === `/assets/catalog-products-${generation}.js`) {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(chunkScript(generation))
        return
      }
      // wrangler.toml: not_found_handling = "single-page-application".
      response.setHeader('Content-Type', 'text/html')
      response.end(document_(generation))
      return
    }
    // The document. Once the new generation is live, a NON-navigation read of
    // it gets the challenge page -- the production shape that makes the
    // worker's own shell refresh a silent no-op.
    if (!isNavigation && generation === 'new') {
      response.writeHead(403, { 'Content-Type': 'text/html' })
      response.end('<html><body>Just a moment...</body></html>')
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(document_(generation))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  let recoveryReloads = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().includes('__bos_reload')) recoveryReloads += 1
  })
  try {
    await page.goto(origin)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
    })
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    // A second visit, so the shell now comes out of the worker's cache.
    await page.goto(origin)
    await page.waitForSelector('#catalog', { timeout: 20_000 })
    // The route chunks are not part of this generation's retained static
    // cache (production: a deferred chunk, or a pruned generation), so the
    // next visit has to ask the network for them.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (!name.startsWith('business-os-static-')) continue
        const cache = await caches.open(name)
        for (const request of await cache.keys()) {
          if (request.url.includes('/assets/catalog-')) await cache.delete(request)
        }
      }
    })

    if (deploy) generation = 'new'

    // Load A: the cached (now stale) shell, whose chunks the deploy deleted.
    await page.goto(origin)
    await page.waitForFunction(
      () => !!document.querySelector('#catalog') || !!document.querySelector('#boot-error'),
      null,
      { timeout: 60_000 },
    ).catch(() => {})
    return {
      recoveryReloads,
      shellGeneration: await page.evaluate(() => (window as unknown as Record<string, string>).__SHELL_GENERATION ?? null),
      catalog: await page.evaluate(() => document.querySelector('#catalog')?.textContent ?? null),
      bootError: await page.evaluate(() => !!document.querySelector('#boot-error')),
    }
  } finally {
    await context.close()
    await browser.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('the chunk-recovery reload lands on the deployed build in one hop', { timeout: 180_000 }, async () => {
  const fixed = await runScenario(fixedWorker, true)
  assert.equal(fixed.recoveryReloads, 1, 'the guard must need exactly one reload, not two and not none')
  assert.equal(fixed.shellGeneration, 'new', 'the recovery navigation must be answered with the deployed shell, not the cached dead one')
  assert.equal(fixed.catalog, 'CATALOG-new', 'the lazy route must mount on the build the server is actually serving')
  assert.equal(fixed.bootError, false, 'RootErrorBoundary is what the incident showed; recovery must not reach it')
})

test('negative control: the worker deployed at ef0489c1 stays stuck on the dead shell', { timeout: 180_000 }, async () => {
  const broken = await runScenario(brokenWorker, true)
  // If any of these stop holding, the fixture stopped reproducing the
  // incident and the test above proves nothing.
  assert.equal(broken.recoveryReloads, 1, 'the old worker still let the guard reload once -- that is not what was broken')
  assert.equal(broken.shellGeneration, 'old', 'the incident: the recovery navigation was answered from the stale app-shell cache')
  assert.equal(broken.catalog, null, 'the deleted chunk 404s again on the reload, so the route never mounts')
  assert.equal(broken.bootError, true, 'and the page ends where the owner saw it: "The app could not start"')
})

test('positive control: a healthy build is not forced through a recovery reload', { timeout: 180_000 }, async () => {
  const healthy = await runScenario(fixedWorker, false)
  assert.equal(healthy.recoveryReloads, 0, 'no deploy, no stale chunk, no reload -- updates stay consent-based')
  assert.equal(healthy.shellGeneration, 'old', 'the running build must keep serving itself')
  assert.equal(healthy.catalog, 'CATALOG-old', 'the lazy route still loads from the network after a cache eviction')
})
