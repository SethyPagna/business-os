import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Owner ask 15 Nov 2026: the Inventory list's stock figure is itself tinted by state (green healthy,
// yellow low, red out) -- not a badge or a column. In a real browser, the REAL InventoryProductsSurface at
// phone and desktop widths, English and Khmer, light and dark:
//   - every state shows, with the state word as tooltip on the WHOLE tinted pill (its padding too, checked by hit-testing
//     both padding edges) and as screen-reader text, and the figure is rendered once: the pill's textContent and innerText are
//     exactly "4 Low Stock", never "44 Low Stock";
//   - the tint costs no height: each row/card is measured with the pill and again with the pill's classes
//     stripped, and the two heights are equal (a pill with vertical padding fails this);
//   - the pill stays inside its cell/card and the page never scrolls sideways;
//   - the tint is readable (WCAG contrast >= 4.5) and differs between the themes;
//   - Khmer text keeps its line box.
// Two UNMERGED duplicates (same name and barcode; 8 and 50 against a threshold of 10) are two rows side by side, one low and one
// healthy, each judged on its own figure (owner, 16 Nov 2026: no folded rows, duplicates next to each other).
// The Transfer modal's subtitle (the REAL InventoryStockModals, ?view=transfer) shows the same tinted figure.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const packs = { en: JSON.parse(read('src/lang/en.json')) as Record<string, string>, km: JSON.parse(read('src/lang/km.json')) as Record<string, string> }

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import InventoryProductsSurface from '/src/components/inventory/InventoryProductsSurface.tsx'
  import InventoryStockModals from '/src/components/inventory/InventoryStockModals.tsx'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '@fontsource/noto-sans-khmer/400.css'
  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const dark = params.get('theme') === 'dark'
  const t = key => (lang === 'km' ? km : en)[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  if (dark) document.documentElement.classList.add('dark')
  window.fetch = async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const name = (en_, km_) => (lang === 'km' ? km_ : en_)
  const base = { low_stock_threshold: 10, out_of_stock_threshold: 0, selling_price_usd: 4, cost_price_usd: 2 }
  const row = (id, label, qty, extra = {}) => ({ ...base, id, name: label, barcode: String(1000 + id), display_quantity: qty, stock_quantity: qty, stock_value_usd: qty * 2, branch_stock: [{ branch_id: 1, branch_name: name('Main', 'សាខាមេ'), quantity: qty }], ...extra })
  const items = [
    row(1, name('Out of stock item', 'ទំនិញអស់ពីស្តុក'), 0),
    row(2, name('Low stock item with a rather long product name for the phone layout', 'ទំនិញស្តុកទាបដែលមានឈ្មោះវែងខ្លាំងសម្រាប់ទូរស័ព្ទ ១០០មីលីលីត្រ'), 4),
    row(3, name('Healthy item', 'ទំនិញស្តុកល្អ'), 40),
    row(4, name('Duplicate item', 'ទំនិញស្ទួន'), 8, { barcode: '5550' }),
    row(5, name('Duplicate item', 'ទំនិញស្ទួន'), 50, { barcode: '5550' }),
  ]
  const noop = () => {}
  const tr = (key, fallback) => (t(key) !== key ? t(key) : (fallback ?? key))
  const transfer = (
    <InventoryStockModals getStockQty={() => 4} onCloseTransfer={noop} onTransfer={noop} setTransferForm={noop} t={t} tr={tr}
      transferForm={{ from_branch_id: '1', to_branch_id: '', quantity: '', reason: '' }} transferSaving={false} transferSourceBranchOptions={[]}
      transferModal={{ ...base, id: 2, name: name('Low item', 'ទំនិញទាប'), unit: 'pcs', stock_quantity: 4, branch_stock: [{ branch_id: 1, branch_name: 'Main', quantity: 4 }] }} />
  )
  if (params.get('view') === 'transfer') createRoot(document.getElementById('root')).render(
    <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t, language: lang }}>{transfer}</AppContext.Provider>,
  )
  else createRoot(document.getElementById('root')).render(
    <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t, language: lang }}>
      <div data-fixture="inventory" className="p-2">
        <InventoryProductsSurface items={items} total={items.length} page={1} pageSize={20} totalPages={1} branchFilter="all" loading={false} error={null}
          serverStats={null} statsLoading={false} t={t} fmtUSD={v => '$' + v} fmtKHR={v => v + 'KHR'}
          onPageChange={noop} onPageSizeChange={noop} onOpenDetail={noop} onOpenInCatalogue={noop} />
      </div>
    </AppContext.Provider>,
  )
`

type Measure = {
  pills: Array<{ state: string; text: string; textContent: string; innerText: string; title: string; hidden: number; padHit: boolean[]; srWord: string; withPill: number; withoutPill: number; inside: boolean; contrast: number; background: string }>
  overflow: number
}

// Runs in the page. Visible pills only (the other layout is display:none). Height is read with the pill, then again
// with its tint classes stripped.
const measure = String.raw`(() => {
  const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const floor = document.documentElement.classList.contains('dark') ? { r: 23, g: 23, b: 23 } : { r: 255, g: 255, b: 255 }
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a) })
  const effective = (el) => { const chain = []; for (let n = el; n; n = n.parentElement) chain.push(parse(getComputedStyle(n).backgroundColor)); let acc = floor; for (const layer of chain.reverse()) acc = over(layer, acc); return acc }
  const pills = [...document.querySelectorAll('[data-stock-qty]')].filter((el) => el.getClientRects().length > 0)
  const container = (el) => el.closest('tr') || el.closest('.card') || el.closest('.detail-scroll-text')
  const first = pills.map((el) => {
    const c = container(el)
    const bg = effective(el)
    const fg = parse(getComputedStyle(el).color)
    const l1 = lum(over({ ...fg, a: 1 }, bg)) + 0.05, l2 = lum(bg) + 0.05
    el.scrollIntoView({ block: 'center', inline: 'nearest' }) // hit-testing only sees the viewport
    const box = el.getBoundingClientRect()
    const hit = (x) => { const top = document.elementFromPoint(x, box.top + box.height / 2); return !!top && top.closest('[title]') === el }
    return { state: el.dataset.stockState, text: el.firstChild.textContent.trim(), textContent: el.textContent, innerText: el.innerText, title: el.title, hidden: el.querySelectorAll('[aria-hidden]').length, padHit: [hit(box.left + 1.5), hit(box.right - 1.5), hit(box.left + box.width / 2)], srWord: el.querySelector('.stock-qty-word').textContent.trim(), withPill: c.getBoundingClientRect().height,
      inside: el.getBoundingClientRect().right <= el.parentElement.getBoundingClientRect().right + 0.5 && el.getBoundingClientRect().left >= el.parentElement.getBoundingClientRect().left - 0.5,
      contrast: Math.max(l1, l2) / Math.min(l1, l2), background: getComputedStyle(el).backgroundColor }
  })
  for (const el of pills) el.className = ''
  const out = first.map((entry, i) => ({ ...entry, withoutPill: container(pills[i]).getBoundingClientRect().height }))
  return { pills: out, overflow: document.documentElement.scrollWidth - innerWidth }
})()`

const browser = await launchResolveFixture('stock-qty-layout', fixture)
await browser.run('PASS stock-qty layout: pill adds no row height, readable in both themes, EN and KM, 375 and 1280 px', async () => {
  const backgrounds: Record<string, string> = {}
  for (const width of [375, 1280]) for (const lang of ['en', 'km'] as const) for (const theme of ['light', 'dark']) {
    const label = `${width}px ${lang} ${theme}`
    await browser.open(width, `lang=${lang}&theme=${theme}`, `document.querySelector('[data-stock-qty]')`, 900)
    if (lang === 'km') await browser.khmerRoom(label, '[data-fixture="inventory"]', 3)
    // STOCK_QTY_SHOTS=<dir> also saves a screenshot of each case (for the report); the assertions do not depend on it.
    if (process.env.STOCK_QTY_SHOTS) {
      mkdirSync(process.env.STOCK_QTY_SHOTS, { recursive: true })
      const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(`${process.env.STOCK_QTY_SHOTS}/stock-qty-${width}-${lang}-${theme}.png`, Buffer.from(shot.data, 'base64'))
    }
    const result = await browser.evaluate<Measure>(measure)
    // 5 products, none folded => 5 rows/cards, one pill each.
    assert.equal(result.pills.length, 5, `${label}: one pill per visible row`)
    assert.deepEqual(result.pills.map((p) => p.state).sort(), ['healthy', 'healthy', 'low', 'low', 'out'], `${label}: out, healthy, the low row, and the two duplicates (8 low, 50 healthy)`)
    const figures = result.pills.map((p) => p.text)
    assert.equal(Math.abs(figures.indexOf('8') - figures.indexOf('50')), 1, `${label}: the two duplicates sit next to each other (${figures})`)
    for (const pill of result.pills) {
      const word = packs[lang][{ out: 'out_of_stock', low: 'low_stock', healthy: 'healthy_stock' }[pill.state]!]
      assert.equal(pill.title, word, `${label}: tooltip is the ${pill.state} word`)
      assert.deepEqual(pill.padHit, [true, true, true], `${label}: the tooltip covers the padding on both sides and the middle`)
      assert.equal(pill.hidden, 0, `${label}: nothing in the pill is hidden from screen readers`)
      assert.equal(pill.srWord, word, `${label}: screen-reader text is the ${pill.state} word, once`)
      assert.equal(pill.textContent, `${pill.text} ${word}`, `${label}: textContent is the figure once, then the word once`)
      assert.equal(pill.innerText, `${pill.text} ${word}`, `${label}: innerText (what Ctrl+F and copy see) is the figure once, then the word once`)
      assert.ok(Math.abs(pill.withPill - pill.withoutPill) < 0.5, `${label}: ${pill.state} pill changed the row height ${pill.withoutPill} -> ${pill.withPill}`)
      assert.ok(pill.inside, `${label}: ${pill.state} pill stays inside its cell`)
      assert.ok(pill.contrast >= 4.5, `${label}: ${pill.state} contrast ${pill.contrast.toFixed(2)} >= 4.5`)
      assert.notEqual(pill.background, 'rgba(0, 0, 0, 0)', `${label}: ${pill.state} is actually tinted`)
      backgrounds[`${theme}:${pill.state}`] = pill.background
    }
    assert.ok(result.overflow <= 0, `${label}: no horizontal page scroll (${result.overflow})`)
  }
  // The Transfer modal subtitle: one tinted figure (the product has 4 against a threshold of 10, so "low"), same tooltip and screen-reader text, no height change.
  for (const width of [375, 1280]) for (const lang of ['en', 'km'] as const) for (const theme of ['light', 'dark']) {
    const label = `transfer ${width}px ${lang} ${theme}`
    await browser.open(width, `view=transfer&lang=${lang}&theme=${theme}`, `document.querySelector('[data-stock-qty]')`, 900)
    const result = await browser.evaluate<Measure>(measure)
    assert.equal(result.pills.length, 1, `${label}: one tinted figure in the subtitle`)
    const [pill] = result.pills
    const word = packs[lang].low_stock
    assert.equal(pill.state, 'low', `${label}: state`)
    assert.equal(pill.text, '4', `${label}: the figure`)
    assert.equal(pill.title, word, `${label}: tooltip`)
    assert.deepEqual(pill.padHit, [true, true, true], `${label}: the tooltip covers the whole pill`)
    assert.equal(pill.hidden, 0, `${label}: nothing hidden from screen readers`)
    assert.equal(pill.srWord, word, `${label}: screen-reader text`)
    assert.equal(pill.textContent, `4 ${word}`, `${label}: textContent`)
    assert.equal(pill.innerText, `4 ${word}`, `${label}: innerText`)
    assert.ok(Math.abs(pill.withPill - pill.withoutPill) < 0.5, `${label}: the subtitle changed height ${pill.withoutPill} -> ${pill.withPill}`)
    assert.ok(pill.inside, `${label}: stays inside the subtitle`)
    assert.ok(pill.contrast >= 4.5, `${label}: contrast ${pill.contrast.toFixed(2)} >= 4.5`)
    assert.ok(result.overflow <= 0, `${label}: no horizontal page scroll (${result.overflow})`)
  }
  for (const state of ['out', 'low', 'healthy']) assert.notEqual(backgrounds[`light:${state}`], backgrounds[`dark:${state}`], `${state}: dark theme has its own tint`)
  assert.equal(new Set(['out', 'low', 'healthy'].map((s) => backgrounds[`light:${s}`])).size, 3, 'the three states are three different tints')
})
