// Where the two canonical branch roles turn into an answer a route can act
// on. The roles themselves live in branchRoles.ts (twinned with
// frontend/src/utils/branchRoles.ts); this file is the Worker-side half of
// the rule the pickers enforce in the UI.
//
// The two messages are the EXACT English of the pack keys the UI shows
// (`branch_not_sellable`, `transfer_branches_pair_only` in
// frontend/src/lang/en.json), so a rejection that reaches the client maps
// back to the same prompt in both languages instead of surfacing a second,
// server-only wording. That coupling is pinned by
// scripts/test-selling-branch-guard-pure.cjs.
//
// The wording is role-neutral on purpose: after the Warehouse is renamed
// "LC Store" no sentence may name Shop or Warehouse as if they were the
// branches. The stable codes below are what a client should prefer; the
// English stays for callers (and older clients) that only read the message.
// The previous sentences ("Only allow Shop sale. ...", "... between Shop and
// Warehouse.") are still recognised by the frontend for a Worker in flight.
import { branchCanTransferBetween, branchCanSell } from './branchRoles'

export const BRANCH_NOT_SELLABLE_CODE = 'branch_not_sellable'
export const BRANCH_NOT_SELLABLE_ERROR = 'Sales can only be recorded at a selling branch.'
// Legacy export name, kept so every existing call site (sales, returns,
// imports, stock actions) sends the neutral sentence without being edited.
export const WAREHOUSE_NOT_SELLABLE_ERROR = BRANCH_NOT_SELLABLE_ERROR
// The code the three transfer routes already send with this message.
export const TRANSFER_DIRECTION_CODE = 'transfer_direction_invalid'
// True while Shop and Warehouse are both active and after the cutover leaves one active branch (where no transfer
// exists to refuse): it names the two ROLES a transfer needs, never the branch names.
export const TRANSFER_DIRECTION_ERROR = 'Transfers move stock only between a selling branch and a storage branch.'
// The sale writers (POST /sales, add items, amendments, cancel with a fee) refuse a header or line branch that is not an
// active selling branch with BRANCH_NOT_SELLABLE_ERROR + code, and a header/line branch disagreement with this pair.
// Each sentence is the English of the pack key named after its code.
export const SALE_BRANCH_MISMATCH_CODE = 'sale_branch_mismatch'
export const SALE_BRANCH_MISMATCH_ERROR = 'The sale and all of its lines must use the same branch.'
// Two more POST /sales refusals that named "the Shop". Same rule: the English is the pack key named after the code.
export const SALE_IDENTITY_CONFLICT_CODE = 'sale_identity_conflict'
export const SALE_IDENTITY_CONFLICT_ERROR = 'The branch or received date changed while this sale was being recorded. Refresh the sale and pick the current received date before trying again.'
export const UNRECORDED_STOCK_LINE_CODE = 'unrecorded_stock_line_invalid'
export const UNRECORDED_STOCK_LINE_ERROR = 'Stock without a received date must be a regular sale line with a branch.'
// The expense writers' counterparts (POST /fees, PATCH /fees/:id) live in routes/fees.ts, which tests load with its imports
// wired by name.

export type BranchNameRow = { id: number; name: string | null; role?: unknown }

/**
 * The first branch on this write that may not carry a sale line, or null
 * when every one of them may.
 *
 * Takes the rows the route already read rather than doing its own query:
 * a guard that issues an extra round-trip per line is a guard that gets
 * dropped from the hot path.
 */
export function firstUnsellableBranch(rows: readonly BranchNameRow[]): BranchNameRow | null {
  for (const row of rows) {
    if (!branchCanSell(row)) return row
  }
  return null
}

/**
 * Null only when the source and destination have opposite canonical roles;
 * every same-role, unknown, or historical identity is refused with the same
 * client-facing message.
 *
 * Pass the branch ROWS ({ name, role }), not their names: a row answers from
 * its explicit role, so a renamed branch keeps its identity, and only a row
 * whose role is NULL falls back to the name. A bare name still works for
 * callers that only hold one.
 */
export function transferDirectionError(from: unknown, to: unknown): string | null {
  return branchCanTransferBetween(from, to) ? null : TRANSFER_DIRECTION_ERROR
}

export function sellingBranchConditionSql(alias = 'b'): string {
  const whitespace = 'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)'
  return `COALESCE(${alias}.is_active,1)=1 AND typeof(COALESCE(${alias}.role,${alias}.name))='text' AND lower(trim(COALESCE(${alias}.role,${alias}.name),${whitespace}))='shop'`
}

export function sellingBranchGuardStatement(branchId: number): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `INSERT INTO sale_bulk_guards(guard_value) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM branches b WHERE b.id=@sellingBranchId AND ${sellingBranchConditionSql()}
    ) THEN 1 ELSE 0 END`,
    params: { sellingBranchId: branchId },
  }
}
