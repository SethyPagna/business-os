#!/usr/bin/env node
// secret-names job of .github/workflows/ops.yml: which of the secrets the app
// reads the production Worker actually has -- NAMES and binding types only.
// Cloudflare's API never returns a secret's value; this script never asks for
// one, and keeps only { name, type } of every entry it reads (a plain-text
// var's value is dropped on arrival).
//
//   OPS_OUT_DIR  where secret-names-<run>.enc.json is written
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
//
// Reads, with GET only, for the Worker business-os:
//   .../workers/scripts/business-os/secrets        what `wrangler secret list` shows
//   .../workers/scripts/business-os/deployments    the newest deployment, then
//   .../workers/scripts/business-os/versions/<id>  the bindings of each version
//                                                  carrying traffic
//
// Public log: for each name in EXPECTED_SECRETS (a constant of this public
// repository) how the live versions bind it -- secret, plain-text,
// other-type, absent, mixed (the live versions differ) or unknown -- and
// whether the secret list shows it; how many OTHER secret names exist (the
// names themselves go only into the encrypted file); PASS when every read
// succeeded and saw the ASSETS binding (the positive control).

import {
  OpsError, PRODUCTION_WORKER, apiErrorCodes, cfApi, commitId, isMain, liveVersionBindings, publicToken,
  requireEnv, runId, runMain, say, summary, writeEncryptedReport,
} from './ops-common.mjs'

// The names the app reads (cloudflare/src). GOOGLE_LOGIN_CLIENT_ID and
// GOOGLE_DRIVE_CLIENT_ID are [vars] in cloudflare/wrangler.toml, so they are
// expected to read plain-text, not secret.
export const EXPECTED_SECRETS = Object.freeze([
  'APP_ENCRYPTION_KEY',
  'AUTH_SESSION_SECRET',
  'OAUTH_STATE_SECRET',
  'GOOGLE_LOGIN_CLIENT_ID',
  'GOOGLE_LOGIN_CLIENT_SECRET',
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
])

// Every production version binds ASSETS to an R2 bucket. A version read that
// does not show it observed nothing, and its "absent" answers would mean
// nothing either.
export const CONTROL_BINDING = 'ASSETS'

const ACCOUNT_ID = /^[0-9a-f]{32}$/

// Only { name, type } survives.
function slim(entries) {
  return entries
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => ({ name: e.name, type: typeof e.type === 'string' ? e.type : null }))
}

const isSecretType = (type) => /^secret/.test(String(type || ''))

// How one version's (slimmed) bindings bind `name`.
export function bindingKind(bindings, name) {
  const found = bindings.filter((b) => b.name === name)
  if (!found.length) return 'absent'
  if (found.length === 1 && found[0].type === 'secret_text') return 'secret'
  if (found.length === 1 && found[0].type === 'plain_text') return 'plain-text'
  return 'other-type'
}

// api(method, path) -> { ok, status, json } (ops-common cfApi, or a fake).
export async function readSecretNames(api, accountId) {
  if (!ACCOUNT_ID.test(String(accountId))) throw new OpsError('bad-account-id', 'CLOUDFLARE_ACCOUNT_ID is not a 32-character hex id.')
  const problems = []
  const base = `/accounts/${accountId}/workers/scripts/${PRODUCTION_WORKER}`

  const list = await api('GET', `${base}/secrets`)
  const listed = list && list.ok && list.json && Array.isArray(list.json.result) ? slim(list.json.result) : null
  if (!listed) problems.push('secret-list-unreadable')

  const live = await liveVersionBindings(api, accountId, PRODUCTION_WORKER)
  if (!live.ok) problems.push('live-versions-unreadable')
  const versions = (live.ok ? live.versions : []).map((v) => {
    const all = slim(v.bindings)
    return {
      versionId: v.versionId,
      percentage: v.percentage,
      observed: all.some((b) => b.name === CONTROL_BINDING && b.type === 'r2_bucket'),
      bindings: all.filter((b) => EXPECTED_SECRETS.includes(b.name) || isSecretType(b.type)),
    }
  })
  if (versions.some((v) => !v.observed)) problems.push('bindings-not-observed')
  const liveKnown = live.ok && versions.every((v) => v.observed)

  const expected = {}
  let disagreements = 0
  for (const name of EXPECTED_SECRETS) {
    const kinds = versions.map((v) => bindingKind(v.bindings, name))
    const liveStatus = !liveKnown ? 'unknown' : kinds.every((k) => k === kinds[0]) ? kinds[0] : 'mixed'
    const listedStatus = !listed ? 'unknown' : listed.some((s) => s.name === name) ? 'present' : 'absent'
    if (liveStatus !== 'unknown' && listedStatus !== 'unknown' && (liveStatus === 'secret') !== (listedStatus === 'present')) disagreements += 1
    expected[name] = { live: liveStatus, listed: listedStatus }
  }

  const others = new Set()
  for (const s of listed || []) if (!EXPECTED_SECRETS.includes(s.name)) others.add(s.name)
  for (const v of versions) for (const b of v.bindings) if (isSecretType(b.type) && !EXPECTED_SECRETS.includes(b.name)) others.add(b.name)

  return {
    ok: problems.length === 0,
    problems,
    expected,
    secretsInEveryLiveVersion: EXPECTED_SECRETS.filter((name) => expected[name].live === 'secret').length,
    otherSecretNames: [...others].sort(),
    disagreements,
    liveVersionCount: versions.length,
    secretList: { status: list ? list.status : null, errorCodes: apiErrorCodes(list), entries: listed },
    liveVersions: versions,
    liveFailure: live.ok ? null : { reason: live.reason, detail: live.detail },
  }
}

// Pure: the only lines the public log may show.
export function publicLines({ result, bytes }) {
  const lines = [['secret-names: the production Worker, names and binding types only', {}]]
  for (const name of EXPECTED_SECRETS) {
    lines.push(['{name}: live versions {live}, secret list {listed}', { name: publicToken(name), live: result.expected[name].live, listed: result.expected[name].listed }])
  }
  lines.push(['live versions read: {n}', { n: result.liveVersionCount }])
  lines.push(['bound as a secret in every live version: {n} of {total}', { n: result.secretsInEveryLiveVersion, total: EXPECTED_SECRETS.length }])
  lines.push(['other secret names: {n} (the names are in the encrypted file)', { n: result.otherSecretNames.length }])
  lines.push(['names the live versions and the secret list disagree on: {n}', { n: result.disagreements }])
  for (const problem of result.problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  if (bytes !== undefined) lines.push(['encrypted file: {bytes} bytes', { bytes }])
  lines.push(['secret-names verdict: {verdict}', { verdict: result.ok ? 'PASS' : 'FAIL' }])
  return lines
}

async function main() {
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')
  const startedAt = new Date().toISOString()
  const commit = commitId()
  const run = runId()

  const result = await readSecretNames((method, p) => cfApi(method, p), accountId)

  const payload = {
    kind: 'secret-names',
    worker: PRODUCTION_WORKER,
    commit,
    runId: run,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...result,
  }
  const report = writeEncryptedReport(outDir, `secret-names-${run}`, payload, {
    kind: 'secret-names', name: PRODUCTION_WORKER, commit, runId: run, createdAt: payload.finishedAt,
  })
  for (const [template, values] of publicLines({ result, bytes: report.bytes })) {
    say(template, values)
    summary(template, values)
  }
  return result.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
