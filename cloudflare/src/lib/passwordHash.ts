import bcrypt from 'bcryptjs'

// The ONE password hashing module (E6, 5 Oct 2026). Every staff and storefront
// password is hashed and checked here; no route calls bcryptjs directly.
//
// Why not bcrypt any more: bcryptjs is pure JavaScript, and one cost-10
// compare or hash measured ~150 ms of CPU in Node and more inside workerd
// on the lane laptop. The Workers Free plan allows 10 ms of CPU per request
// (developers.cloudflare.com/workers/platform/limits, 5 Oct 2026), and
// WebCrypto work is CPU time like any other: only waiting on I/O is free.
// PBKDF2-HMAC-SHA256 through crypto.subtle runs natively instead.
//
// Stored format (self-describing, so no schema change and no version column):
//   $pbkdf2-sha256$i=<iterations>$<salt, base64 no padding>$<32-byte key, base64 no padding>
// The iteration count travels with each hash, so changing
// PASSWORD_HASH_ITERATIONS never breaks an existing hash: the old count still
// verifies, and the next successful sign-in rewrites it at the new count.
//
// Legacy bcrypt hashes ($2a$/$2b$/$2y$) still verify on every plan -- refusing
// them would lock out whoever has not signed in since this shipped, the owner
// included. A successful sign-in on one reports needsRehash, and the caller
// rewrites it once (compare-and-set on the old value). See
// Records/Lanes/2026-10-05/E6-HASH-REPORT.md for the Free-move campaign.
//
// Iterations: OWASP's Password Storage Cheat Sheet recommends 600,000 for
// PBKDF2-HMAC-SHA256; NIST SP 800-63B says "as large as verification server
// performance will allow, typically at least 10,000". 600,000 cannot fit a
// 10 ms CPU budget, so this is the NIST floor, chosen to leave room for the
// rest of a sign-in request. Raise it only after reading the sign-in CPU time
// in Workers Logs; every hash then upgrades on its next sign-in.
export const PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256'
export const PASSWORD_HASH_ITERATIONS = 10_000
const PREFIX = `$${PASSWORD_HASH_ALGORITHM}$`
const SALT_BYTES = 16
const KEY_BITS = 256
// A stored count outside this range is refused without deriving anything, so
// a damaged row can never make one sign-in burn unbounded CPU.
const MIN_STORED_ITERATIONS = 1_000
const MAX_STORED_ITERATIONS = 100_000

const PBKDF2_PATTERN = /^\$pbkdf2-sha256\$i=(\d{1,7})\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export type PasswordHashScheme = 'pbkdf2-sha256' | 'bcrypt' | 'unknown'

export type PasswordVerdict = {
  ok: boolean
  // True only when ok: the stored hash should be rewritten with hashPassword.
  needsRehash: boolean
  scheme: PasswordHashScheme
}

// The exact prefix of a hash written at the current count, and the check
// the readiness report (GET /api/users/password-hash-status) counts with.
export const CURRENT_PASSWORD_HASH_PREFIX = `${PREFIX}i=${PASSWORD_HASH_ITERATIONS}$`
export function isCurrentPasswordHash(stored: unknown): boolean {
  const match = PBKDF2_PATTERN.exec(String(stored ?? ''))
  return Boolean(match) && Number(match?.[1]) === PASSWORD_HASH_ITERATIONS
}

export function passwordHashScheme(stored: unknown): PasswordHashScheme {
  const value = String(stored ?? '')
  if (PBKDF2_PATTERN.test(value)) return 'pbkdf2-sha256'
  if (BCRYPT_PATTERN.test(value)) return 'bcrypt'
  return 'unknown'
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/, '')
}

function fromBase64(text: string): Uint8Array {
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, KEY_BITS)
  return new Uint8Array(bits)
}

// Length is fixed (32 bytes) for every caller; the loop never exits early.
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const key = await deriveKey(String(password ?? ''), salt, PASSWORD_HASH_ITERATIONS)
  return `${PREFIX}i=${PASSWORD_HASH_ITERATIONS}$${toBase64(salt)}$${toBase64(key)}`
}

export async function verifyPassword(password: string, stored: unknown): Promise<PasswordVerdict> {
  const plain = String(password ?? '')
  const value = String(stored ?? '')
  const pbkdf2 = PBKDF2_PATTERN.exec(value)
  if (pbkdf2) {
    const iterations = Number(pbkdf2[1])
    if (iterations < MIN_STORED_ITERATIONS || iterations > MAX_STORED_ITERATIONS) {
      return { ok: false, needsRehash: false, scheme: 'pbkdf2-sha256' }
    }
    const expected = fromBase64(pbkdf2[3])
    const actual = await deriveKey(plain, fromBase64(pbkdf2[2]), iterations)
    const ok = constantTimeEqual(actual, expected)
    return { ok, needsRehash: ok && iterations !== PASSWORD_HASH_ITERATIONS, scheme: 'pbkdf2-sha256' }
  }
  if (BCRYPT_PATTERN.test(value)) {
    const ok = bcrypt.compareSync(plain, value)
    return { ok, needsRehash: ok, scheme: 'bcrypt' }
  }
  return { ok: false, needsRehash: false, scheme: 'unknown' }
}

// Rewrite a hash that verified but is not current (legacy bcrypt, or another
// iteration count). Compare-and-set on the exact old value: two sign-ins
// racing on the same legacy hash rewrite it once, and a password changed in
// between is never overwritten. updated_at is deliberately left alone -- it
// is the edit-conflict token for the Users page and the Contacts card, and
// a re-encoding of the same password is not an edit anyone made. Never throws:
// a failed upgrade leaves the old (still valid) hash and the sign-in goes on.
type UpgradeDb = { prepare(sql: string): { run(params?: Record<string, unknown>): Promise<{ changes?: number }> } }
const UPGRADE_SQL = {
  users: 'UPDATE users SET password = @next WHERE id = @id AND password = @previous',
  portal_accounts: 'UPDATE portal_accounts SET password_hash = @next WHERE id = @id AND password_hash = @previous',
} as const
export async function upgradePasswordHash(
  db: UpgradeDb,
  table: keyof typeof UPGRADE_SQL,
  id: number | string,
  password: string,
  previous: string,
): Promise<boolean> {
  try {
    const next = await hashPassword(password)
    const result = await db.prepare(UPGRADE_SQL[table]).run({ next, id: Number(id), previous: String(previous ?? '') })
    return Number(result?.changes || 0) === 1
  } catch (error) {
    console.warn(`[password-hash] upgrade skipped for ${table} ${Number(id)}:`, String((error as Error)?.message || error))
    return false
  }
}

// A sign-in that resolves no usable account spends the same work as a real
// current-format check (one import + one derivation at the current count +
// one compare), so the answer time does not reveal whether the account
// exists. The salt and expected key are fixed values nobody's password maps to.
const DUMMY_SALT = fromBase64('c2lnbi1pbi1kdW1teS1zYQ')
const DUMMY_KEY = fromBase64('ZHVtbXkta2V5LW5vYm9keS1ob2xkcy10aGlzLXZhbCE')
export async function spendDummyPasswordVerify(password: string): Promise<void> {
  const actual = await deriveKey(String(password ?? ''), DUMMY_SALT, PASSWORD_HASH_ITERATIONS)
  constantTimeEqual(actual, DUMMY_KEY)
}
