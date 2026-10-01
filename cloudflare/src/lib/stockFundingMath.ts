export type FundingState = { gross4: number; paid4: number; debt4: number; credit4: number; asset4: number; cashIn4: number; cashOut4: number; shipping4: number }
export type FundingKind = 'admit' | 'pending' | 'accept' | 'cancel' | 'payment' | 'refund' | 'shipping'
export function fundingTransition(state: FundingState, kind: FundingKind, amount4: number): FundingState {
  if (Object.values(state).some(value => !Number.isSafeInteger(value) || value < 0 || value > 1000000000000000)) throw new RangeError('invalid_funding_state')
  if (state.gross4 !== state.paid4 + state.debt4 + state.credit4 - state.asset4 - state.cashIn4 || state.credit4 > state.gross4) throw new RangeError('funding_conservation_failed')
  if (!Number.isSafeInteger(amount4) || amount4 <= 0 || amount4 > 1000000000000000) throw new RangeError('invalid_funding_amount')
  const next = { ...state }
  if (kind === 'accept') {
    if (next.credit4 + amount4 > next.gross4) throw new RangeError('coverage_exceeds_source_basis')
    const offset = Math.min(next.debt4,amount4)
    next.debt4 -= offset; next.credit4 += amount4; next.asset4 += amount4 - offset
  } else if (kind === 'payment') {
    if (amount4 > next.debt4) throw new RangeError('payment_exceeds_debt')
    next.paid4 += amount4; next.debt4 -= amount4; next.cashOut4 += amount4
  } else if (kind === 'refund') {
    if (amount4 > next.asset4) throw new RangeError('refund_exceeds_asset')
    next.asset4 -= amount4; next.cashIn4 += amount4
  } else if (kind === 'shipping') next.shipping4 += amount4
  else if (kind !== 'pending' && kind !== 'cancel') throw new RangeError('unsupported_funding_transition')
  if (Object.values(next).some(value => !Number.isSafeInteger(value) || value > 1000000000000000)) throw new RangeError('funding_overflow')
  return next
}
