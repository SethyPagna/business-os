import { useCallback, useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import { actorReadStorageKey, captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'
import { useApp } from '../../AppContext'
import { isAdminControlUser, type PermissionUser } from '../../utils/permissions.ts'
import { fmtDate, fmtDateTime24, parseServerTimestampMs } from '../../utils/formatters.ts'
import { carryOverCloseSeedMs, closeShift, closeShiftById, fetchCurrentShift, openShift, pendingShiftMutation, shiftClosingCounts, shiftCountPairBlocker, shiftLocalDateTimeFromMs, shiftLocalDateTimeToIso, shiftOpeningCounts, type Shift, type ShiftState } from '../../api/shiftTransport.ts'
import { DateTimeEntryInput } from '../shared/DateEntryInput.tsx'
import ShiftCashBreakdown from '../shifts/ShiftCashBreakdown.tsx'
import ShiftCountPair, { ShiftSubmitRow, shiftCountBlockerKey } from '../shifts/ShiftCountFields.tsx'
import { shiftAdditionalCash, shiftCountedPairText, shiftExpectedWithTypedAdditional } from '../shifts/shiftReportModel.ts'

function closingCountInvalid(value: string): boolean {
  return value.trim() !== '' && shiftClosingCounts(value, null).usd == null
}

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
 *    requirement -- a closable prompt is one the till never registers. The
 *    shared Modal explicitly omits its Close affordance for this mandatory
 *    workflow, so keyboard and screen-reader users are not offered an enabled
 *    control that cannot act.
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
  user?: NonNullable<PermissionUser> & { id?: string | number | null }
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
const shiftScopes = new Map<string, ActorReadScope>()
export const SHIFT_BRANCH_CHANGED_EVENT = 'business-os:pos-branch-changed'
export const SHIFT_STATE_CHANGED_EVENT = 'business-os:shift-state-changed'

export function shiftCacheKey(userId: unknown, branchId: number | null, scopeMode: unknown): string {
  const user = String(userId ?? 'anonymous')
  const branch = branchId == null ? 'request-branch' : String(branchId)
  const mode = scopeMode === 'shop_wide' ? 'shop_wide' : 'per_account'
  const scope = captureActorReadScope('shifts')
  const key = actorReadStorageKey(`${user}:${branch}:${mode}`, scope)
  shiftScopes.set(key, scope)
  return key
}

/** Publish a new shift state to every mounted consumer. Writes call this. */
export function publishShift(key: string, next: ShiftState | null) {
  const scope = shiftScopes.get(key)
  if (!scope || !isActorReadScopeCurrent(scope)) return
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
    const scope = shiftScopes.get(key)
    if (!scope || !isActorReadScopeCurrent(scope)) return Promise.resolve()
    setLoading(true)
    if (!shiftInflight.has(key)) {
      const request = fetchCurrentShift(branchId)
        .then((next) => { if (!isActorReadScopeCurrent(scope)) return; sharedShiftFailures.delete(key); publishShift(key, next) })
        // Leave the shared state null. A read failure must NOT be treated as
        // "registered" -- that would silently skip the prompt for the whole
        // day. Null shows nothing yet and the next open re-asks.
        .catch(() => { if (!isActorReadScopeCurrent(scope)) return; sharedShiftFailures.add(key); publishShift(key, null) })
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
    const scope = shiftScopes.get(key)
    if (!scope || !isActorReadScopeCurrent(scope)) return
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

/** The carry-over close form's own draft -- see useCarryOverClose below. */
type CarryOverCloseDraft = {
  closedAt: string
  countedUsd: string
  countedKhr: string
  additionalUsd: string
  additionalKhr: string
  note: string
}

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
// The STEP SWITCH beside it. Same height, plainly secondary: it moves the one
// non-dismissible modal from the carry-over step to the register step, and it
// must never read as a way to close the modal.
const DENSE_STEP_BUTTON = 'min-h-0 h-9 rounded-lg border border-black/15 px-3 text-[13px] font-medium leading-relaxed text-zinc-700 hover:bg-black/5 disabled:opacity-50 sm:h-8 dark:border-white/20 dark:text-zinc-200 dark:hover:bg-white/5'
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

/** What both entry points hold: one draft, one submit, one set of reasons. */
type CarryOverCloseForm = {
  draft: CarryOverCloseDraft
  set: (patch: Partial<CarryOverCloseDraft>) => void
  dirty: boolean
  busy: boolean
  pending: boolean
  reason: string | null
  submit: () => Promise<void>
}

/**
 * ONE carry-over close, for both places that offer it: the registration
 * prompt's first step and the POS header's own panel.
 *
 * It was implemented twice for a day, and the two copies immediately drifted:
 * the header seeded a closing time the Worker always refused, and the prompt's
 * copy ignored `pendingShiftMutation` entirely -- so a lost acknowledgement
 * would have replayed a frozen body while the form showed a fresh prefill, and
 * reported the unresolved write as a red error toast instead of leaving it to
 * the shared unresolved banner. One definition is the fix for both.
 */
function useCarryOverClose(shift: Shift | null, closeBefore: string | null | undefined, onClosed: () => void): CarryOverCloseForm {
  const { t, notify, fmtUSD, fmtKHR, user } = useApp() as ShiftGateContext
  const actorId = user?.id ?? undefined
  const [draft, setDraft] = useState<CarryOverCloseDraft>(
    { closedAt: '', countedUsd: '', countedKhr: '', additionalUsd: '', additionalKhr: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const shiftId = shift?.id
  const ownOpenedAt = shift?.opened_at

  useEffect(() => {
    if (shiftId == null) return
    // The retry-replay contract, exactly as the live close honours it: an
    // unacknowledged request stays frozen in storage, so the form shows THAT
    // body and offers Retry. A fresh prefill here would replay values the
    // cashier never saw.
    const saved = pendingShiftMutation(actorId, shiftId)
    const body = saved?.action === 'close' ? saved.body : null
    const text = (key: string) => (body?.[key] == null ? '' : String(body[key]))
    const savedMs = Date.parse(String(body?.closed_at ?? ''))
    setPending(body != null)
    // Seeded ONCE per row rather than from the live wall clock: a value that
    // kept re-seeding would overwrite the moment while it is being typed.
    setDraft({
      closedAt: shiftLocalDateTimeFromMs(Number.isFinite(savedMs) ? savedMs : carryOverCloseSeedMs(closeBefore, ownOpenedAt, Date.now())),
      countedUsd: text('closing_counted_usd'), countedKhr: text('closing_counted_khr'),
      additionalUsd: text('additional_cash_usd'), additionalKhr: text('additional_cash_khr'),
      note: text('closing_note'),
    })
  }, [shiftId, closeBefore, ownOpenedAt, actorId])

  // The closing time is REQUIRED here (unlike the live close, which lets the
  // server stamp its own clock), so a missing one is its own reason.
  const blocker = draft.closedAt.trim() === ''
    ? 'time' as const
    : closingCountInvalid(draft.countedUsd) || closingCountInvalid(draft.countedKhr)
      || closingCountInvalid(draft.additionalUsd) || closingCountInvalid(draft.additionalKhr) ? 'invalid' as const : null

  const submit = async () => {
    if (busy || !shift || blocker) return
    const counts = shiftClosingCounts(draft.countedUsd, draft.countedKhr)
    setBusy(true)
    try {
      // ALWAYS the explicit closed_at, never the server's clock: the Worker
      // refuses a close stamped after the next segment's opening, so the
      // moment the drawer actually stopped is the only one it takes.
      const result = await closeShiftById(shift.id, {
        actorId,
        expectedRevision: shift.revision,
        closedAt: shiftLocalDateTimeToIso(draft.closedAt),
        closingCountedUsd: counts.usd,
        closingCountedKhr: counts.khr,
        additionalCashUsd: draft.additionalUsd.trim() === '' ? null : Number(draft.additionalUsd),
        additionalCashKhr: draft.additionalKhr.trim() === '' ? null : Number(draft.additionalKhr),
        closingNote: draft.note.trim() || null,
      })
      setPending(false)
      // Re-read /current rather than patch the shared state from this write:
      // the close response does not carry previous_open_shift, and only
      // /current can say whether another earlier shift is still open.
      window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))
      onClosed()
      // The panel is gone on success, so the toast is the only confirmation
      // the cashier gets: it names the drawer that was written and the moment
      // it was FILED UNDER, not a bare "done".
      notify(`${t('shift_close_saved')} ${shiftCountedPairText(result.shift.closing_counted_usd, result.shift.closing_counted_khr, fmtUSD, fmtKHR)}`
        + (result.shift.closed_at ? ` · ${fmtDateTime24(result.shift.closed_at)}` : ''))
    } catch (e) {
      // An unacknowledged write is not an error the cashier can act on: the
      // shared unresolved banner owns it and this button becomes Retry, which
      // replays the frozen body. Anything else is the Worker's own sentence,
      // verbatim -- it is the one that says which time to retype.
      setPending((e as { outcome?: string })?.outcome === 'unknown')
      if ((e as { outcome?: string })?.outcome === 'unknown') return // shared banner owns the unresolved warning
      notify(e instanceof Error ? e.message : t('shift_end_failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return {
    draft, busy, pending, submit,
    set: (patch) => setDraft((current) => ({ ...current, ...patch })),
    dirty: draft.countedUsd.trim() !== '' || draft.countedKhr.trim() !== ''
      || draft.additionalUsd.trim() !== '' || draft.additionalKhr.trim() !== '' || draft.note.trim() !== '',
    reason: blocker === 'time' ? t('shift_close_time_required')
      : blocker ? t(shiftCountBlockerKey(blocker)) : null,
  }
}

/**
 * WHICH shift this is, from first paint: the code, when it was opened (the
 * formatted day-first stamp names the earlier day), WHO opened it and the
 * drawer it started with -- the facts the cashier needs to recognise the row
 * before they put a closing time on it. Both entry points show it, and so does
 * the locked state that offers no close at all.
 *
 * The username is on it because every history surface in this app names the
 * acting account, and this one decides whether the locked message ("only the
 * shift owner or an administrator") is about you. It is the same `user_name`
 * the row already carries (the Worker's displayName prefers the username) and
 * the same one the shift summary prints, so nothing new is exposed.
 *
 * And the BOUND, when the server states one: the instant this close has to
 * precede. Without it the prefilled time is a number the cashier cannot check,
 * and a 409 naming "the next shift segment" names a segment they never saw.
 */
function CarryOverIntro({ shift, closeBefore }: { shift: Shift; closeBefore?: string | null }) {
  const { t, fmtUSD, fmtKHR } = useApp() as ShiftGateContext
  return (
    <>
      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
        {t('shift_previous_open_hint')}
      </p>
      <ShiftFactStrip facts={[
        !!shift.shift_code && { label: t('shift_code'), value: shift.shift_code },
        { label: t('shift_opened_at'), value: fmtDateTime24(shift.opened_at) },
        !!shift.user_name && { label: t('shift_opened_by'), value: shift.user_name },
        { label: t('shift_opened_with'), value: shiftCountedPairText(shift.opening_float_usd, shift.opening_float_khr, fmtUSD, fmtKHR) },
        !!closeBefore && { label: t('shift_previous_open_close_before'), value: fmtDateTime24(closeBefore) },
      ]}
      />
    </>
  )
}

/**
 * The carry-over close form itself -- one definition, two callers. The fields
 * are frozen while the write is in flight or unacknowledged, so what is on
 * screen is always the body that will be sent.
 */
function CarryOverCloseFields({ form, secondary }: { form: CarryOverCloseForm; secondary?: React.ReactNode }) {
  const { t } = useApp() as ShiftGateContext
  const frozen = form.busy || form.pending
  return (
    <>
      {/* Required, and prefilled to the latest moment the server will accept
          (carryOverCloseSeedMs, between the row's own opening and the bound
          /current stated), so the common case -- the till was simply never
          closed on an earlier day and is closed on arrival -- is one press.
          The row itself is whichever open shift /current names, oldest first;
          nothing here assumes it was yesterday, and the strip above prints
          the bound so the prefill is a number the cashier can check. */}
      <div>
        <span className="block text-xs font-medium leading-relaxed text-zinc-700 dark:text-zinc-200">{t('shift_close_time_required')}</span>
        <DateTimeEntryInput
          className="mt-1" value={form.draft.closedAt} disabled={frozen}
          onChange={(next) => form.set({ closedAt: next })}
          t={t}
          dateAriaLabel={`${t('shift_close_time_required')} · ${t('date')}`}
          timeAriaLabel={`${t('shift_close_time_required')} · ${t('time')}`}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{t('shift_close_time_hint')}</p>
      </div>

      {/* Opening float -> additional change used -> closing count, the same
          order and the same shared fields as the live close, so one drawer is
          never counted two ways. */}
      <ShiftCountPair
        dense autoFocus disabled={frozen}
        label={t('shift_additional_cash')} usdLabel={t('shift_additional_usd')} khrLabel={t('shift_additional_khr')}
        hint={t('shift_additional_cash_hint')} hintDetail={t('shift_additional_cash_example')}
        usd={form.draft.additionalUsd} khr={form.draft.additionalKhr}
        onUsd={(value) => form.set({ additionalUsd: value })}
        onKhr={(value) => form.set({ additionalKhr: value })}
      />
      <ShiftCountPair
        dense disabled={frozen}
        label={t('shift_counted_cash')} usdLabel={t('shift_counted_usd')} khrLabel={t('shift_counted_khr')}
        hint={t('shift_registered_cash_hint')}
        usd={form.draft.countedUsd} khr={form.draft.countedKhr}
        onUsd={(value) => form.set({ countedUsd: value })}
        onKhr={(value) => form.set({ countedKhr: value })}
      />

      <NoteFold note={form.draft.note} onChange={(value) => form.set({ note: value })} disabled={frozen} />

      {/* Close writes; the secondary (the prompt's step switch) only moves
          that same modal to the register step and never closes it. When the
          close cannot proceed the row says why; an unacknowledged one says
          Retry, and the frozen request is what it replays. */}
      <ShiftSubmitRow
        reason={form.reason}
        busy={form.busy} label={form.pending ? t('retry') : t('shift_action_close')}
        onClick={() => void form.submit()}
        buttonClassName={DENSE_BUTTON}
        secondary={secondary}
      />
    </>
  )
}

export default function ShiftGate({ children, branchId = null, branchName = null }: { children?: React.ReactNode; branchId?: number | null; branchName?: string | null }) {
  // Branch identity is supplied by the till. Until the POS owner wires that
  // existing active-branch value into this prop, null retains the route's
  // legacy unscoped behavior without inventing a branch from unrelated state.
  const { t, notify, fmtUSD, fmtKHR, user, settings } = useApp() as ShiftGateContext
  const { state, publish } = useSharedShift(branchId, user?.id, settings?.shift_scope_mode)
  const [busy, setBusy] = useState(false)
  const [floatUsd, setFloatUsd] = useState('')
  const [floatKhr, setFloatKhr] = useState('')
  const [note, setNote] = useState('')
  const [registerStep, setRegisterStep] = useState<'carry_over' | 'open'>('open')

  // Registration is optional per currency. Blank means uncounted/unknown;
  // explicit 0 is a measured zero. Invalid non-blank values still block.
  const startBlocker = shiftCountPairBlocker(floatUsd, floatKhr, { blankMeansUncounted: true })

  /**
   * A shift LEFT OPEN on an earlier business day, answered only by
   * GET /current. `undefined` is "the server did not say" (an older Worker,
   * or a write response, which never carries the field) and must render
   * nothing -- never "there is none".
   *
   * It is offered as the FIRST step of the same non-dismissible modal because
   * the two are one decision for the cashier: the earlier drawer has to be
   * closed with the time it actually ended BEFORE today's float is registered,
   * and until this lane the modal simply covered the POS screen that would
   * have shown it. The step is offered whether or not this account can close
   * the row: a shop-wide shift owned by someone else still has to be SEEN,
   * with the reason, or the till silently opens a second shift on top of it.
   */
  const carryOver = state?.previous_open_shift ?? null
  const carryOverClosable = carryOver?.capabilities.can_close === true
  useEffect(() => {
    setRegisterStep(carryOver ? 'carry_over' : 'open')
  }, [carryOver?.id])

  // ONE carry-over close form, the same one the POS header panel renders,
  // handed the bound the WORKER computed rather than a guess made here.
  // Today's shift usually does not exist while this prompt is up, but a
  // second stale day does, and that -- not the clock -- is what the close
  // has to precede.
  const carryForm = useCarryOverClose(carryOver, state?.previous_open_close_before, () => setRegisterStep('open'))

  const submitOpen = async () => {
    if (busy) return
    const opening = shiftOpeningCounts(floatUsd, floatKhr)
    if (startBlocker) return
    setBusy(true)
    try {
      const next = await openShift({
        branchId,
        branchName,
        openingFloatUsd: opening.usd,
        openingFloatKhr: opening.khr,
        openingNote: note.trim() || null,
      })
      // Publish, not setState: this is what makes End Shift appear the moment
      // the drawer is registered, instead of only after a reload.
      publish(next)
      // ...and then re-read /current, because the OPEN response does not carry
      // previous_open_shift. Publishing it alone would leave the shared state
      // saying "the server did not say" about an earlier shift that is still
      // open, and the carry-over close would disappear for the rest of the day.
      window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))
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
          title={registerStep === 'carry_over' ? t('shift_previous_open_title') : t('shift_register_title')}
          size="sm"
          onClose={() => { /* intentionally not dismissible -- see the file comment */ }}
          closeAffordance="omitted"
          unsavedChanges={{ dirty: registerStep === 'carry_over'
            ? carryForm.dirty
            : floatUsd.trim() !== '' || floatKhr.trim() !== '' || note.trim() !== '' }}
        >
          {registerStep === 'carry_over' && carryOver ? (
          <div className="space-y-3">
            <CarryOverIntro shift={carryOver} closeBefore={state?.previous_open_close_before} />

            {carryOverClosable ? (
              <CarryOverCloseFields
                form={carryForm}
                secondary={(
                  <button type="button" disabled={carryForm.busy} onClick={() => setRegisterStep('open')} className={DENSE_STEP_BUTTON}>
                    {t('shift_open_today_instead')}
                  </button>
                )}
              />
            ) : (
              // Shop-wide row owned by someone else: the fact strip above
              // still names it, the reason says who can close it, and there is
              // no button that would only fail at the server.
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <span role="status" className="mr-auto min-w-0 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{t('shift_previous_open_locked')}</span>
                <button type="button" onClick={() => setRegisterStep('open')} className={DENSE_STEP_BUTTON}>
                  {t('shift_open_today_instead')}
                </button>
              </div>
            )}
          </div>
          ) : (
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

            {/* Both currencies are stored separately and never converted.
                A blank stays unknown; an explicit 0 is a counted zero. */}
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
          )}
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

  const { state } = useSharedShift(branchId, user?.id, settings?.shift_scope_mode)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [countedUsd, setCountedUsd] = useState('')
  const [countedKhr, setCountedKhr] = useState('')
  const [additionalUsd, setAdditionalUsd] = useState('')
  const [additionalKhr, setAdditionalKhr] = useState('')
  const [note, setNote] = useState('')
  // The row the server wrote, held for the summary. Set only after a close
  // that actually returned a shift, and it is what keeps the panel mounted
  // once `can_end` has gone false.
  const [closed, setClosed] = useState<Shift | null>(null)
  const [target, setTarget] = useState<Shift | null>(null)
  const [pending, setPending] = useState(false)
  // The earlier day's row, captured when the header's second button is
  // pressed. It gets its OWN panel and the shared carry-over form; this panel
  // is never relabelled into a close of a different shift on a different day.
  const [carryTarget, setCarryTarget] = useState<Shift | null>(null)

  const now = useWallClock(open && !closed)
  const receivedShift = closed || target || state?.shift || null
  const shift = receivedShift && !isAdminControlUser(user)
    ? { ...receivedShift, reconciliation: null, figures: null } : receivedShift
  const canCloseCurrent = state?.is_open === true && state.shift?.capabilities.can_close === true
  // The same earlier-day row the gate offers, for the case where TODAY is
  // already registered so the gate's prompt is gone. Offered whenever the
  // earlier row is still closable, today's shift open or not: a cashier who
  // chose "open today's shift instead" must still be able to reach it here.
  const carryOver = state?.previous_open_shift ?? null
  const canCloseCarryOver = carryOver?.capabilities.can_close === true
  // The shared form, seeded against the bound /current reported: the opening
  // of whichever segment follows the offered row -- today's when today is
  // next, the next STALE day's when another one is still open behind it.
  const carryForm = useCarryOverClose(carryTarget, state?.previous_open_close_before, () => { setCarryTarget(null); setOpen(false) })

  const endBlocker = closingCountInvalid(countedUsd) || closingCountInvalid(countedKhr)
    || closingCountInvalid(additionalUsd) || closingCountInvalid(additionalKhr) ? 'invalid' as const : null
  const endReason = endBlocker ? t(shiftCountBlockerKey(endBlocker)) : null

  const submitClose = async () => {
    if (busy || !target) return
    const counts = shiftClosingCounts(countedUsd, countedKhr)
    if (endBlocker) return
    setBusy(true)
    try {
      // The live close sends NO closed_at: the server stamps its own clock,
      // so a till running seconds fast is never refused for it.
      const next = await closeShift({
        shiftId: target.id,
        expectedRevision: target.revision,
        actorId: user?.id ?? undefined,
        branchId,
        // The accounting transport accepts null as "not counted". Casts keep
        // this component compatible with the pre-integration type surface.
        closingCountedUsd: counts.usd as number,
        closingCountedKhr: counts.khr as number,
        additionalCashUsd: additionalUsd.trim() === '' ? null : Number(additionalUsd),
        additionalCashKhr: additionalKhr.trim() === '' ? null : Number(additionalKhr),
        closingNote: note.trim() || null,
      })
      setPending(false)
      // A continuation may already exist on another device. Refresh the
      // current segment separately; this receipt belongs only to target.
      window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))
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
      setPending((e as { outcome?: string })?.outcome === 'unknown')
      if ((e as { outcome?: string })?.outcome === 'unknown') return // shared banner owns the unresolved warning
      notify(e instanceof Error ? e.message : t('shift_end_failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const dismiss = () => {
    if (busy) return
    setOpen(false)
    setClosed(null)
    setTarget(null)
    setCountedUsd('')
    setCountedKhr('')
    setAdditionalUsd('')
    setAdditionalKhr('')
    setNote('')
  }

  const beginClose = () => {
    if (!state?.shift || busy) return
    setTarget(state.shift)
    const saved = pendingShiftMutation(user?.id ?? undefined, state.shift.id)
    setPending(saved?.action === 'close')
    if (saved?.action === 'close') {
      const value = (key: string) => saved.body[key] == null ? '' : String(saved.body[key])
      setCountedUsd(value('closing_counted_usd')); setCountedKhr(value('closing_counted_khr'))
      setAdditionalUsd(value('additional_cash_usd')); setAdditionalKhr(value('additional_cash_khr'))
      setNote(value('closing_note'))
    }
    setOpen(true)
  }

  // The earlier day's row, in its own panel. Everything the close itself
  // needs -- the required closing moment and its seed, the retry replay, the
  // reasons -- lives in the shared form, so this is only "which shift".
  const beginCarryOverClose = () => {
    // Also blocked while the LIVE close is in flight: swapping panels
    // under it would hide a write nobody has heard back from.
    if (!carryOver || busy || carryForm.busy) return
    setCarryTarget(carryOver)
    setOpen(true)
  }

  const dismissCarryOver = () => {
    if (carryForm.busy) return
    setCarryTarget(null)
    setOpen(false)
  }

  // What the cashier has typed so far, preserving two blanks as unknown -- shown beside the
  // server's EXPECTED figure so the two are compared before the close is
  // written. The difference itself is NOT computed here: that is the server's
  // one reconciliation, and it appears on the summary once the close returns.
  const typedCounts = shiftClosingCounts(countedUsd, countedKhr)
  const typedDrawer = endBlocker === 'invalid'
    ? '—'
    : shiftCountedPairText(typedCounts.usd, typedCounts.khr, fmtUSD, fmtKHR)
  const closedAdditional = closed ? shiftAdditionalCash(closed) : null

  // ---- EXPECTED, before the close is written -----------------------------
  //
  // The server's reconciliation is computed from the additional change
  // RECORDED on the shift, which on an open shift is not the amount the
  // cashier is typing into this form: they would put another 20,000 riel of
  // change into the drawer, type it here, and watch Expected stay where it
  // was -- then be told the till is 20,000 over.
  //
  // The formula is NOT reproduced here. It lives once, on the server
  // (cloudflare/src/lib/shiftReconciliation.ts: opening + additional + cash
  // sales - refunds - expenses - courier), and only the ONE term that changed
  // is adjusted: expected - recorded additional + typed additional. An
  // uncounted currency (null opening -> null expected) stays unknown rather
  // than turning into a number, and a blank field is 0 added, not a guess.
  const typedAdditional = shiftClosingCounts(additionalUsd, additionalKhr)
  const expectedNow = shiftExpectedWithTypedAdditional(shift?.reconciliation, typedAdditional)
  // The drawer breakdown printed above the form carries the same Expected
  // row, so it takes the same adjustment: one screen must never show two
  // different expected drawers. After the close the server's own figures are
  // final and are shown exactly as they came.
  const drawerBreakdown = !shift?.reconciliation ? null
    : closed ? shift.reconciliation
      : { ...shift.reconciliation,
        additional_cash: { usd: typedAdditional.usd ?? 0, khr: typedAdditional.khr ?? 0 },
        expected: expectedNow }

  // No open shift AND no summary to show: this control has nothing to do.
  if (!canCloseCurrent && !canCloseCarryOver && !closed && !open) return null

  return (
    <>
      {canCloseCurrent && (
        <button
          type="button" onClick={beginClose}
          className="rounded border px-3 py-1.5 text-sm font-medium"
          title={state.shift?.opened_at ? `${t('shift_opened_at')}: ${fmtDateTime24(state.shift.opened_at)}` : undefined}
        >
          {t('shift_end')}
        </button>
      )}
      {/* A SEPARATE control, never the same button relabelled: it closes a
          different shift, on a different day. Amber and dated, because two
          identically bordered buttons side by side are told apart only by a
          title attribute -- and a touch till has no hover to show one. */}
      {canCloseCarryOver && (
        <button
          type="button" onClick={beginCarryOverClose}
          className="whitespace-nowrap rounded border border-amber-500 px-3 py-1.5 text-sm font-medium leading-relaxed text-amber-700 dark:border-amber-400 dark:text-amber-200"
          title={`${t('shift_previous_open_title')} · ${t('shift_opened_at')}: ${fmtDateTime24(carryOver?.opened_at)}`}
        >
          {t('shift_action_close')} · {fmtDate(carryOver?.opened_at)}
        </button>
      )}
      {/* ...and its own small panel: one close affordance (the header X), the
          shared form, and none of the live close's summary. */}
      {open && carryTarget && (
        <Modal
          title={t('shift_previous_open_title')}
          size="sm"
          onClose={dismissCarryOver}
          closeDisabled={carryForm.busy}
          unsavedChanges={{ dirty: carryForm.dirty }}
        >
          <div className="space-y-3">
            <CarryOverIntro shift={carryTarget} closeBefore={state?.previous_open_close_before} />
            <CarryOverCloseFields form={carryForm} />
          </div>
        </Modal>
      )}
      {open && !carryTarget && (
        <Modal
          title={closed ? t('shift_summary_title') : t('shift_end')}
          size="sm"
          onClose={dismiss}
          closeDisabled={busy}
          // Once the close is written there is nothing unsaved left to lose,
          // so dismissing the summary must not raise a discard prompt.
          unsavedChanges={{ dirty: !closed && (countedUsd.trim() !== '' || countedKhr.trim() !== '' || additionalUsd.trim() !== '' || additionalKhr.trim() !== '' || note.trim() !== '') }}
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
                { label: t('shift_opened_with'), value: shiftCountedPairText(shift.opening_float_usd, shift.opening_float_khr, fmtUSD, fmtKHR) },
                // The rest of the chain, in the order the drawer moved: the
                // extra change put in when the float ran out, then what was
                // counted out of it at the close -- on the same cell shape as
                // "Opened with" so the three are read as one comparison.
                // Only when some was actually put in -- the SAME rule the
                // report rows and the Reports export use (shiftAdditionalCash),
                // so a shift that never needed more change does not print
                // "+ $0.00 · 0៛" here and nothing there.
                !!closedAdditional && { label: t('shift_recon_additional_cash'), value: `+ ${shiftCountedPairText(closedAdditional.usd, closedAdditional.khr, fmtUSD, fmtKHR)}` },
                !!closed && { label: t('shift_counted_close'), value: shiftCountedPairText(closed.closing_counted_usd, closed.closing_counted_khr, fmtUSD, fmtKHR) },
                !!closed?.closing_note && { label: t('note'), value: closed.closing_note },
              ]}
              />
            )}

            {/* What the drawer SHOULD hold, from the server's one
                reconciliation -- before the close so the cashier counts
                against a number instead of guessing, and after it so the
                difference is stated rather than left to be worked out. */}
            {drawerBreakdown && (
              <div className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                <ShiftCashBreakdown reconciliation={drawerBreakdown} />
              </div>
            )}

            {!closed && (
              <>
                {/* Opening float -> additional change used -> closing count,
                    the order the drawer actually moves in and the order the
                    cashier knows the figures: the extra change was put in and
                    spent before the final count is taken, so it is asked for
                    first and carries the focus. Neither figure changes the
                    other -- the server's one reconciliation reads both. */}
                <ShiftCountPair
                  dense autoFocus disabled={busy || pending}
                  label={t('shift_additional_cash')} usdLabel={t('shift_additional_usd')} khrLabel={t('shift_additional_khr')}
                  hint={t('shift_additional_cash_hint')} hintDetail={t('shift_additional_cash_example')}
                  usd={additionalUsd} khr={additionalKhr} onUsd={setAdditionalUsd} onKhr={setAdditionalKhr}
                />
                <ShiftCountPair
                  dense disabled={busy || pending}
                  label={t('shift_counted_cash')} usdLabel={t('shift_counted_usd')} khrLabel={t('shift_counted_khr')}
                  hint={t('shift_registered_cash_hint')}
                  usd={countedUsd} khr={countedKhr} onUsd={setCountedUsd} onKhr={setCountedKhr}
                />
                {shift?.reconciliation && (
                  <ShiftFactStrip accent facts={[
                    { label: t('shift_drawer_total_typed'), value: typedDrawer },
                    { label: t('shift_recon_expected'), value: shiftCountedPairText(expectedNow.usd, expectedNow.khr, fmtUSD, fmtKHR) },
                  ]}
                  />
                )}
                <NoteFold note={note} onChange={setNote} disabled={busy || pending} />
              </>
            )}

            {!closed && (
              // One close affordance on this modal: the header X. The footer
              // carries only the button that writes, so "end the shift" and
              // "put this away" can never be confused for one another. When
              // End cannot proceed, the same row says why.
              <ShiftSubmitRow
                reason={endReason}
                busy={busy} label={pending ? t('retry') : t('shift_end')} onClick={() => void submitClose()}
                buttonClassName={DENSE_BUTTON}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
