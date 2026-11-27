export type CashShiftRefusalOutcome =
  | { kind: 'recorded'; response: unknown }
  | { kind: 'release' }
  | { kind: 'keep' }

/**
 * After the Worker refused a frozen checkout for want of an open shift, ask for the receipt of that request id before the cart is freed. An
 * earlier attempt with the same id may still be running and commit later, so only a proven absence releases; a receipt that exists is the sale
 * (show it, never sell again); anything unreadable keeps the frozen request.
 */
export async function cashShiftRefusalOutcome(recover: (requestId: string) => Promise<unknown>, requestId: string): Promise<CashShiftRefusalOutcome> {
  try {
    const proof = await recover(requestId) as { committed?: unknown; response?: unknown } | null | undefined
    if (proof?.committed === true) return { kind: 'recorded', response: proof.response }
    if (proof?.committed === false) return { kind: 'release' }
  } catch {
    return { kind: 'keep' }
  }
  return { kind: 'keep' }
}
