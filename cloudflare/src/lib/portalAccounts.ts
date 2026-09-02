import bcrypt from 'bcryptjs'
import { getDb } from './db'
import { canonicalizePhone } from './phone'
import { formatPhoneP8, collectContactPhones } from './contactDuplicates'
import { passwordTooShort, passwordMinLengthError } from './passwordPolicy'
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

export type SignupInput = { name?: unknown; phone?: unknown; membershipId?: unknown; password?: unknown }
export type SigninInput = { identifier?: unknown; phone?: unknown; password?: unknown }

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

async function generateMembershipId(env: Env): Promise<string> {
  const db = getDb(env)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    // Account identifiers must not come from a predictable PRNG. Six random
    // bytes provide 48 bits of Web-Crypto entropy; the uniqueness checks and
    // INSERT constraint below remain the final race-safe arbiter.
    const bytes = crypto.getRandomValues(new Uint8Array(6))
    const entropy = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
    const candidate = `LCMN-${entropy}`
    // Globally unique across BOTH stores — a membership id must never collide
    // with an existing customer's number or another account's.
    const inCustomers = await db.prepare('SELECT id FROM customers WHERE lower(trim(membership_number)) = lower(trim(@candidate)) LIMIT 1').get({ candidate })
    const inAccounts = await db.prepare('SELECT id FROM portal_accounts WHERE lower(trim(membership_id)) = lower(trim(@candidate)) LIMIT 1').get({ candidate })
    if (!inCustomers && !inAccounts) return candidate
  }
  throw new Error('Could not generate a unique membership id')
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

  if (!name) return { ok: false, status: 400, error: 'Your name is required.', code: 'name_required', abuse: false }
  if (!canonical) return { ok: false, status: 400, error: 'A valid phone number is required.', code: 'phone_required', abuse: false }
  if (passwordTooShort(password)) return { ok: false, status: 400, error: passwordMinLengthError(), code: 'password_weak', abuse: false }

  const db = getDb(env)
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
    return claimAccount(env, { membershipId, name, canonical, passwordHash, contactId: customer.id })
  }

  // New-customer path: the phone must be absent from customers entirely — if
  // it is already a customer, they are an existing buyer and must use the id.
  const existing = await findCustomerByCanonicalPhone(env, canonical)
  if (existing) return existingReject()

  const newMembershipId = await generateMembershipId(env)
  return claimAccount(env, { membershipId: newMembershipId, name, canonical, passwordHash, contactId: null, createContact: true })
}

// Race-safe creation: claim the phone by inserting portal_accounts FIRST and
// letting the UNIQUE constraint arbitrate (D1 has no interactive transaction,
// so a prior read can never be trusted for uniqueness). Only the winner goes
// on to create/link the contact, so two concurrent signups can never produce
// two contacts for one phone.
async function claimAccount(
  env: Env,
  args: { membershipId: string; name: string; canonical: string; passwordHash: string; contactId: number | null; createContact?: boolean },
): Promise<SignupResult> {
  const db = getDb(env)
  let accountId: number
  try {
    const res = await db.prepare(
      'INSERT INTO portal_accounts (membership_id, name, phone, password_hash, contact_id) VALUES (@membership_id, @name, @phone, @password_hash, @contact_id)',
    ).run({
      membership_id: args.membershipId,
      name: args.name,
      phone: args.canonical,
      password_hash: args.passwordHash,
      contact_id: args.contactId,
    })
    accountId = res.lastInsertRowid
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/UNIQUE constraint failed/i.test(message)) {
      // Either the phone or the membership id was taken between our check and
      // this insert — same reminder, no oracle.
      return existingReject()
    }
    throw error
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
        membership_number: args.membershipId,
      })
      await db.prepare('UPDATE portal_accounts SET contact_id = @cid WHERE id = @id').run({ cid: contact.lastInsertRowid, id: accountId })
    } catch (_) {
      // Contact fold failed — leave the account contact-less rather than fail
      // the signup; staff can reconcile from Contacts.
    }
  }

  return { ok: true, accountId, membershipId: args.membershipId, name: args.name }
}

export async function signinPortalAccount(env: Env, input: SigninInput): Promise<SigninResult> {
  const identifier = String(input.identifier ?? '').trim()
  const password = String(input.password ?? '')
  const canonical = canonicalizePhone(input.phone)

  const genericFail: SigninResult = { ok: false, status: 401, error: 'Invalid sign-in details. Please check and try again.', code: 'invalid_credentials' }
  if (!identifier || !canonical || !password) return genericFail

  const account = await getDb(env).prepare(
    'SELECT id, name, membership_id, password_hash FROM portal_accounts WHERE phone = @p LIMIT 1',
  ).get<{ id: number; name: string; membership_id: string; password_hash: string }>({ p: canonical })

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

  return { ok: true, accountId: account.id }
}
