import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'
// Real mounted built app and print delivery. Only asset fetch and the OS dialog
// are substituted. Never reaches production; installed-PWA routing is simulated.
// Origin: Codex perf-print (Worktrees/perf-print-20260925), adapted so every
// asset failure prints without the asset instead of failing the print.
// Q13 (owner, 27 Sep 2026): the "Payment QR fixture" images sit in a payment
// QR block, the way ReceiptPaymentQr renders the ABA QR, so they follow the
// payment rule: a slow one is waited for and printed VISIBLE; only an error
// (or the 30 s ceiling) leaves the block out, with the warning toast. The
// style background shares their URL and keeps the plain asset rule.
test.use({ serviceWorkers: 'block' })
const EN = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
async function stubPrinting(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    type Sink = Window & {
      __e2ePrints?: Array<{ via: string; html: string; fonts: string[] }>
      __e2ePrintViews?: Array<Window | null>
      __e2eBlockPopup?: boolean
      __e2eExecPrintSupported?: boolean | null
    }
    type Stubbable = Window & typeof globalThis & { __e2ePrintStubbed?: boolean }
    const sink = (): Sink => {
      try { return ((window.opener as Window | null) || window).top as Sink } catch { return window as Sink }
    }
    const record = (via: string, doc: Document | null | undefined) => {
      const target = sink()
      if (!target.__e2ePrints) target.__e2ePrints = []
      if (!target.__e2ePrintViews) target.__e2ePrintViews = []
      target.__e2ePrintViews.push(doc?.defaultView ?? null)
      const faces = doc?.fonts ? Array.from(doc.fonts as unknown as Iterable<FontFace>) : []
      target.__e2ePrints.push({
        via,
        html: doc?.documentElement?.outerHTML ?? '',
        fonts: faces.filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, '')),
      })
    }
    const stub = (win: Stubbable | null | undefined) => {
      if (!win || win.__e2ePrintStubbed) return
      win.__e2ePrintStubbed = true
      const proto = win.Document.prototype
      const realExec = proto.execCommand
      if (win === (window as Window) && !(window.opener) && window.top === window) {
        try { (window as Sink).__e2eExecPrintSupported = proto.queryCommandSupported.call(win.document, 'print') } catch { (window as Sink).__e2eExecPrintSupported = null }
      }
      proto.execCommand = function execCommand(this: Document, command: string, ...rest: [boolean?, string?]) {
        if (String(command).toLowerCase() === 'print') { record('execCommand', this); return true }
        return realExec.call(this, command, ...rest)
      }
      win.print = () => { record('print', win.document) }
    }
    stub(window as Stubbable)
    const realOpen = window.open
    window.open = function open(this: Window, ...args: Parameters<typeof window.open>) {
      if (sink().__e2eBlockPopup) return null
      const opened = realOpen.apply(this, args)
      try { stub(opened as Stubbable | null) } catch { /* cross-origin: nothing of ours prints there */ }
      return opened
    }
    const realAppend = Node.prototype.appendChild
    Node.prototype.appendChild = function appendChild<T extends Node>(this: Node, child: T): T {
      const appended = realAppend.call(this, child) as T
      if (child instanceof HTMLIFrameElement) {
        try { stub(child.contentWindow as Stubbable | null) } catch { /* cross-origin frame */ }
      }
      return appended
    }
  })
}

async function prepare(page: Page, context: BrowserContext, frame: boolean) {
  const scope = randomUUID()
  expect((await context.request.post(`${ADMIN_ORIGIN}/__e2e/settings?scope=${scope}`, { data: {
    receipt_print_settings: JSON.stringify({ paperSize: '80mm', pageSizeMode: 'measured', marginTop: '4', marginLeft: '4', marginRight: '4', marginBottom: '4', scale: '100' }),
    receipt_template: JSON.stringify({ sales_receipt_enabled: true, receipt_language: 'both' }),
  } })).ok()).toBe(true)
  await context.addCookies([{ name: 'e2e_settings_scope', value: scope, url: ADMIN_ORIGIN }])
  await stubPrinting(context)
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await gotoAdminPage(page, '/receipt-settings')
  await page.getByRole('button', { name: EN.receipt_print, exact: true }).click()
  await expect(page.getByRole('button', { name: EN.print_test_this_mode, exact: true })).toBeVisible()
  await page.evaluate(async blocked => {
    const w = window as any
    w.__e2eBlockPopup = blocked
    w.__assetCalls = 0; w.__assetAborts = 0; w.__assetMode = 'success'
    const realFetch = window.fetch.bind(window)
    const url = new URL('/icon-192.png?receipt-asset-probe=1', location.href).href
    // Already loaded DOM assets are re-fetched for inlining; the fixture fetch
    // below decides whether that succeeds, hangs, is refused or 404s.
    const root = document.querySelector('[data-receipt-rendition="full"]')!
    for (let n = 0; n < 2; n++) {
      // Loaded on screen, so the block is ready; the print re-fetches it.
      const block = document.createElement('div')
      block.setAttribute('data-receipt-qr', 'payment')
      block.setAttribute('data-receipt-qr-state', 'ready')
      const image = new Image(); image.src = url; image.alt = 'Payment QR fixture'; image.width = 24; image.height = 24
      block.appendChild(image); root.appendChild(block); await image.decode()
    }
    const style = document.createElement('div'); style.style.cssText = `width:24px;height:24px;background-image:url("${url}")`
    root.appendChild(style)
    window.fetch = async (input, init) => {
      if (!String(input).includes('receipt-asset-probe')) return realFetch(input, init)
      w.__assetCalls++
      init?.signal?.addEventListener('abort', () => { w.__assetAborts++ }, { once: true })
      if (w.__assetMode === 'headers') return new Promise<Response>(() => {})
      if (w.__assetMode === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 6500))
        return realFetch(input, init)
      }
      if (w.__assetMode === 'cors') throw new TypeError('Failed to fetch (fixture CORS refusal)')
      if (w.__assetMode === '404') return new Response('', { status: 404 })
      if (w.__assetMode === 'body') return { ok: true, blob: () => new Promise<Blob>(() => {}) } as Response
      return realFetch(input, init)
    }
  }, frame)
}
const calls = (page: Page) => page.evaluate(() => ((window as any).__e2ePrints || []) as Array<{ html: string; fonts: string[] }>)
// On WebKit under parallel load a late Receipt Settings re-render shifts the
// layout between Playwright's hit test and the dispatch, and the tap lands on
// the surrounding container (observed: target "space-y-6", no print, no fetch).
// So a tap is only counted once the button itself received it; a missed tap is
// retried, a landed one never is -- the "prints once" assertions still hold.
const print = async (page: Page) => {
  const button = page.getByRole('button', { name: EN.print_test_this_mode, exact: true })
  await page.evaluate(label => {
    const w = window as any
    w.__printTaps = 0
    if (w.__printTapListener) return
    w.__printTapListener = true
    document.addEventListener('click', event => {
      const target = (event.target as HTMLElement | null)?.closest?.('button')
      if (target && target.textContent?.includes(label)) w.__printTaps++
    }, true)
  }, EN.print_test_this_mode)
  await expect(async () => {
    if (await page.evaluate(() => (window as any).__printTaps) === 0) await button.click()
    expect(await page.evaluate(() => (window as any).__printTaps)).toBe(1)
  }).toPass({ timeout: 10000 })
}

for (const frame of [false, true]) {
  test(`${frame ? 'iframe' : 'popup'} embeds duplicate assets once and prints bilingual receipt once`, async ({ page, context }, info) => {
    await prepare(page, context, frame)
    const start = Date.now()
    await print(page)
    await expect.poll(async () => (await calls(page)).length).toBe(1)
    const elapsedMs = Date.now() - start
    const printed = (await calls(page))[0]
    expect(printed.fonts).toContain('Noto Sans Khmer')
    const content = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return { images: Array.from(doc.querySelectorAll('img[alt="Payment QR fixture"]')).map(i => i.getAttribute('src')), text: doc.querySelector('.receipt-frame')?.textContent, backgrounds: Array.from(doc.querySelectorAll<HTMLElement>('.receipt-frame *')).map(el => el.style.backgroundImage).filter(Boolean) }
    }, printed.html)
    expect(content.images).toHaveLength(2)
    expect(content.images.every(src => src?.startsWith('data:image/png'))).toBe(true)
    expect(content.text).toMatch(/[\u1780-\u17ff]/)
    expect(content.backgrounds.some(css => css.includes('data:image/png'))).toBe(true)
    expect(await page.evaluate(() => (window as any).__assetCalls)).toBe(1)
    await page.waitForTimeout(400)
    expect((await calls(page)).length).toBe(1)
    await info.attach('local-asset-timing', { body: JSON.stringify({ surface: frame ? 'iframe' : 'popup', elapsedMs, fetches: 1 }), contentType: 'application/json' })
    await page.evaluate(() => { for (const win of (window as any).__e2ePrintViews || []) win?.dispatchEvent(new Event('afterprint')) })
    if (frame) await expect(page.locator('iframe[title="Print document"]')).toHaveCount(0)
  })
  // Q13: a payment QR slower than the old 5 s asset deadline is waited for and
  // printed visible, with no warning. Before Q13 it printed hidden.
  test(`${frame ? 'iframe' : 'popup'} slow payment QR is waited for and printed visible`, async ({ page, context }, info) => {
    test.setTimeout(90_000)
    await prepare(page, context, frame)
    await page.evaluate(() => { (window as any).__assetMode = 'slow' })
    const dialogs: string[] = []
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss() })
    const start = Date.now()
    await print(page)
    await expect.poll(async () => (await calls(page)).length, { timeout: 40000 }).toBe(1)
    const elapsedMs = Date.now() - start
    expect(elapsedMs).toBeGreaterThan(6000)
    const printed = (await calls(page))[0]
    const content = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return Array.from(doc.querySelectorAll<HTMLImageElement>('img[alt="Payment QR fixture"]')).map(i => ({ src: i.getAttribute('src'), visibility: i.style.visibility }))
    }, printed.html)
    expect(content).toHaveLength(2)
    expect(content.every(image => image.src?.startsWith('data:image/png') && image.visibility !== 'hidden')).toBe(true)
    expect(dialogs).toEqual([])
    await expect(page.getByText(EN.receipt_payment_qr_omitted)).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__assetCalls)).toBe(1)
    await info.attach('payment-qr-slow-timing', { body: JSON.stringify({ elapsedMs }), contentType: 'application/json' })
    await page.evaluate(() => { for (const win of (window as any).__e2ePrintViews || []) win?.dispatchEvent(new Event('afterprint')) })
  })
  // An error still never blocks the print or raises a dialog: the receipt prints
  // once WITHOUT the payment QR block (no hidden gap, no broken image), the
  // cashier gets the warning toast, and the background keeps the plain asset
  // rule (dropped). A host that never answers is waited for up to the 30 s
  // ceiling and then treated the same way.
  for (const mode of ['cors', '404', 'headers', 'body']) {
    test(`${frame ? 'iframe' : 'popup'} ${mode} failure prints once without the payment QR, and warns`, async ({ page, context }, info) => {
      const hangs = mode === 'headers' || mode === 'body'
      test.setTimeout(hangs ? 120_000 : 60_000)
      await prepare(page, context, frame)
      await page.evaluate(value => { (window as any).__assetMode = value }, mode)
      const dialogs: string[] = []
      page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss() })
      const start = Date.now()
      const logs: string[] = []
      page.on('console', message => { logs.push(`${Date.now() - start}ms ${message.type()}: ${message.text()}`) })
      await print(page)
      if (hangs) {
        // Still waiting well past the old 5 s deadline, and saying so.
        await page.waitForTimeout(8000)
        expect((await calls(page)).length).toBe(0)
        await expect(page.getByRole('button', { name: EN.receipt_qr_waiting, exact: true })).toBeVisible()
      }
      await expect.poll(async () => (await calls(page)).length, { timeout: hangs ? 60000 : 30000, message: `no print (${mode})` }).toBe(1)
        .catch(async (error: Error) => {
          const probe = await page.evaluate(() => ({ calls: (window as any).__assetCalls, aborts: (window as any).__assetAborts, taps: (window as any).__printTaps })).catch(() => null)
          throw new Error(`${error.message}\nprobe: ${JSON.stringify(probe)} pages=${context.pages().length}\nconsole:\n${logs.join('\n')}`)
        })
      const elapsedMs = Date.now() - start
      expect(dialogs).toEqual([])
      const printed = (await calls(page))[0]
      const content = await page.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        return {
          images: doc.querySelectorAll('img[alt="Payment QR fixture"]').length,
          blocks: doc.querySelectorAll('[data-receipt-qr="payment"]').length,
          text: doc.querySelector('.receipt-frame')?.textContent,
          backgrounds: Array.from(doc.querySelectorAll<HTMLElement>('.receipt-frame *')).map(el => el.style.backgroundImage).filter(Boolean),
        }
      }, printed.html)
      expect(content.images).toBe(0)
      expect(content.blocks).toBe(0)
      expect(content.backgrounds.some(css => css.includes('receipt-asset-probe'))).toBe(false)
      expect(content.text).toMatch(/[ក-៿]/)
      await expect(page.getByText(EN.receipt_payment_qr_omitted)).toBeVisible()
      // One fetch for the payment stage, one for the background's own stage.
      expect(await page.evaluate(() => (window as any).__assetCalls)).toBe(2)
      await info.attach('payment-qr-failure-timing', { body: JSON.stringify({ mode, elapsedMs }), contentType: 'application/json' })
      await page.evaluate(() => { for (const win of (window as any).__e2ePrintViews || []) win?.dispatchEvent(new Event('afterprint')) })
      if (frame) await expect(page.locator('iframe[title="Print document"]')).toHaveCount(0)
    })
  }
}
