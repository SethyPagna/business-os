const DEFAULT_TIMEOUT_MS = 20_000
const SESSION_TTL_SECONDS = 24 * 60 * 60
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000

type HeaderLike = Headers & {
  getSetCookie?: () => string[]
}

type SessionCookie = {
  name: string
  value: string
}

type LoginPayload = {
  success?: boolean
  user?: unknown
  sessionExpiresAt?: string | number
}

export type BrowserStorageState = {
  userJson: string
  expiry: string
  baseUrl: string
}

export type LoginSession = {
  response: Response
  payload: LoginPayload
  sessionCookie: SessionCookie
  cookieHeader: string
  setCookieHeaders: string[]
}

type LoginAttempt = {
  attempt: number
  status: number
  ok: boolean
  payload: unknown
}

type LoginWithFetchOptions = {
  baseUrl: string
  username: string
  password: string
  timeoutMs?: number
  retries?: number
  fetchImpl?: typeof fetch
  recordAttempt?: ((attempt: LoginAttempt) => void) | null
}

type PlaywrightCookieContext = {
  addCookies: (cookies: Array<Record<string, unknown>>) => Promise<void>
  addInitScript: (script: (state: BrowserStorageState) => void, state: BrowserStorageState) => Promise<void>
}

type PlaywrightPage = {
  evaluate: (
    script: (state: BrowserStorageState) => void,
    state: BrowserStorageState,
  ) => Promise<unknown>
}

function getSetCookieHeaders(headers: HeaderLike | null | undefined): string[] {
  if (!headers) return []
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }
  const single = typeof headers.get === 'function' ? headers.get('set-cookie') : ''
  return single ? [single] : []
}

function extractSessionCookie(setCookieHeaders: string[]): SessionCookie | null {
  const sessionCookieHeader = setCookieHeaders.find((header) => /(?:^|;\s*)bos_session=/i.test(String(header || '')))
  const match = String(sessionCookieHeader || '').match(/(?:^|;\s*)(bos_session)=([^;]+)/i)
  if (!match) return null
  return {
    name: match[1],
    value: match[2],
  }
}

export function buildBrowserStorageState(session: LoginSession, baseUrl: string): BrowserStorageState {
  return {
    userJson: JSON.stringify(session.payload.user),
    expiry: String(session.payload.sessionExpiresAt || (Date.now() + SESSION_TTL_MS)),
    baseUrl,
  }
}

export async function loginWithFetch({
  baseUrl,
  username,
  password,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 4,
  fetchImpl = globalThis.fetch,
  recordAttempt = null,
}: LoginWithFetchOptions): Promise<LoginSession> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('loginWithFetch requires a fetch implementation')
  }
  let response: Response | null = null
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error(`Login timed out after ${timeoutMs}ms`)), timeoutMs)
    try {
      response = await fetchImpl(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    const payload = await response.clone().json().catch(() => ({})) as LoginPayload
    if (typeof recordAttempt === 'function') {
      recordAttempt({
        attempt: attempt + 1,
        status: response.status,
        ok: response.ok,
        payload,
      })
    }
    if (response.ok) {
      const setCookieHeaders = getSetCookieHeaders(response.headers as HeaderLike)
      const sessionCookie = extractSessionCookie(setCookieHeaders)
      if (!payload?.success || !payload?.user) {
        throw new Error('Audit login failed: missing user payload')
      }
      if (!sessionCookie) {
        throw new Error('Audit login failed: missing bos_session cookie')
      }
      return {
        response,
        payload,
        sessionCookie,
        cookieHeader: `${sessionCookie.name}=${sessionCookie.value}`,
        setCookieHeaders,
      }
    }
    if (response.status !== 429 || attempt === retries - 1) {
      throw new Error(`Audit login failed: HTTP ${response.status}`)
    }
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfterSeconds = Number.parseInt(String(retryAfterHeader || ''), 10)
    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 2000 * (attempt + 1)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  throw new Error(`Audit login failed: HTTP ${response?.status || 'unknown'}`)
}

export async function applySessionToPlaywrightContext(
  context: PlaywrightCookieContext,
  session: LoginSession,
  baseUrl: string,
): Promise<BrowserStorageState> {
  const storageState = buildBrowserStorageState(session, baseUrl)
  await context.addCookies([{
    name: session.sessionCookie.name,
    value: session.sessionCookie.value,
    url: baseUrl,
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(baseUrl).protocol === 'https:',
    expires: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }])
  await context.addInitScript(({ userJson, expiry, baseUrl: nextBaseUrl }) => {
    try {
      window.sessionStorage.setItem('businessos_user', userJson)
      window.sessionStorage.setItem('businessos_user_expiry', expiry)
      window.localStorage.setItem('businessos_session_duration', 'session')
      window.localStorage.setItem('businessos_sync_server', nextBaseUrl)
    } catch (_) {}
  }, storageState)
  return storageState
}

export async function hydratePlaywrightPage(page: PlaywrightPage, storageState: BrowserStorageState): Promise<void> {
  await page.evaluate(({ userJson, expiry, baseUrl }) => {
    try {
      window.sessionStorage.setItem('businessos_user', userJson)
      window.sessionStorage.setItem('businessos_user_expiry', expiry)
      window.localStorage.setItem('businessos_session_duration', 'session')
      window.localStorage.setItem('businessos_sync_server', baseUrl)
    } catch (_) {}
  }, storageState).catch(() => {})
}
