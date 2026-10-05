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
export const RETURN_REFUSAL_ERRORS: Readonly<Record<string, string>> = {
  'return_edit_cancelled': 'This return is cancelled. Restore it before editing.',
  'return_restore_over_capacity': 'Cannot restore: more units would count as returned than the sale sold. Nothing was changed.',
  'return_refund_price_ambiguous': 'This product was sold at different prices on this sale. Pick the exact sale item being returned.',
  'return_refund_sale_line_required': 'Each return line needs a sale item or a product.',
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
