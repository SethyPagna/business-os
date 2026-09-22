// P3-L3 review item 7: the three promotion click paths, EXECUTED.
//
// promotionLinks.test.ts pins the same three wirings by reading the source,
// which is exactly as strong as the regexes in it: it cannot tell whether the
// prop that is passed is the prop that is read, whether the handler survives
// the lazy boundary the banner and the products section sit behind, or
// whether the click ever reaches the server with the facet on it. This
// renders the REAL storefront root (src/PublicCatalogRoot.tsx -- provider,
// error boundary, window.api and the real api/portalPublicTransport.ts over
// real HTTP) against a fixture Worker served by the dev server, and clicks:
//
//   1. an announcement banner card -> the product flyout opens for a product
//      that is NOT on the loaded page (one by-id search, pageSize 1)
//   2. a campaign chip on the promo strip -> promo=rule:<id> reaches the
//      search endpoint and the grid narrows to that campaign
//   3. a promotion card's CTA -> the flyout opens for a product that IS on
//      the loaded page, with no extra request at all
//
// Harness convention: the same Vite dev server + CDP + temp-profile shape as
// mobileSectionMenuIcons.test.ts, including its teardown (the profile
// directory is removed with retries -- Chrome on Windows holds a lock for a
// moment after exit and a plain rmSync throws EPERM).
//
// Run: node tests/promotionClickPaths.test.ts
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer, transformWithEsbuild } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const browserCandidates = process.platform === 'win32'
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
assert.ok(browserPath, 'A local Chromium or Edge executable is required')

// --- the fixture shop -------------------------------------------------------
// NIGHT CREAM is on the loaded page; GLOW SERUM deliberately is not, because
// the announcement banner links to a product by id and the storefront has no
// public by-id route (see PublicCatalogPage.openProductById).
const NIGHT_CREAM = { id: 77, name: 'Night Cream', brand: 'Leang', category: 'Skincare', selling_price_usd: 24, selling_price_khr: 98400, stock_status: 'in_stock', image_path: '' }
const LIP_BALM = { id: 91, name: 'Lip Balm', brand: 'Leang', category: 'Lips', selling_price_usd: 4, selling_price_khr: 16400, stock_status: 'in_stock', image_path: '' }
const GLOW_SERUM = { id: 42, name: 'Glow Serum', brand: 'Leang', category: 'Skincare', selling_price_usd: 32, selling_price_khr: 131200, stock_status: 'in_stock', image_path: '' }
const HOLIDAY_RULE = {
  id: 7, title: 'Holiday bundle', show_title: 1,
  rule_type: 'percent_off', percent_off: 15, min_quantity: 1,
  save_usd: 0, save_khr: 0, min_spend_usd: 0, min_spend_khr: 0,
  scope_type: 'products', product_ids: [77], category: '', brand: '',
  label_style: 'save', badge_color: '#b91c1c', starts_at: null, ends_at: null, is_active: 1,
}
const PROMO_CARD = {
  id: 'promo-night', eyebrow: 'Promotion', title: 'Night ritual', subtitle: 'Save 15%',
  body: 'Our best-selling night cream, cut this week.', mediaUrl: '',
  ctaLabel: 'View product', linkUrl: '', linkProductId: 77, linkProductName: 'Night Cream',
}
const BANNER_PROMOTION = {
  id: 3, title: 'Winter glow week', subtitle: 'Limited time', image_path: null,
  link_type: 'product', link_url: null, link_product_id: 42,
  link_product_name: 'Glow Serum', link_product_image: null,
  badge_text: 'New', badge_color: '#be123c',
}
const BOOTSTRAP = {
  config: {
    businessName: 'Leang Beauty', showCatalog: true, showPromotions: true, showPrices: true,
    promotionsTitle: 'Featured offers', promotionsIntro: 'This week at Leang Beauty',
    promoItems: [PROMO_CARD],
  },
  products: [NIGHT_CREAM, LIP_BALM],
  // pageSize 20 is the default a first-time visitor browses at, so the
  // storefront accepts this payload as the grid's page and skips the
  // corrective search -- every search recorded below is one a CLICK caused.
  catalog: { page: 1, pageSize: 20, total: 2, promotion_rules: [HOLIDAY_RULE] },
  meta: {
    categories: [{ id: 1, name: 'Skincare' }, { id: 2, name: 'Lips' }],
    brands: ['Leang'],
    branches: [{ id: 1, name: 'Main' }],
  },
}

const searchRequests: string[] = []

function searchResponse(query: URLSearchParams) {
  const productId = query.get('productId')
  if (productId) {
    const found = [GLOW_SERUM, NIGHT_CREAM, LIP_BALM].filter((product) => String(product.id) === productId)
    return { items: found, total: found.length, page: 1, pageSize: 1, promotion_rules: [HOLIDAY_RULE] }
  }
  if (query.get('promo') === 'rule:7') {
    return { items: [NIGHT_CREAM], total: 1, page: 1, pageSize: 20, promotion_rules: [HOLIDAY_RULE] }
  }
  return { items: [NIGHT_CREAM, LIP_BALM], total: 2, page: 1, pageSize: 20, promotion_rules: [HOLIDAY_RULE] }
}

const fixtureSource = String.raw`
  import { createRoot } from 'react-dom/client'
  import PublicCatalogRoot from '/src/PublicCatalogRoot.tsx'
  import '/src/styles/main.css'

  createRoot(document.getElementById('root')).render(<PublicCatalogRoot />)
`

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

const appPort = await freePort()
const fixtureId = '\0bos-promotion-click-fixture'
const vite = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: appPort, strictPort: true },
  plugins: [{
    name: 'promotion-click-fixture',
    enforce: 'pre',
    resolveId(id) {
      return id === 'virtual:bos-promotion-click-fixture' ? fixtureId : null
    },
    load(id) {
      return id === fixtureId ? fixtureSource : null
    },
    async transform(code, id) {
      if (id !== fixtureId) return null
      const transformed = await transformWithEsbuild(code, 'promotion-click-fixture.tsx', { loader: 'tsx', jsx: 'automatic' })
      return { code: transformed.code, map: null }
    },
    configureServer(server) {
      // Registered inside configureServer (not in a returned post hook), so
      // these run BEFORE vite.config.ts's /api proxy to `wrangler dev`: this
      // test never needs a Worker running.
      const json = (response: { setHeader(name: string, value: string): void; end(body: string): void }, body: unknown) => {
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(body))
      }
      server.middlewares.use('/api/portal/bootstrap', (_request, response) => json(response, BOOTSTRAP))
      server.middlewares.use('/api/portal/promotions', (_request, response) => json(response, { items: [BANNER_PROMOTION] }))
      server.middlewares.use('/api/portal/catalog/products/search', (request, response) => {
        const url = new URL((request as { originalUrl?: string }).originalUrl || request.url || '/', 'http://127.0.0.1')
        searchRequests.push(url.search)
        json(response, searchResponse(url.searchParams))
      })
      // Everything else the storefront probes on mount (account, cart,
      // wishlist, AI status) answers empty rather than erroring, so what is
      // under test is the catalog and not an error state.
      server.middlewares.use('/api/', (_request, response) => json(response, {}))
      server.middlewares.use('/promotion-click-fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.addEventListener("error",function(event){document.body.dataset.fixtureError=String(event.error&&event.error.stack||event.message)});window.addEventListener("unhandledrejection",function(event){document.body.dataset.fixtureError=String(event.reason&&event.reason.stack||event.reason)})</script><script type="module" src="/@id/virtual:bos-promotion-click-fixture"></script></body></html>'
        response.end(await server.transformIndexHtml('/promotion-click-fixture', html))
      })
    },
  }],
})
await vite.listen()

const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-promotion-click-browser-'))
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${appPort}/promotion-click-fixture`,
], { stdio: 'ignore' })
const browserExit = new Promise<void>((resolve) => browser.once('exit', resolve))

type CdpReply = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: any }
const COLD_START_TIMEOUT_MS = 60_000
let socket: WebSocket | null = null
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const browserDiagnostics: string[] = []

async function waitFor<T>(read: () => Promise<T | null>, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  // A read that THROWS is "not ready yet", not a failure. Every read here is a
  // `Runtime.evaluate` over a page that may still be navigating or compiling a
  // module, so a transient CDP error used to escape this loop and end the file
  // before a single assertion ran -- roughly one run in three under load. Only
  // the deadline ends the wait now; the last error travels with the timeout so
  // a persistent fault is still diagnosable rather than a bare "timed out".
  // Same shape as stockChangeComposedResponsive.test.ts, which already had it.
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== null) return value
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out waiting for ${label}; last=${lastError || 'no value'}`)
}
async function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  assert.ok(socket && socket.readyState === WebSocket.OPEN)
  const id = ++nextId
  const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  socket.send(JSON.stringify({ id, method, params }))
  return reply
}
async function evaluate<T>(expression: string): Promise<T> {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text || 'Browser evaluation failed')
  return reply.result.value as T
}
// One click helper for all three paths: find the control by the text a
// shopper actually reads, and fail loudly (not silently) when it is absent.
async function clickByText(text: string, label: string): Promise<void> {
  const clicked = await evaluate<boolean>(`(() => {
    const wanted = ${JSON.stringify(text)}
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => (candidate.textContent || '').includes(wanted))
    if (!button) return false
    button.click()
    return true
  })()`)
  assert.equal(clicked, true, `${label}: no visible control reads "${text}"`)
}
async function openDialogTitle(): Promise<string | null> {
  return await evaluate<string | null>(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (!dialog) return null
    const labelled = dialog.getAttribute('aria-labelledby')
    const title = labelled ? document.getElementById(labelled) : null
    return String((title ? title.textContent : dialog.textContent) || '')
  })()`)
}
async function cardNames(): Promise<string[]> {
  return await evaluate<string[]>(`Array.from(document.querySelectorAll('article[data-product-card="true"]')).map((card) => {
    const name = card.querySelector('[class*="font-medium"]')
    return String((name ? name.textContent : card.textContent) || '').trim()
  })`)
}

try {
  let target: string
  try {
    target = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
        const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>
        return targets.find((item) => item.type === 'page' && item.url?.includes('/promotion-click-fixture'))?.webSocketDebuggerUrl || null
      } catch { return null }
    }, 'the headless browser', COLD_START_TIMEOUT_MS)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; browser discovery failed (exit=${browser.exitCode ?? 'running'}, debugPort=${debugPort}, appPort=${appPort})`)
  }
  socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply
    if (!reply.id && reply.method) {
      if (reply.method === 'Runtime.exceptionThrown') browserDiagnostics.push(`exception: ${reply.params?.exceptionDetails?.text || 'unknown'}`)
      if (reply.method === 'Log.entryAdded') browserDiagnostics.push(`log: ${reply.params?.entry?.level || 'unknown'} ${reply.params?.entry?.text || ''}`)
      return
    }
    if (!reply.id) return
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id)
    if (reply.error) waiter.reject(new Error(reply.error.message || 'CDP command failed'))
    else waiter.resolve(reply.result)
  })
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

  // The storefront opens on the first enabled section (About for this shop,
  // as for the live one), so the visitor taps Products first -- the same way
  // they reach the grid, the promo strip and the offer cards in real use.
  try {
    await waitFor(
      async () => await evaluate<boolean>(`Array.from(document.querySelectorAll('nav button')).some((button) => (button.textContent || '').trim() === 'Products')`) ? true : null,
      'the storefront section nav',
      COLD_START_TIMEOUT_MS,
    )
  } catch (error) {
    const diagnostics = await evaluate(`JSON.stringify({ readyState: document.readyState, error: document.body.dataset.fixtureError, body: document.body.textContent.slice(0, 600) })`)
    throw new Error(`${error instanceof Error ? error.message : String(error)}; browser=${JSON.stringify(browserDiagnostics)}; page=${diagnostics}`)
  }
  await evaluate(`Array.from(document.querySelectorAll('nav button')).find((button) => (button.textContent || '').trim() === 'Products').click()`)

  try {
    await waitFor(async () => (await cardNames()).length === 2 ? true : null, 'the storefront grid', COLD_START_TIMEOUT_MS)
  } catch (error) {
    const diagnostics = await evaluate(`JSON.stringify({ readyState: document.readyState, error: document.body.dataset.fixtureError, body: document.body.textContent.slice(0, 600) })`)
    throw new Error(`${error instanceof Error ? error.message : String(error)}; browser=${JSON.stringify(browserDiagnostics)}; page=${diagnostics}`)
  }
  // Sorted: a browse payload is re-ordered A-Z on the way in (see
  // portalProductGrouping.ts), which is not what this test is about.
  assert.deepEqual([...await cardNames()].sort(), ['Lip Balm', 'Night Cream'], 'the fixture shop loaded its two products')
  assert.deepEqual(searchRequests, [], 'a bootstrap cut at the visitor page size answers the grid on its own')

  // 1. Announcement banner -> "View <product>" opens the product flyout.
  await waitFor(
    async () => await evaluate<boolean>(`Array.from(document.querySelectorAll('button')).some((button) => (button.textContent || '').includes('Winter glow week'))`) ? true : null,
    'the announcement banner',
  )
  const bannerText = await evaluate<string>(`String((Array.from(document.querySelectorAll('button')).find((button) => (button.textContent || '').includes('Winter glow week')) || {}).textContent || '')`)
  assert.match(bannerText, /Glow Serum/, 'the banner card names the product it opens')
  await clickByText('Winter glow week', 'announcement banner card')
  const bannerTitle = await waitFor(async () => await openDialogTitle(), 'the product flyout opened by the banner')
  assert.match(bannerTitle, /Glow Serum/, 'the banner opened the linked product, not some other card')
  assert.deepEqual(
    searchRequests.map((search) => new URLSearchParams(search).get('productId')),
    ['42'],
    'a product that is not on the loaded page costs exactly one by-id lookup',
  )
  assert.equal(new URLSearchParams(searchRequests[0]).get('pageSize'), '1', 'the by-id lookup asks for a single row')

  await evaluate(`document.querySelector('[role="dialog"][aria-modal="true"]').querySelector('button').click()`)
  await waitFor(async () => await openDialogTitle() === null ? true : null, 'the flyout to close')

  // 2. Campaign chip -> the facet reaches the search endpoint and the grid narrows.
  await clickByText('Holiday bundle', 'campaign chip')
  await waitFor(
    async () => searchRequests.some((search) => new URLSearchParams(search).get('promo') === 'rule:7') ? true : null,
    'the campaign facet to reach the server',
  )
  await waitFor(async () => (await cardNames()).length === 1 ? true : null, 'the grid to narrow to the campaign')
  assert.deepEqual(await cardNames(), ['Night Cream'], 'the campaign chip narrowed the grid to its own products')
  assert.equal(
    await evaluate<string | null>(`(Array.from(document.querySelectorAll('button[aria-pressed]')).find((button) => (button.textContent || '').includes('Holiday bundle')) || {}).ariaPressed || null`),
    'true',
    'the chip reads as pressed while its campaign is the active facet',
  )

  // 3. Promotion card CTA -> a product that IS loaded opens with no request.
  const searchesBeforeCard = searchRequests.length
  await clickByText('View product', 'promotion card CTA')
  const cardTitle = await waitFor(async () => await openDialogTitle(), 'the product flyout opened by the promotion card')
  assert.match(cardTitle, /Night Cream/, 'the promotion card opened its own linked product')
  assert.equal(searchRequests.length, searchesBeforeCard, 'a product already on the page is opened from the loaded list, with no extra request')

  console.log(`PASS the real storefront opens the banner product, applies the campaign facet and opens the promotion card product (${searchRequests.length} server searches in total)`)
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close', params: {} }))
  const exited = await Promise.race([browserExit.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))])
  if (!exited) {
    if (process.platform === 'win32' && browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
    else browser.kill()
    await Promise.race([browserExit, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
  }
  for (const waiter of pending.values()) waiter.reject(new Error('Browser closed'))
  pending.clear()
  socket?.close()
  await vite.close()
  // Same retrying removal every browser test here uses -- and it still loses
  // the race sometimes: Chrome on Windows keeps a handle on its profile for a
  // moment after exit, and rmSync throws EPERM. A locked temp directory is not
  // a failed test, so it is reported and left for the OS to sweep rather than
  // turning a green run red (the other fixtures rethrow it: see
  // mobileSectionMenuIcons.test.ts:263 and lazyPortalMenuFirstClick.test.ts:243).
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch (error) {
    console.log(`NOTE browser profile left for the OS to sweep (${(error as { code?: string })?.code || 'unknown'}): ${profile}`)
  }
}
