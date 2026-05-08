import { Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import DualMoney from './DualMoney'

export default function InventoryProductsSurface({
  InventoryBatchPreview,
  InventoryDiscountBadge,
  branchFilter,
  branches,
  collapsedInventoryGroups,
  collapsedInventorySections,
  fmtKHR,
  fmtUSD,
  getInventoryGroupSummaryParts,
  getStockQty,
  inventoryProductSections,
  loading,
  openAdjust,
  selectedProductIds,
  setDetailProduct,
  showProductsSection,
  t,
  toggleInventoryGroup,
  toggleInventorySection,
  toggleInventorySelectionScope,
  toggleSelectedProduct,
  visibleInventoryProducts,
  isInventorySelectionScopeFullySelected,
  isInventorySelectionScopePartiallySelected,
}) {
  return (
    <>
      <div className="space-y-2 sm:hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400">{t('loading')}</div>
        ) : visibleInventoryProducts.length === 0 ? (
          <div className="text-center py-10 text-gray-400">{t('no_data')}</div>
        ) : inventoryProductSections.map((section) => {
          const isCollapsed = collapsedInventorySections.has(section.id)
          return (
            <div key={section.id} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isInventorySelectionScopeFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleInventorySelectionScope(section.ids, event.target.checked)}
                      aria-label={`Select ${section.label}`}
                    />
                    <span>{section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                    onClick={() => toggleInventorySection(section.id)}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                  </button>
                </div>
              </div>
              {!isCollapsed ? section.groups.map((group) => {
                const groupCollapsed = collapsedInventoryGroups.has(group.key)
                const showGroupRow = group.hasMultipleItems
                return (
                  <div key={group.key} className="space-y-2">
                    {showGroupRow ? (
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex min-w-0 items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded"
                              checked={isInventorySelectionScopeFullySelected(group.ids)}
                              ref={(node) => {
                                if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(group.ids)
                              }}
                              onChange={(event) => toggleInventorySelectionScope(group.ids, event.target.checked)}
                              aria-label={`Select ${group.name}`}
                            />
                            <button type="button" className="min-w-0 text-left" onClick={() => toggleInventoryGroup(group.key)}>
                              <div className="flex items-center gap-1.5">
                                {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{group.name}</span>
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{group.items.length}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500 dark:text-slate-300">
                                {getInventoryGroupSummaryParts(group, { includeCount: false }).map((part) => (
                                  <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{part}</span>
                                ))}
                              </div>
                            </button>
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {!groupCollapsed ? group.items.map((p) => {
                      const qty = getStockQty(p)
                      const isLow = qty > 0 && qty <= p.low_stock_threshold
                      const isOut = qty <= (p.out_of_stock_threshold || 0)
                      const scls = isOut ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : isLow ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700' : 'bg-green-100 dark:bg-green-900/30 text-green-700'
                      const slbl = isOut ? (t('out_of_stock') || 'Out') : isLow ? (t('low_stock') || 'Low') : (t('in_stock') || 'In Stock')
                      const soldQty = Math.max(0, p.qty_sold || 0)
                      const revenue = Math.max(0, p.revenue_usd || 0)
                      const productBrand = String(p.brand || '').trim()
                      const productCategory = String(p.category || '').trim()
                      const productTagText = [productBrand, productCategory].filter(Boolean).join(' Â· ')
                      return (
                        <div key={p.id} className="card cursor-pointer px-3 py-2.5" onClick={() => setDetailProduct(p)}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 rounded"
                                  checked={selectedProductIds.has(Number(p.id))}
                                  onChange={(event) => {
                                    event.stopPropagation()
                                    toggleSelectedProduct(p.id)
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={`${t('select') || 'Select'} ${p.name}`}
                                />
                                <div className="min-w-0 flex-1 pr-0.5">
                                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-white" title={p.name}>{p.name}</div>
                                </div>
                              </div>
                              <div className="mt-1 flex items-start gap-1.5 pl-6 text-[9.5px] leading-3.5 text-gray-500 dark:text-gray-300">
                                {productBrand ? <span className="max-w-[38%] shrink-0 truncate" title={productBrand}>{productBrand}</span> : null}
                                {productBrand && productCategory ? <span className="shrink-0 text-gray-300 dark:text-gray-600">Â·</span> : null}
                                {productCategory ? <span className="min-w-0 flex-1 truncate" title={productCategory}>{productCategory}</span> : null}
                                {!productTagText ? <span className="truncate">{t('product') || 'Product'}</span> : null}
                              </div>
                            </div>
                            <div className="flex min-w-[4.35rem] max-w-[4.6rem] shrink-0 flex-col items-end gap-0.5 text-right">
                              <div className="flex items-center justify-end gap-0.5">
                                <div className="whitespace-nowrap text-[11px] font-bold leading-none text-gray-900 dark:text-white">
                                  {qty}
                                  <span className="ml-1 text-[9px] font-normal text-gray-400">{p.unit}</span>
                                </div>
                                <span className={`whitespace-nowrap rounded-full px-1 py-0.5 text-[8.5px] font-medium ${scls}`}>{slbl}</span>
                                <button onClick={(event) => { event.stopPropagation(); openAdjust(p) }} className="px-0.5 py-0.5 text-[9px] font-medium text-blue-600 dark:text-blue-400">
                                  {t('adjust')}
                                </button>
                              </div>
                              {p.barcode ? (
                                <span className="mt-0.5 max-w-full truncate rounded-full bg-slate-100 px-1.5 py-0.5 text-[8.5px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                  {p.barcode}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-2 pl-6">
                            <div className="min-w-0">
                              <InventoryDiscountBadge product={p} fmtUSD={fmtUSD} t={t} />
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                            <span>Cost {fmtUSD(p.purchase_price_usd || 0)}</span>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span>Price {fmtUSD(p.selling_price_usd || 0)}</span>
                            {(p.special_price_usd || 0) > 0 ? (
                              <>
                                <span className="text-gray-300 dark:text-gray-600">|</span>
                                <span>{t('special_price') || 'Special'} {fmtUSD(p.special_price_usd || 0)}</span>
                              </>
                            ) : null}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                            <span>Sold {soldQty} Â· Rev {fmtUSD(revenue)}</span>
                            <InventoryBatchPreview product={p} branchId={branchFilter} t={t} compact />
                          </div>
                        </div>
                      )
                    }) : null}
                  </div>
                )
              }) : null}
            </div>
          )
        })}
      </div>

      <div className="card overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-400"><span className="sr-only">{t('select') || 'Select'}</span></th>
                <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 min-w-[140px]">{t('product_name')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('current_stock')}</th>
                {branches.length > 1 && <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">{t('branches')}</th>}
                <th className="text-center px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">{t('cost')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">{t('price')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden lg:table-cell">{t('stock_val')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden xl:table-cell">{t('net_sold_header')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-green-700 dark:text-green-400 whitespace-nowrap hidden xl:table-cell">{t('revenue_header')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-orange-600 dark:text-orange-400 whitespace-nowrap hidden xl:table-cell">{t('cogs_header')}</th>
                <th className="text-right px-3 py-1.5 font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap hidden xl:table-cell">{t('profit_header')}</th>
                <th className="text-center px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('adjust_stock')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
              ) : visibleInventoryProducts.length === 0 ? (
                <tr><td colSpan={13} className="text-center py-8 text-gray-400">{t('no_data')}</td></tr>
              ) : inventoryProductSections.map((section) => {
                const isCollapsed = collapsedInventorySections.has(section.id)
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-50 dark:bg-slate-800/60">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={isInventorySelectionScopeFullySelected(section.ids)}
                          ref={(node) => {
                            if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(section.ids)
                          }}
                          onChange={(event) => toggleInventorySelectionScope(section.ids, event.target.checked)}
                          aria-label={`Select ${section.label}`}
                        />
                      </td>
                      <td colSpan={12} className="px-4 py-2">
                        <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <span>{section.label} Â· {section.items.length} {(t('products') || 'products').toLowerCase()}</span>
                          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleInventorySection(section.id)}>
                            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed ? section.groups.map((group) => {
                      const groupCollapsed = collapsedInventoryGroups.has(group.key)
                      const showGroupRow = group.hasMultipleItems
                      return (
                        <Fragment key={group.key}>
                          {showGroupRow ? (
                            <tr className="bg-white dark:bg-gray-800/70">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={isInventorySelectionScopeFullySelected(group.ids)}
                                  ref={(node) => {
                                    if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(group.ids)
                                  }}
                                  onChange={(event) => toggleInventorySelectionScope(group.ids, event.target.checked)}
                                  aria-label={`Select ${group.name}`}
                                />
                              </td>
                              <td colSpan={12} className="px-4 py-1.5">
                                <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => toggleInventoryGroup(group.key)}>
                                  {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                  <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{group.name}</span>
                                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{group.items.length}</span>
                                  <span className="ml-2 flex flex-wrap gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                                    {getInventoryGroupSummaryParts(group, { includeCount: false }).map((part) => (
                                      <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{part}</span>
                                    ))}
                                  </span>
                                </button>
                              </td>
                            </tr>
                          ) : null}
                          {!groupCollapsed ? group.items.map((p) => {
                            const qty = getStockQty(p)
                            const isLow = qty > 0 && qty <= p.low_stock_threshold
                            const isOut = qty <= (p.out_of_stock_threshold || 0)
                            const status = isOut ? { label:'Out', cls:'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs px-1.5 py-0.5 rounded-full' }
                                         : isLow ? { label:'Low', cls:'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs px-1.5 py-0.5 rounded-full' }
                                         :         { label:'OK',  cls:'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs px-1.5 py-0.5 rounded-full' }
                            const netRev = Math.max(0, p.revenue_usd || 0)
                            const netCogs = Math.max(0, p.cogs_usd || 0)
                            const profit = netRev - netCogs
                            const productTagText = [p.brand, p.category].filter(Boolean).join(' Â· ')
                            return (
                              <tr key={p.id} className="table-row cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10" onClick={() => setDetailProduct(p)}>
                                <td className="px-3 py-1" onClick={(event) => event.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded"
                                    checked={selectedProductIds.has(Number(p.id))}
                                    onChange={() => toggleSelectedProduct(p.id)}
                                    aria-label={`${t('select') || 'Select'} ${p.name}`}
                                  />
                                </td>
                                <td className="px-3 py-1">
                                  <div className="font-medium leading-tight text-gray-900 dark:text-white">{p.name}</div>
                                  <div className="mt-0.5 text-[10px] leading-4 text-gray-400">
                                    <span className="break-words">{productTagText || (t('product') || 'Product')}</span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    <InventoryDiscountBadge product={p} fmtUSD={fmtUSD} t={t} />
                                    <InventoryBatchPreview product={p} branchId={branchFilter} t={t} compact />
                                    {p.barcode ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">{p.barcode}</span> : null}
                                  </div>
                                </td>
                                <td className="px-3 py-1 text-right font-bold whitespace-nowrap text-gray-900 dark:text-white">
                                  {qty} <span className="text-[10px] font-normal text-gray-400">{p.unit}</span>
                                </td>
                                {branches.length > 1 && (
                                  <td className="hidden px-3 py-1 md:table-cell">
                                    <div className="flex flex-wrap gap-0.5">
                                      {(p.branch_stock || []).slice(0, 3).map((bs) => (
                                        <span key={bs.branch_id} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                                          {bs.branch_name?.split(' ')[0]}: {bs?.quantity ?? 0}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                )}
                                <td className="px-3 py-1 text-center"><span className={status.cls}>{status.label}</span></td>
                                <td className="px-3 py-1"><DualMoney usd={p.purchase_price_usd||p.cost_price_usd||0} khr={p.purchase_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                                <td className="px-3 py-1">
                                  <DualMoney usd={p.selling_price_usd||0} khr={p.selling_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                                  {(p.special_price_usd || 0) > 0 || (p.special_price_khr || 0) > 0 ? (
                                    <div className="mt-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                                      {t('special_price') || 'Special'} {fmtUSD(p.special_price_usd || p.selling_price_usd || 0)}
                                      {(p.special_price_khr || 0) > 0 ? ` / ${fmtKHR(p.special_price_khr || 0)}` : ''}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="hidden px-3 py-1 lg:table-cell"><DualMoney usd={p.stock_value_usd||0} khr={p.stock_value_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                                <td className="hidden px-3 py-1 text-right text-gray-500 xl:table-cell">{Math.max(0,p.qty_sold||0)}</td>
                                <td className="hidden px-3 py-1 xl:table-cell"><DualMoney usd={netRev} khr={0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                                <td className="hidden px-3 py-1 text-right xl:table-cell"><span className="text-xs font-medium text-orange-600 dark:text-orange-400">{fmtUSD(netCogs)}</span></td>
                                <td className="hidden px-3 py-1 xl:table-cell"><div className={`text-right text-xs font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(profit)}</div></td>
                                <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => openAdjust(p)} className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 hover:underline dark:text-blue-400 dark:hover:bg-blue-900/20">
                                    {t('adjust')}
                                  </button>
                                </td>
                              </tr>
                            )
                          }) : null}
                        </Fragment>
                      )
                    }) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

