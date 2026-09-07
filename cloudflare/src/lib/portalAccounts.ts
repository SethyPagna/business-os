import bcrypt from 'bcryptjs'
import { mintMembershipNumber, isMembershipCollision } from './membershipNumber'
import { getDb } from './db'
import { canonicalizePhone } from './phone'
import { formatPhoneP8, collectContactPhones } from './contactDuplicates'
import { passwordMinLengthError, passwordTooShort } from './passwordPolicy'
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

const BCRYPT_COST = 10
// A real, fixed bcrypt hash of a throwaway value. Compared against when no
// account matches so signin does the same work (and takes ~the same time)
// whether or not the phone exists — no timing/enumeration oracle.
const DUMMY_HASH = '$2b$10$bcwRkHdyVgPIxFMLWdK9sOKBez3Uv06DFpLaUR/Mq0c6w595bHNFq'

// The storefront asks a visitor to agree to the Terms and the Privacy Policy
// before creating an account, and we record WHICH version they agreed to --
// a bare `consented: 1` proves nothing once the policy text changes. This
// literal must match PORTAL_LEGAL_CONSENT_VERSION in
// frontend/src/components/catalog/legal/legalContent.ts, which is the version
// of the text actually shown; scripts/test-portal-legal-consent-pure.cjs pins
// the two together so they cannot drift apart.
export const PORTAL_CONSENT_VERSION = 'portal-legal-2026-09-07'

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

export type SignupInput = { name?: unknown; phone?: unknown; membershipId?: unknown; password?: unknown; consent?: unknown; consentLocale?: unknown }
export type SigninInput = { identifier?: unknown; phone?: unknown; password?: unknown; consent?: unknown; consentLocale?: unknown }

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
const EXISTING_REMINDER =
  'If you have previously bought from Leang Cosmetics/Leang Beauty, please contact us for your membership ID — your phone number must match. Just a reminder.'

function existingReject(): SignupResult {
  return { ok: false, status: 409, error: EXISTING_REMINDER, code: 'verification_failed', abuse: true }
}

// One membership-number authority for the whole app: lib/membershipNumber.ts
// mints the next gap-filling `LC-#####`. This file used to carry a THIRD
// independent generator (random `LCMN-` + 6 crypto bytes). A storefront id is
// an account NUMBER, not a credential -- signup already requires a phone that
// matches the customer record and login requires phone AND password -- so a
// sequential id costs nothing that the old entropy was buying.
//
// mintMembershipNumber() reads BOTH customers.membership_number and
// portal_accounts.membership_id directly, so a stale/orphaned account row
// (e.g. a signup whose contact fold failed below) can never collide with a
// fresh mint here. Every id issued here is mirrored into customers too
// (claimAccount either claims an existing customer's number or creates the
// customer row). The INSERT below is still the final arbiter for a lost race.
async function generateMembershipId(env: Env): Promise<string> {
  return mintMembershipNumber(getDb(env))
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
  const passwordHash = bcrypt.hashSync(password, BCRYPT_COST)

  if (membershipId) {
    // Existing-customer path: the id must resolve to a customer whose phone
    // matches. Every failure here returns the same reminder (no oracle).
    const customer = await db.prepare(
      'SELECT id, name, phone, address FROM customers WHERE lower(trim(membership_number)) = lower(trim(@m)) LIMIT 1',
    ).get<{ id: number; name: string | null; phone: string | null; address: string | null }>({ m: membershipId })
    if (!customer) return existingReject()
    const phoneMatches = collectContactPhones(customer).some((raw) => canonicalizePhone(raw) === canonical)
    if (!phoneMatches) return existingReject()
    return claimAccount(env, { membershipId, name, canonical, passwordHash, contactId: customer.id, consentLocale: String(input.consentLocale || 'und').slice(0, 16) })
  }

  // New-customer path: the phone must be absent from customers entirely — if
  // it is already a customer, they are an existing buyer and must use the id.
  const existing = await findCustomerByCanonicalPhone(env, canonical)
  if (existing) return existingReject()

  const newMembershipId = await generateMembershipId(env)
  return claimAccount(env, { membershipId: newMembershipId, name, canonical, passwordHash, contactId: null, createContact: true, consentLocale: String(input.consentLocale || 'und').slice(0, 16) })
}

// Race-safe creation: claim the phone by inserting portal_accounts FIRST and
// letting the UNIQUE constraint arbitrate (D1 has no interactive transaction,
// so a prior read can never be trusted for uniqueness). Only the winner goes
// on to create/link the contact, so two concurrent signups can never produce
// two contacts for one phone.
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
  const columns = ['membership_id', 'name', 'phone', 'password_hash', 'contact_id', 'consent_version', 'consent_at', 'consent_locale']
  const values = ['@membership_id', '@name', '@phone', '@password_hash', '@contact_id', '@consent_version', 'CURRENT_TIMESTAMP', '@consent_locale']
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
      const res = await db.prepare(sql).run(params)
      accountId = res.lastInsertRowid
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/UNIQUE constraint failed/i.test(message)) throw error
      // Only a collision on an id WE minted (createContact === true) may
      // retry -- deliberately NOT gated on remaining-attempts here, so the
      // loop's own bound (maxAttempts) is what stops it, and an id supplied
      // by the caller always falls through to existingReject() below on its
      // very first (and only, maxAttempts === 1) failure.
      if (!(args.createContact === true && isMembershipCollision(error))) return existingReject()
      lastError = error
      membershipId = await mintMembershipNumber(db)
    }
  }

  if (accountId === null) {
    // Exhausted every retry -- mirrors withMintedMembershipNumber's own
    // exhaustion behaviour (throw); the global error handler turns this into
    // a 500 rather than the misleading "verification_failed" reminder.
    throw lastError instanceof Error ? lastError : new Error('Could not mint a unique membership id')
  }

  // Fold the name into a new contact for a genuinely-new customer, then link
  // it. Best-effort: the account already exists and is usable if this fails.
  if (args.createContact) {
    try {
      const contact = await db.prepare(
        'INSERT INTO customers (name, phone, phone_normalized, membership_number) VALUES (@name, @phone, @phone_normalized, @membership_number)',
      ).run({
        name: args.name,
        phone: formatPhoneP8(args.canonical),
        phone_normalized: args.canonical,
        membership_number: membershipId,
      })
      await db.prepare('UPDATE portal_accounts SET contact_id = @cid WHERE id = @id').run({ cid: contact.lastInsertRowid, id: accountId })
    } catch (_) {
      // Contact fold failed — leave the account contact-less rather than fail
      // the signup; staff can reconcile from Contacts.
    }
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

  const account = await db.prepare(
    'SELECT id, name, membership_id, password_hash, consent_version FROM portal_accounts WHERE phone = @p LIMIT 1',
  ).get<{ id: number; name: string; membership_id: string; password_hash: string; consent_version: string | null }>({ p: canonical })

  if (!account) {
    // No account for this phone — still spend a bcrypt compare so timing does
    // not reveal whether the phone exists.
    bcrypt.compareSync(password, DUMMY_HASH)
    return genericFail
  }

  const idLower = identifier.toLowerCase()
  const identifierMatches = idLower === account.name.trim().toLowerCase() || idLower === account.membership_id.trim().toLowerCase()
  const passwordMatches = bcrypt.compareSync(password, account.password_hash)
  if (!identifierMatches || !passwordMatches) return genericFail

  await db.prepare(`
    UPDATE portal_accounts
    SET consent_version = @version, consent_at = CURRENT_TIMESTAMP, consent_locale = @locale, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    version: PORTAL_CONSENT_VERSION,
    locale: String(input.consentLocale || 'und').slice(0, 16),
    id: account.id,
  })

  return { ok: true, accountId: account.id }
}
