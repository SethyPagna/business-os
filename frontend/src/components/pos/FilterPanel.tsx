import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Tags from 'lucide-react/dist/esm/icons/tags.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import X from 'lucide-react/dist/esm/icons/x.js'

type Translate = (key: string) => string | undefined
type FilterSetter = (value: string) => void

interface NamedOption {
  id?: string | number
  name: string
  color?: string
  is_default?: boolean
}

interface POSFilterPanelProps {
  open: boolean
  t?: Translate
  onClose?: () => void
  categories?: NamedOption[]
  brands?: string[]
  branches?: NamedOption[]
  suppliers?: string[]
  categoryFilter: string
  setCategoryFilter: FilterSetter
  brandFilter: string
  setBrandFilter: FilterSetter
  branchFilter: string
  setBranchFilter: FilterSetter
  stockFilter: string
  setStockFilter: FilterSetter
  groupFilter?: string
  setGroupFilter?: FilterSetter
  supplierFilter: string
  setSupplierFilter: FilterSetter
}

interface SectionLabelProps {
  icon: LucideIcon
  children: ReactNode
}

function countActiveFlags(flags: boolean[] = []): number {
  let count = 0
  for (const flag of flags) {
    if (flag) count += 1
  }
  return count
}

function SectionLabel({ icon: Icon, children }: SectionLabelProps) {
  return (
    <div className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{children}</span>
      </span>
    </div>
  )
}

export default function POSFilterPanel({
  open,
  t,
  onClose,
  categories = [],
  brands = [],
  branches = [],
  suppliers = [],
  categoryFilter,
  setCategoryFilter,
  brandFilter,
  setBrandFilter,
  branchFilter,
  setBranchFilter,
  stockFilter,
  setStockFilter,
  groupFilter = 'all',
  setGroupFilter,
  supplierFilter,
  setSupplierFilter,
}: POSFilterPanelProps) {
  if (!open) return null
  const T = (key: string, fallback: string): string => t?.(key) || fallback
  const normalizedGroupFilter = ['grouped', 'parent', 'variant'].includes(groupFilter) ? 'group' : groupFilter

  const activeCount = countActiveFlags([
    categoryFilter !== 'all',
    brandFilter !== 'all',
    branchFilter !== 'all',
    stockFilter !== 'all',
    normalizedGroupFilter !== 'all',
    supplierFilter !== 'all',
  ])

  const clearAll = () => {
    setCategoryFilter('all')
    setBrandFilter('all')
    setBranchFilter('all')
    setStockFilter('all')
    setGroupFilter?.('all')
    setSupplierFilter('all')
  }

  const chip = (active: boolean) => (
    active
      ? 'border-blue-700 bg-blue-600 text-white shadow-sm'
      : 'border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700/80 dark:hover:text-blue-300'
  )

  return (
    <div className="pointer-events-auto card mb-2 max-h-[min(26rem,48vh)] space-y-2 overflow-y-auto overscroll-contain border border-blue-100 p-2.5 shadow-lg touch-pan-y dark:border-blue-800">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{T('filters', 'Filters')}</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white"
          onClick={() => onClose?.()}
          aria-label={T('close', 'Close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-[5.2rem_minmax(0,1fr)] items-start gap-2 rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700" data-pos-filter-section="stock">
        <SectionLabel icon={Boxes}>{T('stock_status', 'Stock Status')}</SectionLabel>
        <div className="flex flex-wrap gap-1">
          {[
            ['all', T('all', 'All')],
            ['in_stock', T('in_stock', 'In Stock')],
            ['low', T('low_stock', 'Low')],
            ['out', T('out_of_stock', 'Out')],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStockFilter(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${chip(stockFilter === value)}`}
              data-pos-filter-chip={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[5.2rem_minmax(0,1fr)] items-start gap-2 rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700" data-pos-filter-section="group">
        <SectionLabel icon={Package}>{T('groups', 'Groups')}</SectionLabel>
        <div className="flex flex-wrap gap-1">
          {[
            ['all', T('all', 'All')],
            ['group', T('groups', 'Groups')],
            ['standalone', T('standalone', 'Standalone')],
          ].map(([value, label]) => (
            <button
              key={`group-${value}`}
              type="button"
              onClick={() => setGroupFilter?.(normalizedGroupFilter === value && value !== 'all' ? 'all' : value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${chip(normalizedGroupFilter === value)}`}
              data-pos-filter-chip={`group-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {categories.length > 0 ? (
        <div className="grid grid-cols-[5.2rem_minmax(0,1fr)] items-start gap-2 rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700" data-pos-filter-section="category">
          <SectionLabel icon={Package}>{T('category', 'Category')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${chip(categoryFilter === 'all')}`}
              data-pos-filter-chip="category-all"
            >
              {T('all', 'All')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id || category.name}
                type="button"
                onClick={() => setCategoryFilter(categoryFilter === category.name ? 'all' : category.name)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${
                  categoryFilter === category.name
                    ? 'border-transparent text-white shadow-sm'
                    : 'border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200'
                }`}
                data-pos-filter-chip={`category-${category.id || category.name}`}
                style={categoryFilter === category.name ? { background: category.color || '#2563eb' } : {}}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {branches.length > 1 ? (
        <div className="grid grid-cols-[5.2rem_minmax(0,1fr)] items-start gap-2 rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700" data-pos-filter-section="branch">
          <SectionLabel icon={Building2}>{T('branch', 'Branch')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setBranchFilter('all')}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${chip(branchFilter === 'all')}`}
              data-pos-filter-chip="branch-all"
            >
              {T('all', 'All')}
            </button>
            {branches.map((branch) => (
              <button
                key={branch.id || branch.name}
                type="button"
                onClick={() => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id))}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${chip(branchFilter === String(branch.id))}`}
                data-pos-filter-chip={`branch-${branch.id || branch.name}`}
              >
                {branch.name}{branch.is_default ? ' (Default)' : ''}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {brands.length > 0 ? (
        <div className="grid grid-cols-[5.2rem_minmax(0,1fr)] items-start gap-2 rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700" data-pos-filter-section="brand">
          <SectionLabel icon={Tags}>{T('brand', 'Brand')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setBrandFilter('all')}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${chip(brandFilter === 'all')}`}
              data-pos-filter-chip="brand-all"
            >
              {T('all', 'All')}
            </button>
            {brands.map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => setBrandFilter(brandFilter === brand ? 'all' : brand)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${
                  brandFilter === brand
                    ? 'border-cyan-700 bg-cyan-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200'
                }`}
                data-pos-filter-chip={`brand-${brand}`}
              >
                {brand}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {suppliers.length > 0 ? (
        <div className="grid grid-cols-[5.2rem_minmax(0,1fr)] items-start gap-2 rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700" data-pos-filter-section="supplier">
          <SectionLabel icon={Truck}>{T('supplier', 'Supplier')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setSupplierFilter('all')}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${chip(supplierFilter === 'all')}`}
              data-pos-filter-chip="supplier-all"
            >
              {T('suppliers', T('all', 'All'))}
            </button>
            {suppliers.map((supplier) => (
              <button
                key={supplier}
                type="button"
                onClick={() => setSupplierFilter(supplierFilter === supplier ? 'all' : supplier)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${
                  supplierFilter === supplier
                    ? 'border-indigo-700 bg-indigo-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-200'
                }`}
                data-pos-filter-chip={`supplier-${supplier}`}
              >
                {supplier}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {activeCount > 0 ? (
        <button
          type="button"
          onClick={clearAll}
          className="text-left text-xs font-medium text-red-500 hover:text-red-700 dark:text-red-400"
        >
          {T('clear_filters', 'Clear all filters')}
        </button>
      ) : null}
    </div>
  )
}
