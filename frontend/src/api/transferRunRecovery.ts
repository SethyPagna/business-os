// U-transfer3 (27 Sep 2026): a saved transfer run that the server REFUSED can
// be edited or discarded instead of locking the transfer form forever.
//
// A transfer run (api/branchTransport.ts) is saved before its first request
// and cleared only when every request succeeded, so a lost reply can be
// retried under the same idempotency key without moving stock twice. While a
// run is saved the Branch TransferModal disables its whole form and Inventory
// refuses to open another transfer. That lock is right for an UNKNOWN result
// -- the stock may already have moved -- but a definitive refusal (400
// insufficient stock, 404 product or received date gone, 409 lot short /
// stock changed / branch rule) answers the same on every Retry, and the
// operator could then never edit the numbers or send another transfer.
//
// The transition table this module enforces, per saved run:
//
//   state              event                      next state         stock
//   pending (no refusal) Retry -> 2xx            cleared            moved once (receipt)
//   pending (no refusal) Retry -> unknown/5xx    pending            maybe moved; key kept
//   pending (no refusal) Retry -> definitive 4xx refused            not moved (batch rolled back)
//   refused            Retry                      refusal stripped BEFORE dispatch, then as pending
//   refused            Edit                       cleared, lines back in the form (new key on send)
//   refused            Discard (confirm)          cleared            none
//   pending            Discard (confirm + warning) cleared           none by us; may already have moved
//
// A recorded refusal never outlives a later dispatch: executeTransferRun
// below strips it (and persists the stripped run) before the first request
// goes out, so a reply lost on that Retry can never be mistaken for a refusal
// and offered for Edit -- which would send the same lines under a NEW key.

import { executeTransferRun as executeSavedTransferRun, type PendingTransferRun } from './branchTransport.ts'
import { transferRefusalFromError, type RecoverableTransferRun } from './transferRunRefusal.ts'

export * from './transferRunRefusal.ts'

function withoutRefusal<T extends RecoverableTransferRun>(run: T): T {
  const next = { ...run }
  delete next.refusal
  return next
}

/**
 * api/branchTransport.ts's executeTransferRun, plus the refusal record.
 * Same arguments, same result, same thrown error.
 */
export async function executeTransferRun<T extends RecoverableTransferRun>(
  run: T,
  checkpoint: (next: T) => void,
  send?: (request: PendingTransferRun['requests'][number]) => Promise<unknown>,
): Promise<T> {
  let latest = run
  if (run.refusal) {
    // Persist the stripped run first; if that cannot be saved, nothing is sent.
    latest = withoutRefusal(run)
    checkpoint(latest)
  }
  try {
    return await executeSavedTransferRun(latest, (next) => {
      latest = next as T
      checkpoint(next as T)
    }, send) as T
  } catch (error) {
    const refusal = transferRefusalFromError(error)
    if (refusal) {
      // The operator must see the server's answer even if this record fails;
      // an unrecorded refusal only means Edit appears after the next Retry.
      try { checkpoint({ ...latest, refusal }) } catch { /* keep the original error */ }
    }
    throw error
  }
}

