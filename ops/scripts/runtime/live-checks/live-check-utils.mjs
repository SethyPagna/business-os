async function fetchJsonResponse(url, options = {}) {
  const { timeoutMs = 15_000, headers = undefined } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`GET ${url} timed out`)), timeoutMs)
  let response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`)
  }
  return response
}

export async function readJson(url, options = {}) {
  const response = await fetchJsonResponse(url, options)
  return response.json()
}

export async function readJsonStatus(url, options = {}) {
  const response = await fetchJsonResponse(url, options)
  await response.json().catch(() => ({}))
  return response.status
}

export function isIgnoredConsole(message) {
  return /favicon\.ico|ResizeObserver loop|Failed to load resource: the server responded with a status of 404/i.test(String(message || ''))
}

export function attachConsoleCollector(page, consoleMessages, options = {}) {
  const ignoreConsole = options.ignoreConsole || isIgnoredConsole
  page.on('console', (message) => {
    const text = message.text()
    if (['error', 'warning', 'warn'].includes(message.type()) && !ignoreConsole(text)) {
      consoleMessages.push({ type: message.type(), text })
    }
  })
  page.on('pageerror', (error) => {
    consoleMessages.push({ type: 'pageerror', text: error?.message || String(error) })
  })
}

export function latestObservedStatus(requests, pattern) {
  const latest = [...requests].reverse().find((request) => pattern.test(request.url))
  return latest?.status ?? null
}

export async function waitForRead(page, observedRequests, pattern, label) {
  const response = await page.waitForResponse(
    (item) => pattern.test(item.url()) && item.status() < 500,
    { timeout: 20_000 },
  ).catch(() => null)
  const status = response?.status?.() || latestObservedStatus(observedRequests, pattern)
  if (status !== 200) {
    throw new Error(`${label} returned HTTP ${status}`)
  }
  return status
}

export async function closeTopModal(page) {
  const modal = page.locator('.fixed.inset-0').last()
  await modal.locator('button').first().click()
  await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
}
