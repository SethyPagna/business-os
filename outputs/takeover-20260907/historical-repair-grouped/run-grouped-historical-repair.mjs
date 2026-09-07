#!/usr/bin/env node

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXPECTED_ACCOUNT_ID,
  EXPECTED_DATABASE_ID,
  applyAllPending,
  assert,
  recoverGroup,
  summarizeManifest,
  validateManifest,
} from './grouped-repair-core.mjs'

const operatorDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(operatorDir, '../../..')
const operatorConfigPath = join(operatorDir, 'operator-wrangler.toml')

// These two values must be replaced in a separately reviewed commit after the
// post-UI-merge census builds the final manifest. Null makes every write mode
// fail before a remote binding is opened.
export const REVIEWED_MANIFEST_SHA256 = null
export const REVIEWED_SOURCE_LINEAGE_COMMIT = null

const expectedOperatorConfig = `name = "business-os-grouped-historical-repair-operator"
main = "run-grouped-historical-repair.mjs"
compatibility_date = "2026-09-07"
account_id = "${EXPECTED_ACCOUNT_ID}"

# Execution-only remote binding. Review mode never opens this binding.
[[d1_databases]]
binding = "DB"
database_name = "business-os"
database_id = "${EXPECTED_DATABASE_ID}"
remote = true
`

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

export function redactErrorMessage(error, env = process.env) {
  let message = String(error?.message || 'Grouped historical repair operator failed')
  const token = String(env.CLOUDFLARE_API_TOKEN || '')
  if (token) message = message.replaceAll(token, '[redacted]')
  return message.slice(0, 500)
}

export function parseArgs(tokens = process.argv.slice(2)) {
  const flags = new Set(['apply-all', 'identify', 'confirm-reviewed-execution', 'confirm-recovery'])
  const values = new Set(['manifest', 'recover-group', 'confirm-run-id', 'confirm-manifest-sha256', 'confirm-bookmark'])
  const result = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    assert(token.startsWith('--'), `Unexpected argument: ${token}`)
    const key = token.slice(2)
    assert(flags.has(key) || values.has(key), `Unknown option: --${key}`)
    assert(result[key] === undefined, `Duplicate option: --${key}`)
    if (flags.has(key)) result[key] = true
    else {
      const value = tokens[++index]
      assert(value && !value.startsWith('--'), `Missing value for --${key}`)
      result[key] = value
    }
  }
  return result
}

function validateOperatorConfig() {
  const text = readFileSync(operatorConfigPath, 'utf8').replaceAll('\r\n', '\n')
  assert(text === expectedOperatorConfig, 'operator config differs from the exact execution-only remote D1 configuration')
}

export async function verifyCloudflareOperator(env = process.env, fetchImpl = fetch) {
  const token = String(env.CLOUDFLARE_API_TOKEN || '')
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '')
  assert(token, 'CLOUDFLARE_API_TOKEN is missing; use the existing authenticated token wrapper')
  assert(accountId === EXPECTED_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID does not match the reviewed account')
  let response
  try {
    response = await fetchImpl('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${token}` } })
  } catch (_) {
    throw new Error('Cloudflare API token identity verification could not be reached')
  }
  const payload = await response.json().catch(() => null)
  assert(response.ok && payload?.success === true && payload?.result?.status === 'active', 'Cloudflare API token identity verification failed')
  const apiTokenId = String(payload.result.id || '')
  assert(/^[A-Za-z0-9_-]{8,128}$/.test(apiTokenId), 'Cloudflare API token identity response is invalid')
  return { account_id: accountId, api_token_id: apiTokenId }
}

function assertConfirmations(manifest, args, recovery = false) {
  assert(args['confirm-reviewed-execution'] === true, 'write mode requires --confirm-reviewed-execution')
  assert(args['confirm-run-id'] === manifest.execution.run_id, '--confirm-run-id mismatch')
  assert(args['confirm-manifest-sha256'] === manifest.content_sha256, '--confirm-manifest-sha256 mismatch')
  assert(args['confirm-bookmark'] === manifest.execution.time_travel_bookmark, '--confirm-bookmark mismatch')
  if (recovery) assert(args['confirm-recovery'] === true, 'recovery requires --confirm-recovery')
}

async function openRemotePlatform(dependencies) {
  validateOperatorConfig()
  if (dependencies.getPlatformProxy) return dependencies.getPlatformProxy()
  const require = createRequire(join(root, 'cloudflare/package.json'))
  return require('wrangler').getPlatformProxy({ configPath: operatorConfigPath, remoteBindings: true })
}

export async function runOperator(args, dependencies = {}) {
  assert(args.manifest && existsSync(resolve(args.manifest)), '--manifest must name an existing grouped execution manifest')
  const manifest = readJson(resolve(args.manifest))
  validateManifest(manifest)
  const writeMode = args['apply-all'] || args['recover-group']
  assert(!(args['apply-all'] && args['recover-group']), '--apply-all and --recover-group are mutually exclusive')
  if (!writeMode && !args.identify) return { status: 'review_only', ...summarizeManifest(manifest), manifest_pin_present: Boolean(REVIEWED_MANIFEST_SHA256), lineage_pin_present: Boolean(REVIEWED_SOURCE_LINEAGE_COMMIT) }
  if (args.identify) {
    assert(!writeMode, '--identify cannot be combined with a write mode')
    return { status: 'verified_read_only', cloudflare_operator: await (dependencies.verifyOperator || verifyCloudflareOperator)() }
  }

  const reviewedManifestSha256 = dependencies.reviewedManifestSha256 === undefined ? REVIEWED_MANIFEST_SHA256 : dependencies.reviewedManifestSha256
  const reviewedLineageCommit = dependencies.reviewedLineageCommit === undefined ? REVIEWED_SOURCE_LINEAGE_COMMIT : dependencies.reviewedLineageCommit
  validateManifest(manifest, { reviewedManifestSha256, reviewedLineageCommit })
  assertConfirmations(manifest, args, Boolean(args['recover-group']))
  const operator = await (dependencies.verifyOperator || verifyCloudflareOperator)()
  assert(JSON.stringify(operator) === JSON.stringify(manifest.execution.cloudflare_operator), 'active Cloudflare token identity differs from the manifest')
  const platform = await openRemotePlatform(dependencies)
  try {
    const db = platform?.env?.DB
    assert(db?.prepare && db?.batch, 'remote D1 binding is unavailable')
    if (args['apply-all']) return applyAllPending(db, manifest, dependencies.applyDependencies || {})
    const group = manifest.groups.find((item) => item.id === args['recover-group'])
    assert(group, '--recover-group does not name a manifest group')
    return recoverGroup(db, manifest, group, dependencies.recoveryDependencies || {})
  } finally {
    await platform?.dispose?.()
  }
}

async function main() {
  const result = await runOperator(parseArgs())
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'refused_or_failed', error: redactErrorMessage(error) })}\n`)
  process.exitCode = 1
})
