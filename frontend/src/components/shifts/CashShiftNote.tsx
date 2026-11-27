import { useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import { openShift, reopenShift, shiftOpeningCounts, type ShiftState } from '../../api/shiftTransport.ts'
import { useSavingGate } from '../../utils/useSavingGate.ts'
import { parsePaymentMethodKinds } from '../../utils/paymentMethodKind.ts'
import type { CashDirection, CashTenderRow } from '../../utils/cashShiftRule.ts'
import { SHIFT_STATE_CHANGED_EVENT, useSharedShift } from '../pos/ShiftGate'
import { cashShiftNoteText, posCashShiftGate, type PosCashShiftGate } from '../pos/posCashShiftGate.ts'
import ShiftCountPair, { ShiftSubmitRow, shiftCountBlockerKey } from './ShiftCountFields.tsx'
import { shiftCountIssue } from './shiftCountRules.ts'

type Gate = Extract<PosCashShiftGate, { kind: 'block' }>
type NoteContext = {
  t: (key: string) => string
  notify: (message: unknown, type?: string, duration?: number) => void
  user?: { id?: string | number | null }
  settings?: { shift_scope_mode?: unknown; pos_payment_method_kinds?: unknown }
}

/**
 * The cash-needs-a-shift gate for a form that takes or gives cash at one branch (a later payment, a return, an exchange).
 * One GET /api/shifts/current per branch, shared with the POS through the shift store. `gate.kind` is `block` only when
 * the form's own branch row proves the refusal; anything else is left to the Worker.
 */
export function useCashShiftGate(branchId: number | null, rows: readonly CashTenderRow[]) {
  const { user, settings } = useApp() as NoteContext
  const shared = useSharedShift(branchId, user?.id, settings?.shift_scope_mode)
  const kinds = parsePaymentMethodKinds(settings?.pos_payment_method_kinds)
  const gate = posCashShiftGate(shared.state, branchId, branchId, rows, kinds)
  return { gate, state: shared.state, publish: shared.publish }
}

/**
 * The note beside a blocked cash action: the reason, then the way through. No shift today: the opening-cash form (`canOpenHere`
 * false on the POS, where its own non-dismissible opening prompt is already the way through, so there is never a second prompt).
 * Closed today: Reopen when the account may (the opener or an administrator), otherwise who to ask.
 */
export default function CashShiftNote({ gate, state, branchId, branchName = null, direction = 'in', canOpenHere = true, className = '' }: {
  gate: PosCashShiftGate
  state: ShiftState | null
  branchId: number | null
  branchName?: string | null
  direction?: CashDirection
  canOpenHere?: boolean
  className?: string
}) {
  const { t } = useApp() as NoteContext
  const [form, setForm] = useState<'open' | 'reopen' | null>(null)
  if (gate.kind !== 'block') return null
  const block: Gate = gate
  const showOpen = block.action === 'open' && canOpenHere
  const showReopen = block.action === 'reopen' && !!state?.shift
  return (
    <div data-cash-shift-note={block.shiftState} role="status" className={`flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200 ${className}`}>
      <span className="min-w-0 flex-1">{cashShiftNoteText(block, direction, t)}</span>
      {showOpen ? <button type="button" className="btn-secondary min-h-0 h-8 px-3 py-0 text-xs" onClick={() => setForm('open')}>{t('shift_start')}</button> : null}
      {showReopen ? <button type="button" className="btn-secondary min-h-0 h-8 px-3 py-0 text-xs" onClick={() => setForm('reopen')}>{t('shift_action_reopen')}</button> : null}
      {form === 'open' ? <OpenForm branchId={branchId} branchName={branchName} onDone={() => setForm(null)} /> : null}
      {form === 'reopen' && state?.shift ? <ReopenForm shift={state.shift} onDone={() => setForm(null)} /> : null}
    </div>
  )
}

function OpenForm({ branchId, branchName, onDone }: { branchId: number | null; branchName: string | null; onDone: () => void }) {
  const { t, notify } = useApp() as NoteContext
  const savingGate = useSavingGate()
  const [usd, setUsd] = useState('')
  const [khr, setKhr] = useState('')
  const [busy, setBusy] = useState(false)
  const blocker = shiftCountIssue(usd, khr, { blankMeansUncounted: true })
  const submit = async () => {
    if (busy || blocker) return
    if (savingGate.blocked) return notify(savingGate.reason, 'error')
    setBusy(true)
    try {
      const opening = shiftOpeningCounts(usd, khr)
      await openShift({ branchId, branchName, openingFloatUsd: opening.usd, openingFloatKhr: opening.khr, openingNote: null })
      window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))
      notify(t('shift_registered'))
      onDone()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('shift_register_failed'), 'error')
    } finally { setBusy(false) }
  }
  return (
    <Modal title={t('shift_register_title')} size="sm" onClose={() => { if (!busy) onDone() }} unsavedChanges={{ dirty: usd.trim() !== '' || khr.trim() !== '' }}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{t('shift_register_hint')}</p>
        <ShiftCountPair dense autoFocus disabled={busy} label={t('shift_opening_cash')} usdLabel={t('shift_float_usd')} khrLabel={t('shift_float_khr')} usd={usd} khr={khr} onUsd={setUsd} onKhr={setKhr} />
        <ShiftSubmitRow reason={savingGate.blocked ? savingGate.reason : blocker ? t(shiftCountBlockerKey(blocker)) : null} busy={busy} label={t('shift_start')} onClick={() => void submit()} />
      </div>
    </Modal>
  )
}

function ReopenForm({ shift, onDone }: { shift: NonNullable<ShiftState['shift']>; onDone: () => void }) {
  const { t, notify, user } = useApp() as NoteContext
  const savingGate = useSavingGate()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const needsCount = shift.closing_counted_usd == null && shift.closing_counted_khr == null
  const blocker = savingGate.blocked ? savingGate.reason : !reason.trim() ? t('shift_reopen_reason') : needsCount ? t('shift_reopen_needs_count') : null
  const submit = async () => {
    if (busy || blocker) return
    setBusy(true)
    try {
      await reopenShift(shift.id, { actorId: user?.id ?? undefined, expectedRevision: shift.revision, reason: reason.trim(), openingFloatUsd: shift.closing_counted_usd ?? null, openingFloatKhr: shift.closing_counted_khr ?? null, openingNote: null })
      window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))
      notify(t('shift_reopen_saved'))
      onDone()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('shift_reopen_failed'), 'error')
    } finally { setBusy(false) }
  }
  return (
    <Modal title={t('shift_reopen_title')} size="sm" onClose={() => { if (!busy) onDone() }} unsavedChanges={{ dirty: reason.trim() !== '' }}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{t('shift_reopen_hint')}</p>
        <label className="block text-xs font-semibold">{t('shift_reopen_reason')}
          <textarea className="input mt-1 min-h-20" required autoFocus disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <ShiftSubmitRow reason={blocker} busy={busy} label={t('shift_action_reopen')} onClick={() => void submit()} />
      </div>
    </Modal>
  )
}

/** The cash a return hands back needs an open shift at the branch it leaves from (owner, 27 Nov 2026). Mount it only when cash goes out. */
export function CashOutShiftNote({ branchId, branchName = null, usd, className = '' }: { branchId: number | null; branchName?: string | null; usd: number; className?: string }) {
  const { gate, state } = useCashShiftGate(branchId, [{ method: 'Cash', amount_usd: usd, amount_khr: 0 }])
  return <CashShiftNote gate={gate} state={state} branchId={branchId} branchName={branchName} direction="out" className={className} />
}
