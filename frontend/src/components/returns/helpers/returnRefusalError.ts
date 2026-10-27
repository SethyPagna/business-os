// FX-returns (2026-09-27): the Worker refuses these return writes with a
// machine code next to an English sentence. These are the operator's-language
// texts for those codes. Each pack key is named after its code, so a surface
// that already translates by `error.code` (NewReturnModal's net-return
// submit) resolves them too. Any other failure returns null and the caller
// keeps the server's message.
//
//   return_edit_cancelled            409  PATCH /api/returns/:id on a cancelled return
//   return_restore_over_capacity     409  POST /api/returns/bulk bringing back a legacy-sale
//                                         return would count more units returned than sold
//   return_refund_price_ambiguous    400  POST / and PATCH /:id: the product was sold at two
//                                         prices and the line names no sale item
//   return_refund_sale_line_required 400  PATCH /:id: a line on a sale names neither a sale
//                                         item nor a product
//   return_stock_skipped_sale        409  POST /api/returns/bulk cancelling or restoring a return
//                                         on a sale recorded without stock changes (RET-B E1)
//   branch_retired_no_successor      409  POST /: the sale's branch is inactive and no active branch
//                                         has taken its place (lib/branchEffect.ts); the English is
//                                         pinned to the pack by scripts/test-cutover-li-pack-parity-pure.cjs
//   return_edit_empty                400  PATCH /api/returns/:id with an explicit empty item list (6.0.41);
//                                         reached by a retry an older build stored before the client refused it
//   return_cancel_replacement_choice_required  409  POST /api/returns/bulk cancelling a return whose replacement items are still with the
//                                         customer without saying what happens to them (6.0.958)
//   return_cancel_replacement_invalid          400/409  POST /api/returns/bulk naming replacement returns that are not this return's (6.0.958)
//   return_replacement_price_forbidden         403  POST /api/returns/bulk cancelling the return a discounted replacement depends on, by a caller
//                                         who may not set prices (6.0.958; also sent by POST /api/returns)
//   return_edit_replacement_floor              403  PATCH /api/returns/:id that would leave the return's recorded replacement under its allowed price (fewer units
//                                         returned, or a dearer line covering it) by a caller who may not set prices; the extra unit is a separate return (6.0.958)
//   return_bulk_over_plan_budget     400  POST /api/returns/bulk and its undo/redo: a selection too large for one Free-plan invocation (6.0.958)
//   return_stock_action_required     400  PATCH /api/returns/:id: a line names no valid stock_action. Reached by an Undo/Redo or edit body an
//                                         older build stored or sent; the legacy restock default is never trusted (6.0.999)
export const RETURN_REFUSAL_ERRORS: Readonly<Record<string, string>> = {
  'return_edit_cancelled': 'This return is cancelled. Restore it before editing.',
  'return_restore_over_capacity': 'Cannot restore: more units would count as returned than the sale sold. Nothing was changed.',
  'return_refund_price_ambiguous': 'This product was sold at different prices on this sale. Pick the exact sale item being returned.',
  'return_refund_sale_line_required': 'Each return line needs a sale item or a product.',
  'return_stock_skipped_sale': 'This sale never took stock off the shelf (e.g. an import), so nothing was changed.',
  'branch_retired_no_successor': 'This record belongs to an inactive branch, and no active branch has taken its place. Nothing was changed.',
  'return_edit_empty': 'A return must keep at least one line. To undo the whole return, cancel it instead.',
  'return_cancel_replacement_choice_required': 'A return being cancelled has replacement items still with the customer. Say whether they are cancelled too.',
  'return_cancel_replacement_invalid': 'The replacement items chosen do not belong to the return being cancelled. Nothing was changed.',
  'return_replacement_price_forbidden': 'You do not have permission to change the price of a replacement item. It is sold at the catalog price, its promotion price, or the price on the original sale.',
  'return_edit_replacement_floor': 'This change would leave the replacement below its allowed price. Record the extra unit as a separate return.',
  'return_bulk_over_plan_budget': 'This selection is too large for the current plan. Select fewer returns or replacement items, then try again.',
  'return_exchange_line_no_lot': 'This item has no received date, so it can be returned but not exchanged here. Record the return, then sell the replacement at the POS.',
  'return_cancel_exchange_change': 'This exchange gave change back. Cancel its replacement sale in Sales first, then cancel this return.',
  'return_restore_exchange_credit': 'This exchange return was cancelled and its refund credit was moved to Not Paid. Undo that cancel from the history instead of restoring the return here. Nothing was changed.',
  'return_stock_action_required': 'This change came from an older version of the app and does not say how the stock of one line was handled. Refresh the app and try again. Nothing was changed.',
}

//   return_restore_exchange_credit   409  POST /api/returns/bulk restoring an exchange return whose refund credit was moved to Not Paid by its cancel (6.0.963); Undo of the cancel is the way back
//   return_exchange_line_no_lot   409  POST /api/returns an exchange of a sale line that has no received date (lot): a retry can never succeed, so it says what to do instead (6.0.965)
//   return_cancel_exchange_change   409  POST /api/returns/bulk cancelling an exchange return that handed change back to the customer (6.0.964): the cash handed out would be unaccounted for
// A refusal whose sentence names values the Worker sends as `params`
// (FX-exc1 item 4): with every value present it is restated through its
// _detail key; with any missing it falls back to the plain key above.
//
//   return_restore_over_capacity  {product} {returned} {sold}  POST /api/returns/bulk
export const RETURN_REFUSAL_DETAILS: Readonly<Record<string, { key: string; english: string; params: readonly string[] }>> = {
  'return_restore_over_capacity': {
    key: 'return_restore_over_capacity_detail',
    english: 'Cannot restore: {returned} of {product} would count as returned, but the sale sold only {sold}. Nothing was changed.',
    params: ['product', 'returned', 'sold'],
  },
}

function detailValues(error: object, names: readonly string[]): Record<string, string> | null {
  const params = (error as { params?: unknown }).params
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const values: Record<string, string> = {}
  for (const name of names) {
    const value = (params as Record<string, unknown>)[name]
    if (typeof value === 'number' && Number.isFinite(value)) values[name] = String(value)
    else if (typeof value === 'string' && value.trim()) values[name] = value.trim()
    else return null
  }
  return values
}

export function returnRefusalText(error: unknown, translate: (key: string, fallback: string) => string): string | null {
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : ''
  if (!Object.prototype.hasOwnProperty.call(RETURN_REFUSAL_ERRORS, code)) return null
  const detail = Object.prototype.hasOwnProperty.call(RETURN_REFUSAL_DETAILS, code) ? RETURN_REFUSAL_DETAILS[code] : null
  const values = detail ? detailValues(error as object, detail.params) : null
  if (!detail || !values) return translate(code, RETURN_REFUSAL_ERRORS[code])
  // One pass, so a product name that itself reads like "{sold}" is printed
  // as it is rather than substituted again.
  return translate(detail.key, detail.english).replace(/\{(\w+)\}/g, (token, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token))
}
