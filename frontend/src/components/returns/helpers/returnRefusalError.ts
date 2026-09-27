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
export const RETURN_REFUSAL_ERRORS: Readonly<Record<string, string>> = {
  'return_edit_cancelled': 'This return is cancelled. Restore it before editing.',
  'return_restore_over_capacity': 'Cannot restore: more units would count as returned than the sale sold. Nothing was changed.',
  'return_refund_price_ambiguous': 'This product was sold at different prices on this sale. Pick the exact sale item being returned.',
  'return_refund_sale_line_required': 'Each return line needs a sale item or a product.',
}

export function returnRefusalText(error: unknown, translate: (key: string, fallback: string) => string): string | null {
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : ''
  if (!Object.prototype.hasOwnProperty.call(RETURN_REFUSAL_ERRORS, code)) return null
  return translate(code, RETURN_REFUSAL_ERRORS[code])
}
