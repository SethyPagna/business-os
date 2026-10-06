// N2 (loophole review 2026-10-06): the till's mirror of the Worker's shift
// rule for POST /api/sales (cloudflare/src/lib/saleShiftRequirement.ts).
//
// A sale is rung inside the cashier's OPEN shift for today, unless the
// account is exempt (an administrator while Settings exempts administrators).
// The drawer reconciles only sales inside a shift's window, so a sale rung
// before registering or after End Shift is cash no drawer expects.
//
// The Worker enforces this; the till only refuses early with the same coded
// sentence. An unknown state (still loading, or the read failed) returns
// null so the till never invents a refusal -- the Worker decides.
import type { ShiftState } from '../api/shiftTransport.ts'

export type SaleShiftBlock = 'sale_shift_required' | 'sale_shift_closed'

export function saleShiftBlock(state: Pick<ShiftState, 'exempt' | 'needs_registration' | 'is_open'> | null | undefined): SaleShiftBlock | null {
  if (!state || state.exempt) return null
  if (state.needs_registration) return 'sale_shift_required'
  return state.is_open ? null : 'sale_shift_closed'
}
