import https from 'node:https'
import net from 'node:net'

const DEFAULT_TIMEOUT_MS = 5000
const PUBLIC_DNS_TIMEOUT_MS = 4000
const PUBLIC_INGRESS_TIMEOUT_MS = 6000

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

function normalizePath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return raw.startsWith('/') ? raw : `/${raw}`
}

async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'bypass-tunnel-reminder': 'true',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function isPrivateIpv4(ip) {
  const parts = String(ip || '').split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
}

function isPrivateIpv6(ip) {
  const normalized = String(ip || '').trim().toLowerCase()
  if (!normalized || net.isIP(normalized) !== 6) return true
  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
}

function shouldCheckPublicIngress(baseUrl) {
  try {
    const { hostname, protocol } = new URL(baseUrl)
    if (protocol !== 'https:') return false
    if (process.env.BUSINESS_OS_SKIP_PUBLIC_INGRESS_CHECK === '1') return false
    return process.env.BUSINESS_OS_CHECK_PUBLIC_INGRESS === '1'
      || hostname.endsWith('.ts.net')
  } catch {
    return false
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = PUBLIC_DNS_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`DNS HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function resolvePublicIngress(hostname) {
  const encoded = encodeURIComponent(hostname)
  const resolvers = [
    { url: `https://dns.google/resolve?name=${encoded}&type=A`, family: 4, dnsType: 1 },
    { url: `https://cloudflare-dns.com/dns-query?name=${encoded}&type=A`, family: 4, dnsType: 1 },
    { url: `https://dns.google/resolve?name=${encoded}&type=AAAA`, family: 6, dnsType: 28 },
    { url: `https://cloudflare-dns.com/dns-query?name=${encoded}&type=AAAA`, family: 6, dnsType: 28 },
  ]
  const answers = await Promise.allSettled(resolvers.map((resolver) => fetchJsonWithTimeout(resolver.url).then((json) => ({ ...resolver, json }))))
  const endpoints = new Map()
  answers.forEach((result) => {
    if (result.status !== 'fulfilled') return
    const { family, dnsType, json } = result.value
    const rows = Array.isArray(json?.Answer) ? json.Answer : []
    rows.forEach((row) => {
      if (Number(row?.type) !== dnsType) return
      const ip = String(row?.data || '').trim()
      if (!ip) return
      if (family === 4 && !isPrivateIpv4(ip)) endpoints.set(`4:${ip}`, { ip, family: 4 })
      if (family === 6 && !isPrivateIpv6(ip)) endpoints.set(`6:${ip}`, { ip, family: 6 })
    })
  })
  return [...endpoints.values()]
}

function checkHttpsViaIp(rawUrl, endpoint, timeoutMs = PUBLIC_INGRESS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl)
    const ip = endpoint?.ip || endpoint
    const family = endpoint?.family || 4
    const request = https.request({
      protocol: 'https:',
      hostname: parsed.hostname,
      servername: parsed.hostname,
      port: parsed.port || 443,
      method: 'GET',
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      timeout: timeoutMs,
      headers: {
        host: parsed.host,
        'bypass-tunnel-reminder': 'true',
      },
      lookup: (_hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{ address: ip, family }])
          return
        }
        callback(null, ip, family)
      },
    }, (response) => {
      response.resume()
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        remoteAddress: response.socket?.remoteAddress || ip,
      }))
    })
    request.on('timeout', () => request.destroy(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`)))
    request.on('error', reject)
    request.end()
  })
}

async function main() {
  const [, , rawBaseUrl, ...rawPaths] = process.argv
  const baseUrl = normalizeBaseUrl(rawBaseUrl)
  if (!baseUrl) {
    console.error('Usage: node ops/scripts/runtime/check-public-url.mjs <baseUrl> [path...]')
    process.exit(1)
  }

  const paths = Array.from(new Set([
    '/',
    '/health',
    ...rawPaths.map(normalizePath).filter(Boolean),
    '/api/portal/bootstrap',
  ]))

  let hasFailure = false
  const routeResults = await Promise.all(paths.map(async (path) => {
    const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path}`
    try {
      const response = await fetchWithTimeout(url)
      const ok = response.status >= 200 && response.status < 400
      return { ok, line: `[${ok ? 'OK' : 'FAIL'}] ${response.status} ${url}` }
    } catch (error) {
      return { ok: false, line: `[FAIL] ERR ${url} :: ${error?.message || error}` }
    }
  }))
  routeResults.forEach((result) => {
    console.log(result.line)
    if (!result.ok) hasFailure = true
  })
  const routeHasFailure = routeResults.some((result) => !result.ok)

  if (shouldCheckPublicIngress(baseUrl)) {
    const hostname = new URL(baseUrl).hostname
    let publicEndpoints = []
    try {
      publicEndpoints = await resolvePublicIngress(hostname)
    } catch (error) {
      const label = routeHasFailure ? 'FAIL' : 'WARN'
      console.log(`[${label}] DNS ${hostname} :: ${error?.message || error}`)
      if (routeHasFailure) hasFailure = true
    }

    if (!publicEndpoints.length) {
      const label = routeHasFailure ? 'FAIL' : 'WARN'
      console.log(`[${label}] DNS ${hostname} :: no public IPv4/IPv6 ingress addresses resolved`)
      if (routeHasFailure) hasFailure = true
    }

    const ingressResults = await Promise.all(publicEndpoints.map(async (endpoint) => {
      const url = `${baseUrl}/health`
      try {
        const response = await checkHttpsViaIp(url, endpoint)
        const ok = response.status >= 200 && response.status < 400
        const label = ok ? 'OK' : routeHasFailure ? 'FAIL' : 'WARN'
        return { ok: ok || !routeHasFailure, line: `[${label}] ${response.status} ${url} via ${endpoint.ip}` }
      } catch (error) {
        const label = routeHasFailure ? 'FAIL' : 'WARN'
        return { ok: !routeHasFailure, line: `[${label}] ERR ${url} via ${endpoint.ip} :: ${error?.code || error?.message || error}` }
      }
    }))
    ingressResults.forEach((result) => {
      console.log(result.line)
      if (!result.ok) hasFailure = true
    })
  }

  if (hasFailure) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
