import { hashPassword, spendDummyPasswordVerify, upgradePasswordHash, verifyPassword } from './passwordHash'
import { getDb } from './db'
import { canonicalizePhone } from './phone'
import { passwordMinLengthError, passwordTooShort } from './passwordPolicy'
import { customerIsProfileSql, isAnonymousCustomer } from './anonymousCustomer'
import { isMemberCodeCollision, mintMemberCode, normalizeMemberCode } from './memberCode'
import type { Env } from '../index'

// The account decision engine for the storefront. Route code (routes/portal.ts)
// owns the lockout + rate-limit wrapping and the session cookie; this owns the
// "who is this, and may they have an account" logic and the DB writes.
//
// G38 Phase 1 (design §4.1): a website MEMBER (portal_accounts row) is its own
// identity, separate from an in-store CUSTOMER (customers row).
//   - Sign-up never reads or writes `customers`. It used to: a phone already
//     in the CRM got a different answer (a phone-existence oracle), and every
//     new phone wrote a CRM row (one per probe). Both are gone.
//   - The claim path is gone too. Sign-up used to accept an LC-##### number
//     plus a matching phone and attach the account to that customer; LC
//     numbers are sequential and printed on receipts, so that was a takeover
//     path. A member is connected to a customer only by a staff link
//     (routes/portalMembers.ts), recorded in portal_member_link_events.
//   - A new member gets a random W-XXXX-XXXX Member ID (lib/memberCode.ts).
//     Accounts from before G38 keep their LC number in membership_id (frozen,
//     still accepted at sign-in) and get a W- code lazily.
//   - Owner, 5 Oct (answer 4): a LINKED member sees the store number
//     (LC-#####) of the customer they are linked to; the W- code stays as a
//     retired alias that still signs in.

// Passwords are hashed and checked by lib/passwordHash.ts (PBKDF2-SHA256 via
// WebCrypto; legacy bcrypt rows still verify and are rewritten on the next
// successful sign-in). When no account matches, signin spends the same work
// as a real current-format check (spendDummyPasswordVerify), so the answer
// time does not reveal whether the phone exists.

// The storefront asks a visitor to agree to the Terms and the Privacy Policy
// before creating an account, and we record WHICH version they agreed to --
// a bare `consented: 1` proves nothing once the policy text changes. This
// literal must match PORTAL_LEGAL_CONSENT_VERSION in
// frontend/src/components/catalog/legal/legalContent.ts, which is the version
// of the text actually shown; scripts/test-portal-legal-consent-pure.cjs pins
// the two together so they cannot drift apart.
export const PORTAL_CONSENT_VERSION = 'portal-legal-2026-09-30'

// Owner, 30 Sep 2026: the rewrite removed promises and changed no data use, so
// agreement to the earlier text stays valid and nobody is signed out or asked
// again. scripts/test-portal-consent-version-accepted-pure.cjs pins this.
const EARLIER_ACCEPTED_CONSENT_VERSIONS: readonly string[] = ['portal-legal-2026-09-07']

export function portalConsentVersionAccepted(version: unknown): boolean {
  if (typeof version !== 'string') return false
  return version === PORTAL_CONSENT_VERSION || EARLIER_ACCEPTED_CONSENT_VERSIONS.includes(version)
}

// A ticked checkbox arrives as `true` over JSON and as 'true'/'on'/'1' from
// anything that posts a form. Everything else -- absent, false, '', 'false'
// -- is not consent. Silence is never agreement, and a pre-ticked or omitted
// box must fail closed.
export function consentGiven(value: unknown): boolean {
  if (value === true) return true
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'true' || text === 'on' || text === '1' || text === 'yes'
}

// consent_version / consent_at / consent_locale arrive with migration 0130.
// Account creation and sign-in fail closed until all three exist: returning
// success without the durable consent record would contradict the form and
// make later policy-version checks impossible.
const CONSENT_COLUMN_RECHECK_MS = 60_000
let consentColumnState: { present: boolean; checkedAt: number } | null = null

async function portalAccountsHaveConsentColumns(db: ReturnType<typeof getDb>): Promise<boolean> {
  const now = Date.now()
  if (consentColumnState?.present) return true
  if (consentColumnState && now - consentColumnState.checkedAt < CONSENT_COLUMN_RECHECK_MS) return false
  try {
    const rows = await db.prepare('PRAGMA table_info("portal_accounts")').all<{ name?: string }>()
    const names = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.name || '')))
    const present = names.has('consent_version') && names.has('consent_at') && names.has('consent_locale')
    consentColumnState = { present, checkedAt: now }
    return present
  } catch {
    consentColumnState = { present: false, checkedAt: now }
    return false
  }
}

// What the storefront may know about the signed-in member, and nothing else
// (design §6 Phase 1, "response-shape allowlist"). No customer id, no
// customer name, no points, no sales, no phone. `membershipId` is the number
// to show: the linked customer's store number when there is one, else the
// member's own W- code.
export type PortalMemberView = {
  membershipId: string
  memberCode: string | null
  name: string
  email: string | null
  linked: boolean
}

export const PORTAL_MEMBER_VIEW_KEYS: readonly (keyof PortalMemberView)[] = ['membershipId', 'memberCode', 'name', 'email', 'linked']

export type PortalMemberViewSource = {
  member_code?: string | null
  name?: string | null
  email?: string | null
  contact_id?: number | null
  customer_membership_number?: string | null
}

export function portalMemberView(row: PortalMemberViewSource): PortalMemberView {
  const linked = row.contact_id != null
  const storeNumber = linked ? String(row.customer_membership_number ?? '').trim() : ''
  const memberCode = row.member_code ? String(row.member_code) : null
  return {
    membershipId: storeNumber || memberCode || '',
    memberCode,
    name: String(row.name ?? ''),
    email: row.email ? String(row.email) : null,
    linked,
  }
}

export type SignupInput = { name?: unknown; phone?: unknown; membershipId?: unknown; password?: unknown; consent?: unknown; consentLocale?: unknown }
export type SigninInput = { identifier?: unknown; phone?: unknown; password?: unknown; consent?: unknown; consentLocale?: unknown }

// `abuse` marks a failure that should count toward the 10-fail signup cap
// (probing phones) vs. a benign form error (missing field, short password)
// that should not lock a fat-fingering real user out.
export type SignupResult =
  | { ok: true; accountId: number; account: PortalMemberView }
  | { ok: false; status: number; error: string; code: string; abuse: boolean }

export type SigninResult =
  | { ok: true; accountId: number }
  | { ok: false; status: number; error: string; code: string }

// The one answer when the phone already has a website account. It names no
// customer and is the same whether or not the phone is in the CRM.
const SIGNUP_UNAVAILABLE =
  'We could not create an account with these details. If you already have an account, please sign in.'

const MEMBER_CODE_MINT_ATTEMPTS = 5

export async function signupPortalAccount(env: Env, input: SignupInput): Promise<SignupResult> {
  const name = String(input.name ?? '').trim()
  const password = String(input.password ?? '')
  const canonical = canonicalizePhone(input.phone)
  // input.membershipId is ignored on purpose: there is no claim path. A
  // customer's record is connected only by staff (routes/portalMembers.ts).

  // Checked before anything else: a missing box is a form error, so it never
  // counts as abuse.
  if (!consentGiven(input.consent)) {
    return {
      ok: false,
      status: 400,
      error: 'Please agree to the Terms & Conditions and the Privacy Policy to create an account.',
      code: 'consent_required',
      abuse: false,
    }
  }
  const db = getDb(env)
  if (!(await portalAccountsHaveConsentColumns(db))) {
    return {
      ok: false,
      status: 503,
      error: 'Account consent storage is not ready. Please try again later.',
      code: 'consent_storage_unavailable',
      abuse: false,
    }
  }
  if (!name) return { ok: false, status: 400, error: 'Your name is required.', code: 'name_required', abuse: false }
  if (!canonical) return { ok: false, status: 400, error: 'A valid phone number is required.', code: 'phone_required', abuse: false }
  if (passwordTooShort(password)) {
    return { ok: false, status: 400, error: passwordMinLengthError(), code: 'password_weak', abuse: false }
  }
  const passwordHash = await hashPassword(password, env)
  const consentLocale = String(input.consentLocale || 'und').slice(0, 16)

  let lastError: unknown = null
  for (let attempt = 0; attempt < MEMBER_CODE_MINT_ATTEMPTS; attempt += 1) {
    const memberCode = mintMemberCode()
    try {
      const result = await db.prepare(`
        INSERT INTO portal_accounts (
          name, phone, password_hash, member_code, status, link_version,
          consent_version, consent_at, consent_locale, last_seen_at
        ) VALUES (
          @name, @phone, @password_hash, @member_code, 'active', 0,
          @consent_version, CURRENT_TIMESTAMP, @consent_locale, CURRENT_TIMESTAMP
        )
      `).run({
        name,
        phone: canonical,
        password_hash: passwordHash,
        member_code: memberCode,
        consent_version: PORTAL_CONSENT_VERSION,
        consent_locale: consentLocale,
      })
      const accountId = Number(result.lastInsertRowid ?? 0)
      if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('portal_account_insert_result_missing')
      return {
        ok: true,
        accountId,
        account: portalMemberView({ member_code: memberCode, name, email: null, contact_id: null }),
      }
    } catch (error) {
      // A code collision is this function's own doing: mint again (bounded).
      if (isMemberCodeCollision(error)) { lastError = error; continue }
      if (/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
        return { ok: false, status: 409, error: SIGNUP_UNAVAILABLE, code: 'signup_unavailable', abuse: true }
      }
      throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not mint a unique member code')
}

// Accounts from before G38 have no W- code. Mint one on read, compare-and-set,
// so two concurrent requests settle on one code. Returns the stored code.
export async function ensurePortalMemberCode(env: Env, accountId: number): Promise<string | null> {
  const db = getDb(env)
  for (let attempt = 0; attempt < MEMBER_CODE_MINT_ATTEMPTS; attempt += 1) {
    const row = await db.prepare('SELECT member_code FROM portal_accounts WHERE id = @id LIMIT 1')
      .get<{ member_code: string | null }>({ id: accountId })
    if (!row) return null
    if (row.member_code) return row.member_code
    try {
      await db.prepare(`UPDATE portal_accounts SET member_code = @code
        WHERE id = @id AND member_code IS NULL`).run({ code: mintMemberCode(), id: accountId })
    } catch (error) {
      if (!isMemberCodeCollision(error)) throw error
    }
  }
  const final = await db.prepare('SELECT member_code FROM portal_accounts WHERE id = @id LIMIT 1')
    .get<{ member_code: string | null }>({ id: accountId })
  return final?.member_code ?? null
}

// The signed-in member's view, read fresh (the customer's store number can
// change under a link at any time).
export async function loadPortalMemberView(env: Env, accountId: number): Promise<PortalMemberView | null> {
  await ensurePortalMemberCode(env, accountId)
  const row = await getDb(env).prepare(`
    SELECT a.member_code, a.name, a.email, a.contact_id, c.membership_number AS customer_membership_number
    FROM portal_accounts a
    LEFT JOIN customers c ON c.id = a.contact_id
    WHERE a.id = @id
    LIMIT 1
  `).get<PortalMemberViewSource>({ id: accountId })
  return row ? portalMemberView(row) : null
}

export async function signinPortalAccount(env: Env, input: SigninInput): Promise<SigninResult> {
  const identifier = String(input.identifier ?? '').trim()
  const password = String(input.password ?? '')
  const canonical = canonicalizePhone(input.phone)

  const genericFail: SigninResult = { ok: false, status: 401, error: 'Invalid sign-in details. Please check and try again.', code: 'invalid_credentials' }
  if (!identifier || !canonical || !password) return genericFail
  const db = getDb(env)
  if (!(await portalAccountsHaveConsentColumns(db))) {
    return { ok: false, status: 503, error: 'Account consent storage is not ready. Please try again later.', code: 'consent_storage_unavailable' }
  }
  if (!consentGiven(input.consent)) {
    return { ok: false, status: 428, error: 'Please agree to the current Terms & Conditions and Privacy Policy to sign in.', code: 'consent_required' }
  }

  const account = await db.prepare(`
    SELECT a.id, a.name, a.membership_id, a.member_code, a.password_hash, a.status,
           a.contact_id, c.id AS contact_exists, c.is_anonymous,
           c.membership_number AS customer_membership_number
    FROM portal_accounts a
    LEFT JOIN customers c ON c.id = a.contact_id
    WHERE a.phone = @p
    LIMIT 1
  `).get<{
    id: number
    name: string
    membership_id: string | null
    member_code: string | null
    password_hash: string | null
    status: string
    contact_id: number | null
    contact_exists: number | null
    is_anonymous: number | null
    customer_membership_number: string | null
  }>({ p: canonical })

  if (!account || !account.password_hash) {
    // No account for this phone — still spend one password check so timing
    // does not reveal whether the phone exists.
    await spendDummyPasswordVerify(password, env)
    return genericFail
  }

  // Any of the member's names for themselves: their name, their W- code (a
  // retired alias once linked), the LC number an old account was issued, or
  // the store number of the customer they are linked to. Phone + password are
  // the credential; the identifier only has to be one the member knows.
  const idLower = identifier.toLowerCase()
  const memberCode = normalizeMemberCode(identifier)
  const identifierMatches = idLower === String(account.name || '').trim().toLowerCase()
    || (account.membership_id != null && idLower === account.membership_id.trim().toLowerCase())
    || (memberCode != null && memberCode === account.member_code)
    || (account.contact_id != null && account.customer_membership_number != null
      && idLower === account.customer_membership_number.trim().toLowerCase())
  const passwordCheck = await verifyPassword(password, account.password_hash, env)
  const passwordMatches = passwordCheck.ok
  const contactEligible = account.contact_id == null || (account.contact_exists != null && !isAnonymousCustomer(account))
  if (!identifierMatches || !passwordMatches || !contactEligible) return genericFail
  // Only someone holding the password learns that the account is paused.
  if (account.status === 'suspended') {
    return { ok: false, status: 403, error: 'This account is paused. Please contact us.', code: 'portal_account_suspended' }
  }
  if (account.status !== 'active') return genericFail

  const consentUpdate = await db.prepare(`
    UPDATE portal_accounts
    SET consent_version = @version, consent_at = CURRENT_TIMESTAMP, consent_locale = @locale,
        last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
      AND status = 'active'
      AND (contact_id IS NULL OR EXISTS (
        SELECT 1 FROM customers WHERE id = portal_accounts.contact_id AND ${customerIsProfileSql()}
      ))
  `).run({
    version: PORTAL_CONSENT_VERSION,
    locale: String(input.consentLocale || 'und').slice(0, 16),
    id: account.id,
  })
  if (Number(consentUpdate.changes || 0) !== 1) return genericFail

  // E6: a successful sign-in on a legacy bcrypt (or other-count) hash rewrites
  // it once in the current format; compare-and-set, never fails the sign-in.
  if (passwordCheck.needsRehash) await upgradePasswordHash(db, 'portal_accounts', account.id, password, account.password_hash, env)

  return { ok: true, accountId: account.id }
}

// ---------------------------------------------------------------------------
// Identity check code (design §4.4, evidence `called_number_on_file`).
//
// Staff call the phone on the CUSTOMER record; the member reads back the six
// digits their signed-in account shows. Stateless: an HMAC of the account id,
// its link_version and a ten-minute window, under the portal secret with its
// own label. Any link change moves link_version, so a code read before it is
// dead; the previous window is accepted so a code read at 9:59 still works.
// One HMAC, no D1 row, no subrequest: fits the Free plan's CPU budget.
export const PORTAL_LINK_CHECK_WINDOW_MS = 10 * 60 * 1000
const LINK_CHECK_LABEL = 'portal-member-link-check-v1'

type PortalSecretEnv = { PORTAL_ABUSE_HMAC_SECRET?: string }

async function linkCheckDigits(secret: string, accountId: number, linkVersion: number, windowIndex: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${LINK_CHECK_LABEL}\u0000${accountId}\u0000${linkVersion}\u0000${windowIndex}`),
  ))
  const value = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0
  return String(value % 1_000_000).padStart(6, '0')
}

function linkCheckSecret(env: unknown): string | null {
  const secret = String((env as PortalSecretEnv)?.PORTAL_ABUSE_HMAC_SECRET || '')
  return secret.length >= 32 ? secret : null
}

export async function portalLinkCheckCode(
  env: unknown,
  accountId: number,
  linkVersion: number,
  now: number = Date.now(),
): Promise<{ code: string; expiresInSeconds: number } | null> {
  const secret = linkCheckSecret(env)
  if (!secret) return null
  const windowIndex = Math.floor(now / PORTAL_LINK_CHECK_WINDOW_MS)
  const code = await linkCheckDigits(secret, accountId, linkVersion, windowIndex)
  // Accepted until the end of the NEXT window.
  const expiresInSeconds = Math.ceil(((windowIndex + 2) * PORTAL_LINK_CHECK_WINDOW_MS - now) / 1000)
  return { code, expiresInSeconds }
}

export async function verifyPortalLinkCheckCode(
  env: unknown,
  accountId: number,
  linkVersion: number,
  candidate: unknown,
  now: number = Date.now(),
): Promise<boolean> {
  const secret = linkCheckSecret(env)
  const text = String(candidate ?? '').replace(/\s/g, '')
  if (!secret || !/^\d{6}$/.test(text)) return false
  const windowIndex = Math.floor(now / PORTAL_LINK_CHECK_WINDOW_MS)
  let match = false
  for (const index of [windowIndex, windowIndex - 1]) {
    // Compare both windows every time; no early exit on a hit.
    const expected = await linkCheckDigits(secret, accountId, linkVersion, index)
    let diff = 0
    for (let i = 0; i < 6; i += 1) diff |= expected.charCodeAt(i) ^ text.charCodeAt(i)
    if (diff === 0) match = true
  }
  return match
}

// ---------------------------------------------------------------------------
// Member link requests (owner answer 6). The storefront button creates one
// pending request; the member always sees "In review" until staff decide.
// Whether a matching customer exists is never revealed.
export const PORTAL_LINK_REQUEST_NOTE_MAX = 500

export type PortalLinkRequestView = { status: 'in_review'; createdAt: string; note: string | null }

export async function getPendingPortalLinkRequest(env: Env, accountId: number): Promise<PortalLinkRequestView | null> {
  const row = await getDb(env).prepare(`SELECT note, created_at FROM portal_member_link_requests
    WHERE account_id = @id AND status = 'pending' ORDER BY id DESC LIMIT 1`).get<{ note: string | null; created_at: string }>({ id: accountId })
  return row ? { status: 'in_review', createdAt: row.created_at, note: row.note ?? null } : null
}

// Idempotent: a second press returns the request that is already pending.
export async function createPortalLinkRequest(env: Env, accountId: number, note: unknown): Promise<PortalLinkRequestView> {
  const text = String(note ?? '').trim().slice(0, PORTAL_LINK_REQUEST_NOTE_MAX)
  try {
    await getDb(env).prepare(`INSERT INTO portal_member_link_requests (account_id, note, status)
      VALUES (@id, @note, 'pending')`).run({ id: accountId, note: text || null })
  } catch (error) {
    if (!/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) throw error
  }
  const pending = await getPendingPortalLinkRequest(env, accountId)
  if (!pending) throw new Error('portal_link_request_missing')
  return pending
}

export async function withdrawPortalLinkRequest(env: Env, accountId: number): Promise<void> {
  await getDb(env).prepare(`UPDATE portal_member_link_requests
    SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP
    WHERE account_id = @id AND status = 'pending'`).run({ id: accountId })
}
