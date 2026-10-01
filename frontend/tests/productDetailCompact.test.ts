// UI-DETAIL 2.1-2.7 (owner, 30 Sep 2026): the product detail sheet is compact.
// Brand then category on one scrolling line, Stock and its status on one row,
// the report mounted once in one links row, a description that cannot scroll
// its first letters away, one footer row with one labelled button, and
// "Records" instead of "Field history".
//
// Every judge also runs against an excerpt of the sheet as it shipped (57cf2db5a),
// so a judge that stopped discriminating fails this file instead of passing it.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sheet = read('components/products/surfaces/ProductDetailModal.tsx')
const report = read('components/products/surfaces/ProductDetailReport.tsx')
const pane = read('components/inventory/ProductDetailModal.tsx')
const rail = read('components/shared/ProductNameRail.tsx')
const css = read('styles/main.css')
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>

let failures = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${name}`)
    console.error(String((error as Error).message))
  }
}

// ---- judges --------------------------------------------------------------

// The header text between the title rail and the close button.
function headerMeta(source: string): string {
  const start = source.indexOf('<ProductNameRail')
  const end = source.indexOf("aria-label={T('close'", start)
  assert.ok(start > 0 && end > start, 'header not found')
  return source.slice(start, end)
}

function sheetMetaProblems(source: string): string[] {
  const meta = headerMeta(source)
  const problems: string[] = []
  if (!meta.includes('data-detail-meta-row="brand-category"') || !meta.includes('scroll-x-clean')) problems.push('no single scroll-x-clean meta row')
  if (/flex-wrap/.test(meta)) problems.push('the meta row wraps')
  if (meta.includes('max-w-[1')) problems.push('per-item width caps')
  const brand = meta.indexOf('focus={{ brand: p.brand }}')
  const category = meta.indexOf('focus={{ category: p.category }}')
  if (!(brand > 0 && category > brand)) problems.push('brand does not lead category')
  if (meta.includes('p.sku')) problems.push('SKU is still in the header')
  return problems
}

const hasStatusRow = (source: string): boolean => source.includes("Row label={T('status'")

function stockRow(source: string): string {
  const start = source.indexOf("<Row label={T('label_stock'")
  assert.ok(start > 0, 'Stock row not found')
  return source.slice(start, source.indexOf('</Row>', start))
}
const badgeInStockRow = (source: string): boolean => ['badge-red', 'badge-yellow', 'badge-green'].every((badge) => stockRow(source).includes(badge))

const reportMounts = (source: string): number => source.split('<ProductDetailReport ').length - 1

// The element that renders the description value.
function descriptionElement(source: string): string {
  const at = source.indexOf('{p.description}\n')
  assert.ok(at > 0, 'description value not found')
  const open = Math.max(source.lastIndexOf('<button', at), source.lastIndexOf('<span', at))
  return source.slice(open, at)
}
const descriptionScrolls = (source: string): boolean => descriptionElement(source).includes('detail-scroll-text')

// The footer: the row that holds the given icon, and how many of its buttons show a word.
function footer(source: string, marker: string): { row: string; labelled: number; buttons: number } {
  const at = source.indexOf(marker)
  assert.ok(at > 0, `marker not found: ${marker}`)
  const open = source.lastIndexOf('<div className="', source.lastIndexOf('<button', at))
  const row = source.slice(open + '<div className="'.length, source.indexOf('"', open + '<div className="'.length))
  const close = source.indexOf('\n        </div>', at)
  const body = source.slice(open, close)
  const buttons = body.split('<button').slice(1)
  return { row, buttons: buttons.length, labelled: buttons.filter((button) => button.split('</button>')[0].includes('<span')).length }
}

function cssBlock(source: string, selector: string): string {
  const match = new RegExp(`\\n\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`).exec(source)
  assert.ok(match, `no CSS rule for ${selector}`)
  const open = source.indexOf('{', match.index)
  return source.slice(open + 1, source.indexOf('}', open))
}

function paneMetaProblems(source: string): string[] {
  const meta = headerMeta(source)
  const problems: string[] = []
  if (!meta.includes('scroll-x-clean')) problems.push('not one scroll-x-clean line')
  if (/flex-wrap/.test(meta)) problems.push('the meta line wraps')
  if (meta.includes('/{p.unit}')) problems.push('the unit is repeated in the header')
  const order = ['p.brand ?', 'p.category ?', 'p.barcode ?', 'p.sku ?'].map((token) => source.indexOf(token, source.indexOf('headerMeta')))
  if (!order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]))) problems.push('not brand, category, barcode, SKU')
  return problems
}

// ---- shipped excerpts (57cf2db5a) -----------------------------------------

const SHIPPED_SHEET = `
            <div className="min-w-0">
              <div className="min-w-0 font-bold text-gray-900 dark:text-white" {...copy(productName)}>
                <EntityLink page="products"><ProductNameRail name={productName} /></EntityLink>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                {p.sku ? <span className="detail-scroll-text max-w-[100px] font-mono" title={p.sku}>{p.sku}</span> : null}
                {p.category ? <span className="detail-scroll-text max-w-[110px]" title={p.category}>{p.sku ? '· ' : ''}<EntityLink page="products" focus={{ category: p.category }}>{p.category}</EntityLink></span> : null}
                {p.brand ? <span className="detail-scroll-text max-w-[110px]" {...copy(p.brand)} title={p.brand}>&middot; <EntityLink focus={{ brand: p.brand }}>{p.brand}</EntityLink></span> : null}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={T('close', 'Close')} className={toolbarIconButtonClassName}>
                  <div className="hidden border-t border-gray-100 pt-2 dark:border-gray-700 sm:block">
                        <ProductDetailReport productId={Number(p.id)} barcode={p.barcode} t={t || (() => undefined)} fmtUSD={fmtUSD} />
                  </div>
                    <button
                      type="button"
                      onClick={() => setDescriptionDetailOpen(true)}
                      className="detail-scroll-text min-w-0 flex-1 rounded text-left text-sm text-gray-800 dark:text-gray-200"
                      title={T('view_full_description', 'View full description')}
                    >
                      {p.description}
                    </button>
                <Row label={T('label_stock', 'Stock')}>
                    <strong className="text-gray-900 dark:text-white">{stockQuantity}</strong>
                </Row>
                <Row label={T('status', 'Status')}>
                  {stockQuantity <= outOfStockThreshold ? (
                    <span className="badge-red">{T('out_of_stock', 'Out of stock')}</span>
                  ) : stockQuantity <= lowStockThreshold ? (
                    <span className="badge-yellow">{T('low_stock', 'Low stock')}</span>
                  ) : (
                    <span className="badge-green">{T('in_stock', 'In stock')}</span>
                  )}
                </Row>
                  <Suspense fallback={<p className="py-2 text-center text-xs text-gray-400">...</p>}>
                    <ProductDetailReport productId={Number(p.id)} barcode={p.barcode} t={t || (() => undefined)} fmtUSD={fmtUSD} />
                  </Suspense>
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
            {onAddVariant ? (
              <button
                type="button"
                className={\`btn-secondary \${TOOLBAR_BUTTON_BASE} min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] truncate sm:basis-0\`}
                onClick={onAddVariant}
              >
                <PlusCircle className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{T('add_variant', 'Add variant')}</span>
              </button>
            ) : null}
            {onAdjustStock ? (
              <button
                type="button"
                className={\`btn-secondary \${TOOLBAR_BUTTON_BASE} min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] truncate sm:basis-0\`}
                onClick={onAdjustStock}
              >
                <SlidersHorizontal className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{T('adjust_stock', 'Adjust stock')}</span>
              </button>
            ) : null}
            <button
              type="button"
              className={\`btn-primary \${TOOLBAR_BUTTON_BASE} min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] truncate sm:basis-0\`}
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{T('edit', 'Edit')}</span>
            </button>
        </div>
`

const SHIPPED_CSS = `
  .detail-scroll-text {
    display: block;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    touch-action: pan-x;
  }
`

const SHIPPED_PANE = `
            <div className="min-w-0 font-bold text-gray-900 dark:text-white" {...copy(p.name)}><ProductNameRail name={String(p.name ?? '')} /></div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {p.sku ? <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-400 dark:bg-gray-700">{p.sku}</span> : null}
              {p.category ? <span className="text-xs text-blue-600 dark:text-blue-400">{p.category}</span> : null}
              {p.unit ? <span className="text-xs text-gray-400">/{p.unit}</span> : null}
              {p.brand ? <span className="text-xs text-gray-400" {...copy(p.brand)}>&middot; {p.brand}</span> : null}
              {p.barcode ? <span className="shrink-0 whitespace-nowrap font-mono text-xs text-gray-400" {...copy(p.barcode)}>&middot; {p.barcode}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className={toolbarIconButtonClassName} aria-label={T('close', 'Close')}><X className="h-4 w-4" /></button>
        <div className="grid grid-cols-2 flex-shrink-0 gap-1.5 border-t border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-4 sm:gap-2">
          {onAdjust ? (
            <button
              type="button"
              className={\`btn-primary \${TOOLBAR_BUTTON_BASE} w-full truncate px-1 leading-tight\`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden truncate sm:inline">{T('adjust_stock', 'Adjust Stock')}</span>
            </button>
          ) : null}
          {onTransfer ? (
            <button
              type="button"
              className={\`btn-secondary \${TOOLBAR_BUTTON_BASE} w-full truncate px-1 leading-tight\`}
            >
              <ArrowRightLeft className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="hidden truncate sm:inline">{T('transfer', 'Transfer')}</span>
            </button>
          ) : null}
        </div>
`

// ---- the sheet -----------------------------------------------------------

runTest('header: one scrolling meta row, brand before category, no width caps, no SKU', () => {
  assert.deepEqual(sheetMetaProblems(sheet), [])
  assert.ok(sheetMetaProblems(SHIPPED_SHEET).length >= 4, 'control: the shipped header fails the judge')
  assert.match(sheet, /<ProductNameRail name=\{productName\} className="\[text-wrap:balance\]" \/>/, 'balanced wrap on the title in this header')
  assert.doesNotMatch(rail, /text-wrap/, 'the shared rail itself is unchanged')
  assert.match(sheet, /sm:max-w-3xl/, 'two columns of about 360px on desktop, no empty band')
})

runTest('Stock and its status badge share one row; there is no Status row', () => {
  assert.equal(hasStatusRow(sheet), false)
  assert.equal(badgeInStockRow(sheet), true)
  assert.equal(hasStatusRow(SHIPPED_SHEET), true, 'control')
  assert.equal(badgeInStockRow(SHIPPED_SHEET), false, 'control')
})

runTest('the report is mounted exactly once', () => {
  assert.equal(reportMounts(sheet), 1)
  assert.equal(reportMounts(SHIPPED_SHEET), 2, 'control: the shipped sheet mounted it twice')
})

runTest('the description value is one truncated line, not a sideways scroller', () => {
  assert.equal(descriptionScrolls(sheet), false)
  assert.match(descriptionElement(sheet), /\btruncate\b/)
  assert.equal(descriptionScrolls(SHIPPED_SHEET), true, 'control')
})

runTest('footer: one row, exactly one labelled button (Edit)', () => {
  const now = footer(sheet, '<Pencil className=')
  assert.doesNotMatch(now.row, /flex-wrap|grid-cols/)
  assert.equal(now.buttons, 3)
  assert.equal(now.labelled, 1)
  assert.match(sheet, /<span className="truncate">\{T\('edit', 'Edit'\)\}<\/span>/)
  const shipped = footer(SHIPPED_SHEET, '<Pencil className=')
  assert.ok(/flex-wrap/.test(shipped.row) && shipped.labelled === 3, 'control: the shipped footer wrapped three labelled buttons')
})

runTest('links row: Received dates and Records lead the report chips in one wrapping row', () => {
  assert.match(sheet, /leadingPills=\{leadingPills\}/)
  assert.ok(sheet.indexOf("T('batches', 'Received dates')") < sheet.indexOf('data-product-field-history'), 'Received dates, then Records')
  assert.match(sheet, /canReadFieldHistory && productId > 0/, 'Records keeps its audit_log full gate')
  const root = report.indexOf('<div className="flex flex-wrap gap-1.5">\n      {leadingPills}')
  assert.ok(root > 0 && root < report.indexOf('<Pill section="movements"'), 'the report renders the leading chips first inside its own wrapping root')
  assert.match(report, /basis-full[^"]*">\{loadError\}/, 'a load error takes its own line')
  assert.doesNotMatch(report, /ChevronRight/, 'chips carry no chevron')
  // Content-sized chips, bounded by the row; a label longer than the row scrolls inside its chip.
  const chip = "const LINK_CHIP = 'inline-flex h-8 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs transition-colors'"
  assert.ok(report.includes(chip) && sheet.includes(chip), 'one chip shape on both sides')
  assert.match(report, /<span className="detail-scroll-text min-w-0">\{label\}<\/span>/)
})

// ---- CSS and packs -------------------------------------------------------

runTest('.detail-scroll-text no longer pins touch-action (a vertical swipe scrolls the sheet)', () => {
  // A declaration, not the word: the rule's own comment names it.
  const declares = /(?:^|[;{\s])touch-action\s*:/
  assert.doesNotMatch(cssBlock(css, '.detail-scroll-text'), declares)
  assert.match(cssBlock(css, '.detail-scroll-text'), /overscroll-behavior-inline:\s*contain/, 'the back-swipe guard stays')
  assert.match(cssBlock(css, '.compact-action-row'), /touch-action:\s*pan-x/, 'positive control: the toolbar class still pins pan-x')
  assert.match(cssBlock(SHIPPED_CSS, '.detail-scroll-text'), declares, 'control')
})

runTest('field_history reads Records in both packs, the same words Sales uses', () => {
  assert.equal(en.field_history, 'Records')
  assert.equal(km.field_history, 'កំណត់ត្រា')
  assert.equal(km.field_history, km.sale_records)
  assert.notEqual('Field history', en.field_history, 'control')
})

// ---- Branches > Products pane parity ------------------------------------

runTest('Branches pane header: brand · category · barcode, then SKU, on one scrolling line; no /unit', () => {
  assert.deepEqual(paneMetaProblems(pane), [])
  assert.ok(paneMetaProblems(SHIPPED_PANE).length >= 3, 'control')
  assert.match(pane, /<span className="shrink-0 whitespace-nowrap font-mono" \{\.\.\.copy\(p\.barcode\)\}>\{p\.barcode\}<\/span>/, 'the barcode keeps its mono/nowrap/copy contract')
})

runTest('Branches pane footer: one row, Adjust stock labelled, Transfer and Received dates icon-only', () => {
  const now = footer(pane, '<SlidersHorizontal className=')
  assert.doesNotMatch(now.row, /grid-cols|flex-wrap/)
  assert.equal(now.buttons, 3)
  assert.equal(now.labelled, 1)
  assert.match(pane, /<span className="truncate">\{T\('adjust_stock', 'Adjust Stock'\)\}<\/span>/)
  assert.doesNotMatch(pane, /hidden truncate sm:inline/, 'no label hidden on phones')
  const shipped = footer(SHIPPED_PANE, '<SlidersHorizontal className=')
  assert.match(shipped.row, /grid-cols-2/, 'control')
})

if (failures) {
  console.error(`productDetailCompact: ${failures} failing case(s)`)
  process.exit(1)
}
