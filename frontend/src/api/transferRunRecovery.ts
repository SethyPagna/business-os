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
//   state                event                        next state      stock
//   new                  send (saved dispatched first)
//                        -> 2xx                       cleared         moved once (receipt)
//                        -> proving refusal           refused         not moved (no receipt)
//                        -> anything else             unknown         maybe moved; key kept
//   refused              Retry                        refusal stripped BEFORE dispatch, then as sent
//   refused              Edit                         cleared, lines back in the form (new key on send)
//   refused              Discard (confirm)            cleared         none
//   unknown (sticky)     Retry -> 2xx                 cleared         moved once (replayed receipt)
//   unknown (sticky)     Retry -> anything else       unknown         Edit is NEVER offered
//   unknown              Discard (confirm + warning)  cleared         none by us; may already have moved
//   sent, tab closed     reload                       unknown (sent and no refusal on record)
//
// "Proving refusal" is api/transferRunRefusal.ts's allowlist: codes the
// transfer routes emit only after finding no idempotency receipt for the key
// (R-transfer3). A 403 or an unreadable-body 400 is answered BEFORE that
// lookup, so on a Retry it says nothing about an earlier, lost send: it is an
// unknown result, and offering Edit there resent applied lines under a new
// key (moved 10 for a transfer of 5).
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
  // R-transfer3 (b): a run that was sent before and is still saved WITHOUT a
  // recorded refusal ended with no known result -- a lost reply, a 5xx, a
  // non-proving 4xx, or a tab closed mid-send. That is sticky: whatever a
  // later Retry answers, the run is never offered for Edit again.
  const unknownBefore = !!run.outcomeUnknown || (!!run.dispatched && !run.refusal)
  let latest = {
    ...withoutRefusal(run),
    dispatched: true,
    ...(unknownBefore ? { outcomeUnknown: true } : {}),
  } as T
  // Persisted BEFORE the first request: a refusal never outlives a later
  // dispatch, and a send that dies with the tab is known to have been sent.
  // If this cannot be saved, nothing is sent.
  checkpoint(latest)
  try {
    return await executeSavedTransferRun(latest, (next) => {
      latest = next as T
      checkpoint(next as T)
    }, send) as T
  } catch (error) {
    const refusal = transferRefusalFromError(error)
    // The operator must see the server's answer even if this record fails.
    // A failed record of a refusal leaves the run "sent, no refusal", which
    // the next call reads as unknown -- the safe direction.
    try {
      checkpoint(refusal && !latest.outcomeUnknown ? { ...latest, refusal } : { ...latest, outcomeUnknown: true })
    } catch { /* keep the original error */ }
    throw error
  }
}

