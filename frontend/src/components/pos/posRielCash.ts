import { rielCashFieldInvalid, type PaymentMethodKindMap } from '../../utils/paymentMethodKind.ts'
import { roundRielDown, roundRielUp } from '../../utils/rielRounding.ts'

/**
 * The till's riel-cash helpers. They live here, not in posCore.ts: posCore is pulled into the shared storefront chunk (app-shared) by
 * ProductOptionSheet -> ProductDetailSheet, and importing the riel rule (utils/saleStatusResolution.ts, the money-core chunk) from it put
 * money-core into the storefront and index closures. Only POS.tsx imports this file; chunkBoundaryPolicy --bundle keeps money-core out of
 * the boot closures.
 */

/**
 * The riel figure the "Exact ៛" button puts on a tender row. Riel paid in cash is whole 100៛ notes (owner, 27 Oct 2026), so a cash
 * row takes the total DOWN to the note: the customer never pays above the total, and the sub-note remainder is absorbed because a riel
 * payment short by under 100៛ is fully paid (utils/saleStatusResolution.ts shortfallCovered). A total under one note takes that one
 * note. A bank or QR row keeps the whole-riel total, rounded up so it is never short.
 */
export function posExactRielTender(totalKhr: number, isCashMethod: boolean): number {
  return isCashMethod ? roundRielDown(totalKhr) || roundRielUp(totalKhr) : Math.ceil(totalKhr)
}

/**
 * The ids of the tender rows paid by a cash method whose riel is not whole 100-riel notes (owner, 27 Oct 2026: no riel coin
 * below 100, so riel cash is 0 or a multiple of 100; any riel by a bank or QR method). The till marks them and sends
 * nothing; POST /api/sales refuses the same rows with riel_cash_not_hundreds (lib/saleStatusResolution.ts).
 */
export function posRielCashRowIds(rows: readonly { id: string; method: string; khr: string }[], methodKinds: PaymentMethodKindMap = {}): string[] {
  return rows.filter(row => rielCashFieldInvalid(row.method, row.khr, methodKinds)).map(row => row.id)
}
