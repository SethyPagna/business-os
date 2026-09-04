import { useRef } from 'react'

// S4-21 support: "has this form been touched since it opened?" without
// every modal hand-rolling a per-field comparison (and getting it subtly
// wrong -- the usual bug is comparing object identity, which is dirty on
// every render, or comparing with `===` on a numeric field the input
// returns as a string).
//
// This is NOT a second dirty-state model. utils/dirtyWork.ts stays the
// registry the whole app reads; this only helps a modal ANSWER the
// question it is asked -- either straight into `unsavedChanges={{ dirty }}`
// or as the `isDirty` callback it registers with registerDirtyWork().

/**
 * A comparable snapshot of a form's values. Object keys are sorted so a
 * re-created state object with the same values is NOT dirty, and undefined
 * is normalised to null so an absent field and a cleared field agree.
 */
export function stableSnapshot(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalize)
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) out[key] = normalize(source[key])
  return out
}

/** Did `value` move away from the snapshot it started at? */
export function isDirtySince(baseline: string, value: unknown): boolean {
  return stableSnapshot(value) !== baseline
}

/**
 * The React one-liner: `const dirty = useFormDirty({ name, price, qty })`.
 * The baseline is whatever the form held on its FIRST render (i.e. the
 * loaded record, or the empty new-record shape), so restoring a field by
 * hand correctly reports clean again.
 *
 * `rebaseline()` is for after a successful save -- the saved values become
 * the new "nothing to lose" state, so the close guard stops asking.
 */
export function useFormDirty(value: unknown, resetKey?: string | number | null): { dirty: boolean; rebaseline: () => void } {
  const baseline = useRef<string | null>(null)
  // One modal instance is routinely reused for a different record (the
  // duplicates resolver, the user editor). Loading record B's values into
  // a form baselined on record A reads as "dirty" without anyone typing,
  // so a changed resetKey re-baselines.
  const seenKey = useRef<string | number | null | undefined>(resetKey)
  if (seenKey.current !== resetKey) {
    seenKey.current = resetKey
    baseline.current = null
  }
  // A form whose record is still loading renders `null` first. Baselining
  // THAT would make the form dirty the instant its data arrived, and every
  // close would prompt about changes nobody made -- the classic version of
  // this bug. The baseline is taken at the first render that actually has
  // values.
  if (value === null || value === undefined) {
    return { dirty: false, rebaseline: () => { baseline.current = null } }
  }
  const snapshot = stableSnapshot(value)
  if (baseline.current === null) baseline.current = snapshot
  return {
    dirty: baseline.current !== snapshot,
    rebaseline: () => { baseline.current = stableSnapshot(value) },
  }
}
