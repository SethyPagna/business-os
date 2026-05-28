import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Boxes, Building2, Package, Tags, Truck, X } from 'lucide-react'

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
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
      <span className="inline-flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {children}
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

  const activeCount = countActiveFlags([
    categoryFilter !== 'all',
    brandFilter !== 'all',
    branchFilter !== 'all',
    stockFilter !== 'all',
    groupFilter !== 'all',
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
      ? 'bg-blue-600 text-white'
      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
  )

  return (
    <div className="pointer-events-auto card mb-2 max-h-[min(26rem,48vh)] space-y-3 overflow-y-auto overscroll-contain border border-blue-100 p-3 shadow-lg touch-pan-y dark:border-blue-800">
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

      <div>
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
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${chip(stockFilter === value)}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel icon={Package}>{T('groups', 'Groups')}</SectionLabel>
        <div className="flex flex-wrap gap-1">
          {[
            ['all', T('all', 'All')],
            ['grouped', T('groups', 'Groups')],
            ['standalone', T('standalone', 'Standalone')],
          ].map(([value, label]) => (
            <button
              key={`group-${value}`}
              type="button"
              onClick={() => setGroupFilter?.(groupFilter === value && value !== 'all' ? 'all' : value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${chip(groupFilter === value)}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {categories.length > 0 ? (
        <div>
          <SectionLabel icon={Package}>{T('category', 'Category')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(categoryFilter === 'all')}`}
            >
              {T('all', 'All')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id || category.name}
                type="button"
                onClick={() => setCategoryFilter(categoryFilter === category.name ? 'all' : category.name)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  categoryFilter === category.name
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
                style={categoryFilter === category.name ? { background: category.color || '#2563eb' } : {}}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {branches.length > 1 ? (
        <div>
          <SectionLabel icon={Building2}>{T('branch', 'Branch')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setBranchFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(branchFilter === 'all')}`}
            >
              {T('all', 'All')}
            </button>
            {branches.map((branch) => (
              <button
                key={branch.id || branch.name}
                type="button"
                onClick={() => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id))}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(branchFilter === String(branch.id))}`}
              >
                {branch.name}{branch.is_default ? ' (Default)' : ''}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {brands.length > 0 ? (
        <div>
          <SectionLabel icon={Tags}>{T('brand', 'Brand')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setBrandFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(brandFilter === 'all')}`}
            >
              {T('all', 'All')}
            </button>
            {brands.map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => setBrandFilter(brandFilter === brand ? 'all' : brand)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  brandFilter === brand
                    ? 'bg-cyan-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
              >
                {brand}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {suppliers.length > 0 ? (
        <div>
          <SectionLabel icon={Truck}>{T('supplier', 'Supplier')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setSupplierFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(supplierFilter === 'all')}`}
            >
              {T('suppliers', T('all', 'All'))}
            </button>
            {suppliers.map((supplier) => (
              <button
                key={supplier}
                type="button"
                onClick={() => setSupplierFilter(supplierFilter === supplier ? 'all' : supplier)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  supplierFilter === supplier
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
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
