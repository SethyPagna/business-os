import { useEffect, useRef, useState } from 'react'
import { decideInventoryCheckApproval, decideInventoryCheckLine, type InventoryCheckApproval, type InventoryCheckSessionItem, type InventoryCheckWriteScope } from '../../api/inventoryChecksTransport.ts'
import { createApprovalActions, type ApprovalAttempt, type ApprovalDeps } from './inventoryCheckApprovalController.ts'

type Args = Omit<ApprovalDeps, 'inFlight' | 'setRefused' | 'setLineError' | 'approvalAttempt' | 'lineAttempt' | 'send' | 'approval' | 'items'> & {
  approval: InventoryCheckApproval | null
  items: readonly InventoryCheckSessionItem[]
  writeScope: InventoryCheckWriteScope
  /** The page's one-write-at-a-time flag, shared with every other write on it. */
  inFlight: { current: boolean }
}

/**
 * The decisions on the open session's submitted count (Approve all, accept some lines, reject or close the whole count, reject / modify / reopen one line), moved out of the page.
 * It keeps what the panel shows about them: the lines the last request could not apply, and the sentence for a refused line. The page keeps the mount.
 */
export function useInventoryCheckApproval({ writeScope, ...args }: Args) {
  // One request id per decision, however many requests it takes and however often it is retried: it is what makes every repeat safe.
  const approvalAttempt = useRef<ApprovalAttempt | null>(null)
  const lineAttempt = useRef<ApprovalAttempt | null>(null)
  const [refusedLines, setRefusedLines] = useState<Record<string, string>>({})
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({})
  const setLineError = (productId: string, text: string | null) => setLineErrors(previous => {
    if (text === null) { if (!(productId in previous)) return previous; const next = { ...previous }; delete next[productId]; return next }
    return previous[productId] === text ? previous : { ...previous, [productId]: text }
  })
  // A line's sentence belongs to the session it was said in.
  useEffect(() => { setLineErrors({}); setRefusedLines({}) }, [args.sessionId])
  const actions = createApprovalActions({
    ...args, approvalAttempt, lineAttempt, setRefused: setRefusedLines, setLineError,
    send: { approval: input => decideInventoryCheckApproval(writeScope, input), line: input => decideInventoryCheckLine(writeScope, input as Parameters<typeof decideInventoryCheckLine>[1]) },
  })
  return { ...actions, refusedLines, lineErrors }
}
