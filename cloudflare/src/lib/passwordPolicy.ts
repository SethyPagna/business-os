// Single source of truth for the app's minimum password length.
//
// Before this file existed, four different endpoints each enforced (or
// didn't enforce) their own rule:
//   - POST /api/auth/password-reset/complete (email link reset): 6 chars,
//     via a local `MIN_PASSWORD_LENGTH` const in routes/auth.ts
//   - POST /api/auth/password-reset/otp: 4 chars, hardcoded inline
//   - POST /api/users (create user) and the shared handlePasswordChange
//     used by /users/:id/change-password + /users/:id/reset-password:
//     no server-side length check at all -- only the frontend's own
//     (also-inconsistent, 4-char) check stood between a client and a
//     one-character password via a direct API call.
// Frontend mirrored the same split: Login.tsx used 6 chars for the email
// reset flow and 4 for the OTP reset flow; Users.tsx and
// UserProfileModal.tsx both used 4. Standardized everywhere on the
// stricter existing value (6) rather than the weaker one, since loosening
// the email-reset path would have been the wrong direction to converge.
export const MIN_PASSWORD_LENGTH = 6

export function passwordTooShort(password: unknown): boolean {
  return String(password ?? '').length < MIN_PASSWORD_LENGTH
}

export function passwordMinLengthError(): string {
  return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
}

// Passwords that are public because they sit in this repository's git
// history (S-auth4b, 27 Sep 2026): the Worker's old seed fallback, and the
// local-dev demo seed (lib/coreDataInvariants.ts LOCAL_DEV_ADMIN_PASSWORD),
// which is only tolerated in local development. History cannot be
// rewritten, so the server refuses to SET either one and forces a change when
// someone signs in with one.
//
// Held as SHA-256 hex digests, not literals: the old seed literal must appear
// nowhere in cloudflare/src (test-admin-reseed-never-default-password-pure.cjs),
// so it can never be pasted back in as a default. Exact match on the value as
// typed and as trimmed (the user routes trim before hashing). The plaintext is
// only ever hashed here; never log it.
const KNOWN_LEAKED_PASSWORD_SHA256: readonly string[] = [
  'db735458867474ed3163fd668a7324d4c03853bec77d1ab3dc2f070ad92d80dc', // old seed fallback (12 chars)
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // local-dev demo seed
]
const LOCAL_DEV_ONLY_PASSWORD_SHA256: readonly string[] = [
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
]

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const KNOWN_LEAKED_PASSWORD_CODE = 'password_known_leaked'
export const KNOWN_LEAKED_PASSWORD_ERROR = 'This password is publicly known. Choose a different password.'

// Same two signals lib/coreDataInvariants.ts resolveSeedAdminPassword() uses
// for local development: BUSINESS_OS_LOCAL_DEV=1/true (only `wrangler dev`
// reads .dev.vars) AND an unstamped build (scripts/deploy.cjs stamps every
// production deploy). Either alone is not local dev.
declare const __WORKER_BUILD_REVISION__: string | undefined
function isLocalDevRuntime(env: unknown): boolean {
  const flag = String((env as { BUSINESS_OS_LOCAL_DEV?: string } | null)?.BUSINESS_OS_LOCAL_DEV ?? '').trim().toLowerCase()
  if (flag !== '1' && flag !== 'true') return false
  const revision = typeof __WORKER_BUILD_REVISION__ !== 'undefined' ? String(__WORKER_BUILD_REVISION__ ?? '').trim() : ''
  return !revision || revision === 'dev'
}

export async function passwordKnownLeaked(password: unknown, env: unknown): Promise<boolean> {
  const raw = String(password ?? '')
  // Every known entry is 8-12 characters; skip hashing anything else.
  const candidates = (raw === raw.trim() ? [raw] : [raw, raw.trim()]).filter((value) => value.length >= 8 && value.length <= 12)
  if (!candidates.length) return false
  const localDev = isLocalDevRuntime(env)
  for (const value of candidates) {
    const digest = await sha256Hex(value)
    if (KNOWN_LEAKED_PASSWORD_SHA256.includes(digest) && !(localDev && LOCAL_DEV_ONLY_PASSWORD_SHA256.includes(digest))) return true
  }
  return false
}

// users.must_change_password (migration 0202). Set when a sign-in used a
// known-leaked password; cleared by every path that writes a new password.
// Tolerates the column being absent (Worker deployed before 0202 applied):
// the flag is then simply not recorded, and nothing else fails.
type RunnableDb = { prepare(sql: string): { run(params?: unknown): Promise<unknown> } }
export async function setPasswordMustChange(db: RunnableDb, userId: number | string, mustChange: boolean): Promise<void> {
  try {
    await db.prepare('UPDATE users SET must_change_password = @flag WHERE id = @id').run({ flag: mustChange ? 1 : 0, id: Number(userId) })
  } catch (error) {
    if (/no such column/i.test(String((error as Error)?.message || error))) return
    throw error
  }
}
