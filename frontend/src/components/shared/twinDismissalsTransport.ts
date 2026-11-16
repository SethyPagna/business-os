import { apiFetch } from '../../api/http.ts'
import { dismissProductDuplicateCluster } from '../../api/productWriteTransport.ts'
import { keepBothPlan, type ExactDuplicateInfo, type PossiblySameCluster } from '../../utils/exactDuplicateProducts.ts'
import { parseTwinDismissals, setTwinDismissals, setTwinDismissalsReadable } from '../../utils/productTwinDismissals.ts'

// Reads the "Keep both" rulings behind the Duplicate tag (GET /api/products/duplicate-dismissals) into the shared set utils/productTwinDismissals.ts holds.
// The shell's loader (useTwinDismissalsLoader.ts) calls it when an account signs in and after a products change anywhere; dismissProductClusterAndRefresh calls
// it after every successful dismissal, because a dismissal advances the products version but is not broadcast to this device. The Worker answers from a
// cache keyed on that version, so a repeat read costs no database rows. A failed read leaves the set as it was: the tag then shows for a pair
// Conflicts may no longer list, never the other way round, and Conflicts stays the authority.
// A 403 is different (round 5 review, L3): the Worker refuses the route to a role with no product search access, and for that role the set can never be
// read, so a pair already ruled Keep both would keep its tag for ever. The refusal marks the rulings unreadable (the tag is not shown, UnmergedTwinTag), and the
// route is not asked again for this account (a products change would otherwise ask, and be refused, every time) until forgetTwinDismissalDenial.
//
// Staff only, and deliberately not under src/api/: that directory is one chunk the public storefront loads, and this code is not the storefront's.
let readToken = 0
let denied = false

export async function refreshTwinDismissals(): Promise<void> {
  if (denied) return
  const token = (readToken += 1)
  try {
    const payload = await apiFetch('GET', '/api/products/duplicate-dismissals')
    // A newer read, or a sign-out (supersedeTwinDismissalReads), supersedes this answer.
    if (token === readToken) setTwinDismissals(parseTwinDismissals(payload))
  } catch (error) {
    // Non-fatal, see above, except a refusal.
    // Only the route's own refusal (403 with its code) is final. Any other 403 (an edge layer's block page, code edge_interference; a forced password change) or error is
    // transient: the set stays as it was and the next products sync asks again (round 6 review, L3).
    const refusal = error as { status?: unknown; code?: unknown } | null
    if (token === readToken && Number(refusal?.status) === 403 && refusal?.code === 'twin_dismissals_denied') {
      denied = true
      setTwinDismissalsReadable(false)
    }
  }
}

// A new account (or a sign-out) starts from a read again.
export function forgetTwinDismissalDenial(): void {
  denied = false
  setTwinDismissalsReadable(true)
}

// A sign-out or an account without product lists: ignore any read still in flight.
export function supersedeTwinDismissalReads(): void {
  readToken += 1
}

// A dismissal also changes which unmerged twins keep their Duplicate tag, so the answer is not returned until the rulings have been re-read: every caller (Products'
// Keep both, the Conflicts tab's Dismiss and its bulk Dismiss) then sees the tag go with the cluster.
export type ClusterType = 'leadingzero' | 'barcode' | 'name' | 'similar'
export type ClusterRuling = { type: ClusterType; value: string }

export async function dismissProductClusterAndRefresh(type: ClusterType, value: string): Promise<unknown> {
  const result = await dismissProductDuplicateCluster(type, value)
  await refreshTwinDismissals()
  return result
}

// Several rulings made together (Keep both on a pair that more than one Conflicts cluster lists; the Conflicts tab's bulk Dismiss): each is stored in turn, a failure
// does not stop the rest (the caller reports it), and the rulings are re-read ONCE after the last, not after every one: a re-read follows a products version bump, so
// each is a cache miss that reads the whole dismissals table. Nothing is re-read when no call stored a ruling.
export async function dismissProductClustersAndRefresh(
  rulings: readonly ClusterRuling[],
  hooks: { before?: (index: number) => void; stored?: (ruling: ClusterRuling, index: number) => void } = {},
): Promise<{ stored: ClusterRuling[]; failed: Array<{ ruling: ClusterRuling; error: unknown }> }> {
  const stored: ClusterRuling[] = []
  const failed: Array<{ ruling: ClusterRuling; error: unknown }> = []
  for (const [index, ruling] of rulings.entries()) {
    hooks.before?.(index)
    try {
      await dismissProductDuplicateCluster(ruling.type, ruling.value)
      stored.push(ruling)
      hooks.stored?.(ruling, index)
    } catch (error) {
      failed.push({ ruling, error })
    }
  }
  if (stored.length) await refreshTwinDismissals()
  return { stored, failed }
}

// Products' "Keep both" on an exact-duplicate pair (keepBothPlan says what is ruled). The toast says only what is true: when a name or leading-zero cluster still lists the pair
// beside other rows, the pair stays in Conflicts and is not called "no longer flagged". A refused ruling throws for the caller to report.
export async function keepBothDuplicate(clusters: readonly PossiblySameCluster[], info: ExactDuplicateInfo, notify: (message: string) => void, t: (key: string) => string, refresh: () => Promise<unknown>): Promise<void> {
  const { rulings, stillListed } = keepBothPlan(clusters, info.members.map((member) => Number(member.id)), info.barcode)
  const { failed } = await dismissProductClustersAndRefresh(rulings)
  if (failed.length) throw failed[0].error
  notify(stillListed ? (t('product_duplicate_kept_still_listed') || 'Kept both. Still in a duplicate group with other rows: review it in Conflicts') : (t('product_duplicate_kept_both') || 'Kept both -- no longer flagged as duplicates'))
  await refresh()
}
