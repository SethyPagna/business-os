import { useCallback, useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import { closeShift, fetchCurrentShift, openShift, type ShiftState } from '../../api/shiftTransport.ts'

/**
 * S4R4-5 -- the cash-drawer shift gate for POS.
 *
 * Owner's rule (2026-09-04): the first use of POS each day prompts the
 * employee to register the drawer's opening float and keeps prompting until
 * they do; registration happens once per day; ending the shift is manual and
 * happens once.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not render a stub that expands once a field is answered. The
 *    real form is there from first paint, both currency fields visible,
 *    per the standing no-progressive-float rule.
 *  - It does not let the operator dismiss the prompt. There is no ✕ and no
 *    backdrop-close, because "will prompt until it is registered" is the whole
 *    requirement -- a closable prompt is one the till never registers. Modal's
 *    onClose is wired to a no-op rather than removed, so the component keeps
 *    the shared chrome and does not grow its own.
 *
 * The gate renders its children (if any) regardless. It overlays the prompt
 * rather than replacing POS, so a cashier can still see the screen they are
 * being asked to open -- and so a transport failure never leaves them staring
 * at a blank page. POS mounts it bare, <ShiftGate />, alongside its other
 * overlays; the children prop is there for a caller that would rather wrap.
 */
// useApp() is typed `unknown` at its source; each component casts to the
// slice it uses. This is ours, and it is the whole of it.
type ShiftGateContext = {
  t: (key: string) => string
  notify: (message: unknown, type?: string, duration?: number) => void
}

/**
 * ONE shift state, shared by every mounted consumer.
 *
 * Why this exists: ShiftGate and EndShiftButton are separate components that
 * both describe the same server row. When each held its own useState and
 * fetched once on mount, the button asked BEFORE the shift existed, got
 * can_end:false, rendered nothing -- and never asked again. Registering the
 * shift updated only the gate’s copy, so the End Shift control stayed invisible
 * for the rest of the session and came back only on a full page reload. That is
 * the defect the owner reported on 2026-09-04: "shift are not seen with option
 * to close shift".
 *
 * Two components describing one row must not keep two copies of it. Every read
 * and every write goes through here, so a registration or a close is visible to
 * both immediately.
 */
let sharedShift: ShiftState | null = null
const shiftSubscribers = new Set<(next: ShiftState | null) => void>()
// De-dupes the mount fetch: both components mount together on POS open, and
// without this they would each ask the Worker for the same row.
let shiftInFlight: Promise<void> | null = null

/** Publish a new shift state to every mounted consumer. Writes call this. */
export function publishShift(next: ShiftState | null) {
  sharedShift = next
  for (const notify of shiftSubscribers) notify(next)
}

function useSharedShift(branchId: number | null) {
  const [state, setState] = useState<ShiftState | null>(sharedShift)

  useEffect(() => {
    shiftSubscribers.add(setState)
    return () => { shiftSubscribers.delete(setState) }
  }, [])

  const refresh = useCallback(() => {
    if (!shiftInFlight) {
      shiftInFlight = fetchCurrentShift(branchId)
        .then((next) => { publishShift(next) })
        // Leave the shared state null. A read failure must NOT be treated as
        // "registered" -- that would silently skip the prompt for the whole
        // day. Null shows nothing yet and the next open re-asks.
        .catch(() => { publishShift(null) })
        .finally(() => { shiftInFlight = null })
    }
    return shiftInFlight
  }, [branchId])

  useEffect(() => { void refresh() }, [refresh])

  return { state, refresh }
}

export default function ShiftGate({ children }: { children?: React.ReactNode }) {
  // useApp() is fully typed -- no cast. It carries no till branch today, so the
  // branch is left null and the Worker falls back to the request's own
  // X-Branch-Id (routes/shifts.ts, branchIdFrom). Casting a branch_id onto the
  // context to read it here would have compiled and always been undefined,
  // which is the same null by a route that hides the fact.
  const { t, notify } = useApp() as ShiftGateContext
  // The context carries no till branch today, so the branch is left null and
  // the Worker falls back to the request's own X-Branch-Id header
  // (routes/shifts.ts, branchIdFrom). Naming a branch_id in the cast above
  // would compile and always read undefined -- the same null, by a route that
  // hides the fact.
  const branchId = null
  const branchName = null

  const { state } = useSharedShift(branchId)
  const [busy, setBusy] = useState(false)
  const [floatUsd, setFloatUsd] = useState('')
  const [floatKhr, setFloatKhr] = useState('')
  const [note, setNote] = useState('')


  const submitOpen = async () => {
    if (busy) return
    setBusy(true)
    try {
      const next = await openShift({
        branchId,
        branchName,
        openingFloatUsd: Number(floatUsd) || 0,
        openingFloatKhr: Number(floatKhr) || 0,
        openingNote: note.trim() || null,
      })
      // Publish, not setState: this is what makes End Shift appear the moment
      // the drawer is registered, instead of only after a reload.
      publishShift(next)
      notify(next.already_registered
        ? t('shift_already_registered')
        : t('shift_registered'))
    } catch (e) {
      notify(e instanceof Error ? e.message : t('shift_register_failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const needsRegistration = state?.needs_registration === true

  return (
    <>
      {children}
      {needsRegistration && (
        <Modal
          title={t('shift_register_title')}
          size="sm"
          onClose={() => { /* intentionally not dismissible -- see the file comment */ }}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('shift_register_hint')}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium mb-1">{t('shift_float_usd')}</span>
                <input
                  type="number" inputMode="decimal" min="0" step="0.01"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                  value={floatUsd} onChange={(e) => setFloatUsd(e.target.value)} autoFocus
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium mb-1">{t('shift_float_khr')}</span>
                <input
                  type="number" inputMode="numeric" min="0" step="100"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                  value={floatKhr} onChange={(e) => setFloatKhr(e.target.value)}
                />
              </label>
            </div>
            {/* Both currencies are counted and stored separately, never
                converted -- the drawer holds each and the shop counts each. */}

            <label className="block">
              <span className="block text-xs font-medium mb-1">{t('note')}</span>
              <input
                type="text" className="w-full rounded border px-2 py-1.5 text-sm"
                value={note} onChange={(e) => setNote(e.target.value)}
              />
            </label>

            {/* Save sits at the end of the panel, matching the standing
                buttons-at-the-bottom rule. There is no Cancel: the prompt is
                not dismissible. */}
            <div className="flex justify-end pt-1">
              <button
                type="button" disabled={busy} onClick={() => void submitOpen()}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? t('saving_label') : t('shift_start')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * The manual End Shift control. Separate export so POS can place it in its own
 * header rather than having the gate decide layout.
 *
 * It renders nothing unless a shift is currently open, which is what makes
 * "end only once" visible in the UI as well as enforced in the statement: once
 * closed, there is no button to press a second time.
 */
export function EndShiftButton({ onEnded }: { onEnded?: () => void }) {
  const { t, notify } = useApp() as ShiftGateContext
  const branchId = null

  const { state } = useSharedShift(branchId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [countedUsd, setCountedUsd] = useState('')
  const [countedKhr, setCountedKhr] = useState('')
  const [note, setNote] = useState('')


  const submitClose = async () => {
    if (busy) return
    setBusy(true)
    try {
      const next = await closeShift({
        branchId,
        closingCountedUsd: Number(countedUsd) || 0,
        closingCountedKhr: Number(countedKhr) || 0,
        closingNote: note.trim() || null,
      })
      publishShift(next)
      setOpen(false)
      notify(next.already_closed
        ? t('shift_already_ended')
        : t('shift_ended'))
      onEnded?.()
    } catch (e) {
      notify(e instanceof Error ? e.message : t('shift_end_failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!state?.can_end) return null

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)}
        className="rounded border px-3 py-1.5 text-sm font-medium"
      >
        {t('shift_end')}
      </button>
      {open && (
        <Modal title={t('shift_end')} size="sm" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t('shift_end_hint')}
            </p>
            {state.shift && (
              // Showing the opening float next to the closing count is the
              // whole point of the screen -- the operator is reconciling
              // against it, and making them remember it invites a wrong count.
              <p className="text-xs text-gray-500">
                {t('shift_opened_with')}{' '}
                {state.shift.opening_float_usd} USD · {state.shift.opening_float_khr} KHR
                {state.shift.shift_code ? ` · ${state.shift.shift_code}` : ''}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium mb-1">{t('shift_counted_usd')}</span>
                <input
                  type="number" inputMode="decimal" min="0" step="0.01"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                  value={countedUsd} onChange={(e) => setCountedUsd(e.target.value)} autoFocus
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium mb-1">{t('shift_counted_khr')}</span>
                <input
                  type="number" inputMode="numeric" min="0" step="100"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                  value={countedKhr} onChange={(e) => setCountedKhr(e.target.value)}
                />
              </label>
            </div>
            <label className="block">
              <span className="block text-xs font-medium mb-1">{t('note')}</span>
              <input
                type="text" className="w-full rounded border px-2 py-1.5 text-sm"
                value={note} onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-2 text-sm">
                {t('back')}
              </button>
              <button
                type="button" disabled={busy} onClick={() => void submitClose()}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? t('saving_label') : t('shift_end')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
