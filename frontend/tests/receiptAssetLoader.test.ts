import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createReceiptAssetLoader, inlineReceiptAssets, ReceiptAssetError } from '../src/utils/receiptAssetLoader.ts'

const originalFetch = globalThis.fetch
const originalReader = globalThis.FileReader
class Reader {
  static instances: Reader[] = []
  static hold = false
  readyState = 0
  result = 'data:image/png;base64,cHJpbnQ='
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  aborted = false
  constructor() { Reader.instances.push(this) }
  readAsDataURL() { this.readyState = 1; if (!Reader.hold) queueMicrotask(() => { this.readyState = 2; this.onload?.() }) }
  abort() { this.aborted = true; this.readyState = 2; this.onabort?.() }
}
globalThis.FileReader = Reader as unknown as typeof FileReader
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const held = <T>() => new Promise<T>(() => {})
const baseUrl = 'https://receipt.test/app'
const response = () => new Response(new Blob(['print'], { type: 'image/png' }))
let passed = 0
async function check(name: string, run: () => Promise<void>) {
  Reader.instances = []; Reader.hold = false
  await run(); passed++; console.log(`PASS ${name}`)
}
try {
  await check('duplicate and equivalent image/style URLs share bytes only within one preparation', async () => {
    let calls = 0
    globalThis.fetch = async () => { calls++; return response() }
    const assets = createReceiptAssetLoader({ baseUrl })
    const first = assets.load('/asset.png')
    assert.equal(assets.load('https://receipt.test/asset.png'), first)
    const result = await first
    assert.equal(await assets.load('/asset.png'), result) // later CSS stage
    assert.equal(calls, 1)
    assert.equal(Reader.instances.length, 1)
    assert.equal(Reader.instances[0].onload, null)
    assets.dispose()
    const next = createReceiptAssetLoader({ baseUrl })
    await next.load('/asset.png'); next.dispose()
    assert.equal(calls, 2)
  })
  for (const stage of ['headers', 'body', 'reader'] as const) {
    await check(`one deadline covers held ${stage} and aborts/cleans up`, async () => {
      let signal: AbortSignal | undefined
      Reader.hold = stage === 'reader'
      globalThis.fetch = async (_url, init) => {
        signal = init?.signal as AbortSignal
        if (stage === 'headers') return held<Response>()
        if (stage === 'body') return { ok: true, blob: () => held<Blob>() } as Response
        return response()
      }
      const start = performance.now()
      const assets = createReceiptAssetLoader({ baseUrl, budgetMs: 40 })
      await assert.rejects(assets.load('/held'), ReceiptAssetError)
      const elapsed = performance.now() - start
      assert.ok(elapsed < 500, `deadline took ${elapsed}ms`)
      assert.equal(signal?.aborted, true)
      if (stage === 'reader') {
        assert.equal(Reader.instances[0].aborted, true)
        assert.equal(Reader.instances[0].onload, null)
      }
      await assert.rejects(assets.load('/later-style'), ReceiptAssetError)
      assets.dispose()
      console.log(`  synthetic ${stage}: ${elapsed.toFixed(1)}ms (40ms test budget)`)
    })
  }
  await check('later CSS stage uses remaining budget, not a new timer', async () => {
    globalThis.fetch = async url => String(url).endsWith('first') ? response() : held<Response>()
    const assets = createReceiptAssetLoader({ baseUrl, budgetMs: 90 })
    await assets.load('/first')
    await sleep(60)
    const start = performance.now()
    await assert.rejects(assets.load('/style'), ReceiptAssetError)
    assert.ok(performance.now() - start < 70)
    assets.dispose()
  })
  await check('failed duplicate cached; disposal aborts siblings; HTTP/CORS error stays recoverable', async () => {
    for (const cors of [false, true]) {
      let calls = 0
      let signal: AbortSignal | undefined
      globalThis.fetch = async (_url, init) => { calls++; signal = init?.signal as AbortSignal; if (cors) throw new TypeError('CORS'); return new Response('', { status: 404 }) }
      const assets = createReceiptAssetLoader({ baseUrl })
      await assert.rejects(assets.load('/bad'), ReceiptAssetError)
      await assert.rejects(assets.load('/bad'), ReceiptAssetError)
      assert.equal(calls, 1)
      assets.dispose(); assert.equal(signal?.aborted, true)
    }
  })
  await check('cancel during body or FileReader settles and detaches external abort listener', async () => {
    for (const readerStage of [false, true]) {
      const cancellation = new AbortController()
      let listeners = 0
      const add = cancellation.signal.addEventListener.bind(cancellation.signal)
      const remove = cancellation.signal.removeEventListener.bind(cancellation.signal)
      cancellation.signal.addEventListener = (...args: Parameters<typeof add>) => { listeners++; add(...args) }
      cancellation.signal.removeEventListener = (...args: Parameters<typeof remove>) => { listeners--; remove(...args) }
      Reader.hold = readerStage
      globalThis.fetch = async () => readerStage ? response() : { ok: true, blob: () => held<Blob>() } as Response
      const assets = createReceiptAssetLoader({ baseUrl, signal: cancellation.signal })
      const pending = assets.load('/cancel')
      const rejection = assert.rejects(pending, ReceiptAssetError)
      await sleep(5)
      cancellation.abort(); await rejection
      assert.equal(listeners, 0)
      if (readerStage) assert.equal(Reader.instances.at(-1)?.aborted, true)
      assets.dispose()
    }
  })
  await check('success disposal clears timer and external listener; no data URL fetch', async () => {
    const controller = new AbortController()
    let removes = 0
    const remove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.removeEventListener = (...args: Parameters<typeof remove>) => { removes++; remove(...args) }
    globalThis.fetch = async () => { throw new Error('data URL must not fetch') }
    const assets = createReceiptAssetLoader({ baseUrl, signal: controller.signal, budgetMs: 20 })
    assert.equal(await assets.load('data:image/png;base64,eA=='), 'data:image/png;base64,eA==')
    assets.dispose(); assets.dispose(); await sleep(30)
    assert.equal(removes, 1)
  })
  // Actual immutable old helper, not a prose or source-text assertion. Kept as a
  // discriminating oracle for the exact baseline the performance council read.
  await check('old helper negative control: duplicate fetches and held headers/body/reader remain pending', async () => {
    const block = [
      "function blobToDataUrl(blob: Blob): Promise<string> {",
      "  return new Promise((resolve, reject) => {",
      "    const reader = new FileReader()",
      "    reader.onerror = () => reject(new Error('Failed to read receipt asset'))",
      "    reader.onload = () => resolve(String(reader.result || ''))",
      "    reader.readAsDataURL(blob)",
      "  })",
      "}",
      "",
      "async function mapReceiptAssets<T>(items: Iterable<T> | ArrayLike<T> | null | undefined, worker: (item: T, index: number) => Promise<void> | void): Promise<void> {",
      "  const list = Array.from(items || [])",
      "  if (!list.length) return",
      "  let nextIndex = 0",
      "  const workers = Array.from({ length: Math.min(RECEIPT_ASSET_INLINE_CONCURRENCY, list.length) }, async () => {",
      "    while (nextIndex < list.length) {",
      "      const index = nextIndex",
      "      nextIndex += 1",
      "      await worker(list[index], index)",
      "    }",
      "  })",
      "  await Promise.all(workers)",
      "}",
      "",
      "async function inlineImageNodeSources(root: unknown): Promise<void> {",
      "  if (!root || !(root instanceof HTMLElement)) return",
      "  const images = Array.from(root.querySelectorAll('img'))",
      "  await mapReceiptAssets(images, async (image) => {",
      "    const src = String(image.getAttribute('src') || '').trim()",
      "    if (!src || /^data:/i.test(src)) return",
      "    try {",
      "      const absoluteSrc = new URL(src, window.location.href).toString()",
      "      const response = await fetch(absoluteSrc, {",
      "        mode: 'cors',",
      "        credentials: absoluteSrc.startsWith(window.location.origin) ? 'same-origin' : 'omit',",
      "      })",
      "      if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`)",
      "      const blob = await response.blob()",
      "      const dataUrl = await blobToDataUrl(blob)",
      "      image.setAttribute('src', dataUrl)",
      "    } catch (_) {",
      "      image.removeAttribute('src')",
      "      image.style.visibility = 'hidden'",
      "    }",
      "  })",
      "}",
      "",
      "function extractUrlsFromCssValue(value: unknown): string[] {",
      "  return Array.from(String(value || '').matchAll(/url\\((['\"]?)(.*?)\\1\\)/gi))",
      "    .map((match) => String(match[2] || '').trim())",
      "    .filter(Boolean)",
      "}",
      "",
      "async function inlineStyleAssetUrls(root: unknown): Promise<void> {",
      "  if (!root || !(root instanceof HTMLElement)) return",
      "  const nodes = [root, ...Array.from(root.querySelectorAll('*'))]",
      "  await mapReceiptAssets(nodes, async (node) => {",
      "    if (!(node instanceof HTMLElement)) return",
      "    const style = node.getAttribute('style') || ''",
      "    const urls = extractUrlsFromCssValue(style)",
      "    if (!urls.length) return",
      "",
      "    let nextStyle = style",
      "    for (const src of urls) {",
      "      if (/^data:/i.test(src)) continue",
      "      try {",
      "        const absoluteSrc = new URL(src, window.location.href).toString()",
      "        const response = await fetch(absoluteSrc, {",
      "          mode: 'cors',",
      "          credentials: absoluteSrc.startsWith(window.location.origin) ? 'same-origin' : 'omit',",
      "        })",
      "        if (!response.ok) throw new Error(`Asset fetch failed with ${response.status}`)",
      "        const blob = await response.blob()",
      "        const dataUrl = await blobToDataUrl(blob)",
      "        nextStyle = nextStyle.split(src).join(dataUrl)",
      "      } catch (_) {",
      "        const escaped = String(src).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
      "        nextStyle = nextStyle",
      "          .replace(new RegExp(`background-image\\\\s*:\\\\s*url\\\\((['\"]?)${escaped}\\\\1\\\\)\\\\s*;?`, 'gi'), 'background-image:none;')",
      "          .replace(new RegExp(`background\\\\s*:[^;]*url\\\\((['\"]?)${escaped}\\\\1\\\\)[^;]*;?`, 'gi'), 'background:none;')",
      "      }",
      "    }",
      "",
      "    node.setAttribute('style', nextStyle)",
      "  })",
      "}",
      "",
    ].join('\n')
    const js = ts.transpileModule(`const RECEIPT_ASSET_INLINE_CONCURRENCY = 3;\n${block}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    class Element {
      style = {}
      attrs: Record<string, string>
      children: Element[]
      constructor(attrs: Record<string, string> = {}, children: Element[] = []) { this.attrs = attrs; this.children = children }
      getAttribute(key: string) { return this.attrs[key] || '' }
      setAttribute(key: string, value: string) { this.attrs[key] = value }
      removeAttribute(key: string) { delete this.attrs[key] }
      querySelectorAll(selector: string) { return selector === 'img' ? this.children : [] }
    }
    for (const stage of ['success', 'headers', 'body', 'reader']) {
      Reader.hold = stage === 'reader'
      let calls = 0
      const fetcher = async () => { calls++; if (stage === 'headers') return held<Response>(); if (stage === 'body') return { ok: true, blob: () => held<Blob>() }; return response() }
      const helpers = new Function('HTMLElement', 'window', 'fetch', 'FileReader', `${js}; return {inlineImageNodeSources, inlineStyleAssetUrls}`)(Element, { location: new URL(baseUrl) }, fetcher, Reader)
      const root = new Element({ style: 'background-image:url(/same)' }, [new Element({ src: '/same' }), new Element({ src: '/same' })])
      const operation = helpers.inlineImageNodeSources(root).then(() => helpers.inlineStyleAssetUrls(root))
      if (stage === 'success') { await operation; assert.equal(calls, 3) }
      else assert.equal(await Promise.race([operation.then(() => 'done'), sleep(65).then(() => 'pending')]), 'pending')
      console.log(`  baseline ${stage}: ${calls} fetches${stage === 'success' ? '' : ', still pending at 65ms'}`)
    }
  })
  // --- Owner rule (I8 ADAPT): an asset failure never blocks or fails a print. ---
  // A minimal DOM: inlineReceiptAssets only needs instanceof HTMLElement,
  // attributes, a style object and querySelectorAll.
  class FakeElement {
    style: Record<string, string> = {}
    attrs: Record<string, string>
    children: FakeElement[]
    constructor(attrs: Record<string, string> = {}, children: FakeElement[] = []) { this.attrs = attrs; this.children = children }
    getAttribute(key: string) { return key in this.attrs ? this.attrs[key] : null }
    setAttribute(key: string, value: string) { this.attrs[key] = value }
    removeAttribute(key: string) { delete this.attrs[key] }
    querySelectorAll(selector: string): FakeElement[] {
      const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
      return selector === 'img' ? all.filter(el => el.attrs.tag === 'img') : all
    }
  }
  const globals = globalThis as Record<string, unknown>
  const originalHTMLElement = globals.HTMLElement
  const originalWarn = console.warn
  globals.HTMLElement = FakeElement
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  const receipt = () => {
    const logo = new FakeElement({ tag: 'img', src: '/logo.png' })
    const missing = new FakeElement({ tag: 'img', src: '/missing.png' })
    const qr = new FakeElement({ tag: 'img', src: 'data:image/png;base64,UVI=' })
    const banner = new FakeElement({ tag: 'div', style: 'color:red;background-image:url("/missing.png");' })
    const root = new FakeElement({ tag: 'div' }, [logo, missing, qr, banner])
    return { root, logo, missing, qr, banner }
  }
  try {
    await check('a 404 image still prints: resolves, hides only that image, keeps the rest', async () => {
      let calls = 0
      globalThis.fetch = async url => { calls++; return String(url).includes('missing') ? new Response('', { status: 404 }) : response() }
      warnings.length = 0
      const { root, logo, missing, qr, banner } = receipt()
      const skipped = await inlineReceiptAssets(root, { baseUrl })
      assert.match(String(logo.attrs.src), /^data:image\/png/, 'the good image is inlined')
      assert.equal(missing.attrs.src, undefined, 'the 404 image loses its src')
      assert.equal(missing.style.visibility, 'hidden', 'and is hidden, exactly as before the deadline existed')
      assert.equal(qr.attrs.src, 'data:image/png;base64,UVI=', 'a data: QR is never re-fetched')
      assert.match(banner.attrs.style, /background-image:none;/, 'a 404 background is dropped')
      assert.doesNotMatch(banner.attrs.style, /missing\.png/)
      assert.equal(calls, 2, 'the 404 URL is fetched once for both the <img> and the style url()')
      assert.ok(skipped.length >= 1 && skipped.every(error => error instanceof ReceiptAssetError && error.reason === 'http'))
      assert.equal(warnings.length, 1, 'the skip is logged once, not shown to the cashier')
    })
    await check('CORS refusal and reader error degrade the same way', async () => {
      for (const failure of ['cors', 'reader'] as const) {
        globalThis.fetch = async url => {
          if (failure === 'cors' && String(url).includes('missing')) throw new TypeError('Failed to fetch')
          return response()
        }
        const originalRead = Reader.prototype.readAsDataURL
        if (failure === 'reader') Reader.prototype.readAsDataURL = function () { this.readyState = 1; queueMicrotask(() => { this.readyState = 2; this.onerror?.() }) }
        try {
          const { root, missing } = receipt()
          await inlineReceiptAssets(root, { baseUrl })
          assert.equal(missing.style.visibility, 'hidden', `${failure}: image hidden`)
        } finally {
          Reader.prototype.readAsDataURL = originalRead
        }
      }
    })
    await check('a host that never answers cannot hold the print past the deadline', async () => {
      globalThis.fetch = async url => String(url).includes('missing') ? held<Response>() : response()
      const { root, logo, missing, banner } = receipt()
      const start = performance.now()
      const outcome = await Promise.race([
        inlineReceiptAssets(root, { baseUrl, budgetMs: 40 }).then(() => 'printed'),
        sleep(1000).then(() => 'hung'),
      ])
      const elapsed = performance.now() - start
      assert.equal(outcome, 'printed')
      assert.ok(elapsed < 500, `deadline took ${elapsed}ms`)
      assert.match(String(logo.attrs.src), /^data:image\/png/, 'what arrived in time is kept')
      assert.equal(missing.style.visibility, 'hidden')
      assert.match(banner.attrs.style, /background-image:none;/)
    })
    // Q13 (owner, 27 Sep 2026): the ABA payment QR is the exception to the 5 s
    // rule. Slow is waited for; only a real failure drops it, and then the
    // whole block goes and the caller is told once.
    class TreeElement extends FakeElement {
      parent: TreeElement | null = null
      constructor(attrs: Record<string, string> = {}, children: TreeElement[] = []) {
        super(attrs, children)
        for (const child of children) child.parent = this
      }
      closest(selector: string): TreeElement | null {
        const payment = selector === '[data-receipt-qr="payment"]'
        for (let node: TreeElement | null = this; node; node = node.parent) {
          if (payment && node.attrs['data-receipt-qr'] === 'payment') return node
        }
        return null
      }
      remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter((child) => child !== this)
        this.parent = null
      }
    }
    const paymentReceipt = () => {
      const image = new TreeElement({ tag: 'img', src: '/aba.png' })
      const block = new TreeElement({ tag: 'div', 'data-receipt-qr': 'payment', 'data-receipt-qr-state': 'ready' }, [image])
      const logo = new TreeElement({ tag: 'img', src: '/logo.png' })
      const root = new TreeElement({ tag: 'div' }, [logo, block])
      return { root, block, image, logo }
    }
    await check('a payment QR slower than the asset deadline is waited for and kept', async () => {
      let calls = 0
      globalThis.fetch = async (url) => {
        calls++
        if (String(url).includes('aba')) await sleep(120)
        return response()
      }
      const { root, block, image } = paymentReceipt()
      let omitted = 0
      await inlineReceiptAssets(root, { baseUrl, budgetMs: 40, paymentQrBudgetMs: 2000, onPaymentQrOmitted: () => { omitted++ } })
      assert.match(String(image.attrs.src), /^data:image\/png/, 'the slow payment QR is embedded, not hidden')
      assert.notEqual(image.style.visibility, 'hidden')
      assert.ok(root.children.includes(block), 'its block stays')
      assert.equal(omitted, 0)
      assert.equal(calls, 2)
    })
    await check('a payment QR that errors takes its block out and is reported once', async () => {
      globalThis.fetch = async (url) => String(url).includes('aba') ? new Response('', { status: 404 }) : response()
      const { root, block, logo } = paymentReceipt()
      let omitted = 0
      await inlineReceiptAssets(root, { baseUrl, onPaymentQrOmitted: () => { omitted++ } })
      assert.ok(!root.children.includes(block), 'the block is removed, not left as a hidden gap')
      assert.equal(omitted, 1)
      assert.match(String(logo.attrs.src), /^data:image\/png/, 'the rest of the receipt is unaffected')
    })
    await check('a cancelled print is not reported as an omitted payment QR', async () => {
      globalThis.fetch = async (url) => String(url).includes('aba') ? held<Response>() : response()
      const { root } = paymentReceipt()
      const controller = new AbortController()
      let omitted = 0
      const done = inlineReceiptAssets(root, { baseUrl, signal: controller.signal, onPaymentQrOmitted: () => { omitted++ } })
      await sleep(20)
      controller.abort()
      await done
      assert.equal(omitted, 0)
    })
    await check('printReceipt uses the bounded inliner and never rethrows an asset error', async () => {
      const source = readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
      assert.equal((source.match(/await inlineReceiptAssets\(/g) || []).length, 2, 'both the print markup and the raster clone')
      assert.doesNotMatch(source, /ReceiptAssetError/, 'the typed error stays inside the loader')
      assert.doesNotMatch(source, /new FileReader\(\)/, 'no unbounded reader is left behind')
      assert.doesNotMatch(source, /await fetch\(/, 'no unbounded fetch is left behind')
    })
  } finally {
    globals.HTMLElement = originalHTMLElement
    console.warn = originalWarn
  }
  console.log(`${passed} receipt asset checks passed`)
} finally {
  globalThis.fetch = originalFetch
  globalThis.FileReader = originalReader
}
