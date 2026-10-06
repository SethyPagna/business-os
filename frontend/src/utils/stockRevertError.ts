// The Worker's ledger revert (cloudflare/src/lib/stockRevert.ts, POST
// /api/inventory/movements/:id/revert) answers every refusal with a stable
// code, plus the numbers its sentence names in `params` (REVERT-FIX F5).
// These are the operator's-language texts for those codes; only an uncoded
// reply (an older Worker, a network failure) keeps the server's message.
export const STOCK_REVERT_ERRORS: Record<string, readonly [key: string, fallback: string]> = {
  already_reverted: ['movement_already_reverted', 'This change was already reverted. Nothing was changed.'],
  stock_changed: ['movement_revert_stock_changed', 'The stock changed while this was being reverted. Nothing was changed; refresh and try again.'],
  revert_not_tied: ['revert_err_not_tied', 'This change is not tied to a product and branch, so it cannot be reverted here. Nothing was changed.'],
  revert_tagged_row: ['revert_err_tagged_row', 'This change belongs to a tagged (damaged, broken, expired ...) stock row. Reverse it from that row on the product. Nothing was changed.'],
  revert_use_history: ['revert_err_use_history', 'This change has its own history. Use Undo/Redo there; it cannot be reverted from Stock Changes. Nothing was changed.'],
  revert_stock_in_line_edited: ['revert_err_stock_in_line_edited', 'This stock-in line was edited after it was saved. Edit it again, or undo the edit from its history. Nothing was changed.'],
  revert_nothing_to_revert: ['revert_err_nothing', 'This change moved no stock, so there is nothing to revert.'],
  revert_not_revertible: ['revert_err_not_revertible', 'This change belongs to a sale, return, transfer or move. Undo it from its own record. Nothing was changed.'],
  revert_from_sale: ['revert_err_from_sale', 'This change came from a sale. Change it from the sale: cancel it or change its status.'],
  revert_from_return: ['revert_err_from_return', 'This change came from a return. Change it from the return instead.'],
  revert_from_merge: ['revert_err_from_merge', 'This change came from merging duplicate products. Undo the merge from History instead. Nothing was changed.'],
  revert_session_undone: ['revert_err_session_undone', 'This row belongs to a stock-in session that was undone, so its stock is already taken back. Redo that session from Stock-in Sessions first. Nothing was changed.'],
  revert_session_generation: ['revert_err_session_generation', 'This row was written by the undo or redo of stock-in session {session}. Undo or redo that session from Stock-in Sessions. Nothing was changed.'],
  revert_lineage_unresolved: ['revert_err_lineage', 'The original change cannot be identified safely. Nothing was changed.'],
  revert_insufficient_branch_stock: ['revert_err_branch_stock', 'Cannot revert: only {available} in stock at {branch}, {needed} needed. Nothing was changed.'],
  revert_insufficient_lot_stock: ['revert_err_lot_stock', 'Cannot revert: only {available} left under this received date at this branch, {needed} needed. Nothing was changed.'],
  revert_lot_moved: ['revert_err_lot_moved', 'This received date now belongs to another product (the products were merged), so it cannot be reverted here. Nothing was changed.'],
  revert_no_received_date: ['revert_err_no_received_date', 'This change was saved without a received date, and only {available} of the {needed} units at {branch} have none. Nothing was changed. Use Remove Stock and choose the received date instead.'],
  revert_forbidden: ['revert_err_forbidden', 'Reverting a stock change needs Full Access to Inventory.'],
  movement_not_found: ['revert_err_movement_not_found', 'This change no longer exists. Refresh and try again.'],
}

// REVERT-SET: refusals only a History Undo/Redo of a stock record returns
// (lib/stockSession.ts) -- the ledger Revert never does, so they stay out of
// the map above, which mirrors stockRevert.ts's RevertRefusalCode exactly.
export const STOCK_REPLAY_ONLY_ERRORS: Record<string, readonly [key: string, fallback: string]> = {
  revert_session_line_reverted: ['revert_err_session_line_reverted', 'A line of this stock-in session was reverted on its own in Stock Changes, so the session cannot be undone or redone as a whole. Revert that Revert first, or revert the other lines one by one. Nothing was changed.'],
}

export function stockRevertErrorText(error: unknown, tr: (key: string, fallback: string) => string): string {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const entry = STOCK_REVERT_ERRORS[String(source.code || '')] ?? STOCK_REPLAY_ONLY_ERRORS[String(source.code || '')]
  if (entry) {
    const params = (source.params && typeof source.params === 'object' ? source.params : {}) as Record<string, unknown>
    return tr(entry[0], entry[1]).replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = params[name]
      if (name === 'branch' && !String(value ?? '').trim()) return tr('revert_this_branch', 'this branch')
      return value == null ? '' : String(value)
    })
  }
  const message = String(source.message ?? source.error ?? '')
  return message || tr('revert_failed', 'Revert failed')
}
