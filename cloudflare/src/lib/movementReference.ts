// N13 -- naming the RECORD a movement row belongs to.
//
// A sale/return-family movement stores reference_id (the sales.id or the
// returns.id it came from) and a free-text reason. The ledger only ever
// selected those two, so a sale row's Reason cell read "Old-system sale
// 004419@2026-09-01" on imported rows and nothing at all on rows the POS
// wrote -- the owner's "still did not show details for sales". The receipt
// number the person actually recognises was one join away and never fetched.
//
// Read-side resolution, same reasoning as movementBranchName.ts: the id is
// the durable fact, so reading through it names every historical row at once
// with no backfill. The legacy "004419@2026-09-01" text in the reason column
// is NOT a receipt number (receipt ids are bare YYYYMMDD-HHMMSS); it stays in
// the reason line, and the label here always comes from the sales/returns row.
//
// WHICH TABLE a reference_id points at is decided by movement_type, and the
// mapping is not one-to-one -- that is the trap this module exists to get
// right:
//
//   sale-only        'sale'                     -> sales.id
//                    (POS, sale amendments, grouped-status apply/undo, and
//                     the legacy importer, which sets reference_id to the
//                     imported sales row)
//   return-only      'supplier_return', 'supplier_return_reversal',
//                    'return_reversal', 'replacement_out',
//                    'damage_reversal'          -> returns.id
//   AMBIGUOUS        'return', 'damage_in', 'damage_out'
//
// The ambiguous three are written by BOTH families with ids from different
// tables: routes/returns.ts writes 'return'/'damage_in' with a returns.id
// while saleTransitions.ts (cancel), saleLineAddition.ts (line removal),
// saleBulkStatus.ts and routes/sales.ts write 'return'/'damage_in'/
// 'damage_out' with a sales.id. Two autoincrement sequences collide freely,
// so "look it up in returns first" would confidently print a stranger's
// return number on a cancelled sale's restock row.
//
// So those rows are disambiguated by MEMBERSHIP, not by existence: the record
// is only claimed when it actually contains the product this movement moved
// (return_items / sale_items, both covered by an existing index on the
// join column). A row that matches neither is left unlabelled -- no label is
// the honest answer, a guessed one is not.
//
// Everything outside these types (add, remove, transfer, stock-in sessions,
// 'revert:<id>' tokens) never has a receipt and is not looked up at all: the
// whole expression is gated on movement_type so the common ledger row costs
// no sub-selects.

/** movement_type values whose reference_id is always a sales.id. */
export const MOVEMENT_SALE_REFERENCE_TYPES = ['sale'] as const

/** movement_type values whose reference_id is always a returns.id. */
export const MOVEMENT_RETURN_REFERENCE_TYPES = [
  'supplier_return', 'supplier_return_reversal', 'return_reversal',
  'replacement_out', 'damage_reversal',
] as const

/** Written by both families; resolved by product membership, never by existence. */
export const MOVEMENT_AMBIGUOUS_REFERENCE_TYPES = ['return', 'damage_in', 'damage_out'] as const

// There is deliberately NO exported union of the three lists above. The CASE
// below gates on them one branch at a time and falls through to NULL, so a
// union adds no behaviour -- it would only be a second copy of "which types
// carry a receipt", free to drift from the lists the SQL actually uses, with
// nothing to tell a reader which copy is authoritative.
// test-movement-reference-pure.cjs fails on any export of this module that has
// no consumer.

function list(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

/**
 * 'sale' | 'return' | NULL -- which record the row's reference_id names.
 * NULL for every movement type that has no receipt, and for an ambiguous row
 * whose reference_id matches no record holding this product.
 */
export function movementReferenceKindSql(alias: string): string {
  return `CASE
    WHEN ${alias}.reference_id IS NULL THEN NULL
    WHEN ${alias}.movement_type IN (${list(MOVEMENT_SALE_REFERENCE_TYPES)}) THEN 'sale'
    WHEN ${alias}.movement_type IN (${list(MOVEMENT_RETURN_REFERENCE_TYPES)}) THEN 'return'
    WHEN ${alias}.movement_type IN (${list(MOVEMENT_AMBIGUOUS_REFERENCE_TYPES)}) THEN
      CASE
        WHEN EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_id = ${alias}.reference_id AND ri.product_id = ${alias}.product_id) THEN 'return'
        WHEN EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = ${alias}.reference_id AND si.product_id = ${alias}.product_id) THEN 'sale'
        ELSE NULL
      END
    ELSE NULL
  END`
}

/**
 * The receipt as the app names it -- sales.receipt_number for a sale,
 * returns.return_number for a return -- or NULL when the row names no record.
 * Never the legacy "<receipt>@<date>" text from the reason column.
 */
export function movementReferenceLabelSql(alias: string): string {
  return `CASE ${movementReferenceKindSql(alias)}
    WHEN 'sale' THEN (SELECT NULLIF(TRIM(COALESCE(receipt_number, '')), '') FROM sales WHERE id = ${alias}.reference_id)
    WHEN 'return' THEN (SELECT NULLIF(TRIM(COALESCE(return_number, '')), '') FROM returns WHERE id = ${alias}.reference_id)
    ELSE NULL
  END`
}

/** Column aliases every reader emits, so one client field means one thing. */
export const REFERENCE_KIND_COLUMN = 'reference_kind'
export const REFERENCE_LABEL_COLUMN = 'reference_label'

/** `<kind> AS reference_kind, <label> AS reference_label` for a SELECT list. */
export function movementReferenceSelectSql(alias: string): string {
  return `${movementReferenceKindSql(alias)} AS ${REFERENCE_KIND_COLUMN},
      ${movementReferenceLabelSql(alias)} AS ${REFERENCE_LABEL_COLUMN}`
}
