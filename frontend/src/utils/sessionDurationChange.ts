// The server accepts a longer login duration only with the current password. It is asked first and the device record
// changes only after it accepted; a refusal comes back as a value and never signs anybody out (only a 401 does, in the transport).

export const SESSION_DURATION_PASSWORD_REQUIRED = 'session_duration_password_required'

export type SessionDurationApplied = {
  success: true
  sessionDuration: string
  sessionExpiresAt: string
}

export type SessionDurationRefusal = {
  success: false
  code: string
  error: string
  status: number | null
  retryAfterSeconds: number | null
}

export type SessionDurationOutcome = SessionDurationApplied | SessionDurationRefusal

export type SessionDurationChange = {
  sessionDuration: unknown
  currentPassword?: string
  refresh: ((sessionDuration: string, currentPassword: string) => Promise<unknown>) | null
  persist: (applied: SessionDurationApplied) => void
}

type Translate = (key: string, fallback: string) => string

export function normalizeSessionDuration(value: unknown): string {
  return String(value || '').trim() || 'session'
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function refusalOf(source: unknown): SessionDurationRefusal {
  const detail = source && typeof source === 'object' ? source as Record<string, unknown> : {}
  const message = typeof detail.error === 'string' && detail.error ? detail.error : typeof detail.message === 'string' ? detail.message : ''
  return {
    success: false,
    code: typeof detail.code === 'string' && detail.code ? detail.code : 'session_duration_failed',
    error: message,
    status: numberOrNull(detail.status),
    retryAfterSeconds: numberOrNull(detail.retryAfterSeconds),
  }
}

export async function changeSessionDuration(change: SessionDurationChange): Promise<SessionDurationOutcome> {
  const sessionDuration = normalizeSessionDuration(change.sessionDuration)
  let sessionExpiresAt = ''
  if (change.refresh) {
    try {
      const answer = await change.refresh(sessionDuration, String(change.currentPassword ?? ''))
      if (answer && typeof answer === 'object' && (answer as { success?: unknown }).success === false) return refusalOf(answer)
      const expiresAt = answer && typeof answer === 'object' ? (answer as { sessionExpiresAt?: unknown }).sessionExpiresAt : ''
      sessionExpiresAt = typeof expiresAt === 'string' ? expiresAt : ''
    } catch (error) {
      return refusalOf(error)
    }
  }
  const applied: SessionDurationApplied = { success: true, sessionDuration, sessionExpiresAt }
  change.persist(applied)
  return applied
}

export function sessionDurationRefusalMessage(refusal: SessionDurationRefusal, tr: Translate): string | null {
  switch (refusal.code) {
    case SESSION_DURATION_PASSWORD_REQUIRED:
      return tr('session_duration_password_required', 'Enter your current password to stay signed in for longer.')
    case 'incorrect_password':
      return tr('current_password_incorrect', 'The current password is not correct.')
    case 'current_password_rate_limited':
      return tr('current_password_rate_limited', 'Too many wrong current-password attempts. Wait 15 minutes, then try again.')
    case 'session_duration_rate_limited':
      return tr('session_duration_rate_limited', 'Too many login duration changes. Try again later.')
    default:
      return null
  }
}
