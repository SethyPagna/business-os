// The Worker answers a re-entered current password that has hit its limit
// with 429 `code: 'current_password_rate_limited'` (routes/users.ts
// refuseWrongCurrentPassword, routes/auth.ts /oauth/unlink; the rule is
// cloudflare/src/lib/currentPasswordGuard.ts: 10 wrong attempts per session,
// 15 minutes). Every screen that re-enters the current password -- My
// Profile's save, password change and Google disconnect, and the Users page
// password change -- shows it in the operator's language instead of the
// server's English sentence (U-profile3, refuter X5).
export const CURRENT_PASSWORD_RATE_LIMITED_CODE = 'current_password_rate_limited'

// Works on a thrown ApiError (http.ts createApiError carries `code`) and on a
// `{ success: false, code }` result object alike.
export function isCurrentPasswordRateLimited(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return (value as { code?: unknown }).code === CURRENT_PASSWORD_RATE_LIMITED_CODE
}

export function currentPasswordRateLimitMessage(value: unknown, tr: (key: string, fallback: string) => string): string | null {
  if (!isCurrentPasswordRateLimited(value)) return null
  return tr('current_password_rate_limited', 'Too many wrong current-password attempts. Wait 15 minutes, then try again.')
}
