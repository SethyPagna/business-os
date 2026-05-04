#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const DEFAULT_POLICY = path.join(ROOT, 'ops', 'automation', 'business-os-automation.json')

function parseArgs(argv) {
  const args = { policy: DEFAULT_POLICY, apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--policy') args.policy = path.resolve(ROOT, argv[++index] || args.policy)
    else if (value === '--apply') args.apply = true
  }
  return args
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readToken(policy) {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim()
  const tokenFile = path.resolve(ROOT, policy.cloudflare?.apiTokenFile || 'ops/runtime/secrets/cloudflare-api-token.txt')
  return fs.readFileSync(tokenFile, 'utf8').trim()
}

function readAllowedEmails(policy) {
  const file = path.resolve(ROOT, policy.cloudflare?.allowedEmailsFile || 'ops/runtime/automation/access-emails.txt')
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#'))
  } catch (_) {
    return []
  }
}

function requestJson(method, endpoint, token, payload = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const body = payload ? JSON.stringify(payload) : ''
    const req = https.request({
      method,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = {}
        try { json = text ? JSON.parse(text) : {} } catch (_) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: json,
        })
      })
    })
    req.on('timeout', () => req.destroy(new Error('Cloudflare API request timed out.')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function summarizeFailure(result, permission) {
  const messages = Array.isArray(result.body?.errors)
    ? result.body.errors.map((error) => error.message).filter(Boolean).join('; ')
    : ''
  return `${permission} is required. Cloudflare returned HTTP ${result.status}${messages ? `: ${messages}` : ''}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const policy = readJson(args.policy)
  const token = readToken(policy)
  const zoneName = policy.cloudflare?.zoneName || 'leangcosmetics.dpdns.org'
  const adminHost = new URL(policy.domains?.admin || 'https://admin.leangcosmetics.dpdns.org').hostname
  const publicHost = new URL(policy.domains?.public || 'https://leangcosmetics.dpdns.org').hostname

  const verify = await requestJson('GET', 'https://api.cloudflare.com/client/v4/user/tokens/verify', token)
  if (!verify.ok || verify.body?.success === false) throw new Error('Cloudflare API token is not valid.')

  const zones = await requestJson('GET', `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}&per_page=50`, token)
  if (!zones.ok || zones.body?.success === false) throw new Error(summarizeFailure(zones, 'Zone Read'))
  const zone = (zones.body.result || []).find((item) => item.name === zoneName)
  if (!zone?.id) throw new Error(`Cloudflare zone not found: ${zoneName}`)
  const accountId = zone.account?.id
  if (!accountId) throw new Error('Cloudflare zone is visible, but account id was not returned.')

  const dns = await requestJson('GET', `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?per_page=100`, token)
  if (!dns.ok || dns.body?.success === false) throw new Error(summarizeFailure(dns, 'Zone DNS Read/Edit'))
  const dnsNames = new Set((dns.body.result || []).map((record) => record.name))
  const missingDns = [adminHost, publicHost].filter((host) => !dnsNames.has(host))

  const access = await requestJson('GET', `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps?per_page=50`, token)
  const rulesets = await requestJson('GET', `https://api.cloudflare.com/client/v4/zones/${zone.id}/rulesets?per_page=50`, token)
  const needs = []
  if (!access.ok || access.body?.success === false) needs.push(summarizeFailure(access, 'Account.Cloudflare Access: Edit'))
  if (!rulesets.ok || rulesets.body?.success === false) needs.push(summarizeFailure(rulesets, 'Zone.Rulesets: Edit'))

  const emails = readAllowedEmails(policy)
  if (args.apply && emails.length === 0) {
    needs.push('Add at least one admin email to ops/runtime/automation/access-emails.txt before applying Cloudflare Access policies.')
  }

  console.log(`Cloudflare token: active`)
  console.log(`Zone: ${zoneName}`)
  console.log(`Admin host: ${adminHost}`)
  console.log(`Public host: ${publicHost}`)
  console.log(`DNS records: ${missingDns.length ? `missing ${missingDns.join(', ')}` : 'ready'}`)
  console.log(`Access API: ${access.ok && access.body?.success !== false ? 'ready' : 'needs stronger token'}`)
  console.log(`Rulesets/WAF API: ${rulesets.ok && rulesets.body?.success !== false ? 'ready' : 'needs stronger token'}`)
  console.log(`Allowed countries: ${(policy.cloudflare?.allowedCountries || []).join(', ')}`)
  console.log(`Rate limit profile: ${policy.cloudflare?.rateLimitProfile || 'normal'}`)
  console.log(`Access emails configured: ${emails.length}`)

  if (needs.length) {
    console.log('\nCloudflare automation needs:')
    needs.forEach((need) => console.log(`- ${need}`))
    if (args.apply) process.exit(2)
  }

  if (args.apply && !needs.length) {
    console.log('Cloudflare apply mode is ready. Access/WAF creation is intentionally gated by the configured email allowlist to avoid lockout.')
  }
}

main().catch((error) => {
  console.error(`[cloudflare-automation] ${error.message || error}`)
  process.exit(1)
})
