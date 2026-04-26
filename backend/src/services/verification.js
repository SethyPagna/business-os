'use strict'

const crypto = require('crypto')
const { db } = require('../database')

const DEFAULT_CODE_TTL_MINUTES = Number(process.env.VERIFICATION_CODE_TTL_MINUTES || 10)

function nowMs() {
  return Date.now()
}

function toIso(ms) {
  return new Date(ms).toISOString()
}

function parseBool(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

const IS_DEV_RUNTIME = String(process.env.NODE_ENV || '').toLowerCase() === 'development' && !process.pkg
const DEV_EXPOSE_CODES = IS_DEV_RUNTIME && parseBool(process.env.DEV_EXPOSE_VERIFICATION_CODES || 'false')

function isEmailProviderConfigured() {
  const resendReady = !!String(process.env.RESEND_API_KEY || '').trim()
  const sendgridReady = !!String(process.env.SENDGRID_API_KEY || '').trim() && !!String(process.env.SENDGRID_FROM_EMAIL || '').trim()
  const webhookReady = !!String(process.env.EMAIL_WEBHOOK_URL || '').trim()
  return resendReady || sendgridReady || webhookReady
}

function getVerificationCapabilities() {
  return {
    email: isEmailProviderConfigured(),
    sms: false,
  }
}

function normalizeEmail(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return ''
  return v
}

function normalizePhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned || !cleaned.startsWith('+')) return ''
  const digits = cleaned.slice(1).replace(/[^\d]/g, '')
  if (digits.length < 8 || digits.length > 15) return ''
  return `+${digits}`
}

function maskDestination(channel, destination) {
  const text = String(destination || '')
  if (!text) return ''
  if (channel === 'email') {
    const [left, right] = text.split('@')
    if (!left || !right) return text
    if (left.length <= 2) return `${left[0] || '*'}***@${right}`
    return `${left.slice(0, 2)}***@${right}`
  }
  if (text.length <= 4) return `***${text}`
  return `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000))
}

function hashCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex')
}

function resolveChannel(user, method = 'auto', options = {}) {
  const verifiedOnly = options.verifiedOnly !== false
  const preferred = String(method || 'auto').trim().toLowerCase()
  const hasEmail = !!normalizeEmail(user?.email) && (!verifiedOnly || Number(user?.email_verified || 0) === 1)

  if (preferred === 'email') return hasEmail ? 'email' : null
  if (hasEmail) return 'email'
  return null
}

function getDestinationForChannel(user, channel, valueOverride = '') {
  if (channel === 'email') return normalizeEmail(valueOverride || user?.email)
  return ''
}

function cleanupExpiredCodes() {
  db.prepare(`
    DELETE FROM verification_codes
    WHERE consumed_at IS NOT NULL
       OR datetime(expires_at) < datetime('now', '-1 day')
  `).run()
}

function invalidateActiveCodes({ userId, purpose, channel, destination }) {
  db.prepare(`
    UPDATE verification_codes
    SET consumed_at = datetime('now')
    WHERE user_id IS ?
      AND purpose = ?
      AND channel = ?
      AND destination = ?
      AND consumed_at IS NULL
      AND datetime(expires_at) >= datetime('now')
  `).run(userId || null, purpose, channel, destination)
}

function createVerificationRecord({ userId, purpose, channel, destination, meta = {}, ttlMinutes = DEFAULT_CODE_TTL_MINUTES }) {
  const code = generateCode()
  const salt = crypto.randomBytes(16).toString('hex')
  const codeHash = hashCode(code, salt)
  const expiresAt = toIso(nowMs() + (Math.max(1, Number(ttlMinutes || DEFAULT_CODE_TTL_MINUTES)) * 60 * 1000))

  cleanupExpiredCodes()
  invalidateActiveCodes({ userId, purpose, channel, destination })

  db.prepare(`
    INSERT INTO verification_codes (
      user_id, purpose, channel, destination, code_hash, code_salt, meta_json, expires_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `).run(
    userId || null,
    purpose,
    channel,
    destination,
    codeHash,
    salt,
    JSON.stringify(meta || {}),
    expiresAt,
  )

  return { code, expiresAt }
}

function findActiveCode({ userId, purpose, channel, destination }) {
  return db.prepare(`
    SELECT *
    FROM verification_codes
    WHERE user_id = ?
      AND purpose = ?
      AND channel = ?
      AND destination = ?
      AND consumed_at IS NULL
      AND datetime(expires_at) >= datetime('now')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(userId, purpose, channel, destination)
}

function consumeCode(id) {
  db.prepare(`UPDATE verification_codes SET consumed_at = datetime('now') WHERE id = ?`).run(id)
}

function verifyCode({ userId, purpose, channel, destination, code, consume = true }) {
  const row = findActiveCode({ userId, purpose, channel, destination })
  if (!row) return { valid: false, reason: 'not_found' }
  const computed = hashCode(String(code || '').trim(), row.code_salt || '')
  if (computed !== row.code_hash) return { valid: false, reason: 'invalid_code' }
  if (consume) consumeCode(row.id)
  return { valid: true, row }
}

function messageForPurpose(purpose, code) {
  if (purpose === 'login_code') {
    return {
      subject: 'Business OS login code',
      text: `Use this code to sign in: ${code}. It expires in ${DEFAULT_CODE_TTL_MINUTES} minutes.`,
    }
  }
  if (purpose === 'verify_email' || purpose === 'verify_phone') {
    return {
      subject: 'Business OS verification code',
      text: `Your verification code is ${code}. It expires in ${DEFAULT_CODE_TTL_MINUTES} minutes.`,
    }
  }
  return {
    subject: 'Business OS password reset code',
    text: `Use this code to reset your password: ${code}. It expires in ${DEFAULT_CODE_TTL_MINUTES} minutes.`,
  }
}

async function sendEmail({ to, subject, text }) {
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim()
  const resendFrom = String(process.env.RESEND_FROM_EMAIL || '').trim() || 'onboarding@resend.dev'
  if (resendApiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [to],
        subject,
        text,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(detail || `Resend failed (${response.status})`)
    }
    return { sent: true, provider: 'resend' }
  }

  const sendgridApiKey = String(process.env.SENDGRID_API_KEY || '').trim()
  const sendgridFrom = String(process.env.SENDGRID_FROM_EMAIL || '').trim()
  if (sendgridApiKey && sendgridFrom) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: sendgridFrom },
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(detail || `SendGrid failed (${response.status})`)
    }
    return { sent: true, provider: 'sendgrid' }
  }

  const emailWebhook = String(process.env.EMAIL_WEBHOOK_URL || '').trim()
  if (emailWebhook) {
    const webhookResponse = await fetch(emailWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text }),
    })
    if (!webhookResponse.ok) {
      const detail = await webhookResponse.text().catch(() => '')
      throw new Error(detail || `Email webhook failed (${webhookResponse.status})`)
    }
    return { sent: true, provider: 'email_webhook' }
  }

  return { sent: false, provider: 'none' }
}

async function requestVerificationCode({
  userId,
  userName,
  purpose,
  channel,
  destination,
  meta = {},
}) {
  if (channel !== 'email') {
    return {
      success: false,
      error: 'Only email verification is supported in this build.',
    }
  }

  const { code, expiresAt } = createVerificationRecord({
    userId,
    purpose,
    channel,
    destination,
    meta,
  })

  const message = messageForPurpose(purpose, code)
  let delivery = { sent: false, provider: 'none', error: '' }

  try {
    delivery = await sendEmail({ to: destination, subject: message.subject, text: message.text })
  } catch (error) {
    delivery = { sent: false, provider: 'error', error: error?.message || 'Delivery failed' }
  }

  if (!delivery.sent && !DEV_EXPOSE_CODES) {
    db.prepare(`
      UPDATE verification_codes
      SET consumed_at = datetime('now')
      WHERE user_id = ? AND purpose = ? AND channel = ? AND destination = ? AND consumed_at IS NULL
    `).run(userId, purpose, channel, destination)
    const providerConfigured = isEmailProviderConfigured()
    const providerHint = providerConfigured
      ? 'Email provider is configured but delivery failed. Check provider credentials, sender identity, and outbound network access.'
      : 'Email provider is not configured. Configure an email provider before using email verification.'
    const deliveryMessage = delivery.error ? ` (${delivery.error})` : ''
    return {
      success: false,
      error: `${providerHint}${deliveryMessage}`,
    }
  }

  return {
    success: true,
    channel,
    destination,
    destinationMasked: maskDestination(channel, destination),
    expiresAt,
    provider: delivery.provider,
    delivered: delivery.sent,
    deliveryError: delivery.error || '',
    userName: userName || '',
  }
}

module.exports = {
  DEV_EXPOSE_CODES,
  getVerificationCapabilities,
  normalizeEmail,
  normalizePhone,
  resolveChannel,
  getDestinationForChannel,
  requestVerificationCode,
  verifyCode,
  maskDestination,
}
