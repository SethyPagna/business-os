// The Worker's two branch-rule refusals, mapped back onto the pack keys the
// pickers already show.
//
// The rules live in cloudflare/src/lib/branchRoleGuards.ts and are enforced
// on POST /sales, /sales/:id/items, /sales/:id/amendments, /returns,
// /branches/transfer, /branches/transfer-bulk and /inventory/transfer. Each
// of those returns a 400 whose `error` is the EXACT English of a pack key --
// deliberately, so a rejection that outruns the UI (an offline sale replayed
// later, a stale tab, an amendment posted from a modal, an API caller) can be
// shown to the operator in their own language instead of surfacing as an
// English sentence in the middle of a Khmer screen.
//
// This is the client half of that coupling. It matches on the message, not on
// a status code or an error code, because the Worker sends no code and adding
// one would leave every already-deployed Worker unmapped. The English strings
// below are pinned against en.json by frontend/tests/productSheetState.test.ts
// and against the Worker's constants by
// cloudflare/scripts/test-selling-branch-guard-pure.cjs.
export const BRANCH_RULE_MESSAGE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Only allow Shop sale. Please transfer to Shop first.', 'pos_warehouse_not_sellable'],
  ['Transfers move stock from Warehouse to Shop.', 'transfer_source_warehouse_only'],
]

/**
 * The pack key for a Worker branch-rule refusal, or null when this message is
 * not one of them.
 *
 * The comparison tolerates a message the caller has already decorated
 * ("Error: <message>", a trailing period from a notify helper) because the
 * error paths that show these differ in how much they wrap: POS notifies the
 * raw `result.error`, TransferModal runs it through getErrorMessage, and
 * Inventory rethrows it as an Error whose message is the sentence.
 */
export function branchRuleMessageKey(message: unknown): string | null {
  const text = String(message ?? '').trim()
  if (!text) return null
  for (const [english, key] of BRANCH_RULE_MESSAGE_KEYS) {
    if (text === english || text.includes(english)) return key
  }
  return null
}

/**
 * The message to show. A branch-rule refusal comes back translated; anything
 * else is returned untouched, so this can wrap an error path without having
 * to know what else that path can produce.
 */
export function localizeBranchRuleError(message: unknown, t: (key: string) => string | undefined): string {
  const text = String(message ?? '')
  const key = branchRuleMessageKey(text)
  if (!key) return text
  return t(key) || text
}
