'use strict'

const API_PATH_PREFIX = '/api/'
const UPLOADS_PATH_PREFIX = '/uploads/'
const HEALTH_PATH = '/health'
const STATIC_FILE_RE = /\.[a-z0-9]+$/i
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const STRIP_CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const STRIP_BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g

const CORS_OPTIONS = {
  origin: true,
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
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), usb=(), payment=()')
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
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "frame-src 'self' https://www.google.com https://maps.google.com https://translate.google.com",
      "connect-src 'self' ws: wss: https://api.groq.com https://api.mistral.ai https://api.cerebras.ai https://generativelanguage.googleapis.com https://api.cohere.com https://www.googleapis.com https://oauth2.googleapis.com https://*.supabase.co",
      "script-src 'self' 'unsafe-inline' https://translate.google.com",
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

  if (error.type === 'entity.too.large') {
    return { status: 413, body: { success: false, error: 'Request payload is too large.' } }
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
}
