import https from 'node:https'

const DEFAULT_TIMEOUT_MS = 15000
const PUBLIC_DNS_TIMEOUT_MS = 8000
const PUBLIC_INGRESS_TIMEOUT_MS = 15000

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

async function resolvePublicIpv4(hostname) {
  const encoded = encodeURIComponent(hostname)
  const resolvers = [
    `https://dns.google/resolve?name=${encoded}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encoded}&type=A`,
  ]
  const answers = await Promise.allSettled(resolvers.map((url) => fetchJsonWithTimeout(url)))
  const ips = new Set()
  answers.forEach((result) => {
    if (result.status !== 'fulfilled') return
    const rows = Array.isArray(result.value?.Answer) ? result.value.Answer : []
    rows.forEach((row) => {
      if (Number(row?.type) !== 1) return
      const ip = String(row?.data || '').trim()
      if (ip && !isPrivateIpv4(ip)) ips.add(ip)
    })
  })
  return [...ips]
}

function checkHttpsViaIp(rawUrl, ip, timeoutMs = PUBLIC_INGRESS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl)
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
          callback(null, [{ address: ip, family: 4 }])
          return
        }
        callback(null, ip, 4)
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
  for (const path of paths) {
    const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path}`
    try {
      const response = await fetchWithTimeout(url)
      const ok = response.status >= 200 && response.status < 400
      const label = ok ? 'OK' : 'FAIL'
      console.log(`[${label}] ${response.status} ${url}`)
      if (!ok) hasFailure = true
    } catch (error) {
      hasFailure = true
      console.log(`[FAIL] ERR ${url} :: ${error?.message || error}`)
    }
  }

  if (shouldCheckPublicIngress(baseUrl)) {
    const hostname = new URL(baseUrl).hostname
    let publicIps = []
    try {
      publicIps = await resolvePublicIpv4(hostname)
    } catch (error) {
      console.log(`[FAIL] DNS ${hostname} :: ${error?.message || error}`)
      hasFailure = true
    }

    if (!publicIps.length) {
      console.log(`[FAIL] DNS ${hostname} :: no public IPv4 ingress addresses resolved`)
      hasFailure = true
    }

    for (const ip of publicIps) {
      const url = `${baseUrl}/health`
      try {
        const response = await checkHttpsViaIp(url, ip)
        const ok = response.status >= 200 && response.status < 400
        const label = ok ? 'OK' : 'FAIL'
        console.log(`[${label}] ${response.status} ${url} via ${ip}`)
        if (!ok) hasFailure = true
      } catch (error) {
        hasFailure = true
        console.log(`[FAIL] ERR ${url} via ${ip} :: ${error?.code || error?.message || error}`)
      }
    }
  }

  if (hasFailure) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
