'use strict'

const { TAILSCALE_URL } = require('./config')

const API_PATH_PREFIX = '/api/'
const UPLOADS_PATH_PREFIX = '/uploads/'
const HEALTH_PATH = '/health'
const STATIC_FILE_RE = /\.[a-z0-9]+$/i
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const STRIP_CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const STRIP_BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g

function parseOriginHost(origin) {
  const value = String(origin || '').trim()
  if (!value) return ''
  try {
    return new URL(value).hostname.trim().toLowerCase()
  } catch (_) {
    return ''
  }
}

function normalizeConfiguredHost(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).hostname.trim().toLowerCase()
  } catch (_) {
    return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').trim().toLowerCase()
  }
}

function isAllowedRequestOrigin(origin) {
  if (!origin) return true
  const host = parseOriginHost(origin)
  if (!host) return false
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
  const configuredHost = normalizeConfiguredHost(TAILSCALE_URL)
  if (configuredHost && host === configuredHost) return true
  return host.endsWith('.ts.net')
}

function isAllowedWebSocketOrigin(req) {
  const origin = String(req?.headers?.origin || '').trim()
  if (!origin) return true
  if (!isAllowedRequestOrigin(origin)) return false
  const originHost = parseOriginHost(origin)
  const requestHost = String(req?.headers?.host || req?.headers?.['x-forwarded-host'] || '')
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .toLowerCase()
  if (!requestHost) return true
  const configuredHost = normalizeConfiguredHost(TAILSCALE_URL)
  if (originHost === requestHost) return true
  if (configuredHost && originHost === configuredHost) return true
  if (originHost.endsWith('.ts.net') && requestHost.endsWith('.ts.net')) return true
  return hostIsLoopbackPair(originHost, requestHost)
}

function hostIsLoopbackPair(left, right) {
  const loopbacks = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  return loopbacks.has(left) && loopbacks.has(right)
}

const CORS_OPTIONS = {
  origin(origin, callback) {
    if (isAllowedRequestOrigin(origin)) return callback(null, true)
    return callback(new Error('CORS origin denied'))
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-sync-token',
    'x-auth-session',
    'bypass-tunnel-reminder',
    'x-client-time',
    'x-device-tz',
    'x-device-name',
  ],
  credentials: false,
}

function sanitizeObjectKeys(value, depth = 0, maxDepth = 20) {
  if (!value || typeof value !== 'object') return value
  if (depth > maxDepth) return value

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObjectKeys(item, depth + 1, maxDepth))
  }

  for (const key of Object.keys(value)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      delete value[key]
      continue
    }
    value[key] = sanitizeObjectKeys(value[key], depth + 1, maxDepth)
  }

  return value
}

function sanitizeStringValue(value) {
  return String(value || '')
    .replace(STRIP_CONTROL_CHARS_RE, '')
    .replace(STRIP_BIDI_RE, '')
}

function sanitizeRequestPayload(req) {
  sanitizeObjectKeys(req?.body)
  sanitizeObjectKeys(req?.query)
  sanitizeDeepStrings(req?.body)
  sanitizeDeepStrings(req?.query)
}

function sanitizeDeepStrings(value, depth = 0, maxDepth = 20) {
  if (value == null || depth > maxDepth) return value
  if (typeof value === 'string') return sanitizeStringValue(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = sanitizeDeepStrings(value[index], depth + 1, maxDepth)
    }
    return value
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      value[key] = sanitizeDeepStrings(value[key], depth + 1, maxDepth)
    }
  }
  return value
}

function isApiOrHealthPath(pathname) {
  return pathname === HEALTH_PATH || String(pathname || '').startsWith(API_PATH_PREFIX)
}

function isSpaFallbackEligible(pathname) {
  const path = String(pathname || '')
  if (!path || isApiOrHealthPath(path)) return false
  if (path.startsWith(UPLOADS_PATH_PREFIX)) return false
  if (STATIC_FILE_RE.test(path)) return false
  return true
}

function setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store')
}

function setHtmlNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

function setTunnelSecurityHeaders(req, res) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(self), microphone=(), usb=(), payment=()')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  res.setHeader('Origin-Agent-Cluster', '?1')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "manifest-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "frame-src 'self' https://www.google.com https://maps.google.com https://translate.google.com https://translate.googleapis.com",
      "connect-src 'self' ws: wss: https://api.groq.com https://api.mistral.ai https://api.cerebras.ai https://generativelanguage.googleapis.com https://api.cohere.com https://www.googleapis.com https://oauth2.googleapis.com https://translate.google.com https://translate.googleapis.com https://*.supabase.co",
      "worker-src 'self' blob:",
      "script-src 'self' https://translate.google.com https://translate.googleapis.com",
    ].join('; '),
  )
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || '').split(',')[0].trim().toLowerCase()
  if (proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  res.setHeader('bypass-tunnel-reminder', 'true')
}

function setFrontendStaticHeaders(res, filePath) {
  if (filePath.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css; charset=utf-8')
  }
  if (filePath.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')

  if (filePath.endsWith('index.html')) {
    setHtmlNoCacheHeaders(res)
  }
}

function setUploadStaticHeaders(res, filePath) {
  const safeName = String(filePath || '').split(/[\\/]/).pop() || 'file'
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Content-Disposition', `inline; filename="${safeName.replace(/"/g, '')}"`)
}

function mapServerError(error) {
  if (!error) return null

  if (error.message === 'CORS origin denied') {
    return { status: 403, body: { success: false, error: 'Origin is not allowed.' } }
  }

  if (error.type === 'entity.too.large') {
    return { status: 413, body: { success: false, error: 'Request payload is too large.' } }
  }

  if (error.type === 'entity.parse.failed') {
    return { status: 400, body: { success: false, error: 'Request body is not valid JSON.' } }
  }

  if (error.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return { status: 413, body: { success: false, error: 'Uploaded file is too large.' } }
    }
    return { status: 400, body: { success: false, error: 'Upload failed. Please verify the file and try again.' } }
  }

  if (String(error.message || '').toLowerCase().includes('unsupported file type')) {
    return { status: 400, body: { success: false, error: String(error.message) } }
  }

  if (String(error.message || '').toLowerCase().includes('file contents do not match')) {
    return { status: 400, body: { success: false, error: String(error.message) } }
  }

  return { status: 500, body: { success: false, error: 'Internal server error' } }
}

module.exports = {
  CORS_OPTIONS,
  sanitizeObjectKeys,
  sanitizeStringValue,
  sanitizeRequestPayload,
  sanitizeDeepStrings,
  isApiOrHealthPath,
  isSpaFallbackEligible,
  setNoStoreHeaders,
  setHtmlNoCacheHeaders,
  setTunnelSecurityHeaders,
  setFrontendStaticHeaders,
  setUploadStaticHeaders,
  mapServerError,
  isAllowedRequestOrigin,
  isAllowedWebSocketOrigin,
}
