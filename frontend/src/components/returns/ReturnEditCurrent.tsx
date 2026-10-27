// 6.0.997 slice S1: the Edit Return form for a current-format customer return (helpers/returnEditCurrent.ts holds the pure rules).
//   ReturnEditCurrent -- reason, notes, handling method and each line's stock handling; quantities are shown, never edited. Save
//                        previews on the Worker, shows the shared compact review dialog (before -> after, stock that moves) and
//                        only then writes exactly the previewed digest. Undo is in History; the edit is in the return's Records.
//   ReturnEditAsk     -- the panel for someone without full Returns access (or a cancelled return): the reason and the way out.
// Button policy (owner, 27 Sep 2026): the main action keeps an icon and one word; every other control is icon-only with a
// translated tooltip. Labels sit inside the inputs; one compact row per line.
import { useRef, useState, type ChangeEvent } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Ban from 'lucide-react/dist/esm/icons/ban.js'
import Banknote from 'lucide-react/dist/esm/icons/banknote.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Modal from '../shared/Modal.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import { businessDateTimeId } from '../../utils/timestampId.ts'
import { apiFetch, confirmServerReachable } from '../../api/http.ts'
import { getLoaderErrorMessage } from '../../utils/loaders.ts'
import { DEFAULT_STOCK_CONDITION_TAG, STOCK_CONDITION_TAGS } from '../../utils/stockCondition.ts'
import { useFormDirty } from '../../utils/formDirty.ts'
import { normalizeReturnReasonList } from './helpers/returnReasonPresets.ts'
import { useReturnReasonPresets } from './helpers/useReturnReasonPresets.ts'
import { returnRefusalText } from './helpers/returnRefusalError.ts'
import type { ReturnStockAction } from './helpers/returnOptions.ts'
import {
  buildCurrentEditBody, currentEditFailureText, draftChanged, initialDraft, isStaleEdit, reviewRows,
  type CurrentReturn, type EditDraft, type EditPreview,
} from './helpers/returnEditCurrent.ts'

type Translate = (key: string, fallback: string) => string
type NotifyFn = (message: string, type?: string) => void
type MoneyFormatter = (value: number | string) => string
const useApp = useAppHook as () => { user?: unknown; t?: (key: string) => string | undefined }

function useTranslate(): Translate {
  const { t } = useApp()
  return (key: string, fallback: string) => {
    const value = typeof t === 'function' ? t(key) : undefined
    return value && value !== key ? value : fallback
  }
}

type FormReturn = CurrentReturn & {
  return_number?: string | null
  total_refund_usd?: number | string | null
  items?: Array<NonNullable<CurrentReturn['items']>[number] & { applied_price_usd?: number | string | null }> | null
}

export async function previewCurrentEdit(returnId: number | string, body: Record<string, unknown>): Promise<EditPreview> {
  return apiFetch('POST', `/api/returns/${encodeURIComponent(String(returnId))}/edit/preview`, body) as Promise<EditPreview>
}
// Online only: the write is guarded against the return's live revision, so a replay from an offline queue could never be what was reviewed.
export async function saveCurrentEdit(returnId: number | string, body: Record<string, unknown>, digest: string, requestId: string): Promise<{ success: boolean; changed: boolean; history_id: number | null }> {
  if (navigator.onLine === false && !(await confirmServerReachable())) throw new Error('Connect to the server before editing a return.')
  return apiFetch('PATCH', `/api/returns/${encodeURIComponent(String(returnId))}`, { ...body, expected_digest: digest, client_request_id: requestId })
}

const ACTIONS: Array<{ value: ReturnStockAction; Icon: typeof RotateCcw; key: string; en: string }> = [
  { value: 'restock', Icon: RotateCcw, key: 'stock_action_restock', en: 'Restock' },
  { value: 'damaged', Icon: AlertTriangle, key: 'stock_action_damaged', en: 'Damaged' },
  { value: 'none', Icon: Ban, key: 'stock_action_none', en: 'No restock' },
]
const METHODS: Array<{ value: string; Icon: typeof RotateCcw; key: string; en: string }> = [
  { value: 'restock', Icon: RotateCcw, key: 'return_type_restock', en: 'Restock' },
  { value: 'writeoff', Icon: Trash2, key: 'return_type_writeoff', en: 'Write Off' },
  { value: 'refund', Icon: Banknote, key: 'return_type_refund', en: 'Refund Only' },
]
const SEGMENT = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-50'
const SEGMENT_ON = 'border-blue-500 bg-blue-100/70 text-blue-700 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300'
const SEGMENT_OFF = 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400'

export default function ReturnEditCurrent({ ret, onClose, onSuccess, onReloadLatest, fmtUSD, notify }: {
  ret: FormReturn; onClose: () => void; onSuccess?: (result?: unknown) => void | Promise<void>; onReloadLatest?: () => void; fmtUSD: MoneyFormatter; notify: NotifyFn
}) {
  const { t } = useApp()
  const T = useTranslate()
  const { askToConfirm, confirmDialog } = useConfirmDialog(t as never)
  const other = T('reason_other', 'Other')
  const presets = useReturnReasonPresets(t as never)
  const reasons = normalizeReturnReasonList([...presets.customer, other])
  const startReason = String(ret.reason ?? '')
  const [draft, setDraft] = useState<EditDraft>(() => initialDraft(ret))
  const [reasonChoice, setReasonChoice] = useState<string>(() => (reasons.includes(startReason) ? startReason : startReason ? other : reasons[0]))
  const [customReason, setCustomReason] = useState<string>(() => (reasons.includes(startReason) ? '' : startReason))
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)
  const busyRef = useRef(false)
  const requestRef = useRef<{ key: string; id: string } | null>(null)
  const finalReason = reasonChoice === other ? customReason : reasonChoice
  const effective: EditDraft = { ...draft, reason: finalReason }
  const changed = draftChanged(ret, effective)
  const dirty = useFormDirty({ reason: finalReason, notes: draft.notes, returnType: draft.returnType, lines: draft.lines.map((line) => [line.id, line.action, line.tagTouched ? line.tag : null]) }, ret.id ?? null)
  const items = Array.isArray(ret.items) ? ret.items : []

  const setLine = (index: number, patch: Partial<EditDraft['lines'][number]>) =>
    setDraft((current) => ({ ...current, lines: current.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) }))

  const save = async (): Promise<void> => {
    if (busyRef.current) return
    if (!finalReason.trim()) { notify(T('return_reason_required', 'Please provide a reason'), 'error'); return }
    busyRef.current = true
    setBusy(true)
    try {
      const body = buildCurrentEditBody(ret, effective)
      const preview = await previewCurrentEdit(ret.id as number, body)
      if (!preview.changed) { notify(T('return_edit_nothing', 'Nothing to change.'), 'info'); return }
      const confirmed = await askToConfirm({
        title: T('return_edit_review_title', 'Save changes'),
        message: T('return_edit_review_message', 'Refund, debt and cash stay the same. Undo is in History.'),
        items: reviewRows(preview, T),
        confirmLabel: T('save', 'Save'),
      })
      if (!confirmed) return
      // The same content keeps one request id, so a retry after a lost answer replays instead of writing twice.
      const key = `${JSON.stringify(body)}|${preview.digest}`
      if (requestRef.current?.key !== key) requestRef.current = { key, id: `return-edit-${businessDateTimeId()}-${Math.random().toString(36).slice(2, 10)}` }
      const result = await saveCurrentEdit(ret.id as number, body, preview.digest, requestRef.current.id)
      notify(T('return_edit_done', 'Saved. Undo is in History.'), 'success')
      for (const channel of ['returns', 'inventory', 'sales']) window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel } }))
      await Promise.resolve(onSuccess?.(result))
      onClose()
    } catch (error) {
      if (isStaleEdit(error)) { setStale(true); window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } })) }
      notify(currentEditFailureText(error, T) ?? returnRefusalText(error, T) ?? getLoaderErrorMessage(error), 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const title = `${T('edit_return', 'Edit Return')}${ret.return_number ? ` · ${ret.return_number}` : ''}`
  return (
    <Modal title={title} onClose={onClose} size="md" keyboard closeDisabled={busy} unsavedChanges={{ dirty: dirty.dirty }}>
      <div data-return-edit-current="" className="space-y-3">
        {stale ? (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            <span>{T('return_edit_preview_stale', 'This return changed. Nothing was saved. Review it again.')}</span>
            {onReloadLatest ? (
              <button type="button" onClick={onReloadLatest} title={T('write_conflict_reload_latest', 'Reload latest')} aria-label={T('write_conflict_reload_latest', 'Reload latest')}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-red-300 dark:border-red-700"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /></button>
            ) : null}
          </div>
        ) : null}

        <fieldset disabled={busy} className="contents">
          <div className="flex items-center gap-1" role="group" aria-label={T('return_type_label', 'Handling Method')} data-return-edit-method="">
            <span className="mr-1 text-xs font-semibold text-gray-500">{T('return_type_label', 'Handling Method')}</span>
            {METHODS.map(({ value, Icon, key, en }) => (
              <button key={value} type="button" title={T(key, en)} aria-label={T(key, en)} aria-pressed={draft.returnType === value}
                onClick={() => setDraft((current) => ({ ...current, returnType: value }))}
                className={`${SEGMENT} ${draft.returnType === value ? SEGMENT_ON : SEGMENT_OFF}`}><Icon className="h-4 w-4" aria-hidden="true" /></button>
            ))}
          </div>

          <div className="space-y-1.5" data-return-edit-lines="">
            {items.map((item, index) => {
              const line = draft.lines[index]
              const original = initialDraft(ret).lines[index]
              if (!line) return null
              return (
                <div key={`${item.id ?? index}`} className="rounded-lg border border-gray-200 px-2 py-1.5 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200" title={item.product_name || ''}>{item.product_name}</div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500" title={T('return_edit_qty_locked', "Quantities and the refund can't be changed on this screen yet. To correct an amount, cancel this return and record a new one.")}>
                      <Lock className="h-3 w-3" aria-hidden="true" />×{Number(item.quantity)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={T('stock_action_label', 'Stock handling')}>
                      {ACTIONS.map(({ value, Icon, key, en }) => (
                        <button key={value} type="button" title={T(key, en)} aria-label={T(key, en)} aria-pressed={line.action === value}
                          onClick={() => setLine(index, value === 'damaged'
                            // A line that was not damaged gets the default tag the Worker would use, shown and sent; a damaged one keeps its own until a tag is picked.
                            ? (original.action === 'damaged' ? { action: value } : { action: value, tag: line.tag ?? DEFAULT_STOCK_CONDITION_TAG, tagTouched: true })
                            : { action: value, tag: null, tagTouched: false })}
                          className={`${SEGMENT} ${line.action === value ? SEGMENT_ON : SEGMENT_OFF}`}><Icon className="h-4 w-4" aria-hidden="true" /></button>
                      ))}
                    </div>
                  </div>
                  {line.action === 'damaged' ? (
                    <div className="mt-1.5 max-w-[14rem]">
                      <AppSelect
                        value={line.tagTouched && line.tag ? line.tag : ''}
                        ariaLabel={T('stock_tag_label', 'Tag')}
                        prefix={T('stock_tag_label', 'Tag')}
                        onChange={(next) => setLine(index, { tag: next || null, tagTouched: !!next })}
                        buttonClassName="h-8 w-full text-xs" optionClassName="text-xs"
                        // A tag is always English (owner rule); an untouched damaged line keeps the tag it already has.
                        options={[...(original.action === 'damaged' || !line.tagTouched ? [{ value: '', label: T('return_edit_keep_tag', 'Keep current') }] : []),
                          ...STOCK_CONDITION_TAGS.map((tag) => ({ value: tag, label: tag }))]}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <AppSelect value={reasonChoice} onChange={setReasonChoice} ariaLabel={T('return_reason', 'Return reason')} prefix={T('return_reason', 'Return reason')}
            className="w-full" buttonClassName="h-9 w-full text-sm" menuClassName="min-w-[14rem]" optionClassName="text-sm"
            options={reasons.map((reason) => ({ value: reason, label: reason }))} />
          {reasonChoice === other ? (
            <input className="input h-9 text-sm" value={customReason} aria-label={T('return_reason', 'Return reason')}
              placeholder={T('reason_placeholder', 'Describe the reason…')} onChange={(event: ChangeEvent<HTMLInputElement>) => setCustomReason(event.target.value)} />
          ) : null}
          <textarea className="input resize-none text-sm" rows={2} value={draft.notes} aria-label={T('return_notes', 'Notes')} placeholder={T('return_notes', 'Notes')}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
        </fieldset>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">{T('refund', 'Refund')} {fmtUSD(Number(ret.total_refund_usd) || 0)}</span>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50" disabled={busy || !changed || !finalReason.trim()} onClick={() => { void save() }}>
            <Check className="h-4 w-4" aria-hidden="true" />{T('save', 'Save')}
          </button>
        </div>
      </div>
      {confirmDialog}
    </Modal>
  )
}

/** For someone without full Returns access, or a cancelled return: the reason and the way out, never a dead end. */
export function ReturnEditAsk({ ret, why, onClose, fmtUSD }: { ret: FormReturn; why: 'ask_manager' | 'cancelled'; onClose: () => void; fmtUSD: MoneyFormatter }) {
  const T = useTranslate()
  return (
    <Modal title={`${T('edit_return', 'Edit Return')}${ret.return_number ? ` · ${ret.return_number}` : ''}`} onClose={onClose} size="sm" keyboard unsavedChanges="read-only">
      <div data-return-edit-ask={why}>
        <p className="mb-3 flex items-start gap-2 text-sm leading-relaxed" role="status">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span>{why === 'cancelled' ? T('return_edit_cancelled', 'This return is cancelled. Restore it before editing.') : T('return_edit_ask_manager', 'Ask a manager or admin to edit this return.')}</span>
        </p>
        <div className="flex justify-between text-sm"><span>{T('refund', 'Refund')}</span><span>{fmtUSD(Number(ret.total_refund_usd) || 0)}</span></div>
      </div>
    </Modal>
  )
}
