import type { QueryParams } from '../../api/query.ts'

/** What the page has learned about the server's products list: nothing yet, the check-status list (ic_simple on), or the older list (ic_simple off, the default). */
export type ProductsServer = 'unknown' | 'simple' | 'old'

/** Only the check-status list answers with `simple: true`; any other answer is the older one. */
export function productsServerOf(answer: { simple?: boolean }): ProductsServer {
  return answer.simple === true ? 'simple' : 'old'
}

/** Inside a session the older list names the three item states unstarted | done | issue; the page's in-session choices are in_check | ok | issue. */
const OLD_SESSION_STATE: Record<string, string> = { in_check: 'unstarted', ok: 'done', issue: 'issue' }

/**
 * The query one products read puts on the wire. The page thinks in the check-status words (checkState, and summary=0 on a page step), which only the ic_simple
 * list knows; the older list refuses a key it does not know with a 400. So once an answer has shown which list this is, the older one is asked in its own words:
 * the Issues view is state=issue, a session's status choice is its state (unstarted | done | issue), a status it cannot honour is left out (the page does not offer
 * it), and it is never told to skip a summary it does not compute.
 * Before any answer the page cannot tell, and Issues goes out as checkState=issue, which the ic_simple list reads and the older list maps to state=issue.
 */
export function productsWireParams(params: QueryParams, server: ProductsServer, skipSummary: boolean): QueryParams {
  if (server === 'old') {
    const { checkState, ...rest } = params
    const state = typeof checkState !== 'string' ? undefined : rest.sessionId ? Object.hasOwn(OLD_SESSION_STATE, checkState) ? OLD_SESSION_STATE[checkState] : undefined : checkState === 'issue' ? 'issue' : undefined
    return state ? { ...rest, state } : rest
  }
  return server === 'simple' && skipSummary ? { ...params, summary: 0 } : params
}
