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
//   $pbkdf2-sha256$i=<iterations>[$p=<pepper version>]$<salt, base64 no padding>$<32-byte key, base64 no padding>
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
//
// Pepper (owner ruling, 5 Oct 2026; NIST SP 800-63B-4: verifiers SHOULD add a
// keyed hash with a secret known only to the verifier). OWASP's pre-hashing
// construction: PBKDF2(HMAC-SHA256(key = pepper, message = password), salt, i).
// The pepper is the Worker secret PASSWORD_PEPPER -- never in D1, never in a
// backup -- so a leaked table or R2 backup cannot be cracked offline without
// it. A peppered hash records its pepper version ($p=1$). Rotation: add the
// new secret under a new name as the next version in PEPPER_SECRETS and make
// it current; keep the old secret until every hash has signed in again
// (each sign-in rewrites to the current version).
// Losing PASSWORD_PEPPER makes every peppered hash unverifiable: the owner
// keeps a backup copy outside Cloudflare (see E6-HASH-REPORT.md).
// When PASSWORD_PEPPER is unset (or shorter than 32 characters) nobody is
// locked out: unpeppered and bcrypt hashes verify as before, new hashes are
// written unpeppered, a warning is logged (never the value), and
// GET /api/users/password-hash-status answers pepperConfigured: false. Once it
// is set, every unpeppered hash is rewritten peppered on its next sign-in.
export const PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256'
export const PASSWORD_HASH_ITERATIONS = 10_000
const PREFIX = `$${PASSWORD_HASH_ALGORITHM}$`
const SALT_BYTES = 16
const KEY_BITS = 256
// A stored count outside this range is refused without deriving anything, so
// a damaged row can never make one sign-in burn unbounded CPU.
const MIN_STORED_ITERATIONS = 1_000
const MAX_STORED_ITERATIONS = 100_000

const PBKDF2_PATTERN = /^\$pbkdf2-sha256\$i=(\d{1,7})(?:\$p=(\d{1,3}))?\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/

const PEPPER_SECRETS: Readonly<Record<number, string>> = { 1: 'PASSWORD_PEPPER' }
const CURRENT_PEPPER_VERSION = 1
const MIN_PEPPER_LENGTH = 32

function pepperFor(env: unknown, version: number): string | null {
  const name = PEPPER_SECRETS[version]
  if (!name) return null
  const value = String((env as Record<string, unknown> | null | undefined)?.[name] ?? '').trim()
  return value.length >= MIN_PEPPER_LENGTH ? value : null
}

let warnedMissingPepper = false
function warnMissingPepperOnce(): void {
  if (warnedMissingPepper) return
  warnedMissingPepper = true
  console.warn('[password-hash] PASSWORD_PEPPER is not set (or shorter than 32 characters); new password hashes are written without a pepper.')
}

// The pepper version new hashes are written with: CURRENT_PEPPER_VERSION when
// its secret is configured, 0 (unpeppered) when it is not.
function writePepperVersion(env: unknown): number {
  return pepperFor(env, CURRENT_PEPPER_VERSION) ? CURRENT_PEPPER_VERSION : 0
}

export function passwordPepperStatus(env: unknown): { configured: boolean; version: number | null } {
  const version = writePepperVersion(env)
  return { configured: version > 0, version: version || null }
}
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export type PasswordHashScheme = 'pbkdf2-sha256' | 'bcrypt' | 'unknown'

export type PasswordVerdict = {
  ok: boolean
  // True only when ok: the stored hash should be rewritten with hashPassword.
  needsRehash: boolean
  scheme: PasswordHashScheme
}

// The exact prefix a hash written now would start with, and the checks the
// readiness report (GET /api/users/password-hash-status) counts with.
export function currentPasswordHashPrefix(env: unknown): string {
  const pepperVersion = writePepperVersion(env)
  return `${PREFIX}i=${PASSWORD_HASH_ITERATIONS}$${pepperVersion ? `p=${pepperVersion}$` : ''}`
}
export function describePasswordHash(stored: unknown): { scheme: PasswordHashScheme; iterations: number | null; pepperVersion: number | null } {
  const value = String(stored ?? '')
  const match = PBKDF2_PATTERN.exec(value)
  if (match) return { scheme: 'pbkdf2-sha256', iterations: Number(match[1]), pepperVersion: match[2] ? Number(match[2]) : 0 }
  return { scheme: BCRYPT_PATTERN.test(value) ? 'bcrypt' : 'unknown', iterations: null, pepperVersion: null }
}
export function isCurrentPasswordHash(stored: unknown, env: unknown): boolean {
  const hash = describePasswordHash(stored)
  return hash.scheme === 'pbkdf2-sha256' && hash.iterations === PASSWORD_HASH_ITERATIONS && hash.pepperVersion === writePepperVersion(env)
}

export function passwordHashScheme(stored: unknown): PasswordHashScheme {
  return describePasswordHash(stored).scheme
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

// The PBKDF2 input: the password's UTF-8 bytes, or HMAC-SHA256(pepper, password).
async function passwordMaterial(password: string, pepper: string | null): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(password)
  if (!pepper) return bytes
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))
}

async function deriveKey(password: string, pepper: string | null, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', await passwordMaterial(password, pepper), 'PBKDF2', false, ['deriveBits'])
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

// env is the Worker env; only the pepper secret is read from it.
export async function hashPassword(password: string, env: unknown): Promise<string> {
  const pepperVersion = writePepperVersion(env)
  if (!pepperVersion) warnMissingPepperOnce()
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const key = await deriveKey(String(password ?? ''), pepperVersion ? pepperFor(env, pepperVersion) : null, salt, PASSWORD_HASH_ITERATIONS)
  return `${currentPasswordHashPrefix(env)}${toBase64(salt)}$${toBase64(key)}`
}

export async function verifyPassword(password: string, stored: unknown, env: unknown): Promise<PasswordVerdict> {
  const plain = String(password ?? '')
  const value = String(stored ?? '')
  const pbkdf2 = PBKDF2_PATTERN.exec(value)
  if (pbkdf2) {
    const iterations = Number(pbkdf2[1])
    if (iterations < MIN_STORED_ITERATIONS || iterations > MAX_STORED_ITERATIONS) {
      return { ok: false, needsRehash: false, scheme: 'pbkdf2-sha256' }
    }
    const pepperVersion = pbkdf2[2] ? Number(pbkdf2[2]) : 0
    const pepper = pepperVersion ? pepperFor(env, pepperVersion) : null
    if (pepperVersion && !pepper) {
      // A peppered hash whose secret is not configured cannot be checked.
      console.warn(`[password-hash] a hash needs pepper version ${pepperVersion}, whose secret is not configured.`)
      return { ok: false, needsRehash: false, scheme: 'pbkdf2-sha256' }
    }
    const expected = fromBase64(pbkdf2[4])
    const actual = await deriveKey(plain, pepper, fromBase64(pbkdf2[3]), iterations)
    const ok = constantTimeEqual(actual, expected)
    const current = iterations === PASSWORD_HASH_ITERATIONS && pepperVersion === writePepperVersion(env)
    return { ok, needsRehash: ok && !current, scheme: 'pbkdf2-sha256' }
  }
  if (BCRYPT_PATTERN.test(value)) {
    const ok = bcrypt.compareSync(plain, value)
    return { ok, needsRehash: ok, scheme: 'bcrypt' }
  }
  return { ok: false, needsRehash: false, scheme: 'unknown' }
}

// Rewrite a hash that verified but is not current (legacy bcrypt, another
// iteration count, unpeppered while a pepper is configured, an old pepper).
// Compare-and-set on the exact old value: two sign-ins racing on the same
// legacy hash rewrite it once, and a password changed in between is never
// overwritten. updated_at is deliberately left alone -- it
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
  env: unknown,
): Promise<boolean> {
  try {
    const next = await hashPassword(password, env)
    const result = await db.prepare(UPGRADE_SQL[table]).run({ next, id: Number(id), previous: String(previous ?? '') })
    return Number(result?.changes || 0) === 1
  } catch (error) {
    console.warn(`[password-hash] upgrade skipped for ${table} ${Number(id)}:`, String((error as Error)?.message || error))
    return false
  }
}

// A sign-in that resolves no usable account spends the same work as a real
// current-format check (the pepper HMAC when one is configured, one import +
// one derivation at the current count + one compare), so the answer time
// does not reveal whether the account exists. The salt and expected key are
// fixed values nobody's password maps to.
const DUMMY_SALT = fromBase64('c2lnbi1pbi1kdW1teS1zYQ')
const DUMMY_KEY = fromBase64('ZHVtbXkta2V5LW5vYm9keS1ob2xkcy10aGlzLXZhbCE')
export async function spendDummyPasswordVerify(password: string, env: unknown): Promise<void> {
  const pepperVersion = writePepperVersion(env)
  const actual = await deriveKey(String(password ?? ''), pepperVersion ? pepperFor(env, pepperVersion) : null, DUMMY_SALT, PASSWORD_HASH_ITERATIONS)
  constantTimeEqual(actual, DUMMY_KEY)
}
