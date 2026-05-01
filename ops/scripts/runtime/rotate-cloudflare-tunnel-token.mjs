#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ENV_FILES = [
  path.join(ROOT, 'backend', '.env'),
  path.join(ROOT, 'ops', 'runtime', 'docker-release', 'docker-release.env'),
]
const DEFAULT_API_TOKEN_FILE = path.join(ROOT, 'ops', 'runtime', 'secrets', 'cloudflare-api-token.txt')
const DEFAULT_TUNNEL_TOKEN_FILE = path.join(ROOT, 'ops', 'runtime', 'docker-release', 'secrets', 'cloudflare-tunnel.token')

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

function readEnv() {
  return ENV_FILES.reduce((acc, file) => ({ ...acc, ...readEnvFile(file) }), {})
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    disconnectOld: false,
    mode: 'docker',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') args.dryRun = true
    else if (value === '--disconnect-old' || value === '--delete-old-connections') args.disconnectOld = true
    else if (value === '--mode') args.mode = argv[++index] || args.mode
    else if (value === '--origin') args.origin = argv[++index] || ''
    else if (value === '--api-token-file') args.apiTokenFile = argv[++index] || ''
    else if (value === '--tunnel-token-file') args.tunnelTokenFile = argv[++index] || ''
    else if (value === '--account-id') args.accountId = argv[++index] || ''
    else if (value === '--tunnel-id') args.tunnelId = argv[++index] || ''
  }
  return args
}

function readSecret(file) {
  try { return fs.readFileSync(file, 'utf8').trim() } catch (_) { return '' }
}

function writeSecret(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${String(value || '').trim()}\n`, { encoding: 'utf8', mode: 0o600 })
}

function ensureIngress(config, hostname, service) {
  if (!hostname) return
  const ingress = Array.isArray(config.ingress) ? [...config.ingress] : []
  const hostRule = { hostname, service }
  const withoutHost = ingress.filter((rule) => !rule || rule.hostname !== hostname)
  const fallbackRules = withoutHost.filter((rule) => !rule || !rule.hostname)
  const hostRules = withoutHost.filter((rule) => rule && rule.hostname)
  config.ingress = [...hostRules, hostRule, ...(fallbackRules.length ? fallbackRules : [{ service: 'http_status:404' }])]
}

function extractTunnelToken(body) {
  const result = body?.result
  if (typeof result === 'string') return result
  if (typeof result?.token === 'string') return result.token
  if (typeof body?.token === 'string') return body.token
  return ''
}

function getCloudflareError(result, fallback) {
  return result?.body?.errors?.map((error) => error.message).filter(Boolean).join('; ')
    || result?.statusMessage
    || fallback
}

async function readCurrentTunnel({ accountId, tunnelId, headers }) {
  const result = await requestJson('GET', `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`, headers)
  if (!result.ok || result.body?.success === false) {
    throw new Error(`Cloudflare rejected the tunnel read: ${getCloudflareError(result, 'unknown error')}`)
  }
  return result.body?.result || {}
}

async function readTunnelConfig({ accountId, tunnelId, headers }) {
  const result = await requestJson('GET', `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, headers)
  if (!result.ok || result.body?.success === false) {
    throw new Error(`Cloudflare rejected the tunnel config read: ${getCloudflareError(result, 'unknown error')}`)
  }
  return result.body?.result?.config || {}
}

async function rotateTunnelSecret({ accountId, tunnelId, headers, name, dryRun }) {
  const tunnelSecret = crypto.randomBytes(32).toString('base64')
  if (dryRun) return { changed: false, tunnelSecret }
  const payload = name ? { name, tunnel_secret: tunnelSecret } : { tunnel_secret: tunnelSecret }
  const result = await requestJson('PATCH', `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`, headers, payload)
  if (!result.ok || result.body?.success === false) {
    throw new Error(`Cloudflare rejected the tunnel secret rotation: ${getCloudflareError(result, 'unknown error')}`)
  }
  return { changed: true, tunnelSecret }
}

async function fetchTunnelToken({ accountId, tunnelId, headers }) {
  const result = await requestJson('GET', `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, headers)
  if (!result.ok || result.body?.success === false) {
    throw new Error(`Cloudflare rejected the tunnel token read: ${getCloudflareError(result, 'unknown error')}`)
  }
  const token = extractTunnelToken(result.body)
  if (!token) throw new Error('Cloudflare returned an empty tunnel token.')
  return token
}

async function updateTunnelIngress({ accountId, tunnelId, headers, config, publicHost, adminHost, service, dryRun }) {
  const nextConfig = { ...(config || {}) }
  ensureIngress(nextConfig, publicHost, service)
  ensureIngress(nextConfig, adminHost, service)
  if (!nextConfig.ingress?.some((rule) => !rule.hostname)) nextConfig.ingress = [...(nextConfig.ingress || []), { service: 'http_status:404' }]
  if (dryRun) return nextConfig
  const result = await requestJson(
    'PUT',
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    headers,
    { config: nextConfig },
  )
  if (!result.ok || result.body?.success === false) {
    throw new Error(`Cloudflare rejected the tunnel config update: ${getCloudflareError(result, 'unknown error')}`)
  }
  return nextConfig
}

async function disconnectTunnelConnections({ accountId, tunnelId, headers, dryRun }) {
  if (dryRun) return
  const result = await requestJson('DELETE', `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`, headers)
  if (!result.ok || result.body?.success === false) {
    throw new Error(`Cloudflare rejected old tunnel connection cleanup: ${getCloudflareError(result, 'unknown error')}`)
  }
}

async function main() {
  const env = readEnv()
  const args = parseArgs(process.argv.slice(2))
  const apiTokenFile = args.apiTokenFile || process.env.CLOUDFLARE_API_TOKEN_FILE || env.CLOUDFLARE_API_TOKEN_FILE || DEFAULT_API_TOKEN_FILE
  const tunnelTokenFile = args.tunnelTokenFile || process.env.CLOUDFLARE_TUNNEL_TOKEN_FILE || env.CLOUDFLARE_TUNNEL_TOKEN_FILE || DEFAULT_TUNNEL_TOKEN_FILE
  const token = (process.env.CLOUDFLARE_API_TOKEN || readSecret(apiTokenFile)).trim()
  const accountId = args.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID
  const tunnelId = args.tunnelId || process.env.CLOUDFLARE_TUNNEL_ID || env.CLOUDFLARE_TUNNEL_ID
  const publicUrl = process.env.BUSINESS_OS_PUBLIC_URL || process.env.CLOUDFLARE_PUBLIC_URL || env.BUSINESS_OS_PUBLIC_URL || env.CLOUDFLARE_PUBLIC_URL || 'https://leangcosmetics.dpdns.org'
  const adminUrl = process.env.BUSINESS_OS_ADMIN_URL || process.env.CLOUDFLARE_ADMIN_URL || env.BUSINESS_OS_ADMIN_URL || env.CLOUDFLARE_ADMIN_URL || 'https://admin.leangcosmetics.dpdns.org'
  const publicHost = new URL(publicUrl).hostname
  const adminHost = new URL(adminUrl).hostname
  const port = process.env.PORT || env.PORT || '4000'
  const service = args.origin || (args.mode === 'host' ? `http://127.0.0.1:${port}` : `http://app:${port}`)

  if (!accountId || !tunnelId) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_TUNNEL_ID are required.')
  if (!token) throw new Error(`Cloudflare API token missing. Put it in ${apiTokenFile} or set CLOUDFLARE_API_TOKEN.`)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const current = await readCurrentTunnel({ accountId, tunnelId, headers })
  const currentConfig = await readTunnelConfig({ accountId, tunnelId, headers })
  const tunnelName = current.name || current.tun_type || 'business-os'

  console.log(`Cloudflare tunnel: ${tunnelName}`)
  console.log(`Tunnel origin target: ${service}`)
  console.log(`Public hostname: ${publicHost}`)
  console.log(`Admin hostname : ${adminHost}`)
  if (args.dryRun) console.log('Dry run only. No secrets or Cloudflare settings will be changed.')

  await rotateTunnelSecret({ accountId, tunnelId, headers, name: current.name, dryRun: args.dryRun })
  let tunnelToken = ''
  if (!args.dryRun) {
    tunnelToken = await fetchTunnelToken({ accountId, tunnelId, headers })
    writeSecret(tunnelTokenFile, tunnelToken)
  }
  await updateTunnelIngress({
    accountId,
    tunnelId,
    headers,
    config: currentConfig,
    publicHost,
    adminHost,
    service,
    dryRun: args.dryRun,
  })
  if (args.disconnectOld) {
    await disconnectTunnelConnections({ accountId, tunnelId, headers, dryRun: args.dryRun })
  }

  if (!args.dryRun) {
    console.log(`New Cloudflare tunnel token saved to ${path.relative(ROOT, tunnelTokenFile)}.`)
    console.log('Cloudflare tunnel secret rotated. Restart Docker Cloudflare service or run run\\docker\\start.bat.')
  }
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
    request.on('timeout', () => request.destroy(new Error('Cloudflare API request timed out.')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

main().catch((error) => {
  console.error(`[cloudflare-rotate] ${error.message || error}`)
  process.exit(1)
})
