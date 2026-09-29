// The rule for every NEW password, identical to the Worker's
// (cloudflare/src/lib/passwordPolicy.ts newPasswordProblem; parity test
// tests/passwordRules.test.ts). The server stays the authority; this only
// saves a round trip and says the problem in the operator's language.
export const MIN_PASSWORD_LENGTH = 6
export const MAX_PASSWORD_BYTES = 72
const KHMER_LETTER_BYTES = 3

export type NewPasswordProblem = 'password_too_short' | 'password_edge_whitespace' | 'password_too_long'
type Translate = (key: string, fallback: string) => string

const NEW_PASSWORD_PROBLEMS: readonly string[] = ['password_too_short', 'password_edge_whitespace', 'password_too_long']

export function isNewPasswordProblem(code: string): code is NewPasswordProblem {
  return NEW_PASSWORD_PROBLEMS.includes(code)
}

export function newPasswordProblem(password: string): NewPasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'password_too_short'
  if (password !== password.trim()) return 'password_edge_whitespace'
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return 'password_too_long'
  return null
}

export function passwordProblemMessage(problem: NewPasswordProblem, tr: Translate): string {
  if (problem === 'password_too_short') {
    return tr('password_too_short', 'Use at least {min} characters.').replace('{min}', String(MIN_PASSWORD_LENGTH))
  }
  if (problem === 'password_edge_whitespace') {
    return tr('password_edge_whitespace', 'Remove the space at the start or end of the password.')
  }
  return tr('password_too_long', 'Too long: at most {max} characters ({khmer} in Khmer).')
    .replace('{max}', String(MAX_PASSWORD_BYTES))
    .replace('{khmer}', String(MAX_PASSWORD_BYTES / KHMER_LETTER_BYTES))
}

const PASSWORD_KNOWN_LEAKED_CODE = 'password_known_leaked'

// The Worker's refusal of a new password, from a `{ success: false, code }`
// answer or a thrown ApiError carrying `code`; null for any other failure.
export function newPasswordRefusalMessage(value: unknown, tr: Translate): string | null {
  const code = value && typeof value === 'object' ? String((value as { code?: unknown }).code || '') : ''
  if (isNewPasswordProblem(code)) return passwordProblemMessage(code, tr)
  if (code === PASSWORD_KNOWN_LEAKED_CODE) return tr('password_known_leaked', 'This password is publicly known. Choose a different password.')
  return null
}
