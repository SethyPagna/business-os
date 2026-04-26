'use strict'

const crypto = require('crypto')

const ENC_PREFIX = 'enc:v1'
const _rateBuckets = new Map()
const _abuseBuckets = new Map()

function normalizeEncryptionKey(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value) return null

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex')
  }

  try {
    const base64 = Buffer.from(value, 'base64')
    if (base64.length === 32) return base64
  } catch (_) {}

  const utf8 = Buffer.from(value, 'utf8')
  if (utf8.length === 32) return utf8
  return null
}

const ENCRYPTION_KEY = normalizeEncryptionKey(process.env.APP_ENCRYPTION_KEY)

function isEncryptionConfigured() {
  return !!ENCRYPTION_KEY
}

function encryptSecret(plainText) {
  const text = String(plainText || '')
  if (!text) return ''
  if (!ENCRYPTION_KEY) return text

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${ENC_PREFIX}:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

function decryptSecret(cipherText) {
  const text = String(cipherText || '')
  if (!text) return ''
  if (!text.startsWith(`${ENC_PREFIX}:`)) return text
  if (!ENCRYPTION_KEY) return ''

  const parts = text.split(':')
  if (parts.length !== 5) return ''
  try {
    const iv = Buffer.from(parts[2], 'base64url')
    const tag = Buffer.from(parts[3], 'base64url')
    const encrypted = Buffer.from(parts[4], 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return plain.toString('utf8')
  } catch (_) {
    return ''
  }
}

function pruneRateBucket(bucket, nowMs, windowMs) {
  const cutoff = nowMs - windowMs
  for (const [key, timestamps] of bucket.entries()) {
    const kept = timestamps.filter((ts) => ts > cutoff)
    if (kept.length === 0) {
      bucket.delete(key)
    } else {
      bucket.set(key, kept)
    }
  }
}

function checkRateLimit(name, key, maxAttempts, windowMs) {
  const bucketName = String(name || 'default')
  const identity = String(key || 'global')
  const max = Math.max(1, Number(maxAttempts || 1))
  const window = Math.max(1_000, Number(windowMs || 60_000))
  const nowMs = Date.now()

  let bucket = _rateBuckets.get(bucketName)
  if (!bucket) {
    bucket = new Map()
    _rateBuckets.set(bucketName, bucket)
  }

  pruneRateBucket(bucket, nowMs, window)

  const history = bucket.get(identity) || []
  if (history.length >= max) {
    const retryAfterMs = Math.max(0, window - (nowMs - history[0]))
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }

  history.push(nowMs)
  bucket.set(identity, history)
  return { allowed: true, retryAfterSeconds: 0 }
}

function resetRateLimit(name, key) {
  const bucket = _rateBuckets.get(String(name || 'default'))
  if (!bucket) return
  bucket.delete(String(key || 'global'))
  if (bucket.size === 0) _rateBuckets.delete(String(name || 'default'))
}

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8')
  const b = Buffer.from(String(right || ''), 'utf8')
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch (_) {
    return false
  }
}

function getAbuseBucket(name) {
  const bucketName = String(name || 'default')
  let bucket = _abuseBuckets.get(bucketName)
  if (!bucket) {
    bucket = new Map()
    _abuseBuckets.set(bucketName, bucket)
  }
  return bucket
}

function pruneAbuseBucket(bucket, nowMs, windowMs) {
  for (const [key, state] of bucket.entries()) {
    const attempts = Array.isArray(state?.attempts) ? state.attempts.filter((ts) => ts > (nowMs - windowMs)) : []
    const lockUntil = Number(state?.lockUntil || 0)
    if (attempts.length === 0 && lockUntil <= nowMs) {
      bucket.delete(key)
      continue
    }
    bucket.set(key, { attempts, lockUntil })
  }
}

function checkAbuseLock(name, key, lockWindowMs = 15 * 60 * 1000) {
  const nowMs = Date.now()
  const windowMs = Math.max(1_000, Number(lockWindowMs || 15 * 60 * 1000))
  const bucket = getAbuseBucket(name)
  pruneAbuseBucket(bucket, nowMs, windowMs)
  const state = bucket.get(String(key || 'global'))
  if (!state) return { locked: false, retryAfterSeconds: 0 }
  const lockUntil = Number(state.lockUntil || 0)
  if (lockUntil > nowMs) {
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockUntil - nowMs) / 1000)),
    }
  }
  return { locked: false, retryAfterSeconds: 0 }
}

function recordAbuseFailure(name, key, options = {}) {
  const bucket = getAbuseBucket(name)
  const identity = String(key || 'global')
  const nowMs = Date.now()
  const windowMs = Math.max(1_000, Number(options.windowMs || 15 * 60 * 1000))
  const threshold = Math.max(1, Number(options.threshold || 12))
  const lockMs = Math.max(1_000, Number(options.lockMs || 15 * 60 * 1000))
  pruneAbuseBucket(bucket, nowMs, windowMs)

  const current = bucket.get(identity) || { attempts: [], lockUntil: 0 }
  const attempts = Array.isArray(current.attempts) ? current.attempts.filter((ts) => ts > (nowMs - windowMs)) : []
  attempts.push(nowMs)
  let lockUntil = Number(current.lockUntil || 0)
  if (attempts.length >= threshold) {
    lockUntil = nowMs + lockMs
  }
  bucket.set(identity, { attempts, lockUntil })
  return {
    locked: lockUntil > nowMs,
    retryAfterSeconds: lockUntil > nowMs ? Math.max(1, Math.ceil((lockUntil - nowMs) / 1000)) : 0,
    attempts: attempts.length,
  }
}

function clearAbuseFailure(name, key) {
  const bucket = _abuseBuckets.get(String(name || 'default'))
  if (!bucket) return
  bucket.delete(String(key || 'global'))
  if (bucket.size === 0) _abuseBuckets.delete(String(name || 'default'))
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
  checkRateLimit,
  resetRateLimit,
  safeCompare,
  checkAbuseLock,
  recordAbuseFailure,
  clearAbuseFailure,
}
