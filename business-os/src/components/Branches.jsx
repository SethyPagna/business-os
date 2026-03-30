import { useState, useEffect } from 'react'
import { useApp } from '../AppContext'

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col fade-in">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  )
}

function BranchForm({ branch, onSave, onClose }) {
  const { t } = useApp()
  const [form, setForm] = useState({
    name: branch?.name || '',
    location: branch?.location || '',
    phone: branch?.phone || '',
    manager: branch?.manager || '',
    notes: branch?.notes || '',
    is_default: branch?.is_default || 0,
    is_active: branch?.is_active ?? 1,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
    onClose()
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Branch Name *</label>
        <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Store, Warehouse A" autoFocus />
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Location / Address</label>
        <input className="input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. 123 Main St, Phnom Penh" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Phone</label>
          <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="012 345 678" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Manager</label>
          <input className="input" value={form.manager} onChange={e => set('manager', e.target.value)} placeholder="Manager name" />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any notes..." />
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20">
          <input type="checkbox" checked={!!form.is_default} onChange={e => set('is_default', e.target.checked ? 1 : 0)} className="w-4 h-4" />
          <div>
            <div className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('set_default')}</div>
            <div className="text-xs text-gray-500">New sales and stock adjustments default to this branch</div>
          </div>
        </label>
        {branch && (
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-gray-200 dark:border-gray-600">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked ? 1 : 0)} className="w-4 h-4" />
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("active")}</div>
          </label>
        )}
      </div>
      <div className="flex gap-3 pt-2">
        <button className="btn-primary flex-1" onClick={handleSave} disabled={saving || !form.name.trim()}>
          {saving ? t('saving') : `💾 ${t('save_branch')}`}
        </button>
        <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
      </div>
    </div>
  )
}

function TransferModal({ branches, onClose, onDone, user, notify }) {
  const { t } = useApp()
  const [fromBranch, setFromBranch] = useState('')
  const [toBranch, setToBranch] = useState('')
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (fromBranch) {
      window.api.getBranchStock(parseInt(fromBranch)).then(setProducts)
    } else {
      setProducts([])
    }
    setSelectedProduct(null)
  }, [fromBranch])

  const filtered = products.filter(p => {
    if (!search.trim()) return p.branch_quantity > 0
    return p.name.toLowerCase().includes(search.toLowerCase()) ||
           (p.sku||'').toLowerCase().includes(search.toLowerCase())
  })

  const handleTransfer = async () => {
    if (!toBranch || !selectedProduct || !quantity) return
    if (parseInt(fromBranch) === parseInt(toBranch)) return notify('Source and destination cannot be the same', 'error')
    const qty = parseFloat(quantity)
    if (qty > selectedProduct.branch_quantity) return notify(`Only ${selectedProduct.branch_quantity} ${selectedProduct.unit} available`, 'error')
    setSaving(true)
    const res = await window.api.transferStock({
      fromBranchId: parseInt(fromBranch),
      toBranchId: parseInt(toBranch),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      quantity: qty,
      note,
      userId: user.id,
      userName: user.name,
    })
    setSaving(false)
    if (res.success) { notify(`Transferred ${qty} ${selectedProduct.unit} of "${selectedProduct.name}"`); onDone() }
    else notify(res.error || 'Transfer failed', 'error')
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col fade-in">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">🔄 {t('stock_transfer')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Branch selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1">📦 {t('from_branch')}</label>
              <select className="input" value={fromBranch} onChange={e => setFromBranch(e.target.value)}>
                <option value="">— Select source —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1">🏪 {t('to_branch')}</label>
              <select className="input" value={toBranch} onChange={e => setToBranch(e.target.value)}>
                <option value="">— Select destination —</option>
                {branches.filter(b => String(b.id) !== String(fromBranch)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {/* Product picker */}
          {fromBranch && (
            <div>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1">{t('select_product')}</label>
              <input className="input mb-2" placeholder="🔍 Search products..." value={search} onChange={e => setSearch(e.target.value)} />
              <div className="max-h-48 overflow-auto border border-gray-200 dark:border-gray-600 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.length === 0 && <p className="text-center py-6 text-gray-400 text-sm">{t('no_data')}</p>}
                {filtered.map(p => (
                  <button key={p.id} onClick={() => { setSelectedProduct(p); setQuantity('') }}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors ${selectedProduct?.id===p.id ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</span>
                      {p.sku && <span className="text-xs text-gray-400 ml-2 font-mono">{p.sku}</span>}
                    </div>
                    <span className={`text-sm font-bold ${p.branch_quantity > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {p.branch_quantity} {p.unit}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Qty + Note */}
          {selectedProduct && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">{selectedProduct.name}</span>
                <span className="text-sm text-gray-500">Available: <strong>{selectedProduct.branch_quantity} {selectedProduct.unit}</strong></span>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('quantity')}</label>
                <div className="flex gap-2 items-center">
                  <input className="input w-40" type="number" min="1" max={selectedProduct.branch_quantity} step="any"
                    value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" autoFocus />
                  <span className="text-sm text-gray-500">{selectedProduct.unit}</span>
                  <button className="btn-secondary text-xs px-2 py-1.5" onClick={() => setQuantity(String(selectedProduct.branch_quantity))}>All</button>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('transfer_note')} (optional)</label>
                <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Restocking branch 2" />
              </div>
            </div>
          )}
        </div>
        <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
          <button className="btn-primary flex-1" onClick={handleTransfer}
            disabled={saving || !fromBranch || !toBranch || !selectedProduct || !quantity}>
            {saving ? t('saving') : `🔄 ${t('stock_transfer')}`}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function Branches() {
  const { t, user, notify, fmtUSD } = useApp()
  const [branches, setBranches] = useState([])
  const [tab, setTab] = useState('branches')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [transfers, setTransfers] = useState([])
  const [branchStocks, setBranchStocks] = useState({}) // branchId -> stock[]
  const [expandedBranch, setExpandedBranch] = useState(null)

  const load = async () => {
    const [b, tr] = await Promise.all([window.api.getBranches(), window.api.getTransfers({})])
    setBranches(b); setTransfers(tr)
  }
  useEffect(() => { load() }, [])

  const loadBranchStock = async (branchId) => {
    if (branchStocks[branchId]) { setExpandedBranch(expandedBranch === branchId ? null : branchId); return }
    const stock = await window.api.getBranchStock(branchId)
    setBranchStocks(prev => ({ ...prev, [branchId]: stock }))
    setExpandedBranch(branchId)
  }

  const handleSaveBranch = async (form) => {
    if (selected) await window.api.updateBranch(selected.id, form)
    else await window.api.createBranch(form)
    notify(t(selected ? 'customer_updated' : 'customer_added'))
    load()
  }

  const handleDelete = async (b) => {
    if (!confirm(`Delete branch "${b.name}"?`)) return
    const res = await window.api.deleteBranch(b.id)
    if (res.success) { notify(t('customer_deleted')); load() }
    else notify(res.error, 'error')
  }

  const stockWithQty = (branchId) => (branchStocks[branchId] || []).filter(p => p.branch_quantity > 0)

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🏪 {t('branches')}</h1>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={() => setModal('transfer')}>🔄 {t('transfer_stock')}</button>
          <button className="btn-primary text-sm" onClick={() => { setSelected(null); setModal('form') }}>+ {t('add_branch')}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        {[['branches',`🏪 ${t('branches')}`],['transfers',`🔄 ${t('transfer_history')}`]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab===id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>{label}</button>
        ))}
      </div>

      {tab === 'branches' && (
        <div className="flex-1 overflow-auto space-y-3">
          {branches.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-5xl mb-3">🏪</div>
              <p>{t('no_data')}</p>
            </div>
          )}
          {branches.map(b => {
            const isExpanded = expandedBranch === b.id
            const stock = branchStocks[b.id] || []
            const inStock = stock.filter(p => p.branch_quantity > 0)
            const totalVal = inStock.reduce((s,p) => s + p.branch_quantity*(p.purchase_price_usd||0), 0)

            return (
              <div key={b.id} className="card overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-lg font-bold text-gray-900 dark:text-white">{b.name}</span>
                        {b.is_default ? <span className="badge-blue text-xs">{t('default_branch')}</span> : null}
                        {!b.is_active ? <span className="badge-red text-xs">{t('inactive')}</span> : <span className="badge-green text-xs">{t('active')}</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {b.location && <span>📍 {b.location}</span>}
                        {b.phone && <span>📞 {b.phone}</span>}
                        {b.manager && <span>👤 {b.manager}</span>}
                      </div>
                      {b.notes && <p className="text-xs text-gray-400 mt-1">{b.notes}</p>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => loadBranchStock(b.id)}
                        className="btn-secondary text-xs py-1 px-3">
                        {isExpanded ? '▲ ' + t('stock') : '📦 ' + t('stock')}
                      </button>
                      <button onClick={() => { setSelected(b); setModal('form') }} className="btn-secondary text-xs py-1 px-3">✏️ {t('edit')}</button>
                      {!b.is_default && <button onClick={() => handleDelete(b)} className="btn-danger text-xs py-1 px-3">🗑</button>}
                    </div>
                  </div>

                  {/* Inline stock summary */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          📦 {inStock.length} products in stock — Value: <span className="text-blue-600">{fmtUSD(totalVal)}</span>
                        </span>
                        <button onClick={() => { setModal('transfer'); }} className="text-xs text-blue-500 hover:underline">Transfer stock →</button>
                      </div>
                      {inStock.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">{t('no_data')}</p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                          {inStock.map(p => (
                            <div key={p.id} className={`rounded-lg p-2.5 border text-xs ${p.branch_quantity <= (p.low_stock_threshold||10) ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20' : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30'}`}>
                              <div className="font-medium text-gray-800 dark:text-gray-200 truncate mb-0.5">{p.name}</div>
                              <div className={`font-bold text-sm ${p.branch_quantity <= (p.out_of_stock_threshold||0) ? 'text-red-600' : p.branch_quantity <= (p.low_stock_threshold||10) ? 'text-yellow-600' : 'text-green-600'}`}>
                                {p.branch_quantity} {p.unit}
                              </div>
                              {p.sku && <div className="text-gray-400 font-mono truncate">{p.sku}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'transfers' && (
        <div className="card flex-1 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('product_name')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('from_branch')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('to_branch')}</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('quantity')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('transfer_note')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('user')}</th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0
                  ? <tr><td colSpan={7} className="text-center py-10 text-gray-400">{t('no_data')}</td></tr>
                  : transfers.map(t => (
                    <tr key={t.id} className="table-row">
                      <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200">{t.product_name}</td>
                      <td className="px-4 py-2.5"><span className="badge-red text-xs">{t.from_name || '—'}</span></td>
                      <td className="px-4 py-2.5"><span className="badge-green text-xs">{t.to_name}</span></td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-900 dark:text-white">{t.quantity}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{t.note || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{t.user_name}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{transfers.length} transfers</div>
        </div>
      )}

      {/* Modals */}
      {modal === 'form' && (
        <Modal title={selected ? `✏️ ${t('edit_branch')}: ${selected.name}` : `+ ${t('add_branch')}`} onClose={() => setModal(null)}>
          <BranchForm branch={selected} onSave={handleSaveBranch} onClose={() => setModal(null)} />
        </Modal>
      )}

      {modal === 'transfer' && (
        <TransferModal
          branches={branches.filter(b => b.is_active)}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); setBranchStocks({}) }}
          user={user}
          notify={notify}
        />
      )}
    </div>
  )
}
