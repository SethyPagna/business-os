import { Fragment } from 'react'
import type { ReactNode } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'

// ---------------------------------------------------------------------------
// Desktop table geometry: ONE left rail
// ---------------------------------------------------------------------------
// Reported three times: on a large screen the category band's label, the
// group title and a product's own name each started at a different x, and
// all of them sat far right of the band's left edge.
//
// The two earlier attempts both re-declared the column widths -- once as
// padding, once as a CSS grid -- on the colSpan rows. That cannot work,
// and measuring it in a browser against the real stylesheet is what
// finally showed why:
//
//   requested   <col> 2rem / 3.5rem
//   rendered    51px / 89px
//
// `table-fixed` distributes whatever width the declared columns do not
// claim (these percentages sum to 90%) proportionally across every column,
// so the leading columns are always WIDER than they ask for, by an amount
// that changes with the viewport. Any hand-written copy of those widths is
// therefore correct at exactly one window size and wrong at every other --
// which is precisely the "still not aligned" report, twice.
//
// So the full-width rows no longer re-declare anything. They use REAL
// cells in the SAME columns as a product row (checkbox, image, then one
// colSpan for the rest), and the browser's own column geometry does the
// aligning. It cannot drift, at any width, because there is nothing left
// to keep in sync.
//
// What is still tunable is how much space those leading columns ASK for.
// The image column must fit the actual thumbnail plus its cell's `px-2`
// gutter: after the desktop thumbnails were enlarged to h-14/w-14 (56px, Aug
// 29) the old 3.5rem (56px) column was NARROWER than 56px image + 16px cell
// padding = 72px, so in `table-fixed` the thumbnail overflowed its 56px
// column and spilled into the name rail on large screens. 4.5rem (72px) is
// the exact fit -- the 56px image plus its 16px px-2 gutter, no excess to
// read as indentation; the checkbox column stays tight at 2rem for its 1rem
// box.
const SELECT_COL_WIDTH = '2rem'
const IMAGE_COL_WIDTH = '5rem'
/** Padding between the image column and the start of any title text. */
export const ROW_TEXT_GUTTER = 'px-2'
// A grouped child row does NOT get a text indent: it aligns exactly with
// its group's title. The child's empty image column (the group title shows
// a thumbnail, the children do not) is what sets the group apart, so an
// extra indent on the name would double the offset. Kept as a note rather
// than a constant because there is deliberately nothing to apply.
/**
 * The columns a full-width row spans past the image column. Kept next to
 * the <colgroup> below because the two have to agree: 2 leading cells plus
 * this must equal the table's column count.
 */
const FULL_WIDTH_ROW_SPAN = 6
/** The category band spans one column further LEFT than the group header:
 *  its label sits on the image column (above the thumbnails), so it covers
 *  the image column plus the 6 trailing ones. */
const CATEGORY_BAND_SPAN = 7

type Translate = (key: string) => string | undefined
type TranslateWithFallback = (key: string, fallback: string, khmerFallback?: string) => string
type ProductId = string | number

type ProductLike = {
  id?: ProductId
  [key: string]: unknown
}

type ProductGroup = {
  key: string
  name: string
  anchorId?: ProductId
  ids: ProductId[]
  items: ProductLike[]
  // Display rows: branch-only duplicates already collapsed into one row
  // each (see mergeSameDetailRows in utils/productGrouping.ts). Render
  // these, not `items` -- `items` stays around for bulk-selection scope.
  rows: ProductLike[]
  hasMultipleItems: boolean
  leadProduct?: ProductLike
}

type ProductSection = {
  id: string
  label: string
  ids: ProductId[]
  items: ProductLike[]
  groups: ProductGroup[]
}

type ProductRowRenderOptions = {
  indented: boolean
}

type ProductsListSurfaceProps = {
  allVisibleProducts: ProductLike[]
  collapsedProductGroups: Set<string>
  collapsedProductSections: Set<string>
  getGroupSummaryParts: (group: ProductGroup, options?: { includeCount?: boolean }) => string[]
  initialDesktopRevealReady: boolean
  isSelectionScopeFullySelected: (ids: ProductId[]) => boolean
  isSelectionScopePartiallySelected: (ids: ProductId[]) => boolean
  // Every selectable product id in the current view -- backs the desktop
  // header select-all checkbox (11.2 alignment: in select mode the
  // column-header checkbox IS select-all, like the other five list pages).
  allVisibleIds: ProductId[]
  loading: boolean
  productSections: ProductSection[]
  productTotal?: number
  productTotalLabel?: string
  refreshingProducts: boolean
  renderDesktopProductRow: (product: ProductLike, options: ProductRowRenderOptions) => ReactNode
  // 11.3: press-and-hold on a group TITLE row to enter select mode with
  // the whole group selected. Products.tsx supplies the long-press handlers
  // keyed by the group's anchor id; spread onto the group header <tr>.
  // Only meaningful out of select mode (once selecting, the row's checkbox
  // is the affordance).
  bindGroupHold?: (group: ProductGroup) => Record<string, unknown>
  renderGroupActions?: (group: ProductGroup) => ReactNode
  renderGroupThumbnail?: (group: ProductGroup) => ReactNode
  renderMobileProductCard: (product: ProductLike, options: ProductRowRenderOptions) => ReactNode
  // True once anything is selected -- see Products.tsx's selectionModeActive
  // comment. Section/group select-all checkboxes only render while this is
  // true, matching the per-row checkboxes (part 77: "remove per-child
  // select bar from default view").
  selectionModeActive: boolean
  t: Translate
  toggleProductGroup: (key: string) => void
  toggleProductSection: (id: string) => void
  toggleSelectionScope: (ids: ProductId[], checked: boolean) => void
  tr: TranslateWithFallback
  visibleProducts: ProductLike[]
}

export default function ProductsListSurface({
  allVisibleProducts,
  collapsedProductGroups,
  collapsedProductSections,
  getGroupSummaryParts,
  initialDesktopRevealReady,
  isSelectionScopeFullySelected,
  isSelectionScopePartiallySelected,
  allVisibleIds,
  loading,
  productSections,
  productTotal,
  productTotalLabel,
  refreshingProducts,
  renderDesktopProductRow,
  bindGroupHold,
  renderGroupActions,
  renderGroupThumbnail,
  renderMobileProductCard,
  selectionModeActive,
  t,
  toggleProductGroup,
  toggleProductSection,
  toggleSelectionScope,
  tr,
  visibleProducts,
}: ProductsListSurfaceProps) {
  const skeletonRows = Array.from({ length: 8 }, (_, index) => index)
  const showDesktopLoadingOverlay = !initialDesktopRevealReady

  // A responsive fixed-layout grid keeps the final Stock/Qty column visible
  // on an ordinary desktop. Name and Details share the available width as
  // percentages; the numeric columns stay compact and predictable. At widths
  // below xl we use the card surface, because a sidebar leaves too little
  // usable space for an eight-column table even when the viewport is `lg`.
  // 11.1 + 11.2: the checkbox column only takes space in SELECT mode.
  // Out of select mode the column collapses to 0 width and its cells drop
  // their padding, so nothing is reserved and the whole grid sits a touch
  // further left; entering select mode pushes everything right by the
  // checkbox width, and leaving it reverts. In select mode the desktop
  // table HEADER checkbox IS the select-all (11.2 alignment with the other
  // five list pages) -- the old duplicate toolbar "Select all (N)" control
  // was removed.
  const selectColWidth = selectionModeActive ? SELECT_COL_WIDTH : '0px'
  const selectCellPad = selectionModeActive ? 'px-2' : 'px-0'
  const desktopColGroup = (
    <colgroup>
      <col style={{ width: selectColWidth }} />
      <col style={{ width: IMAGE_COL_WIDTH }} />
      {/* Name is the one auto column: it receives exactly the remaining
          width after the compact, bounded Details and numeric columns. */}
      <col />
      <col style={{ width: '10.5rem' }} />
      <col style={{ width: '5.5rem' }} />
      <col style={{ width: '6.5rem' }} />
      <col style={{ width: '5rem' }} />
      <col style={{ width: '5.5rem' }} />
    </colgroup>
  )

  const renderDesktopTableHead = () => (
    <thead className="sticky top-0 z-10">
      <tr>
        {/* 11.2 alignment: in select mode the column-header checkbox IS
            select-all, matching the other five list pages. The cell
            collapses to nothing out of select mode. */}
        <th className={`${selectCellPad} py-3`}>
          {selectionModeActive ? (
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              checked={isSelectionScopeFullySelected(allVisibleIds)}
              ref={(node) => { if (node) node.indeterminate = isSelectionScopePartiallySelected(allVisibleIds) }}
              onChange={(event) => toggleSelectionScope(allVisibleIds, event.target.checked)}
              aria-label={t('select_all') || 'Select all'}
            />
          ) : null}
        </th>
        <th className="whitespace-nowrap px-2 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('receipt_image_short') || t('image') || 'Image'}</th>
        <th className={`min-w-[140px] ${ROW_TEXT_GUTTER} py-3 text-left font-semibold text-gray-600 dark:text-gray-400`}>{t('product_name')}</th>
        <th className="whitespace-nowrap px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('details') || 'Details'}</th>
        {/* Was t('cost_in_purchase') ("Cost In (Purchase)") -- too long for
            this column at normal widths, overflowing/truncating to
            "Costin...". Just "Cost" (same short key ProductForm's other
            cost surfaces already use) fits and is unambiguous given the
            red cost-column styling and the Selling/Margin columns beside
            it. */}
        <th className="col-highlight-red whitespace-nowrap px-3 py-3 text-right font-semibold text-red-600 dark:text-red-400">{t('cost')}</th>
        <th className="col-highlight-green whitespace-nowrap px-3 py-3 text-right font-semibold text-green-600 dark:text-green-400">{t('selling_price_label')}</th>
        <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-blue-600 dark:text-blue-400">{t('margin')}</th>
        <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{t('stock')}</th>
      </tr>
    </thead>
  )

  const renderDesktopLoadingShell = () => (
    <div className="min-h-[26rem] animate-pulse bg-white/95 px-4 py-4 dark:bg-slate-950/80">
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/85 p-3 dark:border-slate-700/80 dark:bg-slate-900/70">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="h-7 w-24 rounded-lg bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={`products-shell-${index}`}
            className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70"
          >
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-48 max-w-[60%] rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-72 max-w-[80%] rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-16 rounded-full bg-slate-100 dark:bg-slate-800" />
                    <div className="h-5 w-16 rounded-full bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-3">
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop table: previously a fixed-height card (`sm:h-[calc(100vh-18rem)]
          sm:overflow-hidden`) with its own inner `overflow-auto` scroll region --
          a second, independent scrollbar nested inside the page's own
          `.page-scroll` container. Per user request, the list now flows with
          the page instead: no forced height, no inner scroll container. The
          table head's `sticky top-0` (see renderDesktopTableHead above) still
          works here -- it just sticks to `.page-scroll` (the nearest scrolling
          ancestor now) instead of to this card, which is the same "header
          stays visible while scrolling" behavior, just anchored one level up. */}
      <div className="card hidden min-w-0 max-w-full overflow-hidden xl:flex xl:flex-col">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[58rem] table-fixed text-sm table-bordered">
            {desktopColGroup}
            {renderDesktopTableHead()}
            <tbody className={showDesktopLoadingOverlay ? 'invisible' : ''}>
              {visibleProducts.length === 0
                ? (showDesktopLoadingOverlay
                  ? null
                  : (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-gray-400">
                        {refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'កំពុងធ្វើបច្ចុប្បន្នភាពផលិតផល...') : t('no_data')}
                      </td>
                    </tr>
                    ))
                : productSections.map((section) => {
                  const isCollapsed = collapsedProductSections.has(section.id)
                  return (
                    <Fragment key={section.id}>
                      {/* Real cells in the table's own columns, not a
                          colSpan with its own padding -- see the geometry
                          note at the top of this file. The category label
                          lands on the IMAGE column (directly above the
                          thumbnails), NOT the name column: a category names
                          a shelf of pictured products, so it reads against
                          the pictures. Group titles and product names sit
                          one column further right, on the name rail. The
                          band still reads full width -- the background is
                          on the <tr>. */}
                      <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                        <td className={`${selectCellPad} py-2`}>
                          {selectionModeActive ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded"
                              checked={isSelectionScopeFullySelected(section.ids)}
                              ref={(node) => {
                                if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                              }}
                              onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                              aria-label={`Select ${section.label}`}
                            />
                          ) : null}
                        </td>
                        <td colSpan={CATEGORY_BAND_SPAN} className={`${ROW_TEXT_GUTTER} py-2`}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                              <span className="truncate">{section.label}</span>
                              <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                            </span>
                            <button
                              type="button"
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                              onClick={() => toggleProductSection(section.id)}
                            >
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed ? section.groups.map((group) => {
                        const groupCollapsed = collapsedProductGroups.has(group.key)
                        // Wrapper card only shows when there's more than one
                        // *display row* left after merging branch-only
                        // duplicates -- a group whose rows fully merge down
                        // to one just renders as that single row, same as
                        // any other product (branch breakdown still shows
                        // via its own Details cell).
                        const showGroupRow = group.rows.length > 1
                        return (
                          <Fragment key={group.key}>
                            {/* Real cells in the table's own columns -- see the
                                geometry note at the top of this file. The title
                                therefore starts at exactly the same x as its child
                                rows' names, and as the category label above, at
                                every viewport width. */}
                            {showGroupRow ? (
                              <tr className="bg-white/80 dark:bg-slate-900/45" data-product-jump-id={group.anchorId} {...(bindGroupHold ? bindGroupHold(group) : {})}>
                                <td className={`${selectCellPad} py-2.5`}>
                                  {selectionModeActive ? (
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded"
                                      checked={isSelectionScopeFullySelected(group.ids)}
                                      ref={(node) => {
                                        if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                                      }}
                                      onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                                      aria-label={`Select ${group.name}`}
                                    />
                                  ) : null}
                                </td>
                                <td className="px-2 py-2.5">
                                  <span className="flex items-center justify-center">{renderGroupThumbnail ? renderGroupThumbnail(group) : null}</span>
                                </td>
                                <td colSpan={FULL_WIDTH_ROW_SPAN} className={`${ROW_TEXT_GUTTER} py-2.5`}>
                                  <div className="flex min-w-0 items-center justify-between gap-3">
                                    {/* Title has no leading chevron/icon -- a leading
                                        disclosure icon pushed this text ~24px right of
                                        where every standalone/child row's own title
                                        starts, making the group title look "indented"
                                        relative to its own rows. The expand/collapse
                                        chevron lives on the trailing side instead. */}
                                    <button
                                      type="button"
                                      className="min-w-0 truncate text-left text-sm font-semibold text-slate-700 dark:text-slate-100"
                                      onClick={() => toggleProductGroup(group.key)}
                                    >
                                      {group.name}
                                    </button>
                                    <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
                                      <div className="hidden xl:flex flex-wrap items-center justify-end gap-2 text-[11px] text-slate-500 dark:text-slate-300">
                                        {getGroupSummaryParts(group).map((part) => (
                                          <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                                            {part}
                                          </span>
                                        ))}
                                      </div>
                                      {/* Group-title three-dot menu (add child row /
                                          add image). Rendered by the caller
                                          (Products.tsx) since it holds the
                                          add-variant/open-form-tab handlers; this
                                          surface just gives it a slot. */}
                                      {renderGroupActions ? renderGroupActions(group) : null}
                                      <button
                                        type="button"
                                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                        onClick={() => toggleProductGroup(group.key)}
                                        aria-label={groupCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                                      >
                                        {groupCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                            {!groupCollapsed || !showGroupRow ? group.rows.map((product) => renderDesktopProductRow(product, { indented: showGroupRow })) : null}
                          </Fragment>
                        )
                      }) : null}
                    </Fragment>
                  )
                })}
            </tbody>
          </table>
          {showDesktopLoadingOverlay ? (
            <div className="pointer-events-none absolute inset-x-0 top-[3.125rem] bottom-0 z-20 overflow-hidden border-t border-slate-200/80 bg-white/80 backdrop-blur-[1px] dark:border-slate-700/80 dark:bg-slate-950/78">
              {renderDesktopLoadingShell()}
            </div>
          ) : null}
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
          {initialDesktopRevealReady
            ? `${visibleProducts.length} / ${productTotal || allVisibleProducts.length} ${t('products')}`
            : (productTotalLabel || t('loading') || 'Loading')}
        </div>
      </div>

      {/* Mobile card list: same fix as the desktop table above -- dropped
          `min-h-[32rem] flex-1 overflow-auto` (its own independent scroll
          region) so this flows with `.page-scroll` instead. */}
      <div className="min-w-0 max-w-full space-y-2 xl:hidden">
        {loading ? (
          <div className="space-y-2">
            {skeletonRows.slice(0, 6).map((row) => (
              <div key={`product-mobile-skeleton-${row}`} className="card animate-pulse p-3">
                <div className="flex items-start gap-3">
                  <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-8 w-full rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            {refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'កំពុងធ្វើបច្ចុប្បន្នភាពផលិតផល...') : t('no_data')}
          </div>
        ) : productSections.map((section) => {
          const isCollapsed = collapsedProductSections.has(section.id)
          return (
            <div key={section.id} className="min-w-0 max-w-full space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {selectionModeActive ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={isSelectionScopeFullySelected(section.ids)}
                        ref={(node) => {
                          if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                        }}
                        onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                        aria-label={`Select ${section.label}`}
                      />
                    ) : null}
                    <span className="min-w-0 truncate">{section.label}</span>
                    <span className="shrink-0 normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                    onClick={() => toggleProductSection(section.id)}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                  </button>
                </div>
              </div>
              {!isCollapsed ? section.groups.map((group) => {
                const groupCollapsed = collapsedProductGroups.has(group.key)
                // Keep the exact same grouping model on every viewport:
                // same-name rows are peer product rows wrapped by a virtual
                // group title. On mobile we used to flatten these rows into
                // independent cards, which made an existing group disappear
                // below the `sm` breakpoint even though desktop still showed
                // it. Only groups with more than one DISPLAY row get a
                // wrapper; a one-row group remains an ordinary product card.
                const showGroupRow = group.rows.length > 1
                if (!showGroupRow) {
                  return (
                    <div key={group.key} data-product-jump-id={group.anchorId}>
                      {group.rows.map((product) => renderMobileProductCard(product, { indented: false }))}
                    </div>
                  )
                }

                return (
                  <div
                    key={group.key}
                    className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/70"
                    data-product-jump-id={group.anchorId}
                    {...(bindGroupHold ? bindGroupHold(group) : {})}
                  >
                    <div className="flex min-w-0 items-stretch gap-3 bg-slate-50/90 px-3 py-2.5 dark:bg-slate-800/75">
                      {selectionModeActive ? (
                        <div className="flex shrink-0 items-start pt-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isSelectionScopeFullySelected(group.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                            }}
                            onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                            aria-label={`Select ${group.name}`}
                          />
                        </div>
                      ) : null}
                      <div className="flex shrink-0 items-center justify-center">
                        {renderGroupThumbnail ? renderGroupThumbnail(group) : null}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col justify-center">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 break-words text-left text-sm font-semibold text-slate-800 dark:text-slate-100"
                            onClick={() => toggleProductGroup(group.key)}
                          >
                            {group.name}
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            {renderGroupActions ? renderGroupActions(group) : null}
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                              onClick={() => toggleProductGroup(group.key)}
                              aria-label={groupCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                            >
                              {groupCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap gap-1 text-[10px] text-slate-500 dark:text-slate-300">
                          {getGroupSummaryParts(group).map((part) => (
                            <span key={`${group.key}-mobile-${part}`} className="max-w-full truncate rounded-full bg-white px-1.5 py-0.5 dark:bg-slate-700">
                              {part}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {!groupCollapsed ? (
                      <div className="bg-white dark:bg-slate-900/70">
                        {group.rows.map((product) => renderMobileProductCard(product, { indented: true }))}
                      </div>
                    ) : null}
                  </div>
                )
              }) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
