import { apiFetch } from '../../api/http.ts'
import { dismissProductDuplicateCluster } from '../../api/productWriteTransport.ts'
import { parseTwinDismissals, setTwinDismissals } from '../../utils/productTwinDismissals.ts'

// Reads the "Keep both" rulings behind the Duplicate tag (GET /api/products/duplicate-dismissals) into the shared set utils/productTwinDismissals.ts holds.
// The shell's loader (useTwinDismissalsLoader.ts) calls it when an account signs in and after a products change anywhere; dismissProductClusterAndRefresh calls
// it after every successful dismissal, because a dismissal advances the products version but is not broadcast to this device. The Worker answers from a
// cache keyed on that version, so a repeat read costs no database rows. A refusal or a failed read leaves the set as it was: the tag then shows for a pair
// Conflicts may no longer list, never the other way round, and Conflicts stays the authority.
//
// Staff only, and deliberately not under src/api/: that directory is one chunk the public storefront loads, and this code is not the storefront's.
let readToken = 0

export async function refreshTwinDismissals(): Promise<void> {
  const token = (readToken += 1)
  try {
    const payload = await apiFetch('GET', '/api/products/duplicate-dismissals')
    // A newer read, or a sign-out (supersedeTwinDismissalReads), supersedes this answer.
    if (token === readToken) setTwinDismissals(parseTwinDismissals(payload))
  } catch {
    // Non-fatal, see above.
  }
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
