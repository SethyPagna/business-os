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
// Two more defects of the same recovery path are pinned here, because a
// stale chunk exercises all three at once:
//   - the 404 the page is blocked on used to wait for registration.update()
//     to re-fetch /sw.js, spending seconds against lazyImport.ts's timeout;
//   - the SKIP_WAITING message went to registration.waiting straight after
//     update() resolved, which is while the new worker is still INSTALLING,
//     so it went nowhere and the dead build kept control until someone
//     navigated by hand.
//
// Every case has its opposite, so a green run means something:
//   - fixed worker + deploy    -> the guard's FIRST reload gets the new shell
//                                 and the catalog mounts; the 404 does not
//                                 wait for /sw.js; the new build takes over
//                                 with no navigation at all
//   - ef0489c1 worker + deploy -> stays on the dead shell, waits the full
//                                 /sw.js round trip, never hands over
//                                 (negative controls: the exact worker that
//                                 was live at 21:23Z)
//   - fixed worker + no deploy -> no recovery reload at all, healthy build
//                                 untouched (positive control). The
//                                 consent-based update path for a normal
//                                 deploy is covered by swLateUpgrade's
//                                 "future update waits" case.
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { chromium, type Page } from '@playwright/test'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'

const FRONTEND = new URL('../', import.meta.url)
const fixedWorker = fs.readFileSync(new URL('public/sw.js', FRONTEND), 'utf8')
// The worker that was actually deployed when this failed, not a hand-reverted
// copy of it: a control the fix cannot accidentally satisfy.
const brokenWorker = execFileSync('git', ['show', 'ef0489c1:frontend/public/sw.js'], { encoding: 'utf8' })

const BUILD = { old: 'aaaaaaaaaaaaaaa1', new: 'bbbbbbbbbbbbbbb2' } as const
// Read out of the shipped worker so the budget and the test cannot drift
// apart. The literal is only what the pre-fix control was measured against.
const RECOVERY_FETCH_TIMEOUT_MS = Number(
  (/RECOVERY_NAVIGATION_FETCH_TIMEOUT_MS = ([0-9_]+)/.exec(fixedWorker)?.[1] ?? '8000').replace(/_/g, ''),
)
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
  /**
   * Distinct __bos_reload values the tab navigated to. One reload token means
   * the guard needed exactly one hop, no matter how many transport hops (a
   * host redirect) the browser made to land it.
   */
  recoveryTokens: number
  /**
   * How long the tab waited between the origin receiving the recovery
   * navigation and the browser committing a document for it. null means it
   * never committed -- the blank tab.
   */
  recoveryCommitMs: number | null
  /** The origin really did receive the recovery navigation it then stalled. */
  recoveryRequestStalled: boolean
  shellGeneration: string | null
  catalog: string | null
  bootError: boolean
}

type FixtureOptions = {
  /**
   * Answer a NON-navigation read of the document with the host's bot
   * challenge once the new generation is live. That is the production shape
   * that makes the worker's own shell refresh a silent no-op. Off for probes
   * that need the new worker to be able to install.
   */
  challengeWorkerShellReads?: boolean
  /** Make the /sw.js round trip measurably slow, the way a phone does. */
  swJsDelayMs?: number
  /**
   * Answer the FIRST recovery navigation (__bos_reload) with a 301 to the
   * same path, query intact -- the shape a host-level normalisation hop
   * (HSTS, trailing slash, an edge rule) has. A navigate-mode Request carries
   * redirect: 'manual', so the worker sees an opaqueredirect, not the
   * document. Only the first one redirects: a permanent redirect to the
   * identical URL every time is a loop no worker can survive.
   */
  redirectFirstRecoveryNavigation?: boolean
  /**
   * Accept the recovery navigation and never answer it: a captive portal, a
   * stalled radio, an origin holding the connection open. navigator.onLine is
   * still true, so the app-side guard does not refuse the reload, and the
   * worker is the only thing standing between the user and a blank tab.
   */
  stallRecoveryNavigation?: boolean
  /**
   * Answer the recovery navigation, but only after this long: an origin that
   * is slower than the worker's budget and still alive.
   */
  delayRecoveryNavigationMs?: number
}

function createFixture(workerSource: string, options: FixtureOptions = {}) {
  let generation: Generation = 'old'
  let recoveryRedirectsSent = 0
  let firstStallAt: number | null = null
  let challengedRecoveryReads = 0
  const openSockets = new Set<import('node:net').Socket>()
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost')
    const path = requestUrl.pathname
    const isNavigation = String(request.headers['sec-fetch-mode'] || '') === 'navigate'
    const isRecoveryNavigation = isNavigation && requestUrl.searchParams.has('__bos_reload')
    const build = BUILD[generation]
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    if (path === '/sw.js') {
      response.setHeader('Content-Type', 'text/javascript')
      const body = workerSource.replaceAll('__BUSINESS_OS_BUILD_HASH__', build)
      const delay = generation === 'new' ? (options.swJsDelayMs ?? 0) : 0
      if (delay > 0) setTimeout(() => response.end(body), delay)
      else response.end(body)
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
    // The document.
    if (options.stallRecoveryNavigation && isRecoveryNavigation) {
      // No response, ever. The socket is destroyed by close() below.
      if (firstStallAt === null) firstStallAt = Date.now()
      return
    }
    if (options.delayRecoveryNavigationMs && isRecoveryNavigation) {
      const answeredGeneration = generation
      setTimeout(() => {
        response.setHeader('Content-Type', 'text/html')
        response.end(document_(answeredGeneration))
      }, options.delayRecoveryNavigationMs)
      return
    }
    if (options.redirectFirstRecoveryNavigation && isRecoveryNavigation && recoveryRedirectsSent === 0) {
      recoveryRedirectsSent += 1
      // Cache-Control: must-revalidate is already set above, so the browser
      // cannot silently replay this permanent redirect for the next URL.
      response.writeHead(301, { Location: request.url ?? '/' })
      response.end()
      return
    }
    if (options.challengeWorkerShellReads && !isNavigation && generation === 'new') {
      // Only reads of the recovery URL itself: a newly deployed worker's own
      // install reads of / and /index.html are challenged here too.
      if (requestUrl.searchParams.has('__bos_reload')) challengedRecoveryReads += 1
      response.writeHead(403, { 'Content-Type': 'text/html' })
      response.end('<html><body>Just a moment...</body></html>')
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(document_(generation))
  })
  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
  })
  return {
    server,
    deploy: () => { generation = 'new' },
    firstStallAt: () => firstStallAt,
    /** Worker-context reads of the recovery URL the host answered with its challenge. */
    challengedRecoveryReads: () => challengedRecoveryReads,
    // A stalled request holds its socket open, and server.close() waits for
    // every connection: destroy them or the test process never exits.
    close: () => new Promise<void>((resolve) => {
      for (const socket of openSockets) socket.destroy()
      server.close(() => resolve())
    }),
  }
}

async function runScenario(workerSource: string, deploy: boolean, options: FixtureOptions = {}): Promise<Outcome> {
  const fixture = createFixture(workerSource, { challengeWorkerShellReads: true, ...options })
  const { server } = fixture
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  let recoveryReloads = 0
  const recoveryTokens = new Set<string>()
  let recoveryCommittedAt: number | null = null
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() || !frame.url().includes('__bos_reload')) return
    recoveryReloads += 1
    recoveryTokens.add(new URL(frame.url()).searchParams.get('__bos_reload') ?? '')
    if (recoveryCommittedAt === null) recoveryCommittedAt = Date.now()
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

    if (deploy) fixture.deploy()

    // Load A: the cached (now stale) shell, whose chunks the deploy deleted.
    await page.goto(origin)
    if (options.stallRecoveryNavigation) {
      // While the recovery navigation hangs, the tab has no execution context
      // to poll and Playwright cannot even interrupt one: a page.waitForFunction
      // with a 60s timeout took 106s to give up here. Watch the commit from
      // Node instead, which is where the timestamps are taken anyway.
      const deadline = Date.now() + STALLED_RECOVERY_OBSERVATION_MS
      while (recoveryCommittedAt === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    const stalledAt = fixture.firstStallAt()
    // A recovery navigation that never got a response leaves the tab mid-
    // navigation forever, and page.evaluate would wait for an execution
    // context that never arrives. That IS the defect being measured, so read
    // it off recoveryCommitMs and do not touch the DOM.
    const blankTab = stalledAt !== null && recoveryCommittedAt === null
    if (!blankTab) {
      await page.waitForFunction(
        () => !!document.querySelector('#catalog') || !!document.querySelector('#boot-error'),
        null,
        { timeout: 60_000 },
      ).catch(() => {})
    }
    return {
      recoveryReloads,
      recoveryTokens: recoveryTokens.size,
      recoveryCommitMs: stalledAt !== null && recoveryCommittedAt !== null ? recoveryCommittedAt - stalledAt : null,
      recoveryRequestStalled: stalledAt !== null,
      shellGeneration: blankTab ? null : await page.evaluate(() => (window as unknown as Record<string, string>).__SHELL_GENERATION ?? null),
      catalog: blankTab ? null : await page.evaluate(() => document.querySelector('#catalog')?.textContent ?? null),
      bootError: blankTab ? false : await page.evaluate(() => !!document.querySelector('#boot-error')),
    }
  } finally {
    // The server goes first: a stalled request the browser is still waiting on
    // has to be cut before the page will let go of it.
    await fixture.close()
    await context.close()
    await browser.close()
  }
}

type RecoveryReloadOutcome = {
  /** Worker-context reads of the recovery URL the host had to challenge. */
  challengedRecoveryReads: number
  /** The recovery navigation committed the host's challenge page. */
  challenged: boolean
  shellGeneration: string | null
  catalog: string | null
}

/**
 * The recovery reload the lazy-chunk path does not cover: App.tsx's page-chunk
 * guard deletes every shell cache and THEN reloads with __bos_reload, so the
 * worker meets that navigation with no cached shell at all. 'poisoned' is the
 * other way a worker is left without a usable shell: an entry it cannot serve,
 * which it drops on sight.
 */
async function runRecoveryReload(workerSource: string, shell: 'cleared' | 'poisoned', options: FixtureOptions = {}): Promise<RecoveryReloadOutcome> {
  const fixture = createFixture(workerSource, { challengeWorkerShellReads: true, ...options })
  const { server } = fixture
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  try {
    await page.goto(origin)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
    })
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    await page.goto(origin)
    await page.waitForSelector('#catalog', { timeout: 20_000 })
    fixture.deploy()
    await page.evaluate(async (mode) => {
      for (const name of await caches.keys()) {
        if (mode === 'cleared' && (name.startsWith('business-os-app-shell-') || name.startsWith('business-os-static-'))) {
          await caches.delete(name)
        } else if (mode === 'poisoned' && name.startsWith('business-os-app-shell-')) {
          await (await caches.open(name)).put('/index.html', await fetch('/business-os-build.json'))
        }
      }
    }, shell)
    await page.goto(`${origin}/?__bos_reload=recovery-token`, { waitUntil: 'commit', timeout: 60_000 })
    await page.waitForFunction(
      () => !!document.querySelector('#catalog') || !!document.querySelector('#boot-error')
        || !!document.body?.textContent?.includes('Just a moment'),
      null,
      { timeout: 60_000 },
    ).catch(() => {})
    return {
      challengedRecoveryReads: fixture.challengedRecoveryReads(),
      challenged: await page.evaluate(() => !!document.body?.textContent?.includes('Just a moment')),
      shellGeneration: await page.evaluate(() => (window as unknown as Record<string, string>).__SHELL_GENERATION ?? null),
      catalog: await page.evaluate(() => document.querySelector('#catalog')?.textContent ?? null),
    }
  } finally {
    await fixture.close()
    await context.close()
    await browser.close()
  }
}

// The recovery budget, shortened so a slower-than-budget origin does not have
// to sit out the shipped 8 s. Only its order against the origin's delay counts.
const QUICK_RECOVERY_BUDGET_MS = 1_000
function withQuickRecoveryBudget(workerSource: string): string {
  const quick = workerSource.replace(
    /RECOVERY_NAVIGATION_FETCH_TIMEOUT_MS = [0-9_]+/,
    `RECOVERY_NAVIGATION_FETCH_TIMEOUT_MS = ${QUICK_RECOVERY_BUDGET_MS}`,
  )
  assert.notEqual(quick, workerSource, 'the budget needle must match the shipped worker')
  return quick
}

const SW_JS_DELAY_MS = 2_000
// How long a stalled recovery navigation is watched before the tab is called
// blank. Comfortably past the worker's own budget, so a pass means the worker
// gave up on the network, not that the observer did.
const STALLED_RECOVERY_OBSERVATION_MS = 30_000

type StaleAssetProbe = {
  status: number
  statusText: string
  /** How long the PAGE waited for the honest 404. */
  elapsedMs: number
  /** Which build is controlling the tab afterwards, with NO navigation at all. */
  controllerBuild: string | null
}

/** Ask the CONTROLLING worker which build it is, the way index.tsx does. */
const controllerBuildHash = (page: Page) => page.evaluate(() => new Promise<string | null>((resolve) => {
  const channel = new MessageChannel()
  const done = (value: string | null) => {
    clearTimeout(timer)
    channel.port1.close()
    channel.port2.close()
    resolve(value)
  }
  const timer = setTimeout(() => done(null), 800)
  channel.port1.onmessage = (event) => done(
    String(event.data?.version || '').replace('business-os-app-shell-', '') || null,
  )
  const controller = navigator.serviceWorker.controller
  if (!controller) done(null)
  else controller.postMessage({ type: 'BUSINESS_OS_APP_VERSION_REQUEST' }, [channel.port2])
}))

/**
 * No navigation, no guard, no reload: just ask the worker for a chunk the
 * deploy deleted and time how long the answer takes, with /sw.js deliberately
 * slow. That isolates one thing -- whether recoverStaleShell holds the 404
 * while it fetches the new worker.
 */
async function probeStaleAsset(workerSource: string): Promise<StaleAssetProbe> {
  const fixture = createFixture(workerSource, { swJsDelayMs: SW_JS_DELAY_MS })
  const { server } = fixture
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  try {
    await page.goto(origin)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
    })
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    await page.goto(origin)
    await page.waitForSelector('#catalog', { timeout: 20_000 })
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (!name.startsWith('business-os-static-')) continue
        const cache = await caches.open(name)
        for (const request of await cache.keys()) {
          if (request.url.includes('/assets/catalog-')) await cache.delete(request)
        }
      }
    })
    fixture.deploy()
    const failure = await page.evaluate(async () => {
      const started = performance.now()
      const response = await fetch('/assets/catalog-secondary-tabs-old.js')
      return { status: response.status, statusText: response.statusText, elapsedMs: performance.now() - started }
    })
    // Deliberately NO navigation from here on: the question is whether the
    // new build takes control on its own once the running one is proven
    // broken, which is what the owner had to do by hand in production.
    let controllerBuild: string | null = null
    for (let attempt = 0; attempt < 24 && controllerBuild !== BUILD.new; attempt += 1) {
      await page.waitForTimeout(400)
      controllerBuild = await controllerBuildHash(page)
    }
    return { ...failure, controllerBuild }
  } finally {
    await context.close()
    await browser.close()
    await fixture.close()
  }
}

test('the stale-chunk 404 reaches the page without waiting for the /sw.js round trip', { timeout: 180_000 }, async () => {
  const probe = await probeStaleAsset(fixedWorker)
  assert.equal(probe.status, 404, 'the page must still get the honest failure lazyImport.ts listens for')
  assert.equal(probe.statusText, 'Stale build asset')
  assert.ok(
    probe.elapsedMs < SW_JS_DELAY_MS,
    `the page waited ${Math.round(probe.elapsedMs)}ms for a 404 while /sw.js took ${SW_JS_DELAY_MS}ms -- `
    + 'registration.update() is back on the response path, and that time is spent against the lazy-import timeout',
  )
})

test('the new build takes control after recovery, with no navigation at all', { timeout: 180_000 }, async () => {
  const probe = await probeStaleAsset(fixedWorker)
  assert.equal(
    probe.controllerBuild,
    BUILD.new,
    'the running build is proven broken, so the freshly installed one must take over by itself -- '
    + 'in production the owner had to navigate by hand before it did',
  )
})

test('negative control: ef0489c1 waited for /sw.js and then never handed over', { timeout: 180_000 }, async () => {
  const probe = await probeStaleAsset(brokenWorker)
  assert.equal(probe.status, 404, 'the old worker answered with the same honest failure')
  assert.ok(
    probe.elapsedMs >= SW_JS_DELAY_MS,
    'if this ever stops holding, the delay fixture stopped measuring what it claims to measure',
  )
  assert.equal(
    probe.controllerBuild,
    BUILD.old,
    'the incident: update() resolves while the new worker is still installing, so the SKIP_WAITING '
    + 'message went to a null registration.waiting and the dead build kept control',
  )
})

test('the chunk-recovery reload lands on the deployed build in one hop', { timeout: 180_000 }, async () => {
  const fixed = await runScenario(fixedWorker, true)
  assert.equal(fixed.recoveryReloads, 1, 'the guard must need exactly one reload, not two and not none')
  assert.equal(fixed.shellGeneration, 'new', 'the recovery navigation must be answered with the deployed shell, not the cached dead one')
  assert.equal(fixed.catalog, 'CATALOG-new', 'the lazy route must mount on the build the server is actually serving')
  assert.equal(fixed.bootError, false, 'RootErrorBoundary is what the incident showed; recovery must not reach it')
})

// E1 (verifier, Sep 23 2026): the recovery navigation meets a host redirect.
// A navigate-mode Request has redirect: 'manual', so fetch(request) hands the
// worker an opaqueredirect (type 'opaqueredirect', status 0, ok false) rather
// than the document. Refusing it and falling through to the cached shell hands
// back the very build the page just proved dead, and the guard has already
// spent its one reload -- the original incident, reached by a different road.
test('the recovery navigation follows a host redirect instead of falling back to the dead shell', { timeout: 180_000 }, async () => {
  const fixed = await runScenario(fixedWorker, true, { redirectFirstRecoveryNavigation: true })
  assert.equal(fixed.recoveryTokens, 1, 'the guard must still need exactly one reload; the redirect hop belongs to the browser, not to a second try')
  assert.equal(fixed.shellGeneration, 'new', 'a 3xx on the recovery navigation must be followed, not answered from the stale app-shell cache')
  assert.equal(fixed.catalog, 'CATALOG-new', 'and the deployed build must actually mount after the hop')
  assert.equal(fixed.bootError, false, 'falling back to the cached shell here is the incident, one redirect later')
})

// E2 (verifier, Sep 23 2026): the origin accepts the recovery navigation and
// never answers it -- a captive portal, a stalled radio, a hung edge. The app
// side cannot refuse this reload (triggerLazyChunkRecovery only checks
// navigator.onLine === false), so an unbounded `await fetch(request)` means
// respondWith never settles and the user watches a blank tab. ef0489c1, for
// all its faults, served the cached shell in milliseconds.
test('a stalled origin still gets the cached shell, within the recovery fetch budget', { timeout: 180_000 }, async () => {
  const stalled = await runScenario(fixedWorker, true, { stallRecoveryNavigation: true })
  assert.equal(stalled.recoveryRequestStalled, true, 'the guard must have issued the recovery reload and the origin must have swallowed it')
  assert.notEqual(
    stalled.recoveryCommitMs,
    null,
    'the recovery navigation never committed: an unbounded fetch on a stalled origin leaves respondWith pending and the tab blank',
  )
  assert.ok(
    (stalled.recoveryCommitMs ?? Infinity) < RECOVERY_FETCH_TIMEOUT_MS + 2_500,
    `the tab waited ${stalled.recoveryCommitMs}ms for a document while the budget is ${RECOVERY_FETCH_TIMEOUT_MS}ms`,
  )
  assert.ok(
    (stalled.recoveryCommitMs ?? 0) > RECOVERY_FETCH_TIMEOUT_MS / 2,
    'nothing but the timeout can release this navigation, so a much faster answer means the fixture stopped stalling',
  )
  assert.equal(stalled.shellGeneration, 'old', 'the fallback is the cached shell -- the only document this worker still has')
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

// Part 628 ticket 1. With no cached shell the recovery budget has nothing to
// fall back to, so expiring it bought nothing -- and it sent a SECOND request
// through fetchAndCacheShell (an init object, so same-origin, so challenged on
// this host) while throwing the navigation's own answer away. An origin that
// was merely slower than the budget put its bot challenge in front of the user
// instead of the app. A no-worker navigation would simply have waited.
test('with no cached shell, a recovery navigation slower than the budget still lands on the app', { timeout: 180_000 }, async () => {
  const slow = await runRecoveryReload(withQuickRecoveryBudget(fixedWorker), 'cleared', {
    delayRecoveryNavigationMs: QUICK_RECOVERY_BUDGET_MS * 3,
  })
  assert.equal(slow.challengedRecoveryReads, 0, 'no second, downgraded request may chase the navigation when the budget runs out')
  assert.equal(slow.challenged, false, 'the host challenge must not replace the answer the navigation was about to get')
  assert.equal(slow.shellGeneration, 'new', 'the navigation\'s own answer -- the deployed shell -- is what the tab must get')
  assert.equal(slow.catalog, 'CATALOG-new', 'and the deployed build must mount')
})

// Same ticket: a poisoned entry was answered with a worker-context read of
// /index.html instead of the navigation, so the recovery never reached the
// origin as a navigation. Dropping the entry now leaves a plain cache miss.
test('a poisoned cached shell does not turn the recovery navigation into a worker read', { timeout: 180_000 }, async () => {
  const poisoned = await runRecoveryReload(fixedWorker, 'poisoned')
  assert.equal(poisoned.challenged, false, 'the recovery must reach the origin as the navigation it is, not as a challenged read')
  assert.equal(poisoned.shellGeneration, 'new', 'the dropped shell is replaced by the deployed one')
  assert.equal(poisoned.catalog, 'CATALOG-new')
})
