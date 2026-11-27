import type { PendingReturnCreateV1, ReturnCreateRecovery } from '../../../api/returnsTransport.ts'

export type AttemptedReturnRequest = { pending: PendingReturnCreateV1; recovery: ReturnCreateRecovery | undefined }

/**
 * A return or exchange the Worker refused with 409 shift_required_for_cash (owner R40: cash needs an open shift). The Worker answers after its
 * receipt lookup and before any write, so the saved request never committed and is released: the cashier can switch the tender or have a shift
 * opened. Anything else (a lost network, a timeout, another refusal) keeps the saved request, because an earlier attempt may have committed.
 * Returns true only when the request was cleared.
 */
export async function releaseRefusedReturnRequest(
  error: unknown,
  attempted: AttemptedReturnRequest | null,
  clear: (pending: PendingReturnCreateV1, recovery: ReturnCreateRecovery | undefined) => Promise<void>,
): Promise<boolean> {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  if (code !== 'shift_required_for_cash' || !attempted) return false
  try {
    await clear(attempted.pending, attempted.recovery)
    return true
  } catch {
    return false
  }
}
