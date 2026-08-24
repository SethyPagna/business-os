// Ported from backend/src/security.ts's encryptSecret/decryptSecret, using
// crypto.subtle (Web Crypto, Workers-native) instead of node:crypto. Same
// envelope format (`enc:v1:<iv>:<tag>:<ciphertext>`, all base64url) and same
// graceful fallback when no key is configured: encryptSecret returns the
// plaintext unchanged and decryptSecret returns '' for anything it can't
// read back. This means AI provider API keys are stored in plaintext in D1
// until an APP_ENCRYPTION_KEY secret is set (`wrangler secret put
// APP_ENCRYPTION_KEY`), exactly like the Node backend behaves without
// process.env.APP_ENCRYPTION_KEY -- not a regression, just a to-do for
// production hardening.

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

export async function encryptSecret(plainText: string | null | undefined, encryptionKey: string | undefined): Promise<string> {
  const text = String(plainText || '')
  if (!text) return ''
  const keyBytes = normalizeEncryptionKeyBytes(encryptionKey)
  if (!keyBytes) return text

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

export function maskApiKey(value: string): string {
  const key = String(value || '').trim()
  if (!key) return ''
  if (key.length <= 8) return `${key.slice(0, 2)}***${key.slice(-1)}`
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}
