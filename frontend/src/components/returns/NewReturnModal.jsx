// ── NewReturnModal ───────────────────────────────────────────────────────────
import { useState } from 'react'
import { useApp } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'

export default
function NewReturnModal({ onClose, onSuccess, fmtUSD, notify }) {
  const { user, t } = useApp()
  const T = (k, fb) => (typeof t === 'function' ? t(k) : fb)

  const RETURN_REASONS = [
    T('reason_defective',   'Defective / damaged product'),
    T('reason_wrong_item',  'Wrong item delivered'),
    T('reason_changed_mind','Customer changed mind'),
    T('reason_not_described','Product not as described'),
    T('reason_duplicate',   'Duplicate order'),
    T('reason_expired',     'Expired product'),
    T('reason_quality',     'Quality issue'),
    T('reason_other',       'Other'),
  ]
  const OTHER_LABEL = T('reason_other', 'Other')

  const [step,          setStep]          = useState('search')
  const [searchQuery,   setSearchQuery]   = useState('')
  const [foundSale,     setFoundSale]     = useState(null)
  const [searching,     setSearching]     = useState(false)
  const [selectedItems, setSelectedItems] = useState([])
  const [reason,        setReason]        = useState(RETURN_REASONS[0])
  const [customReason,  setCustomReason]  = useState('')
  const [returnType,    setReturnType]    = useState('restock')
  const [notes,         setNotes]         = useState('')
  const [submitting,    setSubmitting]    = useState(false)

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const sales = await window.api.getSales({ limit: 500 })
      const q = searchQuery.trim().toLowerCase()
      const found = sales.find(s =>
        s.receipt_number?.toLowerCase().includes(q) || String(s.id) === q
      )
      if (found) {
        setFoundSale(found)
        const items = Array.isArray(found.items) ? found.items : []
        let alreadyReturned = {}
        try {
          const existingReturns = await window.api.getReturns({ saleId: found.id }).catch(() => [])
          ;(existingReturns || []).forEach(ret => {
            if ((ret.status || 'completed') === 'cancelled') return
            ;(ret.items || []).forEach(ri => {
              const key = ri.sale_item_id || `p_${ri.product_id}`
              alreadyReturned[key] = (alreadyReturned[key] || 0) + (ri.quantity || 0)
            })
          })
        } catch (_) {}
        setSelectedItems(items.map(item => {
          const key = item.id || `p_${item.product_id}`
          const alreadyQty = alreadyReturned[key] || 0
          const remaining  = Math.max(0, (item.quantity || 0) - alreadyQty)
          return { ...item, alreadyQty, remaining, returnQty: 0, included: remaining > 0, return_to_stock: true }
        }))
        setStep('items')
      } else {
        notify(T('sale_not_found', 'Sale not found. Try the receipt number or sale ID.'), 'error')
      }
    } catch (e) {
      notify((T('search_error','Search error') || T('error','Error')) + ': ' + (e.message || e), 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleReturnTypeChange = (v) => {
    setReturnType(v)
    setSelectedItems(prev => prev.map(it => ({ ...it, return_to_stock: v === 'restock' })))
  }

  const toggleIncluded = (idx) => {
    setSelectedItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const nowIncluded = !it.included
      return { ...it, included: nowIncluded, returnQty: nowIncluded ? (it.remaining || 0) : 0 }
    }))
  }

  const updateItemQty = (idx, val) => {
    const max = selectedItems[idx]?.remaining ?? selectedItems[idx]?.quantity ?? Infinity
    const qty = Math.max(0, Math.min(max, parseFloat(val) || 0))
    setSelectedItems(prev => prev.map((it, i) =>
      i === idx ? { ...it, returnQty: qty, included: qty > 0 } : it
    ))
  }

  const updateItemRestock = (idx, val) => {
    setSelectedItems(prev => prev.map((it, i) => i === idx ? { ...it, return_to_stock: !!val } : it))
  }

  const selectAll = () => setSelectedItems(prev => prev.map(it =>
    it.remaining > 0 ? { ...it, included: true, returnQty: it.remaining, return_to_stock: returnType === 'restock' } : it
  ))
  const clearAll  = () => setSelectedItems(prev => prev.map(it => ({ ...it, included: false, returnQty: 0 })))

  const activeItems    = selectedItems.filter(it => it.included && (it.returnQty || 0) > 0)
  const totalRefund    = activeItems.reduce((s, it) => s + (it.applied_price_usd || 0) * it.returnQty, 0)
  const totalRefundKhr = activeItems.reduce((s, it) => s + (it.applied_price_khr || 0) * it.returnQty, 0)
  const finalReason    = reason === OTHER_LABEL ? customReason.trim() : reason

  const handleSubmit = async () => {
    if (!activeItems.length) { notify(T('select_items_to_return','Select at least one item to return.'), 'error'); return }
    if (!finalReason) { notify(T('return_reason','Please provide a return reason.'), 'error'); return }
    setSubmitting(true)
    try {
      await window.api.createReturn({
        sale_id:          foundSale?.id   || null,
        receipt_number:   foundSale?.receipt_number || null,
        cashier_id:       user?.id,
        cashier_name:     user?.name || user?.username,
        customer_name:    foundSale?.customer_name || null,
        branch_id:        foundSale?.branch_id || null,
        reason:           finalReason,
        return_type:      returnType,
        notes:            notes || null,
        total_refund_usd: totalRefund,
        total_refund_khr: totalRefundKhr,
        exchange_rate:    foundSale?.exchange_rate || 4100,
        items: activeItems.map(it => ({
          sale_item_id:      it.id || null,
          product_id:        it.product_id,
          product_name:      it.product_name || it.name,
          quantity:          it.returnQty,
          applied_price_usd: it.applied_price_usd || 0,
          applied_price_khr: it.applied_price_khr || 0,
          cost_price_usd:    it.cost_price_usd || 0,
          cost_price_khr:    it.cost_price_khr || it.purchase_price_khr || 0,
          return_to_stock:   it.return_to_stock !== false,
          branch_id:         it.branch_id || foundSale?.branch_id || null,
        })),
      })
      notify(T('sale_complete','Return processed successfully'))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      onSuccess()
      onClose()
    } catch (e) {
      notify((T('error','Error') || 'Error') + ': ' + (e.message || e), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const STEPS = ['search', 'items', 'confirm']
  const stepIdx = STEPS.indexOf(step)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">↩️ {T('new_return','New Return')}</h2>
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold transition-colors
                  ${i === stepIdx ? 'bg-blue-600 text-white' : i < stepIdx ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}`}>
                  {i < stepIdx ? '✓' : i + 1}
                </div>
                {i < STEPS.length - 1 && <span className="text-gray-300 dark:text-gray-600 text-xs">→</span>}
              </div>
            ))}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center ml-2">×</button>
          </div>
        </div>

        <div className="modal-scroll p-4 space-y-4">

          {/* Step 1 — Find Sale */}
          {step === 'search' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
                {T('search_receipt_hint','Enter a receipt number or sale ID. You can also skip and do a manual return.')}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                  {T('search_receipt_or_id','Receipt Number or Sale ID')}
                </label>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder={T('search_receipt_or_id','e.g. RCP-1234567-ABCD')}
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()} autoFocus />
                  <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
                    className="btn-primary px-4 disabled:opacity-50">
                    {searching ? '⏳' : T('btn_search','🔍 Find')}
                  </button>
                </div>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <button onClick={() => { setFoundSale(null); setSelectedItems([]); setStep('items') }}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                  {T('btn_manual_return','→ Skip — manual return (no sale linked)')}
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Select Items */}
          {step === 'items' && (
            <div className="space-y-4">
              {foundSale ? (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
                  <div className="font-semibold text-green-700 dark:text-green-400 text-sm">✅ {foundSale.receipt_number}</div>
                  <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                    {fmtTime(foundSale.created_at)} · {foundSale.customer_name || T('no_data','—')} · {fmtUSD(foundSale.total_usd || 0)}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-sm text-gray-500">
                  {T('manual_return','Manual return')} — {T('no_data','not linked to a sale')}.
                </div>
              )}

              {/* Return type */}
              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                  {T('return_type_label','Handling Method')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['restock',  T('return_type_restock','↩️ Restock'),       T('return_type_restock_desc','Items back to inventory')],
                    ['writeoff', T('return_type_writeoff','🗑 Write Off'),     T('return_type_writeoff_desc','Lost / damaged goods')],
                    ['refund',   T('return_type_refund','💰 Refund Only'),     T('return_type_refund_desc','Refund with no stock change')],
                  ].map(([v, label, desc]) => (
                    <button key={v} onClick={() => handleReturnTypeChange(v)}
                      className={`p-2 rounded-xl border-2 text-left text-xs transition-colors ${returnType === v ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                      <div className={`font-semibold ${returnType === v ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{label}</div>
                      <div className="text-gray-400 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Items list */}
              {selectedItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {T('select_items_to_return','Select items to return')}
                    </label>
                    <div className="flex gap-2 text-xs">
                      <button onClick={selectAll} className="text-blue-600 hover:underline">{T('select_all','Select All')}</button>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <button onClick={clearAll} className="text-red-500 hover:underline">{T('deselect_all','Clear')}</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {selectedItems.map((item, idx) => {
                      const isFullyReturned = (item.remaining ?? item.quantity) <= 0
                      const isIncluded = item.included && !isFullyReturned
                      return (
                        <div key={idx} className={`border rounded-xl p-3 transition-colors ${
                          isFullyReturned
                            ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 opacity-60'
                            : isIncluded
                              ? 'border-blue-400 dark:border-blue-600 bg-blue-50/60 dark:bg-blue-900/15'
                              : 'border-gray-200 dark:border-gray-700'
                        }`}>
                          <div className="flex items-start gap-3">
                            <button
                              disabled={isFullyReturned}
                              onClick={() => !isFullyReturned && toggleIncluded(idx)}
                              className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                                isFullyReturned
                                  ? 'border-gray-300 dark:border-gray-600 cursor-not-allowed'
                                  : isIncluded
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'border-gray-400 dark:border-gray-500 hover:border-blue-500'
                              }`}>
                              {isIncluded && <span className="text-[10px] font-bold leading-none">✓</span>}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                {item.product_name || item.name}
                              </div>
                              <div className="text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                <span>{T('qty_sold','Sold')}: {item.quantity} × {fmtUSD(item.applied_price_usd || 0)}</span>
                                {(item.alreadyQty || 0) > 0 && (
                                  <span className="text-orange-500 dark:text-orange-400">
                                    ↩ {item.alreadyQty} {T('already_returned','already returned')}
                                  </span>
                                )}
                                {isFullyReturned && (
                                  <span className="text-gray-400 font-medium">— {T('restocked','fully returned')}</span>
                                )}
                              </div>
                            </div>
                            {!isFullyReturned && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => updateItemQty(idx, Math.max(0, (item.returnQty||0) - 1))}
                                  className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold">−</button>
                                <input type="number" min="0" max={item.remaining ?? item.quantity} step="1"
                                  className="input w-14 text-center text-sm py-1"
                                  value={item.returnQty || 0}
                                  onChange={e => updateItemQty(idx, e.target.value)} />
                                <button onClick={() => updateItemQty(idx, Math.min(item.remaining ?? item.quantity, (item.returnQty||0) + 1))}
                                  className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-bold">+</button>
                                <span className="text-[10px] text-gray-400 ml-1 w-12 text-left">
                                  / {item.remaining ?? item.quantity}
                                </span>
                              </div>
                            )}
                          </div>
                          {isIncluded && (
                            <div className="mt-2 pl-8 flex items-center justify-between">
                              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                <input type="checkbox"
                                  checked={item.return_to_stock !== false}
                                  onChange={e => updateItemRestock(idx, e.target.checked)}
                                  className="rounded accent-blue-600" />
                                <span className="text-gray-600 dark:text-gray-400">{T('return_type_restock','Return to stock')}</span>
                                {item.return_to_stock === false && (
                                  <span className="text-orange-500 dark:text-orange-400 text-[10px]">({T('return_type_writeoff','write-off')})</span>
                                )}
                              </label>
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                                {fmtUSD((item.applied_price_usd || 0) * (item.returnQty || 0))}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {activeItems.length > 0 && (
                    <div className="mt-2 flex justify-between text-sm font-semibold text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 border border-blue-200 dark:border-blue-800">
                      <span>{activeItems.length} {T('items','item(s)')} {T('return_type_restock','to return')}
                        {activeItems.length < selectedItems.filter(it => !(it.remaining <= 0)).length
                          ? <span className="text-orange-500 ml-1 font-normal">({T('status_partial_return','partial')})</span>
                          : null}
                      </span>
                      <span className="text-blue-700 dark:text-blue-300">{fmtUSD(totalRefund)} {T('refund','refund')}</span>
                    </div>
                  )}
                </div>
              )}

              {selectedItems.length === 0 && (
                <div className="text-sm text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 text-center">
                  {T('manual_return','No sale items linked. This will be recorded as a manual return.')}
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                  {T('return_reason','Return Reason')} *
                </label>
                <select className="input text-sm mb-2" value={reason} onChange={e => setReason(e.target.value)}>
                  {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {reason === OTHER_LABEL && (
                  <input className="input text-sm" placeholder={T('reason_placeholder','Describe the reason…')}
                    value={customReason} onChange={e => setCustomReason(e.target.value)} />
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                  {T('return_notes','Notes')} ({T('optional','optional')})
                </label>
                <textarea className="input text-sm resize-none" rows={2} placeholder={T('reason_placeholder','Additional details…')}
                  value={notes} onChange={e => setNotes(e.target.value)} />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep('search')} className="btn-secondary text-sm flex-1">← {T('back','Back')}</button>
                <button onClick={() => {
                  if (!activeItems.length) { notify(T('select_items_to_return','Select at least one item to return.'), 'error'); return }
                  if (!finalReason) { notify(T('return_reason','Please provide a return reason.'), 'error'); return }
                  setStep('confirm')
                }} className="btn-primary text-sm flex-1">
                  {T('confirm','Review')} → {activeItems.length} {T('items','item(s)')}
                  {activeItems.length < selectedItems.filter(it => (it.remaining ?? it.quantity) > 0).length
                    ? ` (${T('status_partial_return','partial')})` : ''}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4 border border-orange-200 dark:border-orange-800">
                <div className="text-sm font-semibold text-orange-800 dark:text-orange-300 mb-2">⚠️ {T('confirm','Confirm Return')}</div>
                <div className="text-xs text-orange-700 dark:text-orange-400 space-y-1">
                  {foundSale && <div>{T('original_receipt','Original Sale')}: <span className="font-mono font-bold">{foundSale.receipt_number}</span></div>}
                  <div>{T('reason','Reason')}: <span className="font-medium">{finalReason}</span></div>
                  <div>{T('return_type_label','Handling')}: <span className="font-medium">
                    {returnType === 'restock' ? T('return_type_restock','↩️ Restock') : returnType === 'writeoff' ? T('return_type_writeoff','🗑 Write Off') : T('return_type_refund','💰 Refund Only')}
                  </span></div>
                  <div>{T('returns','Returning')}: <span className="font-medium">{activeItems.length} {T('items','item type(s)')}</span></div>
                  {activeItems.filter(it => it.return_to_stock !== false).length > 0 && (
                    <div>↩️ {activeItems.filter(it => it.return_to_stock !== false).length} {T('restocked','will be restocked')}</div>
                  )}
                  {activeItems.filter(it => it.return_to_stock === false).length > 0 && (
                    <div>🗑 {activeItems.filter(it => it.return_to_stock === false).length} {T('written_off','will NOT restock')}</div>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-1">
                {activeItems.map((it, i) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-200 dark:border-gray-700 last:border-0">
                    <div className="flex-1 min-w-0 mr-2">
                      <span className="text-gray-700 dark:text-gray-300 truncate block">{it.product_name || it.name}</span>
                      <span className="text-[10px] text-gray-400">
                        {it.return_to_stock !== false ? `↩️ ${T('return_type_restock','restock')}` : `🗑 ${T('return_type_writeoff','write-off')}`}
                        {' · '}{T('quantity','qty')} {it.returnQty}
                      </span>
                    </div>
                    <span className="font-medium text-gray-900 dark:text-white flex-shrink-0">
                      {fmtUSD((it.applied_price_usd || 0) * it.returnQty)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-base text-gray-900 dark:text-white pt-2 mt-1 border-t border-gray-300 dark:border-gray-600">
                  <span>{T('total_refunded','Total Refund')}</span>
                  <span>{fmtUSD(totalRefund)}</span>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep('items')} className="btn-secondary text-sm flex-1">← {T('back','Back')}</button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="btn-primary text-sm flex-1 disabled:opacity-50">
                  {submitting ? `⏳ ${T('submitting','Processing…')}` : `✅ ${T('submit_return','Confirm Return')}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
