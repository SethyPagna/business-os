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
import type { StockWriteStatement } from './productBatches'

type Statement = StockWriteStatement
export const SET_CLOSE_TITLE = 'Set from Inventory'
export const SET_CLOSE_MEMBERSHIP = 'stock_set'
const EPS = '0.000000001'

// The product's newest done/issue item at the branch inside the actor's organization (the same order the Issues filter uses).
const LATEST = `SELECT i.session_id AS session_id, i.state AS state, i.counted_quantity AS counted, s.scope_json AS scope_json
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
function eventStatements(params: Record<string, unknown>, note: string): Statement[] {
  const present = 'EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@sid)'
  return [
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT @sid,NULL,@actor,@actorName,'create',@key||'-create',@hash,'null',json_object('status','closed','revision',0,'members',1,'note',@note),json_object('sessionRevision',0),@now WHERE ${present}`, params: { ...params, note } },
    { sql: `INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)
      SELECT @sid,@product,@actor,@actorName,'close',@key||'-close',@hash,json_object('status','closed','revision',0),json_object('status','closed','revision',0,'note',@note),json_object('sessionRevision',0),@now WHERE ${present}`, params: { ...params, note } },
  ]
}

/** The statements that close the Issue after a Set's quantity statements (apply, or redo): all conditional, no effect when the Issue stays open. The last one writes issue_closed into the stored answer. */
export function closeIssueStatements(args: SetCloseArgs, now = new Date().toISOString(), options: { sessionId?: string; answer?: boolean } = {}): Statement[] {
  const params = parameters(args, now, options.sessionId)
  return [
    { sql: `INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      SELECT @sid,@organization,@branch,@actor,@title,'closed',0,
        json_object('membership','${SET_CLOSE_MEMBERSHIP}','operation',@operation,'closes',(SELECT session_id FROM (${LATEST}))),@now,@now,@now WHERE ${CLOSABLE}`, params },
    { sql: `INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      SELECT @sid,@product,@branch,json_object('name',p.name,'image_path',p.image_path,'unit',p.unit,'parent_id',p.parent_id,'is_group',p.is_group),${BRANCH_NOW},
        json_object('quantity',${BRANCH_NOW},'operation',@operation),'done',${BRANCH_NOW},NULL,1,@actor,@now
      FROM products p WHERE p.id=@product AND EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@sid)`, params },
    ...eventStatements(params, 'Set closed the Issue'),
    // A Set that changed nothing has no operation (and no stored answer): the caller reads whether the session exists.
    ...(options.answer === false ? [] : [{ sql: `UPDATE stock_lot_adjustment_operations SET response_json=json_set(response_json,'$.issue_closed',json(CASE WHEN EXISTS(SELECT 1 FROM inventory_check_sessions WHERE id=@sid) THEN 'true' ELSE 'false' END))
      WHERE id=@operation`, params }]),
  ]
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
    ...eventStatements(params, 'Undo of a Set reopened the Issue'),
  ]
}
