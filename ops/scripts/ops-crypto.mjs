// Hybrid encryption for ops exports (.github/workflows/ops.yml).
//
// The repository is public, so its Actions artifacts can be downloaded by
// anyone with a GitHub account. Every export is therefore encrypted on the
// runner before it is written: a fresh random AES-256-GCM key per file, and
// that key wrapped with RSA-OAEP (SHA-256) under ops/keys/ops-export-public.pem.
// Only the holder of the matching private key -- kept on the owner's machine,
// never in this repository -- can read an export (ops/scripts/ops-decrypt.mjs).
//
// Envelope (JSON):
//   format      FORMAT below
//   header      JSON string: { alg, keyFingerprint, meta }. NOT secret -- it
//               is authenticated (GCM additional data) but readable by anyone
//               who downloads the artifact, so meta must never carry data.
//   wrappedKey  base64, RSA-OAEP-SHA256(AES key)
//   iv          base64, 12 bytes
//   tag         base64, 16-byte GCM tag
//   ciphertext  base64

import crypto from 'node:crypto'

export const FORMAT = 'business-os-ops-envelope/1'
export const ALGORITHM = 'RSA-OAEP-SHA256+AES-256-GCM'
export const MIN_RSA_BITS = 2048

const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }
const B64 = /^[A-Za-z0-9+/]*={0,2}$/

function additionalData(header) {
  return Buffer.from(`${FORMAT}\n${header}`, 'utf8')
}

function requireRsa(key, what) {
  if (key.asymmetricKeyType !== 'rsa') throw new Error(`The ${what} must be an RSA key.`)
  const bits = key.asymmetricKeyDetails?.modulusLength || 0
  if (bits < MIN_RSA_BITS) throw new Error(`The ${what} is ${bits}-bit RSA; at least ${MIN_RSA_BITS} bits are required.`)
  return key
}

// sha256 over the DER SubjectPublicKeyInfo -- identifies a keypair without
// revealing anything about it.
export function publicKeyFingerprint(key) {
  const publicKey = key.type === 'private' ? crypto.createPublicKey(key) : key
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`
}

export function loadPublicKey(pem) {
  const text = String(pem)
  if (/PRIVATE KEY/.test(text)) throw new Error('Expected a PUBLIC key; refusing a private key.')
  return requireRsa(crypto.createPublicKey(text), 'ops export public key')
}

export function loadPrivateKey(pem, passphrase) {
  const options = { key: pem }
  if (passphrase) options.passphrase = passphrase
  return requireRsa(crypto.createPrivateKey(options), 'private key')
}

function safeMeta(meta) {
  const out = {}
  for (const [name, value] of Object.entries(meta || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(name)) throw new Error('Envelope meta names must be short identifiers.')
    if (value === null || typeof value === 'number' || typeof value === 'boolean') out[name] = value
    else if (typeof value === 'string' && value.length <= 128) out[name] = value
    else throw new Error('Envelope meta values must be short strings, numbers or booleans.')
  }
  return out
}

export function encryptEnvelope(plaintext, publicKeyPem, meta = {}) {
  const key = loadPublicKey(publicKeyPem)
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8')
  const header = JSON.stringify({ alg: ALGORITHM, keyFingerprint: publicKeyFingerprint(key), meta: safeMeta(meta) })
  const dataKey = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv)
    cipher.setAAD(additionalData(header))
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
    const tag = cipher.getAuthTag()
    const wrappedKey = crypto.publicEncrypt({ key, ...OAEP }, dataKey)
    return {
      format: FORMAT,
      header,
      wrappedKey: wrappedKey.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  } finally {
    dataKey.fill(0)
  }
}

function field(envelope, name, bytes) {
  const value = envelope[name]
  if (typeof value !== 'string' || !B64.test(value)) throw new Error(`Not an ops export: "${name}" is missing or not base64.`)
  const buf = Buffer.from(value, 'base64')
  if (bytes !== undefined && buf.length !== bytes) throw new Error(`Not an ops export: "${name}" has the wrong length.`)
  return buf
}

export function parseHeader(envelope) {
  if (!envelope || typeof envelope !== 'object' || envelope.format !== FORMAT) {
    throw new Error(`Not an ops export (expected format ${FORMAT}).`)
  }
  if (typeof envelope.header !== 'string') throw new Error('Not an ops export: the header is missing.')
  let header
  try {
    header = JSON.parse(envelope.header)
  } catch {
    throw new Error('Not an ops export: the header is not JSON.')
  }
  if (!header || header.alg !== ALGORITHM) throw new Error(`Unsupported algorithm (expected ${ALGORITHM}).`)
  if (typeof header.keyFingerprint !== 'string') throw new Error('Not an ops export: no key fingerprint.')
  return header
}

// privateKey: a KeyObject from loadPrivateKey(), or PEM text.
export function decryptEnvelope(envelope, privateKey, { passphrase } = {}) {
  const header = parseHeader(envelope)
  const key = typeof privateKey === 'object' && privateKey && privateKey.type === 'private'
    ? requireRsa(privateKey, 'private key')
    : loadPrivateKey(privateKey, passphrase)
  const fingerprint = publicKeyFingerprint(key)
  if (fingerprint !== header.keyFingerprint) {
    throw new Error(`This file was encrypted for key ${header.keyFingerprint}; the private key given is ${fingerprint}.`)
  }
  const iv = field(envelope, 'iv', 12)
  const tag = field(envelope, 'tag', 16)
  const wrappedKey = field(envelope, 'wrappedKey')
  const ciphertext = field(envelope, 'ciphertext')
  let dataKey
  try {
    dataKey = crypto.privateDecrypt({ key, ...OAEP }, wrappedKey)
  } catch {
    throw new Error('Could not unwrap the file key with this private key.')
  }
  try {
    if (dataKey.length !== 32) throw new Error('The unwrapped file key has the wrong length.')
    const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, iv)
    decipher.setAAD(additionalData(envelope.header))
    decipher.setAuthTag(tag)
    let plaintext
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      throw new Error('Integrity check failed: the file was modified or truncated.')
    }
    return { plaintext, header }
  } finally {
    dataKey.fill(0)
  }
}
