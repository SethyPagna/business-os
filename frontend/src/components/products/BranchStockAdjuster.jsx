import { useState } from 'react'

export default function BranchStockAdjuster({ product, branches, user, onDone, t }) {
  const [rows, setRows] = useState(
    branches.map((branch) => {
      const branchStock = (product.branch_stock || []).find((item) => item.branch_id === branch.id)
      return {
        branchId: branch.id,
        branchName: branch.name,
        current: branchStock?.quantity ?? 0,
        delta: '',
        type: 'add',
      }
    }),
  )
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const isKhmer = /[\u1780-\u17FF]/.test((typeof t === 'function' ? t('cancel') : '') || '')

  const T = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const setRow = (index, field, value) => {
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )))
  }

  const handleSave = async () => {
    const changes = rows.filter((row) => row.delta !== '' && parseFloat(row.delta) > 0)
    if (!changes.length) return

    setSaving(true)
    setMsg(null)
    try {
      for (const row of changes) {
        await window.api.adjustStock({
          productId: product.id,
          productName: product.name,
          type: row.type,
          quantity: parseFloat(row.delta),
          branchId: row.branchId,
          unitCostUsd: product.purchase_price_usd || 0,
          unitCostKhr: product.purchase_price_khr || 0,
          reason: `${T('adjust_stock', 'Adjust stock', 'កែសម្រួលស្តុក')} (${row.branchName})`,
          userId: user?.id,
          userName: user?.name,
        })
      }
      setMsg(T('stock_updated', 'Stock updated', 'ស្តុកត្រូវបានអាប់ដេត'))
      setRows((current) => current.map((row) => ({ ...row, delta: '' })))
      onDone()
    } catch (error) {
      setMsg(error?.message || T('unknown_error', 'Unknown error', 'មានកំហុសមិនស្គាល់'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {T('stock_by_branch', 'Stock by Branch', 'ស្តុកតាមសាខា')}
      </label>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.branchId} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/50">
            <span className="w-28 truncate text-sm text-gray-700 dark:text-gray-300">{row.branchName}</span>
            <span className={`w-16 text-right text-sm font-bold ${row.current > 0 ? 'text-green-600' : 'text-gray-400'}`}>
              {row.current} {product.unit}
            </span>
            <select
              className="input w-24 flex-shrink-0 py-1 text-xs"
              value={row.type}
              onChange={(event) => setRow(index, 'type', event.target.value)}
            >
              <option value="add">+ {T('add', 'Add', 'បន្ថែម')}</option>
              <option value="remove">- {T('remove', 'Remove', 'ដក')}</option>
            </select>
            <input
              className="input w-20 flex-shrink-0 py-1 text-xs"
              type="number"
              min="0"
              placeholder={T('qty_short', 'Qty', 'ចំនួន')}
              value={row.delta}
              onChange={(event) => setRow(index, 'delta', event.target.value)}
            />
          </div>
        ))}
      </div>
      {msg ? <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{msg}</p> : null}
      {rows.some((row) => row.delta !== '' && parseFloat(row.delta) > 0) ? (
        <button
          className="btn-primary mt-2 w-full text-sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? T('loading', 'Loading...', 'កំពុងផ្ទុក...') : T('apply_stock_changes', 'Apply Stock Changes', 'អនុវត្តការផ្លាស់ប្តូរស្តុក')}
        </button>
      ) : null}
    </div>
  )
}
