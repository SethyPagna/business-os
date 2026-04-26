'use strict'

/**
 * Supabase Auth Service
 *
 * Purpose:
 * - keep Supabase Auth as an external identity provider only
 * - let the local SQLite `users` table remain the business authority
 * - provision, update, ban, and inspect auth identities from the server
 * - validate email/password and OAuth sessions without exposing service keys
 */

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function trim(value) {
  return String(value || '').trim()
}

function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(value)
  } catch (_) {
    return fallback
  }
}

function normalizeSupabaseUrl(value) {
  return trim(value || '').replace(/\/+$/, '')
}

function normalizeEmail(value) {
  const email = trim(value || '').toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clampPassword(value) {
  return String(value || '')
}

function isAllowedOauthProvider(provider) {
  return provider === 'google' || provider === 'facebook'
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

const SUPABASE_AUTH_ENABLED = truthy(process.env.SUPABASE_AUTH_ENABLED || 'false')
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL || '')
const SUPABASE_ANON_KEY = trim(process.env.SUPABASE_ANON_KEY || '')
const SUPABASE_SERVICE_ROLE_KEY = trim(process.env.SUPABASE_SERVICE_ROLE_KEY || '')
const SUPABASE_EMAIL_AUTH_ENABLED = truthy(process.env.SUPABASE_EMAIL_AUTH_ENABLED || 'true')
const SUPABASE_MAGIC_LINK_ENABLED = truthy(process.env.SUPABASE_MAGIC_LINK_ENABLED || 'true')
const SUPABASE_INVITE_ENABLED = truthy(process.env.SUPABASE_INVITE_ENABLED || 'true')
const SUPABASE_GOOGLE_OAUTH_ENABLED = truthy(process.env.SUPABASE_GOOGLE_OAUTH_ENABLED || 'false')
const SUPABASE_FACEBOOK_OAUTH_ENABLED = truthy(process.env.SUPABASE_FACEBOOK_OAUTH_ENABLED || 'false')
const SUPABASE_MFA_TOTP_ENABLED = truthy(process.env.SUPABASE_MFA_TOTP_ENABLED || 'false')

function isSupabaseAuthConfigured() {
  return !!(SUPABASE_AUTH_ENABLED && SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY)
}

function hasSupabaseAdminCredentials() {
  return !!(SUPABASE_AUTH_ENABLED && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
}

function hasSupabasePublicCredentials() {
  return !!(SUPABASE_AUTH_ENABLED && SUPABASE_URL && SUPABASE_ANON_KEY)
}

function buildSupabaseUrl(pathname) {
  return `${SUPABASE_URL}/auth/v1${pathname}`
}

function normalizeRedirectTo(value) {
  const text = trim(value || '')
  return isHttpUrl(text) ? text : ''
}

function getSupabaseAuthPublicConfig() {
  const enabled = isSupabaseAuthConfigured()
  return {
    enabled,
    url: SUPABASE_URL || '',
    hasAnonKey: !!SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
    emailAuthEnabled: enabled && SUPABASE_EMAIL_AUTH_ENABLED,
    magicLinkEnabled: enabled && SUPABASE_MAGIC_LINK_ENABLED,
    inviteEnabled: enabled && SUPABASE_INVITE_ENABLED,
    googleEnabled: enabled && SUPABASE_GOOGLE_OAUTH_ENABLED,
    facebookEnabled: enabled && SUPABASE_FACEBOOK_OAUTH_ENABLED,
    mfaTotpEnabled: enabled && SUPABASE_MFA_TOTP_ENABLED,
  }
}

function normalizeProviderError(errorCode, fallback = '') {
  const code = String(errorCode || '').trim()
  const upper = code.toUpperCase()
  if (!upper) return fallback || 'Supabase authentication request failed.'
  if (upper.includes('INVALID_LOGIN_CREDENTIALS') || upper.includes('INVALID_CREDENTIALS')) {
    return 'Invalid email or password'
  }
  if (upper.includes('EMAIL_NOT_CONFIRMED')) return 'Email address is not confirmed yet.'
  if (upper.includes('USER_BANNED')) return 'User account is inactive'
  if (upper.includes('EMAIL_EXISTS') || upper.includes('USER_ALREADY_EXISTS')) {
    return 'Email is already registered in authentication provider.'
  }
  if (upper.includes('WEAK_PASSWORD')) return 'Password must be at least 6 characters for Supabase authentication.'
  if (upper.includes('OVER_EMAIL_SEND_RATE_LIMIT')) return 'Too many email requests. Please try again shortly.'
  return fallback || `Supabase auth error: ${code}`
}

function parseResponseData(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch (_) {
    return { raw: text }
  }
}

async function callSupabasePublic(method, pathname, body = null, extraHeaders = {}) {
  if (!hasSupabasePublicCredentials()) {
    return { ok: false, status: 0, error: 'Supabase auth is not configured.', data: null }
  }

  try {
    const response = await fetch(buildSupabaseUrl(pathname), {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body == null ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const data = parseResponseData(text)
    if (!response.ok) {
      const providerCode = data?.error_code || data?.code || data?.error || data?.msg || ''
      return {
        ok: false,
        status: response.status,
        error: normalizeProviderError(providerCode, data?.msg || `Supabase request failed (${response.status})`),
        providerCode,
        data,
      }
    }
    return { ok: true, status: response.status, error: '', providerCode: '', data }
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'Supabase request failed.', providerCode: '', data: null }
  }
}

async function callSupabaseAdmin(method, pathname, body = null, extraHeaders = {}) {
  if (!hasSupabaseAdminCredentials()) {
    return { ok: false, status: 0, error: 'Supabase admin auth is not configured.', data: null }
  }

  try {
    const response = await fetch(buildSupabaseUrl(pathname), {
      method,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body == null ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const data = parseResponseData(text)
    if (!response.ok) {
      const providerCode = data?.error_code || data?.code || data?.error || data?.msg || ''
      return {
        ok: false,
        status: response.status,
        error: normalizeProviderError(providerCode, data?.msg || `Supabase admin request failed (${response.status})`),
        providerCode,
        data,
      }
    }
    return { ok: true, status: response.status, error: '', providerCode: '', data }
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'Supabase admin request failed.', providerCode: '', data: null }
  }
}

function getBanDurationForActiveState(isActive) {
  return isActive ? 'none' : '876000h'
}

function buildUserMetadata(localUser) {
  return {
    local_user_id: Number(localUser?.id || 0) || null,
    username: trim(localUser?.username || ''),
    display_name: trim(localUser?.name || localUser?.username || ''),
    organization_id: Number(localUser?.organization_id || 0) || null,
    organization_slug: trim(localUser?.organization_slug || ''),
  }
}

function buildAppMetadata(localUser) {
  return {
    source: 'business-os',
    local_user_id: Number(localUser?.id || 0) || null,
    username: trim(localUser?.username || ''),
    organization_id: Number(localUser?.organization_id || 0) || null,
  }
}

function getIdentityProviders(authUser) {
  const identities = Array.isArray(authUser?.identities) ? authUser.identities : []
  const providers = new Set()
  identities.forEach((identity) => {
    const provider = trim(identity?.provider || identity?.identity_data?.provider || '')
    if (provider) providers.add(provider)
  })

  const appProviders = Array.isArray(authUser?.app_metadata?.providers)
    ? authUser.app_metadata.providers
    : Array.isArray(parseJsonSafe(authUser?.app_metadata?.providers, null))
      ? parseJsonSafe(authUser?.app_metadata?.providers, [])
      : []
  appProviders.forEach((provider) => {
    const value = trim(provider || '')
    if (value) providers.add(value)
  })

  return Array.from(providers)
}

function summarizeAuthUser(authUser) {
  if (!authUser || !isPlainObject(authUser)) return null
  const providers = getIdentityProviders(authUser)
  return {
    id: trim(authUser.id || ''),
    email: normalizeEmail(authUser.email || ''),
    emailConfirmed: !!(authUser.email_confirmed_at || authUser.confirmed_at),
    phone: trim(authUser.phone || ''),
    lastSignInAt: trim(authUser.last_sign_in_at || ''),
    providers,
    hasGoogle: providers.includes('google'),
    hasFacebook: providers.includes('facebook'),
    hasEmail: providers.includes('email') || !!normalizeEmail(authUser.email || ''),
    raw: authUser,
  }
}

function isLocalUserActive(localUser) {
  return Number(localUser?.is_active || 0) === 1 && !localUser?.deleted_at
}

async function getAuthUserById(supabaseUserId) {
  const userId = trim(supabaseUserId || '')
  if (!userId) return { success: false, skipped: true, reason: 'missing_user_id' }
  const result = await callSupabaseAdmin('GET', `/admin/users/${encodeURIComponent(userId)}`)
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
  return { success: true, user: summarizeAuthUser(result.data?.user || result.data) }
}

async function getAuthUserFromAccessToken(accessToken) {
  const token = trim(accessToken || '')
  if (!token) return { success: false, skipped: true, reason: 'missing_access_token' }
  const result = await callSupabasePublic('GET', '/user', null, {
    Authorization: `Bearer ${token}`,
  })
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
  return { success: true, user: summarizeAuthUser(result.data) }
}

async function listAuthUsersPage(page = 1, perPage = 200) {
  if (!hasSupabaseAdminCredentials()) {
    return { success: false, error: 'Supabase admin auth is not configured. Set SUPABASE_SERVICE_ROLE_KEY.' }
  }
  const safePage = Math.max(1, Number(page || 1))
  const safePerPage = Math.max(1, Math.min(1000, Number(perPage || 200)))
  const result = await callSupabaseAdmin('GET', `/admin/users?page=${safePage}&per_page=${safePerPage}`)
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
  const items = Array.isArray(result.data?.users)
    ? result.data.users
    : Array.isArray(result.data)
      ? result.data
      : []
  return {
    success: true,
    users: items.map((item) => summarizeAuthUser(item)).filter(Boolean),
  }
}

async function findAuthUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return { success: false, skipped: true, reason: 'missing_email' }
  if (!hasSupabaseAdminCredentials()) {
    return { success: false, error: 'Supabase admin auth is not configured. Set SUPABASE_SERVICE_ROLE_KEY.' }
  }

  let page = 1
  while (page <= 10) {
    const pageResult = await listAuthUsersPage(page, 200)
    if (!pageResult.success) return pageResult
    const match = (pageResult.users || []).find((user) => normalizeEmail(user?.email || '') === normalizedEmail)
    if (match) return { success: true, user: match }
    if ((pageResult.users || []).length < 200) break
    page += 1
  }

  return { success: true, user: null }
}

async function createOrUpdateAuthUser(localUser, password = '') {
  if (!isSupabaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  if (!hasSupabaseAdminCredentials()) {
    return { success: false, error: 'Supabase admin credentials are not configured. Set SUPABASE_SERVICE_ROLE_KEY.' }
  }

  const email = normalizeEmail(localUser?.email)
  if (!email) return { success: false, skipped: true, reason: 'missing_email' }

  const supabaseUserId = trim(localUser?.supabase_user_id || '')
  const candidatePassword = clampPassword(password)
  const payload = {
    email,
    email_confirm: Number(localUser?.email_verified || 0) === 1,
    ban_duration: getBanDurationForActiveState(isLocalUserActive(localUser)),
    user_metadata: buildUserMetadata(localUser),
    app_metadata: buildAppMetadata(localUser),
  }

  if (candidatePassword) {
    if (candidatePassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters for Supabase authentication.' }
    }
    payload.password = candidatePassword
  }

  if (supabaseUserId) {
    const result = await callSupabaseAdmin('PUT', `/admin/users/${encodeURIComponent(supabaseUserId)}`, payload)
    if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
    return { success: true, userId: supabaseUserId, created: false }
  }

  const existingByEmail = await findAuthUserByEmail(email)
  if (!existingByEmail.success && !existingByEmail.skipped) {
    return { success: false, error: existingByEmail.error || 'Failed to look up existing Supabase users.' }
  }
  if (existingByEmail?.user?.id) {
    const result = await callSupabaseAdmin('PUT', `/admin/users/${encodeURIComponent(existingByEmail.user.id)}`, payload)
    if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
    return { success: true, userId: existingByEmail.user.id, created: false, matchedByEmail: true }
  }

  if (!candidatePassword) return { success: false, skipped: true, reason: 'missing_password' }

  const result = await callSupabaseAdmin('POST', '/admin/users', payload)
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
  const createdId = trim(result?.data?.user?.id || result?.data?.id || '')
  return { success: true, userId: createdId, created: true }
}

async function updateAuthPassword(supabaseUserId, newPassword) {
  if (!isSupabaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  if (!hasSupabaseAdminCredentials()) {
    return { success: false, error: 'Supabase admin credentials are not configured. Set SUPABASE_SERVICE_ROLE_KEY.' }
  }

  const userId = trim(supabaseUserId || '')
  if (!userId) return { success: false, skipped: true, reason: 'missing_user_id' }
  const password = clampPassword(newPassword)
  if (!password) return { success: false, skipped: true, reason: 'missing_password' }
  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters for Supabase authentication.' }
  }

  const result = await callSupabaseAdmin('PUT', `/admin/users/${encodeURIComponent(userId)}`, { password })
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
  return { success: true }
}

async function setAuthUserActive(supabaseUserId, isActive) {
  if (!isSupabaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  if (!hasSupabaseAdminCredentials()) {
    return { success: false, error: 'Supabase admin credentials are not configured. Set SUPABASE_SERVICE_ROLE_KEY.' }
  }

  const userId = trim(supabaseUserId || '')
  if (!userId) return { success: false, skipped: true, reason: 'missing_user_id' }
  const result = await callSupabaseAdmin('PUT', `/admin/users/${encodeURIComponent(userId)}`, {
    ban_duration: getBanDurationForActiveState(!!isActive),
  })
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
  return { success: true }
}

async function verifyPasswordWithSupabase(localUser, password) {
  if (!isSupabaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  const email = normalizeEmail(localUser?.email)
  if (!email) return { success: false, skipped: true, reason: 'missing_email' }

  const result = await callSupabasePublic('POST', '/token?grant_type=password', {
    email,
    password: clampPassword(password),
  })
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }

  const returnedUserId = trim(result?.data?.user?.id || '')
  if (trim(localUser?.supabase_user_id || '') && returnedUserId && trim(localUser.supabase_user_id) !== returnedUserId) {
    return { success: false, error: 'Authentication account mismatch. Please contact admin.' }
  }

  return {
    success: true,
    userId: returnedUserId || trim(localUser?.supabase_user_id || ''),
    accessToken: trim(result?.data?.access_token || ''),
    refreshToken: trim(result?.data?.refresh_token || ''),
    user: summarizeAuthUser(result?.data?.user || null),
  }
}

async function unlinkAuthIdentity(accessToken, identityId) {
  const token = trim(accessToken || '')
  const targetIdentityId = trim(identityId || '')
  if (!isSupabaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  if (!token) return { success: false, skipped: true, reason: 'missing_access_token' }
  if (!targetIdentityId) return { success: false, skipped: true, reason: 'missing_identity_id' }

  const result = await callSupabasePublic('DELETE', `/user/identities/${encodeURIComponent(targetIdentityId)}`, null, {
    Authorization: `Bearer ${token}`,
  })
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }
  return { success: true, data: result.data || null }
}

async function sendSupabaseVerificationEmail(email, options = {}) {
  if (!isSupabaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return { success: false, skipped: true, reason: 'missing_email' }
  if (!SUPABASE_EMAIL_AUTH_ENABLED) {
    return { success: false, skipped: true, reason: 'email_auth_disabled' }
  }

  const redirectTo = normalizeRedirectTo(options.redirectTo)
  const payload = {
    type: 'signup',
    email: normalizedEmail,
  }
  if (redirectTo) {
    payload.options = { emailRedirectTo: redirectTo }
  }

  const existing = await findAuthUserByEmail(normalizedEmail)
  if (existing?.success && existing.user?.emailConfirmed) {
    return { success: true, alreadyConfirmed: true, provider: 'supabase' }
  }

  const result = await callSupabasePublic('POST', '/resend', payload)
  if (!result.ok) {
    const providerCode = String(result.providerCode || '').trim().toUpperCase()
    if (providerCode.includes('EMAIL_ALREADY_CONFIRMED') || providerCode.includes('USER_ALREADY_CONFIRMED')) {
      return { success: true, alreadyConfirmed: true, provider: 'supabase' }
    }
    return { success: false, error: result.error, providerCode: result.providerCode || '' }
  }

  return {
    success: true,
    provider: 'supabase',
    alreadyConfirmed: false,
    data: result.data || null,
  }
}

function buildOauthStartUrl({ provider, redirectTo, queryParams = {} }) {
  const normalizedProvider = trim(provider || '').toLowerCase()
  if (!isAllowedOauthProvider(normalizedProvider)) {
    return { success: false, error: 'Unsupported OAuth provider.' }
  }
  if (!isSupabaseAuthConfigured()) {
    return { success: false, error: 'Supabase auth is not configured.' }
  }

  const providerConfig = getSupabaseAuthPublicConfig()
  if (normalizedProvider === 'google' && !providerConfig.googleEnabled) {
    return { success: false, error: 'Google sign-in is not enabled yet.' }
  }
  if (normalizedProvider === 'facebook' && !providerConfig.facebookEnabled) {
    return { success: false, error: 'Facebook sign-in is not enabled yet.' }
  }

  if (!isHttpUrl(redirectTo)) {
    return { success: false, error: 'A valid redirect URL is required.' }
  }

  const search = new URLSearchParams({
    provider: normalizedProvider,
    redirect_to: redirectTo,
  })

  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })

  return {
    success: true,
    url: `${buildSupabaseUrl('/authorize')}?${search.toString()}`,
  }
}

module.exports = {
  isSupabaseAuthConfigured,
  getSupabaseAuthPublicConfig,
  createOrUpdateAuthUser,
  updateAuthPassword,
  setAuthUserActive,
  verifyPasswordWithSupabase,
  sendSupabaseVerificationEmail,
  getAuthUserById,
  getAuthUserFromAccessToken,
  findAuthUserByEmail,
  buildOauthStartUrl,
  normalizeEmail,
  getIdentityProviders,
  unlinkAuthIdentity,
}
