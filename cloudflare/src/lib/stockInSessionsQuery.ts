// N13: a stock-in session names its actor from the same movement rows the
// Stock Change ledger reads, so it resolves the account username the same
// way -- one rule, one implementation (lib/movementActorName.ts).
import { movementActorNameSql } from './movementActorName'
// The movement types that mean "goods were received". 'add' is the canonical
// one -- POST /api/inventory/adjust, POST /api/batches and (since this change)
// the unified stock-in session all write it, and it is the only receipt string
// movementGroups.ts's translateMovementType() actually knows by name.
//
// 'stock_in' is here for HISTORY only. lib/stockSession.ts used to write its
// session `mode` ('stock_in') into movement_type, so every session committed
// through the Products page's "Add products" entry landed under a string no
// reader filtered for and vanished from this list. The writer now emits 'add';
// rows already committed under the old string stay readable through here until
// migration 0128 normalises them. It is a legacy alias of 'add', nothing more
// -- do not give it display or sign semantics of its own.
export const STOCK_RECEIPT_MOVEMENT_TYPES = ['add', 'stock_in'] as const

export const STOCK_RECEIPT_TYPE_SQL = `m.movement_type IN (${STOCK_RECEIPT_MOVEMENT_TYPES.map((type) => `'${type}'`).join(', ')})`

// N6 (owner, 23 Sep: "Stock-in sessions editable (today only add or
// delete)"). An edit of a received line (lib/stockInLineEdit.ts) never
// rewrites the line's own receipt movement -- the ledger stays append-only.
// It posts DELTA movements stamped `stock-in-edit:<root movement id>:<operation>:<generation>`,
// and every generation (forward, undo, redo) carries the same root prefix, so
// the line's current state is the root row folded with every row under its
// prefix:
//   quantity   = |root.quantity| + SUM(edit.quantity)          (signed deltas)
//   total cost = root.total + SUM(edit.total_cost_usd)          (signed deltas;
//                NULL while neither the root nor any edit recorded a cost)
//   lot        = the lot of the LAST positive-quantity edit row, else the root's
// The prefix constants live here (not in the writer) because this module is
// the one every receipt reader already imports, and it must stay import-light.
export const STOCK_IN_EDIT_REFERENCE_PREFIX = 'stock-in-edit:'

/** `stock-in-edit:<root>:<operation>:<generation>` -- every row of one generation. */
export function stockInEditReference(rootMovementId: number, operationId: string, generation: number): string {
  return `${STOCK_IN_EDIT_REFERENCE_PREFIX}${rootMovementId}:${operationId}:${generation}`
}

/**
 * Index range covering every edit row of ONE root: ':' (0x3A) and ';' (0x3B)
 * are adjacent, so `[lo, hi)` is exactly the `stock-in-edit:<root>:` prefix,
 * served by idx 0104 (reference_id, movement_type, id).
 */
export function stockInEditRange(rootMovementId: number): { lo: string; hi: string } {
  return { lo: `${STOCK_IN_EDIT_REFERENCE_PREFIX}${rootMovementId}:`, hi: `${STOCK_IN_EDIT_REFERENCE_PREFIX}${rootMovementId};` }
}

export function isStockInEditReference(referenceId: unknown): boolean {
  return String(referenceId ?? '').startsWith(STOCK_IN_EDIT_REFERENCE_PREFIX)
}

// One grouped pass over the edit rows only (a range on the reference index;
// integer session references sort below every text value). substr from 15 =
// just after the 14-character prefix.
const STOCK_IN_EDIT_FOLD_SQL = `(
      SELECT CAST(substr(x.reference_id, 15, instr(substr(x.reference_id, 15), ':') - 1) AS INTEGER) AS root_id,
             SUM(x.quantity) AS net_qty,
             SUM(x.total_cost_usd) AS net_cost,
             COUNT(x.total_cost_usd) AS cost_rows,
             MAX(CASE WHEN x.quantity > 0 THEN x.id END) AS last_in_id,
             COUNT(*) AS edit_rows
      FROM inventory_movements x
      WHERE x.reference_id >= '${STOCK_IN_EDIT_REFERENCE_PREFIX}' AND x.reference_id < 'stock-in-edit;'
      GROUP BY 1
    )`

export const STOCK_IN_SESSION_KEY_SQL = `CASE
  WHEN m.reference_id IS NOT NULL AND CAST(m.reference_id AS TEXT) NOT LIKE 'revert:%'
    THEN 'session:' || CAST(m.reference_id AS TEXT)
  ELSE 'legacy:' || COALESCE(m.created_at, '') || ':' || COALESCE(CAST(m.user_id AS TEXT), '') || ':' ||
       COALESCE(CAST(m.branch_id AS TEXT), '') || ':' ||
       COALESCE(CAST(b.supplier_id AS TEXT), lower(trim(COALESCE(b.supplier_name, ''))))
END`

// Who did it: the account USERNAME, resolved live from the id, because a
// movement's own user_name column is a DISPLAY-NAME snapshot taken at write
// time -- the wrong field, and a stale copy of it after a rename. This file
// used to carry a private SESSION_ACTOR_SQL saying exactly that; the shared
// movementActorNameSql() expression is reused by the Stock Change
// ledger, GET /movements and the inventory bootstrap, so the four surfaces
// cannot answer "who" four ways.

// The product columns a receipt line shows, read once for both line sources.
const PRODUCT_COLUMNS_SQL = `p.barcode, p.sku, p.unit, p.brand, p.category, p.tag_label,
           p.image_path, p.selling_price_usd, p.selling_price_khr, p.purchase_price_usd, p.purchase_price_khr,
           p.cost_price_usd, p.cost_price_khr`

// A stock-in session has TWO kinds of line, and the list must see both.
//
// 1. A received line: an inventory_movements row of a receipt type, joined to
//    the lot it received into. Fast stock-in, POST /batches, POST /adjust and
//    the unified session writer (lib/stockSession.ts) all produce these.
//
// 2. A zero-quantity line: a product the Products page's "Add products"
//    session CREATED without receiving any stock. lib/stockSession.ts records
//    it durably -- a stock_session_operations row for the session and a
//    stock_session_members row per line -- but posts NO movement, because
//    there is no receipt to post. Until N29 (2026-09-06) this list was built
//    from movements alone, so a session whose items were all created at zero
//    had a session record and no row here: "the create products did not show
//    in stock in". These rows are the other half of the same session model,
//    keyed by the same 'session:<reference>' the writer stamps on its
//    movements (reference_id = the operation's rowid), so a session with one
//    received line and one zero line is one group, never two.
//
// A member that DID receive stock (movement_id set) is already present through
// its movement and is excluded here, so nothing is counted twice. The header
// the operator entered once (supplier, received date) lives in the operation's
// canonical request_json, per line_id; it is read from there so the receipt
// shows who the delivery came from even when no lot exists to carry it.
//
// Both sources are normalised to ONE column set so the grouped list and the
// receipt lines read the same shape whichever kind of line they hold. State
// columns (*_state) are what the list counts distinct values of to decide
// "Multiple suppliers" / "Multiple users"; a zero line contributes NULL for a
// state it does not have (no lot => no payment status; no supplier recorded =>
// no supplier state) so it can never make a real receipt read as mixed.
const zeroLineHeaderSql = (field: string) => `(SELECT json_extract(je.value, '$.${field}')
              FROM json_each(o.request_json, '$.items') je
              WHERE json_extract(je.value, '$.line_id') = sm.line_id LIMIT 1)`

// The line's current total (see the fold above). NULL only while neither the
// root nor any edit row recorded a cost -- an unknown cost is never shown as $0.
const LINE_TOTAL_SQL = `CASE WHEN m.total_cost_usd IS NULL AND COALESCE(e.cost_rows, 0) = 0 THEN NULL
             ELSE ROUND(COALESCE(m.total_cost_usd, 0) + COALESCE(e.net_cost, 0), 4) END`

function sessionLineRowsSql(where: { movement: string; zero: string }): string {
  return `
    SELECT ${STOCK_IN_SESSION_KEY_SQL} AS session_key,
           m.id AS id,
           (SELECT sm.line_id FROM stock_session_members sm WHERE sm.movement_id = m.id) AS session_line_id,
           m.product_id, m.product_name, ${PRODUCT_COLUMNS_SQL},
           m.branch_id, m.branch_name, m.movement_type,
           -- N6: a line edited after it was saved reads its CURRENT state (see
           -- STOCK_IN_EDIT_REFERENCE_PREFIX above); an unedited line is unchanged.
           ABS(COALESCE(m.quantity, 0)) + COALESCE(e.net_qty, 0) AS quantity,
           CASE WHEN COALESCE(e.edit_rows, 0) > 0 THEN cb.unit_cost_usd ELSE m.unit_cost_usd END AS unit_cost_usd,
           m.unit_cost_khr,
           ${LINE_TOTAL_SQL} AS total_cost_usd, m.total_cost_khr,
           -- "Missing" means the row recorded NO cost at all (NULL). A cost of
           -- 0.00 is a recorded fact -- a free/sample line -- and counting it
           -- as missing made the receipt claim a cost it does not know
           -- (a7ff72f7). Keep the test on NULL, never on > 0.
           CASE WHEN (${LINE_TOTAL_SQL}) IS NOT NULL THEN 0 ELSE 1 END AS cost_missing,
           m.reason, m.reference_id, m.user_id, ${movementActorNameSql('m')} AS user_name, m.created_at,
           -- The lot and its header fields are the line's CURRENT lot (cb); the
           -- session KEY above stays on the root lot (b), so an edit can never
           -- move a line into a different session.
           cb.id AS batch_id,
           cb.lot_code AS batch_lot_code, cb.received_at AS batch_received_at,
           cb.supplier_id AS batch_supplier_id, cb.supplier_name AS batch_supplier_name,
           cb.payment_status AS batch_payment_status, cb.credit_due_date AS batch_credit_due_date,
           cb.unit_cost_usd AS batch_unit_cost_usd, cb.received_cost_usd AS batch_received_cost_usd,
           cb.expiry_date AS batch_expiry_date, cb.updated_at AS batch_updated_at,
           COALESCE((SELECT revision FROM stock_session_revisions
             WHERE entity_type='batch' AND entity_key=CAST(cb.id AS TEXT)),0) AS batch_revision,
           cb.received_at AS received_at, cb.supplier_id AS supplier_id, cb.supplier_name AS supplier_name,
           cb.payment_status AS payment_status, cb.credit_due_date AS credit_due_date,
           COALESCE(CAST(cb.supplier_id AS TEXT), '') || ':' || lower(trim(COALESCE(cb.supplier_name, ''))) AS supplier_state,
           COALESCE(cb.payment_status, '') AS payment_state,
           COALESCE(e.edit_rows, 0) AS edit_count,
           -- N14: did this line CREATE the product, or receive into one that
           -- already existed? The session commit records it durably per line
           -- (stock_session_members.product_created / command_kind, migration
           -- 0124) and nothing ever read it back. Scalar subqueries, not a
           -- join: a join would risk multiplying the line rows the receipt is
           -- counted from if a movement ever gained a second member row.
           -- NULL means "not recorded" -- a receipt that did not come through
           -- the session endpoint (fast stock-in's inline create, POST
           -- /batches, a legacy row). The surface shows no tag for NULL rather
           -- than guessing "Existing"; 0128 adds the movement_id index this
           -- lookup wants.
           (SELECT sm.product_created FROM stock_session_members sm WHERE sm.movement_id = m.id) AS created_product,
           (SELECT sm.command_kind FROM stock_session_members sm WHERE sm.movement_id = m.id) AS session_command_kind
    FROM inventory_movements m
    JOIN product_batches b ON b.id = m.batch_id
    LEFT JOIN ${STOCK_IN_EDIT_FOLD_SQL} e ON e.root_id = m.id
    LEFT JOIN inventory_movements li ON li.id = e.last_in_id
    JOIN product_batches cb ON cb.id = COALESCE(li.batch_id, m.batch_id)
    LEFT JOIN products p ON p.id = m.product_id
    WHERE ${STOCK_RECEIPT_TYPE_SQL} AND ${where.movement}
      -- An edit's own receipt-typed delta row belongs to its root line, never
      -- to a session of its own.
      AND (m.reference_id IS NULL OR CAST(m.reference_id AS TEXT) NOT LIKE '${STOCK_IN_EDIT_REFERENCE_PREFIX}%')
    UNION ALL
    SELECT 'session:' || CAST(o.rowid AS TEXT) AS session_key,
           NULL AS id, sm.line_id AS session_line_id, sm.product_id, p.name AS product_name, ${PRODUCT_COLUMNS_SQL},
           sm.branch_id, br.name AS branch_name, 'add' AS movement_type, 0 AS quantity,
           sm.unit_cost_usd, NULL AS unit_cost_khr, 0 AS total_cost_usd, NULL AS total_cost_khr,
           0 AS cost_missing,
           NULL AS reason, o.rowid AS reference_id, o.actor_id AS user_id,
           (SELECT u.username FROM users u WHERE u.id = o.actor_id) AS user_name, o.created_at, NULL AS batch_id,
           NULL AS batch_lot_code, NULL AS batch_received_at,
           ${zeroLineHeaderSql('supplier_id')} AS batch_supplier_id, ${zeroLineHeaderSql('supplier_name')} AS batch_supplier_name,
           NULL AS batch_payment_status, NULL AS batch_credit_due_date,
           sm.unit_cost_usd AS batch_unit_cost_usd, NULL AS batch_received_cost_usd,
           ${zeroLineHeaderSql('expiry_date')} AS batch_expiry_date, o.created_at AS batch_updated_at,
           NULL AS batch_revision,
           ${zeroLineHeaderSql('received_date')} AS received_at,
           ${zeroLineHeaderSql('supplier_id')} AS supplier_id, ${zeroLineHeaderSql('supplier_name')} AS supplier_name,
           NULL AS payment_status, NULL AS credit_due_date,
           CASE WHEN ${zeroLineHeaderSql('supplier_id')} IS NULL AND trim(COALESCE(${zeroLineHeaderSql('supplier_name')}, '')) = ''
                THEN NULL
                ELSE COALESCE(CAST(${zeroLineHeaderSql('supplier_id')} AS TEXT), '') || ':' || lower(trim(COALESCE(${zeroLineHeaderSql('supplier_name')}, '')))
           END AS supplier_state,
           NULL AS payment_state,
           0 AS edit_count,
           sm.product_created AS created_product, sm.command_kind AS session_command_kind
    FROM stock_session_members sm
    JOIN stock_session_operations o ON o.id = sm.operation_id
    LEFT JOIN products p ON p.id = sm.product_id
    LEFT JOIN branches br ON br.id = sm.branch_id
    WHERE sm.movement_id IS NULL AND COALESCE(sm.quantity, 0) = 0 AND ${where.zero}`
}

const LEGACY_SESSION_KEY = /^legacy:(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?):([^:]*):([^:]*):(.*)$/

export type StockInSessionLocator =
  | { kind: 'reference'; referenceId: string }
  | { kind: 'legacy'; createdAt: string; userId: string; branchId: string; supplierKey: string }

export function parseStockInSessionKey(value: unknown): StockInSessionLocator | null {
  const key = String(value || '').trim()
  if (key.startsWith('session:')) {
    const referenceId = key.slice('session:'.length).trim()
    return referenceId && !referenceId.startsWith('revert:') ? { kind: 'reference', referenceId } : null
  }
  const match = LEGACY_SESSION_KEY.exec(key)
  if (!match) return null
  return { kind: 'legacy', createdAt: match[1], userId: match[2], branchId: match[3], supplierKey: match[4] }
}

function escapedLike(value: string): string {
  return `%${value.replace(/([\\%_])/g, '\\$1')}%`
}

export function buildStockInSessionListQuery(searchValue = ''): { groupedSql: string; params: Record<string, unknown> } {
  const search = String(searchValue || '').trim().slice(0, 120).toLowerCase()
  const params: Record<string, unknown> = search ? { search: escapedLike(search) } : {}
  const having = search
    ? `HAVING lower(COALESCE(MAX(s.supplier_name), '') || ' ' || COALESCE(MAX(s.branch_name), '') || ' ' ||
             COALESCE(MAX(s.user_name), '') || ' ' || COALESCE(GROUP_CONCAT(s.product_name, ' '), '') || ' ' ||
             COALESCE(GROUP_CONCAT(s.barcode, ' '), '')) LIKE @search ESCAPE '\\'`
    : ''
  // The list reads every non-reverted receipt line plus every zero-quantity
  // session line, then groups by the one session key both carry.
  const rows = sessionLineRowsSql({
    movement: `NOT EXISTS (
      SELECT 1 FROM inventory_movements rx
      WHERE rx.reference_id = 'revert:' || CAST(m.id AS TEXT)
    )`,
    zero: '1 = 1',
  })
  return { groupedSql: `
    SELECT s.session_key,
           MIN(s.created_at) AS created_at, MAX(s.received_at) AS received_at,
           MAX(s.branch_id) AS branch_id, MAX(s.branch_name) AS branch_name,
           MAX(s.user_name) AS user_name, MAX(s.supplier_id) AS supplier_id,
           MAX(s.supplier_name) AS supplier_name,
           COUNT(DISTINCT COALESCE(CAST(s.branch_id AS TEXT), '') || ':' || COALESCE(s.branch_name, '')) AS branch_state_count,
           -- The account id is the actor's identity. A display-name snapshot
           -- only stands in when a row has no id (legacy imports), so a rename
           -- mid-session -- or a zero line that carries the actor id without
           -- the movement's snapshot -- is one user, not "Multiple users".
           COUNT(DISTINCT COALESCE(CAST(s.user_id AS TEXT), 'name:' || COALESCE(s.user_name, ''))) AS user_state_count,
           COUNT(DISTINCT s.supplier_state) AS supplier_state_count,
           COUNT(*) AS line_count, SUM(s.quantity) AS quantity,
           SUM(CASE WHEN s.total_cost_usd IS NOT NULL THEN s.total_cost_usd ELSE 0 END) AS movement_cost_usd,
           SUM(s.cost_missing) AS lines_without_movement_cost,
           COUNT(DISTINCT s.payment_state) AS payment_state_count,
           MAX(s.payment_status) AS payment_status, MAX(s.credit_due_date) AS credit_due_date
    FROM (${rows}) s
    GROUP BY session_key
    ${having}`, params }
}

// Do not filter this query by the computed session expression. That former
// shape forced D1 to evaluate the expression for the entire movement ledger
// every time a receipt was opened. The route parses the opaque key once and
// binds these indexed predicates instead.
export function stockInSessionLinesSql(locator: StockInSessionLocator): string {
  const where = locator.kind === 'reference'
    ? {
        movement: 'm.reference_id = @referenceId',
        // rowid lookup first, then the exact text match so '12abc' cannot
        // resolve to session 12 through CAST.
        zero: 'o.rowid = CAST(@referenceId AS INTEGER) AND CAST(o.rowid AS TEXT) = @referenceId',
      }
    : {
        movement: `m.created_at = @createdAt
       AND COALESCE(CAST(m.user_id AS TEXT), '') = @userId
       AND COALESCE(CAST(m.branch_id AS TEXT), '') = @branchId
       AND COALESCE(CAST(b.supplier_id AS TEXT), lower(trim(COALESCE(b.supplier_name, '')))) = @supplierKey`,
        // A legacy key names movements that predate the session writer; no
        // operation row can belong to it.
        zero: '0 = 1',
      }
  return `
    SELECT s.id, s.session_line_id, s.product_id, s.product_name, s.barcode, s.sku, s.unit, s.brand, s.category, s.tag_label,
           s.image_path, s.selling_price_usd, s.selling_price_khr, s.purchase_price_usd, s.purchase_price_khr,
           s.cost_price_usd, s.cost_price_khr,
           s.branch_id, s.branch_name, s.movement_type, s.quantity,
           s.unit_cost_usd, s.unit_cost_khr, s.total_cost_usd, s.total_cost_khr,
           s.reason, s.reference_id, s.user_name, s.created_at, s.batch_id,
           s.batch_lot_code, s.batch_received_at, s.batch_supplier_id, s.batch_supplier_name,
           s.batch_payment_status, s.batch_credit_due_date, s.batch_unit_cost_usd, s.batch_received_cost_usd,
           s.batch_expiry_date, s.batch_updated_at, s.batch_revision, s.created_product, s.session_command_kind, s.edit_count
    FROM (${sessionLineRowsSql(where)}) s
    ORDER BY s.created_at ASC, s.id ASC, s.session_line_id ASC
    LIMIT 2001`
}

export function stockInSessionLineParams(locator: StockInSessionLocator): Record<string, unknown> {
  return locator.kind === 'reference'
    ? { referenceId: locator.referenceId }
    : { createdAt: locator.createdAt, userId: locator.userId, branchId: locator.branchId, supplierKey: locator.supplierKey }
}
