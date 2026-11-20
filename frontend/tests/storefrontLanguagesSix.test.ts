// Owner, 20 Nov 2026: the storefront offers six languages. Khmer and English are hand-written;
// Chinese Simplified, Chinese Traditional, French and Spanish come from Google Translate in the
// visitor's browser, loaded only after the visitor picks one, and never on the staff app.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as languageOptions from '../src/components/catalog/portalLanguageOptions.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.join(here, '..')
const read = (relative: string) => fs.readFileSync(path.join(frontend, relative), 'utf8')
const failures: string[] = []
const check = (name: string, run: () => void | Promise<void>) => {
  const fail = (error: unknown) => failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`)
  try {
    const result = run()
    if (result && typeof (result as Promise<void>).catch === 'function') return (result as Promise<void>).catch(fail)
  } catch (error) {
    fail(error)
  }
  return undefined
}

const options = languageOptions.PUBLIC_STOREFRONT_LANGUAGE_OPTIONS

check('the menu offers the six, in order, each in its own script', () => {
  assert.deepEqual(options.map((option) => option.value), ['km', 'en', 'zh-CN', 'zh-TW', 'fr', 'es'])
  assert.deepEqual(options.map((option) => option.label), ['ភាសាខ្មែរ', 'English', '简体中文', '繁體中文', 'Français', 'Español'])
})

check('exactly the four Google rows are marked, Khmer and English are not', () => {
  assert.deepEqual(options.filter((option) => option.google).map((option) => option.value), ['zh-CN', 'zh-TW', 'fr', 'es'])
})

check('Khmer is the default', () => {
  assert.equal(languageOptions.PUBLIC_STOREFRONT_DEFAULT_LANGUAGE, 'km')
})

check('the Worker and the editor only ever get km or en', () => {
  assert.deepEqual(languageOptions.PORTAL_COPY_LANGUAGE_OPTIONS.map((option) => option.value), ['km', 'en'])
  const normalize = languageOptions.normalizePortalLanguage
  for (const other of ['fr', 'zh-CN', 'zh-TW', 'es', 'nl', 'original', '', null]) assert.equal(normalize(other), '', `${String(other)} is not a hand-written language`)
  assert.equal(normalize('KM'), 'km')
  assert.equal(normalize(' en '), 'en')
})

check('a Google language sits on top of English copy', () => {
  assert.equal(languageOptions.portalCopyLanguage('km'), 'km')
  assert.equal(languageOptions.portalCopyLanguage('en'), 'en')
  for (const google of ['zh-CN', 'zh-TW', 'fr', 'es']) {
    assert.equal(languageOptions.portalCopyLanguage(google), 'en', google)
    assert.equal(languageOptions.isGoogleLanguageChoice(google), true, google)
  }
  assert.equal(languageOptions.isGoogleLanguageChoice('km'), false)
  assert.equal(languageOptions.isGoogleLanguageChoice('en'), false)
  assert.equal(languageOptions.portalCopyLanguage('xx'), 'km')
})

check('choice values normalise by case: zh-cn is zh-CN', () => {
  assert.equal(languageOptions.normalizePortalChoice('ZH-cn'), 'zh-CN')
  assert.equal(languageOptions.normalizePortalChoice('de'), '')
})

const catalog = (file: string) => read(`src/components/catalog/${file}`)

check('the shared menu renders the options it is given, with a Google tag and no-translate labels', () => {
  const surface = catalog('CatalogPreviewSurface.tsx')
  assert.match(surface, /\{languageOptions\.map\(/)
  assert.match(surface, /languageOptions = PUBLIC_STOREFRONT_LANGUAGE_OPTIONS/)
  assert.match(surface, /option\.google \?[\s\S]{0,260}>Google</)
  assert.match(surface, /<span translate="no" className="notranslate">\{option\.label\}<\/span>/)
})

check('the editor preview offers only the hand-written two', () => {
  assert.match(catalog('CatalogPage.tsx'), /languageOptions=\{PORTAL_COPY_LANGUAGE_OPTIONS\}/)
})

check('the live page keeps the Worker-facing language at km or en', () => {
  const page = catalog('PublicCatalogPage.tsx')
  assert.match(page, /const pageLanguage = portalCopyLanguage\(pageChoice\)/)
  assert.match(page, /pageLanguageChoice=\{pageChoice\}/)
})

// Load-on-pick and the admin refusal -----------------------------------------------------

check('the controller is imported only from the storefront tree, and only dynamically', () => {
  const importers: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name) && !/portalTranslateController\.ts$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        if (/portalTranslateController/.test(text)) importers.push(path.relative(frontend, full).replace(/\\/g, '/'))
      }
    }
  }
  walk(path.join(frontend, 'src'))
  assert.deepEqual(importers, ['src/components/catalog/PublicCatalogPage.tsx'])
  const page = catalog('PublicCatalogPage.tsx')
  assert.doesNotMatch(page, /^import[^\n]*portalTranslateController/m, 'a static import would put Google code in the catalog chunk')
  assert.equal((page.match(/import\('\.\/portalTranslateController\.ts'\)/g) || []).length, 2, 'apply and remove, both lazy')
})

check('the controller is a chunk of its own, so Khmer and English visitors never fetch it', () => {
  assert.match(read('vite.config.ts'), /portalTranslateController\.ts'\)\) return 'portal-translate'/)
})

check('the page only calls apply for a Google choice', () => {
  const page = catalog('PublicCatalogPage.tsx')
  assert.match(page, /if \(!isGoogleLanguageChoice\(pageChoice\)\) return undefined[\s\S]{0,1500}import\('\.\/portalTranslateController\.ts'\)\s*\.then\(\(controller\) => controller\.applyPortalGoogleTranslateOrFallBack\(/)
})

check('the controller refuses on an admin hostname', () => {
  const controller = catalog('portalTranslateController.ts')
  assert.match(controller, /import \{ isAdminHostname \} from '\.\.\/\.\.\/app\/pathRouting\.ts'/)
  assert.match(controller, /return !isAdminHostname\(\)/)
  assert.match(controller, /if \(!canRunPortalTranslate\(\) \|\| !isPortalTranslateTarget\(target\)\) return false/)
})

type FakeNode = Record<string, unknown> & { children?: FakeNode[] }
const globals = globalThis as unknown as { window?: unknown; document?: unknown }
const savedWindow = globals.window
const savedDocument = globals.document

function installFakeBrowser(hostname: string) {
  const appended: FakeNode[] = []
  const cookies: string[] = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  const make =(tag: string): FakeNode => ({ tag, style: {}, setAttribute() {}, dataset: {} })
  globals.window = {
    location: { hostname, pathname: '/', reload() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn: () => void, ms?: number) => { timers.push({ fn, ms: Number(ms) || 0 }); return timers.length },
    clearTimeout: () => {},
  }
  globals.document = {
    documentElement: { className: '' },
    get cookie() { return cookies.join('; ') },
    set cookie(value: string) { cookies.push(value) },
    getElementById: () => null,
    querySelector: () => null,
    createElement: make,
    head: { appendChild: (node: FakeNode) => { appended.push(node) } },
    body: { className: '', appendChild: (node: FakeNode) => { appended.push(node) } },
  }
  return { appended, cookies, timers }
}

const controllerModule = await import('../src/components/catalog/portalTranslateController.ts')

await check('on an admin hostname the controller loads nothing and writes nothing', async () => {
  for (const host of ['admin.leangbeauty.com', 'localhost', '127.0.0.1']) {
    const { appended, cookies } = installFakeBrowser(host)
    assert.equal(await controllerModule.applyPortalGoogleTranslate('fr'), false, host)
    assert.deepEqual(appended, [], `${host} appended a node`)
    assert.deepEqual(cookies, [], `${host} wrote a cookie`)
  }
})

await check('on a shop hostname, picking a Google language writes googtrans and fetches the script; nothing before', async () => {
  const { appended, cookies } = installFakeBrowser('leangbeauty.com')
  assert.deepEqual(appended, [], 'importing the controller must not load anything')
  const pending = controllerModule.applyPortalGoogleTranslate('zh-TW')
  // Google never answers in this fake: fire the script error so the promise settles.
  await Promise.resolve()
  const script = (appended as FakeNode[]).find((node) => node.tag === 'script') as (FakeNode & { src?: string; onerror?: () => void }) | undefined
  assert.ok(script, 'a script element was added')
  assert.match(String(script.src), /^https:\/\/translate\.google\.com\/translate_a\/element\.js\?cb=businessOsPortalTranslateInit$/)
  assert.ok(cookies.includes('googtrans=/en/zh-TW; path=/; SameSite=Lax'), cookies.join(' | '))
  script.onerror?.()
  assert.equal(await pending, false, 'a failed load resolves false so the page falls back to English')
})

await check('only the four targets are accepted', async () => {
  const { appended, cookies } = installFakeBrowser('leangbeauty.com')
  for (const other of ['km', 'en', 'de', '', undefined]) assert.equal(await controllerModule.applyPortalGoogleTranslate(other), false, String(other))
  assert.deepEqual(appended, [])
  assert.deepEqual(cookies, [])
})

await check('leaving a Google language clears googtrans on the host and every parent domain', () => {
  const { cookies } = installFakeBrowser('shop.leangbeauty.com')
  assert.equal(controllerModule.removePortalGoogleTranslate(), 'clean', 'nothing was rewritten, so no reload')
  const cleared = cookies.filter((value) => value.startsWith('googtrans=;') && /expires=Thu, 01 Jan 1970/.test(value))
  assert.ok(cleared.some((value) => !/domain=/.test(value)), 'host-only variant')
  assert.ok(cleared.some((value) => /domain=shop\.leangbeauty\.com;/.test(value)), 'exact host')
  assert.ok(cleared.some((value) => /domain=\.shop\.leangbeauty\.com;/.test(value)), 'dotted host')
  assert.ok(cleared.some((value) => /domain=\.leangbeauty\.com;/.test(value)), 'parent domain')
})

// F6: when Google does not translate, the visitor is put back and told, with no retry and no reload.
const { resolveStorefrontCopy } = await import('../src/components/catalog/portalLanguagePacks.ts')
const { storefrontTranslator } = await import('./storefrontCopyScan.ts')
const translator = storefrontTranslator()
const noticeFor = (language: 'en' | 'km') => resolveStorefrontCopy(language, translator, 'translateUnavailable', 'Translation is not available right now.', 'ឥឡូវនេះមិនអាចបកប្រែបានទេ។')

function fallbackRecorder(previous: 'en' | 'km') {
  const seen = { menu: '' as string, notice: '' as string, calls: 0 }
  return {
    seen,
    fallback: {
      previous,
      restoreChoice: (choice: 'en' | 'km') => { seen.menu = choice; seen.calls += 1 },
      showNotice: (language: 'en' | 'km') => { seen.notice = noticeFor(language) },
    },
  }
}
const googtransCleared = (cookies: string[]) => cookies.some((value) => value.startsWith('googtrans=;') && /expires=Thu, 01 Jan 1970/.test(value))

await check('a script that fails to load puts the menu back on the previous language, clears googtrans and says so', async () => {
  for (const previous of ['km', 'en'] as const) {
    const { appended, cookies } = installFakeBrowser('leangbeauty.com')
    const { seen, fallback } = fallbackRecorder(previous)
    const pending = controllerModule.applyPortalGoogleTranslateOrFallBack('fr', fallback)
    await Promise.resolve()
    const script = (appended as FakeNode[]).find((node) => node.tag === 'script') as (FakeNode & { onerror?: () => void }) | undefined
    assert.ok(script, 'the script was added')
    script.onerror?.()
    assert.equal(await pending, false)
    assert.equal(seen.menu, previous, 'the menu is back on the language the visitor had')
    assert.equal(seen.calls, 1, 'no retry loop')
    assert.ok(googtransCleared(cookies), 'googtrans cleared')
    assert.equal(seen.notice, previous === 'km' ? 'ឥឡូវនេះមិនអាចបកប្រែបានទេ។' : 'Translation is not available right now.', 'the notice is in that language')
    assert.equal(appended.filter((node) => node.tag === 'script').length, 1, 'no second request to Google')
  }
})

await check('a script that loads but never reports ready gives up at the timeout and does the same', async () => {
  const { appended, cookies, timers } = installFakeBrowser('leangbeauty.com')
  const { seen, fallback } = fallbackRecorder('km')
  const pending = controllerModule.applyPortalGoogleTranslateOrFallBack('es', fallback)
  await Promise.resolve()
  assert.ok((appended as FakeNode[]).some((node) => node.tag === 'script'), 'the script was added')
  // Google's callback never fires: only the clock can end the wait.
  const limit = timers.find((timer) => timer.ms === controllerModule.PORTAL_TRANSLATE_TIMEOUT_MS)
  assert.ok(limit, 'one timeout covers the whole wait')
  assert.equal(seen.calls, 0, 'nothing has been decided before the limit')
  limit.fn()
  assert.equal(await pending, false)
  assert.equal(seen.menu, 'km')
  assert.ok(googtransCleared(cookies), 'googtrans cleared')
  assert.equal(seen.notice, 'ឥឡូវនេះមិនអាចបកប្រែបានទេ។')
  assert.equal(seen.calls, 1)
})

await check('the notice is real Khmer and real English, and a successful pick shows nothing', async () => {
  assert.equal(noticeFor('en'), 'Translation is not available right now.')
  assert.match(noticeFor('km'), /[ក-៿]/)
  assert.notEqual(noticeFor('km'), noticeFor('en'))
  installFakeBrowser('leangbeauty.com')
  const { seen, fallback } = fallbackRecorder('en')
  const combo = { value: '', dispatchEvent() { return true } }
  ;(globals.document as Record<string, unknown>).querySelector = (selector: string) => (selector === '.goog-te-combo' ? combo : null)
  assert.equal(await controllerModule.applyPortalGoogleTranslateOrFallBack('fr', fallback), true)
  assert.equal(seen.calls, 0)
  assert.equal(seen.notice, '')
})

globals.window = savedWindow
globals.document = savedDocument

assert.deepEqual(failures, [], `six storefront languages:\n  ${failures.join('\n  ')}`)
console.log('PASS six languages, four through Google Translate, loaded only on pick and refused on admin hosts')
