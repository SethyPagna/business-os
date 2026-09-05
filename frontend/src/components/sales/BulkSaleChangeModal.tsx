import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Search from 'lucide-react/dist/esm/icons/search.js'
import X from 'lucide-react/dist/esm/icons/x.js'

export type BulkSaleField = 'status' | 'payment_method' | 'delivery_contact' | 'customer'
export type BulkSaleChoice = { key: string; label: string; id?: number | null; value?: string | null }
export type BulkSaleChangeRow = { id: number; receipt: string; currentKeys: string[] }
type Translate = (key: string, english: string, khmer?: string) => string

type Props = {
  field: BulkSaleField
  rows: BulkSaleChangeRow[]
  sourceChoices: BulkSaleChoice[]
  targetChoices: BulkSaleChoice[]
  saving?: boolean
  translate: Translate
  onSearchTargets?: (query: string) => Promise<void>
  onClose: () => void
  onConfirm: (source: BulkSaleChoice, target: BulkSaleChoice, matched: BulkSaleChangeRow[]) => void
}

export default function BulkSaleChangeModal({ field, rows, sourceChoices, targetChoices, saving = false, translate, onSearchTargets, onClose, onConfirm }: Props) {
  const [sourceKey, setSourceKey] = useState(sourceChoices[0]?.key || '')
  const [targetKey, setTargetKey] = useState('')
  const [searching, setSearching] = useState(false)
  const searchVersion = useRef(0)
  const source = sourceChoices.find((choice) => choice.key === sourceKey)
  const target = targetChoices.find((choice) => choice.key === targetKey)
  const matched = useMemo(() => rows.filter((row) => row.currentKeys.includes(sourceKey)), [rows, sourceKey])
  const skipped = rows.length - matched.length
  const linkedField = field === 'customer' || field === 'delivery_contact'
  const fieldLabel = field === 'status' ? translate('status', 'Status', 'ស្ថានភាព')
    : field === 'payment_method' ? translate('payment_method', 'Payment method', 'វិធីបង់ប្រាក់')
      : field === 'delivery_contact' ? translate('delivery_contact', 'Delivery driver', 'អ្នកដឹកជញ្ជូន')
        : translate('customer', 'Customer', 'អតិថិជន')

  const searchTargets = async (query: string) => {
    if (!onSearchTargets) return
    const version = ++searchVersion.current
    setSearching(true)
    try { await onSearchTargets(query) } catch { /* The page owns the error toast. */ } finally { if (version === searchVersion.current) setSearching(false) }
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={saving ? undefined : onClose}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white">{fieldLabel}</h2>
            <p className="text-xs text-gray-400">{translate('selected_count', '{n} selected', 'បានជ្រើស {n}').replace('{n}', String(rows.length))}</p>
          </div>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onClose} disabled={saving} aria-label={translate('close', 'Close', 'បិទ')}><X className="h-4 w-4" /></button>
        </div>
        <div className="modal-scroll space-y-4 p-4">
          {linkedField && onSearchTargets ? (
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              {translate('search', 'Search', 'ស្វែងរក')}
              <span className="relative mt-1 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  className="input w-full pl-9 text-sm"
                  disabled={saving}
                  placeholder={field === 'customer' ? translate('search_customers', 'Search customers', 'ស្វែងរកអតិថិជន') : translate('search_delivery_contacts', 'Search drivers', 'ស្វែងរកអ្នកដឹកជញ្ជូន')}
                  onChange={(event) => { void searchTargets(event.target.value) }}
                />
              </span>
            </label>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <label className="min-w-0 text-xs font-medium text-gray-600 dark:text-gray-300">
              {translate('bulk_from', 'From', 'ពី')}
              <select className="input mt-1 w-full text-sm" value={sourceKey} disabled={saving} onChange={(event) => setSourceKey(event.target.value)}>{sourceChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select>
            </label>
            <span className="pb-3 text-gray-400" aria-hidden="true">→</span>
            <label className="min-w-0 text-xs font-medium text-gray-600 dark:text-gray-300">
              {translate('bulk_to', 'To', 'ទៅ')}
              <select className="input mt-1 w-full text-sm" value={targetKey} disabled={saving || searching} onChange={(event) => setTargetKey(event.target.value)}>
                <option value="">{searching ? translate('loading', 'Loading…', 'កំពុងផ្ទុក…') : translate('choose', 'Choose', 'ជ្រើសរើស')}</option>
                {targetChoices.filter((choice) => choice.key !== sourceKey).map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
              </select>
            </label>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
            <div className="font-semibold text-blue-800 dark:text-blue-200">{translate('bulk_matching_count', '{n} matching', 'ស្របគ្នា {n}').replace('{n}', String(matched.length))}</div>
            <div className="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">{translate('bulk_skipped_count', '{n} selected with another source value will be skipped.', 'ជម្រើស {n} ដែលមានតម្លៃប្រភពផ្សេងនឹងត្រូវរំលង។').replace('{n}', String(skipped))}</div>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">{matched.map((row) => <div key={row.id} className="border-b px-3 py-2 text-sm last:border-b-0 dark:border-gray-700">{row.receipt}</div>)}</div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={saving}>{translate('cancel', 'Cancel', 'បោះបង់')}</button>
          <button type="button" className="btn-primary text-sm" disabled={saving || !source || !target || source.key === target.key || matched.length === 0} onClick={() => source && target && onConfirm(source, target, matched)}>{saving ? translate('saving', 'Saving...', 'កំពុងរក្សាទុក...') : translate('confirm', 'Confirm', 'បញ្ជាក់')}</button>
        </div>
      </div>
    </div>, document.body,
  )
}
