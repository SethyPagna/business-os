// Products -> Duplicates in a real browser (owner asks N2, N3, N4 of 23 Sep
// 2026), at 375px and 1280px, in English and Khmer.
//
//   N2  the conflict card's product row: the name has its own full-width row
//       and wraps with no ellipsis; barcode, cost, selling, stock and the
//       branch split share ONE row that scrolls sideways; the card's one
//       action is the footer Resolve (no Keep / Merge / per-row Resolve); a
//       tap on the name opens the product preview; nothing overflows the page.
//   N3  the Resolve path, the shared ResolveModal driven by the real product
//       adapter over a fake Worker: the grid renders the product rows (no
//       "Product kept" row), the confirm shows before -> after, apply shows
//       the after.
//   N4  the cost row is editable for a cost editor and locked for a viewer.
//
// Run: node tests/productConflictRowLayout.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const packs: Record<string, Record<string, string>> = {
  en: JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')),
  km: JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')),
}
const pack = (lang: string, key: string): string => packs[lang][key]

const fixtureSource = String.raw`
  import React, { StrictMode, useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import { ProductConflictClusterCard } from '/src/components/products/ProductDuplicatesTab.tsx'
  import ResolveModal from '/src/components/shared/ResolveModal.tsx'
  import { createProductResolveAdapter } from '/src/components/products/productResolveAdapter.ts'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '@fontsource/noto-sans-khmer/500.css'
  import '@fontsource/noto-sans-khmer/600.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const pack = lang === 'km' ? km : en
  const t = (key) => pack[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  const editor = params.get('perm') !== 'viewer'
  const user = { id: 1, username: editor ? 'admin' : 'viewer', role: 'staff', permissions: JSON.stringify(editor ? { all: true } : { products: true, product_cost_view: true }) }
  const LONG = 'Estée Lauder Double Wear Stay-in-Place Foundation SPF 10 Desert Beige 2N1 30ml Travel Size Edition'
  const product = (id, name, barcode, cost, selling, stock, branch_stock) => ({ id, name, barcode, cost_price_usd: cost, cost_price_khr: cost * 4100, selling_price_usd: selling, stock_quantity: stock, image_path: null, branch_stock })
  const cluster = { type: 'name', value: LONG, severity: 'same_name', products: [
    product(10, LONG, '8801111111111', 5, 12, 3, [{ branch_id: 1, branch_name: 'shop', quantity: 3 }]),
    product(11, LONG + ' (old)', '8802222222222', 7, 15, 2, [{ branch_id: 1, branch_name: 'shop', quantity: 1 }, { branch_id: 2, branch_name: 'warehouse', quantity: 1 }]),
  ] }
  window.__previewed = []
  window.__merges = []
  const api = {
    async preview(keepId, mergeId) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        stockImpact: { totalQuantity: 2, branches: [{ branchId: 1, branchName: 'shop', quantity: 1 }, { branchId: 2, branchName: 'warehouse', quantity: 1 }] },
        needsStockChoice: true, blocked: null,
        keeperStock: { totalQuantity: 3, branches: [{ branchId: 1, branchName: 'shop', quantity: 3 }] },
        groupCost: { cost_price_usd: 6, cost_price_khr: 24600 },
        reviewedDigest: 'a'.repeat(64),
        groupProducts: cluster.products,
      }
    },
    async merge(keepId, mergeId, stock, keep) {
      window.__merges.push({ keepId, mergeId, stock, keep })
      return { keeper: { id: 10, name: LONG, barcode: '8801111111111', cost_price_usd: keep.cost_price_usd ?? 6, selling_price_usd: 15, stock_quantity: 5, branch_stock: [{ branchId: 1, branchName: 'shop', quantity: 4 }, { branchId: 2, branchName: 'warehouse', quantity: 1 }], absorbed_barcodes: ['8802222222222'] } }
    },
  }

  function Card() {
    return React.createElement('div', { style: { padding: 16 } },
      React.createElement('div', { className: 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3', id: 'cards' },
        React.createElement(ProductConflictClusterCard, {
          cluster, t, dismissing: false, merging: false, selected: false, selectable: true,
          canRemoveProduct: false, removalReasons: {}, onToggleSelect() {}, onRemovalChange() {}, onDismiss() {},
          onResolve() { window.__resolves = (window.__resolves || 0) + 1 }, onPreview: (entry) => window.__previewed.push(entry.id),
        })))
  }
  function Grid() {
    const [adapter] = useState(() => createProductResolveAdapter({ cluster, t, canViewCosts: true, canEditCosts: editor, canMerge: () => true, api }))
    return React.createElement(ResolveModal, { title: 'Resolve', adapter, onClose() { window.__closed = true } })
  }
  const value = { ...FALLBACK_APP_CONTEXT, user, t, language: lang, can: () => true, hasPermission: () => true }
  createRoot(document.getElementById('root')).render(React.createElement(StrictMode, null,
    React.createElement(AppContext.Provider, { value }, params.get('mode') === 'grid' ? React.createElement(Grid) : React.createElement(Card))))
`

const browser = await launchResolveFixture('product-conflict-row', fixtureSource)
const { evaluate, open, waitFor, mouseClick, pause, khmerRoom, run, send } = browser
// Opt-in evidence: PRODUCT_CONFLICT_SHOTS=<dir> saves a PNG per layout checked.
const shotDir = process.env.PRODUCT_CONFLICT_SHOTS || ''
async function shot(name: string): Promise<void> {
  if (!shotDir) return
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.mkdirSync(shotDir, { recursive: true })
  fs.writeFileSync(`${shotDir}/${name}.png`, Buffer.from(data, 'base64'))
}

type RowGeometry = {
  pageOverflow: boolean
  nameFull: boolean
  nameClamp: string
  nameEllipsis: string
  nameClipped: boolean
  nameLines: number
  metaTops: number[]
  metaTexts: string[]
  metaOverflows: boolean
  metaGaps: number[]
  metaRight: number
  rowRight: number
  stockInMeta: boolean
  buttonsInRow: number
}

const rowGeometry = (id: number) => evaluate<RowGeometry>(`(() => {
  const row = document.querySelector('[data-conflict-row="${id}"]')
  const nameButton = row.querySelector('[data-conflict-name]')
  const name = nameButton.querySelector('span:last-child')
  const meta = row.querySelector('[data-conflict-meta]')
  const metaItems = [...meta.querySelectorAll(':scope > div > *')]
  const stock = row.querySelector('[data-conflict-stock]')
  const rowBox = row.getBoundingClientRect()
  const buttonBox = nameButton.getBoundingClientRect()
  const nameStyle = getComputedStyle(name)
  const lineHeight = parseFloat(nameStyle.lineHeight) || parseFloat(nameStyle.fontSize) * 1.5
  return {
    pageOverflow: document.scrollingElement.scrollWidth > innerWidth + 1,
    nameFull: buttonBox.width >= rowBox.width - 16,
    nameClamp: nameStyle.webkitLineClamp || nameStyle.getPropertyValue('-webkit-line-clamp') || 'none',
    nameEllipsis: nameStyle.textOverflow,
    nameClipped: name.scrollHeight > name.clientHeight + 1 || name.scrollWidth > name.clientWidth + 1,
    nameLines: Math.round(name.getBoundingClientRect().height / lineHeight),
    metaTops: metaItems.map((child) => Math.round(child.getBoundingClientRect().top)),
    metaTexts: metaItems.map((child) => child.textContent.trim()),
    metaGaps: metaItems.slice(1).map((child, index) => Math.round(child.getBoundingClientRect().left - metaItems[index].getBoundingClientRect().right)),
    metaOverflows: meta.scrollWidth > meta.clientWidth + 1,
    metaRight: meta.getBoundingClientRect().right,
    rowRight: rowBox.right,
    stockInMeta: Boolean(stock && meta.contains(stock)),
    buttonsInRow: [...row.querySelectorAll('button')].filter((button) => !button.hasAttribute('data-conflict-name')).length,
  }
})()`)

await run('PASS product conflict rows (N2) and the product Resolve grid (N3, N4) at 375/1280 EN/KM', async () => {
  for (const width of [375, 1280]) {
    for (const lang of ['en', 'km']) {
      await open(width, `lang=${lang}`, `document.querySelector('[data-conflict-row="11"]')`)
      const label = `${width}px ${lang}`
      for (const id of [10, 11]) {
        const row = await rowGeometry(id)
        assert.equal(row.pageOverflow, false, `${label}: no page-wide horizontal overflow`)
        assert.equal(row.nameFull, true, `${label} #${id}: the name has its own full-width row`)
        assert.equal(row.nameClamp, 'none', `${label} #${id}: the name is not line-clamped`)
        assert.notEqual(row.nameEllipsis, 'ellipsis', `${label} #${id}: no ellipsis`)
        assert.equal(row.nameClipped, false, `${label} #${id}: the whole name is visible`)
        if (width === 375) assert.ok(row.nameLines >= 2, `${label} #${id}: a long name wraps (${row.nameLines} lines)`)
        assert.equal(new Set(row.metaTops).size, 1, `${label} #${id}: barcode, cost, selling, stock and branches on one row ${JSON.stringify(row.metaTexts)}`)
        assert.equal(row.metaTexts.length, id === 10 ? 5 : 6, `${label} #${id}: ${JSON.stringify(row.metaTexts)}`)
        assert.match(row.metaTexts[0], /^880/)
        assert.ok(row.metaGaps.every((gap) => gap >= 6), `${label} #${id}: the values are spaced apart ${JSON.stringify(row.metaGaps)}`)
        assert.equal(row.stockInMeta, true, `${label} #${id}: the stock count is part of the one row`)
        assert.ok(row.metaRight <= row.rowRight + 1, `${label} #${id}: a long row scrolls inside the card instead of widening it`)
        assert.equal(row.buttonsInRow, 0, `${label} #${id}: no Keep, Merge or Resolve button on a product row`)
      }
      const footer = await evaluate<string[]>(`[...document.querySelectorAll('[data-conflict-footer] button')].map((button) => button.textContent.trim())`)
      assert.deepEqual(footer, [pack(lang, 'resolve')], `${label}: the card's one action is the footer Resolve`)
      await shot(`card-${width}-${lang}`)
      if (lang === 'km') await khmerRoom(label, '#cards', 6)
    }
  }
  // A tap on the name opens the preview (after the double-click copy window).
  await open(375, 'lang=en', `document.querySelector('[data-conflict-row="11"]')`)
  await mouseClick('[data-conflict-row="11"] [data-conflict-name]')
  await waitFor('tap opens the preview', async () => ((await evaluate<number[]>('window.__previewed')).includes(11) ? true : null))
  await mouseClick('[data-conflict-footer] button')
  await waitFor('Resolve is wired', async () => ((await evaluate<number>('window.__resolves || 0')) === 1 ? true : null))

  // The Resolve path: the shared grid with the product adapter.
  for (const width of [375, 1280]) {
    for (const lang of ['en', 'km']) {
      const label = `grid ${width}px ${lang}`
      await open(width, `mode=grid&lang=${lang}`, `document.querySelector('[role="dialog"] table')`)
      const grid = await evaluate<{ rows: string[]; overflow: boolean; resolveVisible: boolean }>(`(() => {
        const dialog = document.querySelector('[role="dialog"]')
        const resolve = [...dialog.querySelectorAll('button')].find((button) => /^(Resolve|ដោះស្រាយ)$/.test(button.textContent.trim()))
        const box = resolve ? resolve.getBoundingClientRect() : null
        return {
          rows: [...dialog.querySelectorAll('tbody th, tbody [role="rowheader"]')].map((cell) => cell.textContent.trim()).filter(Boolean),
          overflow: document.scrollingElement.scrollWidth > innerWidth + 1,
          resolveVisible: Boolean(box && box.bottom <= innerHeight && box.right <= innerWidth && box.width > 0),
        }
      })()`)
      assert.equal(grid.overflow, false, `${label}: no page overflow`)
      assert.equal(grid.resolveVisible, true, `${label}: Resolve stays on screen`)
      await shot(`grid-${width}-${lang}`)
      if (lang === 'km') await khmerRoom(label, '[role="dialog"]', 4)
    }
  }

  // Cost editor: confirm shows before -> after, apply shows the server's after.
  await open(1280, 'mode=grid&lang=en', `document.querySelector('[role="dialog"] table')`)
  const dialogText = () => evaluate<string>(`document.body.innerText`)
  const clickButton = async (pattern: string) => {
    const found = await evaluate<boolean>(`(() => { const button = [...document.querySelectorAll('button')].reverse().find((b) => new RegExp(${JSON.stringify(pattern)}).test(b.textContent.trim()) && !b.disabled); if (!button) return false; button.setAttribute('data-click-me', '1'); return true })()`)
    assert.ok(found, `button ${pattern}`)
    await mouseClick('[data-click-me="1"]')
    await evaluate(`document.querySelector('[data-click-me="1"]')?.removeAttribute('data-click-me')`)
  }
  const text = await dialogText()
  assert.doesNotMatch(text, /Product kept|Record kept/, 'the surviving record is implicit')
  assert.match(text, /Barcode/)
  assert.match(text, /Select the details you want to keep; review the final result./)
  assert.match(text, /\$6/, 'the rule cost is the default Final')
  await clickButton('^Resolve$')
  await waitFor('confirm', async () => (/Merge .* into/.test(await dialogText()) ? true : null))
  await shot('confirm-1280-en')
  const confirm = await dialogText()
  assert.match(confirm, /\$5[\s\S]{0,40}\$6/, 'cost before -> after')
  assert.match(confirm, /3 pcs[\s\S]{0,40}5 pcs/, 'stock before -> after')
  assert.match(confirm, /8802222222222/, 'the barcode that stays on the merged record is named')
  await clickButton('^(Confirm|Resolve|Merge)$')
  await waitFor('done', async () => ((await evaluate<number>('window.__merges.length')) === 1 && /Barcodes kept on the merged records/.test(await dialogText()) ? true : null))
  const merges = await evaluate<Array<Record<string, unknown>>>('window.__merges')
  const keep = merges[0].keep as { resolve: { requestId: string } }
  assert.match(keep.resolve.requestId, /^resolve_[a-f0-9-]{36}$/)
  assert.deepEqual(merges[0], {
    keepId: 10, mergeId: 11, stock: 'merge',
    keep: { resolve: { requestId: keep.resolve.requestId, reviewedDigest: 'a'.repeat(64), steps: [{ mergeId: 11, stock: 'merge' }] } },
  }, 'the server applies the reviewed group rule; default cost is not a client override')

  // Cost viewer: the cost row is locked, nothing is sent for cost.
  await open(375, 'mode=grid&lang=en&perm=viewer', `document.querySelector('[role="dialog"] table')`)
  const locked = await evaluate<boolean>(`[...document.querySelectorAll('[role="dialog"] [title], [role="dialog"] [aria-label]')].some((el) => /cost edit permission/.test(el.getAttribute('title') || el.getAttribute('aria-label') || '')) || /cost edit permission/.test(document.querySelector('[role="dialog"]').innerHTML)`)
  assert.equal(locked, true, 'a cost viewer sees why the cost cannot change')
  await pause(10)
})
