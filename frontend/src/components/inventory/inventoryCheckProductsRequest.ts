import type { QueryParams } from '../../api/query.ts'

/** What the page has learned about the server's products list: nothing yet, the check-status list (ic_simple on), or the older list (ic_simple off, the default). */
export type ProductsServer = 'unknown' | 'simple' | 'old'

/** Only the check-status list answers with `simple: true`; any other answer is the older one. */
export function productsServerOf(answer: { simple?: boolean }): ProductsServer {
  return answer.simple === true ? 'simple' : 'old'
}

/** Inside a session the older list names the three item states unstarted | done | issue; the page's in-session choices are in_check | ok | issue. */
const OLD_SESSION_STATE: Record<string, string> = { in_check: 'unstarted', ok: 'done', issue: 'issue' }

/** True when the older list has no word for the status choice this request holds (anything but Issues, or a session's three), so asking it drops the choice rather than honouring it. */
export function oldListDropsStatus(params: QueryParams): boolean {
  return typeof params.checkState === 'string' && params.checkState !== '' && !('state' in productsWireParams(params, 'old', false))
}

/**
 * The query one products read puts on the wire. The page thinks in the check-status words (checkState, and summary=0 on a page step), which only the ic_simple
 * list knows; the older list refuses a key it does not know with a 400. So once an answer has shown which list this is, the older one is asked in its own words:
 * the Issues view is state=issue, a session's status choice is its state (unstarted | done | issue), a status it cannot honour is left out (the page does not offer
 * it), and it is never told to skip a summary it does not compute.
 * Before any answer the page cannot tell, and Issues goes out as checkState=issue, which the ic_simple list reads and the older list maps to state=issue.
 */
export function productsWireParams(params: QueryParams, server: ProductsServer, skipSummary: boolean): QueryParams {
  // The date chips (checkedOn) belong to the wired list alone: neither older list has a word for them.
  const { checkedOn: _checkedOn, ...forWire } = params
  if (server === 'old') {
    // The older list is told nothing about a grouping it cannot draw.
    const { checkState, groupBy: _groupBy, ...rest } = forWire
    const state = typeof checkState !== 'string' ? undefined : rest.sessionId ? Object.hasOwn(OLD_SESSION_STATE, checkState) ? OLD_SESSION_STATE[checkState] : undefined : checkState === 'issue' ? 'issue' : undefined
    return state ? { ...rest, state } : rest
  }
  return server === 'simple' && skipSummary ? { ...forWire, summary: 0 } : forWire
}

/**
 * The scope recorded on a NEW count session: the listing's own filters, without the empty ones and without the date chip. checkedOn is a filter of the wired list and its overlay alone; the scope of a new
 * session answers it with 400 inventory_check_invalid_query (parameter "checkedOn"), so it must never ride along, even if a date chip was chosen before the page fell back to an older list.
 */
export function sessionScopeParams(params: QueryParams): QueryParams {
  return Object.fromEntries(Object.entries(params).filter(([key, value]) => key !== 'checkedOn' && value !== '' && value != null))
}
