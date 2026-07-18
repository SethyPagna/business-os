#!/usr/bin/env node
/* eslint-disable no-console */
// Diagnoses "Error 1033" / "Error 530" style Cloudflare Tunnel failures.
//
// Checks, in order:
//   1. Required local config is present (account id, tunnel id, API token).
//   2. The tunnel connector token file that cloudflared actually authenticates
//      with is present and non-empty.
//   3. The Cloudflare API reports the tunnel as healthy with at least one
//      active connector (this is what "Error 1033" means when it's 0).
//   4. The remote ingress config actually routes the configured public/admin
//      hostnames somewhere other than the default 404 fallback.
//   5. If the `docker` CLI is available, the cloudflared container is running
//      and its recent logs don't show an authentication/registration failure.
//
// Usage:
//   node ops/scripts/runtime/cloudflare/verify-cloudflare-tunnel.ts [--output <file>]
//
// Exit code is 0 only when every check that could be performed passed.

const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const ENV_FILES = [
  path.join(ROOT, 'backend', '.env'),
  path.join(ROOT, 'ops', 'runtime', 'docker-release', 'docker-release.env'),
]
const DEFAULT_API_TOKEN_FILE = path.join(ROOT, 'ops', 'runtime', 'secrets', 'cloudflare-api-token.txt')
const CANDIDATE_TUNNEL_TOKEN_FILES = [
  path.join(ROOT, 'ops', 'runtime', 'docker-release', 'secrets', 'cloudflare-tunnel.token'),
  path.join(ROOT, 'ops', 'runtime', 'secrets', 'cloudflare-business-os-leangcosmetics.token'),
]
const COMPOSE_FILE = path.join(ROOT, 'ops', 'docker', 'compose.release.yml')

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
  const args = { output: '' }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') args.output = argv[++index] || ''
  }
  return args
}

function readToken(env) {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim()
  if (env.CLOUDFLARE_API_TOKEN) return env.CLOUDFLARE_API_TOKEN.trim()
  const tokenFile = process.env.CLOUDFLARE_API_TOKEN_FILE || env.CLOUDFLARE_API_TOKEN_FILE || DEFAULT_API_TOKEN_FILE
  try { return fs.readFileSync(tokenFile, 'utf8').trim() } catch (_) { return '' }
}

function findTunnelTokenFile(env) {
  const configured = env.CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE
  const candidates = configured ? [configured, ...CANDIDATE_TUNNEL_TOKEN_FILES] : CANDIDATE_TUNNEL_TOKEN_FILES
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate)
      if (stat.size > 0) return { path: candidate, size: stat.size, exists: true }
    } catch (_) {}
  }
  return { path: candidates[0], size: 0, exists: fs.existsSync(candidates[0]) }
}

function requestJson(method, endpoint, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const request = https.request({
      method,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: 15000,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let parsed = {}
        try { parsed = text ? JSON.parse(text) : {} } catch (_) {}
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode, body: parsed })
      })
    })
    request.on('timeout', () => request.destroy(new Error('Cloudflare API request timed out.')))
    request.on('error', reject)
    request.end()
  })
}

function runCommand(command, args) {
  try {
    return { ok: true, output: execFileSync(command, args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { ok: false, output: '', error: (error && (error.stderr || error.message)) ? String(error.stderr || error.message) : String(error) }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = readEnv()
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || ''
  const tunnelId = process.env.CLOUDFLARE_TUNNEL_ID || env.CLOUDFLARE_TUNNEL_ID || ''
  const publicUrl = process.env.CLOUDFLARE_PUBLIC_URL || env.CLOUDFLARE_PUBLIC_URL || env.BUSINESS_OS_PUBLIC_URL || 'https://leangcosmetics.dpdns.org'
  const adminUrl = process.env.CLOUDFLARE_ADMIN_URL || env.CLOUDFLARE_ADMIN_URL || env.BUSINESS_OS_ADMIN_URL || 'https://admin.leangcosmetics.dpdns.org'
  const publicHost = new URL(publicUrl).hostname
  const adminHost = new URL(adminUrl).hostname
  const token = readToken(env)

  const checks = []
  const note = (name, status, detail) => { checks.push({ name, status, detail }); return status }
  let hardFailure = false

  // 1. Local config presence
  if (!accountId) { note('CLOUDFLARE_ACCOUNT_ID', 'fail', 'Not set in backend/.env or ops/runtime/docker-release/docker-release.env.'); hardFailure = true }
  else note('CLOUDFLARE_ACCOUNT_ID', 'pass', accountId)

  if (!tunnelId) { note('CLOUDFLARE_TUNNEL_ID', 'fail', 'Not set. Run run\\docker\\install.bat (or Doctor) to regenerate the env file, or set it manually.'); hardFailure = true }
  else note('CLOUDFLARE_TUNNEL_ID', 'pass', tunnelId)

  if (!token) { note('CLOUDFLARE_API_TOKEN', 'fail', `Not set and no readable token at ${DEFAULT_API_TOKEN_FILE}.`); hardFailure = true }
  else note('CLOUDFLARE_API_TOKEN', 'pass', 'present')

  // 2. Tunnel connector token file (what cloudflared itself authenticates with)
  const tunnelTokenFile = findTunnelTokenFile(env)
  if (!tunnelTokenFile.exists || tunnelTokenFile.size === 0) {
    note('tunnel connector token file', 'fail', `${tunnelTokenFile.path} is missing or empty. cloudflared cannot connect without it. Run run\\docker\\rotate-cloudflare.bat to fetch a fresh one.`)
    hardFailure = true
  } else {
    note('tunnel connector token file', 'pass', `${tunnelTokenFile.path} (${tunnelTokenFile.size} bytes)`)
  }

  // 3 & 4. Cloudflare API: connector status + ingress routes
  if (accountId && tunnelId && token) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    try {
      const tunnelResult = await requestJson('GET', `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`, headers)
      if (!tunnelResult.ok || tunnelResult.body?.success === false) {
        const message = tunnelResult.body?.errors?.map((e) => e.message).join('; ') || `HTTP ${tunnelResult.statusCode}`
        note('Cloudflare tunnel lookup', 'fail', message)
        hardFailure = true
      } else {
        const result = tunnelResult.body?.result || {}
        const connections = Array.isArray(result.connections) ? result.connections : []
        if (result.status === 'inactive' || connections.length === 0) {
          note('tunnel connector status', 'fail', `status="${result.status}", active connections=${connections.length}. This is exactly what causes Error 1033 / 530 — no cloudflared process is currently registered with Cloudflare for this tunnel. Check that the cloudflared container is running and its token file is valid.`)
          hardFailure = true
        } else {
          note('tunnel connector status', 'pass', `status="${result.status}", active connections=${connections.length}`)
        }
      }

      const configResult = await requestJson('GET', `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, headers)
      if (!configResult.ok || configResult.body?.success === false) {
        const message = configResult.body?.errors?.map((e) => e.message).join('; ') || `HTTP ${configResult.statusCode}`
        note('Cloudflare tunnel ingress lookup', 'fail', message)
        hardFailure = true
      } else {
        const ingress = configResult.body?.result?.config?.ingress || []
        const hasPublic = ingress.some((rule) => rule && rule.hostname === publicHost)
        const hasAdmin = ingress.some((rule) => rule && rule.hostname === adminHost)
        if (!hasPublic || !hasAdmin) {
          const missing = [!hasPublic ? publicHost : null, !hasAdmin ? adminHost : null].filter(Boolean).join(', ')
          note('tunnel ingress routes', 'fail', `No ingress rule for: ${missing}. Requests to that hostname fall through to the 404 rule (this also presents as Error 530). Run run\\cloudflare-origin.bat docker to publish the routes.`)
          hardFailure = true
        } else {
          note('tunnel ingress routes', 'pass', `${publicHost} and ${adminHost} are both routed.`)
        }
      }
    } catch (error) {
      note('Cloudflare API reachability', 'fail', error.message || String(error))
      hardFailure = true
    }
  } else {
    note('Cloudflare API checks', 'skip', 'Skipped because account id, tunnel id, or API token is missing (see above).')
  }

  // 5. Docker-side check (best effort; not fatal if docker/compose is unavailable)
  const dockerPs = runCommand('docker', ['compose', '-f', COMPOSE_FILE, 'ps', '--format', 'json', 'cloudflared'])
  if (dockerPs.ok && dockerPs.output.trim()) {
    let containerState = ''
    try {
      const lines = dockerPs.output.trim().split(/\r?\n/).filter(Boolean)
      const parsed = JSON.parse(lines[lines.length - 1])
      containerState = parsed.State || parsed.Status || ''
    } catch (_) { containerState = dockerPs.output.trim() }
    if (/running/i.test(containerState)) {
      note('cloudflared container', 'pass', containerState)
    } else {
      note('cloudflared container', 'fail', `Container state: "${containerState || 'not found'}". Start it with run\\docker\\start.bat.`)
      hardFailure = true
    }

    const dockerLogs = runCommand('docker', ['compose', '-f', COMPOSE_FILE, 'logs', '--tail', '60', 'cloudflared'])
    if (dockerLogs.ok) {
      const logText = dockerLogs.output
      if (/failed to (register|create) tunnel|unable to reach the origin|context deadline exceeded|401 Unauthorized|Couldn.t start tunnel/i.test(logText)) {
        note('cloudflared recent logs', 'fail', 'Recent logs contain a connection/auth failure. Run: docker compose -f ops\\docker\\compose.release.yml logs cloudflared')
        hardFailure = true
      } else if (/Registered tunnel connection/i.test(logText)) {
        note('cloudflared recent logs', 'pass', 'Logs show at least one registered tunnel connection.')
      } else {
        note('cloudflared recent logs', 'warn', 'No clear success or failure signature found in the last 60 log lines.')
      }
    }
  } else {
    note('cloudflared container', 'skip', 'Docker CLI not available or compose project not running from this shell; skipped local container check.')
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    publicUrl,
    adminUrl,
    status: hardFailure ? 'failed' : 'passed',
    checks,
  }

  console.log('')
  console.log('Cloudflare Tunnel diagnostic')
  console.log('============================')
  for (const check of checks) {
    const marker = { pass: '[OK]  ', fail: '[FAIL]', warn: '[WARN]', skip: '[SKIP]' }[check.status] || '[?]   '
    console.log(`${marker} ${check.name}: ${check.detail}`)
  }
  console.log('')
  console.log(hardFailure
    ? 'Result: FAILED — see [FAIL] lines above for the specific cause and fix.'
    : 'Result: PASSED — the tunnel is configured and Cloudflare reports an active connector.')

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true })
    fs.writeFileSync(args.output, JSON.stringify(summary, null, 2))
  }

  process.exit(hardFailure ? 1 : 0)
}

main().catch((error) => {
  console.error(`[verify-cloudflare-tunnel] ${error.message || error}`)
  process.exit(1)
})
