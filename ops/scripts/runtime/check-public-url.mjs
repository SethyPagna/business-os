const DEFAULT_TIMEOUT_MS = 15000

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
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
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

  if (hasFailure) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
