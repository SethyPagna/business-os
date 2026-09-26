// Planning half of the r2-apac-copy job: what to copy, in which order, what to
// prune, and whether two bucket listings are the same. No I/O -- ops-r2.mjs
// does the talking and test-ops-r2-driver-pure.cjs drives both against the
// real Worker code and an in-memory R2.
//
// Object descriptions come from the copy Worker's describe()
// (ops/r2-copy-worker/src/core.mjs) and are compared with its differences(),
// so the runner and the Worker share one definition of "identical".

import { differences } from '../r2-copy-worker/src/core.mjs'
import { OpsError } from './ops-common.mjs'

export const SOURCE_BUCKET = 'business-os-assets'
export const DEST_BUCKET = 'business-os-assets-apac'
export const DEST_LOCATION = 'apac'
export const COPY_WORKER = 'business-os-r2-copy'
export const PRODUCTION_WORKER = 'business-os'
export const ASSETS_BINDING = 'ASSETS'

export const MAX_ITEMS_PER_COPY = 10
export const MAX_BYTES_PER_COPY = 32 * 1024 * 1024
export const MAX_KEYS_PER_VERIFY = 25
export const MAX_BYTES_PER_VERIFY = 64 * 1024 * 1024
export const MAX_KEYS_PER_PRUNE = 100

// ------------------------------------------------------------ order

// The app orders these keys by `uploaded` and deletes all but the newest
// (backup.ts listCloudflareBackups -> pruneCloudflareBackups keeps 2
// finalized manifests; googleDrive.ts pruneDriveRestoreStages keeps 2 staged
// files). R2 put() cannot set `uploaded`, so the copy WRITES these keys in
// the source's order; a copy in any other order could make the app delete
// its newest backup after the switch.
export const ORDER_SENSITIVE = /^backups\/cloudflare\/[^/]+$/

export function isOrderSensitive(key) {
  return ORDER_SENSITIVE.test(key)
}

function byKey(a, b) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

// backup.ts's own comparator: newest first by the ISO `uploaded` string.
function byUploadedDesc(a, b) {
  return String(b.uploaded || '').localeCompare(String(a.uploaded || ''))
}

// The order the app sees: newest first, ties in list (key) order because R2
// lists by key and Array.prototype.sort is stable.
export function appOrder(objects) {
  return [...objects].sort(byKey).sort(byUploadedDesc)
}

// True when the app would list `a` before `b`.
function appPrecedes(a, b) {
  const c = byUploadedDesc(a, b)
  return c < 0 || (c === 0 && a.key < b.key)
}

// Adjacent pairs of the source's app order (restricted to keys the
// destination also has) that the destination presents the other way round.
// None means the app sees the same order after the switch: a strict total
// order is fixed by its adjacent pairs.
export function orderInversions(sourceObjects, destByKey) {
  const order = appOrder(sourceObjects.filter((o) => isOrderSensitive(o.key) && destByKey.has(o.key)))
  const inversions = []
  for (let i = 0; i + 1 < order.length; i += 1) {
    const newer = destByKey.get(order[i].key)
    const older = destByKey.get(order[i + 1].key)
    if (!appPrecedes(newer, older)) inversions.push([order[i].key, order[i + 1].key])
  }
  return inversions
}

// -------------------------------------------------------- classification

export function indexByKey(objects, side) {
  const map = new Map()
  for (const o of objects) {
    if (!o || typeof o.key !== 'string' || !o.key) throw new OpsError('listing-bad-object', `A ${side} listing entry has no key.`)
    if (map.has(o.key)) throw new OpsError('listing-duplicate-key', `The ${side} listing returned a key twice.`, { key: o.key })
    map.set(o.key, o)
  }
  return map
}

// status per source key: identical | unverified (only the MD5 is unknown,
// e.g. a multipart etag) | different | missing. Later steps add vanished
// (the source no longer has it) and unresolved (a /verify call failed).
export function classify(sourceObjects, destObjects) {
  const src = indexByKey(sourceObjects, 'source')
  const dst = indexByKey(destObjects, 'destination')
  const status = new Map()
  const diffs = new Map()
  for (const s of src.values()) {
    const d = dst.get(s.key)
    if (!d) {
      status.set(s.key, 'missing')
      continue
    }
    const found = differences(s, d)
    if (!found.length) status.set(s.key, 'identical')
    else if (found.length === 1 && found[0] === 'content-unverified') status.set(s.key, 'unverified')
    else status.set(s.key, 'different')
    if (found.length) diffs.set(s.key, found)
  }
  const destinationOnly = [...dst.keys()].filter((k) => !src.has(k))
  return { src, dst, status, diffs, destinationOnly }
}

export function keysWithStatus(c, wanted) {
  return [...c.status.entries()].filter(([, s]) => s === wanted).map(([k]) => k)
}

// Folds /verify results (streamed MD5 on both sides) into the classification.
export function applyVerifyResults(c, results) {
  for (const r of results) {
    if (!r || typeof r.key !== 'string' || !c.status.has(r.key)) continue
    switch (r.outcome) {
      case 'identical':
        c.status.set(r.key, 'identical')
        c.diffs.delete(r.key)
        break
      case 'different':
        c.status.set(r.key, 'different')
        c.diffs.set(r.key, Array.isArray(r.diffs) ? r.diffs : ['different'])
        break
      case 'missing-in-destination':
        c.status.set(r.key, 'missing')
        break
      case 'destination-only':
        c.status.set(r.key, 'vanished')
        break
      default: // absent, failed, or anything unexpected
        c.status.set(r.key, 'unresolved')
        c.diffs.set(r.key, [String(r.outcome || 'no-result')])
    }
  }
}

// ------------------------------------------------------------ planning

// items: [{ key, expectEtag, size, force? }]
//   regular - missing, different or unresolved keys; any order, in parallel.
//   ordered - backup keys from the first one whose destination copy is not
//             identical-and-in-order, oldest first, one request at a time,
//             each re-put (force) so its `uploaded` lands after the previous.
//   prune   - destination keys the source does not have (pre-switch only).
export function planCopy(c) {
  const sensitive = appOrder([...c.src.values()].filter((o) => isOrderSensitive(o.key)))
  const writeOrder = sensitive.reverse() // oldest first
  let settled = 0
  for (let i = 0; i < writeOrder.length; i += 1) {
    const key = writeOrder[i].key
    if (c.status.get(key) !== 'identical') break
    if (i > 0 && !appPrecedes(c.dst.get(key), c.dst.get(writeOrder[i - 1].key))) break
    settled = i + 1
  }
  const ordered = writeOrder
    .slice(settled)
    .filter((o) => c.status.get(o.key) !== 'vanished')
    .map((o) => ({ key: o.key, expectEtag: o.etag, size: o.size, force: true }))
  const inOrdered = new Set(ordered.map((i) => i.key))
  const regular = []
  let skipped = 0
  for (const o of c.src.values()) {
    if (inOrdered.has(o.key)) continue
    const s = c.status.get(o.key)
    if (s === 'identical') skipped += 1
    else if (s !== 'vanished') regular.push({ key: o.key, expectEtag: o.etag, size: o.size })
  }
  const prune = [...c.destinationOnly, ...keysWithStatus(c, 'vanished')]
  return { regular, ordered, skipped, settledOrdered: settled, prune }
}

// Consecutive groups of at most maxItems items and maxBytes bytes (an item
// larger than maxBytes travels alone). Order is preserved.
export function batches(items, { maxItems, maxBytes = Infinity }) {
  const out = []
  let current = []
  let bytes = 0
  for (const item of items) {
    const size = Number(item.size) || 0
    if (current.length && (current.length >= maxItems || bytes + size > maxBytes)) {
      out.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += size
  }
  if (current.length) out.push(current)
  return out
}

// -------------------------------------------------------------- tallies

export function emptyCopyTally() {
  return {
    copied: 0, overwritten: 0, rewritten: 0, skippedIdentical: 0,
    conflicts: 0, vanished: 0, mismatched: 0, failed: 0,
    bytes: 0, sourceChanged: 0,
  }
}

// Worker /copy results -> counts. Anything unrecognised is a failure.
export function tallyCopy(results, tally = emptyCopyTally()) {
  for (const r of results) {
    const size = Number(r && r.size) || 0
    switch (r && r.outcome) {
      case 'copied': tally.copied += 1; tally.bytes += size; break
      case 'overwritten': tally.overwritten += 1; tally.bytes += size; break
      case 'rewritten': tally.rewritten += 1; tally.bytes += size; break
      case 'skipped-identical': tally.skippedIdentical += 1; break
      case 'conflict': tally.conflicts += 1; break
      case 'source-missing': tally.vanished += 1; break
      case 'mismatch': tally.mismatched += 1; break
      default: tally.failed += 1
    }
    if (r && r.sourceChanged) tally.sourceChanged += 1
  }
  return tally
}

export function tallyPrune(results) {
  const t = { pruned: 0, keptSourcePresent: 0, alreadyAbsent: 0, failed: 0 }
  for (const r of results) {
    switch (r && r.outcome) {
      case 'pruned': t.pruned += 1; break
      case 'kept-source-present': t.keptSourcePresent += 1; break
      case 'already-absent': t.alreadyAbsent += 1; break
      default: t.failed += 1
    }
  }
  return t
}

// A /copy, /verify or /prune response must answer every key it was sent,
// in order; anything else is treated as a failure of the whole batch.
export function matchResults(items, response) {
  const results = response && Array.isArray(response.results) ? response.results : null
  if (!results || results.length !== items.length || results.some((r, i) => !r || r.key !== items[i].key)) return null
  return results
}

// ------------------------------------------------------------- verdicts

export function listingTotals(objects) {
  let bytes = 0
  for (const o of objects) bytes += Number(o.size) || 0
  return { objects: objects.length, bytes }
}

// Positive control: a listing that carries no metadata at all means the
// include option was not honoured, and a metadata comparison would pass
// while observing nothing. Every app upload path sets a content type.
export function metadataObserved(objects) {
  return objects.some((o) => Object.keys(o.httpMetadata || {}).length > 0)
}

// verify-only: every source key identical in the destination, nothing extra,
// the same totals, and the backup order preserved.
export function verifyVerdict(c, { sourceObjects, destObjects }) {
  const src = listingTotals(sourceObjects)
  const dst = listingTotals(destObjects)
  const counts = {
    sourceObjects: src.objects,
    sourceBytes: src.bytes,
    destObjects: dst.objects,
    destBytes: dst.bytes,
    identical: keysWithStatus(c, 'identical').length,
    different: keysWithStatus(c, 'different').length,
    missing: keysWithStatus(c, 'missing').length,
    unresolved: keysWithStatus(c, 'unresolved').length + keysWithStatus(c, 'unverified').length,
    vanished: keysWithStatus(c, 'vanished').length,
    destinationOnly: c.destinationOnly.length,
  }
  const inversions = orderInversions(sourceObjects, c.dst)
  counts.orderInversions = inversions.length
  const problems = []
  if (!src.objects) problems.push('source-listing-empty')
  if (!metadataObserved(sourceObjects)) problems.push('listing-without-metadata')
  if (src.objects !== dst.objects) problems.push('object-count-differs')
  if (src.bytes !== dst.bytes) problems.push('byte-total-differs')
  if (counts.missing) problems.push('missing-in-destination')
  if (counts.different) problems.push('objects-differ')
  if (counts.unresolved) problems.push('objects-unresolved')
  if (counts.vanished) problems.push('source-changed-during-verify')
  if (counts.destinationOnly) problems.push('destination-only-objects')
  if (counts.orderInversions) problems.push('backup-order-differs')
  if (counts.identical !== src.objects) problems.push('not-all-identical')
  return { ok: problems.length === 0, problems, counts, inversions }
}

// ---------------------------------------------------- production binding

// Which bucket the live production Worker's ASSETS binding points at, from
// its latest deployment (all versions carrying traffic):
//   source | destination | mixed | unknown
// api(method, path) -> { ok, status, json } (ops-common cfApi, or a fake).
export async function productionAssetsState(api, accountId) {
  const unknown = (reason, detail) => ({ state: 'unknown', reason, detail })
  const base = `/accounts/${accountId}/workers/scripts/${PRODUCTION_WORKER}`
  const dep = await api('GET', `${base}/deployments`)
  if (!dep || !dep.ok) return unknown('deployments-unreadable', { status: dep && dep.status })
  const deployments = dep.json && dep.json.result && dep.json.result.deployments
  if (!Array.isArray(deployments) || !deployments.length) return unknown('no-deployments')
  // The API lists newest first (wrangler reads .at(0)); sort defensively.
  const latest = [...deployments].sort((a, b) => String(b && b.created_on || '').localeCompare(String(a && a.created_on || '')))[0]
  const versions = (latest && Array.isArray(latest.versions) ? latest.versions : []).filter((v) => v && Number(v.percentage) > 0)
  if (!versions.length) return unknown('no-live-versions')
  const buckets = []
  for (const v of versions) {
    if (typeof v.version_id !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(v.version_id)) return unknown('bad-version-id')
    const r = await api('GET', `${base}/versions/${v.version_id}`)
    const bindings = r && r.ok && r.json && r.json.result && r.json.result.resources ? r.json.result.resources.bindings : null
    if (!Array.isArray(bindings)) return unknown('bindings-unreadable', { status: r && r.status })
    const assets = bindings.filter((b) => b && b.name === ASSETS_BINDING)
    if (assets.length !== 1 || assets[0].type !== 'r2_bucket') return unknown('assets-binding-missing')
    buckets.push({ versionId: v.version_id, percentage: Number(v.percentage), bucket: assets[0].bucket_name, jurisdiction: assets[0].jurisdiction || null })
  }
  const kinds = new Set(buckets.map((b) => {
    if (b.jurisdiction) return 'other'
    if (b.bucket === SOURCE_BUCKET) return 'source'
    if (b.bucket === DEST_BUCKET) return 'destination'
    return 'other'
  }))
  if (kinds.has('other')) return { ...unknown('other-bucket'), buckets }
  if (kinds.size === 1) return { state: kinds.has('source') ? 'source' : 'destination', buckets }
  return { state: 'mixed', buckets }
}

// Location hints may come back in either case; anything outside R2's known
// set reads as unknown (and is never apac).
export const KNOWN_LOCATIONS = ['apac', 'eeur', 'enam', 'weur', 'wnam', 'oc']
export function normalizeLocation(value) {
  const s = String(value || '').trim().toLowerCase()
  return KNOWN_LOCATIONS.includes(s) ? s : 'unknown'
}
