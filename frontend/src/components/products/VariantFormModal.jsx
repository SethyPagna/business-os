// ── VariantFormModal ─────────────────────────────────────────────────────────
import { useState } from 'react'
import { useApp } from '../../AppContext'
import Modal from '../shared/Modal'
import { parseNumericInput, sanitizeNumericInput } from './primitives'

export default
function VariantFormModal({ parent, categories, units, branches, user, onClose, onDone, t, usdSymbol, khrSymbol, exchangeRate }) {
  const [form, setForm] = useState({
    name: parent.name + ' (Variant)',
    sku: '', barcode: '', description: '', supplier: parent.supplier || '',
    purchase_price_usd: parent.purchase_price_usd || 0,
    purchase_price_khr: parent.purchase_price_khr || 0,
    selling_price_usd: parent.selling_price_usd || 0,
    selling_price_khr: parent.selling_price_khr || 0,
    stock_quantity: 0, branch_id: branches.find(b => b.is_default)?.id || '',
    unit: parent.unit || 'pcs', category: parent.category || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setNumeric = (k, v) => set(k, sanitizeNumericInput(v))
  const { notify } = useApp()

  const handleSave = async () => {
    if (!form.name.trim()) { setErr('Name required'); return }
    setSaving(true); setErr('')
    try {
      const res = await window.api.createProductVariant({
        ...form,
        parent_id: parent.id,
        purchase_price_usd: parseNumericInput(form.purchase_price_usd),
        purchase_price_khr: parseNumericInput(form.purchase_price_khr),
        selling_price_usd: parseNumericInput(form.selling_price_usd),
        selling_price_khr: parseNumericInput(form.selling_price_khr),
        stock_quantity: parseNumericInput(form.stock_quantity),
        cost_price_usd: parseNumericInput(form.purchase_price_usd),
        cost_price_khr: parseNumericInput(form.purchase_price_khr),
        userId: user?.id, userName: user?.name,
      })
      if (res?.success === false) { setErr(res.error || 'Failed'); setSaving(false); return }
      notify(`Variant "${form.name}" added to ${parent.name}`)
      onDone()
    } catch(e) { setErr(e.message || 'Failed'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col fade-in">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">➕ {t('add_variant_to')||'Add Variant to:'} <span className="text-blue-600">{parent.name}</span></h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">×</button>
        </div>
        <div className="modal-scroll p-5 space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300">
            Variants of the same product group can have different prices, barcodes, and suppliers.
          </div>
          {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{err}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Variant Name *</label>
              <input className="input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Product A - Blue, 500ml, Size L..." />
            </div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SKU</label><input className="input" value={form.sku} onChange={e => set("sku", e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Barcode</label><input className="input" value={form.barcode} onChange={e => set("barcode", e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Supplier</label><input className="input" value={form.supplier} onChange={e => set("supplier", e.target.value)} /></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unit</label>
              <select className="input" value={form.unit} onChange={e => set("unit", e.target.value)}>
                {units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase Price ({usdSymbol})</label>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.purchase_price_usd ?? ''}
                onChange={e => setNumeric("purchase_price_usd", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Selling Price ({usdSymbol})</label>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.selling_price_usd ?? ''}
                onChange={e => setNumeric("selling_price_usd", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Initial Stock</label>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.stock_quantity ?? ''}
                onChange={e => setNumeric("stock_quantity", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">🏪 Assign to Branch</label>
              <select className="input" value={form.branch_id||''} onChange={e => set("branch_id", e.target.value)}>
                <option value="">— Default branch —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_default?" (default)":""}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
          <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? (t('saving')||'Saving...') : `✅ ${t('add_variant')||'Add Variant'}`}
          </button>
          <button className="btn-secondary" onClick={onClose}>{t("cancel")}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Product Form ──────────────────────────────────────────────────────────────
// ─── BranchStockAdjuster — inline per-branch adjust inside product edit ───────
