#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ENV_FILE = path.join(ROOT, 'backend', '.env')
const DEFAULT_TOKEN_FILE = path.join(ROOT, 'ops', 'runtime', 'secrets', 'cloudflare-api-token.txt')

function readEnvFile(file) {
  const result = {}
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index <= 0) continue
      result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
    }
  } catch (_) {}
  return result
}

function parseArgs(argv) {
  const args = { mode: 'host', dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--mode') args.mode = argv[++index] || args.mode
    else if (value === '--origin') args.origin = argv[++index] || ''
    else if (value === '--dry-run') args.dryRun = true
  }
  return args
}

function readToken(env) {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim()
  const tokenFile = process.env.CLOUDFLARE_API_TOKEN_FILE || env.CLOUDFLARE_API_TOKEN_FILE || DEFAULT_TOKEN_FILE
  try { return fs.readFileSync(tokenFile, 'utf8').trim() } catch (_) { return '' }
}

function ensureIngress(config, hostname, service) {
  const ingress = Array.isArray(config.ingress) ? [...config.ingress] : []
  const fallbackIndex = ingress.findIndex((rule) => rule && !rule.hostname)
  const withoutHost = ingress.filter((rule) => !rule || rule.hostname !== hostname)
  const hostRule = { hostname, service }
  if (fallbackIndex >= 0) {
    const fallbackRule = ingress[fallbackIndex]
    const beforeFallback = withoutHost.filter((rule) => rule && rule.hostname)
    const afterFallback = withoutHost.filter((rule) => !rule || !rule.hostname)
    config.ingress = [...beforeFallback, hostRule, ...afterFallback]
    if (!config.ingress.some((rule) => !rule.hostname)) config.ingress.push(fallbackRule)
  } else {
    config.ingress = [...withoutHost, hostRule, { service: 'http_status:404' }]
  }
}

async function main() {
  const env = readEnvFile(ENV_FILE)
  const args = parseArgs(process.argv.slice(2))
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID
  const tunnelId = process.env.CLOUDFLARE_TUNNEL_ID || env.CLOUDFLARE_TUNNEL_ID
  const publicHost = new URL(process.env.CLOUDFLARE_PUBLIC_URL || env.CLOUDFLARE_PUBLIC_URL || 'https://leangcosmetics.dpdns.org').hostname
  const adminHost = new URL(process.env.CLOUDFLARE_ADMIN_URL || env.CLOUDFLARE_ADMIN_URL || 'https://admin.leangcosmetics.dpdns.org').hostname
  const port = process.env.PORT || env.PORT || '4000'
  const service = args.origin || (args.mode === 'docker' ? `http://app:${port}` : `http://127.0.0.1:${port}`)
  const token = readToken(env)

  if (!accountId || !tunnelId) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_TUNNEL_ID are required.')
  if (!token) throw new Error('Cloudflare API token is missing. Set CLOUDFLARE_API_TOKEN or ops/runtime/secrets/cloudflare-api-token.txt.')

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const currentResult = await requestJson('GET', endpoint, headers)
  const current = currentResult.body
  if (!currentResult.ok || current.success === false) {
    const message = current?.errors?.map((error) => error.message).join('; ') || currentResult.statusMessage
    throw new Error(`Cloudflare rejected the tunnel config read: ${message}`)
  }

  const config = { ...(current.result?.config || {}) }
  ensureIngress(config, publicHost, service)
  ensureIngress(config, adminHost, service)
  if (!config.ingress?.some((rule) => !rule.hostname)) config.ingress.push({ service: 'http_status:404' })

  console.log(`Cloudflare Tunnel origin target: ${service}`)
  console.log(`Public hostname: ${publicHost}`)
  console.log(`Admin hostname : ${adminHost}`)
  if (args.dryRun) {
    console.log(JSON.stringify({ config }, null, 2))
    return
  }

  const updateResult = await requestJson('PUT', endpoint, headers, { config })
  const updated = updateResult.body
  if (!updateResult.ok || updated.success === false) {
    const message = updated?.errors?.map((error) => error.message).join('; ') || updateResult.statusMessage
    throw new Error(`Cloudflare rejected the tunnel config update: ${message}`)
  }
  console.log('Cloudflare Tunnel origin updated.')
}

function requestJson(method, endpoint, headers, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const body = payload ? JSON.stringify(payload) : ''
    const request = https.request({
      method,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: 30000,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed = {}
        try { parsed = text ? JSON.parse(text) : {} } catch (_) {}
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          body: parsed,
        })
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error('Cloudflare API request timed out.'))
    })
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

main().catch((error) => {
  console.error(`[cloudflare-origin] ${error.message || error}`)
  process.exit(1)
})
