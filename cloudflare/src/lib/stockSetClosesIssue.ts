// INV S6 (VERIFY-INV-B N2, audit G14): a direct Set closes the Issue it fixes, in the SAME atomic batch as the Set.
//
// A product's latest count (the newest done/issue item at the branch, as lib/inventoryCheckList.ts reads it) that is an Issue is closed by a Set when, AFTER the Set's own quantity statements:
//   - every recorded line of that count matches stock (a count per received date: each date's quantity at the branch; a branch-total line: the branch quantity; an older product-level
//     count with no lines: the branch quantity), so a partial Set of a two-date Issue leaves the Issue open;
//   - no count of the product waits for approval (a Set never replaces a colleague's pending count).
// "Closes" is a new closed session titled "Set from Inventory" holding one done item at the new branch total, with the existing create and close events (no migration, no new action).
// Every statement is conditional in SQL, so the answer is exact: issue_closed is written into the operation's stored answer by the batch itself (a replay answers the same).
//
// Transitions (generation g of the Set operation O, product P, branch B):
//   apply g=0 / redo   latest(P,B) = Issue and every line matches and nothing waits   ->  insert session S (scope.operation=O, scope.closes=<the Issue's session>), item(done), events
//   undo               latest(P,B) is S (the count this Set made)                    ->  insert session S' = a copy of the Issue S closed (its item and lines), events: the Issue is open again
//                      anything else (a newer count was made since)                  ->  nothing; the newer count stands
//   Applying the same request again answers from the stored operation (nothing is inserted twice); redo closes only when the first apply did (issue_closed true).
import { waitingLineSql } from './inventoryCheckSessions'
import { autoCloseParams, autoCloseTaskStatements, reopenParams, reopenTaskStatements } from './inventoryCheckTasks'
import type { StockWriteStatement } from './productBatches'

type Statement = StockWriteStatement
export const SET_CLOSE_TITLE = 'Set from Inventory'
export const SET_CLOSE_MEMBERSHIP = 'stock_set'
const EPS = '0.000000001'
const I = 'inventory_check_items'

// The product's newest done/issue item at the branch inside the actor's organization (the same order the Issues filter uses).
export const LATEST = `SELECT i.session_id AS session_id, i.state AS state, i.counted_quantity AS counted, s.scope_json AS scope_json
  FROM inventory_check_sessions s JOIN inventory_check_items i ON i.session_id=s.id AND i.branch_id=s.branch_id
  WHERE s.organization_id IS @organization AND s.branch_id=@branch AND i.product_id=@product AND i.state IN ('done','issue')
  ORDER BY i.updated_at DESC, i.session_id DESC LIMIT 1`
const BRANCH_NOW = 'COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@branch),0)'
const LINE_NOW = `CASE l.scope WHEN 'lot' THEN COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=l.batch_id AND branch_id=@branch),0) ELSE ${BRANCH_NOW} END`

/** True in SQL when the product's latest count is an Issue every line of which matches stock now, and nothing waits for approval. */
const CLOSABLE = `(SELECT state FROM (${LATEST}))='issue'
  AND (EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id=(SELECT session_id FROM (${LATEST})) AND l.product_id=@product AND l.branch_id=@branch)
       OR abs(COALESCE((SELECT counted FROM (${LATEST})),-1)-${BRANCH_NOW})<=${EPS})
  AND NOT EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id=(SELECT session_id FROM (${LATEST})) AND l.product_id=@product AND l.branch_id=@branch
       AND abs(l.counted_quantity-(${LINE_NOW}))>${EPS})
  AND NOT EXISTS(SELECT 1 FROM inventory_check_items i JOIN inventory_check_approvals a ON a.session_id=i.session_id
       WHERE i.product_id=@product AND i.branch_id=@branch AND ${waitingLineSql('a', 'i')})`

/** True in SQL when the product's latest count is the one a Set of operation @operation made. */
const MADE_BY_OPERATION = `json_extract((SELECT scope_json FROM (${LATEST})),'$.membership')='${SET_CLOSE_MEMBERSHIP}' AND json_extract((SELECT scope_json FROM (${LATEST})),'$.operation')=@operation`

export type SetCloseArgs = { productId: number; branchId: number; organization: number | null; operation: string; generation: number; actorId: number; actorName: string }

function parameters(args: SetCloseArgs, now: string, sid = crypto.randomUUID()) {
  return { sid, now, product: args.productId, branch: args.branchId, organization: args.organization ?? null, operation: args.operation, actor: args.actorId, actorName: args.actorName,
    title: SET_CLOSE_TITLE, key: `stock-set-${args.operation}-g${args.generation}`, hash: `stock-set:${args.operation}` }
}
/** The count tasks this write completes (a Set that closes a difference records a Done count at the branch, which ticks the open tasks that hold the product): inventoryCheckTasks.ts autoCloseTaskStatements, over the session @sid (no session, no counts, nothing read). */
function taskStatements(params: Record<string, unknown>): { statements: Statement[]; ids: string } {
  const shared = autoCloseParams({ src: params.sid as string, organization: params.organization as number | null, branchId: params.branch as number, actorId: params.actor as number, actorName: params.actorName as string | null,
    key: params.key as string, hash: params.hash as string, now: params.now as string })
  // The ids of the tasks that closed, from the events the auto-close wrote (this request's own prefix, this time).
  return { statements: autoCloseTaskStatements().statements.map(({ sql }) => ({ sql, params: shared })),
    ids: `SELECT e.session_id FROM inventory_check_events e WHERE e.actor_id=@actorId AND e.request_id>=@tcFrom AND e.request_id<@tcTo AND e.request_hash=@hash AND e.action='close' AND e.created_at=@now` }
}
function eventStatements(params: Record<string, unknown>, note: string, keySql = '@key'): Statement[] {
  const present = 'EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@sid)'
  return [
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT @sid,NULL,@actor,@actorName,'create',${keySql}||'-create',@hash,'null',json_object('status','closed','revision',0,'members',1,'note',@note),json_object('sessionRevision',0),@now WHERE ${present}`, params: { ...params, note } },
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT @sid,@product,@actor,@actorName,'close',${keySql}||'-close',@hash,json_object('status','closed','revision',0),json_object('status','closed','revision',0,'note',@note),json_object('sessionRevision',0),@now WHERE ${present}`, params: { ...params, note } },
  ]
}

/** The statements that close the Issue after a Set's quantity statements (apply, or redo): all conditional, no effect when the Issue stays open. The last one writes issue_closed into the stored answer. */
export function closeIssueStatements(args: SetCloseArgs, now = new Date().toISOString(), options: { sessionId?: string; answer?: boolean; restore?: boolean; operationSql?: string } = {}): Statement[] {
  const params = parameters(args, now, options.sessionId)
  // A Redo restores a record made earlier: it is not a count, so it never ticks or closes a count task (owner ruling, 19 Nov). Its session says so (restore), and the done rule skips it.
  const restore = options.restore === true
  const tasks = taskStatements(params)
  return [
    { sql: `INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      SELECT @sid,@organization,@branch,@actor,@title,'closed',0,
        json_object('membership','${SET_CLOSE_MEMBERSHIP}','operation',${options.operationSql ?? '@operation'},'closes',(SELECT session_id FROM (${LATEST}))${restore ? ",'restore',1" : ''}),@now,@now,@now WHERE ${CLOSABLE}`, params },
    { sql: `INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      SELECT @sid,@product,@branch,json_object('name',p.name,'image_path',p.image_path,'unit',p.unit,'parent_id',p.parent_id,'is_group',p.is_group),${BRANCH_NOW},
        json_object('quantity',${BRANCH_NOW},'operation',@operation),'done',${BRANCH_NOW},NULL,1,@actor,@now
      FROM products p WHERE p.id=@product AND EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@sid)`, params },
    ...eventStatements(params, 'Set closed the difference', options.operationSql ? `'stock-set-'||${options.operationSql}||'-g${args.generation}'` : '@key'),
    ...(restore ? [] : tasks.statements),
    // A Set that changed nothing has no operation (and no stored answer): the caller reads whether the session exists.
    ...(options.answer === false ? [] : [{ sql: `UPDATE stock_lot_adjustment_operations SET response_json=json_set(response_json,'$.issue_closed',json(CASE WHEN EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@sid) THEN 'true' ELSE 'false' END))
      WHERE id=@operation`, params },
    // The ids of the tasks the Set closed ride in the stored answer (closed_tasks), only when it closed any, so every other stored answer is as it was and a replay answers the same.
    ...(restore ? [] : [{ sql: `UPDATE stock_lot_adjustment_operations SET response_json=json_set(response_json,'$.closed_tasks',json((SELECT json_group_array(session_id) FROM (${tasks.ids})))) WHERE id=@operation AND EXISTS(${tasks.ids})`, params: { ...params, ...tasks.statements[0].params } }])]),
  ]
}

/** The ids of the tasks a Set closed (a JSON array expression and its parameters), for the answer of a Set that changed nothing and so has no stored operation: the same events the close wrote, by this request's prefix and time. */
export function closedTasksSelect(args: SetCloseArgs, now: string, sessionId: string): { expr: string; params: Record<string, unknown> } {
  const params = parameters(args, now, sessionId), shared = taskStatements(params)
  return { expr: `(SELECT json_group_array(session_id) FROM (${shared.ids}))`, params: shared.statements[0].params as Record<string, unknown> }
}

/** The statements an Undo adds: the Issue this Set closed is open again (a copy of its item and lines as a new newest count), only while the count this Set made is still the latest. */
export function reopenIssueStatements(args: SetCloseArgs, now = new Date().toISOString()): Statement[] {
  const params = parameters(args, now)
  const closes = `(SELECT json_extract(scope_json,'$.closes') FROM (${LATEST}))`
  return [
    { sql: `INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      SELECT @sid,@organization,@branch,@actor,@title,'closed',0,json_object('membership','${SET_CLOSE_MEMBERSHIP}_undo','operation',@operation,'reopens',${closes}),@now,@now,@now
      WHERE ${MADE_BY_OPERATION} AND EXISTS(SELECT 1 FROM inventory_check_items WHERE session_id=${closes} AND product_id=@product AND branch_id=@branch)`, params },
    { sql: `INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      SELECT @sid,o.product_id,o.branch_id,o.product_snapshot_json,o.baseline_quantity,o.baseline_json,o.state,o.counted_quantity,o.reason,1,@actor,@now
      FROM inventory_check_items o WHERE o.session_id=(SELECT json_extract(scope_json,'$.reopens') FROM inventory_check_sessions WHERE id=@sid) AND o.product_id=@product AND o.branch_id=@branch`, params },
    { sql: `INSERT INTO inventory_check_lot_lines(session_id,product_id,branch_id,batch_id,scope,seen_quantity,counted_quantity,seen_source,created_at)
      SELECT @sid,l.product_id,l.branch_id,l.batch_id,l.scope,l.seen_quantity,l.counted_quantity,l.seen_source,@now
      FROM inventory_check_lot_lines l WHERE l.session_id=(SELECT json_extract(scope_json,'$.reopens') FROM inventory_check_sessions WHERE id=@sid) AND l.product_id=@product AND l.branch_id=@branch
        AND EXISTS(SELECT 1 FROM inventory_check_items WHERE session_id=@sid AND product_id=@product)`, params },
    ...eventStatements(params, 'Undo of a Set reopened the difference'),
    // No auto-close: the copy restores a record made earlier, it is not a count (owner ruling, 19 Nov), and the done rule skips its session.
  ]
}

/** The movement a plain Set just wrote: the newest movement row (the Set's own statements insert it last before these; productBatches.planRemovalLotRecord reads it the same way). */
export const PLAIN_SET_OPERATION_SQL = "('m'||(SELECT MAX(id) FROM inventory_movements))"
/** The create event of a plain Set's count session, by the Set's actor: its Revert finds the count by it (one seek of the events' unique key). */
export const plainSetCountKey = (movementId: number): string => `stock-set-m${movementId}-g0-create`
/** For a movement row alias: the plain Set count it recorded, as {id, org, branch}, or NULL. One seek of the events' unique key and one of the sessions' key. */
export const plainSetCountOf = (m: string): string => `(SELECT json_object('id',s.id,'org',s.organization_id,'branch',s.branch_id) FROM inventory_check_events e CROSS JOIN inventory_check_sessions s ON s.id=e.session_id
  WHERE e.actor_id=${m}.user_id AND e.request_id='stock-set-m'||${m}.id||'-g0-create' AND e.action='create')`

/**
 * F1 (lead ruling, 19 Nov): a plain Set (POST /inventory/adjust type set, no setScope: the branch-total conversion to an add or a remove) is a final count exactly like the lot Set.
 * `statements` go at the END of the Set's own stock batch (after its movement); `trailing` after the receipt mark (it writes issue_closed / closed_tasks into a receipt the batch completes, so a
 * replay answers the same). moved: the Set wrote a movement, and its count is keyed by it (operation m<movement id>) so a Revert of it can take the count back; a Set that moved nothing has
 * no movement and nothing to undo, and is keyed by its request (as the lot Set's unchanged path). No D1 call of its own.
 */
export function plainSetCloseStatements(args: Omit<SetCloseArgs, 'operation' | 'generation'> & { requestId: string }, now: string, sessionId: string, moved: boolean) {
  const closing: SetCloseArgs = { ...args, operation: `plain-${args.requestId}`, generation: 0 }
  const statements = closeIssueStatements(closing, now, { sessionId, answer: false, ...(moved ? { operationSql: PLAIN_SET_OPERATION_SQL } : {}) })
  const params = parameters(closing, now, sessionId), tasks = taskStatements(params)
  const trailing: Statement[] = [{ sql: `UPDATE stock_mutation_receipts SET response_json=json_set(
      CASE WHEN EXISTS(${tasks.ids}) THEN json_set(response_json,'$.closed_tasks',json((SELECT json_group_array(session_id) FROM (${tasks.ids})))) ELSE response_json END,
      '$.issue_closed',json(CASE WHEN EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@sid) THEN 'true' ELSE 'false' END))
    WHERE actor_id=@actor AND request_id=@receiptRequest AND completed_at IS NOT NULL`, params: { ...params, ...(tasks.statements[0].params as Record<string, unknown>), receiptRequest: args.requestId } }]
  // statements: 0 the session (issue closed when it landed), 1 its item, 2-3 its events, 4.. the auto-close (closedAt 2 within it)
  const answer = (results: Array<{ meta?: { changes?: number }; results?: unknown[] }> | undefined): Record<string, unknown> => {
    const tail = (results ?? []).slice(-statements.length)
    if (tail.length !== statements.length) return {}
    const closed = (tail[6]?.results ?? []).map((row) => String((row as { id: unknown }).id))
    return { issue_closed: Number(tail[0]?.meta?.changes ?? 0) === 1, ...(closed.length ? { closed_tasks: closed } : {}) }
  }
  return { statements, trailing, answer }
}

/** The Undo or the Redo of a plain Set's count, for its Revert (generation = links from the reverted row to the root + 1: odd takes the count back, even restores it). Statements 0.. are the Issue side, then the count side (same order as replayStockLotSet). */
export function plainSetRevertStatements(a: { productId: number; count: { id: string; org: number | null; branch: number }; rootId: number; setActor: number; generation: number; actorId: number; actorName: string }, now = new Date().toISOString()): { statements: Statement[]; changedAt: number } {
  const closing: SetCloseArgs = { productId: a.productId, branchId: a.count.branch, organization: a.count.org, operation: `m${a.rootId}`, generation: a.generation, actorId: a.actorId, actorName: a.actorName }
  const origin = { setActor: a.setActor, setKey: plainSetCountKey(a.rootId) }
  if (a.generation % 2 === 1) {
    const issue = reopenIssueStatements(closing, now), count = takeBackSetCountStatements(closing, origin, now)
    return { statements: [...issue, ...count.statements], changedAt: issue.length + 1 }
  }
  const issue = closeIssueStatements(closing, now, { restore: true, answer: false }), count = restoreSetCountStatements(closing, origin, now)
  return { statements: [...issue, ...count.statements], changedAt: issue.length + 1 }
}


// THE SET'S OWN COUNT, TAKEN BACK AND RESTORED (owner, 19 Nov: a task's state always follows the counts in effect). A Set that closed a difference wrote one closed session (membership stock_set) holding one Done item:
// the Set's count. An Undo takes that count back (the item turns unstarted: its figure stays in baseline_quantity, its time in updated_at) and reopens the tasks that rested on it; a Redo turns it back into the Done
// count it was, at its ORIGINAL time, and runs the normal auto-close. The sessions an Undo or a Redo writes (stock_set_undo, restore) are still never counts. Inventory_check_sessions.scope_json and the events'
// action list are immutable (migration 0259), which is why the take-back is a state change of the one item, not a marker on the session.
const SET_SESSION = `(SELECT e.session_id FROM inventory_check_events e WHERE e.actor_id=@setActor AND e.request_id=@setKey)`
const EV = 'INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)'
/** Where a Set's own count session is found: the create event of generation 0, by the account that made the Set (one seek of the events' unique key). */
export type SetCountOrigin = { setActor: number; setKey: string }
export const setCountKey = (operation: string): string => `stock-set-${operation}-g0-create`
/** The organization and branch of a Set's count session, as an expression over the same lookup (undefined when the Set closed no difference). The reopen fences by THIS organization, never the undoing user's. */
export const SET_SESSION_FACTS_SQL = `(SELECT json_object('org',s.organization_id,'branch',s.branch_id) FROM inventory_check_events e CROSS JOIN inventory_check_sessions s ON s.id=e.session_id WHERE e.actor_id=@setActor AND e.request_id=@setKey)`

/** Undo: AFTER reopenIssueStatements (they read the latest count, which must still be the Set's). Statements 0-1 take the count back, 2-3 reopen the tasks (the answer rows of statement 3). */
export function takeBackSetCountStatements(args: SetCloseArgs, origin: SetCountOrigin, now = new Date().toISOString()): { statements: Statement[]; reopenedAt: number } {
  const base = parameters(args, now), params = { ...reopenParams({ src: null, undo: true, cause: 'set_undone', organization: args.organization, branchId: args.branchId, actorId: args.actorId, actorName: args.actorName, key: base.key, hash: base.hash, now }),
    product: args.productId, setActor: origin.setActor, setKey: origin.setKey }
  const reopen = reopenTaskStatements(SET_SESSION)
  return { reopenedAt: 3, statements: [
    { sql: `${EV} SELECT i.session_id,i.product_id,@actorId,@actorName,'observe',@key||'-count-taken-back',@hash,
        json_object('state',i.state,'counted_quantity',i.counted_quantity,'reason',i.reason,'revision',i.revision),
        json_object('state','unstarted','counted_quantity',NULL,'reason',NULL,'revision',i.revision+1,'note','Undo of the Set took its count back'),json_object('sessionRevision',0,'itemRevision',i.revision+1),@now
      FROM ${I} i WHERE i.session_id=${SET_SESSION} AND i.product_id=@product AND i.branch_id=@branchId AND i.state='done'`, params },
    { sql: `UPDATE inventory_check_items SET state='unstarted',counted_quantity=NULL,revision=revision+1 WHERE session_id=${SET_SESSION} AND product_id=@product AND branch_id=@branchId AND state='done'`, params },
    ...reopen.statements.map(({ sql }) => ({ sql, params })),
  ] }
}
/** Redo: after closeIssueStatements(restore). The count is restored at its ORIGINAL time (updated_at untouched; the figure is baseline_quantity), then the NORMAL auto-close runs over the Set's own session. */
export function restoreSetCountStatements(args: SetCloseArgs, origin: SetCountOrigin, now = new Date().toISOString()): { statements: Statement[]; closedAt: number } {
  const base = parameters(args, now), params = { ...autoCloseParams({ src: '', organization: args.organization, branchId: args.branchId, actorId: args.actorId, actorName: args.actorName, key: base.key, hash: base.hash, now }),
    product: args.productId, setActor: origin.setActor, setKey: origin.setKey }
  const auto = autoCloseTaskStatements(SET_SESSION)
  return { closedAt: 2 + auto.closedAt, statements: [
    { sql: `${EV} SELECT i.session_id,i.product_id,@actorId,@actorName,'observe',@key||'-count-restored',@hash,
        json_object('state',i.state,'counted_quantity',i.counted_quantity,'reason',i.reason,'revision',i.revision),
        json_object('state','done','counted_quantity',i.baseline_quantity,'reason',NULL,'revision',i.revision+1,'note','Redo of the Set restored its count'),json_object('sessionRevision',0,'itemRevision',i.revision+1),@now
      FROM ${I} i WHERE i.session_id=${SET_SESSION} AND i.product_id=@product AND i.branch_id=@branchId AND i.state='unstarted'`, params },
    { sql: `UPDATE inventory_check_items SET state='done',counted_quantity=baseline_quantity,revision=revision+1 WHERE session_id=${SET_SESSION} AND product_id=@product AND branch_id=@branchId AND state='unstarted'`, params },
    ...auto.statements.map(({ sql }) => ({ sql, params })),
  ] }
}
