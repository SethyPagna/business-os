import { useMemo, useRef, useState } from 'react'
import BulkFieldChangeDialog from '../shared/BulkFieldChangeDialog.tsx'
import SearchInput from '../shared/SearchInput.tsx'

export type BulkSaleField = 'status' | 'payment_method' | 'delivery_contact' | 'customer'
export type BulkSaleChoice = { key: string; label: string; id?: number | null; value?: string | null }
export type BulkSaleChangeRow = {
  id: number
  receipt: string
  currentKeys: string[]
  /** Targets this row may not take. It is left out of the change and named, rather than refusing the whole group. */
  blockedTargetKeys?: string[]
}
type Translate = (key: string, english: string, khmer?: string) => string

type Props = {
  field: BulkSaleField
  rows: BulkSaleChangeRow[]
  sourceChoices: BulkSaleChoice[]
  targetChoices: BulkSaleChoice[]
  /** Selected cancelled sales left out of this field change (a cancelled sale is read-only). */
  cancelledCount?: number
  saving?: boolean
  translate: Translate
  onSearchTargets?: (query: string) => Promise<void>
  onClose: () => void
  onConfirm: (source: BulkSaleChoice, target: BulkSaleChoice, matched: BulkSaleChangeRow[], blocked: BulkSaleChangeRow[]) => void
}

export default function BulkSaleChangeModal({ field, rows, sourceChoices, targetChoices, cancelledCount = 0, saving = false, translate, onSearchTargets, onClose, onConfirm }: Props) {
  const [sourceKey, setSourceKey] = useState(sourceChoices[0]?.key || '')
  const [targetKey, setTargetKey] = useState('')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const searchVersion = useRef(0)
  const source = sourceChoices.find((choice) => choice.key === sourceKey)
  const target = targetChoices.find((choice) => choice.key === targetKey)
  const matched = useMemo(() => rows.filter((row) => row.currentKeys.includes(sourceKey)), [rows, sourceKey])
  const skipped = rows.length - matched.length
  const blocked = useMemo(() => matched.filter((row) => row.blockedTargetKeys?.includes(targetKey)), [matched, targetKey])
  const eligible = useMemo(() => matched.filter((row) => !blocked.includes(row)), [matched, blocked])
  const linkedField = field === 'customer' || field === 'delivery_contact'
  const fieldLabel = field === 'status' ? translate('status', 'Status', 'ស្ថានភាព')
    : field === 'payment_method' ? translate('payment_method', 'Payment method', 'វិធីបង់ប្រាក់')
      : field === 'delivery_contact' ? translate('delivery_contact', 'Delivery driver', 'អ្នកដឹកជញ្ជូន')
        : translate('customer', 'Customer', 'អតិថិជន')

  const searchTargets = async (text: string) => {
    setQuery(text)
    if (!onSearchTargets) return
    const version = ++searchVersion.current
    setSearching(true)
    try { await onSearchTargets(text) } catch { /* The page owns the error toast. */ } finally { if (version === searchVersion.current) setSearching(false) }
  }

  return (
    <BulkFieldChangeDialog
      title={<><span className="block">{fieldLabel}</span><span className="block text-xs font-normal text-gray-400">{translate('selected_count', '{n} selected', 'បានជ្រើស {n}').replace('{n}', String(rows.length))}</span></>}
      lead={linkedField && onSearchTargets ? (
        <SearchInput
          id="bulk-sale-target-search"
          value={query}
          onChange={(text) => { void searchTargets(text) }}
          disabled={saving}
          placeholder={field === 'customer' ? translate('search_customers', 'Search customers', 'ស្វែងរកអតិថិជន') : translate('search_delivery_contacts', 'Search drivers', 'ស្វែងរកអ្នកដឹកជញ្ជូន')}
        />
      ) : null}
      from={{ label: translate('bulk_from', 'From', 'ពី'), value: sourceKey, onChange: setSourceKey, options: sourceChoices.map((choice) => ({ value: choice.key, label: choice.label })) }}
      to={{
        label: translate('bulk_to', 'To', 'ទៅ'),
        value: targetKey,
        onChange: setTargetKey,
        disabled: searching,
        options: [
          { value: '', label: searching ? translate('loading', 'Loading…', 'កំពុងផ្ទុក…') : translate('choose', 'Choose', 'ជ្រើសរើស'), disabled: true },
          ...targetChoices.filter((choice) => choice.key !== sourceKey).map((choice) => ({ value: choice.key, label: choice.label })),
        ],
      }}
      matchingText={translate('bulk_matching_count', '{n} matching', 'ស្របគ្នា {n}').replace('{n}', String(matched.length))}
      skippedText={skipped > 0 ? translate('bulk_skipped_short', '{n} skipped', 'រំលង {n}').replace('{n}', String(skipped)) : undefined}
      hint={translate('bulk_skipped_count', '{n} selected with another source value will be skipped.', 'ជម្រើស {n} ដែលមានតម្លៃប្រភពផ្សេងនឹងត្រូវរំលង។').replace('{n}', String(skipped))}
      alerts={(
        <>
          {cancelledCount > 0 ? <div className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">{translate('sale_bulk_cancelled_skipped', '{n} cancelled sale(s) left out: a cancelled sale cannot be edited.', 'ការលក់ដែលបានបោះបង់ {n} មិនអាចកែប្រែបានទេ ហើយត្រូវបានទុកចោល។').replace('{n}', String(cancelledCount))}</div> : null}
          {blocked.length ? (
            <div role="status" className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              {translate('sale_bulk_status_unpaid_skipped', '{n} Not Paid sale(s) left out: not fully paid. Record the payment on each sale first.', 'ការលក់ប្រាក់ជំពាក់ {n} មិនទាន់ទូទាត់គ្រប់ចំនួន ហើយនឹងមិនត្រូវបានកែប្រែទេ។ សូមកត់ត្រាការទូទាត់លើការលក់នីមួយៗជាមុនសិន។').replace('{n}', String(blocked.length))}
              <span className="block font-semibold">{blocked.map((row) => row.receipt).join(', ')}</span>
            </div>
          ) : null}
        </>
      )}
      list={<div className="max-h-40 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">{eligible.map((row) => <div key={row.id} className="border-b px-3 py-2 text-sm last:border-b-0 dark:border-gray-700">{row.receipt}</div>)}</div>}
      confirm={{
        label: translate('confirm', 'Confirm', 'បញ្ជាក់'),
        disabled: !source || !target || source.key === target.key || eligible.length === 0,
        onConfirm: () => { if (source && target) onConfirm(source, target, eligible, blocked) },
      }}
      saving={saving}
      dirty={targetKey !== ''}
      onClose={onClose}
    />
  )
}
