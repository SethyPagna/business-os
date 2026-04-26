// ── BulkAddStockModal ────────────────────────────────────────────────────────
import { useState } from 'react'
import Modal from '../shared/Modal'

export default
function BulkAddStockModal({ productIds, products, branches, user, onClose, onDone, t }) {
  const [branchId, setBranchId] = useState(branches.find(b => b.is_default)?.id || branches[0]?.id || '')
  const [qty, setQty] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const selectedProducts = products.filter(p => productIds.includes(p.id))

  const handleSave = async () => {
    const amount = parseFloat(qty)
    if (!amount || amount <= 0) { setMsg('Enter a valid quantity'); return }
    setSaving(true); setMsg(null)
    let done = 0
    for (const p of selectedProducts) {
      try {
        await window.api.adjustStock({
          productId: p.id, productName: p.name, type: 'add', quantity: amount,
          branchId: branchId ? parseInt(branchId) : null,
          unitCostUsd: p.purchase_price_usd || 0,
          unitCostKhr: p.purchase_price_khr || 0,
          reason: 'Bulk add stock',
          userId: user?.id, userName: user?.name,
        })
        done++
      } catch {}
    }
    setSaving(false)
    if (done) onDone()
    else setMsg('Failed to add stock')
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 fade-in">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">📦 {t('add_stock_to_products')||`Add Stock to ${productIds.length} Products`}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('add_stock_desc')||'This will add the same quantity to each selected product.'}</p>
        <div className="space-y-4">
          {branches.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">🏪 Branch</label>
              <select className="input" value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">— Global (no branch) —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_default ? " (default)" : ""}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('quantity_to_add')||'Quantity to Add'}</label>
            <input className="input" type="number" min="1" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="e.g. 10" autoFocus />
          </div>
          {msg && <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
          <div className="flex gap-3">
            <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
              {saving ? (t('adding')||'Adding...') : `+ ${t('add_to_each') || `Add ${qty || 0} to each`}`}
            </button>
            <button className="btn-secondary" onClick={onClose}>{t("cancel")}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

