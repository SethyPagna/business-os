import { Boxes, Building2, Package, Tags, ToggleLeft, Truck } from 'lucide-react'

export default function POSFilterPanel({
  open,
  t,
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
  supplierFilter,
  setSupplierFilter,
  quickFilters,
  setQuickFilter,
}) {
  if (!open) return null
  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)

  const activeCount = [
    categoryFilter !== 'all',
    brandFilter !== 'all',
    branchFilter !== 'all',
    stockFilter !== 'all',
    supplierFilter !== 'all',
  ].filter(Boolean).length

  const clearAll = () => {
    setCategoryFilter('all')
    setBrandFilter('all')
    setBranchFilter('all')
    setStockFilter('all')
    setSupplierFilter('all')
  }

  const chip = (active) => (
    active
      ? 'bg-blue-600 text-white'
      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
  )

  const SectionLabel = ({ icon: Icon, children }) => (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
      <span className="inline-flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {children}
      </span>
    </div>
  )

  return (
    <div className="card mb-2 space-y-3 border border-blue-100 p-3 dark:border-blue-800">
      <div>
        <SectionLabel icon={ToggleLeft}>{T('quick_filters', 'Quick filters')}</SectionLabel>
        <div className="flex flex-wrap gap-1">
          {[
            ['category', T('category', 'Category')],
            ['brand', T('brand', 'Brand')],
            ['branch', T('branch', 'Branch')],
            ['stock', T('stock_status', 'Stock status')],
            ['supplier', T('supplier', 'Supplier')],
          ].map(([key, label]) => {
            const enabled = !!quickFilters?.[key]
            return (
              <button
                key={`quick-${key}`}
                type="button"
                onClick={() => setQuickFilter?.(key, !enabled)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  enabled
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
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
              onClick={() => setStockFilter(value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${chip(stockFilter === value)}`}
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
              onClick={() => setCategoryFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(categoryFilter === 'all')}`}
            >
              {T('all', 'All')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
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

      {brands.length > 0 ? (
        <div>
          <SectionLabel icon={Tags}>{T('brand', 'Brand')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setBrandFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(brandFilter === 'all')}`}
            >
              {T('all', 'All')}
            </button>
            {brands.map((brand) => (
              <button
                key={brand}
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

      {branches.length > 1 ? (
        <div>
          <SectionLabel icon={Building2}>{T('branch', 'Branch')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setBranchFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(branchFilter === 'all')}`}
            >
              {T('all', 'All')}
            </button>
            {branches.map((branch) => (
              <button
                key={branch.id}
                onClick={() => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id))}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(branchFilter === String(branch.id))}`}
              >
                {branch.name}{branch.is_default ? ' (Default)' : ''}
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
              onClick={() => setSupplierFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${chip(supplierFilter === 'all')}`}
            >
              {T('suppliers', T('all', 'All'))}
            </button>
            {suppliers.map((supplier) => (
              <button
                key={supplier}
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
          onClick={clearAll}
          className="text-left text-xs font-medium text-red-500 hover:text-red-700 dark:text-red-400"
        >
          {T('clear_filters', 'Clear all filters')}
        </button>
      ) : null}
    </div>
  )
}
