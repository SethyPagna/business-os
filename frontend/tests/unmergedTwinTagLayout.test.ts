import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// Owner, 16 Nov 2026 (F3 ruling, "Open, tag both rows"): two UNMERGED duplicates (same name, same real barcode,
// leading zeros folded) each carry a small "Duplicate" tag with a tooltip; two real variants (same name, different
// real barcodes) and a single product carry none. In a real browser, the REAL Inventory list at phone and desktop
// widths, English and Khmer: both twins tagged, no variant or single tagged, the tag costs no row height (each row is
// measured with the tag and again with the tag hidden), stays inside its row, the page never scrolls sideways, and
// Khmer text keeps its line box.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const packs = { en: JSON.parse(read('src/lang/en.json')) as Record<string, string>, km: JSON.parse(read('src/lang/km.json')) as Record<string, string> }

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import InventoryProductsSurface from '/src/components/inventory/InventoryProductsSurface.tsx'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '@fontsource/noto-sans-khmer/400.css'
  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const t = key => (lang === 'km' ? km : en)[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  window.fetch = async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const name = (en_, km_) => (lang === 'km' ? km_ : en_)
  const base = { low_stock_threshold: 10, out_of_stock_threshold: 0, selling_price_usd: 4, cost_price_usd: 2 }
  const row = (id, label, qty, barcode) => ({ ...base, id, name: label, barcode, display_quantity: qty, stock_quantity: qty, stock_value_usd: qty * 2, branch_stock: [{ branch_id: 1, branch_name: name('Main', 'សាខាមេ'), quantity: qty }] })
  const twin = name('Twin Serum', 'ស៊ីរ៉ូមស្ទួន')
  const variant = name('Variant Gel', 'ជែលពណ៌ផ្សេង')
  const items = [
    row(1, twin, 8, '8851234567890'),
    row(2, twin, 50, '08851234567890'),
    row(3, variant, 5, '8850000000011'),
    row(4, variant, 7, '8850000000022'),
    row(5, name('Single item', 'ទំនិញតែមួយ'), 30, '8857777777777'),
  ]
  const noop = () => {}
  createRoot(document.getElementById('root')).render(
    <AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, can: () => true, t, language: lang }}>
      <div data-fixture="inventory" className="p-2">
        <InventoryProductsSurface items={items} total={items.length} page={1} pageSize={20} totalPages={1} branchFilter="all" loading={false} error={null}
          serverStats={null} statsLoading={false} t={t} fmtUSD={v => '$' + v} fmtKHR={v => v + 'KHR'}
          onPageChange={noop} onPageSizeChange={noop} onOpenDetail={noop} onOpenInCatalogue={noop} />
      </div>
    </AppContext.Provider>,
  )
`

type Row = { barcode: string; tagged: boolean; title: string; text: string; tagCount: number; withTag: number; withoutTag: number; inside: boolean }
type Measure = { rows: Row[]; overflow: number }

// Runs in the page. Visible rows only (the other layout is display:none): a row is the <tr> or the .card holding one barcode.
const measure = String.raw`(() => {
  const barcodes = ['8851234567890', '08851234567890', '8850000000011', '8850000000022', '8857777777777']
  const containers = [...document.querySelectorAll('tr, .card')].filter((el) => el.getClientRects().length > 0 && !el.querySelector('tr, .card') && barcodes.some((code) => el.textContent.includes(code)))
  const out = containers.map((el) => {
    const tags = [...el.querySelectorAll('[data-unmerged-twin]')]
    const tag = tags[0]
    const barcode = barcodes.find((code) => !(code === '8851234567890' && el.textContent.includes('08851234567890')) && el.textContent.includes(code))
    const entry = { barcode, tagged: tags.length > 0, tagCount: tags.length, title: tag ? tag.title : '', text: tag ? tag.textContent.trim() : '', withTag: el.getBoundingClientRect().height, withoutTag: 0,
      inside: tag ? tag.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5 && tag.getBoundingClientRect().left >= el.getBoundingClientRect().left - 0.5 : true }
    return { entry, tags, el }
  })
  for (const item of out) for (const tag of item.tags) tag.style.display = 'none'
  const rows = out.map(({ entry, el }) => ({ ...entry, withoutTag: el.getBoundingClientRect().height }))
  return { rows, overflow: document.documentElement.scrollWidth - innerWidth }
})()`

const browser = await launchResolveFixture('unmerged-twin-tag-layout', fixture)
await browser.run('PASS unmerged twin tag: both twins tagged, variants and singles not, no added row height, EN and KM, 375 and 1280 px', async () => {
  for (const width of [375, 1280]) for (const lang of ['en', 'km'] as const) {
    const label = `${width}px ${lang}`
    await browser.open(width, `lang=${lang}`, `document.querySelector('[data-unmerged-twin]')`, 900)
    if (lang === 'km') await browser.khmerRoom(label, '[data-fixture="inventory"]', 3)
    const result = await browser.evaluate<Measure>(measure)
    assert.equal(result.rows.length, 5, `${label}: five records, five visible rows (nothing folded): ${result.rows.map((r) => r.barcode)}`)
    const byCode = Object.fromEntries(result.rows.map((r) => [r.barcode, r]))
    for (const code of ['8851234567890', '08851234567890']) {
      const row = byCode[code]
      assert.ok(row, `${label}: the twin ${code} has its own row`)
      assert.equal(row.tagCount, 1, `${label}: twin ${code} carries exactly one tag`)
      assert.equal(row.text, packs[lang].product_duplicate_badge, `${label}: twin ${code} tag text`)
      assert.equal(row.title, packs[lang].product_twin_row_hint, `${label}: twin ${code} tooltip`)
      assert.ok(row.inside, `${label}: twin ${code} tag stays inside its row`)
      assert.ok(Math.abs(row.withTag - row.withoutTag) < 0.5, `${label}: the tag changed the height of ${code}: ${row.withoutTag} -> ${row.withTag}`)
    }
    for (const code of ['8850000000011', '8850000000022', '8857777777777']) assert.equal(byCode[code]?.tagged, false, `${label}: ${code} is not a twin and carries no tag`)
    assert.ok(result.overflow <= 0, `${label}: no horizontal page scroll (${result.overflow})`)
  }
})
