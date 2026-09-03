import { Fragment } from 'react'
import type { ReactNode } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import { EmptyState, Skeleton } from '../../shared/kit'

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
  const showDesktopLoadingOverlay = !initialDesktopRevealReady

  // A fixed responsive grid prevents long product metadata from widening
  // the table beyond an ordinary laptop viewport. Details/Margin still
  // hide at their existing breakpoints, while Stock remains inside the card.
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
      {/* These six MUST sum to 100%. They summed to 90%, and `table-fixed`
          spreads whatever is unclaimed across EVERY column proportionally
          -- including the two fixed ones above, which is why the checkbox
          and image columns rendered at 51px and 89px on a 1400px table
          having asked for 32px and 56px, and why the indent grew with the
          window. Measured in a browser against the built stylesheet: at
          100% they render at exactly 32px and 56px, and the left rail
          stops moving with the viewport (98px at 1400px and at 820px). */}
      <col className="w-[34%]" />
      <col className="w-[22%]" />
      <col className="w-[11%]" />
      <col className="w-[12%]" />
      <col className="w-[9%]" />
      <col className="w-[12%]" />
    </colgroup>
  )

  // P2-4 step 5 (Level 1, decision 6/8): kit tokens on the header row --
  // sticky z now reads the shared --z-sticky token (was a bare z-10), and
  // each <th> gets the kit's ivory/charcoal surface+line tokens with an
  // important modifier: .table-bordered thead th (src/styles/main.css,
  // P2-9's file, not touched here) already sets its own background/border
  // with a MORE specific selector (two classes) than a plain utility class
  // (one class) could ever beat, so a non-important override would
  // silently lose the cascade fight and render as if nothing changed.
  // Column-specific text colours (cost=red/selling=green/margin=blue) stay
  // as-is -- those encode meaning (col-highlight-*), not the ivory/charcoal
  // palette, and this checkpoint does not touch that convention.
  const KIT_TH_HEADER = '!bg-[var(--ui-surface)] !border-[var(--ui-line)]'
  const renderDesktopTableHead = () => (
    <thead className="sticky top-0 z-[var(--z-sticky)]">
      <tr>
        {/* 11.2 alignment: in select mode the column-header checkbox IS
            select-all, matching the other five list pages. The cell
            collapses to nothing out of select mode. */}
        <th className={`${selectCellPad} py-3 ${KIT_TH_HEADER}`}>
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
        <th className={`whitespace-nowrap px-2 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 ${KIT_TH_HEADER}`}>{t('receipt_image_short') || t('image') || 'Image'}</th>
        <th className={`min-w-[140px] ${ROW_TEXT_GUTTER} py-3 text-left font-semibold text-gray-600 dark:text-gray-400 ${KIT_TH_HEADER}`}>{t('product_name')}</th>
        <th className={`hidden whitespace-nowrap px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 md:table-cell ${KIT_TH_HEADER}`}>{t('details') || 'Details'}</th>
        {/* Was t('cost_in_purchase') ("Cost In (Purchase)") -- too long for
            this column at normal widths, overflowing/truncating to
            "Costin...". Just "Cost" (same short key ProductForm's other
            cost surfaces already use) fits and is unambiguous given the
            red cost-column styling and the Selling/Margin columns beside
            it. */}
        <th className={`col-highlight-red whitespace-nowrap px-3 py-3 text-right font-semibold text-red-600 dark:text-red-400 ${KIT_TH_HEADER}`}>{t('cost')}</th>
        <th className={`col-highlight-green whitespace-nowrap px-3 py-3 text-right font-semibold text-green-600 dark:text-green-400 ${KIT_TH_HEADER}`}>{t('selling_price_label')}</th>
        <th className={`hidden whitespace-nowrap px-3 py-3 text-right font-semibold text-[var(--ui-info)] lg:table-cell ${KIT_TH_HEADER}`}>{t('margin')}</th>
        <th className={`whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-600 dark:text-gray-400 ${KIT_TH_HEADER}`}>{t('stock')}</th>
      </tr>
    </thead>
  )

  // P2-4 step 7: replaced the hand-rolled row-shaped pulse shell with the
  // shared kit Skeleton (variant="table"). This trades the old shell's
  // exact thumbnail/badge/5-column mimicry for consistency with every
  // other kit-adopting page's loading state -- a deliberate fidelity
  // step-down the brief's "EmptyState/Skeleton replacing ad-hoc [loaders]"
  // step calls for, not an oversight; see p2-4-report.md.
  const renderDesktopLoadingShell = () => (
    <div className="px-4 py-4">
      <Skeleton variant="table" rows={8} />
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
      <div className="card hidden overflow-hidden sm:flex sm:flex-col">
        <div className="relative overflow-hidden">
          <table className="w-full table-fixed text-[length:var(--ui-size-body)] table-bordered">
            {desktopColGroup}
            {renderDesktopTableHead()}
            <tbody className={showDesktopLoadingOverlay ? 'invisible' : ''}>
              {visibleProducts.length === 0
                ? (showDesktopLoadingOverlay
                  ? null
                  : (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState
                          icon={<Package />}
                          title={refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'កំពុងធ្វើបច្ចុប្បន្នភាពផលិតផល...') : t('no_data')}
                        />
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
                      <tr className="h-[var(--ui-row-h)] bg-slate-100/90 dark:bg-slate-800/80">
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
                              <tr className="h-[var(--ui-row-h)] bg-white/80 dark:bg-slate-900/45" data-product-jump-id={group.anchorId} {...(bindGroupHold ? bindGroupHold(group) : {})}>
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
      <div className="space-y-2 sm:hidden">
        {loading ? (
          // P2-4 step 7: same Skeleton adoption as the desktop shell above.
          <Skeleton variant="table" rows={6} />
        ) : visibleProducts.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title={refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'កំពុងធ្វើបច្ចុប្បន្នភាពផលិតផល...') : t('no_data')}
          />
        ) : productSections.map((section) => {
          const isCollapsed = collapsedProductSections.has(section.id)
          return (
            <div key={section.id} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                {/* P2-4 fix (cert-phase1): at 375px this row used to clip the
                    Collapse button off-screen because the label was an
                    unconstrained flex child that could grow past the row's
                    width. min-w-0 on the row + label lets the flex box
                    actually shrink the label, and shrink-0 pins the button
                    so it always stays reachable; the category name truncates
                    with an ellipsis and a native title attr for the rare
                    overflow case (not user free text, so no TruncatedText
                    needed here). */}
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {selectionModeActive ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded"
                        checked={isSelectionScopeFullySelected(section.ids)}
                        ref={(node) => {
                          if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                        }}
                        onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                        aria-label={`Select ${section.label}`}
                      />
                    ) : null}
                    <span className="min-w-0 truncate" title={section.label}>{section.label}</span>
                    <span className="shrink-0 normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
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
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/70"
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
