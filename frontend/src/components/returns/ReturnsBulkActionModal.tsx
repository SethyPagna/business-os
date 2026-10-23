import { useEffect, useMemo, useRef, useState } from 'react'
import BulkFieldChangeDialog from '../shared/BulkFieldChangeDialog.tsx'
import ReplacementChoiceList from './ReplacementChoiceList.tsx'
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
import {
  answerReady, composeCancelPayload, defaultAnswer, outstandingFromRefusal, rowsNeedingReplacementAnswer, toggleCancel, toggleLine,
  type ReplacementAnswer, type ReplacementLine, type ReplacementOutstanding, type TakenBack,
} from './helpers/returnReplacementCancel.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

interface Props {
  rows: Array<ReturnBulkRow & { return_number?: string | null }>
  scope: 'customer' | 'supplier'
  tr: Translate
  fmtUSD?: (value: number) => string
  /** Cancelling a return that opened a replacement sale asks about the replacement items (owner, 22 Oct 2026); these are the reads and the write behind it. */
  loadOutstanding?: (returnId: number) => Promise<ReplacementOutstanding | null>
  takeBack?: (outstanding: ReplacementOutstanding, lines: ReplacementLine[]) => Promise<number>
  /** A dry run of the cancel, sent BEFORE any take-back is made: it refuses what the real cancel would refuse (budget, price floor, change), writing nothing. */
  onCheck?: (payload: ReturnBulkPayload) => Promise<unknown>
  /** Taking units back records a return, which needs permission to add returns. */
  canTakeBack?: boolean
  onClose: () => void
  onApply: (payload: ReturnBulkPayload) => Promise<ReturnBulkResult>
}

const CUSTOMER_METHODS = ['restock', 'refund', 'writeoff']
const SUPPLIER_METHODS = ['refund', 'credit', 'replacement', 'writeoff']
const STATUS_VALUES = ['completed', 'cancelled']

export default function ReturnsBulkActionModal({ rows, scope, tr, fmtUSD, loadOutstanding, takeBack, canTakeBack = false, onCheck, onClose, onApply }: Props) {
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

  // The question a cancel asks about replacement items still with the customer. The look-up runs as soon as the dialog is on completed -> cancelled for a
  // selection that has exchange returns, and Apply waits for it; if it fails, Apply still works and the Worker names the lines itself.
  const askIds = useMemo(() => loadOutstanding ? rowsNeedingReplacementAnswer(rows, effectiveField, source, target) : [], [rows, effectiveField, source, target, loadOutstanding])
  const askKey = askIds.join(',')
  const [outstanding, setOutstanding] = useState<ReadonlyMap<number, ReplacementOutstanding>>(() => new Map())
  const [answers, setAnswers] = useState<ReadonlyMap<number, ReplacementAnswer>>(() => new Map())
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'ready' | 'failed'>(askIds.length ? 'loading' : 'idle')
  const [lookupRevision, setLookupRevision] = useState(0)
  const [takenRevision, setTakenRevision] = useState(0)
  const taken = useRef(new Map<number, TakenBack>())
  const absorb = (found: readonly ReplacementOutstanding[]) => {
    setOutstanding((current) => new Map([...current, ...found.map((item) => [item.return_id, item] as const)]))
    setAnswers((current) => {
      const next = new Map(current)
      for (const item of found) if (!next.has(item.return_id)) next.set(item.return_id, defaultAnswer(item))
      return next
    })
  }
  useEffect(() => {
    if (!askIds.length || !loadOutstanding) { setLookup('idle'); setOutstanding(new Map()); return undefined }
    let alive = true
    setLookup('loading')
    void Promise.all(askIds.map((id) => loadOutstanding(id))).then((found) => {
      if (!alive) return
      setOutstanding(new Map()); setAnswers(new Map())
      absorb(found.filter((item): item is ReplacementOutstanding => item !== null))
      setLookup('ready')
    }).catch(() => { if (alive) setLookup('failed') })
    return () => { alive = false }
    // absorb only calls state setters; askKey stands for askIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey, lookupRevision, loadOutstanding])
  const choiceItems = askIds.flatMap((id) => {
    const info = outstanding.get(id)
    if (!info) return []
    const row = rows.find((candidate) => Number(candidate.id) === id)
    return [{ outstanding: info, returnNumber: String(row?.return_number || id), answer: answers.get(id) ?? defaultAnswer(info), locked: taken.current.has(id) }]
  })
  void takenRevision
  const answersReady = choiceItems.every((item) => answerReady(item.outstanding, item.answer))

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
      // The ticked replacement lines are taken back first (ordinary returns of the replacement sale), then the cancel links them in one request.
      let payload = buildReturnBulkPayload({ rows, field: effectiveField, source, target })
      try {
        payload = await composeCancelPayload({ payload, outstanding, answers, taken: taken.current, takeBack: canTakeBack ? takeBack : undefined, check: onCheck })
      } finally { setTakenRevision((revision) => revision + 1) }
      await onApply(payload)
      onClose()
    } catch (error) {
      // The page-level action reports the failure and retains the exact retry. A cancel the Worker refused for want of an answer (the replacement
      // changed since the look-up) brings its lines here, so the question is asked again with what is really left.
      const fresh = outstandingFromRefusal(error)
      if (fresh) { absorb(fresh); setLookup('ready') }
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
  const money = fmtUSD || ((value: number) => `$${value.toFixed(2)}`)
  const canApply = !saving && !!matches && !!source && !!target && source !== target && rows.length <= RETURN_BULK_LIMIT && lookup !== 'loading' && answersReady

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
      list={askIds.length ? (
        <ReplacementChoiceList
          items={choiceItems}
          loading={lookup === 'loading'}
          failed={lookup === 'failed'}
          canTakeBack={canTakeBack && !!takeBack}
          disabled={saving}
          tr={tr}
          fmtUSD={money}
          onToggleCancel={(returnId, cancel) => { setTouched(true); setAnswers((current) => { const base = current.get(returnId); return base ? new Map(current).set(returnId, toggleCancel(base, cancel)) : current }) }}
          onToggleLine={(returnId, lineId) => { setTouched(true); setAnswers((current) => { const base = current.get(returnId); return base ? new Map(current).set(returnId, toggleLine(base, lineId)) : current }) }}
          onRetry={() => setLookupRevision((revision) => revision + 1)}
        />
      ) : undefined}
      confirm={{ label: tr('apply', 'Apply', 'អនុវត្ត'), disabled: !canApply, onConfirm: () => { void submit() } }}
      saving={saving}
      dirty={touched}
      onClose={onClose}
    />
  )
}
