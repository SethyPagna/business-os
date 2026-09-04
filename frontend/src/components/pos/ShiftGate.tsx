import { useCallback, useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import { fmtDateTime24, parseServerTimestampMs } from '../../utils/formatters.ts'
import { closeShift, fetchCurrentShift, openShift, type Shift, type ShiftState } from '../../api/shiftTransport.ts'

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
  // The shop's own money formatters (they carry the configured currency
  // symbols). Taken from the context rather than re-implemented here, so the
  // drawer figures on this screen are printed exactly as POS prints them.
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
  user?: { id?: string | number | null }
  settings?: { shift_scope_mode?: unknown }
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
const sharedShifts = new Map<string, ShiftState | null>()
const shiftSubscribers = new Set<(key: string, next: ShiftState | null) => void>()
// De-dupes the mount fetch: both components mount together on POS open, and
// without this they would each ask the Worker for the same row.
const shiftInflight = new Map<string, Promise<void>>()

export function shiftCacheKey(userId: unknown, branchId: number | null, scopeMode: unknown): string {
  const user = String(userId ?? 'anonymous')
  const branch = branchId == null ? 'request-branch' : String(branchId)
  const mode = scopeMode === 'shop_wide' ? 'shop_wide' : 'per_account'
  return `${user}:${branch}:${mode}`
}

/** Publish a new shift state to every mounted consumer. Writes call this. */
export function publishShift(key: string, next: ShiftState | null) {
  sharedShifts.set(key, next)
  for (const notify of shiftSubscribers) notify(key, next)
}

function useSharedShift(branchId: number | null, userId: unknown, scopeMode: unknown) {
  const key = shiftCacheKey(userId, branchId, scopeMode)
  const [state, setState] = useState<ShiftState | null>(() => sharedShifts.get(key) ?? null)

  useEffect(() => {
    setState(sharedShifts.get(key) ?? null)
    const subscriber = (changedKey: string, next: ShiftState | null) => {
      if (changedKey === key) setState(next)
    }
    shiftSubscribers.add(subscriber)
    return () => { shiftSubscribers.delete(subscriber) }
  }, [key])

  const refresh = useCallback(() => {
    if (!shiftInflight.has(key)) {
      const request = fetchCurrentShift(branchId)
        .then((next) => { publishShift(key, next) })
        // Leave the shared state null. A read failure must NOT be treated as
        // "registered" -- that would silently skip the prompt for the whole
        // day. Null shows nothing yet and the next open re-asks.
        .catch(() => { publishShift(key, null) })
        .finally(() => { shiftInflight.delete(key) })
      shiftInflight.set(key, request)
    }
    return shiftInflight.get(key) as Promise<void>
  }, [branchId, key])

  useEffect(() => { void refresh() }, [refresh])

  return { state, refresh, publish: (next: ShiftState | null) => publishShift(key, next) }
}

/**
 * The wall clock, re-read while a shift panel is on screen.
 *
 * Both panels have to name a moment that has NOT been written yet: the
 * registration prompt shows the instant `POST /open` will stamp, and the close
 * panel shows the instant `POST /close` will stamp -- both are
 * `new Date().toISOString()` taken server-side at the moment the request
 * lands. A value frozen when the panel opened would be wrong by however long
 * the cashier spends counting the drawer, and the till would print a closing
 * time that is not the one stored. 30 s keeps the displayed HH:mm honest
 * without re-rendering a modal every second, and the interval only runs while
 * `active`, so a closed panel costs nothing.
 */
function useWallClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => { window.clearInterval(timer) }
  }, [active])
  return now
}

/**
 * "8 hr 47 min" between an opening timestamp and a later instant.
 *
 * Hours and minutes rather than a bare HH:mm, because "08:47" next to two real
 * clock times reads as a third clock time. parseServerTimestampMs is used
 * rather than Date.parse so a timezone-less server stamp is read as UTC --
 * `opened_at` is ISO today, but the same row is also what a future reader
 * (a report, an export) would hand this function.
 */
function formatShiftDuration(openedAt: string | null | undefined, endMs: number, t: (key: string) => string): string {
  const startMs = parseServerTimestampMs(openedAt)
  if (!Number.isFinite(startMs) || endMs < startMs) return '—'
  const minutes = Math.floor((endMs - startMs) / 60_000)
  return `${Math.floor(minutes / 60)} ${t('shift_hours_short')} ${minutes % 60} ${t('shift_minutes_short')}`
}

/**
 * One labelled row of the shift's own facts.
 *
 * `leading-relaxed` is not decoration: Khmer stacks diacritics above and below
 * the base glyph, and a line box sized to Latin text clips them -- these
 * labels are Khmer for half the shop.
 */
function ShiftFactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 leading-relaxed">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-800 dark:text-gray-100 text-right">{value}</span>
    </div>
  )
}

export default function ShiftGate({ children, branchId = null, branchName = null }: { children?: React.ReactNode; branchId?: number | null; branchName?: string | null }) {
  // Branch identity is supplied by the till. Until the POS owner wires that
  // existing active-branch value into this prop, null retains the route's
  // legacy unscoped behavior without inventing a branch from unrelated state.
  const { t, notify, user, settings } = useApp() as ShiftGateContext
  const { state, publish } = useSharedShift(branchId, user?.id, settings?.shift_scope_mode)
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
      publish(next)
      // The toast carries the moment that was actually STAMPED, not the one
      // this screen predicted a second ago: the gate unmounts on success, so
      // this is the only confirmation the employee gets of what was written.
      const openedAt = next.shift?.opened_at ? ` ${fmtDateTime24(next.shift.opened_at)}` : ''
      notify(next.already_registered
        ? `${t('shift_already_registered')}${openedAt}`
        : `${t('shift_registered')}${openedAt}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : t('shift_register_failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const needsRegistration = state?.needs_registration === true
  const now = useWallClock(needsRegistration)

  return (
    <>
      {children}
      {needsRegistration && (
        <Modal
          title={t('shift_register_title')}
          size="sm"
          onClose={() => { /* intentionally not dismissible -- see the file comment */ }}
          unsavedChanges={{ dirty: floatUsd.trim() !== '' || floatKhr.trim() !== '' || note.trim() !== '' }}
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {t('shift_register_hint')}
            </p>

            {/* The shift's own clock, from first paint. A shift is a span
                between two moments, and this screen is where the first one is
                set -- showing the instant that is about to be stamped is what
                lets an employee opening the till at 08:02 notice a device
                whose clock says 23:40 BEFORE the whole day is filed under
                yesterday. */}
            <div className="rounded border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1">
              <ShiftFactRow label={t('shift_starts_at')} value={fmtDateTime24(now)} />
            </div>

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
 * The TRIGGER renders nothing unless a shift is currently open, which is what
 * makes "end only once" visible in the UI as well as enforced in the statement:
 * once ended, there is no button to press a second time.
 *
 * The PANEL outlives that condition on purpose. A closed shift is a span --
 * opened at one moment, closed at another -- and the closing moment does not
 * exist until the server stamps it, so the only place it can be shown is on
 * the response to the close. When this component still unmounted itself the
 * instant `can_end` went false, that response was thrown away and the cashier
 * was left with a bare "Shift ended." toast: the open time leaked out through
 * the shift code and the close time was never displayed anywhere at all
 * (owner, 2026-09-04: "sales open and closing time... currently, it only shows
 * open time"). So the close keeps the panel up and turns it into the summary
 * of what was written -- before and after, side by side.
 */
export function EndShiftButton({ onEnded, branchId = null }: { onEnded?: () => void; branchId?: number | null }) {
  const { t, notify, fmtUSD, fmtKHR, user, settings } = useApp() as ShiftGateContext

  const { state, publish } = useSharedShift(branchId, user?.id, settings?.shift_scope_mode)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [countedUsd, setCountedUsd] = useState('')
  const [countedKhr, setCountedKhr] = useState('')
  const [note, setNote] = useState('')
  // The row the server wrote, held for the summary. Set only after a close
  // that actually returned a shift, and it is what keeps the panel mounted
  // once `can_end` has gone false.
  const [closed, setClosed] = useState<Shift | null>(null)

  const now = useWallClock(open && !closed)
  const shift = closed || state?.shift || null

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
      publish(next)
      // Stay open on the summary. A shift with no row back (a shape the
      // transport permits but the route does not produce) has nothing to
      // summarise, so that one case closes as before rather than showing an
      // empty panel.
      if (next.shift) setClosed(next.shift)
      else setOpen(false)
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

  const dismiss = () => {
    setOpen(false)
    setClosed(null)
    setCountedUsd('')
    setCountedKhr('')
    setNote('')
  }

  const money = (usd: unknown, khr: unknown) => `${fmtUSD(usd)} · ${fmtKHR(khr)}`

  // No open shift AND no summary to show: this control has nothing to do.
  if (!state?.can_end && !closed) return null

  return (
    <>
      {state?.can_end && (
        <button
          type="button" onClick={() => setOpen(true)}
          className="rounded border px-3 py-1.5 text-sm font-medium"
          title={state.shift?.opened_at ? `${t('shift_opened_at')}: ${fmtDateTime24(state.shift.opened_at)}` : undefined}
        >
          {t('shift_end')}
        </button>
      )}
      {open && (
        <Modal
          title={closed ? t('shift_summary_title') : t('shift_end')}
          size="sm"
          onClose={dismiss}
          // Once the close is written there is nothing unsaved left to lose,
          // so dismissing the summary must not raise a discard prompt.
          unsavedChanges={{ dirty: !closed && (countedUsd.trim() !== '' || countedKhr.trim() !== '' || note.trim() !== '') }}
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {closed ? t('shift_summary_hint') : t('shift_end_hint')}
            </p>

            {shift && (
              // The shift's two moments and the drawer it started with, from
              // first paint -- before the close as the times it WILL be filed
              // under, after the close as the times it WAS. The operator is
              // reconciling against the opening float, and making them
              // remember it invites a wrong count.
              <div className="rounded border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1">
                {shift.shift_code && <ShiftFactRow label={t('shift_code')} value={shift.shift_code} />}
                <ShiftFactRow label={t('shift_opened_at')} value={fmtDateTime24(shift.opened_at)} />
                <ShiftFactRow
                  // Before the close this is the clock, labelled as the moment
                  // about to be stamped; after it, the moment that was.
                  label={closed ? t('shift_closed_at') : t('shift_ends_at')}
                  value={fmtDateTime24(closed?.closed_at || now)}
                />
                <ShiftFactRow
                  label={closed ? t('shift_duration') : t('shift_open_for')}
                  value={formatShiftDuration(shift.opened_at, parseServerTimestampMs(closed?.closed_at) || now, t)}
                />
                <ShiftFactRow
                  label={t('shift_opened_with')}
                  value={money(shift.opening_float_usd, shift.opening_float_khr)}
                />
                {closed && (
                  // The after half of the before/after: what was counted into
                  // the drawer against what it opened with, on the same row
                  // shape so the two are read as one comparison.
                  <ShiftFactRow
                    label={t('shift_counted_close')}
                    value={money(closed.closing_counted_usd, closed.closing_counted_khr)}
                  />
                )}
                {closed?.closing_note && <ShiftFactRow label={t('note')} value={closed.closing_note} />}
              </div>
            )}

            {!closed && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs font-medium mb-1 leading-relaxed">{t('shift_counted_usd')}</span>
                    <input
                      type="number" inputMode="decimal" min="0" step="0.01"
                      className="w-full rounded border px-2 py-1.5 text-sm"
                      value={countedUsd} onChange={(e) => setCountedUsd(e.target.value)} autoFocus
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-medium mb-1 leading-relaxed">{t('shift_counted_khr')}</span>
                    <input
                      type="number" inputMode="numeric" min="0" step="100"
                      className="w-full rounded border px-2 py-1.5 text-sm"
                      value={countedKhr} onChange={(e) => setCountedKhr(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="block text-xs font-medium mb-1 leading-relaxed">{t('note')}</span>
                  <input
                    type="text" className="w-full rounded border px-2 py-1.5 text-sm"
                    value={note} onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {closed ? (
                <button type="button" onClick={dismiss} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                  {t('done')}
                </button>
              ) : (
                <>
                  <button type="button" onClick={dismiss} className="rounded border px-3 py-2 text-sm">
                    {t('back')}
                  </button>
                  <button
                    type="button" disabled={busy} onClick={() => void submitClose()}
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {busy ? t('saving_label') : t('shift_end')}
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
