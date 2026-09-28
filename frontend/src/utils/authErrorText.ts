// I18N-4: the sign-in screen's refusals, in the operator's language.
//
// POST /api/auth/login and POST /api/auth/otp/verify send a stable `code`
// with every refusal, next to their English `error` (cloudflare/src/routes/
// auth.ts, pinned by cloudflare/scripts/test-auth-error-codes-pure.cjs). This
// maps each code to a language-pack key. An answer with no code or an unknown
// one (an older Worker, a network failure, a timeout) keeps the server's own
// sentence, and then the caller's fallback.
//
// The per-identifier and per-account limits share one code on purpose, and so
// do the typed and the resolved lockout: a code must never say which bucket
// tripped, or it would tell a stranger that an identifier is an account.

export type AuthErrorTranslate = (key: string, fallback: string) => string

export const AUTH_ERROR_KEYS = {
  credentials_required: ['auth_error_credentials_required', 'Enter your username and password.'],
  invalid_credentials: ['auth_error_invalid_credentials', 'Invalid username or password.'],
  login_rate_limited_network: ['auth_error_login_rate_limited_network', 'Too many sign-in attempts from this network. Please try again later.'],
  login_rate_limited_account: ['auth_error_login_rate_limited_account', 'Too many sign-in attempts for this account. Please try again later.'],
  login_locked: ['auth_error_login_locked', 'Too many failed sign-in attempts. Please wait {seconds} seconds and try again.'],
  device_rejected: ['device_rejected', 'This device was denied access by an administrator.'],
  otp_unavailable: ['auth_error_otp_unavailable', 'Two-factor authentication is unavailable for this account. Please contact an administrator.'],
  otp_code_required: ['enter_6_digit_code', 'Please enter the 6-digit code'],
  otp_rate_limited_network: ['auth_error_otp_rate_limited_network', 'Too many code attempts from this network. Please try again later.'],
  otp_rate_limited_account: ['auth_error_otp_rate_limited_account', 'Too many code attempts for this account. Please try again later.'],
  otp_challenge_expired: ['auth_error_otp_challenge_expired', 'Your sign-in step expired. Please enter your password again.'],
  otp_invalid: ['auth_error_otp_invalid', 'Invalid code. Enter the current code and make sure your device uses automatic date and time.'],
} as const satisfies Record<string, readonly [string, string]>

export type AuthErrorCode = keyof typeof AUTH_ERROR_KEYS

type AuthErrorSource = { code?: unknown; retryAfterSeconds?: unknown; error?: unknown; message?: unknown }

function asSource(value: unknown): AuthErrorSource {
  return value && typeof value === 'object' ? value as AuthErrorSource : {}
}

// The code and the wait a thrown API error (http.ts createApiError) or a
// returned result carries, for a caller that re-shapes the error (AppContext
// login()) to pass along.
export function authErrorDetail(value: unknown): { code?: string; retryAfterSeconds?: number } {
  const source = asSource(value)
  const detail: { code?: string; retryAfterSeconds?: number } = {}
  if (typeof source.code === 'string' && source.code.trim()) detail.code = source.code.trim()
  const seconds = Number(source.retryAfterSeconds)
  if (source.retryAfterSeconds !== null && source.retryAfterSeconds !== '' && Number.isFinite(seconds) && seconds > 0) {
    detail.retryAfterSeconds = Math.ceil(seconds)
  }
  return detail
}

export function localizeAuthError(value: unknown, tr: AuthErrorTranslate, fallback: string): string {
  const source = asSource(value)
  const serverText = String(source.error || source.message || '').trim()
  const { code, retryAfterSeconds } = authErrorDetail(value)
  const entry = code && Object.prototype.hasOwnProperty.call(AUTH_ERROR_KEYS, code)
    ? AUTH_ERROR_KEYS[code as AuthErrorCode]
    : null
  if (!entry) return serverText || fallback
  const [key, english] = entry
  const text = tr(key, english)
  if (!text.includes('{seconds}')) return text
  // A lockout answer always carries its wait; without one, the server's own
  // sentence (which states it) beats a sentence with a hole in it.
  if (retryAfterSeconds === undefined) return serverText || fallback
  return text.split('{seconds}').join(String(retryAfterSeconds))
}
