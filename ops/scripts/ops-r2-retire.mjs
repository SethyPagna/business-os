#!/usr/bin/env node
// r2-old-retire job of .github/workflows/ops.yml: retires the OLD R2 bucket business-os-assets (eeur) after the owner's
// 20 Nov 2026 approval. The live bucket business-os-assets-apac is never a target.
//
//   node ops/scripts/ops-r2-retire.mjs guard-copy-modes   refuse copy and topup once production is bound to the apac bucket
//   node ops/scripts/ops-r2-retire.mjs run                plan | expire | delete-bucket (OPS_R2_RETIRE_MODE)
//
//   plan           counts and bytes per top folder; no key name reaches the output
//   expire         PUT a lifecycle rule that expires every object after 1 day (and aborts stale multipart uploads)
//   delete-bucket  DELETE the bucket, only when a fresh listing returns 0 objects
//
// Guards, all checked before any call that changes anything: the one hard-coded bucket name; any other name is refused, and
// a name that equals or contains "apac" is refused first; production must be bound to business-os-assets-apac; the confirm
// string must be r2-old-retire. The public log carries counts, bytes and codes only.

import {
  OpsError, apiErrorCodes, cfApi, commitId, isMain, requireEnv, runId, runMain, say, summary, writeEncryptedReport,
} from './ops-common.mjs'
import { DEST_BUCKET, productionAssetsState } from './ops-r2-lib.mjs'

export const OLD_BUCKET = 'business-os-assets'
export const CONFIRM_WORD = 'r2-old-retire'
export const RETIRE_MODES = Object.freeze(['plan', 'expire', 'delete-bucket'])
export const EXPIRE_SECONDS = 86400
export const PER_PAGE = 1000
export const MAX_LIST_PAGES = 500
const ACCOUNT_ID = /^[0-9a-f]{32}$/
const TOP_FOLDERS = Object.freeze(['uploads', 'variants', 'backups', 'imports', 'private', 'quarantine', 'system'])

// Pure. Throws an OpsError with a fixed code. Inputs are checked first: nothing is called for a bad name.
export function checkInputs({ bucket, confirm, mode }) {
  const name = String(bucket === undefined || bucket === null ? '' : bucket)
  if (name.toLowerCase().includes('apac')) throw new OpsError('refused-apac-bucket', 'The bucket name names the live apac bucket.')
  if (name !== OLD_BUCKET) throw new OpsError('refused-bucket-name', 'Only the old bucket may be retired.')
  if (confirm !== CONFIRM_WORD) throw new OpsError('refused-confirm', 'The confirm word is missing or wrong.')
  if (!RETIRE_MODES.includes(mode)) throw new OpsError('bad-mode', 'mode must be plan, expire or delete-bucket.')
}

export function checkProduction(production) {
  const p = production
  if (!p || p.state !== 'destination' || !Array.isArray(p.buckets) || !p.buckets.length
    || !p.buckets.every((b) => b && b.bucket === DEST_BUCKET && !b.jurisdiction)) {
    throw new OpsError('production-not-on-apac', 'Production is not bound to the apac bucket.')
  }
}

// Pure. copy and topup write to the apac bucket; once production reads it only verify-only may run.
export function checkCopyModeAllowed({ mode, productionState }) {
  if (mode === 'verify-only') return
  if (productionState && productionState.state === 'destination') throw new OpsError('refused-after-switch', 'Production reads the apac bucket; only verify-only may run.')
}

export function topFolder(key) {
  const k = String(key)
  const first = k.split('/')[0]
  return k.includes('/') && TOP_FOLDERS.includes(first) ? first : 'other'
}

// api(method, path, { body }) -> { ok, status, json } (ops-common cfApi, or a fake).
export async function listCounts(api, accountId, bucket, maxPages = MAX_LIST_PAGES) {
  const folders = {}
  let objects = 0
  let bytes = 0
  let pages = 0
  let cursor = null
  const seen = new Set()
  for (;;) {
    if (pages >= maxPages) throw new OpsError('r2-list-page-cap', 'The listing passed the page cap.')
    const query = `per_page=${PER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const r = await api('GET', `/accounts/${accountId}/r2/buckets/${bucket}/objects?${query}`)
    pages += 1
    if (!r || !r.ok || !r.json || !Array.isArray(r.json.result)) throw new OpsError('r2-list-failed', 'A list page could not be read.')
    for (const o of r.json.result) {
      const size = Number(o && o.size)
      const b = Number.isFinite(size) && size > 0 ? size : 0
      const name = topFolder(o && o.key)
      const f = folders[name] || (folders[name] = { objects: 0, bytes: 0 })
      f.objects += 1
      f.bytes += b
      objects += 1
      bytes += b
    }
    const info = r.json.result_info || {}
    const next = typeof info.cursor === 'string' && info.cursor ? info.cursor : null
    if (info.is_truncated === false || !next || r.json.result.length === 0) return { objects, bytes, pages, folders }
    if (seen.has(next)) throw new OpsError('r2-list-cursor-loop', 'The listing repeated a cursor.')
    seen.add(next)
    cursor = next
  }
}

export function lifecycleBody() {
  return {
    rules: [
      { id: 'r2ret-expire-all', enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: EXPIRE_SECONDS } } },
      { id: 'r2ret-abort-uploads', enabled: true, conditions: { prefix: '' }, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: EXPIRE_SECONDS } } },
    ],
  }
}

export async function runRetire({ api, accountId, bucket, confirm, mode }) {
  checkInputs({ bucket, confirm, mode })
  if (!ACCOUNT_ID.test(String(accountId))) throw new OpsError('bad-account-id', 'CLOUDFLARE_ACCOUNT_ID is not a 32-character hex id.')
  checkProduction(await productionAssetsState(api, accountId))
  const base = `/accounts/${accountId}/r2/buckets/${OLD_BUCKET}`
  const out = { mode, ok: false, problems: [], counts: {} }

  if (mode === 'plan') {
    const l = await listCounts(api, accountId, OLD_BUCKET)
    out.counts = { objects: l.objects, bytes: l.bytes, pages: l.pages, folders: l.folders }
    out.ok = true
    return out
  }

  if (mode === 'expire') {
    const put = await api('PUT', `${base}/lifecycle`, { body: lifecycleBody() })
    if (!put || !put.ok) throw new OpsError('lifecycle-put-failed', 'The lifecycle rule was not accepted.', { status: put ? put.status : 0, codes: apiErrorCodes(put) })
    const got = await api('GET', `${base}/lifecycle`)
    const rules = got && got.ok && got.json && got.json.result && Array.isArray(got.json.result.rules) ? got.json.result.rules : null
    const expiring = rules ? rules.filter((r) => r && r.enabled === true && r.conditions && r.conditions.prefix === ''
      && r.deleteObjectsTransition && r.deleteObjectsTransition.condition && r.deleteObjectsTransition.condition.maxAge === EXPIRE_SECONDS).length : 0
    out.counts = { rules: rules ? rules.length : 0, expiringRules: expiring }
    if (expiring !== 1) out.problems.push('lifecycle-not-confirmed')
    out.ok = out.problems.length === 0
    return out
  }

  const l = await listCounts(api, accountId, OLD_BUCKET)
  out.counts = { objects: l.objects, bytes: l.bytes }
  if (l.objects !== 0) {
    out.problems.push('bucket-not-empty')
    return out
  }
  const del = await api('DELETE', base)
  if (!del || !del.ok) throw new OpsError('bucket-delete-failed', 'The bucket was not deleted.', { status: del ? del.status : 0, codes: apiErrorCodes(del) })
  const after = await api('GET', base)
  const gone = !!after && !after.ok && (after.status === 404 || apiErrorCodes(after).includes(10006))
  out.counts.deleted = gone ? 1 : 0
  if (!gone) out.problems.push('bucket-still-present')
  out.ok = gone
  return out
}

// Pure. Every template is a literal: the public log never receives a name from the bucket (folders are the fixed set above).
export function publicLines(result) {
  const lines = []
  const c = result.counts || {}
  if (result.mode === 'plan') lines.push(['r2-old-retire plan: counts only', {}])
  if (result.mode === 'expire') lines.push(['r2-old-retire expire: counts only', {}])
  if (result.mode === 'delete-bucket') lines.push(['r2-old-retire delete-bucket: counts only', {}])
  if ('objects' in c) lines.push(['objects: {n}', { n: c.objects }])
  if ('bytes' in c) lines.push(['bytes: {n}', { n: c.bytes }])
  if ('pages' in c) lines.push(['pages: {n}', { n: c.pages }])
  if ('rules' in c) lines.push(['rules: {n}', { n: c.rules }])
  if ('expiringRules' in c) lines.push(['expiringRules: {n}', { n: c.expiringRules }])
  if ('deleted' in c) lines.push(['deleted: {n}', { n: c.deleted }])
  const folders = c.folders || {}
  if (folders.uploads) lines.push(['folder uploads: {objects} objects, {bytes} bytes', { objects: folders.uploads.objects, bytes: folders.uploads.bytes }])
  if (folders.variants) lines.push(['folder variants: {objects} objects, {bytes} bytes', { objects: folders.variants.objects, bytes: folders.variants.bytes }])
  if (folders.backups) lines.push(['folder backups: {objects} objects, {bytes} bytes', { objects: folders.backups.objects, bytes: folders.backups.bytes }])
  if (folders.imports) lines.push(['folder imports: {objects} objects, {bytes} bytes', { objects: folders.imports.objects, bytes: folders.imports.bytes }])
  if (folders.private) lines.push(['folder private: {objects} objects, {bytes} bytes', { objects: folders.private.objects, bytes: folders.private.bytes }])
  if (folders.quarantine) lines.push(['folder quarantine: {objects} objects, {bytes} bytes', { objects: folders.quarantine.objects, bytes: folders.quarantine.bytes }])
  if (folders.system) lines.push(['folder system: {objects} objects, {bytes} bytes', { objects: folders.system.objects, bytes: folders.system.bytes }])
  if (folders.other) lines.push(['folder other: {objects} objects, {bytes} bytes', { objects: folders.other.objects, bytes: folders.other.bytes }])
  for (const problem of result.problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  lines.push(['r2-old-retire verdict: {verdict}', { verdict: result.ok ? 'PASS' : 'FAIL' }])
  return lines
}

async function main() {
  const command = process.argv[2]
  requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID').trim()
  const api = (method, p, opts) => cfApi(method, p, opts)
  if (command === 'guard-copy-modes') {
    const mode = String(process.env.OPS_R2_MODE || '').trim()
    if (mode === 'verify-only') return 0
    const production = await productionAssetsState(api, accountId)
    try {
      checkCopyModeAllowed({ mode, productionState: production })
    } catch (err) {
      say('problem: {code}', { code: err })
      return 1
    }
    return 0
  }
  if (command !== 'run') throw new OpsError('bad-command', 'The command must be guard-copy-modes or run.')
  const outDir = requireEnv('OPS_OUT_DIR')
  const mode = String(process.env.OPS_R2_RETIRE_MODE || '').trim()
  const startedAt = new Date().toISOString()
  let result = { mode, ok: false, problems: [], counts: {} }
  try {
    result = await runRetire({ api, accountId, bucket: process.env.OPS_R2_RETIRE_BUCKET, confirm: process.env.CONFIRM, mode })
  } catch (err) {
    result.problems.push(err instanceof OpsError ? err.code : 'internal-error')
  }
  const run = runId()
  const commit = commitId()
  const report = writeEncryptedReport(outDir, `r2-old-retire-${run}`, { kind: 'r2-old-retire', commit, runId: run, startedAt, finishedAt: new Date().toISOString(), ...result }, {
    kind: 'r2-old-retire', name: 'r2-old-bucket', commit, runId: run, createdAt: new Date().toISOString(),
  })
  for (const [template, values] of publicLines(result)) {
    say(template, values)
    summary(template, values)
  }
  say('encrypted file: {bytes} bytes', { bytes: report.bytes })
  return result.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
