// The mini "waiting for review" tag, measured in a real browser (owner, 13 Oct 2026:
// "minimize without taking used spaces or breaking UI. utilize empty space can be the
// empty margin").
//
// tests/pendingReviewTag.test.ts pins the emitted classes. This file shows what those
// classes DO against the app's real stylesheet, in Chromium at phone and desktop width,
// in both languages for the one control that carries text:
//   - every box on the surface (rows, cells, cards, buttons, the toolbar strip) is
//     byte-for-byte the same size and place with the tag as without it;
//   - the tag is a 10 x 10 px box, absolutely positioned, not clickable (a tap lands on
//     the row beneath it), and its drawn hourglass stays inside the gutter the host
//     already has, so it does not touch the text or the thumbnail beside it;
//   - the Add button's count badge stays inside the button, so the overflow-x-auto
//     strip around the toolbar gets no scrollbar and nothing is clipped.
//
// Two kinds of fixture, both on the app's own CSS and its real components:
//   - the Inventory products table and the Products Add button are the REAL components;
//   - the Products row/card, expense row/card and branch card live in files too large to
//     mount, so each is rebuilt from the host class strings and the tag offsets READ OUT OF
//     THAT SOURCE FILE (a change to either changes this test's input), around content of
//     the same size as the real cell (a 48px thumbnail, a line of text).
//
// Run: node tests/pendingReviewTagLayout.test.ts   (needs Chrome or Edge, like the other mounted tests)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../tailwind.config.ts'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')
const products = read('src/components/products/Products.tsx')
const fees = read('src/components/fees/FeesPage.tsx')
const branches = read('src/components/branches/Branches.tsx')
const header = read('src/components/products/surfaces/HeaderActions.tsx')

// ---- the class strings the fixtures use, read out of the live sources ----
const grab = (source: string, pattern: RegExp, what: string): string => {
  const match = source.match(pattern)
  assert.ok(match, `cannot find ${what} in the live source`)
  return match[1]
}
const tagOffset = (source: string, section: string, from = 0): string =>
  grab(source.slice(from), new RegExp(`<PendingReviewTag section="${section}"[^>]*className="([^"]+)"`), `the ${section} tag offset`)

const desktopRow = products.slice(products.indexOf('function ProductDesktopRowComponent'), products.indexOf('const ProductDesktopRow = memo'))
const mobileCard = products.slice(products.indexOf('function ProductMobileCardComponent'), products.indexOf('const ProductMobileCard = memo'))
const hosts = {
  productsRowCell: grab(desktopRow, /<td className="(relative px-2 py-2)">/, 'the Products image cell'),
  productsRowTag: tagOffset(desktopRow, 'products'),
  productsCard: grab(mobileCard, /: `(card relative[^`$]*?) \$\{/, 'the standalone Products card'),
  productsChildCard: grab(mobileCard, /\? `(relative min-w-0[^`$]*?) \$\{/, 'the grouped Products child card'),
  productsCardTag: tagOffset(mobileCard, 'products'),
  feesCell: grab(fees, /<td className="(relative whitespace-nowrap[^"]*)"><PendingReviewTag/, 'the expense time cell'),
  feesCellTag: tagOffset(fees, 'fees', fees.indexOf('<td className="relative whitespace-nowrap')),
  feesCard: grab(fees, /className="(relative block w-full rounded-xl[^"]*)">\s*<PendingReviewTag/, 'the expense card'),
  feesCardTag: tagOffset(fees, 'fees', fees.indexOf('data-expense-card=""')),
  branchCard: grab(branches, /className="(card relative overflow-hidden transition-all)"/, 'the branch card'),
  branchCardTag: tagOffset(branches, 'branches'),
}
const wrapperStrip = grab(products, /<div className="(w-full min-w-0 overflow-x-auto pb-1 sm:ml-auto sm:w-auto sm:flex-shrink-0 sm:pb-0)">/, 'the strip around the Products header actions')

const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

// ---- the fixture page ----
const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import InventoryProductsSurface from './src/components/inventory/InventoryProductsSurface.tsx'
import ProductsHeaderActions from './src/components/products/surfaces/HeaderActions.tsx'
import PendingReviewTag from './src/components/shared/PendingReviewTag.tsx'
import PendingReviewSync from './src/components/shared/PendingReviewSync.tsx'
import { refreshPendingReviewTargets } from './src/utils/pendingReviewTargets.ts'
import { AppContext, FALLBACK_APP_CONTEXT } from './src/app/AppContextCore.tsx'

const H = ${JSON.stringify(hosts)}
const packs = ${JSON.stringify({ en, km })}
const query = new URLSearchParams(location.search)
const lang = query.get('lang') || 'en'
const waiting = query.get('pending') === '1'
const t = (key) => packs[lang][key] || key

// The review queue as the Worker would answer it: product 2 (half of the merged Tea row), product 7,
// expense 1, branch 1, and two product creates that have no record yet.
const rows = waiting ? [
  { section: 'products', entity_type: 'product', entity_id: 2, status: 'open' },
  { section: 'products', entity_type: 'product', entity_id: 7, status: 'open' },
  ...Array.from({ length: Number(query.get('creates') || 2) }, () => ({ section: 'products', entity_type: 'product', entity_id: null, status: 'open' })),
  { section: 'fees', entity_type: 'fee', entity_id: 1, status: 'open' },
  { section: 'branches', entity_type: 'branch', entity_id: 1, status: 'open' },
] : []
window.fetch = async () => new Response(JSON.stringify({ success: true, data: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } })

const items = [
  { id: 1, name: 'Tea', barcode: '111', purchase_price_usd: 2, selling_price_usd: 4, branch_stock: [{ branch_id: 1, branch_name: 'A', quantity: 3 }] },
  { id: 2, name: 'Tea', barcode: '111', purchase_price_usd: 4, selling_price_usd: 5, branch_stock: [{ branch_id: 2, branch_name: 'B', quantity: 7 }] },
  { id: 7, name: 'Soap', barcode: '777', purchase_price_usd: 1, selling_price_usd: 2, branch_stock: [{ branch_id: 1, branch_name: 'A', quantity: 9 }] },
  { id: 8, name: 'Salt', barcode: '888', purchase_price_usd: 1, selling_price_usd: 2, branch_stock: [{ branch_id: 1, branch_name: 'A', quantity: 4 }] },
]
const noop = () => {}
const Tag = (props) => <PendingReviewTag {...props} />

function ProductsRow({ indented }) {
  return (
    <table className="w-full table-fixed text-sm table-bordered" data-fixture={indented ? "products-child-row" : "products-row"}>
      <colgroup><col style={{ width: '0px' }} /><col style={{ width: '4rem' }} /><col /></colgroup>
      <tbody>
        <tr className="table-row">
          <td className="px-0 py-2" />
          <td className={H.productsRowCell}>
            <Tag section="products" entityType="product" ids={[7]} className={H.productsRowTag} />
            {indented ? null : <button type="button" className="block rounded-lg"><div className="h-12 w-12 rounded-lg bg-slate-200" /></button>}
          </td>
          <td className="px-2 py-2"><div className="flex min-h-10 flex-col justify-center font-semibold" data-name>Soap</div></td>
        </tr>
      </tbody>
    </table>
  )
}
function ProductsCard({ indented }) {
  return (
    <div className="w-72" data-fixture={indented ? 'products-child-card' : 'products-card'}>
      <div className={indented ? H.productsChildCard : H.productsCard}>
        <Tag section="products" entityType="product" ids={[7]} className={H.productsCardTag} />
        <div className="flex min-w-0 items-start gap-3">
          {indented ? null : <button type="button" className="relative flex-shrink-0 self-stretch rounded-xl text-left"><div className="h-12 w-12 rounded-xl bg-slate-200" /></button>}
          <div className="min-w-0 flex-1"><div className="text-sm font-semibold" data-name>Soap</div><div className="mt-1 text-xs">$2.00 | 9</div></div>
        </div>
      </div>
    </div>
  )
}
function FeesRow() {
  return (
    <div className="dense-data-shell overflow-x-auto" data-fixture="fees-row">
      <table className="dense-data-table min-w-[360px]">
        <colgroup><col className="w-[7rem]" /><col /></colgroup>
        <tbody><tr><td className={H.feesCell}><Tag section="fees" entityType="fee" ids={[1]} className={H.feesCellTag} />14:30</td><td data-name>Delivery</td></tr></tbody>
      </table>
    </div>
  )
}
function FeesCard() {
  return (
    <div className="w-72" data-fixture="fees-card">
      <button type="button" className={H.feesCard}>
        <Tag section="fees" entityType="fee" ids={[1]} className={H.feesCardTag} />
        <div className="flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-xs">14:30</span><span className="min-w-0 flex-1 text-sm font-medium" data-name>Delivery</span><span className="ml-auto text-sm font-semibold">$3.00</span></div>
      </button>
    </div>
  )
}
function BranchCard() {
  return (
    <div className="w-80" data-fixture="branch-card">
      <div className={H.branchCard}>
        <Tag section="branches" entityType="branch" ids={[1]} className={H.branchCardTag} />
        <div className="p-3 sm:p-4"><div className="flex items-center gap-1.5"><span className="h-3.5 w-3.5" /><span className="text-base font-bold" data-name>Main Store</span></div></div>
      </div>
    </div>
  )
}
function Toolbar() {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 pt-3" data-fixture="toolbar">
      <div className={${JSON.stringify(wrapperStrip)}} data-strip>
        <PendingReviewSync />
        <ProductsHeaderActions t={t} onAdd={noop} historySlot={<button type="button" className="btn-secondary h-10 min-w-0 flex-1 sm:flex-none sm:min-w-[6.5rem]">{t('action_history')}</button>} />
      </div>
    </div>
  )
}
function InventoryTable() {
  return (
    <div data-fixture="inventory">
      <InventoryProductsSurface items={items} total={items.length} page={1} pageSize={20} totalPages={1} branchFilter="all" loading={false} error={null}
        serverStats={null} statsLoading={false} t={t} fmtUSD={(v) => '$' + v} fmtKHR={(v) => v + 'KHR'}
        onPageChange={noop} onPageSizeChange={noop} onOpenDetail={noop} onOpenInCatalogue={noop} />
    </div>
  )
}

function Page() {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    // The page-level read, as every host page does it, then the rows are measured.
    void refreshPendingReviewTargets('mine').then(() => setReady(true))
  }, [])
  // The app's own context, in the page's language: the tags and the Add button name read their words from it.
  return (
    <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t, language: lang }}>
      <main style={{ padding: 12, maxWidth: 1180 }} data-ready={ready ? '1' : '0'}>
        <Toolbar />
        <InventoryTable />
        <ProductsRow indented={false} />
        <ProductsRow indented />
        <div className="flex flex-wrap gap-3"><ProductsCard indented={false} /><ProductsCard indented /></div>
        <FeesRow />
        <div className="flex flex-wrap gap-3"><FeesCard /><BranchCard /></div>
      </main>
    </AppContext.Provider>
  )
}
createRoot(document.getElementById('root')).render(<Page />)
`

const built = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root, sourcefile: 'pending-review-layout-fixture.tsx' },
  bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
})
const bundle = built.outputFiles[0].text
const sources = [header, products, fees, branches, read('src/components/inventory/InventoryProductsSurface.tsx'), read('src/components/shared/PendingReviewTag.tsx'), fixture, read('src/components/shared/toolbarButtonStyles.ts')].join('\n')
const css = (await postcss([tailwindcss({ ...tailwindConfig, content: [{ raw: sources, extension: 'tsx' }] })]).process(read('src/styles/main.css'), { from: path.join(root, 'src/styles/main.css') })).css
const server = http.createServer((request, response) => {
  response.setHeader('cache-control', 'no-store')
  if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle); return }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  const language = new URL(request.url || '/', 'http://fixture').searchParams.get('lang') || 'en'
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="lang-${language}"><div id="root"></div><script src="/fixture.js"></script></body></html>`)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(fs.existsSync)

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number }
type Measured = {
  boxes: Array<[string, Box]>
  tags: Array<{ fixture: string; box: Box; svg: Box; position: string; pointerEvents: string; host: Box; contentLeft: number; coveredBy: string; visible: boolean; name: string | null }>
  scrollWidth: number
  strip: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number } | null
  add: { button: Box; badge: Box | null; label: Box; icon: Box; badgeText: string | null; badgePointerEvents: string | null; badgeHidden: string | null; buttonName: string | null } | null
  /** The browser's accessibility-tree line for the Add button: its accessible NAME, which is what a screen reader says. */
  addAria: string
}

// Run in the page: every element that is not the tag (or inside it) is recorded with its box.
function measureInPage(): Measured {
  const round = (n: number) => Math.round(n * 100) / 100
  const box = (el: Element): Box => {
    const r = el.getBoundingClientRect()
    return { left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }
  }
  const isTag = (el: Element) => el.matches('[role="img"][aria-label]')
  const boxes: Array<[string, Box]> = []
  const tags: Measured['tags'] = []
  for (const fixture of Array.from(document.querySelectorAll('[data-fixture]'))) {
    const name = fixture.getAttribute('data-fixture') || ''
    let index = 0
    for (const el of Array.from(fixture.querySelectorAll('*'))) {
      if (isTag(el)) {
        const host = el.parentElement as HTMLElement
        // Where the host's own content begins: the left edge of its first text or leaf element, tag excluded.
        let contentLeft = Infinity
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (el.contains(node)) continue
          let rect: DOMRect | null = null
          if (node.nodeType === Node.TEXT_NODE) {
            if (!(node.textContent || '').trim()) continue
            const range = document.createRange()
            range.selectNodeContents(node)
            rect = range.getBoundingClientRect()
          } else if (!(node as Element).children.length) {
            rect = (node as Element).getBoundingClientRect()
          }
          if (rect && rect.width > 0 && rect.height > 0) contentLeft = Math.min(contentLeft, rect.left)
        }
        const tagBox = box(el)
        const svg = el.querySelector('svg')
        const centreX = tagBox.left + tagBox.width / 2
        const centreY = tagBox.top + tagBox.height / 2
        const top = document.elementFromPoint(centreX, centreY)
        tags.push({
          fixture: name,
          box: tagBox,
          svg: svg ? box(svg) : tagBox,
          position: getComputedStyle(el).position,
          pointerEvents: getComputedStyle(el).pointerEvents,
          host: box(host),
          contentLeft: Number.isFinite(contentLeft) ? round(contentLeft) : round(box(host).right),
          coveredBy: top ? (top === el || el.contains(top) ? 'the tag' : top.tagName.toLowerCase()) : 'nothing',
          visible: tagBox.width > 0 && (el as HTMLElement).offsetParent !== null,
          name: el.getAttribute('aria-label'),
        })
        continue
      }
      if (el.closest('[role="img"][aria-label], [data-pending-review-count]')) continue
      boxes.push([`${name}#${index++}:${el.tagName.toLowerCase()}`, box(el)])
    }
  }
  const strip = document.querySelector('[data-strip]')
  const addButton = document.querySelector('[data-fixture="toolbar"] button.btn-primary')
  let add: Measured['add'] = null
  if (addButton) {
    const badge = addButton.querySelector('[data-pending-review-count]')
    add = {
      button: box(addButton),
      badge: badge ? box(badge) : null,
      label: box(addButton.querySelector('span') as Element),
      icon: box(addButton.querySelector('svg') as Element),
      badgeText: badge ? badge.textContent : null,
      badgePointerEvents: badge ? getComputedStyle(badge).pointerEvents : null,
      badgeHidden: badge ? badge.getAttribute('aria-hidden') : null,
      buttonName: addButton.getAttribute('aria-label'),
    }
  }
  return {
    addAria: '',
    boxes,
    tags,
    scrollWidth: document.documentElement.scrollWidth,
    strip: strip ? { scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth, scrollHeight: strip.scrollHeight, clientHeight: strip.clientHeight } : null,
    add,
  }
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let failed = 0
const results: string[] = []
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  for (const language of ['en', 'km'] as const) for (const width of [375, 1280]) {
    const label = `${language} ${width}px`
    try {
      const measure = async (waiting: boolean, creates = 2): Promise<Measured> => {
        const context = await browser!.newContext({ viewport: { width, height: 900 } })
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto(`http://127.0.0.1:${address.port}/?lang=${language}&pending=${waiting ? 1 : 0}&creates=${creates}`)
        await page.locator('main[data-ready="1"]').waitFor({ timeout: 15000 })
        // Let the tags paint (they appear when the store's list lands).
        await page.waitForTimeout(150)
        const result = await page.evaluate(measureInPage)
        result.addAria = await page.locator('[data-fixture="toolbar"] button.btn-primary').ariaSnapshot()
        assert.deepEqual(errors, [], `${label}: no page errors`)
        await context.close()
        return result
      }
      const without = await measure(false)
      const withTags = await measure(true)

      // 1. Nothing else moved: same boxes, in the same order, to the hundredth of a pixel.
      assert.equal(without.tags.length, 0, `${label}: no tag while nothing is pending`)
      assert.equal(without.add?.badge, null, `${label}: no badge while nothing is pending`)
      assert.equal(withTags.boxes.length, without.boxes.length, `${label}: the same elements are on the page with and without the tags`)
      const moved = withTags.boxes.filter(([key, box], index) => key !== without.boxes[index][0] || JSON.stringify(box) !== JSON.stringify(without.boxes[index][1]))
      assert.deepEqual(moved.slice(0, 5), [], `${label}: ${moved.length} boxes changed size or place when the tags appeared`)
      assert.equal(withTags.scrollWidth, without.scrollWidth, `${label}: the page gained no horizontal overflow`)

      // 2. The tags themselves.
      // (the toolbar's count badge is a different shape and is judged on its own below)
      const visible = withTags.tags.filter((tag) => tag.visible && tag.fixture !== 'toolbar')
      const byFixture = (name: string) => visible.filter((tag) => tag.fixture === name)
      assert.equal(byFixture('products-row').length, 1, `${label}: Products row tag`)
      assert.equal(byFixture('products-child-row').length, 1, `${label}: grouped child row tag (its image cell is empty but hosts the tag)`)
      assert.equal(byFixture('products-card').length, 1, `${label}: Products card tag`)
      assert.equal(byFixture('products-child-card').length, 1, `${label}: grouped Products child card tag`)
      assert.equal(byFixture('fees-row').length, 1, `${label}: expense row tag`)
      assert.equal(byFixture('fees-card').length, 1, `${label}: expense card tag`)
      assert.equal(byFixture('branch-card').length, 1, `${label}: branch card tag`)
      // Inventory draws a desktop row AND a phone card for each product, and CSS shows one of the two sets. Two display
      // rows wait: the merged Tea row (ids 1 and 2, id 2 waiting) and Soap (id 7); Salt (id 8) does not.
      assert.equal(withTags.tags.filter((tag) => tag.fixture === 'inventory').length, 4, `${label}: Tea and Soap carry a tag on both the row and the card, Salt on neither`)
      assert.equal(byFixture('inventory').length, 2, `${label}: the two tags of the visible layout are on screen`)
      for (const tag of visible) {
        const where = `${label} ${tag.fixture}`
        assert.equal(tag.name, (language === 'km' ? km : en).pending_review_tag, `${where}: the tag is named in the page's language`)
        assert.equal(tag.position, 'absolute', `${where}: out of the flow`)
        assert.equal(tag.pointerEvents, 'none', `${where}: a tap goes to the row`)
        assert.ok(Math.abs(tag.box.width - 10) < 0.01 && Math.abs(tag.box.height - 10) < 0.01, `${where}: a 10px box, was ${tag.box.width} x ${tag.box.height}`)
        assert.notEqual(tag.coveredBy, 'the tag', `${where}: the tag must not be what a tap lands on`)
        // The hourglass is drawn in x 5..19 of its 24-unit box (+ half the 2.25 stroke): 1.6px..8.4px of 10.
        const inkLeft = tag.svg.left + 1.6
        const inkRight = tag.svg.right - 1.6
        assert.ok(inkLeft >= tag.host.left - 0.01, `${where}: the drawn hourglass starts inside its host (${inkLeft} vs ${tag.host.left})`)
        assert.ok(inkRight <= tag.contentLeft + 0.01, `${where}: the drawn hourglass ends before the host's own content begins (${inkRight} vs ${tag.contentLeft}): ${JSON.stringify(tag)}`)
        assert.ok(tag.svg.top + 0.3 >= tag.host.top && tag.svg.bottom - 0.3 <= tag.host.bottom, `${where}: inside the host vertically`)
      }

      // 3. The Add button's count badge: two creates are waiting.
      const add = withTags.add
      assert.ok(add && add.badge, `${label}: the Add button shows a badge for two waiting creates`)
      assert.equal(add.badgeText, '2')
      assert.equal(add.badgePointerEvents, 'none')
      // The count reaches a screen reader through the button's NAME (a button's children are presentational),
      // read from the browser's own accessibility tree, in the user's language.
      const plain = without.add!.buttonName || ''
      assert.ok(plain.length > 0 && !/\d/.test(plain), `${label}: the Add button has a plain name while nothing waits (${plain})`)
      assert.equal(add.badgeHidden, 'true', `${label}: the badge is decoration, hidden from the accessibility tree`)
      const waitingLabel = (language === 'km' ? km : en).pending_review_tag
      assert.equal(add.buttonName, `${plain}, ${waitingLabel}: 2`, `${label}: the name carries the count (saw ${JSON.stringify(add.buttonName)})`)
      assert.ok(withTags.addAria.includes(`button "${add.buttonName}"`), `${label}: the accessibility tree names the button "${add.buttonName}", saw ${withTags.addAria}`)
      assert.ok(without.addAria.includes(`button "${plain}"`) && !without.addAria.includes(waitingLabel), `${label}: ${without.addAria}`)
      assert.deepEqual(add.button, without.add!.button, `${label}: the Add button keeps its exact box`)
      assert.deepEqual(add.label, without.add!.label, `${label}: the label keeps its place`)
      assert.deepEqual(add.icon, without.add!.icon, `${label}: the icon keeps its place`)
      assert.ok(add.badge.left >= add.button.left && add.badge.right <= add.button.right && add.badge.top >= add.button.top && add.badge.bottom <= add.button.bottom, `${label}: the badge is inside the button`)
      assert.ok(add.badge.left >= add.label.right - 0.5 || add.badge.bottom <= add.label.top + 0.5 || add.badge.top >= add.label.bottom - 0.5, `${label}: the badge does not sit on the label ${JSON.stringify({ button: add.button, badge: add.badge, label: add.label, icon: add.icon })}`)
      assert.equal(withTags.strip!.scrollWidth, withTags.strip!.clientWidth, `${label}: no horizontal scrollbar appears in the toolbar strip`)
      assert.equal(withTags.strip!.scrollHeight, withTags.strip!.clientHeight, `${label}: nothing is clipped vertically in the toolbar strip`)
      assert.deepEqual(withTags.strip, without.strip, `${label}: the strip keeps its scroll geometry`)

      // 4. Past nine the badge reads "9+", the widest it gets: it must still clear the label and the button's edge.
      const many = await measure(true, 12)
      const wide = many.add!
      assert.equal(wide.badgeText, '9+')
      assert.equal(wide.buttonName, `${plain}, ${waitingLabel}: 12`, `${label}: the name carries the real count, not 9+`)
      assert.deepEqual(wide.button, without.add!.button, `${label}: "9+" does not change the button's size`)
      assert.ok(wide.badge!.left >= wide.button.left && wide.badge!.right <= wide.button.right && wide.badge!.top >= wide.button.top && wide.badge!.bottom <= wide.button.bottom, `${label}: "9+" stays inside the button`)
      assert.ok(wide.badge!.left >= wide.label.right, `${label}: "9+" starts after the label ends ${JSON.stringify({ badge: wide.badge, label: wide.label })}`)
      assert.equal(many.strip!.scrollWidth, many.strip!.clientWidth, `${label}: "9+" adds no scrollbar to the strip`)

      results.push(`PASS ${label}: ${without.boxes.length} boxes identical with and without ${withTags.tags.length} tags + badge; add button ${add.button.width}x${add.button.height}, badge ${add.badge.width}x${add.badge.height} at ${add.badge.left - add.button.left}px from the button's left`)
    } catch (error) {
      failed++
      console.error(`FAIL ${label}`)
      console.error(error)
    }
  }
} finally {
  await browser?.close()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
for (const line of results) console.log(line)
if (failed) process.exitCode = 1
