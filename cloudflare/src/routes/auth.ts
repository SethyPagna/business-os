import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import { getDb } from '../lib/db'
import { createSession, setSessionCookie, clearSessionCookie, getSessionUser, revokeSession, revokeUserSessions, requireAuth } from '../lib/auth'
import type { SessionUser } from '../lib/auth'
import { issuePasswordResetLink, consumePasswordResetLink, normalizeEmail, isEmailConfigured } from '../lib/verification'
import { audit } from '../lib/audit'
import { encryptSecret, decryptSecret } from '../lib/secretCrypto'
import { generateTotpSecret, verifyTotp } from '../lib/totp'
import { isAdminControlUser } from '../lib/permissions'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { MIN_PASSWORD_LENGTH, passwordTooShort, passwordMinLengthError } from '../lib/passwordPolicy'
import { recordFailedLogin, getLoginLockoutState, clearLoginLockout } from '../lib/loginLockout'
import { requiresDeviceApproval, checkDeviceTrust } from '../lib/deviceTrust'
import {
  buildGoogleOauthStartUrl,
  exchangeGoogleOauthCode,
  getGoogleLoginPublicConfig,
  getGoogleUserFromTokens,
  normalizeReturnTarget,
  verifyState,
} from '../lib/googleOauth'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

const GENERIC_RESET_REQUEST_RESPONSE = { success: true, message: 'If this account can receive recovery email, reset instructions have been sent.' }
// MIN_PASSWORD_LENGTH now lives in lib/passwordPolicy.ts (shared with
// routes/users.ts) -- see that file's header for why.

// Same defaults as backend/src/routes/auth.ts's AUTH_OTP_MAX_ATTEMPTS/
// AUTH_OTP_IP_MAX_ATTEMPTS env vars (unset there in practice, so these ARE
// the effective production values, not just fallbacks).
const OTP_LIMIT_MAX = 10
const OTP_LIMIT_WINDOW_MS = 10 * 60 * 1000
const OTP_IP_LIMIT_MAX = 25
const OTP_IP_LIMIT_WINDOW_MS = OTP_LIMIT_WINDOW_MS

// Brute-force / credential-stuffing protection on POST /login. Previously
// this endpoint had no rate limiting at all -- unlike /otp/verify and
// /password-reset/*, which both already used checkRateLimit. Two buckets:
// a per-IP ceiling (catches distributed low-and-slow guessing across many
// usernames from one source) and a tighter per-username ceiling (catches
// focused guessing at one account, even if the attacker rotates IPs).
// Both are only counted on a *failed* attempt (see the route below), so a
// legitimate user mistyping their password a couple of times never gets
// close to either limit in practice.
const LOGIN_IP_LIMIT_MAX = 20
const LOGIN_IP_LIMIT_WINDOW_MS = 15 * 60 * 1000
const LOGIN_USER_LIMIT_MAX = 8
const LOGIN_USER_LIMIT_WINDOW_MS = 15 * 60 * 1000

type OtpTargetUser = {
  id: number
  username: string
  name: string
  password: string
  otp_enabled: number
  otp_secret: string | null
  otp_pending_secret: string | null
  permissions: string | null
  role_code: string | null
  role_permissions: string | null
}

async function getOtpTargetUser(env: Env, userId: number | string): Promise<OtpTargetUser | null> {
  const db = getDb(env)
  const row = await db.prepare(`
    SELECT u.id, u.username, u.name, u.password, u.otp_enabled, u.otp_secret, u.otp_pending_secret,
           u.permissions, r.code AS role_code, r.permissions AS role_permissions
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.deleted_at IS NULL
    LIMIT 1
  `).get<OtpTargetUser>([userId])
  return row || null
}

// Ported from backend/src/authOtpGuards.ts. A user can always manage their
// own OTP; managing someone else's requires admin control over a
// non-admin target (an admin can't be OTP-disabled by another admin).
function canManageOtpTarget(actor: SessionUser | null | undefined, target: OtpTargetUser | null | undefined): boolean {
  const actorId = Number(actor?.id || 0)
  const targetId = Number(target?.id || 0)
  if (!actorId || !targetId) return false
  if (actorId === targetId) return true
  if (!isAdminControlUser(actor)) return false
  if (isAdminControlUser(target)) return false
  return true
}

function requiresSelfOtpDisablePassword(actor: SessionUser | null | undefined, target: OtpTargetUser | null | undefined, password: unknown): boolean {
  const actorId = Number(actor?.id || 0)
  const targetId = Number(target?.id || 0)
  if (!actorId || !targetId || actorId !== targetId) return false
  return !String(password || '').trim()
}

app.post('/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string; sessionDuration?: string; deviceName?: string; deviceId?: string; deviceTz?: string }>()
  if (!body.username || !body.password) {
    return c.json({ error: 'Username and password are required' }, 400)
  }

  const ip = getClientIp(c.req.raw)

  // Checked before touching the DB for credentials so a saturated bucket
  // can't be worked around by varying the username -- the per-IP limit
  // below the username lookup would otherwise still let an attacker burn
  // through the per-user bucket for many different usernames in parallel.
  const ipLimit = await checkRateLimit(c.env, 'auth:login_ip', ip, LOGIN_IP_LIMIT_MAX, LOGIN_IP_LIMIT_WINDOW_MS)
  if (!ipLimit.allowed) {
    return c.json({ error: 'Too many login attempts from this network. Please try again later.' }, 429)
  }

  // Persistent, escalating per-username lockout (see lib/loginLockout.ts) --
  // separate from and checked ahead of the sliding-window userLimit below,
  // since that window resets on its own and doesn't escalate the wait.
  // Checked before the DB credential lookup for the same reason as the IP
  // limit above -- a locked account shouldn't get a password compare at all.
  const lockoutState = await getLoginLockoutState(c.env, body.username)
  if (lockoutState.locked) {
    return c.json({
      error: `Too many failed login attempts. Please wait ${lockoutState.retryAfterSeconds} seconds and try again.`,
      locked: true,
      retryAfterSeconds: lockoutState.retryAfterSeconds,
      failedAttempts: lockoutState.failedCount,
    }, 429)
  }

  const db = getDb(c.env)

  // The sign-in field is labelled "Username, name, email, or phone" and has
  // been for a long time, but this query only ever matched `u.username` --
  // so signing in with a name, an email address or a phone number failed
  // with "Invalid username or password", which reads as a wrong password
  // rather than an unsupported identifier. Real, confirmed mismatch between
  // what the UI promises and what the server accepts.
  //
  // Resolution order is deliberate. `username` is checked on its own first
  // and wins outright: it is the only column with a uniqueness constraint,
  // so an exact username match can never be ambiguous, and a person whose
  // username happens to equal someone else's *name* must still get their
  // own account.
  //
  // The other three are matched together, and only accepted when they
  // identify EXACTLY ONE account. `name` in particular is not unique in
  // this database (staff share display names), and logging somebody into
  // the wrong account because two people are both called "Dara" would be a
  // far worse failure than asking them to use their username. An ambiguous
  // identifier therefore falls through to the same generic failure below as
  // a non-existent one -- deliberately identical, so the response cannot be
  // used to discover which names or phone numbers are shared.
  const identifier = String(body.username ?? '').trim()
  const identifierLower = identifier.toLowerCase()
  const identifierPhone = identifier.replace(/[^\d+]/g, '')

  const SELECT_LOGIN_USER = `
    SELECT u.id, u.username, u.name, u.password, u.organization_id, u.role_id, u.permissions, u.is_active, u.otp_enabled, u.otp_secret,
           r.code AS role_code, r.permissions AS role_permissions
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
  `
  type LoginUserRow = { id: number; username: string; name: string; password: string; organization_id: number | null; role_id: number | null; permissions: string; is_active: number; otp_enabled: number; otp_secret: string | null; role_code: string | null; role_permissions: string | null }

  let user = await db.prepare(`
    ${SELECT_LOGIN_USER}
    WHERE lower(u.username) = lower(@identifier) AND u.deleted_at IS NULL
    LIMIT 1
  `).get<LoginUserRow>({ identifier })

  if (!user) {
    // LIMIT 2, not 1: the second row is what tells us the identifier is
    // ambiguous. Fetching only one would silently pick an arbitrary account.
    const candidates = await db.prepare(`
      ${SELECT_LOGIN_USER}
      WHERE u.deleted_at IS NULL
        AND (
          lower(trim(COALESCE(u.email, ''))) = @identifierLower
          OR (@identifierPhone <> '' AND COALESCE(u.phone_lookup, '') = @identifierPhone)
          OR lower(trim(COALESCE(u.name, ''))) = @identifierLower
        )
      LIMIT 2
    `).all<LoginUserRow>({ identifierLower, identifierPhone })
    if (candidates && candidates.length === 1) user = candidates[0]
  }

  const userLimitKey = `user:${body.username.trim().toLowerCase()}`
  const userLimit = await checkRateLimit(c.env, 'auth:login_user', userLimitKey, LOGIN_USER_LIMIT_MAX, LOGIN_USER_LIMIT_WINDOW_MS)
  if (!userLimit.allowed) {
    return c.json({ error: 'Too many login attempts for this account. Please try again later.' }, 429)
  }

  // Same response whether the user doesn't exist or the password is wrong --
  // ported deliberately from the original, which avoids confirming which
  // usernames exist via response differences (a real, if minor, security
  // property worth keeping even in this scoped-down port). Every failure
  // path here also feeds the escalating lockout counter above -- "if login
  // fails more than 5 times it lets you wait, tells you that, and
  // increments every time until successful" applies the same to a wrong
  // password and to a username that doesn't exist, so a probe against
  // unknown usernames can't dodge the counter either.
  const invalidCredentials = async () => {
    const failure = await recordFailedLogin(c.env, body.username)
    if (failure.locked) {
      return c.json({
        error: `Too many failed login attempts. Please wait ${failure.retryAfterSeconds} seconds and try again.`,
        locked: true,
        retryAfterSeconds: failure.retryAfterSeconds,
        failedAttempts: failure.failedCount,
      }, 429)
    }
    return c.json({ error: 'Invalid username or password', failedAttempts: failure.failedCount }, 401)
  }

  if (!user || !user.is_active) return invalidCredentials()
  const passwordMatches = bcrypt.compareSync(body.password, user.password)
  if (!passwordMatches) return invalidCredentials()

  // Password matched -- clear the lockout counter here (not only at full
  // session creation further down) so an OTP-enabled account's counter
  // resets as soon as the *password* step succeeds, same as it would for
  // an account with no second factor. The OTP code itself has its own,
  // separate rate limiting (OTP_LIMIT_MAX/OTP_IP_LIMIT_MAX below).
  await clearLoginLockout(c.env, body.username)

  // Device-approval gate -- every non-administrator role must be approved
  // once per device. Administrator-control accounts remain able to manage
  // approvals after a browser reset or device replacement.
  if (requiresDeviceApproval(user)) {
    const trustCheck = await checkDeviceTrust(c.env, user.id, body.deviceId, {
      deviceName: body.deviceName,
      userAgent: c.req.header('user-agent'),
      ip,
      country: c.req.header('cf-ipcountry'),
    })
    if (trustCheck.status !== 'approved') {
      if (trustCheck.status === 'rejected') {
        await audit(c.env, user.id, user.username, 'login_device_rejected', 'user', user.id, { deviceId: body.deviceId })
        return c.json({ error: 'This device was denied access by an administrator. Contact your admin if this is unexpected.', deviceStatus: 'rejected' }, 403)
      }
      await audit(c.env, user.id, user.username, 'login_device_pending', 'user', user.id, {
        deviceId: body.deviceId,
        deviceName: body.deviceName || null,
        userAgent: c.req.header('user-agent') || null,
        ip: ip || null,
        country: c.req.header('cf-ipcountry') || null,
        status: trustCheck.status,
        roleCode: user.role_code,
      })
      return c.json({
        deviceApprovalRequired: true,
        deviceStatus: trustCheck.status === 'missing_device_id' ? 'pending' : trustCheck.status,
        message: 'This device is awaiting administrator approval before you can sign in.',
      }, 200)
    }
  }

  // Login-time TOTP gate -- previously this Worker never checked
  // otp_enabled at all, so any account with 2FA turned on was fully
  // bypassed by hitting /login directly with just the password. Now
  // matches backend/src/routes/auth.ts: a password match on an OTP-enabled
  // account returns `otpRequired` instead of a session; the frontend
  // (Login.tsx) already handles this shape and prompts for the code, which
  // completes at POST /otp/verify below.
  if (user.otp_enabled) {
    const otpSecret = await decryptSecret(user.otp_secret, c.env.APP_ENCRYPTION_KEY)
    if (!otpSecret) {
      return c.json({ error: 'Two-factor authentication is unavailable for this account. Please contact an administrator.' }, 503)
    }
    return c.json({ otpRequired: true, userId: user.id })
  }

  const session = await createSession(c.env, user.id, {
    sessionDuration: body.sessionDuration,
    deviceName: body.deviceName,
    deviceId: body.deviceId,
    // deviceTz was sent by the frontend on every /login call but silently
    // dropped here -- /refresh and /session-duration already capture it
    // the same way, so login was the one place a device's timezone never
    // got recorded. Found via a frontend<->backend request-body contract
    // diff, not a live bug report.
    deviceTz: body.deviceTz,
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('cf-connecting-ip') || undefined,
  })
  setSessionCookie(c, session.token, session.expiresAt)

  return c.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      organizationId: user.organization_id,
      roleId: user.role_id,
      permissions: user.permissions,
      // role_code / role_permissions were queried above but never returned
      // here, unlike GET /me and GET /bootstrap which both include them.
      //
      // Real, reproduced consequence: most users hold NO permissions of
      // their own -- `users.permissions` is `{}` and every grant comes from
      // their role (the built-in admin is exactly this: `{}` on the user,
      // `{"all":true}` on the role). The frontend merges the two
      // (AppContext's getMergedPermissionsRaw), so a user object missing
      // role_permissions resolves to NO permissions at all: the nav
      // collapses to the two unpermissioned pages, and every gated control
      // disappears.
      //
      // That was normally masked because the app re-fetches GET
      // /auth/bootstrap right after login and overwrites the user with the
      // complete row. It is NOT masked whenever that follow-up cannot run:
      // appBootstrapTransport falls back to a purely local bootstrap
      // (readStoredUser) when no sync-server URL resolves -- which is the
      // default on the Vite dev server, and also the offline path -- and
      // then the login payload IS the session user for the rest of it.
      // Reproduced live: signing in as `admin` against the dev server left
      // an app showing only Notes and Library, with the profile chip
      // reading "No role".
      //
      // Returning them here makes the login response self-sufficient and
      // consistent with /me and /bootstrap, so no caller depends on a
      // follow-up request to become correctly authorized.
      role_code: user.role_code,
      role_permissions: user.role_permissions,
    },
    sessionExpiresAt: session.expiresAt,
  })
})

app.post('/logout', async (c) => {
  await revokeSession(c)
  clearSessionCookie(c)
  return c.json({ ok: true })
})

app.get('/me', async (c) => {
  const user = await getSessionUser(c)
  // Same `code: 'invalid_session'` fix as lib/auth.ts's requireAuth -- this
  // route does its own inline getSessionUser check rather than going
  // through that shared middleware, so it needed the identical fix
  // applied separately.
  if (!user) return c.json({ error: 'Not authenticated', code: 'invalid_session' }, 401)
  return c.json({ user })
})

app.get('/bootstrap', async (c) => {
  const user = await getSessionUser(c)
  if (!user) {
    return c.json({ error: 'Not authenticated', code: 'invalid_session' }, 401)
  }

  const db = getDb(c.env)
  const settingsRows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string | null }>()
  const settings = Object.fromEntries((settingsRows || []).map((row) => [row.key, row.value]))

  return c.json({
    user,
    settings,
    organization: null,
    group: null,
    system: {
      runtime: {
        runtime: 'cloudflare-workers',
        database: 'd1',
        objectStorage: 'r2',
        cache: 'kv',
      },
    },
  })
})

// ---- Password reset via email (real implementation, see lib/verification.ts) ----
//
// Matches the flow already built into the frontend (Login.tsx +
// api/authTransport.ts): /password-reset/email sends a magic link (the
// client passes redirectTo = its own current URL; the emailed link is that
// URL with #access_token=...&type=recovery appended). The client parses
// that token off the URL when it lands back on the page and POSTs it to
// /password-reset/complete along with the new password.
//
// /email deliberately returns the exact same response whether the
// identifier matched a real account, had no email on file, was
// rate-limited, or the email provider isn't configured -- anything else
// would let a caller enumerate valid usernames/emails or probe account
// state.
app.post('/password-reset/email', async (c) => {
  const body = await c.req.json<{ identifier?: string; redirectTo?: string }>().catch(() => ({} as { identifier?: string; redirectTo?: string }))
  const identifier = String(body.identifier || '').trim()
  if (!identifier) return c.json(GENERIC_RESET_REQUEST_RESPONSE)

  const db = getDb(c.env)
  const user = await db.prepare(`
    SELECT id, email FROM users
    WHERE (lower(username) = lower(@identifier) OR lower(email) = lower(@identifier))
      AND deleted_at IS NULL AND is_active = 1
    LIMIT 1
  `).get<{ id: number; email: string | null }>({ identifier })

  const requesterIp = c.req.header('cf-connecting-ip') || null
  if (user?.email) {
    await issuePasswordResetLink(c.env, user.id, normalizeEmail(user.email), String(body.redirectTo || ''), requesterIp)
    // Deliberately not branching on { issued, sent } here -- see comment
    // above on why the response can't vary with account/rate-limit state.
  }

  return c.json(GENERIC_RESET_REQUEST_RESPONSE)
})

app.post('/password-reset/complete', async (c) => {
  const body = await c.req.json<{ accessToken?: string; newPassword?: string }>().catch(() => ({} as { accessToken?: string; newPassword?: string }))
  const accessToken = String(body.accessToken || '').trim()
  const newPassword = String(body.newPassword || '')

  if (!accessToken || !newPassword) {
    return c.json({ success: false, error: 'Recovery link and new password are required' }, 400)
  }
  if (passwordTooShort(newPassword)) {
    return c.json({ success: false, error: passwordMinLengthError() }, 400)
  }

  const result = await consumePasswordResetLink(c.env, accessToken)
  if (!result.ok) {
    return c.json({ success: false, error: result.reason === 'expired' ? 'Recovery link has expired. Please request a new one.' : 'Recovery link is invalid or already used.' }, 400)
  }

  const db = getDb(c.env)
  const user = await db.prepare('SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL AND is_active = 1').get<{ id: number; name: string }>([result.userId])
  if (!user) return c.json({ success: false, error: 'Account no longer available' }, 400)

  const passwordHash = bcrypt.hashSync(newPassword, 10)
  await db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run([passwordHash, user.id])
  // Reset means "I may have lost control of this account" -- every
  // existing session (including any an attacker holds) should stop working.
  await db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run([user.id])
  await audit(c.env, user.id, user.name, 'password_reset', 'user', user.id, { via: 'email_link' })

  return c.json({ success: true })
})

// Field names here matter: Login.tsx and UserProfileModal.tsx read
// `google_oauth`, `google_email_auth`, and `google_login.enabled` off this
// response (see PORTING_STATUS.md checkpoint 7's "found, not fixed" note --
// every prior version of this endpoint, legacy and Cloudflare, returned
// `otp`/`email`/`google`/`passwordReset` instead, so the Google-sign-in
// button on both screens had always evaluated to "disabled" regardless of
// server state). Fixed here alongside the actual OAuth port below.
app.get('/verification-capabilities', (c) => {
  const googleLogin = getGoogleLoginPublicConfig(c.env)
  return c.json({
    otp: true,
    email: isEmailConfigured(c.env),
    google_oauth: googleLogin.enabled,
    google_login: googleLogin,
    facebook_oauth: false,
    google_email_auth: false,
    passwordReset: isEmailConfigured(c.env),
  })
})

// GET /api/auth/otp/status/:userId -- matches legacy shape ({ otpEnabled })
// wrapped by requireAuth + the same manage-target permission check as the
// setup/confirm/disable routes below (self, or admin-over-non-admin).
app.get('/otp/status/:id', requireAuth, async (c) => {
  const actor = c.get('user')
  const target = await getOtpTargetUser(c.env, c.req.param('id') || '')
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (!canManageOtpTarget(actor, target)) return c.json({ error: 'No permission' }, 403)
  return c.json({ otpEnabled: !!target.otp_enabled })
})

// POST /api/auth/otp/verify -- second step of login for OTP-enabled
// accounts. Public (no session yet), so it's rate-limited both per-IP and
// per-target-user, same two-bucket shape as backend/src/routes/auth.ts.
app.post('/otp/verify', async (c) => {
  const body = await c.req.json<{ userId?: number; token?: string; sessionDuration?: string; deviceName?: string; deviceId?: string; deviceTz?: string; clientTime?: string }>().catch(() => ({} as { userId?: number; token?: string; sessionDuration?: string; deviceName?: string; deviceId?: string; deviceTz?: string; clientTime?: string }))
  if (!body.userId || !body.token) return c.json({ error: 'userId and token required' }, 400)

  const ip = getClientIp(c.req.raw)
  const ipLimit = await checkRateLimit(c.env, 'auth:otp_ip', ip, OTP_IP_LIMIT_MAX, OTP_IP_LIMIT_WINDOW_MS)
  if (!ipLimit.allowed) return c.json({ error: 'Too many OTP attempts from this network.' }, 429)
  const userLimit = await checkRateLimit(c.env, 'auth:otp', `user:${body.userId}`, OTP_LIMIT_MAX, OTP_LIMIT_WINDOW_MS)
  if (!userLimit.allowed) return c.json({ error: 'Too many OTP attempts.' }, 429)

  const db = getDb(c.env)
  const user = await db.prepare(`
    SELECT id, username, name, organization_id, role_id, permissions, otp_secret
    FROM users
    WHERE id = ? AND is_active = 1 AND deleted_at IS NULL AND otp_enabled = 1 AND otp_secret IS NOT NULL
  `).get<{ id: number; username: string; name: string; organization_id: number | null; role_id: number | null; permissions: string; otp_secret: string }>([body.userId])
  if (!user) return c.json({ error: 'Invalid request' }, 401)

  const otpSecret = await decryptSecret(user.otp_secret, c.env.APP_ENCRYPTION_KEY)
  if (!otpSecret) return c.json({ error: 'OTP secret is unavailable. Please set up OTP again.' }, 400)
  const verified = await verifyTotp(otpSecret, String(body.token || ''))
  if (!verified) return c.json({ error: 'Invalid OTP code' }, 401)

  await audit(c.env, user.id, user.username, 'login', 'user', user.id, { username: user.username, method: 'otp' })

  const session = await createSession(c.env, user.id, {
    sessionDuration: body.sessionDuration,
    deviceName: body.deviceName,
    deviceId: body.deviceId,
    deviceTz: body.deviceTz,
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('cf-connecting-ip') || undefined,
  })
  setSessionCookie(c, session.token, session.expiresAt)
  return c.json({ user: buildUserPayload(user), sessionExpiresAt: session.expiresAt, authMode: 'cookie' })
})

// POST /api/auth/session-duration -- re-issues the current session's
// cookie with a new expiry/remember-me duration, without re-entering a
// password. Matches backend/src/routes/auth.ts's grace-period rotation:
// the caller's *current* cookie is left valid (no revoke) since the
// response also sets the new cookie in the same round trip and there's no
// second in-flight request racing to hand off here in the Workers port.
app.post('/session-duration', requireAuth, async (c) => {
  const body = await c.req.json<{ sessionDuration?: string; deviceName?: string; deviceId?: string; deviceTz?: string; clientTime?: string }>().catch(() => ({} as { sessionDuration?: string; deviceName?: string; deviceId?: string; deviceTz?: string; clientTime?: string }))
  const user = c.get('user')
  if (!user?.id) return c.json({ error: 'Please sign in again to continue.' }, 401)

  const session = await createSession(c.env, user.id, {
    sessionDuration: body.sessionDuration,
    deviceName: body.deviceName,
    deviceId: body.deviceId,
    deviceTz: body.deviceTz,
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('cf-connecting-ip') || undefined,
  })
  setSessionCookie(c, session.token, session.expiresAt)

  await audit(c.env, user.id, user.username, 'session_duration_updated', 'user', user.id, {
    sessionDuration: String(body.sessionDuration || 'session').trim().toLowerCase() || 'session',
  })

  return c.json({ sessionExpiresAt: session.expiresAt, authMode: 'cookie' })
})

// POST /api/auth/otp/setup -- generates a new pending secret (not active
// until /otp/confirm). QR image rendering isn't ported (see lib/totp.ts
// header comment) -- returns qrDataUrl: null, and the frontend's OtpModal
// already falls back to showing the manual base32 entry key in that case.
app.post('/otp/setup', requireAuth, async (c) => {
  const actor = c.get('user')
  const body = await c.req.json<{ userId?: number }>().catch(() => ({} as { userId?: number }))
  const target = await getOtpTargetUser(c.env, body.userId || actor.id)
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (!canManageOtpTarget(actor, target)) return c.json({ error: 'No permission' }, 403)

  const { base32, otpauthUrl } = generateTotpSecret(target.username)
  const encrypted = await encryptSecret(base32, c.env.APP_ENCRYPTION_KEY)
  const db = getDb(c.env)
  await db.prepare(`
    UPDATE users SET otp_pending_secret = ?, otp_pending_created_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run([encrypted, target.id])

  return c.json({ success: true, secret: base32, qrDataUrl: null, otpAuthUrl: otpauthUrl })
})

// POST /api/auth/otp/confirm -- verifies the setup code against the
// pending secret and, if it matches, promotes it to the active secret.
app.post('/otp/confirm', requireAuth, async (c) => {
  const actor = c.get('user')
  const body = await c.req.json<{ userId?: number; token?: string }>().catch(() => ({} as { userId?: number; token?: string }))
  if (!body.userId || !body.token) return c.json({ error: 'userId and token required' }, 400)
  const target = await getOtpTargetUser(c.env, body.userId)
  if (!target || !target.otp_pending_secret) return c.json({ error: 'OTP not set up' }, 400)
  if (!canManageOtpTarget(actor, target)) return c.json({ error: 'No permission' }, 403)

  const pendingSecret = await decryptSecret(target.otp_pending_secret, c.env.APP_ENCRYPTION_KEY)
  if (!pendingSecret) return c.json({ error: 'OTP setup secret is unavailable. Please start setup again.' }, 400)
  const verified = await verifyTotp(pendingSecret, String(body.token || ''))
  if (!verified) return c.json({ error: 'Invalid code. Check your authenticator app time sync.' }, 400)

  const db = getDb(c.env)
  await db.prepare(`
    UPDATE users SET otp_secret = otp_pending_secret, otp_pending_secret = NULL, otp_pending_created_at = NULL, otp_enabled = 1
    WHERE id = ?
  `).run([target.id])
  await audit(c.env, actor.id, actor.username, 'update', 'user', target.id, { action: 'otp_enabled', target_user: target.username })
  return c.json({ success: true })
})

// POST /api/auth/otp/disable -- self-disable requires the current
// password (extra check on top of an already-authenticated session);
// admin-disabling someone else's OTP doesn't need that account's password.
app.post('/otp/disable', requireAuth, async (c) => {
  const actor = c.get('user')
  const body = await c.req.json<{ userId?: number; password?: string }>().catch(() => ({} as { userId?: number; password?: string }))
  if (!body.userId) return c.json({ error: 'userId required' }, 400)
  const target = await getOtpTargetUser(c.env, body.userId)
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (!canManageOtpTarget(actor, target)) return c.json({ error: 'No permission' }, 403)
  if (requiresSelfOtpDisablePassword(actor, target, body.password)) return c.json({ error: 'Password required' }, 400)
  if (Number(actor.id) === Number(target.id) && !bcrypt.compareSync(String(body.password || ''), target.password)) {
    return c.json({ error: 'Incorrect password' }, 401)
  }

  const db = getDb(c.env)
  await db.prepare(`
    UPDATE users SET otp_enabled = 0, otp_secret = NULL, otp_pending_secret = NULL, otp_pending_created_at = NULL WHERE id = ?
  `).run([target.id])
  await audit(c.env, actor.id, actor.username, 'update', 'user', target.id, { action: 'otp_disabled', target_user: target.username })
  return c.json({ success: true })
})

// POST /api/auth/password-reset/otp -- account-recovery path for users who
// have TOTP enabled but lost email access: prove control via a valid TOTP
// code instead of a magic link, then set a new password directly.
app.post('/password-reset/otp', async (c) => {
  const body = await c.req.json<{ identifier?: string; otp?: string; newPassword?: string }>().catch(() => ({} as { identifier?: string; otp?: string; newPassword?: string }))
  const identifier = String(body.identifier || '').trim()
  if (!identifier) return c.json({ error: 'Username or email is required' }, 400)
  if (!body.otp) return c.json({ error: 'OTP code is required' }, 400)
  if (!body.newPassword || passwordTooShort(body.newPassword)) return c.json({ error: passwordMinLengthError() }, 400)

  const limit = await checkRateLimit(c.env, 'auth:password_reset_otp', `${getClientIp(c.req.raw)}:${identifier}`, OTP_LIMIT_MAX, OTP_LIMIT_WINDOW_MS)
  if (!limit.allowed) return c.json({ error: 'Too many OTP reset attempts.' }, 429)

  const db = getDb(c.env)
  const user = await db.prepare(`
    SELECT id, username, otp_enabled, otp_secret
    FROM users
    WHERE (lower(username) = lower(@identifier) OR lower(email) = lower(@identifier))
      AND deleted_at IS NULL AND is_active = 1
    LIMIT 1
  `).get<{ id: number; username: string; otp_enabled: number; otp_secret: string | null }>({ identifier })
  if (!user || !user.otp_enabled) return c.json({ error: 'Invalid reset request' }, 400)

  const otpSecret = await decryptSecret(user.otp_secret, c.env.APP_ENCRYPTION_KEY)
  if (!otpSecret) return c.json({ error: 'Invalid reset request' }, 400)
  const verified = await verifyTotp(otpSecret, String(body.otp || ''))
  if (!verified) return c.json({ error: 'Invalid OTP code' }, 401)

  const passwordHash = bcrypt.hashSync(String(body.newPassword), 10)
  await db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run([passwordHash, user.id])
  await revokeUserSessions(c.env, user.id)
  await audit(c.env, user.id, user.username, 'password_reset_complete', 'user', user.id, { method: 'otp' })

  return c.json({ message: 'Password reset successfully.' })
})

function normalizeOauthMode(mode: unknown): 'login' | 'link' {
  return trim(mode).toLowerCase() === 'link' ? 'link' : 'login'
}

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function buildUserPayload(user: {
  id: number; username: string; name: string; organization_id: number | null; role_id: number | null; permissions: string | null
}) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    organizationId: user.organization_id,
    roleId: user.role_id,
    permissions: user.permissions,
  }
}

type LocalUserRow = {
  id: number
  username: string
  name: string
  email: string | null
  organization_id: number | null
  role_id: number | null
  permissions: string | null
  is_active: number
  google_subject: string | null
}

async function updateLocalUserGoogleIdentity(env: Env, userId: number, googleUser: { sub: string; email: string; emailVerified: boolean }): Promise<LocalUserRow> {
  const db = getDb(env)
  const googleSubject = trim(googleUser.sub) || null
  const email = normalizeEmail(googleUser.email || '') || null
  const emailVerified = googleUser.emailVerified ? 1 : 0
  const existing = await db.prepare('SELECT email FROM users WHERE id = ?').get<{ email: string | null }>([userId])
  const localEmail = normalizeEmail(existing?.email || '')
  const emailConflict = email
    ? await db.prepare('SELECT id FROM users WHERE id != ? AND lower(trim(email)) = ? LIMIT 1').get([userId, email])
    : null
  const shouldReplaceEmail = !emailConflict && (!localEmail || (!!email && localEmail === email))
  await db.prepare(`
    UPDATE users
    SET google_subject = COALESCE(NULLIF(?, ''), google_subject),
        google_email = COALESCE(?, google_email),
        google_email_verified = CASE WHEN ? = 1 THEN 1 ELSE google_email_verified END,
        google_linked_at = CURRENT_TIMESTAMP,
        email = CASE WHEN ? = 1 THEN COALESCE(?, email) ELSE email END,
        email_verified = CASE WHEN ? = 1 AND ? = 1 THEN 1 ELSE email_verified END
    WHERE id = ?
  `).run([googleSubject, email, emailVerified, shouldReplaceEmail ? 1 : 0, shouldReplaceEmail ? email : null, shouldReplaceEmail ? 1 : 0, emailVerified, userId])
  const updated = await db.prepare(`
    SELECT id, username, name, email, organization_id, role_id, permissions, is_active, google_subject
    FROM users WHERE id = ?
  `).get<LocalUserRow>([userId])
  if (!updated) throw new Error('User not found after Google identity update')
  return updated
}

// POST /api/auth/oauth/start -- builds the Google consent URL the client
// redirects the browser to (or opens in a popup). `mode: 'link'` requires
// an existing session (linking Google to the already-logged-in account);
// `mode: 'login'` (default) is the sign-in flow.
app.post('/oauth/start', async (c) => {
  const body = await c.req.json<{ provider?: string; mode?: string; organization?: string; redirectTo?: string; deviceId?: string; deviceName?: string }>().catch(() => ({} as Record<string, string>))
  if (trim(body.provider || 'google').toLowerCase() !== 'google') {
    return c.json({ error: 'Only Google login is supported.' }, 400)
  }
  const oauthMode = normalizeOauthMode(body.mode)
  let currentUserId = 0
  if (oauthMode === 'link') {
    const sessionUser = await getSessionUser(c)
    if (!sessionUser?.id) return c.json({ error: 'Please sign in before linking Google.' }, 401)
    currentUserId = Number(sessionUser.id || 0) || 0
  }
  const result = await buildGoogleOauthStartUrl(c.env, {
    mode: oauthMode,
    organization: body.organization,
    currentUserId,
    returnTo: body.redirectTo,
    // Carried through the redirect round-trip (see OauthStatePayload) so
    // the callback below can run the same admin device-approval gate that
    // POST /login runs -- previously Google sign-in never checked device
    // trust at all, letting an approved admin's Google identity sign in
    // from any unrecognized device/browser with no approval step.
    deviceId: body.deviceId,
    deviceName: body.deviceName,
  })
  if (!result.success) return c.json({ error: result.error || 'Failed to start OAuth flow' }, 400)
  return c.json({ url: result.url, mode: oauthMode })
})

function buildOauthCallbackHtml(opts: { payload: Record<string, unknown>; targetUrl: string; title: string; message: string }): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${opts.title}</title>
    <style>
      body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
      .card{max-width:460px;width:100%;background:#111827;border:1px solid rgba(148,163,184,.24);border-radius:18px;padding:24px;box-shadow:0 18px 60px rgba(15,23,42,.28)}
      h1{font-size:20px;line-height:1.25;margin:0 0 10px}
      p{margin:0;color:#cbd5e1;font-size:14px;line-height:1.55}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${opts.title}</h1>
      <p>${opts.message}</p>
    </div>
    <script>
      (function () {
        const payload = ${JSON.stringify(opts.payload)};
        const targetUrl = ${JSON.stringify(opts.targetUrl)};
        try { localStorage.setItem('businessos_oauth_callback_result', JSON.stringify(payload)); } catch (_) {}
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'business-os-oauth', payload }, '*');
            window.close();
            return;
          }
        } catch (_) {}
        window.location.replace(targetUrl);
      })();
    </script>
  </body>
</html>`
}

// GET /api/auth/oauth/callback -- Google redirects here with ?code&state.
// Exchanges the code, resolves/links the local user, and returns a small
// HTML page that posts the result back to the opener window (popup flow)
// or falls back to a full-page redirect, matching Login.tsx's listener.
app.get('/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const stateParam = c.req.query('state')
  const stateResult = await verifyState(c.env, stateParam)
  const oauthMode = normalizeOauthMode(stateResult.payload?.mode)
  const returnTarget = normalizeReturnTarget(
    c.env,
    `${trim(stateResult.payload?.returnOrigin).replace(/\/$/, '')}${trim(stateResult.payload?.returnPath)}`,
    oauthMode,
  )
  const basePayload: Record<string, unknown> = { type: 'business-os-oauth', provider: 'google', mode: oauthMode, ts: Date.now() }

  const fail = (status: 400 | 401 | 500, error: string, title = 'Google sign-in failed') =>
    c.html(buildOauthCallbackHtml({
      payload: { ...basePayload, status: 'error', error },
      targetUrl: returnTarget.url,
      title,
      message: error || 'Please return to Business OS and try again.',
    }), status)

  if (!stateResult.success) return fail(400, stateResult.error || 'Google sign-in failed.')

  const tokenResult = await exchangeGoogleOauthCode(c.env, code, stateResult.payload || {})
  if (!tokenResult.success) return fail(401, tokenResult.error || 'Google sign-in failed.')

  const userResult = await getGoogleUserFromTokens(tokenResult.tokens || {})
  if (!userResult.success || !userResult.user) return fail(401, userResult.error || 'Google profile lookup failed.')

  try {
    const db = getDb(c.env)
    const googleUser = userResult.user
    const googleSubject = googleUser.sub
    const statePayload = stateResult.payload!

    const linkedToOtherUser = await db.prepare(`
      SELECT id FROM users WHERE google_subject = ? AND (? = 0 OR id != ?) AND deleted_at IS NULL LIMIT 1
    `).get<{ id: number }>([googleSubject, Number(statePayload.currentUserId || 0), Number(statePayload.currentUserId || 0)])

    let callbackPayload: Record<string, unknown>

    if (oauthMode === 'link') {
      const actorId = Number(statePayload.currentUserId || 0)
      if (!actorId) { callbackPayload = { success: false, error: 'A local user session is required to link Google.' } }
      else if (linkedToOtherUser) { callbackPayload = { success: false, error: 'This Google account is already linked to another user.' } }
      else {
        const localUser = await db.prepare('SELECT id, username, name FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get<{ id: number; username: string; name: string }>([actorId])
        if (!localUser) { callbackPayload = { success: false, error: 'Local account is not available.' } }
        else {
          const synced = await updateLocalUserGoogleIdentity(c.env, localUser.id, googleUser)
          await audit(c.env, localUser.id, localUser.username, 'identity_linked', 'user', localUser.id, { provider: 'google', email: googleUser.email, google_subject: googleSubject })
          callbackPayload = { success: true, mode: oauthMode, provider: 'google', user: buildUserPayload(synced) }
        }
      }
    } else {
      const localUser = await db.prepare(`
        SELECT id, username, name, email, organization_id, role_id, permissions, is_active, google_subject,
               otp_enabled, otp_secret
        FROM users WHERE google_subject = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1
      `).get<LocalUserRow & { otp_enabled: number; otp_secret: string | null }>([googleSubject])
      // Device-approval gate -- the same non-admin check POST /login runs,
      // resolved before the OTP branch below so Google sign-in cannot bypass
      // it. Previously this callback never called checkDeviceTrust at all:
      // Google sign-in was a second, fully separate login path that could
      // bypass device approval. deviceId comes
      // from the signed state (set at /oauth/start from the browser's
      // persisted device id, see lib/googleOauth.ts), not from anything
      // Google returns, so it can't be spoofed via the OAuth redirect.
      let deviceGate: { blocked: false } | { blocked: true; payload: Record<string, unknown> } = { blocked: false }
      if (localUser && requiresDeviceApproval(localUser)) {
        const trustCheck = await checkDeviceTrust(c.env, localUser.id, statePayload.deviceId, {
          deviceName: statePayload.deviceName || 'Google OAuth',
          userAgent: c.req.header('user-agent'),
          ip: c.req.header('cf-connecting-ip') || undefined,
          country: c.req.header('cf-ipcountry'),
        })
        if (trustCheck.status === 'rejected') {
          await audit(c.env, localUser.id, localUser.username, 'login_device_rejected', 'user', localUser.id, { deviceId: statePayload.deviceId, method: 'google' })
          deviceGate = { blocked: true, payload: {
            success: true,
            deviceApprovalRequired: true,
            deviceStatus: 'rejected',
            error: 'This device was denied access by an administrator. Contact your admin if this is unexpected.',
          } }
        } else if (trustCheck.status !== 'approved') {
          await audit(c.env, localUser.id, localUser.username, 'login_device_pending', 'user', localUser.id, {
            deviceId: statePayload.deviceId,
            deviceName: statePayload.deviceName || 'Google OAuth',
            userAgent: c.req.header('user-agent') || null,
            ip: c.req.header('cf-connecting-ip') || null,
            country: c.req.header('cf-ipcountry') || null,
            status: trustCheck.status,
            method: 'google',
          })
          deviceGate = { blocked: true, payload: {
            success: true,
            deviceApprovalRequired: true,
            deviceStatus: 'pending',
            message: 'This device is awaiting administrator approval before you can sign in.',
          } }
        }
      }

      if (!localUser) {
        callbackPayload = { success: false, error: 'No active local account is linked to this Google account yet. Sign in with your password first, then link Google from My Profile.' }
      } else if (deviceGate.blocked) {
        callbackPayload = deviceGate.payload
      } else if (localUser.otp_enabled) {
        // Same login-time TOTP gate as POST /login below: an OTP-enabled
        // account never gets a session straight off a successful identity
        // check (password there, Google identity here) -- it gets routed
        // through POST /otp/verify first. Previously this branch always
        // called createSession() regardless of otp_enabled, so a Google
        // sign-in fully bypassed 2FA for any account that had it turned
        // on -- the second, still-open entry point named in
        // PORTING_STATUS.md. The frontend (Login.tsx) already handles
        // this exact { otpRequired, userId } shape from the OAuth
        // callback, so no frontend change was needed.
        const otpSecret = await decryptSecret(localUser.otp_secret, c.env.APP_ENCRYPTION_KEY)
        if (!otpSecret) {
          callbackPayload = { success: false, error: 'OTP secret is unavailable for this account. Please contact an administrator.' }
        } else {
          callbackPayload = { success: true, otpRequired: true, userId: localUser.id, provider: 'google' }
        }
      } else {
        const synced = await updateLocalUserGoogleIdentity(c.env, localUser.id, googleUser)
        await audit(c.env, synced.id, synced.username, 'login', 'user', synced.id, { method: 'google', email: googleUser.email, google_subject: googleSubject })
        const session = await createSession(c.env, synced.id, { deviceName: statePayload.deviceName || 'Google OAuth', deviceId: statePayload.deviceId, userAgent: c.req.header('user-agent') || undefined, ip: c.req.header('cf-connecting-ip') || undefined })
        setSessionCookie(c, session.token, session.expiresAt)
        callbackPayload = { success: true, provider: 'google', user: buildUserPayload(synced), sessionExpiresAt: session.expiresAt, authMode: 'cookie' }
      }
    }

    const status = callbackPayload.success === false ? 400 : 200
    const successPayload: Record<string, unknown> = { ...basePayload, status: callbackPayload.success === false ? 'error' : 'success', ...callbackPayload }
    const title = successPayload.status === 'success' ? (oauthMode === 'link' ? 'Google account connected' : 'Google sign-in complete') : 'Google sign-in failed'
    const message = successPayload.status === 'success'
      ? (oauthMode === 'link' ? 'Returning to your profile now.' : 'Returning to Business OS now.')
      : String(successPayload.error || 'Please return to Business OS and try again.')
    return c.html(buildOauthCallbackHtml({ payload: successPayload, targetUrl: returnTarget.url, title, message }), status)
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : 'Google sign-in failed.')
  }
})

app.post('/oauth/complete', (c) => c.json({ error: 'Use the Google OAuth callback to complete sign-in.' }, 400))

// POST /api/auth/oauth/unlink -- removes the Google identity from the
// currently signed-in account. Requires the current password since it's a
// security-sensitive change to how the account can be accessed.
app.post('/oauth/unlink', requireAuth, async (c) => {
  const body = await c.req.json<{ currentPassword?: string }>().catch(() => ({} as { currentPassword?: string }))
  const actorId = Number(c.get('user')?.id || 0)
  if (!actorId) return c.json({ error: 'Please sign in again to continue.' }, 401)
  const db = getDb(c.env)
  const user = await db.prepare('SELECT id, username, name, password FROM users WHERE id = ?').get<{ id: number; username: string; name: string; password: string }>([actorId])
  if (!user) return c.json({ error: 'User not found.' }, 404)
  if (!body.currentPassword || !bcrypt.compareSync(String(body.currentPassword), user.password)) {
    return c.json({ error: 'Current password is required to unlink Google.' }, 403)
  }
  await db.prepare(`
    UPDATE users SET google_subject = NULL, google_email = NULL, google_email_verified = 0, google_linked_at = NULL WHERE id = ?
  `).run([actorId])
  await audit(c.env, actorId, user.username, 'identity_unlinked', 'user', actorId, { provider: 'google' })
  const updated = await db.prepare('SELECT id, username, name, organization_id, role_id, permissions FROM users WHERE id = ?').get<LocalUserRow>([actorId])
  return c.json({ user: updated ? buildUserPayload(updated) : null })
})

export default app
