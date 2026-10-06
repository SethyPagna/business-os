// REVERT-SET (owner report, 6 Oct 2026): the words a Revert confirm shows
// before anything moves -- the exact change, and any later Set on the same
// product and branch that the Revert leaves applied. One wording for Stock
// Changes and Stock-in Sessions (Worker lib/stockRevertEffect.ts supplies the
// numbers). The owner pressed Revert on a delivery of 30 believing it was the
// Set of +27 two rows above; neither confirm said "-30 from received 29/09,
// Shop 60 -> 30" or that the Set would stay.
import type { LaterOpenSet, StockRevertEffect } from '../api/actionHistoryTransport.ts'

type Tr = (key: string, fallback: string) => string
type FormatDate = (value: string) => string

export function signedQuantity(value: number): string {
  if (value > 0) return `+${value}`
  if (value < 0) return `−${Math.abs(value)}`
  return '0'
}

export function revertEffectLine(effect: StockRevertEffect, tr: Tr, formatDate: FormatDate): string {
  const lot = effect.receivedAt ? formatDate(effect.receivedAt) : effect.lotCode || ''
  const fill = (text: string) => text
    .replace('{change}', signedQuantity(effect.quantity))
    .replace('{lot}', lot)
    .replace('{branch}', effect.branchName || tr('revert_this_branch', 'this branch'))
    .replace('{before}', String(effect.branchBefore))
    .replace('{after}', String(effect.branchAfter))
  return lot
    ? fill(tr('revert_effect_lot', 'This Revert: {change} from received {lot} at {branch} ({before} → {after}).'))
    : fill(tr('revert_effect', 'This Revert: {change} at {branch} ({before} → {after}).'))
}

/** One entry per later Set: "+27 · 02/09/2026 (#48034)". */
export function laterSetLabel(set: LaterOpenSet, formatDate: FormatDate): string {
  const lot = set.receivedAt ? ` · ${formatDate(set.receivedAt)}` : ''
  return `${signedQuantity(set.quantity)}${lot} (#${set.movementId})`
}

const LATER_SETS_FALLBACK = "Stays applied: a later Set on this product ({sets}). To undo a Set, revert that Set's own row."

/** The warning as plain text, or '' when nothing later stays applied. */
export function laterSetsWarning(sets: readonly LaterOpenSet[] | null | undefined, tr: Tr, formatDate: FormatDate): string {
  if (!sets?.length) return ''
  return tr('revert_later_sets', LATER_SETS_FALLBACK).replace('{sets}', sets.map((set) => laterSetLabel(set, formatDate)).join(', '))
}

/** The sentence around its {sets} slot, so each Set can render as a link in either language's word order. */
export function laterSetsWarningFrame(tr: Tr): { before: string; after: string } {
  const [before, after = ''] = tr('revert_later_sets', LATER_SETS_FALLBACK).split('{sets}')
  return { before, after }
}

// ---- History Undo/Redo confirm (lead, 6 Oct 2026: "the Revert confirmation
// must always say exactly what it will add/remove, by lot/branch, on every
// surface that offers Revert or Undo"). One shape for a server record's
// effect (GET /api/action-history/:id/effect) and a client entry's recorded
// change (Products' out-of-stock and branch move), so every History surface
// reads the same: "−27 · received 02/09/2026 · Shop" then "Shop: 60 → 33".

export type EffectLine = { productName?: string | null; branchName?: string | null; receivedAt?: string | null; lotCode?: string | null; change: number }
export type EffectBranch = { productName?: string | null; branchName?: string | null; before: number; after: number }
export type EffectSummary = { lines: readonly EffectLine[]; branches?: readonly EffectBranch[]; more?: number }
export type EffectReviewItem = { label: string; value: string }

export function historyEffectItems(effect: EffectSummary, tr: Tr, formatDate: FormatDate): EffectReviewItem[] {
  const products = new Set([...effect.lines, ...(effect.branches || [])].map((row) => row.productName || ''))
  const named = products.size > 1
  const branch = (name: string | null | undefined) => name || tr('revert_this_branch', 'this branch')
  const items: EffectReviewItem[] = effect.lines.map((line) => {
    const lot = line.receivedAt ? tr('history_effect_received', 'received {date}').replace('{date}', formatDate(line.receivedAt)) : line.lotCode || ''
    return {
      label: signedQuantity(line.change),
      value: [named ? line.productName || '' : '', lot, branch(line.branchName)].filter(Boolean).join(' · '),
    }
  })
  if (effect.more && effect.more > 0) items.push({ label: '…', value: tr('history_effect_more', '{count} more lines').replace('{count}', String(effect.more)) })
  for (const row of effect.branches || []) {
    items.push({ label: [named ? row.productName || '' : '', branch(row.branchName)].filter(Boolean).join(' · '), value: `${row.before} → ${row.after}` })
  }
  return items
}
