// P2 (PUBLIC-PAINT-FINAL section 5): the storefront never paints a default or
// an old look. It paints the Worker's paint embed, or a neutral skeleton until a
// real config arrives, and a translated retry state when none ever does. It
// keeps no saved copy of the shop: speed caches never feed prices.
//
// Run: node tests/publicFirstPaint.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mock } from 'node:test'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type FirstPaint = typeof import('../src/components/catalog/publicFirstPaint.ts')
let firstPaint: FirstPaint | null = null
try {
  firstPaint = await import('../src/components/catalog/publicFirstPaint.ts')
} catch (error) {
  console.error('publicFirstPaint.ts could not be loaded:', (error as Error).message)
}
const need = (): FirstPaint => { assert.ok(firstPaint, 'components/catalog/publicFirstPaint.ts exists'); return firstPaint! }

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

const publicPage = () => code(read('../src/components/catalog/PublicCatalogPage.tsx'))
const secondaryTabs = () => code(read('../src/components/catalog/CatalogSecondaryTabs.tsx'))
const previewSurface = () => code(read('../src/components/catalog/CatalogPreviewSurface.tsx'))
const publicRoot = () => code(read('../src/PublicCatalogRoot.tsx'))
const embedFixture = JSON.parse(read('../e2e/fixtures/portal-paint-embed.json')) as { kind: string; v: number; config: Record<string, unknown> }
const embedText = (value: unknown): string => JSON.stringify(value)
const RETIRED_CACHE_KEY = 'business-os-catalog-portal-cache'
const SHOPPER_LIST_KEY = 'business-os-portal-bucket-v1'
const OLD_DEFAULT_GRADIENT = ['#0f172a', '#14532d', '#ea580c']

// ---------------------------------------------------------------------------
// The storefront keeps no saved copy of the shop (D3, C6, owner rule).
// ---------------------------------------------------------------------------

await runTest('no code path reads or writes the retired storefront cache; the page only removes it', () => {
  const page = publicPage()
  assert.doesNotMatch(page, /function readPortalCache|function writePortalCache|readPortalCache\(|writePortalCache\(/, 'the storefront no longer reads or writes a saved copy')
  assert.doesNotMatch(page, new RegExp(RETIRED_CACHE_KEY), 'the key is named once, in publicFirstPaint.ts, next to its removal')
  assert.doesNotMatch(page, /cachedPortal/, 'nothing seeds state from a saved copy')
  assert.match(page, /clearRetiredPortalCache\(\)/, 'the page clears the old copy on load')
  const module = code(read('../src/components/catalog/publicFirstPaint.ts'))
  const keyUses = module.split(RETIRED_CACHE_KEY).length - 1
  assert.equal(keyUses, 1, 'the retired key is declared exactly once')
  assert.doesNotMatch(module, /getItem\(RETIRED_PORTAL_CACHE_KEY|setItem\(RETIRED_PORTAL_CACHE_KEY/, 'the retired key is never read or written')
  assert.match(module, /removeItem\(RETIRED_PORTAL_CACHE_KEY\)/)
})

await runTest('clearRetiredPortalCache empties both storages, keeps the shopper list, and survives blocked site data', () => {
  const { clearRetiredPortalCache } = need()
  const makeStore = () => {
    const entries = new Map<string, string>([[RETIRED_CACHE_KEY, '{"config":{"businessCover":"/uploads/old.png"}}'], [SHOPPER_LIST_KEY, '[{"id":7,"qty":2}]']])
    return { entries, store: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) }, removeItem: (key: string) => { entries.delete(key) } } }
  }
  const local = makeStore()
  const session = makeStore()
  const host = globalThis as Record<string, unknown>
  const previousWindow = host.window
  try {
    host.window = { localStorage: local.store, sessionStorage: session.store }
    clearRetiredPortalCache()
    assert.equal(local.entries.has(RETIRED_CACHE_KEY), false, 'localStorage copy removed')
    assert.equal(session.entries.has(RETIRED_CACHE_KEY), false, 'sessionStorage copy removed')
    assert.equal(local.entries.get(SHOPPER_LIST_KEY), '[{"id":7,"qty":2}]', 'the shopper list is untouched')
    assert.equal(session.entries.get(SHOPPER_LIST_KEY), '[{"id":7,"qty":2}]')

    const blocked = {}
    for (const property of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(blocked, property, { configurable: true, get() { throw new Error('SecurityError: The operation is insecure.') } })
    }
    host.window = blocked
    assert.doesNotThrow(() => clearRetiredPortalCache(), 'Safari private mode throws on the storage getter itself')
    const onlySession = makeStore()
    const localBlocked = { sessionStorage: onlySession.store }
    Object.defineProperty(localBlocked, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
    host.window = localBlocked
    clearRetiredPortalCache()
    assert.equal(onlySession.entries.has(RETIRED_CACHE_KEY), false, 'one blocked storage does not stop the other from being cleared')
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(host, 'window')
    else host.window = previousWindow
  }
})

await runTest('the old full-bootstrap embed and its window global are gone from the storefront', () => {
  for (const [name, source] of [['PublicCatalogPage.tsx', publicPage()], ['publicFirstPaint.ts', code(read('../src/components/catalog/publicFirstPaint.ts'))]] as const) {
    assert.doesNotMatch(source, /business-os-portal-bootstrap|__businessOsPortalBootstrap|readEmbeddedPortalBootstrap/, `${name} must not read the retired bootstrap embed`)
  }
})

// ---------------------------------------------------------------------------
// The paint embed (D2): only {kind:'paint', v:1, config:{...}}, allow-listed.
// ---------------------------------------------------------------------------

await runTest('the paint reader accepts the contract fixture and keeps exactly the allow-listed keys', () => {
  const { parsePaintEmbed, PAINT_CONFIG_KEYS, PAINT_EMBED_MAX_BYTES } = need()
  assert.equal(PAINT_EMBED_MAX_BYTES, 6 * 1024)
  assert.ok(new TextEncoder().encode(embedText(embedFixture)).length <= PAINT_EMBED_MAX_BYTES, 'the contract fixture fits under the cap')
  assert.deepEqual([...PAINT_CONFIG_KEYS].sort(), Object.keys(embedFixture.config).sort(), 'the fixture names every allow-listed key once: P1 reads the same file')
  assert.deepEqual(parsePaintEmbed(embedText(embedFixture)), embedFixture.config)
})

await runTest('the paint reader drops every key outside the allow-list (prices, money, points, submissions, AI prompt)', () => {
  const { parsePaintEmbed } = need()
  const smuggled = { ...embedFixture.config, showPrices: true, exchangeRate: 4100, priceDisplay: 'BOTH', redeemPoints: 100, submissionEnabled: true, showMembership: true, aiPrompt: 'secret', faqItems: [{ id: 1 }], promoItems: [{ id: 1 }], aboutBlocks: [{ id: 1 }], lowStockThreshold: 5 }
  const config = parsePaintEmbed(embedText({ kind: 'paint', v: 1, config: smuggled }))
  assert.ok(config)
  for (const key of ['showPrices', 'exchangeRate', 'priceDisplay', 'redeemPoints', 'submissionEnabled', 'showMembership', 'aiPrompt', 'faqItems', 'promoItems', 'aboutBlocks', 'lowStockThreshold']) {
    assert.equal(key in config, false, `${key} must never reach the first paint`)
  }
})

await runTest('the paint reader rejects another kind, another version, arrays, malformed JSON and oversized text', () => {
  const { parsePaintEmbed, PAINT_EMBED_MAX_BYTES } = need()
  const config = { businessName: 'Paint Fixture Shop' }
  const rejected: Array<[string, string]> = [
    ['kind bootstrap', embedText({ kind: 'bootstrap', v: 1, config })],
    ['no kind', embedText({ v: 1, config })],
    ['version 2', embedText({ kind: 'paint', v: 2, config })],
    ['version as text', embedText({ kind: 'paint', v: '1', config })],
    ['top-level array', embedText([{ kind: 'paint', v: 1, config }])],
    ['config array', embedText({ kind: 'paint', v: 1, config: [config] })],
    ['config null', embedText({ kind: 'paint', v: 1, config: null })],
    ['malformed JSON', '{"kind":"paint","v":1,'],
    ['empty', ''],
  ]
  for (const [label, raw] of rejected) assert.equal(parsePaintEmbed(raw), null, label)

  const padded = (filler: string, count: number) => embedText({ kind: 'paint', v: 1, config: { businessName: 'Paint', aboutContent: filler.repeat(count) } })
  assert.ok(parsePaintEmbed(padded('a', PAINT_EMBED_MAX_BYTES - 200)), 'just under the cap is accepted')
  assert.equal(parsePaintEmbed(padded('a', PAINT_EMBED_MAX_BYTES)), null, 'over the cap is refused')
  const khmer = padded('ក', 2100)
  assert.ok(khmer.length < PAINT_EMBED_MAX_BYTES, 'fewer characters than the cap...')
  assert.ok(new TextEncoder().encode(khmer).length > PAINT_EMBED_MAX_BYTES, '...but more bytes: Khmer is three bytes a character')
  assert.equal(parsePaintEmbed(khmer), null, 'the cap counts serialized bytes, like the Worker that writes it')
})

await runTest('the paint reader drops a value of the wrong type instead of letting it reach the page', () => {
  const { parsePaintEmbed } = need()
  const config = parsePaintEmbed(embedText({ kind: 'paint', v: 1, config: { businessName: { html: '<b>x</b>' }, showAbout: 'yes', logoSize: '96', links: ['https://x.test'], contactLinks: { telegram: 7 }, businessTagline: 'Kept' } }))
  assert.deepEqual(config, { businessTagline: 'Kept' })
})

await runTest('readPaintEmbed reads #business-os-portal-paint and nothing else', () => {
  const { readPaintEmbed, PAINT_EMBED_ELEMENT_ID } = need()
  assert.equal(PAINT_EMBED_ELEMENT_ID, 'business-os-portal-paint')
  const docWith = (nodes: Record<string, string>) => ({ getElementById: (id: string) => (id in nodes ? { textContent: nodes[id] } : null) })
  assert.deepEqual(readPaintEmbed(docWith({ 'business-os-portal-paint': `  ${embedText(embedFixture)}\n` })), embedFixture.config)
  assert.equal(readPaintEmbed(docWith({})), null)
  assert.equal(readPaintEmbed(docWith({ 'business-os-portal-bootstrap': embedText({ config: embedFixture.config, products: [] }) })), null, 'the retired full-bootstrap id is never read')
  assert.equal(readPaintEmbed(undefined), null)
})

// ---------------------------------------------------------------------------
// Fail closed (D4) and URLs as-is.
// ---------------------------------------------------------------------------

function loadDefaultPublicConfig(): Record<string, unknown> {
  const literal = between(read('../src/components/catalog/PublicCatalogPage.tsx'), 'const DEFAULT_PUBLIC_CONFIG: PortalConfig = {', '\n}\n')
  return new Function(`return ${literal.slice(literal.indexOf('{'))}\n}`)() as Record<string, unknown>
}

await runTest('DEFAULT_PUBLIC_CONFIG carries no shop name, fails closed, and has no navy/green/orange hero', () => {
  const defaults = loadDefaultPublicConfig()
  assert.equal(defaults.businessName, '', 'no default shop name')
  assert.equal(defaults.title, '', 'no default title')
  for (const key of ['showPrices', 'showStockStatus', 'showOutOfStockProducts', 'showMembership', 'submissionEnabled', 'aiEnabled']) {
    assert.equal(defaults[key], false, `${key} must default to false`)
  }
  for (const key of ['heroGradientStart', 'heroGradientMid', 'heroGradientEnd']) {
    assert.equal(OLD_DEFAULT_GRADIENT.includes(String(defaults[key]).toLowerCase()), false, `${key} must not be the old default colour`)
  }
})

await runTest('the storefront uses the cover, logo and About picture URLs as-is (no self-seeded ?v=)', () => {
  const page = publicPage()
  assert.doesNotMatch(page, /withAssetVersion/, 'a ?v= seed makes the page request a different URL than the Worker preloads')
  assert.match(page, /versionedBusinessCover=\{businessCoverUrl\}/)
  assert.match(page, /versionedBusinessLogo=\{businessLogoUrl\}/)
})

// ---------------------------------------------------------------------------
// Bounded failure (R1, C9): the pending state always ends.
// ---------------------------------------------------------------------------

type Outcome = { config: unknown[]; bootstrap: unknown[]; bootstrapFailed: number; failed: number }
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function track(): { outcome: Outcome; handlers: { onConfig: (c: unknown) => void; onBootstrap: (p: unknown) => void; onBootstrapFailed: () => void; onFailed: () => void } } {
  const outcome: Outcome = { config: [], bootstrap: [], bootstrapFailed: 0, failed: 0 }
  return {
    outcome,
    handlers: {
      onConfig: (c) => { outcome.config.push(c) },
      onBootstrap: (p) => { outcome.bootstrap.push(p) },
      onBootstrapFailed: () => { outcome.bootstrapFailed += 1 },
      onFailed: () => { outcome.failed += 1 },
    },
  }
}

await runTest('timer-driven: with nothing answering, the failure state arrives at the bootstrap budget, not before', async () => {
  const { startStorefrontLoad, PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS, PUBLIC_PORTAL_CONFIG_TIMEOUT_MS } = need()
  assert.equal(PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS, 15_000)
  assert.equal(PUBLIC_PORTAL_CONFIG_TIMEOUT_MS, 8_000)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { outcome, handlers } = track()
    startStorefrontLoad({ fetchBootstrap: () => new Promise(() => {}), fetchConfig: () => new Promise(() => {}), ...handlers })
    mock.timers.tick(PUBLIC_PORTAL_CONFIG_TIMEOUT_MS)
    await flush()
    assert.equal(outcome.failed, 0, 'the config budget alone does not end the wait while the bootstrap may still answer')
    mock.timers.tick(PUBLIC_PORTAL_BOOTSTRAP_TIMEOUT_MS - PUBLIC_PORTAL_CONFIG_TIMEOUT_MS - 1)
    await flush()
    assert.equal(outcome.failed, 0)
    mock.timers.tick(1)
    await flush()
    assert.equal(outcome.failed, 1, 'the skeleton is never permanent')
    assert.equal(outcome.bootstrapFailed, 0)
  } finally {
    mock.timers.reset()
  }
})

await runTest('both requests refused at once (offline, 500) end the wait at once', async () => {
  const { startStorefrontLoad } = need()
  const { outcome, handlers } = track()
  startStorefrontLoad({ fetchBootstrap: () => Promise.reject(new Error('Portal bootstrap failed: 500')), fetchConfig: () => Promise.reject(new Error('Portal config failed: 500')), ...handlers })
  await flush()
  assert.equal(outcome.failed, 1)
})

await runTest('the config paints first, the bootstrap still wins, and a later bootstrap failure is not a page failure', async () => {
  const { startStorefrontLoad } = need()
  const bootstrap = deferred<unknown>()
  const { outcome, handlers } = track()
  startStorefrontLoad({ fetchBootstrap: () => bootstrap.promise, fetchConfig: () => Promise.resolve({ businessName: 'From config' }), ...handlers })
  await flush()
  assert.deepEqual(outcome.config, [{ businessName: 'From config' }])
  bootstrap.reject(new Error('Portal bootstrap failed: 500'))
  await flush()
  assert.equal(outcome.failed, 0, 'a real config is on screen: only the products fail')
  assert.equal(outcome.bootstrapFailed, 1)

  const late = deferred<unknown>()
  const second = track()
  startStorefrontLoad({ fetchBootstrap: () => Promise.resolve({ config: { businessName: 'From bootstrap' } }), fetchConfig: () => late.promise, ...second.handlers })
  await flush()
  late.resolve({ businessName: 'Late config' })
  await flush()
  assert.equal(second.outcome.bootstrap.length, 1)
  assert.deepEqual(second.outcome.config, [], 'a config that lands after the bootstrap never overwrites it')
})

await runTest('a failed config fetch waits for the bootstrap instead of failing the page', async () => {
  const { startStorefrontLoad } = need()
  const bootstrap = deferred<unknown>()
  const { outcome, handlers } = track()
  startStorefrontLoad({ fetchBootstrap: () => bootstrap.promise, fetchConfig: () => Promise.reject(new Error('Portal config failed: 503')), ...handlers })
  await flush()
  assert.equal(outcome.failed, 0)
  bootstrap.resolve({ config: { businessName: 'Recovered' } })
  await flush()
  assert.equal(outcome.bootstrap.length, 1)
  assert.equal(outcome.failed, 0)
})

await runTest('with a paint embed in hand, the config is never fetched and a bootstrap failure never fails the page', async () => {
  const { startStorefrontLoad } = need()
  const { outcome, handlers } = track()
  startStorefrontLoad({ fetchBootstrap: () => Promise.reject(new Error('Portal bootstrap failed: 500')), fetchConfig: null, ...handlers })
  await flush()
  assert.equal(outcome.failed, 0)
  assert.equal(outcome.bootstrapFailed, 1)
})

await runTest('a cancelled load (unmount, pull-to-refresh) reports nothing', async () => {
  const { startStorefrontLoad } = need()
  const bootstrap = deferred<unknown>()
  const { outcome, handlers } = track()
  const cancel = startStorefrontLoad({ fetchBootstrap: () => bootstrap.promise, fetchConfig: () => Promise.reject(new Error('x')), ...handlers })
  cancel()
  bootstrap.reject(new Error('Portal bootstrap failed: 500'))
  await flush()
  assert.deepEqual(outcome, { config: [], bootstrap: [], bootstrapFailed: 0, failed: 0 })
})

await runTest('the page wires the load: parallel config only without an embed, translated failure, Retry on every tab, no raw error text', () => {
  const page = publicPage()
  assert.match(page, /readPaintEmbed\(\)/, 'the page reads the paint embed')
  assert.match(page, /startStorefrontLoad\(/)
  assert.match(page, /fetchConfig: realConfigInHand \? null : /, 'the config is fetched only when no real config is in hand yet')
  assert.match(page, /getPortalConfig/)
  assert.doesNotMatch(page, /setPortalError\(getErrorMessage\(/, 'a raw error message ("Portal bootstrap failed: 500") never reaches the shopper')
  assert.match(page, /copy\('portalLoadFailed', "We couldn't open the shop\. Check your connection and try again\.", '[^']+'\)/)
  assert.match(page, /copy\('retry', 'Retry', 'ព្យាយាមម្ដងទៀត'\)/)
  const failurePanel = between(page, 'const loadFailedPanel = ', '\n  )\n')
  assert.match(failurePanel, /data-portal-load-failed="true"/)
  assert.match(failurePanel, /role="alert"/)
  assert.match(failurePanel, /<RotateCw /, 'Retry is icon + one word')
  assert.match(page, /secondaryTabSection=\{loadFailed \? loadFailedPanel : /, 'the failure replaces the content of every tab')
})

await runTest('the pack key sits next to loadingPortal in both packs with the approved wording', () => {
  const en = read('../src/lang/en.json')
  const km = read('../src/lang/km.json')
  assert.match(en, /\n {2}"loadingPortal": "Loading website\.\.\.",\n {2}"portalLoadFailed": "We couldn't open the shop\. Check your connection and try again\.",\n/)
  assert.match(km, /\n {2}"loadingPortal": "[^"]+",\n {2}"portalLoadFailed": "យើងមិនអាចបើកហាងបានទេ។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ហើយព្យាយាមម្ដងទៀត។",\n/)
})

// ---------------------------------------------------------------------------
// The skeleton: one neutral, hero-shaped look everywhere the real one is not ready.
// ---------------------------------------------------------------------------

await runTest('the skeleton is hero-shaped, busy, labelled, nameless, and not mistaken for product skeletons', () => {
  const skeleton = code(read('../src/components/catalog/PublicStorefrontSkeleton.tsx'))
  assert.match(skeleton, /aria-busy="true"/)
  assert.match(skeleton, /role="status"/)
  assert.match(skeleton, /\{label\}/, 'the translated label is announced')
  assert.match(skeleton, /data-portal-skeleton="true"/)
  assert.match(skeleton, /h-20 sm:h-28/, 'the same strip height as the About hero')
  assert.doesNotMatch(skeleton, /Leang|Welcome to our store|aspect-square/, 'no name, no fallback story, no product-skeleton lookalike')
})

await runTest('the About tab and header show the skeleton while pending; the editor preview defaults to not pending', () => {
  const tabs = secondaryTabs()
  assert.match(tabs, /configPending = false/, 'CatalogSecondaryTabs defaults to the real look (the Website Editor preview)')
  assert.match(tabs, /if \(configPending\) return <PublicStorefrontSkeleton /)
  const surface = previewSurface()
  assert.match(surface, /configPending = false/, 'CatalogPreviewSurface defaults to the real look')
  const heading = between(surface, '<h1', '</h1>')
  assert.match(heading, /configPending \?/, 'the header name keeps its height as a skeleton while pending')
  const page = publicPage()
  assert.match(page, /configPending=\{!realConfigInHand\}/)
  assert.match(page, /footer=\{realConfigInHand \? /, 'the footer waits for the real business details')
})

await runTest('the landing cover is fetched first and fades in; the PublicCatalogRoot fallback is the same skeleton', () => {
  const about = between(secondaryTabs(), 'function CatalogAboutSection(', '\nfunction CatalogFaqSection(')
  const cover = about.slice(about.indexOf('data-portal-cover="true"') - 300, about.indexOf('data-portal-cover="true"') + 300)
  assert.match(cover, /fetchPriority=\{imageFetchPriority\}/)
  assert.match(cover, /onLoad=/, 'the cover fades in once decoded')
  assert.match(publicPage(), /imageFetchPriority="high"/)
  const root = publicRoot()
  assert.match(root, /<PublicStorefrontSkeleton /)
  assert.match(root, /'loadingPortal'/)
  assert.doesNotMatch(root, /Loading catalog\.\.\./)
})

await runTest('build placement: the skeleton sits in catalog-public-core, the first-paint logic with its only consumer', () => {
  const vite = read('../vite.config.ts')
  const core = between(vite, "normalized.includes('/src/components/catalog/catalogImages.tsx')", "return 'catalog-public-core'")
  assert.match(core, /\/src\/components\/catalog\/PublicStorefrontSkeleton\.tsx/)
  const pub = between(vite, "normalized.includes('/src/components/catalog/PublicCatalogPage.tsx')", "return 'catalog-public'")
  assert.match(pub, /\/src\/components\/catalog\/publicFirstPaint\.ts/)
})

if (failed) {
  console.error(`\n${failed} publicFirstPaint check(s) failed`)
  process.exit(1)
}
console.log('\nPASS publicFirstPaint')
