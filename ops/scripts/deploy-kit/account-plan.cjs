#!/usr/bin/env node
'use strict'
// Read-only: which Workers plan is the Cloudflare account really on?
//
// The release kit runs this through cloudflare/scripts/with-wrangler-auth.cjs,
// so the API token arrives in the environment and this file never opens a
// credential file. It prints ONE JSON line, {"plan":"paid|free|unknown",
// "reason":"..."}: never the token and never the API answer (the subscription
// list carries prices, and the Actions logs of this repository are public).

const fs = require('fs')
const path = require('path')
const lib = require('./lib.cjs')

const API = 'https://api.cloudflare.com/client/v4'

function accountIdFromToml(text) {
  const m = /^\s*account_id\s*=\s*"([0-9a-f]{32})"/im.exec(String(text || ''))
  return m ? m[1] : ''
}

const unknown = (reason) => ({ plan: 'unknown', reason })

async function readAccountPlan({ fetchImpl = fetch, token, accountId, timeoutMs = 20000 }) {
  if (!token) return unknown('no Cloudflare API token in the environment')
  if (!accountId) return unknown('no Cloudflare account id (CLOUDFLARE_ACCOUNT_ID or account_id in wrangler.toml)')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${API}/accounts/${accountId}/subscriptions`, {
      method: 'GET',
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    if (!res.ok) {
      const billing = res.status === 401 || res.status === 403 ? ': the token cannot read the account subscription (it needs billing read access)' : ''
      return unknown(`the Cloudflare API answered HTTP ${res.status}${billing}`)
    }
    let json = null
    try { json = JSON.parse(await res.text()) } catch { return unknown('the subscription answer was not JSON') }
    return lib.classifyWorkersPlan(json)
  } catch (err) {
    return unknown(`the Cloudflare API could not be reached (${err && err.name === 'AbortError' ? 'timed out' : 'network error'})`)
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
  if (!accountId) {
    try { accountId = accountIdFromToml(fs.readFileSync(path.join(process.cwd(), 'wrangler.toml'), 'utf8')) } catch { /* no config here */ }
  }
  process.stdout.write(`${JSON.stringify(await readAccountPlan({ token: process.env.CLOUDFLARE_API_TOKEN || '', accountId }))}\n`)
}

if (require.main === module) {
  main().catch(() => { process.stdout.write(`${JSON.stringify(unknown('the account plan check failed unexpectedly'))}\n`) })
}

module.exports = { readAccountPlan, accountIdFromToml }
