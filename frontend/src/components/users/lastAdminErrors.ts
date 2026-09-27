// The Worker refuses any user or role write that would leave no active
// administrator with 409 `code: 'last_admin_required'`
// (cloudflare/src/lib/adminControlGuard.ts, FX-sec2). The Users page -- the
// only screen that writes a user's role, status or permissions or a role's
// permissions -- shows it in the operator's language on save and on the
// Undo/Redo of an edit, the same way currentPasswordErrors.ts does.
export const LAST_ADMIN_REQUIRED_CODE = 'last_admin_required'

// Works on a thrown ApiError (http.ts createApiError carries `code`) and on a
// `{ success: false, code }` result object alike.
export function isLastAdminRequired(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return (value as { code?: unknown }).code === LAST_ADMIN_REQUIRED_CODE
}

export function lastAdminRequiredMessage(value: unknown, tr: (key: string, fallback: string) => string): string | null {
  if (!isLastAdminRequired(value)) return null
  return tr('last_admin_required', 'This change would leave no active administrator. Give another active user the admin role first. No changes were saved.')
}

// Undo/Redo show a thrown error's own message (utils/actionHistory.ts), so the
// refusal is rethrown carrying the translated sentence; any other error is
// returned untouched for the caller to rethrow.
export function lastAdminRequiredError(error: unknown, tr: (key: string, fallback: string) => string): unknown {
  const message = lastAdminRequiredMessage(error, tr)
  return message ? Object.assign(new Error(message), { code: LAST_ADMIN_REQUIRED_CODE }) : error
}
