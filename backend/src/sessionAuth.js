'use strict'

const crypto = require('crypto')
const { db } = require('./database')

const SESSION_COOKIE_NAME = 'bos_session'
const DEFAULT_SESSION_MS = Math.max(5 * 60 * 1000, Number(process.env.AUTH_SESSION_DEFAULT_MS || 24 * 60 * 60 * 1000))
const SESSION_1D_MS = Math.max(DEFAULT_SESSION_MS, Number(process.env.AUTH_SESSION_1D_MS || 24 * 60 * 60 * 1000))
const SESSION_3D_MS = Math.max(SESSION_1D_MS, Number(process.env.AUTH_SESSION_3D_MS || 3 * 24 * 60 * 60 * 1000))
const SESSION_14D_MS = Math.max(SESSION_3D_MS, Number(process.env.AUTH_SESSION_14D_MS || 14 * 24 * 60 * 60 * 1000))
const SESSION_7D_MS = Math.max(DEFAULT_SESSION_MS, Number(process.env.AUTH_SESSION_7D_MS || 7 * 24 * 60 * 60 * 1000))
const SESSION_30D_MS = Math.max(SESSION_14D_MS, Number(process.env.AUTH_SESSION_30D_MS || 30 * 24 * 60 * 60 * 1000))

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex')
}

function buildSessionExpiry(sessionDuration) {
  const mode = String(sessionDuration || 'session').trim().toLowerCase()
  const ttlMs = mode === '30d'
    ? SESSION_30D_MS
    : mode === '14d'
      ? SESSION_14D_MS
      : mode === '7d'
        ? SESSION_7D_MS
        : mode === '3d'
          ? SESSION_3D_MS
          : mode === '1d'
            ? SESSION_1D_MS
            : DEFAULT_SESSION_MS
  return new Date(Date.now() + ttlMs).toISOString()
}

function createAuthSession(userId, options = {}) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const expiresAt = buildSessionExpiry(options.sessionDuration)
  db.prepare(`
    INSERT INTO user_sessions (
      user_id, token_hash, device_name, device_tz, client_time, user_agent, last_ip, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(userId || 0),
    tokenHash,
    String(options.deviceName || '').trim() || null,
    String(options.deviceTz || '').trim() || null,
    String(options.clientTime || '').trim() || null,
    String(options.userAgent || '').trim() || null,
    String(options.ip || '').trim() || null,
    expiresAt,
  )
  return { token, expiresAt }
}

function getPresentedSessionToken(req) {
  const direct = String(req?.headers?.['x-auth-session'] || '').trim()
  if (direct) return direct

  const authHeader = String(req?.headers?.authorization || '').trim()
  const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i)
  if (bearerMatch) return String(bearerMatch[1] || '').trim()

  const cookieHeader = String(req?.headers?.cookie || '')
  if (!cookieHeader) return ''
  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.split('=')
    if (String(rawKey || '').trim() !== SESSION_COOKIE_NAME) continue
    return decodeURIComponent(rawValue.join('=').trim())
  }
  try {
    const fullUrl = new URL(String(req?.url || ''), 'http://localhost')
    const queryToken = String(fullUrl.searchParams.get('token') || '').trim()
    if (queryToken) return queryToken
  } catch (_) {}
  return ''
}

function getSessionUser(req) {
  const token = getPresentedSessionToken(req)
  if (!token) return null
  const tokenHash = hashToken(token)
  const nowIso = new Date().toISOString()
  const row = db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.expires_at,
      u.id,
      u.username,
      u.name,
      u.organization_id,
      u.organization_group_id,
      u.phone,
      u.phone_verified,
      u.email,
      u.email_verified,
      u.avatar_path,
      u.role_id,
      u.permissions,
      u.otp_enabled,
      u.is_active,
      u.created_at,
      r.permissions AS role_permissions,
      r.code AS role_code,
      r.name AS role_name,
      r.is_system AS role_is_system,
      o.name AS organization_name,
      o.slug AS organization_slug,
      o.public_id AS organization_public_id,
      g.name AS organization_group_name,
      g.slug AS organization_group_slug
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN organization_groups g ON g.id = u.organization_group_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.is_active = 1
      AND u.deleted_at IS NULL
    LIMIT 1
  `).get(tokenHash, nowIso)
  if (!row) return null

  db.prepare(`
    UPDATE user_sessions
    SET last_seen_at = datetime('now'),
        last_ip = ?,
        user_agent = COALESCE(?, user_agent)
    WHERE id = ?
  `).run(
    String(req?.ip || req?.socket?.remoteAddress || '').trim() || null,
    String(req?.headers?.['user-agent'] || '').trim() || null,
    row.session_id,
  )

  return row
}

function revokeAuthSession(token) {
  const value = String(token || '').trim()
  if (!value) return
  db.prepare(`
    UPDATE user_sessions
    SET revoked_at = datetime('now')
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(hashToken(value))
}

module.exports = {
  SESSION_COOKIE_NAME,
  buildSessionExpiry,
  createAuthSession,
  getPresentedSessionToken,
  getSessionUser,
  revokeAuthSession,
}
