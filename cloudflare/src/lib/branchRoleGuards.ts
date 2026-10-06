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
export const TRANSFER_DIRECTION_ERROR = 'Transfers move stock only between the two operating branches.'

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
