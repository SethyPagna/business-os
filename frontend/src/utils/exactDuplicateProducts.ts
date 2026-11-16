import { normalizeProductGroupName, unmergedTwinKeys } from './productGrouping.ts'

// "Exact duplicate" handling for the Products page (user spec item #3).
//
// The single source of truth is the server's possibly-same sweep
// (GET /api/products/possible-duplicates, see cloudflare/src/lib/
// productIdentity.ts::findPossiblySameProductClusters) -- the SAME data the
// Products -> Duplicates review tab already renders. That sweep returns two
// kinds of cluster:
//   - same_barcode: 2+ active products sharing one REAL barcode (>= 4 chars),
//     names may or may not match.
//   - same_name:    2+ active products sharing a display name but with
//     DIFFERENT barcodes.
//
// The user's rule is narrower than either: an EXACT duplicate is one where
// products share BOTH the same real barcode AND the same name. That can only
// come out of a same_barcode cluster (a same_name cluster has, by
// definition, differing barcodes), refined down to the members whose
// normalized name also matches. We normalize the name with the frontend's
// own normalizeProductGroupName so the flag agrees with how the list itself
// groups rows by name.
//
// Dismissing a cluster ("Keep both") drops it from the server sweep, so a
// re-fetch clears the flags for free -- no separate client bookkeeping.

export type DuplicateClusterEntry = {
  id: number
  name: string | null
  barcode: string | null
  cost_price_usd: number | null
  selling_price_usd: number | null
  stock_quantity: number | null
  image_path: string | null
}

export type PossiblySameCluster = {
  type: 'barcode' | 'name' | 'leadingzero' | 'similar'
  value: string
  severity: 'same_barcode' | 'same_name' | 'leading_zero' | 'similar_name'
  products: DuplicateClusterEntry[]
}

export type ExactDuplicateInfo = {
  // Stable identity of this exact-duplicate group: real barcode + name key.
  key: string
  // The real barcode every member shares -- also the cluster value the
  // dismiss ("Keep both") call needs (dismiss is keyed by barcode cluster).
  barcode: string
  // Every product that shares this barcode AND this name (>= 2).
  members: DuplicateClusterEntry[]
}

// Narrow an unknown API payload down to the cluster array. Tolerant of the
// two shapes the endpoint has shipped ({ clusters: [...] } today; a bare
// array historically) so a transport tweak can't silently blank the flags.
export function extractDuplicateClusters(payload: unknown): PossiblySameCluster[] {
  const raw = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === 'object' && Array.isArray((payload as { clusters?: unknown }).clusters)
      ? (payload as { clusters: unknown[] }).clusters
      : [])
  return raw.filter((c): c is PossiblySameCluster => {
    if (!c || typeof c !== 'object') return false
    const type = (c as PossiblySameCluster).type
    return (type === 'barcode' || type === 'name' || type === 'leadingzero' || type === 'similar') && Array.isArray((c as PossiblySameCluster).products)
  })
}

// Build a lookup from every product id involved in an exact duplicate to its
// exact-duplicate group. Only barcode clusters can qualify; within each we
// bucket by normalized name and keep only the buckets with 2+ members.
export function buildExactDuplicateIndex(clusters: PossiblySameCluster[]): Map<number, ExactDuplicateInfo> {
  const index = new Map<number, ExactDuplicateInfo>()
  for (const cluster of clusters) {
    if (cluster.type !== 'barcode') continue
    const barcode = String(cluster.value || '').trim()
    if (!barcode) continue
    const byName = new Map<string, DuplicateClusterEntry[]>()
    for (const product of cluster.products || []) {
      const nameKey = normalizeProductGroupName(product?.name || '')
      if (!nameKey) continue
      if (!byName.has(nameKey)) byName.set(nameKey, [])
      byName.get(nameKey)!.push(product)
    }
    for (const [nameKey, members] of byName) {
      if (members.length < 2) continue
      const info: ExactDuplicateInfo = { key: `${barcode}|${nameKey}`, barcode, members }
      for (const member of members) index.set(Number(member.id), info)
    }
  }
  return index
}

// Every Conflicts cluster that lists ALL of these products, as the dismiss call names it: what "Keep both" must dismiss so the pair is no longer listed anywhere. A pair
// inside a variant family is held by its barcode cluster AND by the name cluster of the whole name (and a leading-zero cluster when a third spelling exists); dismissing
// only the barcode left the name cluster listing it, so the toast "no longer flagged" was false. A 'similar' cluster is not one of them: it is a different-name class
// whose ruling also silences other products, and a twin (one name) is never decided by it (cloudflare productIdentity.ts listTwinDismissals).
export function clustersListingProducts(clusters: readonly PossiblySameCluster[], ids: readonly number[]): Array<{ type: 'barcode' | 'name' | 'leadingzero'; value: string }> {
  const wanted = [...new Set(ids.map(Number))]
  const rulings: Array<{ type: 'barcode' | 'name' | 'leadingzero'; value: string }> = []
  if (wanted.length < 2) return rulings
  for (const cluster of clusters) {
    if (cluster.type !== 'barcode' && cluster.type !== 'name' && cluster.type !== 'leadingzero') continue
    if (!wanted.every((id) => (cluster.products || []).some((product) => Number(product?.id) === id))) continue
    if (!rulings.some((ruling) => ruling.type === cluster.type && ruling.value === cluster.value)) rulings.push({ type: cluster.type, value: cluster.value })
  }
  return rulings
}

// What "Keep both" on a pair rules (round 6 review, B1). The pair's barcode cluster is always dismissed. A name or leading-zero cluster that also lists the pair is dismissed only
// when it holds no twin cluster apart from the pair's own (one that shares no row with it): a ruling is keyed by the cluster, so dismissing it would also silence another pair the
// person never chose, with no review and no undo. When it is left listed, stillListed is true and the pair stays in Conflicts. A twin cluster that overlaps the pair (a blank-barcode
// row of the same name joins it) is the pair's own: its tag is the cluster's, so it goes with the ruling.
export function keepBothPlan(clusters: readonly PossiblySameCluster[], ids: readonly number[], barcode: string): { rulings: Array<{ type: 'barcode' | 'name' | 'leadingzero'; value: string }>; stillListed: boolean } {
  const wanted = new Set(ids.map(Number))
  const rulings: Array<{ type: 'barcode' | 'name' | 'leadingzero'; value: string }> = [{ type: 'barcode', value: barcode }]
  let stillListed = false
  for (const ruling of clustersListingProducts(clusters, ids)) {
    if (ruling.type === 'barcode') { if (ruling.value !== barcode) rulings.push(ruling); continue }
    const rows = clusters.find((c) => c.type === ruling.type && c.value === ruling.value)?.products || []
    const keys = unmergedTwinKeys(rows as never)
    const own = new Set(rows.map((row, i) => (wanted.has(Number(row.id)) ? keys[i] : '')))
    if (keys.some((key) => key && !own.has(key))) stillListed = true
    else rulings.push(ruling)
  }
  return { rulings, stillListed }
}

// Resolve the exact-duplicate group a rendered row belongs to. A list row can
// be a branch-only-merged row standing in for several real product ids
// (__mergedProductIds), so any of those ids landing in an exact-duplicate
// cluster flags the row.
export function findRowDuplicateInfo(
  index: Map<number, ExactDuplicateInfo>,
  rowId: number | string | undefined,
  mergedIds?: Array<number | string> | undefined,
): ExactDuplicateInfo | null {
  if (index.size === 0) return null
  const direct = index.get(Number(rowId))
  if (direct) return direct
  if (mergedIds && mergedIds.length) {
    for (const id of mergedIds) {
      const hit = index.get(Number(id))
      if (hit) return hit
    }
  }
  return null
}
