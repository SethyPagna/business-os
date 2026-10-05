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
//
// RET-A (5 Oct 2026):
//   return_sale_required             400  POST /: every return is linked to a sale (F6)
//   return_sale_not_found            400  POST /: the named sale does not exist (N1)
//   manual_return_items_locked       400  PATCH /:id: the items of an old manual return (F6)
//   return_lot_not_sold              400  POST / and PATCH /:id: a lot the sale line was not sold from (F11)
//   return_line_product_mismatch     400  POST / and PATCH /:id: another product than the sale line (F11)
//   return_line_not_on_sale          400  POST / and PATCH /:id: a line that is not on the sale (F11)
//   return_sale_item_required        400  POST / and PATCH /:id: product sold from two branches (F11)
//   customer_return_refund_exceeds_paid 409  POST /: cash beyond what a Not Paid sale's customer paid (F1)
//   customer_return_owed_unreadable  409  POST /, PATCH /:id: the sale's payment cannot be read (F1)
//   return_restore_owed_changed      409  POST /bulk: the debt a return lowered was paid since (F1)
//   return_stock_skipped_sale        409  POST /api/returns/bulk cancelling or restoring a return
//                                         on a sale recorded without stock changes (RET-B E1)
export const RETURN_REFUSAL_ERRORS: Readonly<Record<string, string>> = {
  'return_edit_cancelled': 'This return is cancelled. Restore it before editing.',
  'return_restore_over_capacity': 'Cannot restore: more units would count as returned than the sale sold. Nothing was changed.',
  'return_refund_price_ambiguous': 'This product was sold at different prices on this sale. Pick the exact sale item being returned.',
  'return_refund_sale_line_required': 'Each return line needs a sale item or a product.',
  'return_sale_required': 'Every return must be linked to a sale. Find the sale this item came from.',
  'return_sale_not_found': 'The sale this return names was not found. Find the sale this item came from.',
  'manual_return_items_locked': 'This return is not linked to a sale, so its items cannot be changed. Cancel it and record the return against the sale.',
  'return_lot_not_sold': 'This sale line was not sold from that received date. Units go back into the received date they were sold from.',
  'return_line_product_mismatch': 'This return line names a different product than the sale item it returns.',
  'return_line_not_on_sale': 'This item is not on the sale being returned.',
  'return_sale_item_required': 'This product was sold from more than one branch on this sale. Pick the exact sale item being returned.',
  'customer_return_refund_exceeds_paid': 'This return would refund more cash than the customer paid on this Not Paid sale. Review the return.',
  'customer_return_owed_unreadable': "This sale's payment cannot be read, so the refund cannot be split. Review the sale first.",
  'return_restore_owed_changed': 'This return lowered what the customer owed, and the sale has been paid since. Record a new return instead of restoring it.',
  'return_stock_skipped_sale': 'This sale never took stock off the shelf (e.g. an import), so nothing was changed.',
}

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
