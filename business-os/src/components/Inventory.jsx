import { useState, useEffect } from 'react'
import { useApp } from '../AppContext'

function multiMatch(text, terms) {
  return terms.every(term => text.toLowerCase().includes(term.toLowerCase()))
}

function DualMoney({ usd, khr, fmtUSD, fmtKHR, greenRed }) {
  const cls = greenRed ? (usd >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-800 dark:text-gray-200'
  return (
    <div className="text-right">
      <div className={`font-medium ${cls}`}>{fmtUSD(usd)}</div>
      {khr > 0 && <div className="text-xs text-gray-400">{fmtKHR(khr)}</div>}
    </div>
  )
}

export default function Inventory() {
  const { t, user, notify, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useApp()
  const [summary, setSummary]         = useState([])
  const [movements, setMovements]     = useState([])
  const [branches, setBranches]       = useState([])
  const [branchFilter, setBranchFilter] = useState('all')   // 'all' or branch id
  const [adjustModal, setAdjustModal] = useState(null)
  const [adjustForm, setAdjustForm]   = useState({ type:'add', quantity:1, unit_cost_usd:0, unit_cost_khr:0, reason:'', branch_id:'' })
  const [search, setSearch]           = useState('')
  const [stockFilter, setStockFilter] = useState('all')
  const [tab, setTab]                 = useState('products')
  const [movFilter, setMovFilter]     = useState('all')

  const load = async () => {
    const opts = branchFilter !== 'all' ? { branchId: parseInt(branchFilter) } : {}
    const [sum, movs, brs] = await Promise.all([
      window.api.getInventorySummary(opts),
      window.api.getInventoryMovements(branchFilter !== 'all' ? { branchId: parseInt(branchFilter) } : {}),
      window.api.getBranches()
    ])
    setSummary(sum); setMovements(movs); setBranches(brs.filter(b => b.is_active))
  }
  useEffect(() => { load() }, [branchFilter])

  const handleAdjust = async () => {
    const qty = parseFloat(adjustForm.quantity)
    if (!qty || qty <= 0) return notify('Invalid quantity', 'error')
    const usdCost = parseFloat(adjustForm.unit_cost_usd) || 0
    const khrCost = parseFloat(adjustForm.unit_cost_khr) || (usdCost * exchangeRate)
    const branchId = adjustForm.branch_id ? parseInt(adjustForm.branch_id) : null
    await window.api.adjustStock({
      productId: adjustModal.id, productName: adjustModal.name,
      type: adjustForm.type, quantity: qty,
      unitCostUsd: usdCost, unitCostKhr: khrCost,
      reason: adjustForm.reason, branchId,
      userId: user.id, userName: user.name
    })
    notify('Stock adjusted'); setAdjustModal(null); load()
  }

  const getStockStatus = (p) => {
    const qty = p.display_quantity ?? p.stock_quantity
    if (qty <= (p.out_of_stock_threshold || 0)) return { label: t('out_of_stock'), cls: 'badge-red' }
    if (qty <= (p.low_stock_threshold || 10))   return { label: t('low_stock'),    cls: 'badge-yellow' }
    return { label: t('in_stock'), cls: 'badge-green' }
  }

  const searchTerms = search.trim().split(/\s+/).filter(Boolean)

  const filteredSummary = summary.filter(p => {
    const haystack = `${p.name} ${p.category||''} ${p.supplier||''} ${p.sku||''}`
    const matchS = searchTerms.length === 0 || multiMatch(haystack, searchTerms)
    const qty = p.display_quantity ?? p.stock_quantity
    if (stockFilter === 'low') return matchS && qty <= p.low_stock_threshold && qty > (p.out_of_stock_threshold||0)
    if (stockFilter === 'out') return matchS && qty <= (p.out_of_stock_threshold||0)
    return matchS
  })

  const filteredMovements = movements.filter(m => {
    const matchType = movFilter === 'all' || m.movement_type === movFilter
    const haystack = `${m.product_name||''} ${m.reason||''} ${m.user_name||''} ${m.branch_name||''}`
    return matchType && (searchTerms.length === 0 || multiMatch(haystack, searchTerms))
  })

  // Stat totals
  const totalValUsd  = filteredSummary.reduce((s,p) => s + (p.stock_value_usd||0), 0)
  const totalValKhr  = filteredSummary.reduce((s,p) => s + (p.stock_value_khr||0), 0)
  const totalRevenue = filteredSummary.reduce((s,p) => s + (p.revenue_usd||0), 0)
  const totalRevK    = filteredSummary.reduce((s,p) => s + (p.revenue_khr||0), 0)
  // Cost In (Purchase) = Cost of Goods Sold (COGS) — purchase cost recorded at time of sale
  const totalCostInUsd = filteredSummary.reduce((s,p) => s + (p.cogs_usd || 0), 0)
  const totalCostInKhr = filteredSummary.reduce((s,p) => s + (p.cogs_khr || 0), 0)
  const lowCount     = summary.filter(p => { const q=p.display_quantity??p.stock_quantity; return q <= p.low_stock_threshold && q > (p.out_of_stock_threshold||0) }).length
  const outCount     = summary.filter(p => { const q=p.display_quantity??p.stock_quantity; return q <= (p.out_of_stock_threshold||0) }).length

  const movTypeBadge = { purchase:'badge-green', sale:'badge-blue', adjustment:'badge-yellow' }
  const movTypeIcon  = { purchase:'📦', sale:'💰', adjustment:'🔧' }

  const defaultBranchId = branches.find(b => b.is_default)?.id

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🏭 {t('inventory')}</h1>
        {/* Branch filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">Branch:</span>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setBranchFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${branchFilter==='all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'}`}>
              🌐 All
            </button>
            {branches.map(b => (
              <button key={b.id} onClick={() => setBranchFilter(String(b.id))} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${branchFilter===String(b.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'}`}>
                🏪 {b.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-sm font-bold text-blue-600">{fmtUSD(totalValUsd)}</div>
          <div className="text-xs text-gray-400">{fmtKHR(totalValKhr)}</div>
          <div className="text-xs text-gray-500 mt-0.5">📦 {t('inventory_value')}</div>
        </div>
        <div className="card p-3 border-l-4 border-red-400">
          <div className="text-sm font-bold text-red-600">{fmtUSD(totalCostInUsd)}</div>
          <div className="text-xs text-gray-400">{fmtKHR(totalCostInKhr)}</div>
          <div className="text-xs text-gray-500 mt-0.5">🛒 Cost In (Purchase)</div>
        </div>
        <div className="card p-3">
          <div className="text-sm font-bold text-green-600">{fmtUSD(totalRevenue)}</div>
          <div className="text-xs text-gray-400">{fmtKHR(totalRevK)}</div>
          <div className="text-xs text-gray-500 mt-0.5">💰 {t('cost_out')}</div>
        </div>
        <div className="card p-3">
          <div className="text-lg font-bold text-yellow-600">{lowCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">⚠️ {t('low_stock')}</div>
        </div>
        <div className="card p-3">
          <div className="text-lg font-bold text-red-700">{outCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">🔴 {t('out_of_stock')}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        {[['products',`📦 ${t('products')}`],['movements',`📋 ${t('stock_movements')}`]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab===id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>{label}</button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex gap-3 mb-3 flex-wrap items-center">
        <input className="input max-w-xs" placeholder={`🔍 ${t('search')}...`} value={search} onChange={e => setSearch(e.target.value)} />
        {tab === 'products' && (
          <div className="flex gap-1">
            {[['all',t('all')],['low',`⚠ ${t('low_stock')}`],['out',`🔴 ${t('out_of_stock')}`]].map(([f,l]) => (
              <button key={f} onClick={() => setStockFilter(f)} className={`px-3 py-2 rounded-lg text-xs font-medium ${stockFilter===f ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{l}</button>
            ))}
          </div>
        )}
        {tab === 'movements' && (
          <div className="flex gap-1">
            {[['all',t('all')],['purchase',`📦 ${t('purchase')}`],['sale',`💰 ${t('sale')}`],['adjustment',`🔧 ${t('adjustment')}`]].map(([f,l]) => (
              <button key={f} onClick={() => setMovFilter(f)} className={`px-3 py-2 rounded-lg text-xs font-medium ${movFilter===f ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{l}</button>
            ))}
          </div>
        )}
        {branchFilter !== 'all' && (
          <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded-lg">
            🏪 Showing: {branches.find(b=>String(b.id)===branchFilter)?.name}
          </span>
        )}
      </div>

      {/* Products table */}
      {tab === 'products' && (
        <div className="card flex-1 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('product_name')}</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {branchFilter !== 'all' ? `📦 ${branches.find(b=>String(b.id)===branchFilter)?.name} Stock` : t('current_stock')}
                  </th>
                  {branchFilter === 'all' && branches.length > 1 && (
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">Branch Stock</th>
                  )}
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">🛒 Cost In (Purchase)</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">💵 {t('selling_price')}</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('stock_value')}</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('qty_sold')}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('adjust_stock')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummary.length === 0
                  ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">{t('no_data')}</td></tr>
                  : filteredSummary.map(p => {
                    const displayQty = p.display_quantity ?? p.stock_quantity
                    const status = getStockStatus(p)
                    const branchStockList = p.branch_stock || []

                    return (
                      <tr key={p.id} className="table-row">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                          {p.sku && <div className="text-xs text-gray-400 font-mono">{p.sku}</div>}
                          {p.category && <div className="text-xs text-gray-400">{p.category}</div>}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white whitespace-nowrap">
                          {displayQty} <span className="text-xs font-normal text-gray-400">{p.unit}</span>
                        </td>
                        {branchFilter === 'all' && branches.length > 1 && (
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {branchStockList.length === 0
                                ? <span className="text-xs text-gray-400">—</span>
                                : branchStockList.map(bs => (
                                  <span key={bs.branch_id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${bs.quantity > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                                    {bs.branch_name}: {bs.quantity}
                                  </span>
                                ))
                              }
                            </div>
                          </td>
                        )}
                        <td className="px-3 py-2 text-center"><span className={status.cls}>{status.label}</span></td>
                        <td className="px-3 py-2">
                          <DualMoney usd={p.purchase_price_usd||p.cost_price_usd||0} khr={p.purchase_price_khr||p.cost_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                        </td>
                        <td className="px-3 py-2">
                          <DualMoney usd={p.selling_price_usd||0} khr={p.selling_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                        </td>
                        <td className="px-3 py-2">
                          <DualMoney usd={p.stock_value_usd||0} khr={p.stock_value_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{p.qty_sold || 0}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => {
                            setAdjustModal(p)
                            setAdjustForm({
                              type:'add', quantity:1,
                              unit_cost_usd: p.purchase_price_usd||p.cost_price_usd||0,
                              unit_cost_khr: p.purchase_price_khr||p.cost_price_khr||0,
                              reason:'',
                              branch_id: branchFilter !== 'all' ? branchFilter : (defaultBranchId ? String(defaultBranchId) : '')
                            })
                          }} className="btn-secondary text-xs py-1 px-2">{t('adjust_stock')}</button>
                        </td>
                      </tr>
                    )
                  })
                }
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{filteredSummary.length} {t('products')}</div>
        </div>
      )}

      {/* Movements table */}
      {tab === 'movements' && (
        <div className="card flex-1 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('product_name')}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('movement_type')}</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">Branch</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('quantity')}</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('unit_cost')}</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">Total</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('reason')}</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-400">{t('user')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovements.length === 0
                  ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">{t('no_data')}</td></tr>
                  : filteredMovements.map(m => (
                    <tr key={m.id} className="table-row">
                      <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{m.product_name}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={movTypeBadge[m.movement_type]||'badge-blue'}>{movTypeIcon[m.movement_type]} {t(m.movement_type)}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{m.branch_name || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">{m.quantity}</td>
                      <td className="px-3 py-2">
                        <DualMoney usd={m.unit_cost_usd||0} khr={m.unit_cost_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                      </td>
                      <td className="px-3 py-2">
                        <div className={`text-right font-semibold ${m.movement_type==='sale' ? 'text-green-600' : m.movement_type==='purchase' ? 'text-red-600' : 'text-gray-600'}`}>
                          {fmtUSD(m.total_cost_usd||0)}
                          {(m.total_cost_khr||0) > 0 && <div className="text-xs font-normal text-gray-400">{fmtKHR(m.total_cost_khr)}</div>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{m.reason||'—'}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{m.user_name}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{filteredMovements.length} movements</div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {adjustModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 fade-in">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('adjust_stock')}</h2>
            <p className="text-sm text-gray-500 mb-4">{adjustModal.name} — {t('current_stock')}: <strong>{adjustModal.stock_quantity} {adjustModal.unit}</strong></p>

            <div className="space-y-4">
              {/* Branch selector */}
              {branches.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">🏪 Apply to Branch</label>
                  <select className="input" value={adjustForm.branch_id} onChange={e => setAdjustForm(f=>({...f,branch_id:e.target.value}))}>
                    <option value="">— Global (no branch) —</option>
                    {branches.map(b => {
                      const bs = (adjustModal.branch_stock||[]).find(s => s.branch_id === b.id)
                      return <option key={b.id} value={b.id}>{b.name} — {bs?.quantity ?? 0} {adjustModal.unit} in stock{b.is_default?' (default)':''}</option>
                    })}
                  </select>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">{t('type')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setAdjustForm(f=>({...f,type:'add'}))} className={`py-2 rounded-lg font-medium text-sm ${adjustForm.type==='add' ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>+ {t('add_stock')}</button>
                  <button onClick={() => setAdjustForm(f=>({...f,type:'remove'}))} className={`py-2 rounded-lg font-medium text-sm ${adjustForm.type==='remove' ? 'bg-red-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>− {t('remove_stock')}</button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('quantity')}</label>
                <input className="input" type="number" step="any" min="0" value={adjustForm.quantity} onChange={e=>setAdjustForm(f=>({...f,quantity:e.target.value}))} />
              </div>

              {adjustForm.type === 'add' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">🛒 Cost In (Purchase per unit)</label>
                  <p className="text-xs text-gray-400 mb-2">Pre-filled from product cost in price — update if price changed</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{usdSymbol}</span>
                      <input className="input pl-7" type="number" step="any" value={adjustForm.unit_cost_usd}
                        onChange={e=>{const v=parseFloat(e.target.value)||0; setAdjustForm(f=>({...f,unit_cost_usd:v,unit_cost_khr:v*exchangeRate}))}} />
                    </div>
                    <div className="relative">
                      <input className="input pr-7" type="number" step="any" value={Number(adjustForm.unit_cost_khr).toFixed(0)}
                        onChange={e=>{const v=parseFloat(e.target.value)||0; setAdjustForm(f=>({...f,unit_cost_khr:v,unit_cost_usd:v/exchangeRate}))}} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{khrSymbol}</span>
                    </div>
                  </div>
                  {adjustForm.unit_cost_usd > 0 && (
                    <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-400">
                      Total: <strong>{fmtUSD((adjustForm.unit_cost_usd||0)*(adjustForm.quantity||0))}</strong> / {fmtKHR((adjustForm.unit_cost_khr||0)*(adjustForm.quantity||0))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('reason')}</label>
                <input className="input" placeholder={adjustForm.type==='add' ? 'e.g. Received from supplier' : 'e.g. Damaged, returned...'} value={adjustForm.reason} onChange={e=>setAdjustForm(f=>({...f,reason:e.target.value}))} />
              </div>

              <div className="flex gap-3">
                <button className="btn-primary flex-1" onClick={handleAdjust}>{t('confirm')}</button>
                <button className="btn-secondary" onClick={()=>setAdjustModal(null)}>{t('cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
