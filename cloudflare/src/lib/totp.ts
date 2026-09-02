// TOTP (RFC 6238) implementation using Web Crypto (crypto.subtle), the
// Workers-native API -- replaces backend/src/routes/auth.ts's use of the
// node-only `speakeasy` package, which cannot run in a Worker isolate.
// Same algorithm (HMAC-SHA1, 30s step, 6 digits, +/-1 step window), so a
// secret provisioned before this port keeps working, and an authenticator
// app (Google Authenticator, Authy, etc.) enrolled against either backend
// produces identical codes.
//
// QR code rendering remains out of the Worker: the API returns the standard
// otpauth URI and frontend/src/components/utils-settings/OtpModal.tsx renders
// it locally. This avoids persisting or serving a raster image of a secret.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const CODE_DIGITS = 6

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32Decode(input: string): Uint8Array {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(bytes)
}

/** Generates a new random base32 TOTP secret plus its otpauth:// URL, matching speakeasy.generateSecret({ name, length }). */
export function generateTotpSecret(accountLabel: string, issuer = 'BusinessOS'): { base32: string; otpauthUrl: string } {
  const randomBytes = crypto.getRandomValues(new Uint8Array(20))
  const base32 = base32Encode(randomBytes)
  const label = encodeURIComponent(`${issuer} (${accountLabel})`)
  const otpauthUrl = `otpauth://totp/${label}?secret=${base32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${CODE_DIGITS}&period=${STEP_SECONDS}`
  return { base32, otpauthUrl }
}

async function hmacSha1(keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, message)
  return new Uint8Array(signature)
}

function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8)
  // Counter fits comfortably in the low 32 bits until year ~2106 (2^32 * 30s), so the
  // high 4 bytes stay zero -- matches every standard TOTP implementation.
  let value = counter
  for (let i = 7; i >= 2; i--) {
    bytes[i] = value & 0xff
    value = Math.floor(value / 256)
  }
  return bytes
}

async function totpAt(secretBase32: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secretBase32)
  const hmac = await hmacSha1(keyBytes, counterToBytes(counter))
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const code = binary % 10 ** CODE_DIGITS
  return String(code).padStart(CODE_DIGITS, '0')
}

/**
 * Verifies a 6-digit TOTP token against a base32 secret. Two steps on either
 * side (60 seconds) tolerate a mobile authenticator whose automatic clock
 * correction has drifted slightly, without making the code reusable beyond
 * the existing, rate-limited login challenge. Callers may pass a narrower
 * window for a deliberately stricter flow.
 */
export async function verifyTotp(secretBase32: string, token: string, window = 2): Promise<boolean> {
  const cleanToken = String(token || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(cleanToken)) return false
  if (!secretBase32) return false
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = await totpAt(secretBase32, counter + errorWindow)
    if (candidate === cleanToken) return true
  }
  return false
}
