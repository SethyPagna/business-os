// Lane 6.0.873 -- the Excel-style Products table in a real browser at 1280px
// (the first width that shows the table) in English and Khmer.
//
// The fixture mounts the REAL ProductsListSurface, the real column config and
// the real cell components. The product row itself lives inside the 5900-line
// Products.tsx and cannot be mounted alone, so the fixture's row mirrors it
// using the same exported pinning constants (PINNED_CELL / PINNED_BG /
// pinnedLeft) and the same cell components -- it proves the layout contract
// (no page-wide overflow, an inner scroller, opaque pinned columns that really
// stay put, single-line headers), not Products.tsx's own JSX.
//
// Run: node tests/productsTableBrowser.test.ts   (machine-load sensitive: the
// first page load pays Vite's cold transform and can time out under load)
import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import ProductsListSurface, { PINNED_BG, PINNED_CELL, ROW_TEXT_GUTTER, pinnedLeft } from '/src/components/products/surfaces/ProductsListSurface.tsx'
  import { ProductPriceCell, ProductStockCell, ProductSupplierCell } from '/src/components/products/surfaces/ProductRowParts.tsx'
  import { buildStockCellModel, defaultProductColumns, productColumnsFor, visibleProductColumns } from '/src/components/products/config/productTableColumns.ts'
  import ColumnChooser from '/src/components/shared/ColumnChooser.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const optional = (params.get('extra') || '').split(',').filter(Boolean)
  const canViewCosts = params.get('cost') !== 'no'
  const pack = language === 'km' ? km : en
  const t = (key) => pack[key] || key
  const tr = (key, fallback) => pack[key] || fallback || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  const defs = productColumnsFor({ canViewCosts })
  const defaults = defaultProductColumns(defs)
  const columns = visibleProductColumns(defs, (key) => defaults.has(key) || optional.includes(key))
  const products = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1, name: (language === 'km' ? 'ទឹកអប់ ' : 'Rose water toner ') + (i % 3), barcode: '88' + String(1000000000 + i), category: language === 'km' ? 'ថែរក្សាស្បែក' : 'Skin care',
    brand: language === 'km' ? 'ម៉ាកល្បី' : 'Laneige', unit: 'pcs', supplier: language === 'km' ? 'អ្នកផ្គត់ផ្គង់ ក' : 'Beauty Wholesale Co', selling_price_usd: 12.5 + i, selling_price_khr: 51250 + i * 100, wholesale_price_usd: 9 + i,
    stock_quantity: 12 + i, sku: 'SKU-' + i, branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: 12 + i, branch_active: 1 }],
  }))
  const section = { id: 'S', label: 'Skin', ids: products.map((p) => p.id), items: products, groups: products.map((p) => ({ key: 'g' + p.id, name: p.name, anchorId: p.id, ids: [p.id], items: [p], rows: [p], hasMultipleItems: false })) }
  const fmtUSD = (v) => '$' + Number(v).toFixed(2)
  const fmtKHR = (v) => Number(v).toLocaleString('en-US') + '៛'
  const cell = (p, column) => {
    switch (column.key) {
      case 'selling': return <ProductPriceCell usd={p.selling_price_usd} khr={p.selling_price_khr} tone="selling" lockTip={params.get('lock') === 'yes' ? t('product_price_read_only') : undefined} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
      case 'wholesale': return <ProductPriceCell usd={p.wholesale_price_usd} khr={0} tone="wholesale" fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
      case 'supplier': return <ProductSupplierCell supplier={p.supplier} lockTip={t('product_supplier_read_only')} tr={tr} />
      case 'stock': return <ProductStockCell qty={p.stock_quantity} qtyClassName="text-green-600" unitChip={null} totalLabel={t('total')} inactiveLabel={t('inactive')} model={buildStockCellModel(p, { branchFilter: 'all', selectedBranchName: '', soleBranchName: 'LC Store' })} />
      case 'cost': return <span>$5.00</span>
      case 'margin': return <span>40%</span>
      default: return <span className="detail-scroll-text">{String(p[column.key] ?? '—')}</span>
    }
  }
  const renderRow = (p) => (
    <tr key={p.id} className="table-row" data-row="">
      <td className={'px-0 py-2 ' + PINNED_CELL + ' ' + PINNED_BG} style={{ left: pinnedLeft('select', false) }} />
      <td className={'px-2 py-2 ' + PINNED_CELL + ' ' + PINNED_BG} style={{ left: pinnedLeft('image', false) }}><div className="h-12 w-12 rounded-lg bg-slate-100" /></td>
      <td className={ROW_TEXT_GUTTER + ' py-2 ' + PINNED_CELL + ' ' + PINNED_BG} style={{ left: pinnedLeft('name', false) }}>{p.name}</td>
      {columns.map((column) => <td key={column.key} className={'overflow-hidden px-3 py-2 ' + (column.align === 'right' ? 'text-right' : 'text-left')}>{cell(p, column)}</td>)}
    </tr>
  )
  const chooserColumns = [{ key: 'image', label: 'Image', required: true }, { key: 'name', label: 'Name', required: true }, ...defs.map((d) => ({ key: d.key, label: t(d.label) }))]
  const App = () => (
    <div id="page" style={{ display: 'flex', width: '100%' }}>
      <div style={{ width: '15rem', flex: '0 0 15rem', background: '#222' }} />
      <div style={{ minWidth: 0, flex: 1 }} className="page-scroll p-3">
        <ProductsListSurface
          allVisibleProducts={products} collapsedProductGroups={new Set()} collapsedProductSections={new Set()} getGroupSummaryParts={() => []}
          initialDesktopRevealReady isSelectionScopeFullySelected={() => false} isSelectionScopePartiallySelected={() => false} allVisibleIds={[]}
          columns={columns} columnChooser={<ColumnChooser columns={chooserColumns} isVisible={() => true} toggle={() => {}} reset={() => {}} label={t('columns')} resetLabel={t('reset')} />}
          loading={false} productSections={[section]} refreshingProducts={false} renderDesktopProductRow={renderRow} renderMobileProductCard={() => null}
          selectionModeActive={false} t={t} toggleProductGroup={() => {}} toggleProductSection={() => {}} toggleSelectionScope={() => {}} tr={tr} visibleProducts={products}
        />
      </div>
    </div>
  )
  const value = { ...FALLBACK_APP_CONTEXT, t, language }
  createRoot(document.getElementById('root')).render(React.createElement(AppContext.Provider, { value }, React.createElement(App)))
  window.__ready = true
`

const browser = await launchResolveFixture('products-table-browser', fixture)
await browser.run('PASS Products Excel-style table: no page overflow, inner scroll, opaque pinned columns at 1280 EN/KM', async () => {
  for (const language of ['en', 'km']) {
    for (const extra of ['', 'sku,lots,updated']) {
      const query = `lang=${language}&extra=${extra}&lock=yes`
      await browser.open(1280, query, `window.__ready && document.querySelectorAll('tbody tr[data-row]').length === 12`, 800)
      const report = await browser.evaluate<{
        pageOverflow: boolean; innerScrolls: boolean; headers: number; multiLine: string[]; pinnedAlpha: number[]; pinnedMoved: boolean[]; locks: number; costHeaders: number
      }>(`(() => {
        const scroller = document.querySelector('table').parentElement
        const headers = [...document.querySelectorAll('thead th[data-column]')]
        const multiLine = headers.filter((th) => th.scrollHeight > th.clientHeight + 1 || th.getBoundingClientRect().height > 60).map((th) => th.dataset.column)
        const pinned = (selector) => [...document.querySelectorAll(selector)].slice(0, 3)
        const alpha = (el) => { const m = getComputedStyle(el).backgroundColor.match(/[\\d.]+/g) || []; return m.length > 3 ? Number(m[3]) : 1 }
        const firstRow = document.querySelector('tbody tr[data-row]')
        const nameCell = () => firstRow.children[2]
        const before = nameCell().getBoundingClientRect().left
        scroller.scrollLeft = 400
        const after = nameCell().getBoundingClientRect().left
        const imageAfter = firstRow.children[1].getBoundingClientRect().left
        const result = {
          pageOverflow: document.scrollingElement.scrollWidth > innerWidth + 1,
          innerScrolls: scroller.scrollWidth > scroller.clientWidth + 1,
          headers: headers.length,
          multiLine,
          pinnedAlpha: [firstRow.children[1], firstRow.children[2], document.querySelector('thead th')].map(alpha),
          pinnedMoved: [Math.abs(after - before) > 1, imageAfter < 0],
          locks: document.querySelectorAll('[role="img"][aria-label]').length,
          costHeaders: document.querySelectorAll('thead th[data-column="cost"]').length,
        }
        scroller.scrollLeft = 0
        return result
      })()`)
      assert.equal(report.pageOverflow, false, `${language}/${extra || 'default'}: the page itself must not scroll sideways`)
      assert.equal(report.innerScrolls, true, `${language}/${extra || 'default'}: the table scrolls inside its own container`)
      assert.deepEqual(report.multiLine, [], `${language}/${extra || 'default'}: headers stay on one line`)
      assert.ok(report.pinnedAlpha.slice(0, 2).every((value) => value === 1), `${language}: pinned body cells are opaque (${report.pinnedAlpha})`)
      assert.deepEqual(report.pinnedMoved, [false, false], `${language}: Image and Name stay at the left edge while data scrolls under them`)
      assert.ok(report.locks >= 12, `${language}: locked cells carry their lock mark`)
      assert.equal(report.costHeaders, 1)
      await browser.khmerRoom(`${language}/${extra || 'default'} table`, 'table', language === 'km' ? 10 : 0)
    }
  }
  await browser.open(1280, 'lang=en&cost=no', `window.__ready && document.querySelectorAll('tbody tr[data-row]').length === 12`, 800)
  assert.equal(await browser.evaluate(`document.querySelectorAll('thead th[data-column="cost"], thead th[data-column="margin"]').length`), 0, 'a user without cost access never gets those headers in a real browser either')
})
