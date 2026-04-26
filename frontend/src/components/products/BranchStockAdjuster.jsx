// ── BranchStockAdjuster ──────────────────────────────────────────────────────
// Inline per-branch stock adjuster shown inside the product edit form.
import { useState, useEffect } from 'react'

export default
function BranchStockAdjuster({ product, branches, user, onDone }) {
  const [rows, setRows] = useState(
    branches.map(b => {
      const bs = (product.branch_stock || []).find(s => s.branch_id === b.id)
      return { branchId: b.id, branchName: b.name, current: bs?.quantity ?? 0, delta: '', type: 'add' }
    })
  )
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState(null)

  const setRow = (idx, field, val) =>
    setRows(r => r.map((row, i) => i === idx ? { ...row, [field]: val } : row))

  const handleSave = async () => {
    const changes = rows.filter(r => r.delta !== '' && parseFloat(r.delta) > 0)
    if (!changes.length) return
    setSaving(true); setMsg(null)
    try {
      for (const r of changes) {
        await window.api.adjustStock({
          productId:   product.id,
          productName: product.name,
          type:        r.type,
          quantity:    parseFloat(r.delta),
          branchId:    r.branchId,
          unitCostUsd: product.purchase_price_usd || 0,
          unitCostKhr: product.purchase_price_khr || 0,
          reason:      `Manual adjustment (branch: ${r.branchName})`,
          userId:      user?.id,
          userName:    user?.name,
        })
      }
      setMsg('✅ Stock updated')
      setRows(prev => prev.map(r => ({ ...r, delta: '' })))
      onDone()
    } catch (e) {
      setMsg('❌ ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">📦 Stock by Branch</label>
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={row.branchId} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <span className="text-sm text-gray-700 dark:text-gray-300 w-28 truncate">🏪 {row.branchName}</span>
            <span className={`text-sm font-bold w-16 text-right ${row.current > 0 ? 'text-green-600' : 'text-gray-400'}`}>
              {row.current} {product.unit}
            </span>
            <select
              className="input text-xs py-1 w-24 flex-shrink-0"
              value={row.type}
              onChange={e => setRow(idx, 'type', e.target.value)}
            >
              <option value="add">+ Add</option>
              <option value="remove">− Remove</option>
            </select>
            <input
              className="input text-xs py-1 w-20 flex-shrink-0"
              type="number"
              min="0"
              placeholder="Qty"
              value={row.delta}
              onChange={e => setRow(idx, 'delta', e.target.value)}
            />
          </div>
        ))}
      </div>
      {msg && <p className="text-xs mt-1 text-gray-600 dark:text-gray-400">{msg}</p>}
      {rows.some(r => r.delta !== '' && parseFloat(r.delta) > 0) && (
        <button
          className="btn-primary text-sm mt-2 w-full"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : '💾 Apply Stock Changes'}
        </button>
      )}
    </div>
  )
}

