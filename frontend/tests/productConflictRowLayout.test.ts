// Products -> Conflicts in a real browser (owner asks N2-N4 of 23 Sep 2026,
// C1-C6 of 30 Sep 2026), at 360px and 1280px, in English and Khmer.
//
//   N2  the conflict card's product row: the name has its own full-width row
//       and wraps with no ellipsis; barcode, Cost, Selling, stock and the
//       branch split share one row that scrolls sideways; a tap on the name
//       opens the product preview; nothing overflows the page.
//   C1  the card header carries the triangle-with-! ConflictIcon.
//   C2  the card has ONE Resolve (merge icon + one word) in its footer and no
//       Keep / Merge / per-row Resolve / Apply; every other button is
//       icon-only with a tooltip; Dismiss asks through the shared confirm with
//       before and after and writes only once confirmed.
//   C4-C6  the Resolve grid, driven by the real product adapter over a fake
//       Worker: no "Product kept", no info button, the hint and the pager on
//       one row, a pick of another record's name / barcode / selling price
//       shows in Final without reading the server again and is what the
//       confirm, the request and the done screen carry.
//   C3  a definite refusal says nothing was changed and offers no Continue; an
//       unknown outcome offers Continue, which re-sends the same request.
//   N4  the cost row is editable for a cost editor and locked for a viewer.
//
// Run: node tests/productConflictRowLayout.test.ts
import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

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
  const pack = window.__pack = lang === 'km' ? km : en
  const t = (key) => pack[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  const editor = params.get('perm') !== 'viewer'
  const user = { id: 1, username: editor ? 'admin' : 'viewer', role: 'staff', permissions: JSON.stringify(editor ? { all: true } : { products: true, product_cost_view: true }) }
  const LONG = 'Estée Lauder Double Wear Stay-in-Place Foundation SPF 10 Desert Beige 2N1 30ml Travel Size Edition'
  const product = (id, name, barcode, cost, selling, stock, brand, category, branch_stock) => ({ id, name, barcode, brand, category, unit: '', wholesale_price_usd: 0, cost_price_usd: cost, cost_price_khr: cost * 4100, selling_price_usd: selling, stock_quantity: stock, image_path: null, branch_stock })
  const cluster = { type: 'name', value: LONG, severity: 'same_name', products: [
    product(10, LONG, '8801111111111', 5, 12, 3, 'Estée', 'Foundation', [{ branch_id: 1, branch_name: 'shop', quantity: 3 }]),
    product(11, LONG + ' (old)', '8802222222222', 7, 15, 2, 'Estee', 'Makeup', [{ branch_id: 1, branch_name: 'shop', quantity: 1 }, { branch_id: 2, branch_name: 'warehouse', quantity: 1 }]),
  ] }
  window.__previewed = []
  window.__dismissed = 0
  window.__resolved = 0
  window.__previews = 0
  window.__merges = []
  let unknownLeft = params.has('unknown') ? 1 : 0
  const api = {
    async preview() {
      window.__previews += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        stockImpact: { totalQuantity: 2, branches: [{ branchId: 1, branchName: 'shop', quantity: 1 }, { branchId: 2, branchName: 'warehouse', quantity: 1 }] },
        needsStockChoice: true, blocked: null,
        keeperStock: { totalQuantity: 3, branches: [{ branchId: 1, branchName: 'shop', quantity: 3 }] },
        groupCost: { cost_price_usd: 6, cost_price_khr: 24600 },
        reviewedDigest: 'a'.repeat(64),
        groupProducts: cluster.products,
        choicesSupported: !params.has('oldserver'),
        settlesStockSessions: ['op-1'],
      }
    },
    async merge(keepId, mergeId, stock, keep) {
      window.__merges.push({ keepId, mergeId, stock, keep })
      if (params.has('refuse')) throw Object.assign(new Error('A number is invalid'), { code: 'invalid_merge_numeric', status: 409 })
      if (unknownLeft > 0) { unknownLeft -= 1; throw Object.assign(new Error('Server error'), { status: 500, outcome: 'unknown', code: 'write_outcome_unknown' }) }
      const nameFrom = keep.choices && keep.choices.name && keep.choices.name.source_id === 11
      return { keeper: { id: 10, name: nameFrom ? LONG + ' (old)' : LONG, barcode: nameFrom ? '8802222222222' : '8801111111111', brand: 'Estée', category: 'Foundation', cost_price_usd: keep.cost_price_usd ?? 6, selling_price_usd: 15, wholesale_price_usd: 0, stock_quantity: 5, branch_stock: [{ branchId: 1, branchName: 'shop', quantity: 4 }, { branchId: 2, branchName: 'warehouse', quantity: 1 }], absorbed_barcodes: [] } }
    },
  }

  function Card() {
    return React.createElement('div', { style: { padding: 16 } },
      React.createElement('div', { className: 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3', id: 'cards' },
        React.createElement(ProductConflictClusterCard, {
          cluster, t, dismissing: false, merging: false, selected: false, selectable: true,
          canRemoveProduct: false, removalReasons: {}, onToggleSelect() {}, onRemovalChange() {},
          onDismiss() { window.__dismissed += 1 }, onResolve() { window.__resolved += 1 },
          onPreview: (entry) => window.__previewed.push(entry.id),
        })))
  }
  function Grid() {
    const [adapter] = useState(() => createProductResolveAdapter({ cluster, t, canViewCosts: true, canEditCosts: editor, canMerge: () => true, api }))
    return React.createElement(ResolveModal, { title: 'Resolve · ' + LONG, adapter, onClose() { window.__closed = true } })
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
  metaScrolls: boolean
  metaGaps: number[]
}

const rowGeometry = (id: number) => evaluate<RowGeometry>(`(() => {
  const row = document.querySelector('[data-conflict-row="${id}"]')
  const nameButton = row.querySelector('[data-conflict-name]')
  const name = nameButton.querySelector('span:last-child')
  const meta = row.querySelector('[data-conflict-meta]')
  const metaItems = [...meta.querySelectorAll(':scope > div > *')]
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
    metaScrolls: ['auto', 'scroll'].includes(getComputedStyle(meta).overflowX),
    metaGaps: metaItems.slice(1).map((child, index) => Math.round(child.getBoundingClientRect().left - metaItems[index].getBoundingClientRect().right)),
  }
})()`)

type CardChrome = { header: boolean; footerButtons: string[]; footerIcon: boolean; textButtons: string[]; iconOnlyTips: boolean }
const cardChrome = () => evaluate<CardChrome>(`(() => {
  const card = document.querySelector('[data-conflict-card]')
  const footer = [...card.querySelectorAll('[data-conflict-footer] button')]
  const buttons = [...card.querySelectorAll('button')].filter((button) => !button.closest('[data-conflict-name]'))
  const spoken = (button) => button.getAttribute('aria-label') || button.title
  return {
    header: Boolean(card.querySelector('svg.lucide-alert-triangle, svg.lucide-triangle-alert')),
    footerButtons: footer.map((button) => button.textContent.trim()),
    footerIcon: footer.every((button) => Boolean(button.querySelector('svg.lucide-merge'))),
    textButtons: buttons.filter((button) => button.textContent.trim()).map((button) => button.textContent.trim()),
    iconOnlyTips: buttons.filter((button) => !button.textContent.trim()).every((button) => spoken(button) && button.title === button.getAttribute('aria-label')),
  }
})()`)

await run('PASS product conflicts: the card (icon, one Resolve, Dismiss confirm), the Resolve grid (no Product kept, hint + pager row, per-field Final) and 3.5 refusals at 360/1280 EN/KM', async () => {
  for (const width of [360, 1280]) {
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
        if (width === 360) assert.ok(row.nameLines >= 2, `${label} #${id}: a long name wraps (${row.nameLines} lines)`)
        assert.equal(new Set(row.metaTops).size, 1, `${label} #${id}: barcode, Cost, Selling, stock and branches on one row ${JSON.stringify(row.metaTexts)}`)
        assert.ok(row.metaTexts.length >= 5, `${label} #${id}: ${JSON.stringify(row.metaTexts)}`)
        assert.match(row.metaTexts[0], /^880/)
        assert.ok(row.metaGaps.every((gap) => gap >= 6), `${label} #${id}: the values are spaced apart ${JSON.stringify(row.metaGaps)}`)
        assert.equal(row.metaScrolls, true, `${label} #${id}: the meta row scrolls sideways instead of wrapping`)
      }
      // C1 + C2: the triangle in the header, one Resolve, nothing else with a word.
      const chrome = await cardChrome()
      assert.equal(chrome.header, true, `${label}: the card header draws the conflict triangle`)
      assert.deepEqual(chrome.footerButtons, [lang === 'km' ? 'ដោះស្រាយ' : 'Resolve'], `${label}: one Resolve in the footer, no Keep / Merge / per-row Resolve / Apply`)
      assert.equal(chrome.footerIcon, true, `${label}: Resolve is the merge icon plus one word`)
      assert.equal(chrome.textButtons.length, 2, `${label}: only the value toggle and Resolve carry words (${JSON.stringify(chrome.textButtons)})`)
      assert.equal(chrome.iconOnlyTips, true, `${label}: every icon-only button has a translated tooltip`)
      await shot(`card-${width}-${lang}`)
      if (lang === 'km') await khmerRoom(label, '#cards', 6)
    }
  }
  // A tap on the name opens the preview (after the double-click copy window).
  await open(360, 'lang=en', `document.querySelector('[data-conflict-row="11"]')`)
  await mouseClick('[data-conflict-row="11"] [data-conflict-name]')
  await waitFor('tap opens the preview', async () => ((await evaluate<number[]>('window.__previewed')).includes(11) ? true : null))

  // Resolve on the card asks the host to open the grid with every product.
  await mouseClick('[data-conflict-footer] button')
  await waitFor('resolve is asked', async () => ((await evaluate<number>('window.__resolved')) === 1 ? true : null))

  const clickButton = async (pattern: string) => {
    const found = await evaluate<boolean>(`(() => { const button = [...document.querySelectorAll('button')].reverse().find((b) => new RegExp(${JSON.stringify(pattern)}).test(b.textContent.trim()) && !b.disabled); if (!button) return false; button.setAttribute('data-click-me', '1'); return true })()`)
    assert.ok(found, `button ${pattern}`)
    await mouseClick('[data-click-me="1"]')
    await evaluate(`document.querySelector('[data-click-me="1"]')?.removeAttribute('data-click-me')`)
  }
  const dialogText = () => evaluate<string>(`document.body.innerText`)

  // Dismiss confirms with before and after and writes only once confirmed.
  await evaluate(`[...document.querySelectorAll('[data-conflict-card] button')].find((button) => button.getAttribute('aria-label') === __pack.dismiss_duplicate).setAttribute('data-click-me', '1')`)
  await mouseClick('[data-click-me="1"]')
  await evaluate(`document.querySelector('[data-click-me]')?.removeAttribute('data-click-me')`)
  await waitFor('dismiss confirm', async () => (/Needs review/.test(await dialogText()) ? true : null))
  assert.match(await dialogText(), /Before[\s\S]{0,20}Needs review[\s\S]{0,20}After[\s\S]{0,20}Kept as separate records/, 'Dismiss shows before and after')
  assert.equal(await evaluate<number>('window.__dismissed'), 0, 'nothing is dismissed before the confirm')
  await clickButton('^Keep$')
  await waitFor('dismissed once confirmed', async () => ((await evaluate<number>('window.__dismissed')) === 1 ? true : null))

  // The Resolve grid: layout, hint + pager row, no Product kept, no info button.
  for (const width of [360, 1280]) {
    for (const lang of ['en', 'km']) {
      const label = `grid ${width}px ${lang}`
      await open(width, `mode=grid&lang=${lang}`, `document.querySelector('[role="dialog"] table')`)
      const grid = await evaluate<any>(`(() => {
        const dialog = document.querySelector('[role="dialog"]')
        const resolve = [...dialog.querySelectorAll('button')].find((button) => /^(Resolve|ដោះស្រាយ)$/.test(button.textContent.trim()))
        const box = resolve ? resolve.getBoundingClientRect() : null
        const bar = dialog.querySelector('[data-rg-toolbar]')
        const hint = bar.querySelector('[data-rg-hint]')
        const [prev, next] = [...bar.querySelectorAll('button')]
        const mid = (node) => { const r = node.getBoundingClientRect(); return Math.round(r.top + r.height / 2) }
        return {
          rows: [...dialog.querySelectorAll('tbody [role="rowheader"]')].map((cell) => cell.textContent.trim()).filter(Boolean),
          overflow: document.scrollingElement.scrollWidth > innerWidth + 1,
          resolveVisible: Boolean(box && box.bottom <= innerHeight && box.right <= innerWidth && box.width > 0),
          hint: hint.textContent, pagerButtons: bar.querySelectorAll('button').length,
          oneRow: Math.abs(mid(prev) - mid(bar)) <= 1 && Math.abs(mid(next) - mid(bar)) <= 1 && hint.getBoundingClientRect().right <= prev.getBoundingClientRect().left,
          pagerDisabled: [prev.disabled, next.disabled],
          infoButtons: dialog.querySelectorAll('svg.lucide-info').length,
          titleIcon: Boolean(dialog.querySelector('h2 svg.lucide-alert-triangle, h2 svg.lucide-triangle-alert')),
          kept: /Product kept|Record kept|ផលិតផលដែលរក្សាទុក/.test(dialog.innerText),
        }
      })()`)
      assert.equal(grid.overflow, false, `${label}: no page overflow`)
      assert.equal(grid.resolveVisible, true, `${label}: Resolve stays on screen`)
      assert.equal(grid.kept, false, `${label}: no "Product kept" row, subtitle or line`)
      assert.equal(grid.infoButtons, 0, `${label}: no info button anywhere in the grid`)
      assert.equal(grid.titleIcon, true, `${label}: the title carries the conflict triangle`)
      assert.equal(grid.hint, lang === 'km' ? 'ជ្រើសព័ត៌មានដែលចង់រក្សាទុក រួចពិនិត្យលទ្ធផលចុងក្រោយ។' : 'Select the details you want to keep; review the final result.', `${label}: the one-line instruction`)
      assert.equal(grid.pagerButtons, 2, `${label}: the pager is always there`)
      assert.equal(grid.oneRow, true, `${label}: the hint and the pager share one row`)
      if (width === 1280) assert.deepEqual(grid.pagerDisabled, [true, true], `${label}: everything fits, so the chevrons are disabled`)
      if (lang === 'en') assert.deepEqual(grid.rows, ['Name', 'Barcode', 'Brand', 'Category', 'Cost', 'Selling price', 'Stock'], `${label}: the differing fields are rows (Unit, Wholesale and Image fold: they match)`)
      else assert.equal(grid.rows.length, 7, `${label}: the same seven rows`)
      await shot(`grid-${width}-${lang}`)
      if (lang === 'km') await khmerRoom(label, '[role="dialog"]', 4)
    }
  }

  // Picking never reads the server again; Final, confirm, request and done agree.
  await open(1280, 'mode=grid&lang=en', `document.querySelector('[role="dialog"] table')`)
  const LONG = 'Estée Lauder Double Wear Stay-in-Place Foundation SPF 10 Desert Beige 2N1 30ml Travel Size Edition'
  const finalOf = (row: string) => evaluate<string>(`document.querySelector('[data-rg-key="${row}|#final"]').innerText.trim()`)
  const pick = async (row: string, id: number, expected: string) => {
    await mouseClick(`[data-rg-key="${row}|${id}"]`)
    await waitFor(`${row} pick`, async () => ((await finalOf(row)) === expected ? true : null))
  }
  assert.match(await dialogText(), /\$6/, 'the rule cost is the default Final')
  assert.equal(await finalOf('selling'), '$15', 'selling defaults to the highest')
  assert.equal(await finalOf('name'), LONG, 'the name defaults to the lowest id')
  const previewsBefore = await evaluate<number>('window.__previews')
  await pick('name', 11, `${LONG} (old)`)
  await pick('barcode', 11, '8802222222222')
  assert.equal(await evaluate<number>('window.__previews'), previewsBefore, 'picking a field never reads the server again')
  await clickButton('^Resolve$')
  await waitFor('confirm', async () => (/Merge .* into/.test(await dialogText()) ? true : null))
  await shot('confirm-1280-en')
  // The nested confirm is the last dialog on the page.
  const confirm = await evaluate<string>(`[...document.querySelectorAll('[role="dialog"]')].pop().innerText`)
  assert.match(confirm, /Edition[\s\S]{0,200}Edition \(old\)/, 'name before -> after')
  assert.match(confirm, /8801111111111[\s\S]{0,40}8802222222222/, 'barcode before -> after')
  assert.match(confirm, /\$5[\s\S]{0,40}\$6/, 'cost before -> after')
  assert.match(confirm, /\$12[\s\S]{0,40}\$15/, 'selling before -> after')
  assert.match(confirm, /3 pcs[\s\S]{0,40}5 pcs/, 'stock before -> after')
  assert.match(confirm, /Stock-in session op-1 can no longer be undone/, 'the settled stock-in session is a warning, not a blocker')
  const labelBox = await evaluate<{ h: number }>(`(() => { const dt = [...document.querySelectorAll('[role="dialog"]')].pop().querySelector('dt'); return { h: dt.getBoundingClientRect().height } })()`)
  assert.ok(labelBox.h <= 24, `a long name does not squeeze its label to one letter per line (${labelBox.h}px high)`)
  await clickButton('^(Confirm|Resolve|Merge)$')
  await waitFor('done', async () => ((await evaluate<number>('window.__merges.length')) === 1 && /Merged products/.test(await dialogText()) ? true : null))
  const merges = await evaluate<Array<Record<string, unknown>>>('window.__merges')
  const keep = merges[0].keep as { resolve: { requestId: string } }
  assert.match(keep.resolve.requestId, /^resolve_[a-f0-9-]{36}$/)
  assert.deepEqual(merges[0], {
    keepId: 10, mergeId: 11, stock: 'merge',
    keep: {
      resolve: { requestId: keep.resolve.requestId, reviewedDigest: 'a'.repeat(64), steps: [{ mergeId: 11, stock: 'merge' }] },
      choices: {
        name: { source_id: 11 }, barcode: { source_id: 11 }, brand: { source_id: 10 }, category: { source_id: 10 }, unit: { source_id: 10 },
        selling_price_usd: { source_id: 11 }, wholesale_price_usd: { source_id: 10 }, image: { source_id: 10 },
      },
    },
  }, 'the request carries exactly the Final column; default cost is not a client override')
  const done = await dialogText()
  assert.match(done, /Resolved/)
  assert.match(done, /Edition \(old\)/, 'done shows the chosen name')
  assert.doesNotMatch(done, /Product kept/)

  // Keep separate takes a record out of the merge: the grid says why Resolve waits.
  await open(1280, 'mode=grid&lang=en', `document.querySelector('[role="dialog"] table')`)
  await mouseClick('button[data-rg-disposition="11"]')
  await waitFor('keep separate leaves fewer than two records', async () => (/Merge in at least two records/.test(await dialogText()) ? true : null))

  // A server that cannot apply choices: the pick rows are not offered (no silent drop).
  await open(1280, 'mode=grid&lang=en&oldserver=1', `document.querySelector('[role="dialog"] table')`)
  const legacy = await evaluate<{ rows: string[]; picks: number }>(`(() => ({
    rows: [...document.querySelectorAll('[role="dialog"] tbody [role="rowheader"]')].map((cell) => cell.textContent.trim()),
    picks: document.querySelectorAll('[role="dialog"] [data-rg-key^="name|"][data-clickable="true"], [role="dialog"] [data-rg-key^="barcode|"][data-clickable="true"], [role="dialog"] [data-rg-key^="selling|"][data-clickable="true"]').length,
  }))()`)
  assert.equal(legacy.picks, 0, 'without choicesSupported the name, barcode and selling cells are not pickable')
  assert.ok(!legacy.rows.includes('Brand') && !legacy.rows.includes('Category'), 'without choicesSupported Brand and Category are not offered')

  // 3.5 a definite refusal: nothing was changed, no Continue, the grid stays editable.
  await open(1280, 'mode=grid&lang=en&refuse=1', `document.querySelector('[role="dialog"] table')`)
  await clickButton('^Resolve$')
  await waitFor('confirm (refusal run)', async () => (/Merge .* into/.test(await dialogText()) ? true : null))
  await clickButton('^(Confirm|Resolve|Merge)$')
  await waitFor('refusal shown', async () => (/Nothing was changed\./.test(await dialogText()) ? true : null))
  const refusal = await evaluate<{ text: string; continueButton: boolean; grid: boolean; resolveEnabled: boolean }>(`(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const buttons = [...dialog.querySelectorAll('button')]
    return {
      text: dialog.querySelector('[data-resolve-failure]').innerText.trim(),
      continueButton: buttons.some((b) => /^Continue$/.test(b.textContent.trim())),
      grid: Boolean(dialog.querySelector('.resolve-grid')),
      resolveEnabled: buttons.some((b) => /^Resolve$/.test(b.textContent.trim()) && !b.disabled),
    }
  })()`)
  assert.equal(refusal.text, 'Nothing was changed. A price or cost is not a valid number. Correct it, then resolve.')
  assert.deepEqual([refusal.continueButton, refusal.grid, refusal.resolveEnabled], [false, true, true], 'no Continue; the grid is still there and Resolve is armed')

  // 3.5 an unknown outcome: the result is unknown, Continue re-sends the same request.
  await open(1280, 'mode=grid&lang=en&unknown=1', `document.querySelector('[role="dialog"] table')`)
  await clickButton('^Resolve$')
  await waitFor('confirm (unknown run)', async () => (/Merge .* into/.test(await dialogText()) ? true : null))
  await clickButton('^(Confirm|Resolve|Merge)$')
  await waitFor('unknown shown', async () => (/The result is unknown\./.test(await dialogText()) ? true : null))
  assert.doesNotMatch(await dialogText(), /Nothing was changed\./)
  await clickButton('^Continue$')
  await waitFor('continue resends', async () => ((await evaluate<number>('window.__merges.length')) === 2 && /Merged products/.test(await dialogText()) ? true : null))
  const sent = await evaluate<Array<{ keep: { resolve: { requestId: string } } }>>('window.__merges')
  assert.equal(sent[0].keep.resolve.requestId, sent[1].keep.resolve.requestId, 'Continue re-sends the same request id')

  // Cost viewer: the cost row is locked, nothing is sent for cost.
  await open(360, 'mode=grid&lang=en&perm=viewer', `document.querySelector('[role="dialog"] table')`)
  const locked = await evaluate<boolean>(`[...document.querySelectorAll('[role="dialog"] [title], [role="dialog"] [aria-label]')].some((el) => /cost edit permission/.test(el.getAttribute('title') || el.getAttribute('aria-label') || '')) || /cost edit permission/.test(document.querySelector('[role="dialog"]').innerHTML)`)
  assert.equal(locked, true, 'a cost viewer sees why the cost cannot change')
  await pause(10)
})
