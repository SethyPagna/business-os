// Where the two canonical branch roles turn into an answer a route can act
// on. The roles themselves live in branchRoles.ts (twinned with
// frontend/src/utils/branchRoles.ts); this file is the Worker-side half of
// the rule the pickers enforce in the UI.
//
// The two messages are the EXACT English of the pack keys the UI shows
// (`pos_warehouse_not_sellable`, `transfer_canonical_pair_only` in
// frontend/src/lang/en.json), so a rejection that reaches the client maps
// back to the same prompt in both languages instead of surfacing a second,
// server-only wording. That coupling is pinned by
// scripts/test-selling-branch-guard-pure.cjs.
import { branchCanTransferBetween, branchCanSell } from './branchRoles'

export const WAREHOUSE_NOT_SELLABLE_ERROR = 'Only allow Shop sale. Please transfer to Shop first.'
export const TRANSFER_DIRECTION_ERROR = 'Transfers move stock only between Shop and Warehouse.'

export type BranchNameRow = { id: number; name: string | null }

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
    if (!branchCanSell(row?.name)) return row
  }
  return null
}

/**
 * Null only when the source and destination have opposite canonical roles;
 * every same-role, unknown, or historical identity is refused with the same
 * client-facing message.
 */
export function transferDirectionError(fromName: unknown, toName: unknown): string | null {
  return branchCanTransferBetween(fromName, toName) ? null : TRANSFER_DIRECTION_ERROR
}
