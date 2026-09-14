// The one length limit every stock-movement reason writer enforces.
//
// Measured in CODE UNITS (reason.length), never in UTF-8 bytes. Khmer is three
// bytes per character, so a byte budget refuses a 167-character Khmer reason
// while accepting a 500-character English one -- and that is exactly what
// happened: the session wire measured bytes (lib/stockSession.ts's text()
// budget, which answered request_too_large) while POST /api/inventory/adjust,
// POST /api/batches and PATCH /movements/:id/reason counted characters. One
// number, one measure, one error code on all four.
//
// 512 rather than the 500 the input box stops at, because a reason is not
// always written as typed: Inventory.tsx's undo/redo prepends 'Undo: ' /
// 'Redo: ' (six characters) to the original reason, so a maximum-length reason
// has to survive that or its own undo is refused by the same wire that
// accepted it.
export const STOCK_REASON_MAX_LENGTH = 512

export function stockReasonTooLong(reason: unknown): boolean {
  return typeof reason === 'string' && reason.length > STOCK_REASON_MAX_LENGTH
}
