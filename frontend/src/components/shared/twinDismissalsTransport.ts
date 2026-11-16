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
export async function dismissProductClusterAndRefresh(type: 'leadingzero' | 'barcode' | 'name' | 'similar', value: string): Promise<unknown> {
  const result = await dismissProductDuplicateCluster(type, value)
  await refreshTwinDismissals()
  return result
}
