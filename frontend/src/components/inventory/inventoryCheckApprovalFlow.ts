import type { InventoryCheckApprovalDecision } from '../../api/inventoryChecksTransport.ts'

/** One approval can take many requests (the plan's stock lines per request): this repeats the SAME decision until the server says done. */
export type ApprovalFlowResult = { outcome: 'done' | 'cancelled' | 'stalled'; last: InventoryCheckApprovalDecision | null }

/** The server asked for each request's answer to be confirmed once when stock moved since the count. */
export const STOCK_DRIFTED = 'inventory_check_stock_drifted'
/** Upper bound of requests in one approval: a submission holds at most 500 products and the smallest plan writes one line per request. */
export const MAX_APPROVAL_REQUESTS = 520

const codeOf = (cause: unknown): string | null => {
  const code = (cause as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : null
}

export async function runApprovalFlow(args: {
  /** Sends the decision. The request id must be the same on every call of one flow: it is what makes a repeat safe. */
  send: (extra: { confirmDrift?: boolean }) => Promise<InventoryCheckApprovalDecision>
  /** Asked at most once, when the server reports stock that moved since the count. */
  confirmDrift: () => Promise<boolean>
  onProgress?: (result: InventoryCheckApprovalDecision) => void
  isCurrent: () => boolean
}): Promise<ApprovalFlowResult> {
  let confirmed = false
  let last: InventoryCheckApprovalDecision | null = null
  for (let step = 0; step < MAX_APPROVAL_REQUESTS; step++) {
    let result: InventoryCheckApprovalDecision
    try {
      result = await args.send(confirmed ? { confirmDrift: true } : {})
    } catch (cause) {
      if (codeOf(cause) === STOCK_DRIFTED && !confirmed) {
        if (!await args.confirmDrift() || !args.isCurrent()) return { outcome: 'cancelled', last }
        confirmed = true
        continue
      }
      throw cause
    }
    last = result
    if (!args.isCurrent()) return { outcome: 'cancelled', last }
    args.onProgress?.(result)
    if (result.done) return { outcome: 'done', last }
    // Lines the stock writer refused, or a request that moved nothing: stop and let the person look instead of asking again forever.
    if (result.failed?.length || result.applied === 0) return { outcome: 'stalled', last }
  }
  return { outcome: 'stalled', last }
}
