// r2-apac-copy: zero-loss copy of the business-os-assets bucket into
// business-os-assets-apac, driven from a GitHub runner through the temporary
// Worker in ops/r2-copy-worker/. Run by .github/workflows/ops.yml:
//
//   node ops/scripts/ops-r2.mjs buckets        check both buckets; copy mode creates a
//                                              missing destination in apac
//   node ops/scripts/ops-r2.mjs run            deploy the Worker, then copy or verify
//   node ops/scripts/ops-r2.mjs delete-worker  always, even after a failure
//
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, OPS_OUT_DIR, and
// for `buckets` and `run` OPS_R2_MODE = copy | verify-only | topup.
//
// Never writes to the source bucket: the Worker only reaches it through a
// read-only wrapper. `copy` refuses to start unless the live production
// Worker still binds ASSETS to the source bucket (after the switch the app
// writes to the destination, and a copy could overwrite or prune its data).
// `topup` is the opposite: it refuses unless production already binds the
// destination, then carries objects that reached the source late (missing in
// the destination, or whose destination copy is older), never overwrites a
// newer destination object, and never prunes or deletes anything.
// The public log carries counts, byte totals and verdicts only; keys, diffs
// and error text go to the encrypted report.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  REPO_ROOT, OpsError, apiErrorCodes, cfApi, cloudflareErrorCodes, commitId, errorRecord, isMain,
  randomToken, requireEnv, runId, runMain, runWrangler, say, sleep, summary, truncate, writeEncryptedReport,
} from './ops-common.mjs'
import {
  COPY_WORKER, DEST_BUCKET, DEST_LOCATION, MAX_BYTES_PER_COPY, MAX_BYTES_PER_VERIFY, MAX_ITEMS_PER_COPY,
  MAX_KEYS_PER_PRUNE, MAX_KEYS_PER_VERIFY, SOURCE_BUCKET, applyVerifyResults, batches, classify, emptyCopyTally,
  indexByKey, keysWithStatus, listingTotals, matchResults, metadataObserved, normalizeLocation, orderInversions,
  planCopy, planTopup, productionAssetsState, tallyCopy, tallyPrune, verifyVerdict,
} from './ops-r2-lib.mjs'

export const WORKER_DIR = path.join(REPO_ROOT, 'ops', 'r2-copy-worker')
export const WORKER_TOML = path.join(WORKER_DIR, 'wrangler.toml')
// copy        before the switch: mirror the source into the destination
// verify-only any time: compare only
// topup       only AFTER the switch: carry what landed in the source late
export const MODES = ['copy', 'verify-only', 'topup']
const MAX_LIST_PAGES = 5000

// ------------------------------------------------------------ Worker client

// call(): retried, throws OpsError('worker-request-failed') at the end.
// probe(): one attempt, never throws -- for health polling.
export function workerClient({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15 * 60 * 1000, attempts = 3, pause = sleep }) {
  async function once(method, route, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${baseUrl}${route}`, {
        method,
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* an HTML error page */ }
      return { status: res.status, json }
    } catch (err) {
      return { status: 0, json: null, error: err && err.name === 'AbortError' ? 'timed-out' : 'network' }
    } finally {
      clearTimeout(timer)
    }
  }
  async function call(method, route, body) {
    let last = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const r = await once(method, route, body)
      if (r.status === 200 && r.json) return r.json
      last = { status: r.status, error: r.error || (r.json && r.json.error) || 'not-json', message: r.json && r.json.message }
      if ([400, 401, 404, 413].includes(r.status)) break // not transient
      if (attempt < attempts) await pause(2000 * attempt)
    }
    throw new OpsError('worker-request-failed', `${method} ${route} failed.`, last)
  }
  return { call, probe: once }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next
      next += 1
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(lanes)
  return results
}

export async function listAll(client, bucket) {
  const objects = []
  const cursors = new Set()
  let cursor = null
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const r = await client.call('POST', '/list', { bucket, cursor, limit: 1000 })
    if (!r || !Array.isArray(r.objects)) throw new OpsError('bad-list-response', `The ${bucket} listing was malformed.`)
    objects.push(...r.objects)
    if (!r.truncated) return objects
    if (typeof r.cursor !== 'string' || !r.cursor || cursors.has(r.cursor)) throw new OpsError('list-cursor-loop', `The ${bucket} listing cursor did not advance.`)
    cursors.add(r.cursor)
    cursor = r.cursor
  }
  throw new OpsError('list-too-many-pages', `The ${bucket} listing did not end.`)
}

async function copyBatch(client, items, { topup = false } = {}) {
  const body = {
    items: items.map((i) => (i.force && !topup ? { key: i.key, expectEtag: i.expectEtag, force: true } : { key: i.key, expectEtag: i.expectEtag })),
    // Before the switch the source is authoritative: a destination object
    // that differs is an older copy of it.
    allowOverwrite: true,
  }
  // After the switch the live app writes the destination: the Worker may
  // replace only a destination object OLDER than the source one.
  if (topup) body.keepNewerDestination = true
  try {
    const results = matchResults(items, await client.call('POST', '/copy', body))
    if (results) return results
    return items.map((i) => ({ key: i.key, outcome: 'failed', reason: 'bad-response' }))
  } catch (err) {
    return items.map((i) => ({ key: i.key, outcome: 'failed', reason: err.code || 'request-failed', detail: err.detail }))
  }
}

async function verifyKeys(client, c, keys, concurrency) {
  const items = keys.map((key) => ({ key, size: c.src.get(key).size }))
  const groups = batches(items, { maxItems: MAX_KEYS_PER_VERIFY, maxBytes: MAX_BYTES_PER_VERIFY })
  await mapLimit(groups, concurrency, async (group) => {
    let results = null
    try {
      results = matchResults(group, await client.call('POST', '/verify', { keys: group.map((g) => g.key) }))
    } catch { /* recorded as unresolved below */ }
    applyVerifyResults(c, results || group.map((g) => ({ key: g.key, outcome: 'failed' })))
  })
}

// ---------------------------------------------------------------- the job

// Talks only through `client` (the Worker) and `api` (Cloudflare REST), so
// the test drives it end to end against the real Worker code.
// onProgress(done, total) is told after each copy request (counts only).
export async function runJob({ mode, client, api, accountId, concurrency = 4, onProgress = () => {} }) {
  if (!MODES.includes(mode)) throw new OpsError('bad-mode', 'mode must be copy, verify-only or topup.')
  const out = { mode, ok: false, problems: [], counts: {}, details: {} }

  out.production = await productionAssetsState(api, accountId)
  if (mode === 'copy' && out.production.state !== 'source') {
    out.problems.push('production-not-on-source')
    return out
  }
  if (mode === 'topup' && out.production.state !== 'destination') {
    out.problems.push('production-not-on-destination')
    return out
  }

  const health = await client.call('GET', '/health')
  const caps = (health && health.capabilities) || {}
  out.capabilities = caps
  if (caps.digestStreamMd5 !== true || caps.fixedLengthStream !== true) {
    out.problems.push('worker-capability-missing')
    return out
  }

  const sourceObjects = await listAll(client, 'source')
  const destObjects = await listAll(client, 'destination')
  const c = classify(sourceObjects, destObjects)
  const src = listingTotals(sourceObjects)
  const dst = listingTotals(destObjects)
  Object.assign(out.counts, { sourceObjects: src.objects, sourceBytes: src.bytes, destObjects: dst.objects, destBytes: dst.bytes })
  out.metadataObserved = metadataObserved(sourceObjects)
  if (!src.objects) out.problems.push('source-listing-empty')
  if (!out.metadataObserved) out.problems.push('listing-without-metadata')
  if (out.problems.length) return out

  // Multipart objects have no MD5 in their etag: stream both sides.
  await verifyKeys(client, c, keysWithStatus(c, 'unverified'), concurrency)

  if (mode === 'verify-only') {
    const v = verifyVerdict(c, { sourceObjects, destObjects })
    Object.assign(out.counts, v.counts)
    out.problems.push(...v.problems)
    out.details = {
      differences: [...c.status.entries()].filter(([, s]) => s !== 'identical').map(([key, status]) => ({ key, status, diffs: c.diffs.get(key) || [] })),
      destinationOnly: c.destinationOnly,
      orderInversions: v.inversions,
    }
    out.ok = out.problems.length === 0
    return out
  }

  if (mode === 'topup') return topupJob({ out, client, c, sourceObjects, concurrency, onProgress })

  // ------------------------------------------------------------- copy
  const plan = planCopy(c)
  Object.assign(out.counts, {
    planCopy: plan.regular.length,
    planOrdered: plan.ordered.length,
    planSkipped: plan.skipped,
    planPrune: plan.prune.length,
  })
  const tally = emptyCopyTally()
  const results = []
  const regular = batches(plan.regular, { maxItems: MAX_ITEMS_PER_COPY, maxBytes: MAX_BYTES_PER_COPY })
  const requests = regular.length + plan.ordered.length
  let done = 0
  const tick = (value) => {
    done += 1
    onProgress(done, requests)
    return value
  }
  for (const batchResults of await mapLimit(regular, concurrency, async (items) => tick(await copyBatch(client, items)))) results.push(...batchResults)
  // Backup keys: one at a time, oldest first, so `uploaded` keeps the order.
  for (const item of plan.ordered) results.push(...tick(await copyBatch(client, [item])))
  tallyCopy(results, tally)
  Object.assign(out.counts, tally)
  out.counts.skippedIdentical = plan.skipped + tally.skippedIdentical

  // Prune only while production still reads the source: re-check right
  // before deleting anything from the destination.
  const vanished = results.filter((r) => r.outcome === 'source-missing').map((r) => r.key)
  const pruneKeys = [...new Set([...plan.prune, ...vanished])]
  let prune = { pruned: 0, keptSourcePresent: 0, alreadyAbsent: 0, failed: 0 }
  const pruneResults = []
  if (pruneKeys.length) {
    out.productionBeforePrune = await productionAssetsState(api, accountId)
    if (out.productionBeforePrune.state !== 'source') {
      out.problems.push('production-changed-during-run')
    } else {
      for (const group of batches(pruneKeys.map((key) => ({ key })), { maxItems: MAX_KEYS_PER_PRUNE })) {
        let r = null
        try {
          r = matchResults(group, await client.call('POST', '/prune', { keys: group.map((g) => g.key), confirm: 'destination-only' }))
        } catch { /* counted as failed */ }
        pruneResults.push(...(r || group.map((g) => ({ key: g.key, outcome: 'failed' }))))
      }
      prune = tallyPrune(pruneResults)
    }
  }
  out.counts.pruned = prune.pruned
  out.counts.pruneFailed = prune.failed

  // End-to-end check on a fresh destination listing: every source key that
  // still exists is there, and the backup order matches the source's.
  const after = indexByKey(await listAll(client, 'destination'), 'destination')
  const vanishedSet = new Set(vanished)
  const missingAfter = [...c.src.keys()].filter((k) => c.status.get(k) !== 'vanished' && !vanishedSet.has(k) && !after.has(k))
  const inversions = orderInversions(sourceObjects, after)
  out.counts.missingAfter = missingAfter.length
  out.counts.orderInversions = inversions.length

  if (tally.mismatched) out.problems.push('mismatched')
  if (tally.failed) out.problems.push('failed')
  if (tally.conflicts) out.problems.push('conflicts')
  if (prune.failed) out.problems.push('prune-failed')
  if (missingAfter.length) out.problems.push('missing-after-copy')
  if (inversions.length) out.problems.push('backup-order-differs')

  out.details = {
    notCopied: results.filter((r) => !['copied', 'overwritten', 'rewritten', 'skipped-identical'].includes(r.outcome)),
    sourceChanged: results.filter((r) => r.sourceChanged).map((r) => r.key),
    ordered: plan.ordered.map((i) => i.key),
    prune: pruneResults,
    missingAfter,
    orderInversions: inversions,
  }
  out.ok = out.problems.length === 0
  return out
}

// ------------------------------------------------------------ topup
// After the switch. Writes only keys missing in the destination or whose
// destination copy is older than the source object; never prunes, never
// deletes, never calls /prune; the source stays read-only as always.
async function topupJob({ out, client, c, sourceObjects, concurrency, onProgress }) {
  const plan = planTopup(c)
  Object.assign(out.counts, {
    planCopy: plan.regular.length,
    planOrdered: plan.ordered.length,
    planSkipped: plan.skipped,
    planKeptNewer: plan.keptNewer.length,
    heldBackups: plan.heldBackups.length,
    unresolved: plan.unresolved.length,
    destinationOnly: plan.destinationOnly,
  })
  const tally = emptyCopyTally()
  const results = []
  const regular = batches(plan.regular, { maxItems: MAX_ITEMS_PER_COPY, maxBytes: MAX_BYTES_PER_COPY })
  const requests = regular.length + plan.ordered.length
  let done = 0
  const tick = (value) => {
    done += 1
    onProgress(done, requests)
    return value
  }
  for (const batchResults of await mapLimit(regular, concurrency, async (items) => tick(await copyBatch(client, items, { topup: true })))) results.push(...batchResults)
  for (const item of plan.ordered) results.push(...tick(await copyBatch(client, [item], { topup: true })))
  tallyCopy(results, tally)
  Object.assign(out.counts, tally)
  out.counts.skippedIdentical = plan.skipped + tally.skippedIdentical
  out.counts.conflicts = plan.keptNewer.length + tally.keptNewer + tally.conflicts
  out.counts.vanished = plan.vanished + tally.vanished

  // Fresh destination listing: every key written is there. Keys that were in
  // the destination before and are gone now were deleted by the live app (its
  // own backup rotation, for example): this run deletes nothing, so they are
  // counted for the owner, not failed on.
  const after = indexByKey(await listAll(client, 'destination'), 'destination')
  const written = results.filter((r) => ['copied', 'overwritten'].includes(r.outcome)).map((r) => r.key)
  const missingAfter = written.filter((k) => !after.has(k))
  const lost = [...c.dst.keys()].filter((k) => !after.has(k))
  const inversions = orderInversions(sourceObjects, after)
  out.counts.missingAfter = missingAfter.length
  out.counts.destinationLost = lost.length
  out.counts.orderInversions = inversions.length

  if (plan.unresolved.length) out.problems.push('objects-unresolved')
  if (tally.mismatched) out.problems.push('mismatched')
  if (tally.failed) out.problems.push('failed')
  if (missingAfter.length) out.problems.push('missing-after-copy')
  if (inversions.length) out.problems.push('backup-order-differs')

  out.details = {
    written,
    keptNewer: [...plan.keptNewer, ...results.filter((r) => r.outcome === 'kept-newer-destination').map((r) => r.key)],
    heldBackups: plan.heldBackups,
    unresolved: plan.unresolved,
    notCopied: results.filter((r) => !['copied', 'overwritten', 'skipped-identical', 'kept-newer-destination'].includes(r.outcome)),
    sourceChanged: results.filter((r) => r.sourceChanged).map((r) => r.key),
    missingAfter,
    destinationLost: lost,
    orderInversions: inversions,
  }
  out.ok = out.problems.length === 0
  return out
}

// ------------------------------------------------------- public log lines

export function runLines(result) {
  const n = (k) => (Number.isFinite(result.counts[k]) ? result.counts[k] : 0)
  const lines = [['mode: {mode}', { mode: result.mode }]]
  if (result.production) lines.push(['production ASSETS binding: {state}', { state: result.production.state }])
  if (result.capabilities) {
    lines.push(['worker capabilities (streamed MD5, fixed-length stream): {verdict}', {
      verdict: result.capabilities.digestStreamMd5 === true && result.capabilities.fixedLengthStream === true ? 'PASS' : 'FAIL',
    }])
  }
  if ('sourceObjects' in result.counts) {
    lines.push(['listed source: {objects} objects, {bytes} bytes', { objects: n('sourceObjects'), bytes: n('sourceBytes') }])
    lines.push(['listed destination: {objects} objects, {bytes} bytes', { objects: n('destObjects'), bytes: n('destBytes') }])
    lines.push(['listing carries metadata: {seen}', { seen: Boolean(result.metadataObserved) }])
  }
  if (result.mode === 'copy' && 'planCopy' in result.counts) {
    lines.push(['plan: {copy} to copy, {ordered} backup keys in order, {skipped} already identical, {prune} destination-only', {
      copy: n('planCopy'), ordered: n('planOrdered'), skipped: n('planSkipped'), prune: n('planPrune'),
    }])
    lines.push(['copied: {copied}, overwritten: {overwritten}, rewritten for backup order: {rewritten}', {
      copied: n('copied'), overwritten: n('overwritten'), rewritten: n('rewritten'),
    }])
    lines.push(['skipped-identical: {skipped}', { skipped: n('skippedIdentical') }])
    lines.push(['bytes copied: {bytes}', { bytes: n('bytes') }])
    lines.push(['changed during the run: {changed}, gone from the source during the run: {vanished}', { changed: n('sourceChanged'), vanished: n('vanished') }])
    lines.push(['mismatched: {mismatched}, failed: {failed}, conflicts: {conflicts}', { mismatched: n('mismatched'), failed: n('failed'), conflicts: n('conflicts') }])
    lines.push(['pruned from the destination: {pruned}, prune failures: {failed}', { pruned: n('pruned'), failed: n('pruneFailed') }])
    lines.push(['after the copy: {missing} missing, {inversions} backup order inversions', { missing: n('missingAfter'), inversions: n('orderInversions') }])
  }
  if (result.mode === 'topup' && 'planCopy' in result.counts) {
    lines.push(['plan: {copy} missing or older in the destination, {ordered} backup keys in order, {skipped} already identical', {
      copy: n('planCopy'), ordered: n('planOrdered'), skipped: n('planSkipped'),
    }])
    lines.push(['copied: {copied}, overwritten older destination copies: {overwritten}', { copied: n('copied'), overwritten: n('overwritten') }])
    lines.push(['skipped-identical: {skipped}', { skipped: n('skippedIdentical') }])
    lines.push(['conflicts (destination newer or changed, left alone): {conflicts}', { conflicts: n('conflicts') }])
    lines.push(['backup keys held to keep the backup order: {held}, unresolved: {unresolved}', { held: n('heldBackups'), unresolved: n('unresolved') }])
    lines.push(['bytes copied: {bytes}', { bytes: n('bytes') }])
    lines.push(['changed during the run: {changed}, gone from the source: {vanished}', { changed: n('sourceChanged'), vanished: n('vanished') }])
    lines.push(['mismatched: {mismatched}, failed: {failed}', { mismatched: n('mismatched'), failed: n('failed') }])
    lines.push(['destination-only objects (never touched): {extra}, gone from the destination during the run (deleted by the app): {lost}', {
      extra: n('destinationOnly'), lost: n('destinationLost'),
    }])
    lines.push(['after the top-up: {missing} written keys missing, {inversions} backup order inversions', { missing: n('missingAfter'), inversions: n('orderInversions') }])
  }
  if (result.mode === 'verify-only' && 'identical' in result.counts) {
    lines.push(['identical: {identical}, different: {different}, missing in destination: {missing}', {
      identical: n('identical'), different: n('different'), missing: n('missing'),
    }])
    lines.push(['destination-only: {extra}, unresolved: {unresolved}, gone from the source: {vanished}', {
      extra: n('destinationOnly'), unresolved: n('unresolved'), vanished: n('vanished'),
    }])
    lines.push(['backup order inversions: {inversions}', { inversions: n('orderInversions') }])
  }
  for (const problem of result.problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  return lines
}

function emit(lines) {
  for (const [template, values] of lines) {
    say(template, values)
    summary(template, values)
  }
}

// --------------------------------------------------------- the commands

function readWorkerToml() {
  return parseWorkerToml(fs.readFileSync(WORKER_TOML, 'utf8'))
}

// Tolerates CRLF: the Windows runner checks files out with autocrlf.
export function parseWorkerToml(text) {
  const account = /^account_id\s*=\s*"([0-9a-f]{32})"\s*$/m.exec(text)
  const bindings = [...text.matchAll(/\[\[r2_buckets\]\]\s*\nbinding\s*=\s*"([A-Z_]+)"\s*\nbucket_name\s*=\s*"([a-z0-9-]+)"/g)].map((m) => [m[1], m[2]])
  return { accountId: account ? account[1] : null, bindings }
}

// The Worker must deploy into the account the API calls target, bound to
// exactly these two buckets.
export function checkWorkerConfig(accountId, toml = readWorkerToml()) {
  if (!toml.accountId || toml.accountId !== String(accountId).trim()) throw new OpsError('account-mismatch', 'CLOUDFLARE_ACCOUNT_ID does not match the copy Worker config.')
  const want = JSON.stringify([['SOURCE', SOURCE_BUCKET], ['DESTINATION', DEST_BUCKET]])
  if (JSON.stringify(toml.bindings) !== want) throw new OpsError('worker-config-mismatch', 'The copy Worker is not bound to exactly the two buckets.')
}

function api(method, pathname) {
  return cfApi(method, pathname)
}

function scrub(text, secret) {
  return truncate(String(text || '').split(secret).join('[redacted]'), 20000)
}

async function workerUrl(accountId) {
  const r = await api('GET', `/accounts/${accountId}/workers/subdomain`)
  const sub = r && r.ok && r.json && r.json.result ? r.json.result.subdomain : null
  if (typeof sub !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(sub)) {
    throw new OpsError('workers-dev-subdomain-missing', 'The account has no workers.dev subdomain.', { status: r && r.status, codes: apiErrorCodes(r) })
  }
  return `https://${COPY_WORKER}.${sub}.workers.dev`
}

async function deployWorker(copyToken, report) {
  const config = ['--config', WORKER_TOML]
  const d = await runWrangler(['deploy', ...config], { cwd: WORKER_DIR, timeoutMs: 5 * 60 * 1000 })
  report.deploy = { exitCode: d.code, timedOut: d.timedOut, stdout: scrub(d.stdout, copyToken), stderr: scrub(d.stderr, copyToken) }
  if (d.code !== 0 || d.timedOut) {
    throw new OpsError('worker-deploy-failed', 'wrangler deploy failed.', { codes: cloudflareErrorCodes(`${d.stdout}\n${d.stderr}`) })
  }
  // The value goes in on stdin and never onto a command line or a log.
  const s = await runWrangler(['secret', 'put', 'COPY_TOKEN', ...config], { cwd: WORKER_DIR, input: copyToken, timeoutMs: 2 * 60 * 1000 })
  report.secret = { exitCode: s.code, timedOut: s.timedOut, stdout: scrub(s.stdout, copyToken), stderr: scrub(s.stderr, copyToken) }
  if (s.code !== 0 || s.timedOut) {
    throw new OpsError('worker-secret-failed', 'wrangler secret put failed.', { codes: cloudflareErrorCodes(`${s.stdout}\n${s.stderr}`) })
  }
}

// A new workers.dev Worker (and its secret) can take a while to answer.
export async function waitForHealth(client, { deadlineMs = 180000, intervalMs = 5000, pause = sleep, now = Date.now } = {}) {
  const start = now()
  const seen = []
  for (;;) {
    const r = await client.probe('GET', '/health')
    if (r.status === 200 && r.json && r.json.ok === true) return { polls: seen.length + 1 }
    seen.push(r.status)
    if (now() - start >= deadlineMs) throw new OpsError('worker-not-reachable', 'The copy Worker never answered /health.', { statuses: seen.slice(-10) })
    await pause(intervalMs)
  }
}

async function cmdRun() {
  const mode = String(process.env.OPS_R2_MODE || 'copy').trim()
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID').trim()
  const report = { kind: 'r2-apac-copy', mode, commit: commitId(), runId: runId(), startedAt: new Date().toISOString() }
  let result = { mode: MODES.includes(mode) ? mode : 'unknown', ok: false, problems: [], counts: {} }
  try {
    if (!MODES.includes(mode)) throw new OpsError('bad-mode', 'OPS_R2_MODE must be copy, verify-only or topup.')
    checkWorkerConfig(accountId)
    // Refuse a post-switch copy, or a pre-switch top-up, before deploying anything.
    const preflight = await productionAssetsState(api, accountId)
    report.preflight = preflight
    if (mode === 'copy' && preflight.state !== 'source') {
      result.production = preflight
      throw new OpsError('production-not-on-source', 'Production no longer reads the source bucket; copy refused.')
    }
    if (mode === 'topup' && preflight.state !== 'destination') {
      result.production = preflight
      throw new OpsError('production-not-on-destination', 'Production does not read the destination bucket yet; topup refused.')
    }
    const baseUrl = await workerUrl(accountId)
    const copyToken = randomToken(32)
    await deployWorker(copyToken, report)
    const client = workerClient({ baseUrl, token: copyToken })
    report.health = await waitForHealth(client)
    let lastProgress = Date.now()
    const onProgress = (done, total) => {
      if (done !== total && Date.now() - lastProgress < 30000) return
      lastProgress = Date.now()
      say('progress: {done} of {total} copy requests done', { done, total })
    }
    result = await runJob({ mode, client, api, accountId, onProgress })
  } catch (err) {
    report.error = errorRecord(err)
    result.problems.push(err instanceof OpsError ? err.code : 'internal-error')
    result.ok = false
  }
  report.finishedAt = new Date().toISOString()
  report.result = result
  const lines = runLines(result)
  try {
    const file = writeEncryptedReport(outDir, `r2-apac-copy-${result.mode}-${report.runId}`, report, {
      kind: 'r2-apac-copy', mode: result.mode, commit: report.commit, runId: report.runId, createdAt: report.finishedAt,
    })
    lines.push(['encrypted report: {bytes} bytes', { bytes: file.bytes }])
  } catch (err) {
    lines.push(['problem: {code}', { code: new OpsError('report-not-written') }])
    result.ok = false
  }
  lines.push(['r2-apac-copy verdict: {verdict}', { verdict: result.ok ? 'PASS' : 'FAIL' }])
  emit(lines)
  return result.ok ? 0 : 1
}

async function bucketInfo(apiImpl, accountId, name) {
  const r = await apiImpl('GET', `/accounts/${accountId}/r2/buckets/${name}`)
  if (r && r.ok && r.json && r.json.result) return { present: true, location: normalizeLocation(r.json.result.location), status: r.status }
  const missing = r && (r.status === 404 || apiErrorCodes(r).includes(10006))
  return { present: false, missing: Boolean(missing), status: r && r.status, codes: apiErrorCodes(r) }
}

// The bucket step: reads both buckets and, in copy mode ONLY, creates a
// missing destination in apac. verify-only and topup create nothing, so there a
// missing destination just fails the step. create() runs `wrangler r2 bucket
// create` and resolves to { code, timedOut, stdout, stderr }.
export async function checkBuckets({ api: apiImpl, accountId, mode, create, pause = sleep }) {
  const out = { problems: [], created: false }
  out.source = await bucketInfo(apiImpl, accountId, SOURCE_BUCKET)
  if (!out.source.present) out.problems.push('source-bucket-unreadable')
  let dest = await bucketInfo(apiImpl, accountId, DEST_BUCKET)
  if (mode === 'copy' && !out.problems.length && !dest.present && dest.missing) {
    const r = await create()
    out.create = { exitCode: r.code, timedOut: r.timedOut, stdout: truncate(r.stdout, 20000), stderr: truncate(r.stderr, 20000) }
    if (r.code !== 0 || r.timedOut) out.problems.push('destination-create-failed')
    else out.created = true
    for (let i = 0; out.created && i < 6; i += 1) {
      dest = await bucketInfo(apiImpl, accountId, DEST_BUCKET)
      if (dest.present) break
      await pause(5000)
    }
  }
  out.destination = { ...dest, created: out.created }
  if (!dest.present && !out.problems.length) {
    if (dest.missing && mode !== 'copy') out.problems.push('destination-bucket-missing')
    else out.problems.push('destination-bucket-unreadable')
  }
  if (dest.present && dest.location !== DEST_LOCATION) out.problems.push('destination-not-apac')
  return out
}

async function cmdBuckets() {
  const mode = String(process.env.OPS_R2_MODE || 'copy').trim()
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID').trim()
  const report = { kind: 'r2-apac-copy-buckets', mode, commit: commitId(), runId: runId(), startedAt: new Date().toISOString() }
  let problems = []
  const lines = []
  try {
    if (!MODES.includes(mode)) throw new OpsError('bad-mode', 'OPS_R2_MODE must be copy, verify-only or topup.')
    const create = async () => {
      // From an empty directory, so wrangler finds no config to edit.
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-r2-create-'))
      try {
        return await runWrangler(['r2', 'bucket', 'create', DEST_BUCKET, '--location', DEST_LOCATION], { cwd: empty, timeoutMs: 2 * 60 * 1000 })
      } finally {
        fs.rmSync(empty, { recursive: true, force: true })
      }
    }
    const b = await checkBuckets({ api, accountId, mode, create })
    Object.assign(report, { source: b.source, destination: b.destination, create: b.create })
    problems = b.problems
    lines.push(['source bucket: {presence}, location {location}', { presence: b.source.present ? 'present' : 'absent', location: b.source.present ? b.source.location : 'unknown' }])
    lines.push(['destination bucket: {presence}, newly created: {created}, location {location}', {
      presence: b.destination.present ? 'present' : 'absent', created: b.created, location: b.destination.present ? b.destination.location : 'unknown',
    }])
  } catch (err) {
    report.error = errorRecord(err)
    problems.push(err instanceof OpsError ? err.code : 'internal-error')
  }
  report.problems = problems
  report.finishedAt = new Date().toISOString()
  for (const problem of problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  const file = writeEncryptedReport(outDir, `r2-apac-copy-buckets-${report.runId}`, report, {
    kind: 'r2-apac-copy-buckets', commit: report.commit, runId: report.runId, createdAt: report.finishedAt,
  })
  lines.push(['encrypted report: {bytes} bytes', { bytes: file.bytes }])
  lines.push(['bucket check verdict: {verdict}', { verdict: problems.length ? 'FAIL' : 'PASS' }])
  emit(lines)
  return problems.length ? 1 : 0
}

// Deletes the temporary Worker and proves it is gone (a delete can take a
// moment to show, so the check is repeated a few times).
export async function deleteCopyWorker(apiImpl, accountId, { checks = 4, pause = sleep } = {}) {
  const base = `/accounts/${accountId}/workers/scripts/${COPY_WORKER}`
  const del = await apiImpl('DELETE', `${base}?force=true`)
  const deleted = del && del.ok ? 'deleted' : del && del.status === 404 ? 'already-absent' : 'unknown'
  let check = null
  for (let i = 0; i < checks; i += 1) {
    check = await apiImpl('GET', `${base}/settings`)
    if (check && check.status === 404) break
    if (i + 1 < checks) await pause(3000)
  }
  const after = check && check.status === 404 ? 'absent' : check && check.ok ? 'still-present' : 'unknown'
  return {
    deleted,
    after,
    ok: after === 'absent', // the end state is what matters
    detail: { deleteStatus: del && del.status, deleteCodes: apiErrorCodes(del), checkStatus: check && check.status },
  }
}

async function cmdDeleteWorker() {
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID').trim()
  const report = { kind: 'r2-apac-copy-delete-worker', commit: commitId(), runId: runId(), startedAt: new Date().toISOString() }
  let r
  try {
    r = await deleteCopyWorker(api, accountId)
  } catch (err) {
    report.error = errorRecord(err)
    r = { deleted: 'unknown', after: 'unknown', ok: false }
  }
  report.result = r
  report.finishedAt = new Date().toISOString()
  const lines = [
    ['temporary worker delete: {deleted}', { deleted: r.deleted }],
    ['temporary worker now: {after}', { after: r.after }],
  ]
  const file = writeEncryptedReport(outDir, `r2-apac-copy-delete-worker-${report.runId}`, report, {
    kind: 'r2-apac-copy-delete-worker', commit: report.commit, runId: report.runId, createdAt: report.finishedAt,
  })
  lines.push(['encrypted report: {bytes} bytes', { bytes: file.bytes }])
  lines.push(['delete-worker verdict: {verdict}', { verdict: r.ok ? 'PASS' : 'FAIL' }])
  emit(lines)
  return r.ok ? 0 : 1
}

const COMMANDS = { buckets: cmdBuckets, run: cmdRun, 'delete-worker': cmdDeleteWorker }

if (isMain(import.meta.url)) {
  runMain(() => {
    const command = COMMANDS[process.argv[2]]
    if (!command) throw new OpsError('bad-command', 'Usage: ops-r2.mjs buckets | run | delete-worker')
    return command()
  })
}
