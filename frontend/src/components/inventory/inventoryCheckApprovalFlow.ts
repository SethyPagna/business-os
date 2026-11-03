import type { InventoryCheckApprovalDecision } from '../../api/inventoryChecksTransport.ts'

/** One approval can take many requests (the plan's stock lines per request): this repeats the SAME decision until the server says done. */
export type ApprovalFlowResult = { outcome: 'done' | 'cancelled' | 'stalled'; last: InventoryCheckApprovalDecision | null }

/** Upper bound of requests in one approval: a submission holds at most 500 products and the smallest plan writes one line per request. */
export const MAX_APPROVAL_REQUESTS = 520

export async function runApprovalFlow(args: {
  /** Sends the decision. The request id must be the same on every call of one flow: it is what makes a repeat safe. */
  send: () => Promise<InventoryCheckApprovalDecision>
  onProgress?: (result: InventoryCheckApprovalDecision) => void
  isCurrent: () => boolean
}): Promise<ApprovalFlowResult> {
  let last: InventoryCheckApprovalDecision | null = null
  for (let step = 0; step < MAX_APPROVAL_REQUESTS; step++) {
    const result = await args.send()
    last = result
    if (!args.isCurrent()) return { outcome: 'cancelled', last }
    args.onProgress?.(result)
    if (result.done) return { outcome: 'done', last }
    // Lines the stock writer refused, or a request that moved nothing: stop and let the person look instead of asking again forever.
    if (result.failed?.length || result.applied === 0) return { outcome: 'stalled', last }
  }
  return { outcome: 'stalled', last }
}
