import type { ReactNode } from 'react'
import { toggleMultiFilterValue, toMultiFilterSet, type MultiFilterValue } from '../../../utils/recordFilters.ts'
// Type-only: erased entirely by both tsc and Node's native TS stripping (the
// `type` modifier means the import statement itself never survives to
// runtime, so this never actually loads/parses the JSX-bearing module it
// points at) -- safe even though this file otherwise stays JSX-free so
// `node tests/productMenuHelpers.test.ts` keeps running under plain node
// with no JSX transform. See the comment on
// isProductCategorySelected/toggleProductCategoryValues below for the
// value-level (non-type-only) version of this same constraint.
import type { FilterSection as SharedFilterSection } from '../../shared/FilterMenu.tsx'

type ProductRow = Record<string, unknown>
type Translate = (key: string, fallback?: string) => string
type Setter = (value: string) => void
type MultiSetter = (value: Set<string>) => void

interface ProductExportScope {
  id: 'selected' | 'visible' | 'full'
  label: string
  count: number
  rows: ProductRow[]
  filePrefix: string
}

interface BuildProductExportItemsOptions {
  brandFilter?: MultiFilterValue
  branchFilter?: unknown
  catFilter?: MultiFilterValue
  createdDateFrom?: string
  createdDateTo?: string
  exportProductsCsv?: (rows: ProductRow[], prefix: string) => void
  filtered?: ProductRow[]
  products?: ProductRow[]
  selectedProducts?: ProductRow[]
  stockFilter?: unknown
  supplierFilter?: MultiFilterValue
  tr?: Translate
}

interface ProductFilterState {
  brandFilter?: MultiFilterValue
  branchFilter?: unknown
  catFilter?: MultiFilterValue
  createdDateFrom?: string
  createdDateTo?: string
  groupFilter?: unknown
  initialFilter?: unknown
  issueFilter?: unknown
  productSortDirection?: unknown
  stockFilter?: unknown
  supplierFilter?: MultiFilterValue
  // Opt-in row visibility for same-name groups -- see setHideZeroStockRows.
  hideZeroStockRows?: boolean
}

interface FilterOption {
  id: string | number
  label: ReactNode
  title?: string
  active?: boolean
  onClick: () => void
}

interface LocalFilterSection {
  id: string
  label: string
  options: FilterOption[]
  searchable?: boolean
}

// A section is either one this file builds itself (LocalFilterSection --
// plain options list) or a pre-built one handed in from a .tsx caller (the
// hierarchical category rows, or the merged Availability section) which
// carries the shared FilterMenu.tsx shape (`render`, `summary`, `active`,
// etc.) -- see availabilitySection below.
type FilterSection = LocalFilterSection | SharedFilterSection


interface BranchOption {
  id?: unknown
  name?: unknown
}

interface CategoryOption {
  id?: unknown
  name?: unknown
}

interface BuildProductFilterSectionsOptions {
  branches?: BranchOption[]
  brandOptions?: unknown[]
  categories?: CategoryOption[]
  // Pre-built hierarchical "Main - Sub" option rows (built by the .tsx
  // caller via CategoryFilterOptions.tsx, since that builder returns JSX
  // labels and this file must stay JSX-free -- see the comment on
  // isProductCategorySelected/toggleProductCategoryValues above). Falls
  // back to a flat per-category list if not supplied.
  categoryOptions?: FilterOption[]
  // Pre-built merged Branch/Groups/Stock "Availability" section (a JSX
  // `render`-based FilterMenu section, built by the .tsx caller via
  // components/shared/AvailabilityFilterOptions.tsx's
  // buildAvailabilityFilterSection -- same reason as categoryOptions: this
  // file can't construct JSX itself). Spliced in right after Sort/Created,
  // before Category. When provided, the separate branch/group/stock
  // sections below are skipped (this section covers all three). Omitted/
  // null (e.g. from the plain-node test harness) falls back to those three
  // separate sections instead.
  availabilitySection?: FilterSection | null
  // Pre-built "Issues" quick-filter section (JSX `render`-based, built by
  // the .tsx caller via components/shared/IssuesFilterOptions.tsx's
  // buildIssuesFilterSection -- same reason as availabilitySection: this
  // file can't construct JSX itself). Spliced in right after Availability,
  // before Category. Omitted (e.g. the plain-node test harness) means no
  // Issues section at all -- no non-JSX fallback, same as createdSection.
  issuesSection?: FilterSection | null
  // G1 "Promotions" quick filter (promoted / discounted / by rule) --
  // see components/shared/PromotionsFilterOptions.tsx. Spliced right
  // after Issues; no non-JSX fallback, same as the others.
  promotionsSection?: FilterSection | null
  // 9.2 "Auto-merged" facet (see AutoMergedFilterOptions.tsx) -- spliced
  // after Issues; no non-JSX fallback, same as the others.
  mergedSection?: FilterSection | null
  // Pre-built "Created" date-range section (JSX `render`-based, built by
  // the .tsx caller via CreatedDateFilterOptions.tsx's
  // buildCreatedDateFilterSection -- same reason as availabilitySection:
  // this file can't construct JSX itself). A real server-side batch-date
  // range (see routes/products.ts's buildSearchFilters), replacing the old
  // client-only year/month picker this function used to build inline.
  // Omitted (e.g. the plain-node test harness) means no Created section at
  // all -- there's no non-JSX fallback for it, unlike availabilitySection.
  createdSection?: FilterSection | null
  // Pre-built AND/OR "Search mode" section (JSX `render`-based, built by
  // the .tsx caller via components/shared/SearchModeFilterOptions.tsx's
  // buildSearchModeFilterSection -- same reason as availabilitySection/
  // createdSection: this file can't construct JSX itself). Spliced in
  // right after Created/Availability, before Category. Omitted (e.g. the
  // plain-node test harness) means no Search mode section at all -- no
  // non-JSX fallback, same as createdSection.
  searchModeSection?: FilterSection | null
  filters?: ProductFilterState
  isOpen?: boolean
  // "Rows" section: the opt-in that collapses a same-name group down to the
  // rows that still have stock (utils/productGrouping.ts's
  // hideZeroStockGroupedChildRows). Off by default and reachable ONLY from
  // this menu -- chosen filters live inside FilterMenu, never as chips in the
  // toolbar row. Plain options, no JSX, so this file stays node-testable.
  setHideZeroStockRows?: (value: boolean) => void
  setBrandFilter?: MultiSetter
  setBranchFilter?: Setter
  setCatFilter?: MultiSetter
  setGroupFilter?: Setter
  setProductSortDirection?: Setter
  setStockFilter?: Setter
  setSupplierFilter?: MultiSetter
  suppliers?: unknown[]
  t?: (key: string) => string
}

function asString(value: unknown): string {
  return String(value)
}

function normalizeOptionValue(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeFilterSet(value: MultiFilterValue): Set<string> {
  const set = toMultiFilterSet(value)
  return set ? new Set([...set].map(normalizeOptionValue)) : new Set()
}

/**
 * Adapter helpers for the shared hierarchical category filter builder
 * (`components/shared/CategoryFilterOptions.tsx`, a .tsx file that this
 * module deliberately does NOT import -- this file's tests run under plain
 * `node` with no JSX transform, so any JSX-bearing import here would break
 * `node tests/productMenuHelpers.test.ts`. Callers that ARE .tsx files
 * (Products.tsx) import the JSX builder themselves and pass the resulting
 * pre-built option rows in via `categoryOptions` below.
 */
export function isProductCategorySelected(catFilter: MultiFilterValue, value: string): boolean {
  return normalizeFilterSet(catFilter).has(normalizeOptionValue(value))
}

export function toggleProductCategoryValues(catFilter: MultiFilterValue, values: string[], checked: boolean): Set<string> {
  const next = new Set(toMultiFilterSet(catFilter) || [])
  for (const value of values) {
    if (checked) next.add(value)
    else next.delete(value)
  }
  return next
}

function safeFilterLabel(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key)
  const normalized = String(value || '').trim().toLowerCase()
  if (!value || value === key) return fallback
  if (normalized === 'back') return fallback
  return value
}

// Replaces the old buildProductExportItems, which used to build one flat
// menu row PER active filter type (stock/category/brand/supplier/branch/
// created-time) even though every one of those rows exported the exact
// same `filtered` array under a slightly different filename -- up to 9
// near-identical "Export ..." rows stacked directly in the Manage dropdown
// (user-reported clutter, Aug 2026 polish pass). This instead returns at
// most 3 genuinely distinct scopes (selected / current view / full list)
// for the export panel (ExportFieldsModal) to render as a single choice,
// with the active-filters state folded into one descriptive label +
// filename instead of one row per filter kind.
export function buildProductExportScopes({
  brandFilter = 'all',
  branchFilter = 'all',
  catFilter = 'all',
  createdDateFrom = '',
  createdDateTo = '',
  filtered = [],
  products = [],
  selectedProducts = [],
  stockFilter = 'all',
  supplierFilter = 'all',
  tr = (key, fallback) => fallback || key,
}: BuildProductExportItemsOptions = {}): ProductExportScope[] {
  const filtersActive = stockFilter !== 'all'
    || Boolean(toMultiFilterSet(catFilter))
    || Boolean(toMultiFilterSet(brandFilter))
    || Boolean(toMultiFilterSet(supplierFilter))
    || branchFilter !== 'all'
    || Boolean(createdDateFrom || createdDateTo)

  const scopes: ProductExportScope[] = []
  if (selectedProducts.length) {
    scopes.push({
      id: 'selected',
      label: tr('export_scope_selected', 'Selected products'),
      count: selectedProducts.length,
      rows: selectedProducts,
      filePrefix: 'products-selected',
    })
  }
  scopes.push({
    id: 'visible',
    label: filtersActive ? tr('export_scope_filtered', 'Current filtered results') : tr('export_scope_visible', 'All visible products'),
    count: filtered.length,
    rows: filtered,
    filePrefix: filtersActive ? 'products-filtered' : 'products-visible',
  })
  // Only a distinct scope when it would actually export something
  // different from "visible" above -- an unfiltered visible list already
  // is the full list, so a separate identical row would just be the same
  // clutter this function exists to remove.
  if (products.length !== filtered.length) {
    scopes.push({
      id: 'full',
      label: tr('export_scope_full', 'Full product list (ignore filters)'),
      count: products.length,
      rows: products,
      filePrefix: 'products-all',
    })
  }
  return scopes
}

export function countActiveProductFilters({
  brandFilter = 'all',
  branchFilter = 'all',
  catFilter = 'all',
  createdDateFrom = '',
  createdDateTo = '',
  groupFilter = 'all',
  initialFilter = 'all',
  issueFilter = 'all',
  // 'name_asc' (Name A-Z) is the real default sort for this page, same as
  // buildProductFilterSections' own default below -- this was left at
  // 'desc' while only the comparison below (line ~224) was updated to
  // 'name_asc', so calling this with no args counted the true default as
  // 1 active filter instead of 0.
  productSortDirection = 'name_asc',
  stockFilter = 'all',
  supplierFilter = 'all',
}: ProductFilterState = {}): number {
  return [
    toMultiFilterSet(catFilter) ? 1 : 0,
    toMultiFilterSet(brandFilter) ? 1 : 0,
    branchFilter !== 'all' ? 1 : 0,
    toMultiFilterSet(supplierFilter) ? 1 : 0,
    stockFilter !== 'all' ? 1 : 0,
    groupFilter !== 'all' ? 1 : 0,
    initialFilter !== 'all' ? 1 : 0,
    issueFilter && issueFilter !== 'all' ? 1 : 0,
    createdDateFrom ? 1 : 0,
    createdDateTo ? 1 : 0,
    // 'name_asc' (Name A-Z) is the actual default sort now, not 'desc' --
    // see buildProductFilterSections' own `productSortDirection = 'desc'`
    // fallback below, which is only a shape-of-data default for callers
    // that omit the field entirely (e.g. the plain-node test harness), not
    // the product page's real default. Comparing against 'desc' here would
    // permanently count the true default (Name A-Z) as "1 active filter".
    productSortDirection !== 'name_asc' ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0)
}

export function buildProductFilterSections({
  availabilitySection,
  issuesSection,
  promotionsSection,
  mergedSection,
  createdSection,
  searchModeSection,
  branches = [],
  brandOptions = [],
  categories = [],
  categoryOptions,
  filters = {},
  isOpen = true,
  setBrandFilter = () => {},
  setBranchFilter = () => {},
  setCatFilter = () => {},
  setGroupFilter = () => {},
  setProductSortDirection = () => {},
  setStockFilter = () => {},
  setSupplierFilter = () => {},
  setHideZeroStockRows = () => {},
  suppliers = [],
  t = (key) => key,
}: BuildProductFilterSectionsOptions = {}): FilterSection[] {
  if (!isOpen) return []
  const {
    hideZeroStockRows = false,
    brandFilter = 'all' as MultiFilterValue,
    branchFilter = 'all',
    catFilter = 'all' as MultiFilterValue,
    groupFilter = 'all',
    // 'name_asc' (Name A-Z) is the real default sort for this page -- see
    // countActiveProductFilters' matching comment above.
    productSortDirection = 'name_asc',
    stockFilter = 'all',
    supplierFilter = 'all' as MultiFilterValue,
  } = filters

  return [
    // 'sort' and 'supplier' sections intentionally removed from this menu:
    // the Products/Inventory filter menu now shows only Availability
    // (merged Branch+Group+Stock), Created, Category, and Brand. The list
    // itself stays locked to alphabetical (name_asc, this function's own
    // default below) rather than offering a manual sort toggle.
    // `setProductSortDirection`/`productSortDirection` are left in this
    // function's params/state for now (still read by countActiveProductFilters
    // and the API call in Products.tsx) rather than ripped out, since no
    // caller can change them via UI anymore and removing the plumbing
    // itself is a separate, riskier change than just hiding the section.
    //
    // "Created" is now a real server-side batch-date range (see
    // routes/products.ts's buildSearchFilters and
    // CreatedDateFilterOptions.tsx's buildCreatedDateFilterSection) rather
    // than the old client-only year/month picker this function used to
    // build inline against product.created_at -- see progress.md's
    // "Created section reworked to filter by batch date" item.
    // G1b order: the facets people reach for daily lead (Availability,
    // Category, Brand, Promotions); range/diagnostic/advanced controls
    // (Created, Issues, Search mode) sit at the end -- "reorganize the
    // filters, make it smart and easy to use" (user, Aug 28).
    availabilitySection ? availabilitySection : branches.length > 1 ? {
      id: 'branch',
      label: t('branch') || 'Branch',
      options: [
        { id: 'branch-all', label: t('all') || 'All', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
        ...branches.map((branch) => ({
          id: `branch-${branch.id}`,
          label: String(branch.name),
          active: branchFilter === String(branch.id),
          onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
        })),
      ],
    } : null,
    availabilitySection ? null : {
      id: 'group',
      label: t('groups') || 'Groups',
      options: [
        { id: 'group-all', label: t('all') || 'All', active: groupFilter === 'all', onClick: () => setGroupFilter('all') },
        { id: 'group-grouped', label: t('groups') || 'Groups', active: groupFilter === 'group', onClick: () => setGroupFilter(groupFilter === 'group' ? 'all' : 'group') },
        { id: 'group-standalone', label: t('standalone') || 'Standalone', active: groupFilter === 'standalone', onClick: () => setGroupFilter(groupFilter === 'standalone' ? 'all' : 'standalone') },
      ],
    },
    availabilitySection ? null : {
      id: 'stock',
      label: t('stock_status') || 'Stock status',
      options: [
        { id: 'stock-all', label: t('all') || 'All', active: stockFilter === 'all', onClick: () => setStockFilter('all') },
        { id: 'stock-in', label: t('in_stock') || 'In Stock', active: stockFilter === 'in_stock', onClick: () => setStockFilter('in_stock') },
        { id: 'stock-healthy', label: t('healthy_stock') || 'Healthy', active: stockFilter === 'healthy', onClick: () => setStockFilter('healthy') },
        { id: 'stock-low', label: t('low_stock') || 'Low', active: stockFilter === 'low', onClick: () => setStockFilter('low') },
        { id: 'stock-out', label: t('out_of_stock') || 'Out', active: stockFilter === 'out', onClick: () => setStockFilter('out') },
      ],
    },
    // "Issues" quick filter -- see components/shared/IssuesFilterOptions.tsx
    // for the section itself. No non-JSX fallback (same as createdSection/
    // searchModeSection): omitted entirely when not supplied.
    categories.length ? {
      id: 'category',
      label: t('category') || 'Category',
      searchable: true,
      options: [
        { id: 'cat-all', label: t('all') || 'All', active: !toMultiFilterSet(catFilter), onClick: () => setCatFilter(new Set()) },
        // Hierarchical "Main - Sub" rows when the .tsx caller supplied them
        // (see categoryOptions above); otherwise a flat per-category list
        // (e.g. a test harness that doesn't build the JSX rows).
        ...(categoryOptions ?? categories.map((category) => {
          const normalizedSet = normalizeFilterSet(catFilter)
          return {
            id: `cat-${category.id}`,
            label: String(category.name),
            active: normalizedSet.has(normalizeOptionValue(category.name)),
            onClick: () => setCatFilter(toggleMultiFilterValue(toMultiFilterSet(catFilter) || new Set(), String(category.name))),
          }
        })),
      ],
    } : null,
    brandOptions.length ? {
      id: 'brand',
      label: safeFilterLabel(t, 'brand', 'Brand'),
      searchable: true,
      options: [
        { id: 'brand-all', label: safeFilterLabel(t, 'all_brands', 'All Brands'), active: !toMultiFilterSet(brandFilter), onClick: () => setBrandFilter(new Set()) },
        ...brandOptions.map((brand) => {
          const normalizedSet = normalizeFilterSet(brandFilter)
          return {
            id: `brand-${brand}`,
            label: String(brand),
            active: normalizedSet.has(normalizeOptionValue(brand)),
            onClick: () => setBrandFilter(toggleMultiFilterValue(toMultiFilterSet(brandFilter) || new Set(), asString(brand))),
          }
        }),
      ],
    } : null,
    // 'supplier' section removed from the filter menu (see comment above
    // 'created' section) -- suppliers/supplierFilter/setSupplierFilter
    // params stay for countActiveProductFilters and the export-menu
    // "filtered supplier" item, just no longer rendered here.    promotionsSection ? promotionsSection : null,
    createdSection ? createdSection : null,
    // AND/OR search-mode section (see searchModeSection's own comment
    // above) -- right after Created, before Availability/Category, same
    // splice point as the standalone button used to sit at (right next to
    // the search box, which is directly above this menu).
    issuesSection ? issuesSection : null,
    mergedSection ? mergedSection : null,
    // "Rows" -- the opt-in that collapses a same-name group to the rows that
    // still hold stock. It is OFF by default and lives only here: hiding rows
    // by default made an out-of-stock product that shares a name group
    // unreachable from this page entirely (it could not be found, opened,
    // edited or restocked), and the standing rule keeps a chosen filter inside
    // this menu rather than spilling a chip into the toolbar row.
    {
      id: 'row_visibility',
      label: t('rows') || 'Rows',
      options: [
        {
          id: 'rows-all',
          label: t('all_rows') || 'All rows',
          title: t('all_rows_hint') || 'Every product row stays reachable, including rows that are out of stock at every branch.',
          active: !hideZeroStockRows,
          onClick: () => setHideZeroStockRows(false),
        },
        {
          id: 'rows-hide-out-of-stock',
          label: t('hide_out_of_stock_rows') || 'Hide out-of-stock rows',
          title: t('hide_out_of_stock_rows_hint') || 'Inside a same-name group, hide the child rows that are out of stock at every branch. The group header shows how many are hidden.',
          active: hideZeroStockRows,
          onClick: () => setHideZeroStockRows(!hideZeroStockRows),
        },
      ],
    },
    searchModeSection ? searchModeSection : null,
    // Merged Branch/Groups/Stock "Availability" section when the .tsx
    // caller built one (see components/shared/AvailabilityFilterOptions.tsx)
    // -- covers all three, so the separate sections below are skipped.
    // Falls back to those three separate sections when not supplied (e.g.
    // the plain-node test harness, which can't construct the JSX render).

  ].filter(Boolean) as FilterSection[]
}
