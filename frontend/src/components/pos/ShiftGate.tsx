import { useCallback, useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'
import { fmtDateTime24, parseServerTimestampMs } from '../../utils/formatters.ts'
import { closeShift, fetchCurrentShift, openShift, shiftCountOrZero, shiftCountPairBlocker, type Shift, type ShiftState } from '../../api/shiftTransport.ts'
import ShiftCashBreakdown from '../shifts/ShiftCashBreakdown.tsx'
import ShiftCountPair, { ShiftSubmitRow, shiftCountBlockerKey } from '../shifts/ShiftCountFields.tsx'

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
 * And one thing it stopped doing on 2026-09-06: refusing silently. The Start
 * and End buttons used to be `disabled` until BOTH currencies were typed, with
 * nothing on screen saying so (owner: "it did not allow to continue when
 * save ... i had to enter the usd as well as khmer riel"). A blank count is
 * now recorded as 0 -- the field's placeholder and the hint under the pair say
 * so -- the action is allowed once either field has a value, and whenever it
 * cannot proceed the reason is printed beside the button (ShiftSubmitRow).
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
const sharedShiftFailures = new Set<string>()
const shiftSubscribers = new Set<(key: string, next: ShiftState | null) => void>()
// De-dupes the mount fetch: both components mount together on POS open, and
// without this they would each ask the Worker for the same row.
const shiftInflight = new Map<string, Promise<void>>()
export const SHIFT_BRANCH_CHANGED_EVENT = 'business-os:pos-branch-changed'
export const SHIFT_STATE_CHANGED_EVENT = 'business-os:shift-state-changed'

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

export function useSharedShift(branchId: number | null, userId: unknown, scopeMode: unknown) {
  const key = shiftCacheKey(userId, branchId, scopeMode)
  const [loadedKey, setLoadedKey] = useState(key)
  const [state, setState] = useState<ShiftState | null>(() => sharedShifts.get(key) ?? null)
  const [loading, setLoading] = useState(() => !sharedShifts.has(key))
  const [failed, setFailed] = useState(() => sharedShiftFailures.has(key))

  useEffect(() => {
    setLoadedKey(key)
    setState(sharedShifts.get(key) ?? null)
    setLoading(!sharedShifts.has(key))
    setFailed(sharedShiftFailures.has(key))
    const subscriber = (changedKey: string, next: ShiftState | null) => {
      if (changedKey === key) {
        setState(next)
        setLoading(false)
        setFailed(sharedShiftFailures.has(key))
      }
    }
    shiftSubscribers.add(subscriber)
    return () => { shiftSubscribers.delete(subscriber) }
  }, [key])

  const refresh = useCallback(() => {
    setLoading(true)
    if (!shiftInflight.has(key)) {
      const request = fetchCurrentShift(branchId)
        .then((next) => { sharedShiftFailures.delete(key); publishShift(key, next) })
        // Leave the shared state null. A read failure must NOT be treated as
        // "registered" -- that would silently skip the prompt for the whole
        // day. Null shows nothing yet and the next open re-asks.
        .catch(() => { sharedShiftFailures.add(key); publishShift(key, null) })
        .finally(() => { shiftInflight.delete(key) })
      shiftInflight.set(key, request)
    }
    return shiftInflight.get(key) as Promise<void>
  }, [branchId, key])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const refreshChangedShift = () => { void refresh() }
    window.addEventListener(SHIFT_STATE_CHANGED_EVENT, refreshChangedShift)
    return () => { window.removeEventListener(SHIFT_STATE_CHANGED_EVENT, refreshChangedShift) }
  }, [refresh])

  const publish = (next: ShiftState | null) => {
    sharedShiftFailures.delete(key)
    publishShift(key, next)
  }

  // A branch/user change renders before its effect: hide the previous row.
  // A specific branch must never populate the distinct unassigned cache.
  return { state: loadedKey === key ? state : null, loading: loadedKey !== key || loading,
    failed: loadedKey === key && failed, refresh, publish }
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

type ShiftFact = { label: string; value: React.ReactNode }

/**
 * The shift's own facts as a compact strip: two columns of label-over-value
 * cells on an ivory ground, so the clock, the duration and the drawer figures
 * are read at a glance instead of as a list of sentences.
 *
 * `leading-relaxed` is not decoration: Khmer stacks diacritics above and below
 * the base glyph, and a line box sized to Latin text clips them -- these
 * labels are Khmer for half the shop. Two columns hold at 375px because the
 * longest value is a 16-character date-time; money pairs may wrap to a second
 * line inside their cell, which is what `break-words` is for.
 */
function ShiftFactStrip({ facts, accent = false }: { facts: Array<ShiftFact | null | false>; accent?: boolean }) {
  const shown = facts.filter((fact): fact is ShiftFact => !!fact)
  return (
    <dl className={`grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border px-3 py-2 ${
      accent
        ? 'border-[color-mix(in_srgb,var(--ui-accent,#9c7a3c)_35%,transparent)] bg-[color-mix(in_srgb,var(--ui-accent,#9c7a3c)_10%,transparent)]'
        : 'border-black/10 bg-stone-50 dark:border-white/10 dark:bg-zinc-800/60'
    }`}
    >
      {shown.map((fact) => (
        <div key={fact.label} className="min-w-0 leading-relaxed">
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">{fact.label}</dt>
          <dd className="break-words text-[13px] font-medium tabular-nums text-zinc-800 dark:text-zinc-100">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// The admin density: 32px controls, 13px text. 36px under 640px for touch.
const DENSE_BUTTON = 'btn-primary min-h-0 h-9 px-3 py-0 text-[13px] sm:h-8'
const DENSE_TEXT_INPUT = 'h-10 text-base sm:h-8 sm:text-[13px] w-full rounded-lg border border-gray-300 bg-white px-2.5 text-zinc-900 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

/**
 * The optional note, folded behind one small affordance until it is wanted.
 * Most shifts carry no note, and an always-open text field is a third box
 * competing with the two that matter. Once the note has text it stays open,
 * so a typed note is never hidden behind its own toggle.
 */
function NoteFold({ note, onChange, disabled }: { note: string; onChange: (value: string) => void; disabled: boolean }) {
  const { t } = useApp() as ShiftGateContext
  const [opened, setOpened] = useState(false)
  if (!opened && note.trim() === '') {
    return (
      <button
        type="button" onClick={() => setOpened(true)} disabled={disabled}
        className="text-xs font-medium text-[color:var(--ui-accent,#9c7a3c)] hover:underline disabled:opacity-50"
      >
        + {t('shift_add_note')}
      </button>
    )
  }
  return (
    <label className="block">
      <span className="block text-xs font-medium leading-relaxed text-zinc-700 dark:text-zinc-200">{t('note')}</span>
      <input
        type="text" className={`mt-1 ${DENSE_TEXT_INPUT}`} autoFocus={opened}
        value={note} onChange={(event) => onChange(event.target.value)} disabled={disabled}
      />
    </label>
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

  // Null once either field holds a valid count; otherwise the reason that is
  // printed beside the Start button. Blank fields are 0 at submit.
  const startBlocker = shiftCountPairBlocker(floatUsd, floatKhr)

  const submitOpen = async () => {
    if (busy) return
    const openingFloatUsd = shiftCountOrZero(floatUsd)
    const openingFloatKhr = shiftCountOrZero(floatKhr)
    if (openingFloatUsd == null || openingFloatKhr == null || startBlocker) return
    setBusy(true)
    try {
      const next = await openShift({
        branchId,
        branchName,
        openingFloatUsd,
        openingFloatKhr,
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
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              {t('shift_register_hint')}
            </p>

            {/* The shift's own clock, from first paint. A shift is a span
                between two moments, and this screen is where the first one is
                set -- showing the instant that is about to be stamped is what
                lets an employee opening the till at 08:02 notice a device
                whose clock says 23:40 BEFORE the whole day is filed under
                yesterday. */}
            <ShiftFactStrip facts={[
              { label: t('shift_starts_at'), value: fmtDateTime24(now) },
              branchName ? { label: t('branch'), value: branchName } : null,
            ]}
            />

            {/* Both currencies are counted and stored separately, never
                converted -- the drawer holds each and the shop counts each.
                A blank one is 0, and the pair says so. */}
            <ShiftCountPair
              dense autoFocus disabled={busy}
              label={t('shift_opening_cash')} usdLabel={t('shift_float_usd')} khrLabel={t('shift_float_khr')}
              usd={floatUsd} khr={floatKhr} onUsd={setFloatUsd} onKhr={setFloatKhr}
            />

            <NoteFold note={note} onChange={setNote} disabled={busy} />

            {/* Save sits at the end of the panel, matching the standing
                buttons-at-the-bottom rule. There is no Cancel: the prompt is
                not dismissible. When Start cannot proceed, the row says why. */}
            <ShiftSubmitRow
              reason={startBlocker ? t(shiftCountBlockerKey(startBlocker)) : null}
              busy={busy} label={t('shift_start')} onClick={() => void submitOpen()}
              buttonClassName={DENSE_BUTTON}
            />
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
  const canCloseCurrent = state?.is_open === true && state.shift?.capabilities.can_close === true
  const endBlocker = shiftCountPairBlocker(countedUsd, countedKhr)

  const submitClose = async () => {
    if (busy) return
    const closingCountedUsd = shiftCountOrZero(countedUsd)
    const closingCountedKhr = shiftCountOrZero(countedKhr)
    if (closingCountedUsd == null || closingCountedKhr == null || endBlocker) return
    setBusy(true)
    try {
      const next = await closeShift({
        branchId,
        closingCountedUsd,
        closingCountedKhr,
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
  // What the cashier has typed so far, blanks as 0 -- shown beside the
  // server's EXPECTED figure so the two are compared before the close is
  // written. The difference itself is NOT computed here: that is the server's
  // one reconciliation, and it appears on the summary once the close returns.
  const typedDrawer = endBlocker === 'invalid'
    ? '—'
    : money(shiftCountOrZero(countedUsd) ?? 0, shiftCountOrZero(countedKhr) ?? 0)

  // No open shift AND no summary to show: this control has nothing to do.
  if (!canCloseCurrent && !closed) return null

  return (
    <>
      {canCloseCurrent && (
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
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              {closed ? t('shift_summary_hint') : t('shift_end_hint')}
            </p>

            {shift && (
              // The shift's two moments and the drawer it started with, from
              // first paint -- before the close as the times it WILL be filed
              // under, after the close as the times it WAS. The operator is
              // reconciling against the opening float, and making them
              // remember it invites a wrong count.
              <ShiftFactStrip facts={[
                !!shift.shift_code && { label: t('shift_code'), value: shift.shift_code },
                { label: t('shift_opened_at'), value: fmtDateTime24(shift.opened_at) },
                // Before the close this is the clock, labelled as the moment
                // about to be stamped; after it, the moment that was.
                { label: closed ? t('shift_closed_at') : t('shift_ends_at'), value: fmtDateTime24(closed?.closed_at || now) },
                { label: closed ? t('shift_duration') : t('shift_open_for'), value: formatShiftDuration(shift.opened_at, parseServerTimestampMs(closed?.closed_at) || now, t) },
                { label: t('shift_opened_with'), value: money(shift.opening_float_usd, shift.opening_float_khr) },
                // The after half of the before/after: what was counted into
                // the drawer against what it opened with, on the same cell
                // shape so the two are read as one comparison.
                !!closed && { label: t('shift_counted_close'), value: money(closed.closing_counted_usd, closed.closing_counted_khr) },
                !!closed?.closing_note && { label: t('note'), value: closed.closing_note },
              ]}
              />
            )}

            {/* What the drawer SHOULD hold, from the server's one
                reconciliation -- before the close so the cashier counts
                against a number instead of guessing, and after it so the
                difference is stated rather than left to be worked out. */}
            {shift?.reconciliation && (
              <div className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <ShiftCashBreakdown reconciliation={shift.reconciliation} />
              </div>
            )}

            {!closed && (
              <>
                <ShiftCountPair
                  dense autoFocus disabled={busy}
                  label={t('shift_counted_cash')} usdLabel={t('shift_counted_usd')} khrLabel={t('shift_counted_khr')}
                  usd={countedUsd} khr={countedKhr} onUsd={setCountedUsd} onKhr={setCountedKhr}
                />
                {shift?.reconciliation && (
                  <ShiftFactStrip accent facts={[
                    { label: t('shift_drawer_total_typed'), value: typedDrawer },
                    { label: t('shift_recon_expected'), value: money(shift.reconciliation.expected.usd, shift.reconciliation.expected.khr) },
                  ]}
                  />
                )}
                <NoteFold note={note} onChange={setNote} disabled={busy} />
              </>
            )}

            {!closed && (
              // One close affordance on this modal: the header X. The footer
              // carries only the button that writes, so "end the shift" and
              // "put this away" can never be confused for one another. When
              // End cannot proceed, the same row says why.
              <ShiftSubmitRow
                reason={endBlocker ? t(shiftCountBlockerKey(endBlocker)) : null}
                busy={busy} label={t('shift_end')} onClick={() => void submitClose()}
                buttonClassName={DENSE_BUTTON}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
