// Ported from backend/src/security.ts's encryptSecret/decryptSecret, using
// crypto.subtle (Web Crypto, Workers-native) instead of node:crypto. Same
// envelope format (`enc:v1:<iv>:<tag>:<ciphertext>`, all base64url).
//
// Key policy (Sep 26 2026, security lane S-secrets):
//   - WRITES refuse without a usable APP_ENCRYPTION_KEY. encryptSecret throws
//     MissingEncryptionKeyError instead of silently returning the plaintext,
//     which is what it used to do -- that stored Google Drive refresh tokens,
//     TOTP secrets and AI provider API keys in D1 in the clear.
//   - READS stay tolerant so a deployment that ran without the key keeps
//     working: a legacy plaintext value (no `enc:v1:` prefix) is returned
//     as-is, and an encrypted value decrypts when the key is present ('' when
//     it is not, exactly as before).
//   - Re-encryption: once the key is set, every write goes through
//     encryptSecret and so lands encrypted. For values that are only ever
//     read (a Drive refresh token), upgradeLegacySecret() returns the
//     encrypted replacement a caller can persist opportunistically.
// There is no local-dev plaintext mode: the Worker has no env signal that
// reliably means "local", and .dev.vars is pushed to production by
// scripts/sync-secrets.cjs, so any opt-out flag placed there would ship.
// Local dev sets APP_ENCRYPTION_KEY in .dev.vars like production does.

const ENC_PREFIX = 'enc:v1'

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function normalizeEncryptionKeyBytes(rawValue: string | undefined | null): Uint8Array | null {
  const value = String(rawValue || '').trim()
  if (!value) return null

  if (/^[a-f0-9]{64}$/i.test(value)) {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
    return bytes
  }

  try {
    const b64 = base64UrlDecode(value.replace(/-/g, '+').replace(/_/g, '/'))
    if (b64.length === 32) return b64
  } catch (_) {}

  const utf8 = new TextEncoder().encode(value)
  if (utf8.length === 32) return utf8
  return null
}

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export const MISSING_ENCRYPTION_KEY_MESSAGE =
  'APP_ENCRYPTION_KEY is not set; set it before connecting Google Drive, enrolling two-factor sign-in, or saving an AI provider key.'

export class MissingEncryptionKeyError extends Error {
  readonly code = 'APP_ENCRYPTION_KEY_MISSING'
  constructor(message: string = MISSING_ENCRYPTION_KEY_MESSAGE) {
    super(message)
    this.name = 'MissingEncryptionKeyError'
  }
}

// True when the key is present AND decodes to 32 bytes (hex, base64/url or
// raw UTF-8). A malformed key counts as missing: encrypting with it is
// impossible, and silently falling back to plaintext is what this replaces.
export function hasEncryptionKey(encryptionKey: string | undefined | null): boolean {
  return normalizeEncryptionKeyBytes(encryptionKey) !== null
}

// Health readout for the owner (integration doctor, admin only). A boolean
// and a fixed message -- never the key, its length, or anything derived
// from it. "Invalid" (set but not 32 bytes) reports the same as missing:
// either way no secret can be written.
export function secretEncryptionStatus(encryptionKey: string | undefined | null) {
  const configured = hasEncryptionKey(encryptionKey)
  return {
    ok: configured,
    status: configured ? 'ok' : 'needs_attention',
    configured,
    message: configured
      ? 'APP_ENCRYPTION_KEY is configured; stored API keys and tokens are encrypted.'
      : 'APP_ENCRYPTION_KEY is missing or invalid; saving AI provider keys, connecting Google Drive and enrolling two-factor sign-in are refused until it is set.',
  }
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return String(value || '').startsWith(`${ENC_PREFIX}:`)
}

export async function encryptSecret(plainText: string | null | undefined, encryptionKey: string | undefined): Promise<string> {
  const text = String(plainText || '')
  // Empty stays empty: clearing a stored secret (disconnect, reset) must keep
  // working on a deployment with no key.
  if (!text) return ''
  const keyBytes = normalizeEncryptionKeyBytes(encryptionKey)
  if (!keyBytes) throw new MissingEncryptionKeyError()

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importKey(keyBytes)
  const encoded = new TextEncoder().encode(text)
  // Web Crypto's AES-GCM output is ciphertext with the 16-byte auth tag
  // appended -- split it back out so the on-disk envelope stays identical
  // in shape to the Node backend's (iv : tag : ciphertext separately).
  const combined = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded))
  const tag = combined.slice(combined.length - 16)
  const ciphertext = combined.slice(0, combined.length - 16)

  return `${ENC_PREFIX}:${base64UrlEncode(iv)}:${base64UrlEncode(tag)}:${base64UrlEncode(ciphertext)}`
}

export async function decryptSecret(cipherText: string | null | undefined, encryptionKey: string | undefined): Promise<string> {
  const text = String(cipherText || '')
  if (!text) return ''
  if (!text.startsWith(`${ENC_PREFIX}:`)) return text
  const keyBytes = normalizeEncryptionKeyBytes(encryptionKey)
  if (!keyBytes) return ''

  const parts = text.split(':')
  if (parts.length !== 5) return ''
  try {
    const iv = base64UrlDecode(parts[2])
    const tag = base64UrlDecode(parts[3])
    const ciphertext = base64UrlDecode(parts[4])
    const combined = new Uint8Array(ciphertext.length + tag.length)
    combined.set(ciphertext, 0)
    combined.set(tag, ciphertext.length)
    const key = await importKey(keyBytes)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined)
    return new TextDecoder().decode(plain)
  } catch (_) {
    return ''
  }
}

// Idempotent upgrade for a value read from storage: returns the encrypted
// replacement when the value is legacy plaintext AND a key is configured, or
// null when there is nothing to do (empty, already encrypted, or no key --
// never throws, so it is safe on a read path).
export async function upgradeLegacySecret(storedValue: string | null | undefined, encryptionKey: string | undefined): Promise<string | null> {
  const text = String(storedValue || '')
  if (!text || isEncryptedSecret(text) || !hasEncryptionKey(encryptionKey)) return null
  return encryptSecret(text, encryptionKey)
}

export function maskApiKey(value: string): string {
  const key = String(value || '').trim()
  if (!key) return ''
  if (key.length <= 8) return `${key.slice(0, 2)}***${key.slice(-1)}`
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}
