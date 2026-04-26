'use strict'

const { TAILSCALE_URL } = require('./config')
const { safeCompare } = require('./security')

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const PUBLIC_API_ALLOWLIST = [
  { method: 'GET', pattern: /^\/api\/system\/config\/?$/i },
  { method: 'GET', pattern: /^\/api\/auth\/verification-capabilities\/?$/i },
  { method: 'GET', pattern: /^\/api\/catalog\/meta\/?$/i },
  { method: 'GET', pattern: /^\/api\/catalog\/products\/?$/i },
  { method: 'GET', pattern: /^\/api\/portal\/config\/?$/i },
  { method: 'GET', pattern: /^\/api\/portal\/catalog\/meta\/?$/i },
  { method: 'GET', pattern: /^\/api\/portal\/catalog\/products\/?$/i },
  { method: 'GET', pattern: /^\/api\/portal\/membership\/[^/]+\/?$/i },
  { method: 'POST', pattern: /^\/api\/portal\/submissions\/?$/i },
]

function trim(value) {
  return String(value || '').trim()
}

function normalizeHostname(value) {
  const raw = trim(value).toLowerCase()
  if (!raw) return ''
  return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
}

function getConfiguredSyncToken() {
  return trim(process.env.SYNC_TOKEN || '')
}

function getRequestHost(req) {
  const forwardedHost = trim(req?.headers?.['x-forwarded-host'])
  const host = forwardedHost || trim(req?.headers?.host)
  return host.replace(/:\d+$/, '').toLowerCase()
}

function getRemoteAddress(req) {
  return trim(
    req?.socket?.remoteAddress
    || req?.connection?.remoteAddress
    || ''
  ).toLowerCase()
}

function isLoopbackAddress(value) {
  const ip = trim(value).toLowerCase()
  return ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
}

function getPresentedSyncToken(req) {
  const authHeader = trim(req?.headers?.authorization)
  const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i)
  return trim(req?.headers?.['x-sync-token'] || (bearerMatch ? bearerMatch[1] : ''))
}

function getTailscaleIdentity(req) {
  return {
    login: trim(req?.headers?.['tailscale-user-login']),
    name: trim(req?.headers?.['tailscale-user-name']),
    profilePic: trim(req?.headers?.['tailscale-user-profile-pic']),
    capabilities: trim(req?.headers?.['tailscale-app-capabilities']),
  }
}

function hasTrustedTailscaleIdentity(req) {
  const remoteAddress = getRemoteAddress(req)
  if (!isLoopbackAddress(remoteAddress)) return false
  const identity = getTailscaleIdentity(req)
  return !!(identity.login || identity.name || identity.capabilities)
}

function isLocalHostRequest(req) {
  const host = getRequestHost(req)
  return LOCALHOST_HOSTS.has(host)
}

function isTsNetHost(hostname) {
  const host = normalizeHostname(hostname)
  return !!host && host.endsWith('.ts.net')
}

function getConfiguredTailscaleHost() {
  return normalizeHostname(TAILSCALE_URL)
}

function isPublicRemoteRequest(req) {
  const host = getRequestHost(req)
  if (hasTrustedTailscaleIdentity(req)) return false
  if (isLocalHostRequest(req)) return false
  if (isTsNetHost(host)) return true
  return true
}

function isPublicApiRequest(req) {
  const method = String(req?.method || 'GET').toUpperCase()
  const path = String(req?.originalUrl || req?.path || '').split('?')[0]
  return PUBLIC_API_ALLOWLIST.some((entry) => entry.method === method && entry.pattern.test(path))
}

function classifyRequestAccess(req) {
  const syncToken = getConfiguredSyncToken()
  const presentedToken = getPresentedSyncToken(req)
  const trustedTailscale = hasTrustedTailscaleIdentity(req)
  const localRequest = isLocalHostRequest(req)
  const remoteRequest = !localRequest && !trustedTailscale
  const publicRemote = isPublicRemoteRequest(req)
  const tokenRequired = remoteRequest
  const tokenValid = !!(syncToken && presentedToken && safeCompare(syncToken, presentedToken))
  let mode = 'local'
  if (trustedTailscale) mode = 'tailscale-private'
  else if (publicRemote && isTsNetHost(getRequestHost(req))) mode = 'tailscale-public'
  else if (remoteRequest) mode = 'remote'

  return {
    mode,
    host: getRequestHost(req),
    remoteAddress: getRemoteAddress(req),
    trustedTailscale,
    localRequest,
    remoteRequest,
    publicRemote,
    tokenRequired,
    hasConfiguredToken: !!syncToken,
    tokenProvided: !!presentedToken,
    tokenValid,
    configuredTailscaleHost: getConfiguredTailscaleHost(),
  }
}

function authorizeProtectedRequest(req) {
  const access = classifyRequestAccess(req)
  if (!access.tokenRequired) {
    return { allowed: true, status: 200, code: 'trusted_local', access }
  }
  if (!access.hasConfiguredToken) {
    return {
      allowed: false,
      status: 401,
      code: 'public_token_required',
      message: 'Public or remote access requires a sync token. Open the app locally or through private Tailscale, then configure SYNC_TOKEN for public access.',
      access,
    }
  }
  if (!access.tokenValid) {
    return {
      allowed: false,
      status: 401,
      code: 'invalid_sync_token',
      message: 'A valid sync token is required for public or remote access.',
      access,
    }
  }
  return { allowed: true, status: 200, code: 'token_verified', access }
}

module.exports = {
  getConfiguredSyncToken,
  getPresentedSyncToken,
  getRequestHost,
  getRemoteAddress,
  getTailscaleIdentity,
  hasTrustedTailscaleIdentity,
  isPublicApiRequest,
  classifyRequestAccess,
  authorizeProtectedRequest,
}
