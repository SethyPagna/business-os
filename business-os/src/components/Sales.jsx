import { useState, useEffect } from 'react'
import { useApp } from '../AppContext'
import Receipt from './Receipt'

function multiMatch(text, terms) {
  return terms.every(term => text.toLowerCase().includes(term.toLowerCase()))
}

export default function Sales() {
  const { t, settings, fmtUSD, fmtKHR } = useApp()
  const [sales, setSales] = useState([])
  const [search, setSearch] = useState('')
  const [selectedSale, setSelectedSale] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { window.api.getSales().then(s => { setSales(s); setLoading(false) }) }, [])

  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filtered = sales.filter(s => {
    if (!searchTerms.length) return true
    const haystack = `${s.receipt_number} ${s.cashier_name||''} ${s.payment_method||''} ${s.notes||''}`
    return multiMatch(haystack, searchTerms)
  })

  if (selectedSale) return <Receipt sale={selectedSale} settings={settings} onClose={() => setSelectedSale(null)} />

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">💰 {t('sales')}</h1>
        <span className="text-sm text-gray-400">{filtered.length} records</span>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <input className="input max-w-sm" placeholder={`🔍 ${t('search')} receipt, cashier, payment... (multiple words)`} value={search} onChange={e=>setSearch(e.target.value)} />
        {searchTerms.length > 1 && searchTerms.map((term,i) => <span key={i} className="badge-blue text-xs">{term}</span>)}
      </div>

      <div className="card flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('receipt_number')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('cashier')}</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('payment_method')}</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('items')}</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">{t('no_data')}</td></tr>
              ) : filtered.map(s => {
                const items = typeof s.items==='string' ? JSON.parse(s.items||'[]') : (s.items||[])
                const totalUsd = s.total_usd || s.total || 0
                const totalKhr = s.total_khr || 0
                return (
                  <tr key={s.id} className="table-row">
                    <td className="px-4 py-2.5 font-mono font-medium text-blue-600 dark:text-blue-400">{s.receipt_number}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{s.cashier_name||'—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <span className="badge-blue text-xs">{s.payment_method||'—'}</span>
                        {s.payment_currency && s.payment_currency!=='USD' && <span className="badge-green text-xs">{s.payment_currency}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="font-semibold text-gray-900 dark:text-white">{fmtUSD(totalUsd)}</div>
                      {totalKhr > 0 && <div className="text-xs text-gray-400">{fmtKHR(totalKhr)}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-500">{items.length}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => setSelectedSale(s)} className="text-blue-500 hover:text-blue-700 text-xs px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium">
                        {t('reprint')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{filtered.length} {t('sales')}</div>
      </div>
    </div>
  )
}
