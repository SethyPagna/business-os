#!/usr/bin/env node
// r2-inventory job of .github/workflows/ops.yml: a read-only census of the app's two R2 buckets, the live
// business-os-assets-apac and the old business-os-assets (eeur, being retired by the r2-old-retire task).
//
//   OPS_OUT_DIR  where r2-inventory-<run>.enc.json is written
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
//
// Reads, with GET only:
//   .../r2/buckets/<bucket>                      is the bucket there (the apac one must be: the positive control)
//   .../r2/buckets/<bucket>/objects?per_page=1000 every object, page by page with the cursor
//
// Each object is reduced on arrival to its class (classifyKey), its size, its upload time and, for a backup set, the
// set's timestamp name and a few metadata words. No object key is kept, printed or written: keys can carry a person's
// file name. The encrypted file holds counts, bytes, oldest/newest per class and per backup set. The public log holds
// only whether each bucket was read, how many list pages that took, problem codes and PASS/FAIL.

import {
  OpsError, apiErrorCodes, cfApi, commitId, isMain, requireEnv, runId, runMain, say, summary, writeEncryptedReport,
} from './ops-common.mjs'

export const BUCKETS = Object.freeze([
  Object.freeze({ name: 'business-os-assets-apac', role: 'apac', required: true }),
  Object.freeze({ name: 'business-os-assets', role: 'old', required: false }),
])
export const PER_PAGE = 1000
export const MAX_LIST_PAGES = 500
const ACCOUNT_ID = /^[0-9a-f]{32}$/
const SET = /^backups\/cloudflare\/(business-os-cloudflare-[0-9TZ:.-]{8,40})(\.json|\/state\.json|\/assets\/.+)$/
const VARIANT = /^variants\/(w160|w320|w640)\//
const META_WORD = /^[A-Za-z0-9._:-]{1,40}$/

export const CLASSES = Object.freeze([
  'uploads', 'variants/w160', 'variants/w320', 'variants/w640', 'variants/other',
  'backups/manifest', 'backups/sidecar', 'backups/legacy-assets', 'backups/asset-pool', 'backups/drive-staged', 'backups/other',
  'imports/incoming', 'imports/other', 'private/portal-submissions', 'private/other', 'quarantine', 'system', 'other',
])

// Pure: key -> class. The class, never the key, leaves this function.
export function classifyKey(key) {
  const k = String(key)
  if (k.startsWith('uploads/')) return 'uploads'
  if (k.startsWith('variants/')) {
    const v = VARIANT.exec(k)
    return v ? `variants/${v[1]}` : 'variants/other'
  }
  if (k.startsWith('backups/asset-pool/')) return 'backups/asset-pool'
  if (k.startsWith('backups/cloudflare/drive-staged-')) return 'backups/drive-staged'
  const s = SET.exec(k)
  if (s) return s[2] === '.json' ? 'backups/manifest' : s[2] === '/state.json' ? 'backups/sidecar' : 'backups/legacy-assets'
  if (k.startsWith('backups/')) return 'backups/other'
  if (/^imports\/[^/]+\/incoming\//.test(k)) return 'imports/incoming'
  if (k.startsWith('imports/')) return 'imports/other'
  if (k.startsWith('private/portal-submissions/')) return 'private/portal-submissions'
  if (k.startsWith('private/')) return 'private/other'
  if (k.startsWith('quarantine/')) return 'quarantine'
  if (k.startsWith('system/')) return 'system'
  return 'other'
}

// The set's generated name (business-os-cloudflare-<UTC stamp>): a timestamp, not personal data. null for any other key.
export function backupSetOf(key) {
  const s = SET.exec(String(key))
  return s ? s[1] : null
}

const word = (value) => (typeof value === 'string' && META_WORD.test(value) ? value : null)
const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b)
const earlier = (a, b) => (!a ? b : !b ? a : a < b ? a : b)

export function emptyTally() {
  return { objects: 0, bytes: 0, classes: Object.fromEntries(CLASSES.map((c) => [c, { objects: 0, bytes: 0, oldest: null, newest: null }])), sets: {} }
}

// Pure: folds one listed object into the tally. Only class, size, time and the backup set's metadata words are read.
export function addObject(tally, object) {
  const key = object && typeof object.key === 'string' ? object.key : ''
  const size = Number(object && object.size)
  const bytes = Number.isFinite(size) && size > 0 ? size : 0
  const at = object && typeof object.last_modified === 'string' && object.last_modified.length <= 40 ? object.last_modified : null
  const cls = classifyKey(key)
  const c = tally.classes[cls]
  c.objects += 1
  c.bytes += bytes
  c.oldest = earlier(c.oldest, at)
  c.newest = later(c.newest, at)
  tally.objects += 1
  tally.bytes += bytes
  const name = backupSetOf(key)
  if (name) {
    const set = tally.sets[name] || (tally.sets[name] = { manifest: null, sidecar: null, legacyAssetObjects: 0, legacyAssetBytes: 0 })
    const meta = object && object.custom_metadata && typeof object.custom_metadata === 'object' ? object.custom_metadata : {}
    if (cls === 'backups/manifest') {
      set.manifest = { bytes, at, gzip: meta.encoding === 'gzip', source: word(meta.source), scope: word(meta.scope), lifecycle: word(meta.lifecycle) }
    } else if (cls === 'backups/sidecar') {
      set.sidecar = { bytes, at, status: word(meta.status) }
    } else {
      set.legacyAssetObjects += 1
      set.legacyAssetBytes += bytes
    }
  }
  return tally
}

// api(method, path) -> { ok, status, json } (ops-common cfApi, or a fake).
export async function bucketState(api, accountId, bucket) {
  const r = await api('GET', `/accounts/${accountId}/r2/buckets/${bucket}`)
  if (r && r.ok && r.json && r.json.result) return { state: 'present', status: r.status }
  const codes = apiErrorCodes(r)
  if (r && (r.status === 404 || codes.includes(10006))) return { state: 'absent', status: r.status, codes }
  return { state: 'unknown', status: r ? r.status : 0, codes }
}

// Every page, by cursor. The page cap and a repeated cursor stop the run instead of looping.
export async function listBucket(api, accountId, bucket, tally, maxPages = MAX_LIST_PAGES) {
  let cursor = null
  const seen = new Set()
  let pages = 0
  for (;;) {
    if (pages >= maxPages) throw new OpsError('r2-list-page-cap', 'The listing passed the page cap.', { pages })
    const query = `per_page=${PER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const r = await api('GET', `/accounts/${accountId}/r2/buckets/${bucket}/objects?${query}`)
    pages += 1
    if (!r || !r.ok || !r.json || !Array.isArray(r.json.result)) {
      const codes = apiErrorCodes(r)
      if (r && (r.status === 403 || codes.includes(10000))) throw new OpsError('r2-list-forbidden', 'The token may not list this bucket.', { status: r.status, codes })
      throw new OpsError('r2-list-failed', 'A list page could not be read.', { status: r ? r.status : 0, codes })
    }
    for (const object of r.json.result) addObject(tally, object)
    const info = r.json.result_info || {}
    const next = typeof info.cursor === 'string' && info.cursor ? info.cursor : null
    if (info.is_truncated === false || !next || r.json.result.length === 0) return { pages }
    if (seen.has(next)) throw new OpsError('r2-list-cursor-loop', 'The listing returned a cursor it had already returned.', { pages })
    seen.add(next)
    cursor = next
  }
}

export async function readInventory(api, accountId) {
  if (!ACCOUNT_ID.test(String(accountId))) throw new OpsError('bad-account-id', 'CLOUDFLARE_ACCOUNT_ID is not a 32-character hex id.')
  const problems = []
  const buckets = {}
  for (const bucket of BUCKETS) {
    const probe = await bucketState(api, accountId, bucket.name)
    const entry = { name: bucket.name, role: bucket.role, state: probe.state, status: probe.status, codes: probe.codes || [], pages: 0, listed: false, error: null, tally: null }
    buckets[bucket.role] = entry
    if (probe.state !== 'present') {
      // The apac bucket is the positive control: it must be read. The old one may be gone (the owner deletes it by hand); only an unreadable answer is a problem.
      if (bucket.required) problems.push('apac-bucket-unreadable')
      else if (probe.state === 'unknown') problems.push('old-bucket-unreadable')
      continue
    }
    const tally = emptyTally()
    try {
      entry.pages = (await listBucket(api, accountId, bucket.name, tally)).pages
      entry.listed = true
      entry.tally = tally
    } catch (err) {
      entry.error = err instanceof OpsError ? { code: err.code, detail: err.detail || null } : { code: 'internal-error', detail: null }
      problems.push(err instanceof OpsError ? err.code : 'internal-error')
    }
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)], buckets }
}

// Pure: the only lines the public log may show. Bucket states, page counts, problem codes and the verdict; every count and byte total is in the encrypted file.
export function publicLines({ result, bytes }) {
  const lines = [['r2-inventory: both R2 buckets, GET only, states only (counts and bytes are in the encrypted file)', {}]]
  const apac = result.buckets.apac || { state: 'unknown', pages: 0, listed: false }
  const old = result.buckets.old || { state: 'unknown', pages: 0, listed: false }
  lines.push(['apac bucket: {state}, listed {listed}, list pages {pages}', { state: apac.state, listed: apac.listed, pages: apac.pages }])
  lines.push(['old eeur bucket: {state}, listed {listed}, list pages {pages}', { state: old.state, listed: old.listed, pages: old.pages }])
  for (const problem of result.problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  if (bytes !== undefined) lines.push(['encrypted file: {bytes} bytes', { bytes }])
  lines.push(['r2-inventory verdict: {verdict}', { verdict: result.ok ? 'PASS' : 'FAIL' }])
  return lines
}

async function main() {
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')
  const startedAt = new Date().toISOString()
  const commit = commitId()
  const run = runId()

  const result = await readInventory((method, p) => cfApi(method, p), accountId)

  const payload = { kind: 'r2-inventory', commit, runId: run, startedAt, finishedAt: new Date().toISOString(), classes: CLASSES, ...result }
  const report = writeEncryptedReport(outDir, `r2-inventory-${run}`, payload, {
    kind: 'r2-inventory', name: 'r2-buckets', commit, runId: run, createdAt: payload.finishedAt,
  })
  for (const [template, values] of publicLines({ result, bytes: report.bytes })) {
    say(template, values)
    summary(template, values)
  }
  return result.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
