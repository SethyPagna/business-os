type JsonFetchOptions = {
  timeoutMs?: number
  headers?: HeadersInit
}

type ConsoleMessage = {
  type: string
  text: string
}

type ConsoleLike = {
  type: () => string
  text: () => string
}

type ResponseLike = {
  url: () => string
  status: () => number
}

type LocatorLike = {
  locator: (selector: string) => LocatorLike
  first: () => LocatorLike
  last: () => LocatorLike
  click: () => Promise<void>
  waitFor: (options: { state: 'hidden'; timeout: number }) => Promise<void>
}

type PageLike = {
  on: (eventName: 'console', handler: (message: ConsoleLike) => void) => void
  on: (eventName: 'pageerror', handler: (error: Error | unknown) => void) => void
  waitForResponse: (
    predicate: (response: ResponseLike) => boolean,
    options: { timeout: number },
  ) => Promise<ResponseLike>
  locator: (selector: string) => LocatorLike
}

type ObservedRequest = {
  url: string
  status?: number
}

type ConsoleCollectorOptions = {
  ignoreConsole?: (message: string) => boolean
}

async function fetchJsonResponse(url: string, options: JsonFetchOptions = {}): Promise<Response> {
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

export async function readJson(url: string, options: JsonFetchOptions = {}): Promise<unknown> {
  const response = await fetchJsonResponse(url, options)
  return response.json()
}

export async function readJsonStatus(url: string, options: JsonFetchOptions = {}): Promise<number> {
  const response = await fetchJsonResponse(url, options)
  await response.json().catch(() => ({}))
  return response.status
}

export function isIgnoredConsole(message: unknown): boolean {
  return /favicon\.ico|ResizeObserver loop|Failed to load resource: the server responded with a status of 404/i.test(String(message || ''))
}

export function attachConsoleCollector(
  page: PageLike,
  consoleMessages: ConsoleMessage[],
  options: ConsoleCollectorOptions = {},
): void {
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

export function latestObservedStatus(requests: ObservedRequest[], pattern: RegExp): number | null {
  const latest = [...requests].reverse().find((request) => pattern.test(request.url))
  return latest?.status ?? null
}

export async function waitForRead(
  page: PageLike,
  observedRequests: ObservedRequest[],
  pattern: RegExp,
  label: string,
): Promise<number> {
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

export async function closeTopModal(page: PageLike): Promise<void> {
  const modal = page.locator('.fixed.inset-0').last()
  await modal.locator('button').first().click()
  await modal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
}
