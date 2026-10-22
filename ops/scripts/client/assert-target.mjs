#!/usr/bin/env node
// "Is this run aimed at the client it was started for?" -- asked before any
// workflow step writes anything.
//
// The workflows render cloudflare/wrangler.toml from the GitHub environment's
// variables. This reads that rendered file back and compares it with what the
// environment independently states, so a wrongly rendered or wrongly mapped
// config cannot reach Cloudflare:
//
//   CF_ACCOUNT_ID, D1_MAIN_ID, ADMIN_URL   the environment's variables (all three required)
//   CLOUDFLARE_ACCOUNT_ID                  the account of the secret token; must equal the rendered account
//   PLAN_TIER / --plan <paid|free>         when a plan is given it must be the client's own plan
//   the token itself                       must be able to act in that account (GET /accounts)
//
//   node ops/scripts/client/assert-target.mjs [--config cloudflare/wrangler.toml] [--plan paid] [--no-live]
//
// The public log carries PASS or FAIL and a fixed code per problem, never an id,
// a name or an address.

import fs from 'node:fs'
import path from 'node:path'
import { OpsError, apiErrorCodes, cfApi, codesText, isMain, publicToken, runMain, say, summary, targetLib } from '../ops-common.mjs'

// Pure: the rendered config text + the environment -> fixed problem codes.
export function targetProblems(configText, env, { plan = '' } = {}) {
  let parsed
  try { parsed = targetLib.parseTarget(configText) } catch { return ['rendered-config-unreadable'] }
  const expect = targetLib.expectationsFromEnv(env)
  const raw = targetLib.checkExpectations(parsed, expect, { accountSecret: String(env.CLOUDFLARE_ACCOUNT_ID || '').trim() })
  const codes = [
    [/32 hex/, 'account-id-malformed'], [/is not a UUID/, 'database-id-malformed'],
    [/account id differs/, 'account-differs-from-expected'], [/main database id differs/, 'database-differs-from-expected'],
    [/admin url differs/, 'admin-url-differs-from-expected'], [/secret differs/, 'secret-account-differs-from-rendered'],
  ]
  const compared = raw.map((message) => (codes.find(([re]) => re.test(message)) || [])[1]).filter(Boolean)
  const wantPlan = String(plan || '').trim()
  const planTier = String(env.PLAN_TIER || '').trim()
  let planProblem = []
  if (wantPlan && !['paid', 'free'].includes(wantPlan)) planProblem = ['plan-invalid']
  else if (wantPlan && planTier && wantPlan !== planTier) planProblem = ['plan-differs-from-client-plan']
  else if (wantPlan && !planTier) planProblem = ['client-plan-missing']
  return [...new Set([
    ...(expect.accountId && expect.d1MainId && expect.adminUrl ? [] : ['expectations-missing']),
    ...compared,
    ...(parsed.importDb ? [] : ['import-database-missing']),
    ...planProblem,
  ])]
}

// api(method, path) -> { ok, json } (cfApi, or a test fake): the token can act in the account.
export async function tokenReachesAccount(api, accountId) {
  const res = await api('GET', '/accounts?per_page=50')
  if (!res || !res.ok) return { ok: false, code: 'accounts-unreadable', status: res && res.status, errors: res ? apiErrorCodes(res) : [] }
  const accounts = res.json && Array.isArray(res.json.result) ? res.json.result : []
  return accounts.some((a) => a && a.id === accountId) ? { ok: true } : { ok: false, code: 'token-cannot-act-in-account' }
}

function parseArgs(argv) {
  const out = { config: path.resolve(process.cwd(), 'cloudflare', 'wrangler.toml'), live: true, plan: '' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config') out.config = path.resolve(argv[++i] || '')
    else if (argv[i] === '--plan') out.plan = argv[++i] || ''
    else if (argv[i] === '--no-live') out.live = false
    else throw new OpsError('bad-arguments', 'Unknown argument.')
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let text
  try { text = fs.readFileSync(args.config, 'utf8') } catch { throw new OpsError('rendered-config-missing', 'The Worker config has not been rendered.') }
  const configProblems = targetProblems(text, process.env, { plan: args.plan })
  let live = null
  if (!configProblems.length && args.live) live = await tokenReachesAccount(cfApi, targetLib.parseTarget(text).accountId)
  const problems = live && !live.ok ? [live.code] : configProblems
  for (const problem of problems) {
    say('target problem: {code}', { code: new OpsError(problem) })
  }
  if (live && live.errors && live.errors.length) say('cloudflare error codes: {codes}', { codes: publicToken(codesText(live.errors)) })
  const verdict = problems.length ? 'FAIL' : 'PASS'
  say('target check: {verdict}', { verdict })
  summary('target check: {verdict}', { verdict })
  return problems.length ? 1 : 0
}

if (isMain(import.meta.url)) runMain(main)
