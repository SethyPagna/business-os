// N13 (round 2) -- the SEARCH haystack for an inventory_movements row.
//
// The Movements drill (routes/inventory.ts GET /movements) renders a row's
// BRANCH through movementBranchNameSql (a sale/return-family row stamps
// branch_id and no branch_name snapshot, so its branch is resolved from the
// id) and its ACTOR through movementActorNameSql (every history surface names
// the account USERNAME, so a row whose snapshot predates that rule renders
// 'james', not 'ung sethy pagna'). The haystack that route searched was still
// built from the RAW columns, which splits one field into two answers: typing
// the 'james' that is on the screen returned nothing, while the superseded
// full name -- which appears nowhere in the UI -- returned the row, and
// searching a branch missed exactly the sale rows the owner was looking for.
//
// That is the same split 8432953b fixed for the stock-in session list, so it
// is fixed the same way and in ONE place: the haystack is derived from the
// very expressions the SELECT renders. A reader searches what it shows.
//
// Shape: one shallow concatenated haystack, matching buildSalesSearchWhere's
// convention (routes/sales.ts) and consumed with buildLikeAliasClause's
// alreadyNormalizedCols=true, so the ~78-level diacritic REPLACE chain is not
// applied per column and the statement stays far below D1's depth-100 limit.
// The two resolutions add correlated single-row lookups on users.id /
// branches.id (both primary keys), not joins -- see the two modules for why
// a sub-select rather than a LEFT JOIN.
//
// The receipt (movementReference.ts's reference_label) is deliberately NOT in
// here: it is not searchable on the Stock Change ledger either -- that surface
// searches product name and barcode only -- and adding it to one of the two
// sibling surfaces alone would be the asymmetry this file exists to remove.
import { movementActorNameSql } from './movementActorName'
import { movementBranchNameSql } from './movementBranchName'

/**
 * The concatenated text a movement-log search matches against, given the table
 * alias the surrounding statement uses for inventory_movements.
 *
 * Product name, branch, actor, movement type and reason -- the movement's own
 * displayed fields, with branch and actor resolved exactly as they are
 * rendered.
 */
export function movementSearchHaystackSql(alias: string): string {
  return `(
      COALESCE(${alias}.product_name, '') || ' ' || COALESCE(${movementBranchNameSql(alias)}, '') || ' ' ||
      COALESCE(${movementActorNameSql(alias)}, '') || ' ' || COALESCE(${alias}.movement_type, '') || ' ' ||
      COALESCE(${alias}.reason, '')
    )`
}
