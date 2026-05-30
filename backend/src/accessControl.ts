'use strict'

const { TAILSCALE_URL } = require('./config/index.ts')

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

/**
 * @typedef {object} RequestLike
 * @property {string=} method
 * @property {string=} originalUrl
 * @property {string=} path
 * @property {Record<string, string | undefined>=} headers
 * @property {{ remoteAddress?: string }=} socket
 * @property {{ remoteAddress?: string }=} connection
 */

/**
 * @typedef {object} RequestAccessClassification
 * @property {'local' | 'remote' | 'tailscale-private' | 'tailscale-public'} mode
 * @property {string} host
 * @property {string} remoteAddress
 * @property {boolean} trustedTailscale
 * @property {boolean} localRequest
 * @property {boolean} remoteRequest
 * @property {boolean} publicRemote
 * @property {boolean} tokenRequired
 * @property {boolean} hasConfiguredToken
 * @property {boolean} tokenProvided
 * @property {boolean} tokenValid
 * @property {string} configuredTailscaleHost
 * @property {string} remoteAccessProvider
 */

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

function getRemoteAccessProvider() {
  return trim(process.env.BUSINESS_OS_REMOTE_PROVIDER || 'cloudflare').toLowerCase()
}

function isLegacyTailscaleEnabled() {
  return getRemoteAccessProvider() === 'tailscale'
}

/**
 * @param {RequestLike} req
 */
function getRequestHost(req) {
  const forwardedHost = trim(req?.headers?.['x-forwarded-host'])
  const host = forwardedHost || trim(req?.headers?.host)
  return host.replace(/:\d+$/, '').toLowerCase()
}

/**
 * @param {RequestLike} req
 */
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

/**
 * @param {RequestLike} req
 */
function getPresentedSyncToken(req) {
  const authHeader = trim(req?.headers?.authorization)
  const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i)
  return trim(req?.headers?.['x-sync-token'] || (bearerMatch ? bearerMatch[1] : ''))
}

/**
 * @param {RequestLike} req
 */
function getTailscaleIdentity(req) {
  return {
    login: trim(req?.headers?.['tailscale-user-login']),
    name: trim(req?.headers?.['tailscale-user-name']),
    profilePic: trim(req?.headers?.['tailscale-user-profile-pic']),
    capabilities: trim(req?.headers?.['tailscale-app-capabilities']),
  }
}

/**
 * @param {RequestLike} req
 */
function hasTrustedTailscaleIdentity(req) {
  if (!isLegacyTailscaleEnabled()) return false
  const remoteAddress = getRemoteAddress(req)
  if (!isLoopbackAddress(remoteAddress)) return false
  const identity = getTailscaleIdentity(req)
  return !!(identity.login || identity.name || identity.capabilities)
}

/**
 * @param {RequestLike} req
 */
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

/**
 * @param {RequestLike} req
 */
function isPublicRemoteRequest(req) {
  const host = getRequestHost(req)
  if (hasTrustedTailscaleIdentity(req)) return false
  if (isLocalHostRequest(req)) return false
  if (isLegacyTailscaleEnabled() && isTsNetHost(host)) return true
  return true
}

/**
 * @param {RequestLike} req
 */
function isPublicApiRequest(req) {
  const method = String(req?.method || 'GET').toUpperCase()
  const path = String(req?.originalUrl || req?.path || '').split('?')[0]
  for (const entry of PUBLIC_API_ALLOWLIST) {
    if (entry.method === method && entry.pattern.test(path)) return true
  }
  return false
}

/**
 * @param {RequestLike} req
 * @returns {RequestAccessClassification}
 */
function classifyRequestAccess(req) {
  const trustedTailscale = hasTrustedTailscaleIdentity(req)
  const localRequest = isLocalHostRequest(req)
  const remoteRequest = !localRequest && !trustedTailscale
  const publicRemote = isPublicRemoteRequest(req)
  const tokenRequired = false
  const tokenValid = false
  let mode = 'local'
  if (trustedTailscale) mode = 'tailscale-private'
  else if (publicRemote && isLegacyTailscaleEnabled() && isTsNetHost(getRequestHost(req))) mode = 'tailscale-public'
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
    hasConfiguredToken: false,
    tokenProvided: false,
    tokenValid,
    configuredTailscaleHost: getConfiguredTailscaleHost(),
    remoteAccessProvider: getRemoteAccessProvider(),
  }
}

/**
 * @param {RequestLike} req
 */
function authorizeProtectedRequest(req) {
  const access = classifyRequestAccess(req)
  return { allowed: true, status: 200, code: 'session_required', access }
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
