import { identityBarcodeKey } from './productDetailRule.ts'
import { setTwinDismissalRule, type TwinDismissalRule } from './productGrouping.ts'

// "Keep both" and the Duplicate tag (owner, 16 Nov 2026: a conflict choice is a ruling). The Conflicts sweep
// (cloudflare/src/lib/productIdentity.ts findPossiblySameProductClusters) skips a cluster the person dismissed, and Resolve refuses a pair no
// listed cluster holds. So a twin cluster (utils/productGrouping.ts unmergedTwinKeys) is still a duplicate only while at least one listed
// Conflicts cluster holds it; once every one of them is dismissed the tag, the open state and the scan's one-product treatment all go.
//
// Staff only: the public storefront never imports this file. productGrouping.ts reads it through setTwinDismissalRule, which setTwinDismissals
// registers, so before the first load (and in any list nobody loaded dismissals for) nothing is dismissed.
//
// A twin cluster is held by up to three Conflicts clusters, named here by the key the dismissal table stores them under:
//   barcode      every row of the twin cluster has the same trimmed barcode of 4 or more characters (the same_barcode cluster);
//   leadingzero  every row folds to one barcode of 3 or more characters and the spellings differ (the leading_zero cluster);
//   name         the exact-name cluster, unless the Worker folds it into one of the two above (every row of the name shares one barcode of 4 or
//                more characters, or the whole name is one leading-zero set): listing one decision twice would make it look like two.
// Each constant below is the sweep's own: MIN_BARCODE_CLUSTER_LENGTH is MIN_REAL_BARCODE_LENGTH and MIN_FOLDED_LENGTH is the fold's 3-digit floor.
const MIN_BARCODE_CLUSTER_LENGTH = 4
const MIN_FOLDED_LENGTH = 3
// U+0001 can never occur in a barcode or a name key; the Worker's dismissKey uses the same delimiter.
const DELIM = String.fromCharCode(1)

type Row = { barcode?: unknown }
export type TwinDismissals = ReadonlySet<string>

export const NO_TWIN_DISMISSALS: TwinDismissals = new Set<string>()
export const twinDismissalKey = (type: string, value: string): string => `${type}${DELIM}${value}`

// GET /api/products/duplicate-dismissals answers { dismissals: [[type, value], ...] }; anything else is "no rulings".
export function parseTwinDismissals(payload: unknown): TwinDismissals {
  const list = (payload as { dismissals?: unknown } | null)?.dismissals
  if (!Array.isArray(list) || !list.length) return NO_TWIN_DISMISSALS
  const keys = new Set<string>()
  for (const entry of list) if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') keys.add(twinDismissalKey(entry[0], entry[1]))
  return keys
}

const trimmedBarcode = (row: Row): string => String(row.barcode ?? '').trim()

// The one trimmed barcode every row carries when it is long enough to form the same_barcode cluster, else null.
function sharedBarcode(rows: readonly Row[]): string | null {
  const codes = new Set(rows.map(trimmedBarcode))
  const [code] = codes
  return codes.size === 1 && code.length >= MIN_BARCODE_CLUSTER_LENGTH ? code : null
}

// The one folded barcode every row reduces to when the rows spell it in 2 or more ways (leading zeros), long enough to form the leading_zero cluster, else null.
function leadingZeroFold(rows: readonly Row[]): string | null {
  const folds = new Set(rows.map((row) => identityBarcodeKey(row.barcode)))
  const spellings = new Set(rows.map((row) => trimmedBarcode(row).toLowerCase()))
  const [fold] = folds
  return folds.size === 1 && fold.length >= MIN_FOLDED_LENGTH && spellings.size >= 2 ? fold : null
}

// The dismissal keys of every Conflicts cluster that holds the whole twin cluster and lists it.
export function twinClusterHolderKeys(cluster: readonly Row[], nameKey: string, nameGroup: readonly Row[]): string[] {
  const keys: string[] = []
  const code = sharedBarcode(cluster)
  if (code !== null) keys.push(twinDismissalKey('barcode', code))
  const fold = leadingZeroFold(cluster)
  if (fold !== null) keys.push(twinDismissalKey('leadingzero', fold))
  // The name cluster is not listed when it is the barcode or the leading-zero cluster under another name (one decision is never shown twice). That is
  // judged on the rows loaded, which can only be a subset of the Worker's name group: a subset that looks folded when the whole group is not leaves the
  // name cluster out of the holders, which at worst drops a tag from a pair Conflicts still lists, and never tags a pair it does not.
  if (sharedBarcode(nameGroup) === null && leadingZeroFold(nameGroup) === null) keys.push(twinDismissalKey('name', nameKey))
  return keys
}

// True when the person has dismissed every Conflicts cluster that lists this twin cluster.
export function isTwinClusterDismissed(dismissals: TwinDismissals, cluster: readonly Row[], nameKey: string, nameGroup: readonly Row[]): boolean {
  if (!dismissals.size) return false
  const holders = twinClusterHolderKeys(cluster, nameKey, nameGroup)
  return holders.length > 0 && holders.every((key) => dismissals.has(key))
}

// ---- the loaded dismissals: one set for the staff shell, read by every list --------------------------------------------------------------------------
// Products, Inventory, the Transfer picker and POS all flag twins from rows they loaded, and "Keep both" is a catalogue-wide ruling, so the set is one
// value per signed-in session (the shell's loader, components/shared/useTwinDismissalsLoader.ts, keeps it current). A list that memoises its
// groups reads it through useTwinDismissals so it regroups when the set changes.
let current: TwinDismissals = NO_TWIN_DISMISSALS
const listeners = new Set<() => void>()

const sameKeys = (left: TwinDismissals, right: TwinDismissals): boolean => left.size === right.size && [...left].every((key) => right.has(key))

const rule: TwinDismissalRule = (cluster, nameKey, nameGroup) => isTwinClusterDismissed(current, cluster, nameKey, nameGroup)

export function getTwinDismissals(): TwinDismissals {
  return current
}

export function setTwinDismissals(next: TwinDismissals): void {
  setTwinDismissalRule(rule)
  if (sameKeys(current, next)) return
  current = next
  for (const listener of [...listeners]) listener()
}

export function subscribeTwinDismissals(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
