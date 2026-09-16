import X from 'lucide-react/dist/esm/icons/x.js'
import { createPortal } from 'react-dom'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import AppSelect from '../shared/AppSelect.tsx'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import {
  buildReturnBulkPayload,
  countConditionalMatches,
  methodFieldForScope,
  methodValueForRow,
  RETURN_BULK_LIMIT,
  type ReturnBulkField,
  type ReturnBulkPayload,
  type ReturnBulkResult,
  type ReturnBulkRow,
} from './helpers/returnBulkAction.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

interface Props {
  rows: ReturnBulkRow[]
  scope: 'customer' | 'supplier'
  tr: Translate
  onClose: () => void
  onApply: (payload: ReturnBulkPayload) => Promise<ReturnBulkResult>
}

const CUSTOMER_METHODS = ['restock', 'refund', 'writeoff']
const SUPPLIER_METHODS = ['refund', 'credit', 'replacement', 'writeoff']
const STATUS_VALUES = ['completed', 'cancelled']

export default function ReturnsBulkActionModal({ rows, scope, tr, onClose, onApply }: Props) {
  const [field, setField] = useState<ReturnBulkField>('status')
  const methodField = methodFieldForScope(scope)
  const canonicalMethodValues = useMemo(() => scope === 'supplier' ? SUPPLIER_METHODS : CUSTOMER_METHODS, [scope])
  const methodValues = useMemo(() => Array.from(new Set([
    ...canonicalMethodValues,
    ...rows.map(methodValueForRow),
  ])), [canonicalMethodValues, rows])
  const sourceValues = field === 'status' ? STATUS_VALUES : methodValues
  const targetValues = field === 'status' ? STATUS_VALUES : canonicalMethodValues
  const [source, setSource] = useState(sourceValues[0] || '')
  const [target, setTarget] = useState(targetValues.find((value) => value !== source) || '')
  const [saving, setSaving] = useState(false)
  const submitRef = useRef(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const effectiveField = field === 'status' ? 'status' : methodField
  const matches = countConditionalMatches(rows, effectiveField, source)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  const switchField = (next: ReturnBulkField) => {
    const resolved = next === 'status' ? 'status' : methodField
    const nextSourceValues = resolved === 'status' ? STATUS_VALUES : methodValues
    const nextTargetValues = resolved === 'status' ? STATUS_VALUES : canonicalMethodValues
    setField(resolved)
    setSource(nextSourceValues[0] || '')
    setTarget(nextTargetValues.find((value) => value !== nextSourceValues[0]) || nextTargetValues[0] || '')
  }

  const submit = async () => {
    if (!source || !target || source === target || !matches || rows.length > RETURN_BULK_LIMIT) return
    if (!beginSingleAction(submitRef)) return
    setSaving(true)
    try {
      await onApply(buildReturnBulkPayload({ rows, field: effectiveField, source, target }))
      onClose()
    } catch {
      // The page-level action reports the failure and retains the exact retry.
    } finally {
      finishSingleAction(submitRef)
      setSaving(false)
    }
  }

  const closeIfIdle = () => { if (!saving) onClose() }
  const optionLabel = (value: string) => {
    const fallback = value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
    if (field === 'status') return tr(`status_${value}`, fallback)
    if (methodField === 'supplier_settlement') return tr(`settlement_${value}`, fallback)
    if (value === 'manual') return tr('manual_return', 'Manual')
    return tr(`return_type_${value}`, fallback)
  }
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeIfIdle()
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onKeyDown={handleDialogKeyDown} onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white">{tr('return_bulk_action', 'Change selected returns', 'កែប្រែការត្រឡប់ដែលបានជ្រើស')}</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{rows.length} {tr('selected', 'selected', 'បានជ្រើស')}</p>
          </div>
          <button ref={closeRef} type="button" className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={closeIfIdle} disabled={saving} aria-label={tr('close', 'Close', 'បិទ')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-scroll space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={saving} className={field === 'status' ? 'btn-primary' : 'btn-secondary'} onClick={() => switchField('status')}>{tr('status', 'Status', 'ស្ថានភាព')}</button>
            <button type="button" disabled={saving} className={field !== 'status' ? 'btn-primary' : 'btn-secondary'} onClick={() => switchField(methodField)}>
              {scope === 'supplier'
                ? tr('settlement_method', 'Supplier settlement', 'ការទូទាត់អ្នកផ្គត់ផ្គង់')
                : tr('return_type', 'Return type', 'ប្រភេទត្រឡប់')}
            </button>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>{tr('bulk_from', 'From', 'ពី')}</span>
              <AppSelect disabled={saving} ariaLabel={tr('bulk_from', 'From', 'ពី')} value={source} onChange={(value) => setSource(String(value))} options={sourceValues.map((value) => ({ value, label: optionLabel(value) }))} />
            </label>
            <span className="pb-2 text-gray-400">→</span>
            <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>{tr('bulk_to', 'To', 'ទៅ')}</span>
              <AppSelect disabled={saving} ariaLabel={tr('bulk_to', 'To', 'ទៅ')} value={target} onChange={(value) => setTarget(String(value))} options={targetValues.map((value) => ({ value, label: optionLabel(value) }))} />
            </label>
          </div>

          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <p>{tr('bulk_matching_count', '{n} matching', 'ផ្គូផ្គង {n}').replace('{n}', String(matches))}</p>
            {rows.length > matches ? <p>{tr('bulk_skipped_count', '{n} selected with another source value will be skipped.', 'បានជ្រើស {n} ដែលមានតម្លៃប្រភពផ្សេង នឹងត្រូវរំលង។').replace('{n}', String(rows.length - matches))}</p> : null}
            {field !== 'status' ? <p className="mt-1">{tr('return_bulk_method_preserves_values', 'Recorded amounts and item stock actions stay unchanged.', 'ចំនួនទឹកប្រាក់ដែលបានកត់ត្រា និងសកម្មភាពស្តុករបស់ទំនិញនៅតែមិនផ្លាស់ប្តូរ។')}</p> : null}
          </div>

          {rows.length > RETURN_BULK_LIMIT ? <p className="text-sm text-red-600">{tr('return_bulk_limit', `Select at most ${RETURN_BULK_LIMIT} returns.`, `ជ្រើសរើសការត្រឡប់មិនលើស ${RETURN_BULK_LIMIT}។`)}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn-secondary" onClick={closeIfIdle} disabled={saving}>{tr('cancel', 'Cancel', 'បោះបង់')}</button>
          <button type="button" className="btn-primary" onClick={() => { void submit() }} disabled={saving || !matches || !source || !target || source === target || rows.length > RETURN_BULK_LIMIT}>
            {saving ? tr('saving', 'Saving...', 'កំពុងរក្សាទុក...') : tr('apply', 'Apply', 'អនុវត្ត')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
