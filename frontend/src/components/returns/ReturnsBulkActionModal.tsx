import { useMemo, useRef, useState } from 'react'
import BulkFieldChangeDialog from '../shared/BulkFieldChangeDialog.tsx'
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
  const [touched, setTouched] = useState(false)
  const submitRef = useRef(false)
  const effectiveField = field === 'status' ? 'status' : methodField
  const matches = countConditionalMatches(rows, effectiveField, source)

  const switchField = (next: ReturnBulkField) => {
    setTouched(true)
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

  const optionLabel = (value: string) => {
    const fallback = value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
    if (field === 'status') return tr(`status_${value}`, fallback)
    if (methodField === 'supplier_settlement') return tr(`settlement_${value}`, fallback)
    if (value === 'manual') return tr('manual_return', 'Manual')
    return tr(`return_type_${value}`, fallback)
  }
  const pick = (apply: (value: string) => void) => (value: string) => { setTouched(true); apply(value) }
  const canApply = !saving && !!matches && !!source && !!target && source !== target && rows.length <= RETURN_BULK_LIMIT

  return (
    <BulkFieldChangeDialog
      title={<><span className="block">{tr('return_bulk_action', 'Change selected returns', 'កែប្រែការត្រឡប់ដែលបានជ្រើស')}</span><span className="block text-xs font-normal text-gray-500 dark:text-gray-400">{rows.length} {tr('selected', 'selected', 'បានជ្រើស')}</span></>}
      lead={(
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={saving} className={`${field === 'status' ? 'btn-primary' : 'btn-secondary'} text-xs leading-relaxed`} onClick={() => switchField('status')}>{tr('status', 'Status', 'ស្ថានភាព')}</button>
          <button type="button" disabled={saving} className={`${field !== 'status' ? 'btn-primary' : 'btn-secondary'} text-xs leading-relaxed`} onClick={() => switchField(methodField)}>
            {scope === 'supplier'
              ? tr('settlement_method', 'Supplier settlement', 'ការទូទាត់អ្នកផ្គត់ផ្គង់')
              : tr('return_type', 'Return type', 'ប្រភេទត្រឡប់')}
          </button>
        </div>
      )}
      from={{ label: tr('bulk_from', 'From', 'ពី'), value: source, onChange: pick(setSource), options: sourceValues.map((value) => ({ value, label: optionLabel(value) })) }}
      to={{ label: tr('bulk_to', 'To', 'ទៅ'), value: target, onChange: pick(setTarget), options: targetValues.map((value) => ({ value, label: optionLabel(value) })) }}
      matchingText={tr('bulk_matching_count', '{n} matching', 'ផ្គូផ្គង {n}').replace('{n}', String(matches))}
      skippedText={rows.length > matches ? tr('bulk_skipped_short', '{n} skipped', 'រំលង {n}').replace('{n}', String(rows.length - matches)) : undefined}
      hint={[
        tr('bulk_skipped_count', '{n} selected with another source value will be skipped.', 'បានជ្រើស {n} ដែលមានតម្លៃប្រភពផ្សេង នឹងត្រូវរំលង។').replace('{n}', String(rows.length - matches)),
        field !== 'status' ? tr('return_bulk_method_preserves_values', 'Recorded amounts and item stock actions stay unchanged.', 'ចំនួនទឹកប្រាក់ដែលបានកត់ត្រា និងសកម្មភាពស្តុករបស់ទំនិញនៅតែមិនផ្លាស់ប្តូរ។') : '',
      ].filter(Boolean).join('\n\n')}
      alerts={rows.length > RETURN_BULK_LIMIT ? <p className="text-sm text-red-600">{tr('return_bulk_limit', `Select at most ${RETURN_BULK_LIMIT} returns.`, `ជ្រើសរើសការត្រឡប់មិនលើស ${RETURN_BULK_LIMIT}។`)}</p> : null}
      confirm={{ label: tr('apply', 'Apply', 'អនុវត្ត'), disabled: !canApply, onConfirm: () => { void submit() } }}
      saving={saving}
      dirty={touched}
      onClose={onClose}
    />
  )
}
