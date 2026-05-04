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
  const cleanToken = (value) => String(value || '').replace(/[\r\n\t ]+/g, '').trim()
  if (process.env.CLOUDFLARE_API_TOKEN) return cleanToken(process.env.CLOUDFLARE_API_TOKEN)
  const tokenFile = path.resolve(ROOT, policy.cloudflare?.apiTokenFile || 'ops/runtime/secrets/cloudflare-api-token.txt')
  return cleanToken(fs.readFileSync(tokenFile, 'utf8'))
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

function cloudflareErrors(result) {
  return Array.isArray(result.body?.errors)
    ? result.body.errors.map((error) => error.message || error.code).filter(Boolean).join('; ')
    : ''
}

function assertSuccess(result, action) {
  if (!result.ok || result.body?.success === false) {
    throw new Error(`${action} failed with HTTP ${result.status}${cloudflareErrors(result) ? `: ${cloudflareErrors(result)}` : ''}`)
  }
  return result.body?.result
}

async function upsertAccessApp({ token, accountId, adminHost, emails }) {
  const apps = assertSuccess(
    await requestJson('GET', `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps?per_page=100`, token),
    'List Cloudflare Access applications',
  ) || []
  const existing = apps.find((app) => String(app?.domain || '').toLowerCase() === adminHost.toLowerCase()
    || String(app?.name || '').toLowerCase() === 'business os admin')
  const payload = {
    name: 'Business OS Admin',
    domain: adminHost,
    type: 'self_hosted',
    session_duration: '24h',
    auto_redirect_to_identity: false,
    http_only_cookie_attribute: true,
    same_site_cookie_attribute: 'lax',
    policies: [
      {
        name: 'Business OS Admin Email Allowlist',
        decision: 'allow',
        precedence: 1,
        include: emails.map((email) => ({ email: { email } })),
      },
    ],
  }
  const endpoint = existing?.id
    ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps/${existing.id}`
    : `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps`
  const method = existing?.id ? 'PUT' : 'POST'
  const result = assertSuccess(await requestJson(method, endpoint, token, payload), 'Apply Cloudflare Access admin app')
  return { id: result?.id || existing?.id, created: !existing?.id, domain: adminHost }
}

async function getEntrypointRuleset({ token, zoneId, phase }) {
  const result = await requestJson('GET', `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, token)
  if (result.status === 404) return null
  return assertSuccess(result, `Read ${phase} entrypoint ruleset`)
}

async function upsertEntrypointRuleset({ token, zoneId, phase, name, rules }) {
  const existing = await getEntrypointRuleset({ token, zoneId, phase })
  const preserved = Array.isArray(existing?.rules)
    ? existing.rules.filter((rule) => !String(rule?.description || '').startsWith('Business OS '))
    : []
  const payload = {
    name: existing?.name || name,
    description: existing?.description || 'Business OS managed Cloudflare rules',
    kind: 'zone',
    phase,
    rules: [...preserved, ...rules],
  }
  const endpoint = existing?.id
    ? `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/${existing.id}`
    : `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets`
  const method = existing?.id ? 'PUT' : 'POST'
  return assertSuccess(await requestJson(method, endpoint, token, payload), `Apply ${phase} ruleset`)
}

async function tryApplyRuleset(label, fn) {
  try {
    await fn()
    console.log(`${label}: applied`)
    return true
  } catch (error) {
    console.log(`${label}: skipped (${error?.message || error})`)
    return false
  }
}

async function applyCloudflareAutomation({ token, zone, accountId, adminHost, publicHost, policy, emails }) {
  const accessApp = await upsertAccessApp({ token, accountId, adminHost, emails })
  console.log(`Access admin app: ${accessApp.created ? 'created' : 'updated'} (${accessApp.domain})`)

  const allowedCountries = (policy.cloudflare?.allowedCountries || ['KH', 'HK', 'AU'])
    .map((country) => String(country || '').trim().toUpperCase())
    .filter(Boolean)
  const countrySet = allowedCountries.map((country) => `"${country}"`).join(' ')
  const hostSet = [adminHost, publicHost].map((host) => `"${host}"`).join(' ')

  await tryApplyRuleset('WAF custom rules', () => upsertEntrypointRuleset({
    token,
    zoneId: zone.id,
    phase: 'http_request_firewall_custom',
    name: 'Business OS custom WAF',
    rules: [
      {
        action: 'managed_challenge',
        expression: `(http.host eq "${adminHost}" and not ip.geoip.country in {${countrySet}})`,
        description: 'Business OS admin country challenge',
        enabled: true,
      },
      {
        action: 'block',
        expression: `(http.host in {${hostSet}} and (lower(http.request.uri.query) contains "<script" or lower(http.request.uri.query) contains "union select" or lower(http.request.uri.query) contains "../" or lower(http.request.uri.path) contains "../"))`,
        description: 'Business OS obvious injection block',
        enabled: true,
      },
    ],
  }))

  await tryApplyRuleset('Rate-limit rules', () => upsertEntrypointRuleset({
    token,
    zoneId: zone.id,
    phase: 'http_ratelimit',
    name: 'Business OS rate limits',
    rules: [
      {
        action: 'block',
        expression: `(http.host eq "${adminHost}" and http.request.uri.path contains "/api/auth/")`,
        description: 'Business OS auth rate limit',
        enabled: true,
        ratelimit: {
          characteristics: ['ip.src', 'cf.colo.id'],
          period: 10,
          requests_per_period: 10,
          mitigation_timeout: 10,
        },
      },
    ],
  }))
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
    await applyCloudflareAutomation({ token, zone, accountId, adminHost, publicHost, policy, emails })
  }
}

main().catch((error) => {
  console.error(`[cloudflare-automation] ${error.message || error}`)
  process.exit(1)
})
