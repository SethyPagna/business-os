import type { InventoryCheckApprovalDecision } from '../../api/inventoryChecksTransport.ts'

/** One approval can take many requests (the plan's stock lines per request): this repeats the SAME decision until the server says done. */
export type ApprovalFlowResult = { outcome: 'done' | 'cancelled' | 'stalled' | 'refused'; last: InventoryCheckApprovalDecision | null }

/**
 * Upper bound of requests in one approval. The smallest plan writes one stock line per request, and a count carries at most the plan's line cap of lines (a dated line is one per received date) and
 * its product cap of products (capabilities.lotLinesPerSubmission / productsPerSubmission, which the server takes from getPlanLimits): the bound follows whichever is larger, so raising a cap on the server
 * can never stall an approval. SLACK covers the takeover and deferred requests that move no stock. With no cap known the old 500-product bound holds. The first answer's own `remaining` can only raise it.
 */
export const APPROVAL_SLACK = 20
export const MAX_APPROVAL_REQUESTS = 500 + APPROVAL_SLACK
export const approvalRequestBound = (caps?: { lotLinesPerSubmission?: number; productsPerSubmission?: number } | null): number =>
  Math.max(500, Number(caps?.lotLinesPerSubmission) || 0, Number(caps?.productsPerSubmission) || 0) + APPROVAL_SLACK

export async function runApprovalFlow(args: {
  /** Sends the decision. The request id must be the same on every call of one flow: it is what makes a repeat safe. */
  send: () => Promise<InventoryCheckApprovalDecision>
  onProgress?: (result: InventoryCheckApprovalDecision) => void
  isCurrent: () => boolean
  /** The most requests to send (approvalRequestBound of the page's capabilities). */
  maxRequests?: number
}): Promise<ApprovalFlowResult> {
  let last: InventoryCheckApprovalDecision | null = null
  let allowed = args.maxRequests ?? MAX_APPROVAL_REQUESTS
  for (let step = 0; step < allowed; step++) {
    const result = await args.send()
    last = result
    if (step === 0 && Number.isFinite(result.remaining)) allowed = Math.max(allowed, result.remaining + APPROVAL_SLACK)
    if (!args.isCurrent()) return { outcome: 'cancelled', last }
    args.onProgress?.(result)
    if (result.done) return { outcome: 'done', last }
    // Everything still unapplied is a line the approval cannot apply (it names the reason): asking again changes nothing, the person decides (fix the cause, or close).
    if (result.refused?.length && result.remaining <= result.refused.length) return { outcome: 'refused', last }
    // A takeover moves no stock by design: the repeat continues under the new approver's own request. So does a request that planned the count and ran out of statements before writing.
    if (result.takeover || result.deferred) continue
    // Lines the stock writer refused, or a request that moved nothing: stop and let the person look instead of asking again forever.
    if (result.failed?.length || result.applied === 0) return { outcome: 'stalled', last }
  }
  return { outcome: 'stalled', last }
}
