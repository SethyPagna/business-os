import { hashPassword, spendFailedSignInFloor, upgradePasswordHash, verifySignInPassword } from './passwordHash'
import { failedSignInFloor, noteLegacyBcryptSeen, noteLegacyBcryptUpgraded } from './failedSignInCost'
import { mintMembershipNumber, isMembershipCollision } from './membershipNumber'
import { resolveClientIdentity } from './clientIdentity'
import { getDb } from './db'
import { canonicalizePhone } from './phone'
import { formatPhoneP8, collectContactPhones, contactDuplicateWriteGuardStatement } from './contactDuplicates'
import { passwordMinLengthError, passwordTooShort } from './passwordPolicy'
import { customerIsProfileSql, customerProfileMutationGuardSql, isAnonymousCustomer } from './anonymousCustomer'
import type { Env } from '../index'

// The account decision engine for the storefront. Route code (routes/portal.ts)
// owns the lockout + rate-limit wrapping and the session cookie; this owns the
// "who is this, and may they have an account" logic and the DB writes.
//
// Two identity stores, deliberately different:
//   - customers (CRM): may hold duplicates, shared phones, space-formatted
//     numbers. This is where 5,500+ imported customers already live.
//   - portal_accounts: canonical, ONE account per phone, one per membership id.
// A NEW customer (phone absent from customers) self-signs-up and gets an auto
// membership id + a folded contact. An EXISTING customer (phone already in
// customers) cannot self-signup — they register with their membership id + a
// MATCHING phone, which staff issue from Contacts.

// Passwords are hashed and checked by lib/passwordHash.ts (PBKDF2-SHA256 via
// WebCrypto; legacy bcrypt rows still verify and are rewritten on the next
// successful sign-in). Every FAILED signin -- no account for the phone, wrong
// password, wrong name or membership id, ineligible contact -- is topped up to
// the same hash work (spendFailedSignInFloor): one PBKDF2 check, plus one
// bcrypt-10 compare while any storefront account still holds a bcrypt hash on
// Paid (lib/failedSignInCost.ts). Storefront customers cannot be asked to
// sign in, so on Paid that bcrypt padding is expected to stay. On
// PLAN_TIER=free bcrypt never runs as padding: there, a wrong password on a
// not-yet-upgraded bcrypt account answers slower than an unknown phone (a
// warning is logged), until that customer signs in once.

// The storefront asks a visitor to agree to the Terms and the Privacy Policy
// before creating an account, and we record WHICH version they agreed to --
// a bare `consented: 1` proves nothing once the policy text changes. This
// literal must match PORTAL_LEGAL_CONSENT_VERSION in
// frontend/src/components/catalog/legal/legalContent.ts, which is the version
// of the text actually shown; scripts/test-portal-legal-consent-pure.cjs pins
// the two together so they cannot drift apart.
export const PORTAL_CONSENT_VERSION = 'portal-legal-2026-10-20'

// Owner, 20 Oct 2026: every account agrees again to the age-16 wording, so no
// earlier version is accepted (the 30 Sep rewrite had accepted 2026-09-07).
// An account is current only with this exact version AND a stored age
// confirmation; scripts/test-portal-consent-version-accepted-pure.cjs pins it.
export function portalConsentVersionAccepted(version: unknown): boolean {
  return version === PORTAL_CONSENT_VERSION
}

export function portalConsentCurrent(row: { consent_version?: unknown; consent_at?: unknown; age_confirmed_at?: unknown }): boolean {
  return portalConsentVersionAccepted(row.consent_version) && !!row.consent_at && !!row.age_confirmed_at
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

// consent_version / consent_at / consent_locale arrive with migration 0130,
// age_confirmed_at with 0262.
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
    const present = names.has('consent_version') && names.has('consent_at') && names.has('consent_locale') && names.has('age_confirmed_at')
    consentColumnState = { present, checkedAt: now }
    return present
  } catch {
    consentColumnState = { present: false, checkedAt: now }
    return false
  }
}

export type SignupInput = { name?: unknown; phone?: unknown; membershipId?: unknown; password?: unknown; consent?: unknown; consentLocale?: unknown; ageConfirmed?: unknown }
export type SigninInput = { identifier?: unknown; phone?: unknown; password?: unknown; consent?: unknown; consentLocale?: unknown; ageConfirmed?: unknown }

// `abuse` marks a failure that should count toward the 10-fail signup cap
// (probing phones/membership ids) vs. a benign form error (missing field,
// short password) that should not lock a fat-fingering real user out.
export type SignupResult =
  | { ok: true; accountId: number; membershipId: string; name: string }
  | { ok: false; status: number; error: string; code: string; abuse: boolean }

export type SigninResult =
  | { ok: true; accountId: number }
  | { ok: false; status: number; error: string; code: string }

// One deliberately non-committal message for every "we can't verify you as an
// existing customer" branch (unknown id / phone mismatch / already claimed) so
// none of them becomes an existence oracle for a membership id or phone.
function existingReject(env: Env): SignupResult {
  const shopNames = resolveClientIdentity(env).shopNames
  const error = `If you have previously bought from ${shopNames}, please contact us for your membership ID — your phone number must match. Just a reminder.`
  return { ok: false, status: 409, error, code: 'verification_failed', abuse: true }
}

// One membership-number authority for the whole app: lib/membershipNumber.ts
// mints the next gap-filling house number (`LC-#####` at Leang). This file used to carry a THIRD
// independent generator (random `LCMN-` + 6 crypto bytes). A storefront id is
// an account NUMBER, not a credential -- signup already requires a phone that
// matches the customer record and login requires phone AND password -- so a
// sequential id costs nothing that the old entropy was buying.
//
// mintMembershipNumber() reads BOTH customers.membership_number and
// portal_accounts.membership_id directly, so a stale/orphaned account row
// from older data can never collide with a fresh mint here. Every id issued
// here is mirrored into customers too
// (claimAccount either claims an existing customer's number or creates the
// customer row). The INSERT below is still the final arbiter for a lost race.
async function generateMembershipId(env: Env): Promise<string> {
  return mintMembershipNumber(getDb(env), resolveClientIdentity(env).membershipPrefix)
}

// Does any customer already carry this canonical phone (primary or a secondary
// Contact Option phone)? Primary is exact against the backfilled
// phone_normalized column; secondary is a best-effort LIKE prefilter confirmed
// in JS (same shape as lib/contactDuplicates.ts::findContactDuplicates).
async function findCustomerByCanonicalPhone(env: Env, canonical: string): Promise<{ id: number; name: string | null } | null> {
  const db = getDb(env)
  const primary = await db.prepare(
    'SELECT id, name FROM customers WHERE phone_normalized = @p LIMIT 1',
  ).get<{ id: number; name: string | null }>({ p: canonical })
  if (primary) return primary
  const candidates = await db.prepare(
    'SELECT id, name, phone, address FROM customers WHERE address LIKE @like LIMIT 25',
  ).all<{ id: number; name: string | null; phone: string | null; address: string | null }>({ like: `%${canonical.replace(/^0/, '')}%` })
  for (const cand of candidates) {
    if (collectContactPhones(cand).some((raw) => canonicalizePhone(raw) === canonical)) {
      return { id: cand.id, name: cand.name }
    }
  }
  return null
}

export async function signupPortalAccount(env: Env, input: SignupInput): Promise<SignupResult> {
  const name = String(input.name ?? '').trim()
  const password = String(input.password ?? '')
  const canonical = canonicalizePhone(input.phone)
  const membershipId = String(input.membershipId ?? '').trim()

  // Checked before anything is looked up: refusing after the phone probe
  // would let a caller use signup as a phone-existence oracle while never
  // consenting. A missing box is a form error, so it never counts as abuse.
  if (!consentGiven(input.consent)) {
    return {
      ok: false,
      status: 400,
      error: 'Please agree to the Terms & Conditions and the Privacy Policy to create an account.',
      code: 'consent_required',
      abuse: false,
    }
  }
  // Owner rule: minimum account age is 16. Strict boolean, unlike consent: the
  // storefront sends JSON true from the combined tick, and a form-style
  // 'true'/'on' is not a confirmation. claimAccount stores it as
  // age_confirmed_at in the same write as the consent record.
  if (input.ageConfirmed !== true) {
    return {
      ok: false,
      status: 400,
      error: 'Please confirm you are 16 or older to create an account.',
      code: 'age_confirmation_required',
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
  // Portal accounts get the stricter rule (lib/passwordPolicy.ts): the
  // storefront privacy policy promises eight characters, and a phone number
  // is both the login identifier here and the commonest password there is.
  if (passwordTooShort(password)) {
    return { ok: false, status: 400, error: passwordMinLengthError(), code: 'password_weak', abuse: false }
  }
  const passwordHash = await hashPassword(password, env)

  if (membershipId) {
    // Existing-customer path: the id must resolve to a customer whose phone
    // matches. Every failure here returns the same reminder (no oracle).
    const customer = await db.prepare(
      'SELECT id, name, phone, address, is_anonymous FROM customers WHERE lower(trim(membership_number)) = lower(trim(@m)) LIMIT 1',
    ).get<{ id: number; name: string | null; phone: string | null; address: string | null; is_anonymous: number }>({ m: membershipId })
    if (!customer || isAnonymousCustomer(customer)) return existingReject(env)
    const phoneMatches = collectContactPhones(customer).some((raw) => canonicalizePhone(raw) === canonical)
    if (!phoneMatches) return existingReject(env)
    return claimAccount(env, { membershipId, name, canonical, passwordHash, contactId: customer.id, consentLocale: String(input.consentLocale || 'und').slice(0, 16) })
  }

  // New-customer path: the phone must be absent from customers entirely — if
  // it is already a customer, they are an existing buyer and must use the id.
  const existing = await findCustomerByCanonicalPhone(env, canonical)
  if (existing) return existingReject(env)

  const newMembershipId = await generateMembershipId(env)
  return claimAccount(env, { membershipId: newMembershipId, name, canonical, passwordHash, contactId: null, createContact: true, consentLocale: String(input.consentLocale || 'und').slice(0, 16) })
}

// Race-safe creation: an existing customer claim only inserts the account.
// A genuinely-new customer instead commits the canonical-phone guard, folded
// contact, linked account and durable consent in ONE D1 batch. A staff-created
// contact that wins after signup's advisory read therefore makes the guard
// throw and rolls the account write back; an account constraint that fires
// after the contact insert rolls the contact back too.
//
// Two UNIQUE indexes can fire here (migration 0087): idx_portal_accounts_phone
// and idx_portal_accounts_membership. A phone collision (or a membership-id
// collision on a USER-SUPPLIED id -- the existing-customer claim path, which
// has no number of its own to change) is a genuine "you are not who you say
// you are" case: existingReject(), no oracle. A membership-id collision on an
// id WE minted (createContact === true, i.e. the new-customer auto-mint path)
// is entirely this function's own doing -- two signups computed the same
// gap-fill number because neither had written yet -- so it re-mints and
// retries the INSERT, bounded, exactly like withMintedMembershipNumber does
// for contacts.ts.
async function claimAccount(
  env: Env,
  args: { membershipId: string; name: string; canonical: string; passwordHash: string; contactId: number | null; createContact?: boolean; consentLocale: string },
): Promise<SignupResult> {
  const db = getDb(env)
  let membershipId = args.membershipId
  let accountId: number | null = null
  let lastError: unknown = null
  const maxAttempts = args.createContact ? 5 : 1
  const columns = ['membership_id', 'name', 'phone', 'password_hash', 'contact_id', 'consent_version', 'consent_at', 'consent_locale', 'age_confirmed_at']
  const values = ['@membership_id', '@name', '@phone', '@password_hash', '@contact_id', '@consent_version', 'CURRENT_TIMESTAMP', '@consent_locale', 'CURRENT_TIMESTAMP']
  const sql = `INSERT INTO portal_accounts (${columns.join(', ')}) VALUES (${values.join(', ')})`

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const params: Record<string, unknown> = {
      // Read from `membershipId`, never `args`: a retry has re-minted it.
      membership_id: membershipId,
      name: args.name,
      phone: args.canonical,
      password_hash: args.passwordHash,
      contact_id: args.contactId,
    }
    params.consent_version = PORTAL_CONSENT_VERSION
    params.consent_locale = args.consentLocale || 'und'
    try {
      if (args.createContact) {
        const contactGuard = contactDuplicateWriteGuardStatement(
          'customers',
          { phones: [args.canonical] },
        )
        if (!contactGuard) throw new Error('portal_contact_guard_missing')

        const batchResults = await db.batch([
          contactGuard,
          {
            sql: 'INSERT INTO customers (name, phone, phone_normalized, membership_number) VALUES (@name, @phone, @phone_normalized, @membership_number)',
            params: {
              name: args.name,
              phone: formatPhoneP8(args.canonical),
              phone_normalized: args.canonical,
              membership_number: membershipId,
            },
          },
          {
            sql: `INSERT INTO portal_accounts (
              membership_id, name, phone, password_hash, contact_id,
              consent_version, consent_at, consent_locale, age_confirmed_at
            ) VALUES (
              @membership_id, @name, @phone, @password_hash,
              COALESCE((
                SELECT id FROM customers
                WHERE lower(trim(membership_number)) = lower(trim(@membership_id))
                  AND phone_normalized = @phone
                LIMIT 1
              ), json_extract('portal_contact_missing', '$')),
              @consent_version, CURRENT_TIMESTAMP, @consent_locale, CURRENT_TIMESTAMP
            )`,
            params,
          },
        ])
        const insertedAccountId = Number(batchResults[2]?.meta?.last_row_id ?? 0)
        if (!Number.isSafeInteger(insertedAccountId) || insertedAccountId <= 0) {
          throw new Error('portal_account_insert_result_missing')
        }
        accountId = insertedAccountId
      } else {
        const results = await db.batch([
          { sql: customerProfileMutationGuardSql('contactId'), params: { contactId: args.contactId } },
          { sql, params },
        ])
        accountId = Number(results[1]?.meta?.last_row_id ?? 0) || null
      }
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (args.contactId != null) {
        const guardedContact = await db.prepare('SELECT is_anonymous FROM customers WHERE id = @id LIMIT 1')
          .get<{ is_anonymous: number | null }>({ id: args.contactId })
        if (isAnonymousCustomer(guardedContact)) return existingReject(env)
      }
      if (!/UNIQUE constraint failed/i.test(message)) throw error
      // Only a collision on an id WE minted (createContact === true) may
      // retry -- deliberately NOT gated on remaining-attempts here, so the
      // loop's own bound (maxAttempts) is what stops it, and an id supplied
      // by the caller always falls through to existingReject() below on its
      // very first (and only, maxAttempts === 1) failure.
      if (!(args.createContact === true && isMembershipCollision(error))) return existingReject(env)
      lastError = error
      membershipId = await mintMembershipNumber(db, resolveClientIdentity(env).membershipPrefix)
    }
  }

  if (accountId === null) {
    // Exhausted every retry -- mirrors withMintedMembershipNumber's own
    // exhaustion behaviour (throw); the global error handler turns this into
    // a 500 rather than the misleading "verification_failed" reminder.
    throw lastError instanceof Error ? lastError : new Error('Could not mint a unique membership id')
  }

  return { ok: true, accountId, membershipId, name: args.name }
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

  // Resolved before the account lookup, so its (cached) query is spent whether
  // or not the phone has an account.
  const failureFloor = await failedSignInFloor(env, db, 'portal_accounts')
  const account = await db.prepare(`
    SELECT a.id, a.name, a.membership_id, a.password_hash, a.consent_version,
           a.contact_id, c.id AS contact_exists, c.is_anonymous
    FROM portal_accounts a
    LEFT JOIN customers c ON c.id = a.contact_id
    WHERE a.phone = @p
    LIMIT 1
  `).get<{
    id: number
    name: string
    membership_id: string
    password_hash: string
    consent_version: string | null
    contact_id: number | null
    contact_exists: number | null
    is_anonymous: number | null
  }>({ p: canonical })

  if (!account) {
    // No account for this phone: spend the full failed-signin work, the same
    // as a wrong password on the slowest account that can still exist, so the
    // answer time does not reveal whether the phone has an account. Only the
    // hash work is equalised; see the note at the top of this file.
    await spendFailedSignInFloor(password, env, null, failureFloor)
    return genericFail
  }

  const idLower = identifier.toLowerCase()
  const identifierMatches = idLower === account.name.trim().toLowerCase() || idLower === account.membership_id.trim().toLowerCase()
  const passwordCheck = await verifySignInPassword(password, account.password_hash, env)
  if (passwordCheck.scheme === 'bcrypt') noteLegacyBcryptSeen('portal_accounts')
  const passwordMatches = passwordCheck.ok
  const contactEligible = account.contact_id == null || (account.contact_exists != null && !isAnonymousCustomer(account))
  if (!identifierMatches || !passwordMatches || !contactEligible) {
    await spendFailedSignInFloor(password, env, passwordCheck.spent, failureFloor)
    return genericFail
  }

  const consentUpdate = await db.prepare(`
    UPDATE portal_accounts
    SET consent_version = @version, consent_at = CURRENT_TIMESTAMP, consent_locale = @locale,
        age_confirmed_at = CASE WHEN @age = 1 THEN CURRENT_TIMESTAMP ELSE age_confirmed_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
      AND (contact_id IS NULL OR EXISTS (
        SELECT 1 FROM customers WHERE id = portal_accounts.contact_id AND ${customerIsProfileSql()}
      ))
  `).run({
    version: PORTAL_CONSENT_VERSION,
    locale: String(input.consentLocale || 'und').slice(0, 16),
    age: input.ageConfirmed === true ? 1 : 0,
    id: account.id,
  })
  if (Number(consentUpdate.changes || 0) !== 1) return genericFail

  // E6: a successful sign-in on a legacy bcrypt (or other-count) hash rewrites
  // it once in the current format; compare-and-set, never fails the sign-in.
  if (passwordCheck.needsRehash) {
    const upgraded = await upgradePasswordHash(db, 'portal_accounts', account.id, password, account.password_hash, env)
    if (upgraded && passwordCheck.scheme === 'bcrypt') noteLegacyBcryptUpgraded('portal_accounts')
  }

  return { ok: true, accountId: account.id }
}

export type RenewConsentResult =
  | { ok: true; renewed: boolean }
  | { ok: false; status: 400 | 404 | 503; error: string; code: string }

// An already-signed-in account agrees again to the current wording (owner,
// 20 Oct 2026). Same tick and rules as sign-up: a missing tick is a form
// error and ageConfirmed must be JSON true. Idempotent: an account that is
// already current keeps its original consent_at and reports renewed=false.
export async function renewPortalConsent(
  env: Env,
  accountId: number,
  input: { consent?: unknown; ageConfirmed?: unknown; consentLocale?: unknown },
): Promise<RenewConsentResult> {
  if (!consentGiven(input.consent)) {
    return { ok: false, status: 400, error: 'Please agree to the Terms & Conditions and the Privacy Policy to continue.', code: 'consent_required' }
  }
  if (input.ageConfirmed !== true) {
    return { ok: false, status: 400, error: 'Please confirm you are 16 or older to continue.', code: 'age_confirmation_required' }
  }
  const db = getDb(env)
  if (!(await portalAccountsHaveConsentColumns(db))) {
    return { ok: false, status: 503, error: 'Account consent storage is not ready. Please try again later.', code: 'consent_storage_unavailable' }
  }
  const result = await db.prepare(`
    UPDATE portal_accounts
    SET consent_version = @version, consent_at = CURRENT_TIMESTAMP, consent_locale = @locale,
        age_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
      AND NOT (consent_version = @version AND consent_at IS NOT NULL AND age_confirmed_at IS NOT NULL)
  `).run({ version: PORTAL_CONSENT_VERSION, locale: String(input.consentLocale || 'und').slice(0, 16), id: accountId })
  if (Number(result.changes || 0) === 1) return { ok: true, renewed: true }
  const current = await db.prepare('SELECT id FROM portal_accounts WHERE id = @id LIMIT 1').get<{ id: number }>({ id: accountId })
  if (!current) return { ok: false, status: 404, error: 'Account not found.', code: 'portal_unauthenticated' }
  return { ok: true, renewed: false }
}
