import type { D1Compat } from './db'
import { buildInClause, selectInChunks } from './sqlBinding'
import {
  productDetailSignature, normalizeProductGroupName, normalizeProductFuzzyName,
  normalizeLeadingZeroBarcodeForCleanup, identityBarcodeKey,
  productRowIdentityKey, resolveProductIdentityEdit,
} from './productDetailRule'

// Re-exported so the many callers that reach identity through THIS module keep
// one import, while the definition lives in the rule module both packages carry
// verbatim (frontend/tests/productDetailRuleParity.test.ts byte-compares them, so
// the fold can no longer drift between the Worker and the client the way the old
// hand-copied pair could).
export { normalizeLeadingZeroBarcodeForCleanup, identityBarcodeKey, productRowIdentityKey, resolveProductIdentityEdit }

/**
 * identityBarcodeKey as a SQLite expression, for the ONE place that cannot
 * fold in JS: the stock-session commit assertions, which are SQL predicates
 * evaluated inside the batch being committed and so have no JS to run.
 *
 * Every other comparison site narrows in SQL and folds in JS on purpose (see
 * pickSameIdentityRows below) precisely to avoid a second copy of the rule.
 * This is the exception, so it is written ONCE, here, beside the rule it
 * mirrors, and cloudflare/scripts/test-stock-session-identity-guard-pure.cjs
 * runs this expression and the real identityBarcodeKey over the same fixture
 * set in a real SQLite and asserts they agree -- empty, '0', '000', '0012',
 * '0123', mixed alphanumerics and mixed case included. If the JS fold moves
 * and this does not, that test goes red.
 *
 *   trim + lowercase; then, for an all-digit code whose stripped form is still
 *   at least 3 characters long, drop the leading zeros. Anything else is itself.
 */
export function identityBarcodeKeySql(column: string): string {
  const value = `LOWER(TRIM(COALESCE(${column},'')))`
  return `CASE WHEN ${value} <> '' AND ${value} NOT GLOB '*[^0-9]*' AND LENGTH(LTRIM(${value},'0')) >= 3`
    + ` THEN LTRIM(${value},'0') ELSE ${value} END`
}

// Applies THE product identity rule (lib/productDetailRule.ts) at branch-
// transfer, add-stock and merge-duplicates time, so those paths reach the
// same verdict CSV import does.
//
// This file used to spell the rule out itself, and got it wrong in a way
// nothing caught: it compared `purchase_price_usd/khr`, but import and the
// manual Add/Edit form only ever write `cost_price_usd/khr`. Those columns
// default to 0 (migrations/0001_init.sql), so for every import-created or
// form-created product the cost half of the comparison was `0 === 0` -- a
// silent no-op. Two products with genuinely different costs were reported
// as mergeable duplicates. Delegating to the shared rule fixes that and
// means the definition can only ever be changed in one place.

function nameKeyOf(value: unknown): string {
  return normalizeProductGroupName(value)
}

export type ProductIdentityRow = {
  id: number
  name: string | null
  barcode: string | null
  // The columns import and the manual form actually write. `purchase_price_*`
  // is a legacy pair that stays at its 0 default on every real row, which is
  // why comparing it here was a no-op -- see the note at the top of this file.
  cost_price_usd: number | null
  cost_price_khr: number | null
  selling_price_usd: number | null
  selling_price_khr: number | null
  // Live aggregate from branch_stock. Used only to choose the survivor during
  // catalog cleanup; stock is never part of product identity.
  live_stock_quantity?: number
  // Not part of the identity comparison -- carried so merge-duplicates can
  // move a duplicate's primary image onto the canonical row instead of
  // orphaning it on a row it is about to deactivate.
  image_path?: string | null
}

// The leading-zero fold itself now lives in lib/productDetailRule.ts (see the
// re-export at the top of this file): it is a COMPARISON rule, and every
// comparison site -- display grouping, the Conflicts sweep, the create/edit
// guard, transfer/add-stock matching, CSV import and the auto-merge detector
// below -- has to reach the same one. It used to live here, which is exactly
// why the client needed a hand-copy and the display path never got one.

// The edit-identity kernel -- productRowIdentityKey and
// resolveProductIdentityEdit -- used to be spelled out HERE, in a Worker-only
// module the client cannot import, which is why the Products form had a
// create-mode identity pre-check and no edit-mode one at all. It now lives in
// lib/productDetailRule.ts, the module both packages carry verbatim
// (frontend/tests/productDetailRuleParity.test.ts byte-compares them), and is
// re-exported here so every existing Worker caller keeps one import.

// Picks, out of the ACTIVE same-name rows the manual create/edit guard reads,
// the one that is the SAME PRODUCT as the row being written -- i.e. the one
// whose barcode folds to the same identity key.
//
// It lives here rather than inline in the route for two reasons. Cost used to
// be part of the guard's SQL, which contradicted the Sep-4 ruling ("so now
// only diffeerent barcode creates new child row... rest merge") and let the
// manual form MINT exactly the duplicates the merge tool then had to clean up.
// And the leading-zero fold cannot be written in SQL without hand-copying it
// into a third language -- the drift trap this whole module exists to close --
// so the SQL narrows to the name group and the fold is applied here, over the
// same identityBarcodeKey every other comparison site uses.
//
// Returns EVERY such row, not the first (it returned the first until N34). A
// name group can legitimately hold more than one row with the same folded
// barcode -- that residue is exactly what the Conflicts sweep reports -- and a
// link-over prompt naming only one of them lets the operator settle a collision
// and meet the same refusal on the very next save. Callers that only need to
// know whether there is one read `.length`.
export function pickSameIdentityRows<T extends { barcode?: string | null }>(
  rows: T[],
  barcode: unknown,
): T[] {
  const key = identityBarcodeKey(barcode)
  return rows.filter((row) => identityBarcodeKey(row.barcode) === key)
}

// Finds another ACTIVE product row that is genuinely the same item as
// `source` (excluding source itself): same name_key, cost, and barcode.
// Selling/special prices are mergeable fields and never identity. Returns
// null when nothing else in the catalog matches --
// the ordinary, unambiguous case, where a transfer is simply the same
// product_id gaining a branch_stock row at the destination branch, no
// different from before this existed. Deterministic when more than one
// candidate matches (picks the lowest id) so repeated transfers of the
// same duplicate-riddled catalog always converge on the same target
// instead of bouncing between equally-valid candidates.
export async function findIdentityMatch(
  db: D1Compat,
  source: ProductIdentityRow,
): Promise<ProductIdentityRow | null> {
  const nameKey = nameKeyOf(source.name)
  if (!nameKey) return null
  const candidates = await db
    .prepare(`
      SELECT id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr
      FROM products
      WHERE id != @id AND name_key = @nameKey AND is_active = 1
      ORDER BY id ASC
    `)
    .all<ProductIdentityRow>({ id: source.id, nameKey })
  for (const candidate of candidates) {
    if (productDetailSignature(candidate) === productDetailSignature(source)) return candidate
  }
  return null
}

// Batched counterpart for the bulk transfer route -- one query for every
// source product instead of N. Returns a Map keyed by source product id;
// a source with no match is simply absent from the map (callers should
// treat a missing entry the same as findIdentityMatch returning null).
export async function findIdentityMatches(
  db: D1Compat,
  sources: ProductIdentityRow[],
): Promise<Map<number, ProductIdentityRow>> {
  const result = new Map<number, ProductIdentityRow>()
  const nameKeys = [...new Set(sources.map((s) => nameKeyOf(s.name)).filter(Boolean))]
  if (!nameKeys.length) return result
  // `sources` is a whole transfer/import batch, so this list is unbounded
  // against D1's 100-bound-parameter limit. ORDER BY id survives chunking
  // because callers group by name_key and only compare within a group,
  // and a name_key's rows never split across chunks.
  const candidates = await selectInChunks(nameKeys, 0, (chunk) => {
    const { sql, params } = buildInClause('nk', chunk)
    return db
      .prepare(`
        SELECT id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr, name_key
        FROM products
        WHERE name_key IN (${sql}) AND is_active = 1
        ORDER BY id ASC
      `)
      .all<ProductIdentityRow & { name_key: string }>(params)
  })
  const candidatesByNameKey = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  for (const candidate of candidates) {
    if (!candidatesByNameKey.has(candidate.name_key)) candidatesByNameKey.set(candidate.name_key, [])
    candidatesByNameKey.get(candidate.name_key)!.push(candidate)
  }
  for (const source of sources) {
    const nameKey = nameKeyOf(source.name)
    if (!nameKey) continue
    const pool = candidatesByNameKey.get(nameKey) || []
    for (const candidate of pool) {
      if (candidate.id === source.id) continue
      if (productDetailSignature(candidate) === productDetailSignature(source)) { result.set(source.id, candidate); break }
    }
  }
  return result
}

// Standalone counterpart to findIdentityMatches for /api/products/merge-
// duplicates: instead of resolving one source product against the rest of
// the catalog (transfer-time), this scans every ACTIVE product up front and
// buckets them into identity-duplicate groups (same name_key + cost +
// barcode), independent of any transfer happening. Selling/special prices
// are mergeable and the highest value is carried by the fold. This is
// the case a plain CSV/branch-column import has always been able to leave
// behind -- two rows for what's really one product, differing only in
// which branch ended up with the branch_stock row -- and which nothing
// upstream cleans up on its own since import only de-dupes within a single
// import batch, not against the whole existing catalog.
export type ProductDuplicateGroup = {
  canonical: ProductIdentityRow
  duplicates: ProductIdentityRow[]
}

// ---------------------------------------------------------------------------
// "Possibly the same" sweep for the Products → Duplicates review section.
// Where findDuplicateProductGroups (below) finds rows PROVABLY identical
// under THE identity rule (name_key + cost + barcode) and is safe
// to auto-merge, this finds the residue only a human can settle -- the
// classes the Aug 30 production audit surfaced:
//  - same_barcode: two+ active products sharing one real barcode but
//    differing in name/price (an EDP/EDT pair, two shades, or the same
//    item entered twice under two naming conventions).
//  - same_name: two+ active products sharing a display name (name_key)
//    with DIFFERENT barcodes -- usually genuinely distinct SKUs (shades /
//    scents), listed for a glance, never auto-merged.
//  - similar_name: two+ active products whose names collapse to the SAME
//    FUZZY key (normalizeProductFuzzyName: diacritics/punctuation/word-order
//    ignored) but to DIFFERENT exact name_keys -- the "same item, re-typed
//    under a slightly different name, each with its own barcode" case the user
//    reported. This is the weakest evidence of the three (a fuzzy name match,
//    not an exact name or a shared barcode), so it sorts last and, like the
//    others, is only ever surfaced for a human to merge or dismiss.
// Nothing here merges anything; the routes let the reviewer merge one
// pair at a time or dismiss a cluster (product_duplicate_dismissals,
// migration 0083 -- same persistence model as the contacts panel).

export type PossiblySameSeverity = 'leading_zero' | 'same_barcode' | 'same_name' | 'similar_name'

export type PossiblySameProductEntry = {
  id: number
  name: string | null
  barcode: string | null
  cost_price_usd: number | null
  cost_price_khr: number | null
  selling_price_usd: number | null
  stock_quantity: number | null
  image_path: string | null
}

export type PossiblySameProductCluster = {
  type: 'leadingzero' | 'barcode' | 'name' | 'similar'
  value: string
  severity: PossiblySameSeverity
  products: PossiblySameProductEntry[]
}

// The old system stamped '0' (and the empty string) on products without a
// real barcode -- 238 such products share barcode "0" in production. Any
// barcode that short cannot identify a product, so it never forms a
// cluster.
const MIN_REAL_BARCODE_LENGTH = 4

// The in-memory dismissal-lookup key: `<type><DELIM><value>`. The delimiter is
// U+0001 (an ASCII control char that can never appear in a barcode or a
// normalized name), and it is REQUIRED -- without it type 'name' + value 'x'
// would collide with type 'na' + value 'mex'. Every key -- the ones built from
// the dismissals table AND the ones each cluster loop tests -- goes through
// this one helper, so a new cluster type can never silently forget the
// delimiter (which would read as "dismissal silently does nothing"). Written as
// String.fromCharCode(1) rather than a literal control char so the source stays
// legible and greppable.
const DISMISS_DELIM = String.fromCharCode(1)
const dismissKey = (type: string, value: string): string => `${type}${DISMISS_DELIM}${value}`

// Dismissals are stored NORMALIZED (trimmed barcode / name_key / fuzzy key) so
// the same cluster matches its dismissal regardless of the display casing the
// panel happened to show at dismiss time -- the same rule the contacts
// panel applies (contactDuplicates.ts's normalized dismissal compare). Each
// cluster type normalizes with the SAME function the sweep keys that type by,
// so a value the panel echoes back (a display name, say) folds to the exact
// stored key: 'barcode' -> trimmed barcode, 'name' -> name_key, 'similar' ->
// fuzzy key.
export function normalizeProductClusterKey(type: 'leadingzero' | 'barcode' | 'name' | 'similar', value: unknown): string {
  // A leading-zero cluster is keyed by the FOLDED barcode, so a dismissal
  // recorded from either twin's spelling records -- and later matches -- the
  // same key: dismissing '0601' must suppress the cluster the sweep reports
  // under '601'. Keying it raw is what made the same defect as the detector's.
  if (type === 'leadingzero') return identityBarcodeKey(value)
  if (type === 'barcode') return String(value ?? '').trim()
  if (type === 'similar') return normalizeProductFuzzyName(value)
  return normalizeProductGroupName(value)
}

// ---------------------------------------------------------------------------
// KEEP SEPARATE (N34). When an edit would move a row onto another product's
// identity, the operator gets two answers, not one: link the records over
// (merge), or keep the two rows separate. "Keep separate" is the answer the
// guard could not previously express at all -- the save was simply refused --
// so a genuinely different article that happens to share a name and a folded
// barcode with another row could never be saved at all.
//
// Keeping them separate is only honest if the pair then SHOWS UP in Conflicts,
// where the owner asked for it to stay changeable either way. The sweep finds
// it on its own -- a pair sharing a name_key and a folded barcode always forms
// a cluster -- UNLESS somebody dismissed that cluster earlier, in which case
// the old dismissal silently hides the pair the operator just chose to create
// and the decision becomes unreviewable. So a keep-separate decision retires
// the dismissals that would hide it.
//
// These are the cluster keys the resulting pair can land in, normalized
// through normalizeProductClusterKey -- the same function the sweep keys by,
// so a new cluster type cannot drift from this list. The two length floors are
// the sweep's own and are deliberately different: the leading-zero class uses
// the fold's 3-digit bound, the raw-barcode class MIN_REAL_BARCODE_LENGTH.
export type ProductClusterType = 'leadingzero' | 'barcode' | 'name' | 'similar'

export function identityKeepSeparateClusterKeys(
  name: unknown,
  barcodes: readonly unknown[],
): Array<{ type: ProductClusterType; value: string }> {
  const keys: Array<{ type: ProductClusterType; value: string }> = []
  const push = (type: ProductClusterType, raw: unknown, floor: number) => {
    const value = normalizeProductClusterKey(type, raw)
    if (value.length < floor) return
    if (keys.some((key) => key.type === type && key.value === value)) return
    keys.push({ type, value })
  }
  push('name', name, 1)
  push('similar', name, 1)
  for (const barcode of barcodes) {
    push('leadingzero', barcode, 3)
    push('barcode', barcode, MIN_REAL_BARCODE_LENGTH)
  }
  return keys
}

// ---------------------------------------------------------------------------
// "WHAT WAS FOLDED INTO THIS ROW?" (N34). The other half of the owner's
// "keep it changeable in conflict": a pair kept separate stays visible in
// Conflicts and can still be merged, and a merge that HAS happened must stay
// inspectable, or the surface only ever shows work that is still outstanding
// and a fold becomes a thing that happened to the catalog with nothing to point
// at afterwards.
//
// WHERE THE HISTORY LIVES, and why not the audit log. A merge writes three
// records: a 'merge_duplicate' audit_logs row, an action_history row, and an
// undo_snapshots row carrying the exact reversal. Only the last is durable --
// audit_logs is purged on a retention window (21 days by default, and settable
// lower from Settings), so an audit-backed history would show a fold for three
// weeks and then quietly stop showing it, which is worse than not offering it
// at all. undo_snapshots has no retention pass anywhere in the Worker: it is
// the record that has to survive as long as the undo it describes.
//
// So this reads undo_snapshots, in both shapes the merge paths write:
//   * 'product.merge'      -- one fold, payload IS the reversal.
//   * 'product.merge.bulk' -- one run of many folds, payload.reversals is the
//                             array, in application order.
// Reading only the first would silently omit every fold done through the
// whole-catalog cleanup, which is the path that folds the MOST rows.
//
// `status` is carried through rather than filtered on: a snapshot flips to
// 'reversed' when the merge is undone, and a fold that was undone is a true and
// useful thing to see next to one that stands. The caller decides how to show
// it; hiding it here would make an undone merge indistinguishable from one that
// never happened.
export type ProductIdentityFold = {
  /** The row that was folded away. */
  fromId: number
  fromName: string | null
  /** The row that survived, i.e. the one this history is being read for. */
  intoId: number
  intoName: string | null
  at: string | null
  by: string | null
  source: 'merge' | 'bulk_merge'
  /** True when the merge was undone; the pair is two rows again. */
  reversed: boolean
  /**
   * The undo_snapshots row this fold was read out of. It is the ONE total order
   * over folds from both shapes: `at` is a text timestamp that two folds
   * recorded in the same second share, and the two queries are separate, so
   * without this the list can only be ordered within each shape. Carried out to
   * the caller as well so a surface that re-sorts (or pages) cannot invent a
   * different order from the one documented on mergedFrom.
   */
  snapshotId: number
}

export type ProductIdentityHistory = {
  productId: number
  /** Rows folded INTO this one. Newest first. */
  mergedFrom: ProductIdentityFold[]
  /** The fold that retired THIS row, if it was itself merged away. */
  mergedInto: ProductIdentityFold | null
  /**
   * The 'keep them separate' decisions recorded against this row. Read from
   * audit_logs, so this list is RETENTION-BOUND and can be empty for a decision
   * that really was taken -- unlike mergedFrom/mergedInto above. Reported
   * separately for exactly that reason: the two lists do not have the same
   * lifetime, and presenting them as one would let an aged-out decision read as
   * a decision never made.
   */
  keptSeparate: Array<{ at: string | null; by: string | null; keptSeparateFrom: number[]; path: string | null }>
}

type SnapshotRow = { id: number; status: string | null; payload_json: string | null; created_at: string | null; created_by_name: string | null }

function parseReversal(raw: unknown): { keeperId: number; keeperName: string | null; dupId: number; dupName: string | null } | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const keeperId = Number(row.keeperId)
  const dupId = Number(row.dupId)
  if (!Number.isInteger(keeperId) || keeperId <= 0) return null
  if (!Number.isInteger(dupId) || dupId <= 0) return null
  return {
    keeperId,
    keeperName: row.keeperName == null ? null : String(row.keeperName),
    dupId,
    dupName: row.dupName == null ? null : String(row.dupName),
  }
}

/** Every fold recorded in one snapshot row, whichever of the two shapes it is. */
function foldsInSnapshot(row: SnapshotRow, source: 'merge' | 'bulk_merge'): ProductIdentityFold[] {
  let payload: unknown = null
  try { payload = row.payload_json ? JSON.parse(row.payload_json) : null } catch { return [] }
  const list = source === 'bulk_merge'
    ? (Array.isArray((payload as { reversals?: unknown })?.reversals) ? (payload as { reversals: unknown[] }).reversals : [])
    : [payload]
  const folds: ProductIdentityFold[] = []
  for (const entry of list) {
    const reversal = parseReversal(entry)
    if (!reversal) continue
    folds.push({
      fromId: reversal.dupId,
      fromName: reversal.dupName,
      intoId: reversal.keeperId,
      intoName: reversal.keeperName,
      at: row.created_at,
      by: row.created_by_name,
      source,
      reversed: String(row.status || '') === 'reversed',
      snapshotId: Number(row.id) || 0,
    })
  }
  return folds
}

/**
 * The folds and decisions recorded against one product row.
 *
 * Deliberately NOT filtered in SQL by keeper/dup id. The bulk shape stores its
 * reversals as a JSON array inside one TEXT column, so narrowing it in SQL would
 * mean json_each -- a second dialect of the same question, and one this
 * codebase has been bitten by before (see the header of this module). The rows
 * are bounded instead (the two merge kinds only, newest first, capped) and the
 * matching is done in JS with the same parse the appliers use. A catalog with
 * more merge history than the cap shows its most recent folds, which is the
 * half anyone is looking at.
 */
export async function readProductIdentityHistory(db: D1Compat, productId: number): Promise<ProductIdentityHistory> {
  const id = Number(productId)
  const empty: ProductIdentityHistory = { productId: id, mergedFrom: [], mergedInto: null, keptSeparate: [] }
  if (!Number.isInteger(id) || id <= 0) return empty

  const [singles, bulks, decisions] = await Promise.all([
    db.prepare(`
      SELECT id, status, payload_json, created_at, created_by_name
      FROM undo_snapshots WHERE kind = 'product.merge'
      ORDER BY id DESC LIMIT 500
    `).all<SnapshotRow>({}),
    db.prepare(`
      SELECT id, status, payload_json, created_at, created_by_name
      FROM undo_snapshots WHERE kind = 'product.merge.bulk'
      ORDER BY id DESC LIMIT 200
    `).all<SnapshotRow>({}),
    // audit_logs.entity_id is TEXT (migration 0001), and audit() binds a NUMBER
    // into it, so the stored value is the text '10'. Comparing that column to a
    // bound integer matches NOTHING here -- silently, with no error and an
    // empty list that reads exactly like "no decision was ever taken". Both
    // sides are compared as text, explicitly, so the query cannot depend on
    // which engine's affinity rules are running it.
    db.prepare(`
      SELECT created_at, user_name, details
      FROM audit_logs
      WHERE action = 'identity_keep_separate' AND entity = 'product' AND CAST(entity_id AS TEXT) = @id
      ORDER BY id DESC LIMIT 50
    `).all<{ created_at: string | null; user_name: string | null; details: string | null }>({ id: String(id) }),
  ])

  // Two queries, each newest-first within its own shape -- so concatenating
  // them is NOT newest-first, it is "every single fold, then every bulk one",
  // and the type says mergedFrom is newest first. Left unsorted, a survivor
  // whose most recent fold came from the whole-catalog run showed that fold
  // BELOW a single merge from months earlier, and mergedInto (which takes the
  // first match) could answer with the older of two folds. Sorted here, once,
  // on the snapshot id: the only field that totally orders folds from both
  // shapes.
  const folds = [
    ...singles.flatMap((row) => foldsInSnapshot(row, 'merge')),
    ...bulks.flatMap((row) => foldsInSnapshot(row, 'bulk_merge')),
  ].sort((a, b) => b.snapshotId - a.snapshotId)
  const mergedFrom = folds.filter((fold) => fold.intoId === id)
  // A row can only have been folded away once and still exist to be asked
  // about, so the newest such fold is the answer -- newest for real now that
  // the list above is in one order.
  const mergedInto = folds.find((fold) => fold.fromId === id) || null

  const keptSeparate = decisions.map((row) => {
    let details: Record<string, unknown> = {}
    try { details = row.details ? (JSON.parse(row.details) as Record<string, unknown>) : {} } catch { details = {} }
    const ids = Array.isArray(details.keptSeparateFrom) ? details.keptSeparateFrom.map(Number).filter(Number.isInteger) : []
    return {
      at: row.created_at,
      by: row.user_name,
      keptSeparateFrom: ids,
      path: details.path == null ? null : String(details.path),
    }
  })

  return { productId: id, mergedFrom, mergedInto, keptSeparate }
}

export async function findPossiblySameProductClusters(db: D1Compat): Promise<PossiblySameProductCluster[]> {
  const [rows, dismissalRows] = await Promise.all([
    db.prepare(`
      SELECT p.id, p.name, p.barcode, p.cost_price_usd, p.cost_price_khr,
             p.selling_price_usd, COALESCE(SUM(bs.quantity), 0) AS stock_quantity,
             p.image_path, p.name_key
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      WHERE p.is_active = 1 AND COALESCE(p.is_group, 0) = 0
      GROUP BY p.id
      ORDER BY p.id ASC
    `).all<PossiblySameProductEntry & { name_key: string | null }>({}),
    db.prepare(`SELECT cluster_type, cluster_value FROM product_duplicate_dismissals`)
      .all<{ cluster_type: string; cluster_value: string }>({}),
  ])
  const dismissed = new Set(dismissalRows.map((row) => dismissKey(row.cluster_type, row.cluster_value)))

  const byBarcode = new Map<string, (PossiblySameProductEntry & { name_key: string | null })[]>()
  // Keyed by name_key + FOLDED barcode: a leading-zero twin is only ever a twin
  // inside one exact name, the same bound the auto-merge detector applies. The
  // floor is the fold's own 3-digit one, NOT MIN_REAL_BARCODE_LENGTH: the two
  // bounds were set by different rulings, and 4 would hide exactly the five MAC
  // shade pairs ('0601'/'601', 617, 666, 689, 691) the owner named when he
  // lowered the merge bound to 3.
  const byLeadingZeroKey = new Map<string, (PossiblySameProductEntry & { name_key: string | null })[]>()
  const byNameKey = new Map<string, (PossiblySameProductEntry & { name_key: string | null })[]>()
  const byFuzzyKey = new Map<string, (PossiblySameProductEntry & { name_key: string | null })[]>()
  for (const row of rows) {
    const folded = identityBarcodeKey(row.barcode)
    if (row.name_key && folded.length >= 3) {
      const zeroKey = dismissKey(row.name_key, folded)
      if (!byLeadingZeroKey.has(zeroKey)) byLeadingZeroKey.set(zeroKey, [])
      byLeadingZeroKey.get(zeroKey)!.push(row)
    }
    const barcode = String(row.barcode || '').trim()
    if (barcode.length >= MIN_REAL_BARCODE_LENGTH) {
      if (!byBarcode.has(barcode)) byBarcode.set(barcode, [])
      byBarcode.get(barcode)!.push(row)
    }
    if (row.name_key) {
      if (!byNameKey.has(row.name_key)) byNameKey.set(row.name_key, [])
      byNameKey.get(row.name_key)!.push(row)
    }
    const fuzzyKey = normalizeProductFuzzyName(row.name)
    if (fuzzyKey) {
      if (!byFuzzyKey.has(fuzzyKey)) byFuzzyKey.set(fuzzyKey, [])
      byFuzzyKey.get(fuzzyKey)!.push(row)
    }
  }

  const toEntry = (row: PossiblySameProductEntry): PossiblySameProductEntry => ({
    id: row.id, name: row.name, barcode: row.barcode,
    cost_price_usd: row.cost_price_usd, cost_price_khr: row.cost_price_khr,
    selling_price_usd: row.selling_price_usd,
    stock_quantity: row.stock_quantity, image_path: row.image_path,
  })

  const clusters: PossiblySameProductCluster[] = []
  // FIRST class, and the strongest evidence there is: one exact name, and
  // barcodes that are the same number written with different leading zeros.
  // Before this class existed the pair arrived as an ordinary same_name cluster,
  // indistinguishable from two genuinely different SKUs -- so the reviewer had no
  // way to tell the owner's N15 case from a shade pair, and the tab's bulk gate
  // refused it whenever the two costs differed.
  const leadingZeroIds = new Set<number>()
  for (const group of byLeadingZeroKey.values()) {
    if (group.length < 2) continue
    // Identical raw barcodes are the same_barcode cluster's job; this class
    // exists for the pair the raw key can never bring together.
    const raws = new Set(group.map((row) => String(row.barcode || '').trim().toLowerCase()))
    if (raws.size < 2) continue
    for (const row of group) leadingZeroIds.add(row.id)
    const folded = identityBarcodeKey(group[0].barcode)
    if (dismissed.has(dismissKey('leadingzero', folded))) continue
    clusters.push({ type: 'leadingzero', value: folded, severity: 'leading_zero', products: group.map(toEntry) })
  }
  for (const [barcode, group] of byBarcode) {
    if (group.length < 2) continue
    if (dismissed.has(dismissKey('barcode', barcode))) continue
    clusters.push({ type: 'barcode', value: barcode, severity: 'same_barcode', products: group.map(toEntry) })
  }
  for (const [nameKey, group] of byNameKey) {
    if (group.length < 2) continue
    if (dismissed.has(dismissKey('name', nameKey))) continue
    // A name group whose members all share one real barcode IS the barcode
    // cluster above -- listing it twice would make one decision look like
    // two. Groups with mixed/placeholder barcodes still show here.
    const barcodes = new Set(group.map((row) => String(row.barcode || '').trim()))
    if (barcodes.size === 1 && [...barcodes][0].length >= MIN_REAL_BARCODE_LENGTH) continue
    // ...and a name group that is ENTIRELY one leading-zero twin set is the
    // cluster above. Same de-dup the barcode rule does one line up: one decision
    // must never be shown as two.
    if (group.every((row) => leadingZeroIds.has(row.id))
      && new Set(group.map((row) => identityBarcodeKey(row.barcode))).size === 1) continue
    clusters.push({ type: 'name', value: group[0].name || nameKey, severity: 'same_name', products: group.map(toEntry) })
  }
  for (const [fuzzyKey, group] of byFuzzyKey) {
    if (group.length < 2) continue
    if (dismissed.has(dismissKey('similar', fuzzyKey))) continue
    // Only NEW evidence: a fuzzy group whose members all share ONE exact
    // name_key is already the same_name cluster above (that one name_key
    // trivially yields one fuzzy key), and one that all shares ONE real
    // barcode is the same_barcode cluster -- surfacing either again would
    // split one decision into two. The similar_name row exists for the case
    // neither catches: DIFFERENT exact names (>=2 name_keys) that only a
    // fuzzier read (diacritics/punctuation/word-order ignored) sees as one
    // item -- the "renamed, own barcode" duplicate the user reported.
    const nameKeys = new Set(group.map((row) => row.name_key || ''))
    if (nameKeys.size < 2) continue
    const barcodes = new Set(group.map((row) => String(row.barcode || '').trim()))
    if (barcodes.size === 1 && [...barcodes][0].length >= MIN_REAL_BARCODE_LENGTH) continue
    clusters.push({ type: 'similar', value: group[0].name || fuzzyKey, severity: 'similar_name', products: group.map(toEntry) })
  }
  // Worst-first: a shared real barcode is the strongest same-item evidence, a
  // shared exact display name next, a fuzzy-only name match the weakest.
  const rank: Record<PossiblySameSeverity, number> = { leading_zero: 0, same_barcode: 1, same_name: 2, similar_name: 3 }
  return clusters.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export async function findDuplicateProductGroups(db: D1Compat): Promise<ProductDuplicateGroup[]> {
  const rows = await db
    .prepare(`
      SELECT p.id, p.name, p.barcode, p.cost_price_usd, p.cost_price_khr,
             p.selling_price_usd, p.selling_price_khr, p.image_path, p.name_key,
             COALESCE(SUM(bs.quantity), 0) AS live_stock_quantity
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      WHERE p.is_active = 1 AND COALESCE(p.is_group, 0) = 0
      GROUP BY p.id
      ORDER BY p.name_key ASC, p.id ASC
    `)
    .all<ProductIdentityRow & { name_key: string }>({})

  const byNameKey = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  const byRawBarcode = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  const byFuzzyName = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
  for (const row of rows) {
    if (!row.name_key) continue
    if (!byNameKey.has(row.name_key)) byNameKey.set(row.name_key, [])
    byNameKey.get(row.name_key)!.push(row)
    const barcode = String(row.barcode || '').trim().toLowerCase()
    if (barcode.length >= MIN_REAL_BARCODE_LENGTH) {
      if (!byRawBarcode.has(barcode)) byRawBarcode.set(barcode, [])
      byRawBarcode.get(barcode)!.push(row)
    }
    const fuzzyName = normalizeProductFuzzyName(row.name)
    if (fuzzyName) {
      if (!byFuzzyName.has(fuzzyName)) byFuzzyName.set(fuzzyName, [])
      byFuzzyName.get(fuzzyName)!.push(row)
    }
  }

  // Manual review wins over automatic cleanup when classifications overlap.
  // A row sharing its raw barcode with another exact name, or participating
  // in a fuzzy-name cluster spanning exact names, must stay visible for the
  // reviewer even if it also has an otherwise-safe exact duplicate.
  const manualOnlyIds = new Set<number>()
  for (const group of byRawBarcode.values()) {
    if (new Set(group.map((row) => row.name_key)).size < 2) continue
    for (const row of group) manualOnlyIds.add(row.id)
  }
  for (const group of byFuzzyName.values()) {
    if (new Set(group.map((row) => row.name_key)).size < 2) continue
    for (const row of group) manualOnlyIds.add(row.id)
  }

  const groups: ProductDuplicateGroup[] = []
  for (const candidates of byNameKey.values()) {
    if (candidates.length < 2) continue
    // Within one name_key bucket there can be more than one genuinely
    // distinct item (e.g. same name, different cost/price on purpose) --
    // so still bucket by the full identity rule inside the name group,
    // same fields findIdentityMatch/findIdentityMatches check, rather than
    // assuming every same-name row belongs together.
    const buckets = new Map<string, (ProductIdentityRow & { name_key: string })[]>()
    for (const candidate of candidates) {
      if (manualOnlyIds.has(candidate.id)) continue
      // Exact barcode matches behave as before, and a pair differing only by
      // leading zeros lands together -- inside the same exact NAME, which is the
      // only bound left. (This comment used to end "and same-cost bucket"; cost
      // left productDetailSignature on Sep 4 2026, so anyone auditing the fold
      // from its own comments would have concluded the bulk merge was cost-gated
      // when it is not.) Same barcode + different name therefore remains in the
      // manual-review list, exactly as requested.
      //
      // productDetailSignature ALREADY folds leading zeros (identityBarcodeKey),
      // so the explicit fold here is redundant -- kept because it is idempotent
      // and because spelling it out is what makes the survivor ordering legible.
      const bucketKey = productDetailSignature({
        ...candidate,
        barcode: normalizeLeadingZeroBarcodeForCleanup(candidate.barcode),
      })
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, [])
      buckets.get(bucketKey)!.push(candidate)
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue
      // For an extra-zero pair, the already-clean barcode must survive; the
      // fold moves all branch stock onto it even when the typo row owns that
      // stock today. Exact-barcode duplicates prefer the stocked row. Id is
      // the stable final tie-break.
      const rawBarcodes = new Set(bucket.map((row) => String(row.barcode ?? '').trim().toLowerCase()))
      const isLeadingZeroPair = rawBarcodes.size > 1
      // How many leading zeros this row would shed. 0 means the row already
      // carries the clean barcode. Ranking on the COUNT rather than on a
      // was-it-normalized boolean is what lets a double-zero row lose to its
      // single-zero twin: '008339327539' and '08339327539' are both "normalized",
      // so the boolean tied them and the dirtier row won on the id tie-break,
      // putting the extra zero back into the catalog as the survivor.
      const zerosShed = (row: ProductIdentityRow) => {
        const raw = String(row.barcode ?? '').trim().toLowerCase()
        return raw.length - normalizeLeadingZeroBarcodeForCleanup(raw).length
      }
      const ordered = [...bucket].sort((a, b) => {
        if (isLeadingZeroPair) {
          const zeroDiff = zerosShed(a) - zerosShed(b)
          if (zeroDiff) return zeroDiff
        }
        const stockDiff = (Number(b.live_stock_quantity) || 0) - (Number(a.live_stock_quantity) || 0)
        if (stockDiff) return stockDiff
        return a.id - b.id
      })
      const [canonical, ...duplicates] = ordered
      groups.push({ canonical, duplicates })
    }
  }
  return groups
}
