// N34 / lane "linkover", item 2 -- "a merge can be inspected".
//
// The shape of GET /api/products/:id/identity-history (readProductIdentityHistory
// in cloudflare/src/lib/productIdentity.ts), and the ONE function that turns it
// into the lines a surface renders.
//
// It is a module rather than JSX in one component because the answer has to be
// readable from more than one place. It first shipped inside the Conflicts
// Resolve float, which only ever opens for a row that is STILL in an
// outstanding cluster -- so the normal case, a survivor whose conflict is gone
// precisely because the merge happened, had no screen to point at. The panel
// now also opens on the product form in edit mode, and both render this list;
// two hand-written renderings would have drifted the moment either gained a
// row type.
//
// `keptSeparate` is deliberately its own list rather than folded in with the
// folds: it comes from audit_logs and is RETENTION-BOUND, so an empty one does
// NOT mean no decision was taken, while an empty `mergedFrom` really does mean
// nothing was ever folded in.

export type IdentityFold = {
  fromId: number
  fromName: string | null
  intoId: number
  intoName: string | null
  at: string | null
  by: string | null
  source: 'merge' | 'bulk_merge'
  reversed: boolean
  /** The undo_snapshots row the fold was read from; the server's total order. */
  snapshotId?: number
}

export type IdentityKeepSeparateDecision = {
  at: string | null
  by: string | null
  keptSeparateFrom: number[]
  path: string | null
}

export type IdentityHistory = {
  mergedFrom?: IdentityFold[]
  mergedInto?: IdentityFold | null
  keptSeparate?: IdentityKeepSeparateDecision[]
}

export type IdentityHistoryEntry =
  | { kind: 'merged_from'; key: string; name: string; at: string | null; by: string | null; reversed: boolean }
  | { kind: 'merged_into'; key: string; name: string; at: string | null; by: string | null; reversed: boolean }
  | { kind: 'kept_separate'; key: string; ids: number[]; at: string | null; by: string | null }

const foldName = (name: string | null, id: number): string => {
  const trimmed = String(name || '').trim()
  return trimmed || `#${id}`
}

/**
 * Every line to render, in the order to render them: the folds merged INTO this
 * row (in the server's order -- newest first, one order across both merge
 * shapes), then the fold that retired this row if it was itself merged away,
 * then the keep-separate decisions.
 *
 * The server's order is preserved, never recomputed. Re-sorting here would be a
 * second implementation of "newest first" over a field (`at`) that two folds
 * recorded in the same second share, and the two would disagree exactly when it
 * mattered.
 */
export function identityHistoryEntries(history: IdentityHistory | null | undefined): IdentityHistoryEntry[] {
  if (!history) return []
  const entries: IdentityHistoryEntry[] = []
  const folds = Array.isArray(history.mergedFrom) ? history.mergedFrom : []
  folds.forEach((fold, index) => {
    if (!fold) return
    entries.push({
      kind: 'merged_from',
      key: `from-${fold.snapshotId ?? 'x'}-${fold.fromId}-${index}`,
      name: foldName(fold.fromName, fold.fromId),
      at: fold.at ?? null,
      by: fold.by ?? null,
      reversed: Boolean(fold.reversed),
    })
  })
  const into = history.mergedInto
  if (into) {
    entries.push({
      kind: 'merged_into',
      key: `into-${into.snapshotId ?? 'x'}-${into.intoId}`,
      name: foldName(into.intoName, into.intoId),
      at: into.at ?? null,
      by: into.by ?? null,
      reversed: Boolean(into.reversed),
    })
  }
  const decisions = Array.isArray(history.keptSeparate) ? history.keptSeparate : []
  decisions.forEach((decision, index) => {
    if (!decision) return
    entries.push({
      kind: 'kept_separate',
      key: `kept-${index}`,
      ids: (Array.isArray(decision.keptSeparateFrom) ? decision.keptSeparateFrom : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
      at: decision.at ?? null,
      by: decision.by ?? null,
    })
  })
  return entries
}

/**
 * Whether there is anything to say at all. Surfaces render the panel only when
 * this is true: a permanently empty "no history" box would cost every operator a
 * line of chrome on every product to tell them nothing, and the density rule
 * here is explicit about that.
 */
export function hasIdentityHistory(history: IdentityHistory | null | undefined): boolean {
  return identityHistoryEntries(history).length > 0
}
