// Branch cutover registry v3: the action_history family (G12 design §1.3, §1.4).
//
// Only OPEN rows with a registered server applier can ever write again
// (reversible=1, status undoable/redoable, the next transition's payload names
// an applier). Every such row is classified before the move as 'leave' (its
// replay never touches stock at the retired branch) or 'close' (its replay
// could restore or re-take stock at the retired branch, or it is a transfer
// between the two branches). Closing reuses the merge-closure pattern: status
// 'recorded', reversible=0, a marker in last_error, one audit row per row.
//
// Identity is the branch id the cutover was begun with; names never decide.
// The SQL projection and the JS classifier derive the same decision and must
// agree, or the page refuses. The touch bit itself is checked too (verifier
// E9): each page also projects the raw branch ids the touch predicate reads,
// through queries written apart from SOURCE_TOUCH_SQL, and JS re-derives the
// bit from them. A wrong JSON path or join in either query then disagrees.

export const UNDO_CLOSED_BRANCH_RETIRED = 'undo_closed:branch_retired'
export const UNDO_CLOSED_BRANCH_CUTOVER_MOVE = 'undo_closed:branch_cutover_move'
export const UNDO_CLOSED_BRANCH_RETIRED_CODE = 'undo_closed_branch_retired'
export const UNDO_CLOSED_BRANCH_CUTOVER_MOVE_CODE = 'undo_closed_branch_cutover_move'
// English source text for the i18n lane (LI); the packs own the translations.
export const UNDO_CLOSED_BRANCH_RETIRED_MESSAGE = 'Undo closed: this was done at Shop before it was merged into LC Store. Make a new change instead.'
export const UNDO_CLOSED_BRANCH_CUTOVER_MOVE_MESSAGE = 'Undo closed: part of the branch consolidation (Shop → LC Store).'
export const BRANCH_CUTOVER_CLOSURE_AUDIT_ACTION = 'undo_closed_branch_cutover'
export const BRANCH_CUTOVER_SUMMARY_ENTITY = 'branch_cutover'

export const isUndoClosedByBranchCutover = (row: { reversible?: unknown; last_error?: unknown } | null | undefined): boolean =>
  Boolean(row) && !Number(row?.reversible || 0)
    && (row?.last_error === UNDO_CLOSED_BRANCH_RETIRED || row?.last_error === UNDO_CLOSED_BRANCH_CUTOVER_MOVE)

export type CutoverHistoryRule = 'leave' | 'close' | 'close_if_source' | 'close_if_either'
export type CutoverHistoryDecision = 'leave' | 'close'

// One entry per registered applier (undoAppliers.ts APPLIERS). A new applier
// that is not listed here refuses the cutover instead of being left open.
export const CUTOVER_HISTORY_RULES: Readonly<Record<string, CutoverHistoryRule>> = Object.freeze({
  'customer.gender_restore': 'leave',
  'sale.fields.bulk': 'leave',
  'sale.customer.bulk': 'leave',
  'sale.customer.v2.bulk': 'leave',
  'sale.customer.single': 'leave',
  'sale.settlement': 'leave',
  'supplier.backfill': 'leave',
  'branch.update': 'close_if_either',
  'stock.transfer': 'close',
  // Over-close (design §1.3): a group merge's per-product content lives in child
  // snapshots; closing only removes a Redo that would re-fold on today's stock.
  'product.merge.group': 'close',
  'stock.session': 'close_if_source',
  'stock.quantity_set': 'close_if_source',
  'stock.session_line_edit': 'close_if_source',
  'sale.add_items': 'close_if_source',
  'sale.status.bulk': 'close_if_source',
  'return.fields.bulk': 'close_if_source',
  'product.merge': 'close_if_source',
  'product.merge.bulk': 'close_if_source',
  'product.remove': 'close_if_source',
})

export class BranchCutoverHistoryError extends Error {
  readonly code = 'branch_cutover_parent_capability'
  constructor(readonly capability: string) { super(capability) }
}

/** touch: bit 0 = the row's facts name the source branch, bit 1 = the target (bit 1 is only derived for close_if_either). */
export function classifyCutoverHistory(row: { applier: unknown; touch: unknown }): CutoverHistoryDecision {
  const applier = typeof row.applier === 'string' ? row.applier : ''
  const rule = Object.hasOwn(CUTOVER_HISTORY_RULES, applier) ? CUTOVER_HISTORY_RULES[applier] : undefined
  if (!rule) throw new BranchCutoverHistoryError('history_applier_unclassified:' + applier.slice(0, 80))
  const touch = row.touch
  if (typeof touch !== 'number' || !Number.isInteger(touch) || touch < 0 || touch > 3) throw new BranchCutoverHistoryError('history_touch_invalid:' + applier)
  if (rule === 'leave') return 'leave'
  if (rule === 'close') return 'close'
  if (rule === 'close_if_source') return touch & 1 ? 'close' : 'leave'
  return touch & 3 ? 'close' : 'leave'
}

const valid = (column: string): string => `CASE WHEN json_valid(${column}) THEN ${column} END`
const BRANCH_KEYS = `('branch_id','branchId','b','source_branch_id','destination_branch_id','from_branch_id','to_branch_id','sourceBranchId','targetBranchId')`
const snapshotTouches = (snapshotIdSql: string): string => `EXISTS(SELECT 1 FROM undo_snapshots u, json_tree(CASE WHEN json_valid(u.payload_json) THEN u.payload_json ELSE '{}' END) t
      WHERE u.id=${snapshotIdSql} AND t.key IN ${BRANCH_KEYS} AND t.type IN ('integer','text','real') AND CAST(t.atom AS INTEGER)=@source)`
const snapshotId = `CAST(COALESCE(json_extract(${valid('h.undo_payload')},'$.snapshot_id'),json_extract(${valid('h.redo_payload')},'$.snapshot_id')) AS INTEGER)`

// The applier the NEXT transition would run (routes/actionHistory.ts replays the
// undo payload of an undoable row and the redo payload of a redoable one).
export const HISTORY_APPLIER_SQL = `CASE h.status WHEN 'undoable' THEN json_extract(${valid('h.undo_payload')},'$.applier') ELSE json_extract(${valid('h.redo_payload')},'$.applier') END`
const OTHER_APPLIER_SQL = `CASE h.status WHEN 'undoable' THEN json_extract(${valid('h.redo_payload')},'$.applier') ELSE json_extract(${valid('h.undo_payload')},'$.applier') END`

// bit 0 (source) per applier; CASE evaluates only the branch for its applier.
const SOURCE_TOUCH_SQL = `CASE ${HISTORY_APPLIER_SQL}
    WHEN 'branch.update' THEN @source IN (CAST(json_extract(${valid('h.undo_payload')},'$.id') AS INTEGER),CAST(json_extract(${valid('h.redo_payload')},'$.id') AS INTEGER))
    WHEN 'stock.session' THEN EXISTS(SELECT 1 FROM stock_session_operations o JOIN stock_session_members m ON m.operation_id=o.id WHERE o.history_id=h.id AND m.branch_id=@source)
    WHEN 'stock.quantity_set' THEN EXISTS(SELECT 1 FROM stock_lot_adjustment_operations o WHERE o.history_id=h.id AND @source IN (
      CAST(json_extract(${valid('o.request_json')},'$.branchId') AS INTEGER),CAST(json_extract(${valid('o.before_json')},'$.branchId') AS INTEGER),
      CAST(json_extract(${valid('o.after_json')},'$.branchId') AS INTEGER),CAST(json_extract(${valid('o.revision_json')},'$.branchId') AS INTEGER)))
    WHEN 'stock.session_line_edit' THEN EXISTS(SELECT 1 FROM stock_lot_adjustment_operations o WHERE o.history_id=h.id AND @source IN (
      CAST(json_extract(${valid('o.request_json')},'$.branchId') AS INTEGER),CAST(json_extract(${valid('o.before_json')},'$.branchId') AS INTEGER),
      CAST(json_extract(${valid('o.after_json')},'$.branchId') AS INTEGER),CAST(json_extract(${valid('o.revision_json')},'$.branchId') AS INTEGER)))
    WHEN 'sale.add_items' THEN EXISTS(SELECT 1 FROM undo_snapshots u WHERE u.id=${snapshotId} AND json_valid(u.payload_json) AND (
      EXISTS(SELECT 1 FROM sales s WHERE s.id=CAST(json_extract(u.payload_json,'$.saleId') AS INTEGER) AND s.branch_id=@source)
      OR EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id=CAST(json_extract(u.payload_json,'$.saleId') AS INTEGER) AND si.branch_id=@source)
      OR EXISTS(SELECT 1 FROM json_each(u.payload_json,'$.lines') l WHERE json_type(l.value)='object' AND CAST(json_extract(l.value,'$.branchId') AS INTEGER)=@source)))
    WHEN 'sale.status.bulk' THEN EXISTS(SELECT 1 FROM sale_bulk_operations o JOIN sale_bulk_members m ON m.operation_id=o.id WHERE o.history_id=h.id AND (
      EXISTS(SELECT 1 FROM sales s WHERE s.id=m.sale_id AND s.branch_id=@source) OR EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id=m.sale_id AND si.branch_id=@source)))
    WHEN 'return.fields.bulk' THEN EXISTS(SELECT 1 FROM return_bulk_operations o JOIN return_bulk_members m ON m.operation_id=o.id WHERE o.history_id=h.id AND (
      EXISTS(SELECT 1 FROM returns r WHERE r.id=m.return_id AND r.branch_id=@source) OR EXISTS(SELECT 1 FROM return_items ri WHERE ri.return_id=m.return_id AND ri.branch_id=@source)))
    WHEN 'product.merge' THEN ${snapshotTouches(snapshotId)}
    WHEN 'product.merge.bulk' THEN ${snapshotTouches(snapshotId)}
    WHEN 'product.remove' THEN EXISTS(SELECT 1 FROM product_remove_operations o WHERE o.action_history_id=h.id AND (${snapshotTouches('o.undo_snapshot_id')}
      OR EXISTS(SELECT 1 FROM branch_stock bs WHERE bs.product_id=o.product_id AND bs.branch_id=@source)))
    ELSE 0 END`
const TARGET_TOUCH_SQL = `CASE ${HISTORY_APPLIER_SQL}
    WHEN 'branch.update' THEN @target IN (CAST(json_extract(${valid('h.undo_payload')},'$.id') AS INTEGER),CAST(json_extract(${valid('h.redo_payload')},'$.id') AS INTEGER))
    ELSE 0 END`

function decisionSql(): string {
  const groups: Record<CutoverHistoryRule, string[]> = { leave: [], close: [], close_if_source: [], close_if_either: [] }
  for (const [applier, rule] of Object.entries(CUTOVER_HISTORY_RULES)) groups[rule].push(`'${applier}'`)
  return `CASE WHEN applier IN (${groups.leave.join(',')}) THEN 'leave'
    WHEN applier IN (${groups.close.join(',')}) THEN 'close'
    WHEN applier IN (${groups.close_if_source.join(',')}) THEN CASE WHEN touch&1 THEN 'close' ELSE 'leave' END
    WHEN applier IN (${groups.close_if_either.join(',')}) THEN CASE WHEN touch&3 THEN 'close' ELSE 'leave' END
    ELSE 'unclassified' END`
}

/** Open rows with an applier, as they stand now. @source/@target are the cutover's branch ids. */
export const HISTORY_OPEN_PREDICATE = `h.reversible=1 AND h.status IN ('undoable','redoable') AND (${HISTORY_APPLIER_SQL}) IS NOT NULL`
const facts = `SELECT h.rowid AS k,h.id,h.entity,h.entity_id,h.status,h.reversible,h.updated_at,h.last_error,h.undo_payload,h.redo_payload,
      (${HISTORY_APPLIER_SQL}) AS applier,(${OTHER_APPLIER_SQL}) AS other,
      (CASE WHEN (${SOURCE_TOUCH_SQL}) THEN 1 ELSE 0 END)+(CASE WHEN (${TARGET_TOUCH_SQL}) THEN 2 ELSE 0 END) AS touch
    FROM action_history h WHERE ${HISTORY_OPEN_PREDICATE} AND h.rowid>@after`

// ---- facts (E9): the raw branch ids behind the touch bit, written apart from SOURCE_TOUCH_SQL.
// COMPLETE appliers project every id their predicate reads, so JS recomputes the bit exactly. The bulk
// appliers project the header branch of each member sale/return (bounded by the member count); their
// line-level branches are not projected (an unbounded fan-out over sale_items/return_items), so JS only
// proves that a header at the source sets the bit. product.merge/.bulk/.remove walk whole undo snapshots
// in SQL (json_tree); projecting those snapshots would put megabytes on a page, so they carry no facts and
// rest on the SQL predicate plus the rehearsal count comparison on the production copy.
export const HISTORY_COMPLETE_FACT_APPLIERS: readonly string[] = Object.freeze(['branch.update', 'stock.session', 'stock.quantity_set', 'stock.session_line_edit', 'sale.add_items'])
export const HISTORY_HEADER_FACT_APPLIERS: readonly string[] = Object.freeze(['sale.status.bulk', 'return.fields.bulk'])
const asJson = (column: string): string => `(CASE WHEN json_valid(${column}) THEN ${column} END)`
const branchIds = (select: string): string => `(SELECT json_group_array(DISTINCT b) FROM (${select}) WHERE b IS NOT NULL)`
const factSnapshotId = `CAST(COALESCE(json_extract(${asJson('hf.undo_payload')},'$.snapshot_id'),json_extract(${asJson('hf.redo_payload')},'$.snapshot_id')) AS INTEGER)`
const adjustmentFacts = branchIds(['request_json', 'before_json', 'after_json', 'revision_json']
  .map(column => `SELECT CAST(json_extract(${asJson('o.' + column)},'$.branchId') AS INTEGER) AS b FROM stock_lot_adjustment_operations o WHERE o.history_id=hf.id`).join(' UNION ALL '))
const FACTS_SQL = `CASE hf.applier
    WHEN 'branch.update' THEN ${branchIds(`SELECT CAST(json_extract(${asJson('hf.undo_payload')},'$.id') AS INTEGER) AS b UNION ALL SELECT CAST(json_extract(${asJson('hf.redo_payload')},'$.id') AS INTEGER)`)}
    WHEN 'stock.session' THEN ${branchIds('SELECT m.branch_id AS b FROM stock_session_members m JOIN stock_session_operations o ON o.id=m.operation_id WHERE o.history_id=hf.id')}
    WHEN 'stock.quantity_set' THEN ${adjustmentFacts}
    WHEN 'stock.session_line_edit' THEN ${adjustmentFacts}
    WHEN 'sale.add_items' THEN ${branchIds(`SELECT s.branch_id AS b FROM undo_snapshots u JOIN sales s ON s.id=CAST(json_extract(${asJson('u.payload_json')},'$.saleId') AS INTEGER) WHERE u.id=${factSnapshotId}
      UNION ALL SELECT i.branch_id FROM undo_snapshots u JOIN sale_items i ON i.sale_id=CAST(json_extract(${asJson('u.payload_json')},'$.saleId') AS INTEGER) WHERE u.id=${factSnapshotId}
      UNION ALL SELECT CAST(json_extract(l.value,'$.branchId') AS INTEGER) FROM undo_snapshots u, json_each(COALESCE(${asJson('u.payload_json')},'{}'),'$.lines') l
        WHERE u.id=${factSnapshotId} AND l.type='object'`)}
    WHEN 'sale.status.bulk' THEN ${branchIds('SELECT s.branch_id AS b FROM sale_bulk_members m JOIN sale_bulk_operations o ON o.id=m.operation_id JOIN sales s ON s.id=m.sale_id WHERE o.history_id=hf.id')}
    WHEN 'return.fields.bulk' THEN ${branchIds('SELECT r.branch_id AS b FROM return_bulk_members m JOIN return_bulk_operations o ON o.id=m.operation_id JOIN returns r ON r.id=m.return_id WHERE o.history_id=hf.id')}
    END`

/** One page of open applier rows, projected with the facts the decision needs. Extra columns may read the row as hf.* */
export function historyOpenPageSql(extraColumns = ''): string {
  return `SELECT k,json_object('id',id,'entity',entity,'entity_id',entity_id,'status',status,'reversible',reversible,'updated_at',updated_at,
      'last_error',last_error,'applier',applier,'other',other,'touch',touch,'decision',${decisionSql()},'facts',json(${FACTS_SQL}),'undo',undo_payload,'redo',redo_payload) AS j${extraColumns}
    FROM (${facts} ORDER BY h.rowid LIMIT @limit) AS hf ORDER BY k`
}

/** The whole-table predicate finalize re-checks: an open applier row that still classifies as close. */
export const HISTORY_OPEN_CLOSABLE_EXISTS = `EXISTS(SELECT 1 FROM (SELECT applier,touch FROM (${facts.replace(' AND h.rowid>@after', '')})) WHERE (${decisionSql()})<>'leave')`
/** Read-only preview for inspect: open applier rows per (applier, decision); 'unclassified' refuses begin. */
export const HISTORY_DECISION_COUNTS_SQL = `SELECT applier,decision,count(*) AS n FROM (SELECT applier,(${decisionSql()}) AS decision
    FROM (SELECT applier,touch FROM (${facts.replace(' AND h.rowid>@after', '')}))) GROUP BY applier,decision ORDER BY applier,decision`

export type CutoverHistoryRow = {
  id: number; entity: string | null; entity_id: string | null; status: string; reversible: number; updated_at: string | null
  last_error: string | null; applier: string; other: string | null; touch: number; decision: string; facts?: unknown; undo: string; redo: string
}

/** Re-derives the touch bit from the projected facts (E9); refuses a disagreement with the SQL predicate. */
function checkCutoverHistoryFacts(row: CutoverHistoryRow, branches: { source: number; target: number }): void {
  const complete = HISTORY_COMPLETE_FACT_APPLIERS.includes(row.applier), header = HISTORY_HEADER_FACT_APPLIERS.includes(row.applier)
  if (!complete && !header) {
    if (row.facts !== null && row.facts !== undefined) throw new BranchCutoverHistoryError('history_facts_invalid:' + row.id)
    return
  }
  const facts = row.facts
  if (!Array.isArray(facts) || facts.length > 64 || !facts.every(value => Number.isSafeInteger(value))) throw new BranchCutoverHistoryError('history_facts_invalid:' + row.id)
  const source = facts.includes(branches.source) ? 1 : 0
  const target = row.applier === 'branch.update' && facts.includes(branches.target) ? 2 : 0
  if (complete ? (source | target) !== row.touch : source && !(row.touch & 1)) throw new BranchCutoverHistoryError('history_facts_disagree:' + row.id)
}

/** Re-derives the decision (and, from the projected facts, the touch bit) in JS and refuses on any disagreement with the SQL projection. */
export function checkCutoverHistoryRow(raw: string, branches: { source: number; target: number }): { row: CutoverHistoryRow; decision: CutoverHistoryDecision } {
  const row = JSON.parse(raw) as CutoverHistoryRow
  if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.id) || row.id <= 0 || row.reversible !== 1
    || (row.status !== 'undoable' && row.status !== 'redoable') || typeof row.undo !== 'string' || typeof row.redo !== 'string') {
    throw new BranchCutoverHistoryError('history_row_invalid')
  }
  if (row.other !== null && row.other !== row.applier) throw new BranchCutoverHistoryError('history_applier_ambiguous:' + row.id)
  const decision = classifyCutoverHistory(row)
  if (row.decision !== decision) throw new BranchCutoverHistoryError('history_classification_disagrees:' + row.id)
  checkCutoverHistoryFacts(row, branches)
  return { row, decision }
}

export type HistoryTally = { open: number; leave: number; close: number; maxId: number; byApplier: Record<string, [number, number]>; digest: string }
export const emptyHistoryTally = (): HistoryTally => ({ open: 0, leave: 0, close: 0, maxId: 0, byApplier: {}, digest: '' })

export function tallyCutoverHistory(tally: HistoryTally, row: CutoverHistoryRow, decision: CutoverHistoryDecision): HistoryTally {
  const counts = tally.byApplier[row.applier] || [0, 0]
  return { ...tally, open: tally.open + 1, leave: tally.leave + (decision === 'leave' ? 1 : 0), close: tally.close + (decision === 'close' ? 1 : 0),
    maxId: Math.max(tally.maxId, row.id), byApplier: { ...tally.byApplier, [row.applier]: decision === 'leave' ? [counts[0] + 1, counts[1]] : [counts[0], counts[1] + 1] } }
}

/** The closure-stage batch for one page: audit rows, the close itself, and post assertions. */
export function historyClosureStatements(input: {
  closes: Array<{ id: number; marker: string; previousStatus: string; applier: string; updatedAt: string | null }>
  operationId: string; actorId: number; actorName: string | null; source: number; target: number
}): Array<{ sql: string; params: Record<string, unknown> }> {
  if (!input.closes.length) return []
  const ids = JSON.stringify(input.closes.map(close => close.id))
  const rows = JSON.stringify(input.closes.map(close => ({ id: close.id, marker: close.marker, previousStatus: close.previousStatus, applier: close.applier, updatedAt: close.updatedAt })))
  const assert = (condition: string, params: Record<string, unknown>) => ({ sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('[1]','$[branch_cutover_history_conflict]') END`, params })
  return [
    // Every row is still exactly the open row the page read.
    assert(`(SELECT count(*) FROM action_history h JOIN json_each(@rows) r ON CAST(json_extract(r.value,'$.id') AS INTEGER)=h.id
        WHERE h.reversible=1 AND h.status=json_extract(r.value,'$.previousStatus') AND h.updated_at IS json_extract(r.value,'$.updatedAt')
        AND (${HISTORY_APPLIER_SQL})=json_extract(r.value,'$.applier'))=@n`, { rows, n: input.closes.length }),
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id)
        SELECT @actor,@actorName,@action,'action_history',CAST(json_extract(r.value,'$.id') AS TEXT),
          json_object('operationId',@operation,'historyId',json_extract(r.value,'$.id'),'previousStatus',json_extract(r.value,'$.previousStatus'),
            'applier',json_extract(r.value,'$.applier'),'marker',json_extract(r.value,'$.marker'),'sourceBranchId',@source,'targetBranchId',@target),
          'action_history',CAST(json_extract(r.value,'$.id') AS TEXT)
        FROM json_each(@rows) r ORDER BY CAST(json_extract(r.value,'$.id') AS INTEGER)`,
    params: { rows, actor: input.actorId, actorName: input.actorName, action: BRANCH_CUTOVER_CLOSURE_AUDIT_ACTION, operation: input.operationId, source: input.source, target: input.target } },
    { sql: `UPDATE action_history SET status='recorded',reversible=0,
        last_error=(SELECT json_extract(r.value,'$.marker') FROM json_each(@rows) r WHERE CAST(json_extract(r.value,'$.id') AS INTEGER)=action_history.id),
        updated_at=CURRENT_TIMESTAMP
      WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids)) AND reversible=1 AND status IN ('undoable','redoable')`, params: { rows, ids } },
    assert(`NOT EXISTS(SELECT 1 FROM action_history WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids)) AND (reversible<>0 OR status<>'recorded'))
      AND (SELECT count(*) FROM action_history h JOIN json_each(@rows) r ON CAST(json_extract(r.value,'$.id') AS INTEGER)=h.id
        WHERE h.last_error=json_extract(r.value,'$.marker'))=@n`, { ids, rows, n: input.closes.length }),
  ]
}

/** Closure audit rows this operation wrote (indexed by action). */
export const CLOSURE_AUDIT_COUNT_SQL = `SELECT count(*) FROM audit_logs WHERE action='${BRANCH_CUTOVER_CLOSURE_AUDIT_ACTION}' AND json_extract(details,'$.operationId')=@operation`
