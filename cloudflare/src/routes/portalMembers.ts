import { Hono, type Context } from 'hono'
import { getDb } from '../lib/db'
import { inlineIntegerIds } from '../lib/sqlBinding'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { actorSnapshot } from '../lib/actorSnapshot'
import { getActionTier, hasPermission, isAdminControlUser } from '../lib/permissions'
import { checkRateLimit } from '../lib/rateLimit'
import { hashPassword } from '../lib/passwordHash'
import { canonicalizePhone } from '../lib/phone'
import { customerIsProfileSql, isAnonymousCustomer } from '../lib/anonymousCustomer'
import { formatPhoneP8 } from '../lib/contactDuplicates'
import { normalizeMemberCode } from '../lib/memberCode'
import { verifyPortalLinkCheckCode } from '../lib/portalAccounts'
import { revokePortalSessionsStatement } from '../lib/portalSession'
import {
  MEMBER_CONFLICT_CUSTOMER_UNAVAILABLE_SQL,
  MEMBER_CONFLICT_PHONE_TAKEN_SQL,
  MEMBER_LINK_NOTE_MAX,
  MEMBER_REVERTIBLE_ACTIONS,
  MEMBER_UNLINK_REASONS,
  buildMemberLinkStatements,
  buildMemberRevertStatements,
  buildMemberUnlinkStatements,
  checkMemberLinkEvidence,
  classifyMemberSuggestions,
  memberChip,
  normalizeMemberEmail,
  type MemberConflict,
  type MemberLinkEvidence,
  type MemberLinkStatement,
  type MemberRevertTarget,
  type MemberSuggestionCandidate,
  type MemberUnlinkReason,
} from '../lib/portalMemberLinks'
import type { Env } from '../index'

// Contacts > Members (G38 Phase 1, design §4.7): staff see website members,
// link them to in-store customers, unlink, move, revert, suspend, and reset a
// legacy phone + password account. Mounted at /api/portal-members, which is
// outside /api/portal/, so lib/publicHostGate.ts answers 404 for every route
// here on the storefront host.
//
// Every route, read or write, needs the "Approve member links" permission
// (portal_member_links; admins hold it by default, it is grantable). A user
// with only Contacts access sees a member through the badge on the customer
// row (routes/contacts.ts computePortalAccountMap) and nothing here.

type Vars = { Bindings: Env; Variables: { user: SessionUser } }
type Ctx = Context<Vars>

export const PORTAL_MEMBER_LINKS_PERMISSION = 'portal_member_links'

const app = new Hono<Vars>()
app.use('*', requireAuth)
app.use('*', async (c, next) => {
  if (!hasPermission(c.get('user'), PORTAL_MEMBER_LINKS_PERMISSION)) {
    return c.json({ error: 'You need the "Approve member links" permission.', code: 'forbidden' }, 403)
  }
  await next()
})

// Owner ruling (G38 E1, final): a user holding "Approve member links" WITHOUT
// Contacts view never sees a customer's name, LC number or phone, nor whether
// a customer exists. One gate, used everywhere in this file:
//   - customer search, suggestions, filter=conflicts and every link-type
//     write (link, relink, move, a revert that relinks) need it outright, and
//     /link checks it before any customer lookup, so neither a 404 vs 409 nor
//     a holder can leak;
//   - every member object, list row, link request and history row a
//     links-only user receives goes through redactStaffMember (history: its
//     customerRef): customer -> null (customerVisible: false), legacy LC id ->
//     null, conflicts -> [] (both conflicts describe a customer);
//   - list search matches neither LC numbers (the member's legacy LC or the
//     linked customer's) for them.
// Unlink, suspend, reactivate and request reject stay links-only, redacted.
export function canViewCustomers(user: SessionUser): boolean {
  return getActionTier(user, 'contacts', 'view') !== 'none'
}
function contactsViewRequired(c: Ctx) {
  return c.json({ error: 'You need Contacts view access to see or link customers.', code: 'contacts_view_required' }, 403)
}
function viewerCanSeeCustomers(c: Ctx): boolean {
  return canViewCustomers(c.get('user'))
}

// A link carried forward by 0231 from the old sign-up, which attached the
// member to an EXISTING customer found by phone + LC number without any staff
// check (reason signup_claimed_customer), and still in place: staff review
// these (verifier E8). Uses idx_pmle_account.
const LEGACY_CLAIM_SQL = `EXISTS (SELECT 1 FROM portal_member_link_events lc
  WHERE lc.account_id = a.id AND lc.action = 'legacy_import' AND lc.reason_code = 'signup_claimed_customer'
    AND lc.link_version_after = a.link_version AND lc.to_customer_id = a.contact_id)`

const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 100
const HISTORY_LIMIT = 200
const CUSTOMER_SEARCH_LIMIT = 20
// Six-digit identity check: 10 tries per staff member per member per 15 min.
const LINK_CHECK_MAX_ATTEMPTS = 10
const LINK_CHECK_WINDOW_MS = 15 * 60 * 1000

type MemberRow = {
  id: number
  member_code: string | null
  membership_id: string | null
  name: string
  phone: string | null
  email: string | null
  status: string
  link_version: number
  contact_id: number | null
  created_contact_id: number | null
  created_at: string | null
  last_seen_at: string | null
  closed_at: string | null
  customer_name: string | null
  customer_membership_number: string | null
  customer_available: number | null
  request_id: number | null
  request_note: string | null
  request_created_at: string | null
  conflict_customer_unavailable: number | null
  conflict_phone_taken: number | null
  legacy_claim: number | null
  has_password: number | null
  has_telegram: number | null
  verified: number | null
}

function memberSelect(extraColumns = '', extraJoins = ''): string {
  return `
  SELECT ${extraColumns}a.id, a.member_code, a.membership_id, a.name, a.phone, a.email, a.status, a.link_version,
         a.contact_id, a.created_contact_id, a.created_at, a.last_seen_at, a.closed_at,
         c.name AS customer_name, c.membership_number AS customer_membership_number,
         CASE WHEN c.id IS NOT NULL AND ${customerIsProfileSql('c')} THEN 1 ELSE 0 END AS customer_available,
         r.id AS request_id, r.note AS request_note, r.created_at AS request_created_at,
         CASE WHEN ${MEMBER_CONFLICT_CUSTOMER_UNAVAILABLE_SQL} THEN 1 ELSE 0 END AS conflict_customer_unavailable,
         CASE WHEN ${MEMBER_CONFLICT_PHONE_TAKEN_SQL} THEN 1 ELSE 0 END AS conflict_phone_taken,
         CASE WHEN ${LEGACY_CLAIM_SQL} THEN 1 ELSE 0 END AS legacy_claim,
         CASE WHEN a.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password,
         EXISTS (SELECT 1 FROM portal_login_identities li WHERE li.account_id = a.id AND li.provider = 'telegram') AS has_telegram,
         EXISTS (SELECT 1 FROM portal_login_identities lv WHERE lv.account_id = a.id AND lv.verified_at IS NOT NULL) AS verified
  FROM portal_accounts a
  LEFT JOIN customers c ON c.id = a.contact_id
  LEFT JOIN portal_member_link_requests r ON r.account_id = a.id AND r.status = 'pending'${extraJoins}`
}
const MEMBER_SELECT = memberSelect()

export type StaffMemberView = {
  id: number
  memberCode: string | null
  legacyMembershipId: string | null
  name: string
  phone: string | null
  email: string | null
  status: string
  chip: ReturnType<typeof memberChip>
  methods: { password: boolean; telegram: boolean }
  linkVersion: number
  customer: { id: number; name: string | null; membershipNumber: string | null; available: boolean } | null
  createdFromSignup: boolean
  createdAt: string | null
  lastSeenAt: string | null
  closedAt: string | null
  pendingRequest: { id: number; note: string | null; createdAt: string | null } | null
  conflicts: MemberConflict[]
  // Linked by the old sign-up to a customer it did not create, never checked
  // by staff since (filter=legacy_claims).
  legacyClaim: boolean
  // false when the caller lacks Contacts view: customer, legacyMembershipId
  // and conflicts were withheld (they may exist), see redactStaffMember.
  customerVisible: boolean
}

export function staffMemberView(row: MemberRow): StaffMemberView {
  const conflicts: MemberConflict[] = []
  if (Number(row.conflict_customer_unavailable) === 1) conflicts.push('customer_unavailable')
  if (Number(row.conflict_phone_taken) === 1) conflicts.push('phone_customer_taken')
  return {
    id: Number(row.id),
    memberCode: row.member_code ?? null,
    legacyMembershipId: row.membership_id ?? null,
    name: String(row.name ?? ''),
    phone: row.phone ?? null,
    email: row.email ?? null,
    status: String(row.status),
    // G38 Telegram (0232): a proven sign-in method makes the member Verified.
    chip: memberChip({ status: row.status, contact_id: row.contact_id, verified: Number(row.verified) === 1 }),
    methods: { password: Number(row.has_password) === 1, telegram: Number(row.has_telegram) === 1 },
    linkVersion: Number(row.link_version),
    customer: row.contact_id == null ? null : {
      id: Number(row.contact_id),
      name: row.customer_name ?? null,
      membershipNumber: row.customer_membership_number ?? null,
      available: Number(row.customer_available) === 1,
    },
    createdFromSignup: row.created_contact_id != null && row.created_contact_id === row.contact_id,
    createdAt: row.created_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    closedAt: row.closed_at ?? null,
    pendingRequest: row.request_id == null ? null : { id: Number(row.request_id), note: row.request_note ?? null, createdAt: row.request_created_at ?? null },
    conflicts,
    legacyClaim: Number(row.legacy_claim) === 1,
    customerVisible: true,
  }
}

export function redactStaffMember(view: StaffMemberView, canSeeCustomers: boolean): StaffMemberView {
  if (canSeeCustomers) return view
  return { ...view, legacyMembershipId: null, customer: null, conflicts: [], customerVisible: false }
}

function memberViewFor(c: Ctx, row: MemberRow): StaffMemberView {
  return redactStaffMember(staffMemberView(row), viewerCanSeeCustomers(c))
}

// Every member object a route returns comes from here, redacted for the caller.
async function loadMember(c: Ctx, accountId: number): Promise<StaffMemberView | null> {
  const row = await getDb(c.env).prepare(`${MEMBER_SELECT} WHERE a.id = @id LIMIT 1`).get<MemberRow>({ id: accountId })
  return row ? memberViewFor(c, row) : null
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function nonNegativeInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

// A client-chosen idempotency key (one per dialog submit). Optional; bounded.
function clientRequestIdOf(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return /^[A-Za-z0-9_.:-]{8,64}$/.test(text) ? text : null
}

function noteOf(value: unknown): string | null {
  const text = String(value ?? '').trim().slice(0, MEMBER_LINK_NOTE_MAX)
  return text || null
}

function matchBasisOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const strength = raw.strength === 'strong' || raw.strength === 'possible' ? raw.strength : null
  const basis = Array.isArray(raw.basis)
    ? [...new Set(raw.basis.filter((b): b is string => b === 'phone' || b === 'name' || b === 'email'))]
    : []
  if (!strength && !basis.length) return null
  return JSON.stringify({ strength, basis })
}

function actorOf(user: SessionUser) {
  return { userId: user?.id ?? null, userName: actorSnapshot(user) }
}

async function readBody(c: Ctx): Promise<Record<string, unknown>> {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
}

async function replayedEvent(env: Env, accountId: number, clientRequestId: string | null): Promise<boolean> {
  if (!clientRequestId) return false
  const row = await getDb(env).prepare(`SELECT id FROM portal_member_link_events
    WHERE account_id = @accountId AND client_request_id = @crid LIMIT 1`).get<{ id: number }>({ accountId, crid: clientRequestId })
  return Boolean(row)
}

function conflict(c: Ctx, code: string, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, code, ...extra }, 409)
}

// ---------------------------------------------------------------------------
// Members list. Filters are the chips on the tab; `q` searches Member ID
// (W- code), legacy LC id, name, phone and email.
const LIST_FILTERS: Record<string, string> = {
  all: '1 = 1',
  unlinked: "a.contact_id IS NULL AND a.status <> 'closed'",
  linked: 'a.contact_id IS NOT NULL',
  requests: "EXISTS (SELECT 1 FROM portal_member_link_requests rq WHERE rq.account_id = a.id AND rq.status = 'pending')",
  conflicts: `(${MEMBER_CONFLICT_CUSTOMER_UNAVAILABLE_SQL} OR ${MEMBER_CONFLICT_PHONE_TAKEN_SQL})`,
  suspended: "a.status = 'suspended'",
  legacy_claims: LEGACY_CLAIM_SQL,
}

app.get('/', async (c) => {
  const filter = String(c.req.query('filter') || 'all')
  const where = LIST_FILTERS[filter]
  if (!where) return c.json({ error: 'Unknown filter.', code: 'invalid_filter' }, 400)
  const canSeeCustomers = viewerCanSeeCustomers(c)
  // Both conflicts describe a customer (removed, or holding this phone).
  if (filter === 'conflicts' && !canSeeCustomers) return contactsViewRequired(c)
  const limit = Math.min(LIST_MAX_LIMIT, positiveInt(c.req.query('limit')) ?? LIST_DEFAULT_LIMIT)
  const offset = nonNegativeInt(c.req.query('offset')) ?? 0
  const q = String(c.req.query('q') || '').trim().slice(0, 80)
  const params: Record<string, unknown> = { limit, offset }
  const clauses = [where]
  if (q) {
    const code = normalizeMemberCode(q)
    const phone = /^[\d\s()+.-]{6,}$/.test(q) ? canonicalizePhone(q) : null
    params.lower = q.toLowerCase()
    params.code = code
    params.phone = phone
    clauses.push(`(
      (@code IS NOT NULL AND a.member_code = @code)
      OR (@phone IS NOT NULL AND a.phone = @phone)
      OR instr(lower(a.name), @lower) > 0
      OR instr(lower(COALESCE(a.email, '')), @lower) > 0${canSeeCustomers ? `
      OR lower(trim(COALESCE(a.membership_id, ''))) = @lower
      OR EXISTS (SELECT 1 FROM customers cs WHERE cs.id = a.contact_id AND lower(trim(COALESCE(cs.membership_number, ''))) = @lower)` : ''}
    )`)
  }
  const whereSql = clauses.join(' AND ')
  const [countResult, pageResult] = await getDb(c.env).batch([
    { sql: `SELECT COUNT(*) AS n FROM portal_accounts a WHERE ${whereSql}`, params },
    { sql: `${MEMBER_SELECT} WHERE ${whereSql} ORDER BY a.id DESC LIMIT @limit OFFSET @offset`, params },
  ])
  const total = Number((countResult?.results?.[0] as { n?: number } | undefined)?.n ?? 0)
  const items = ((pageResult?.results ?? []) as MemberRow[]).map((row) => memberViewFor(c, row))
  return c.json({ items, total, limit, offset, filter })
})

// ---------------------------------------------------------------------------
// Link requests: the admin review section (owner answer 6).
app.get('/link-requests', async (c) => {
  const status = String(c.req.query('status') || 'pending')
  if (!['pending', 'approved', 'rejected', 'withdrawn'].includes(status)) {
    return c.json({ error: 'Unknown status.', code: 'invalid_filter' }, 400)
  }
  const rows = await getDb(c.env).prepare(`
    ${memberSelect(
      `q.id AS q_id, q.note AS q_note, q.status AS q_status, q.created_at AS q_created_at,
       q.decided_by_name AS q_decided_by_name, q.decided_at AS q_decided_at, q.decided_event_id AS q_decided_event_id,
       q.decided_note AS q_decided_note, `,
      ' JOIN portal_member_link_requests q ON q.account_id = a.id',
    )}
    WHERE q.status = @status
    ORDER BY q.id DESC
    LIMIT ${LIST_MAX_LIMIT}
  `).all<MemberRow & Record<string, unknown>>({ status })
  return c.json({
    requests: rows.map((row) => ({
      id: Number(row.q_id),
      status: String(row.q_status),
      note: (row.q_note as string | null) ?? null,
      createdAt: (row.q_created_at as string | null) ?? null,
      decidedByName: (row.q_decided_by_name as string | null) ?? null,
      decidedAt: (row.q_decided_at as string | null) ?? null,
      decidedEventId: row.q_decided_event_id == null ? null : Number(row.q_decided_event_id),
      decidedNote: (row.q_decided_note as string | null) ?? null,
      member: memberViewFor(c, row),
    })),
  })
})

app.post('/link-requests/:requestId/reject', async (c) => {
  const requestId = positiveInt(c.req.param('requestId'))
  if (!requestId) return c.json({ error: 'Request not found.', code: 'member_link_request_not_found' }, 404)
  const body = await readBody(c)
  const user = c.get('user')
  const actor = actorOf(user)
  const db = getDb(c.env)
  const request = await db.prepare('SELECT id, account_id, status FROM portal_member_link_requests WHERE id = @id LIMIT 1')
    .get<{ id: number; account_id: number; status: string }>({ id: requestId })
  if (!request) return c.json({ error: 'Request not found.', code: 'member_link_request_not_found' }, 404)
  const note = noteOf(body.note)
  const result = await db.prepare(`UPDATE portal_member_link_requests
    SET status = 'rejected', decided_by_id = @actorId, decided_by_name = @actorName, decided_note = @note, decided_at = CURRENT_TIMESTAMP
    WHERE id = @id AND status = 'pending'`).run({ id: requestId, actorId: actor.userId, actorName: actor.userName, note })
  if (Number(result.changes || 0) !== 1) return conflict(c, 'member_link_request_not_pending', 'This request was already decided or withdrawn.')
  await audit(c.env, actor.userId, actor.userName, 'member_link_request_reject', 'portal_member', request.account_id, { requestId, note })
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Customer search for the Link float (profiles only, with who holds each).
app.get('/customer-search', async (c) => {
  if (!canViewCustomers(c.get('user'))) return contactsViewRequired(c)
  const q = String(c.req.query('q') || '').trim().slice(0, 80)
  if (q.length < 2) return c.json({ customers: [] })
  const phone = /^[\d\s()+.-]{6,}$/.test(q) ? canonicalizePhone(q) : null
  const rows = await getDb(c.env).prepare(`
    SELECT c.id, c.name, c.phone, c.membership_number,
           pa.id AS member_id, pa.member_code AS member_code, pa.name AS member_name
    FROM customers c
    LEFT JOIN portal_accounts pa ON pa.contact_id = c.id
    WHERE ${customerIsProfileSql('c')}
      AND (
        (@phone IS NOT NULL AND c.phone_normalized = @phone)
        OR instr(lower(COALESCE(c.name, '')), @lower) > 0
        OR lower(trim(COALESCE(c.membership_number, ''))) = @lower
      )
    ORDER BY c.id
    LIMIT ${CUSTOMER_SEARCH_LIMIT}
  `).all<{ id: number; name: string | null; phone: string | null; membership_number: string | null; member_id: number | null; member_code: string | null; member_name: string | null }>({ phone, lower: q.toLowerCase() })
  return c.json({
    customers: rows.map((row) => ({
      id: Number(row.id),
      name: row.name ?? '',
      membershipNumber: row.membership_number ?? null,
      phone: row.phone ?? null,
      linkedMember: row.member_id == null ? null : { id: Number(row.member_id), memberCode: row.member_code ?? null, name: row.member_name ?? '' },
    })),
  })
})

// ---------------------------------------------------------------------------
// One member.
app.get('/:id', async (c) => {
  const accountId = positiveInt(c.req.param('id'))
  const member = accountId ? await loadMember(c, accountId) : null
  if (!member) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  return c.json({ member })
})

type EventRow = {
  id: number
  account_id: number
  action: string
  from_customer_id: number | null
  to_customer_id: number | null
  evidence: string | null
  reason_code: string | null
  note: string | null
  match_basis: string | null
  group_id: string | null
  reverts_event_id: number | null
  link_request_id: number | null
  link_version_after: number
  actor_name: string | null
  created_at: string
}

app.get('/:id/history', async (c) => {
  const accountId = positiveInt(c.req.param('id'))
  if (!accountId) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const db = getDb(c.env)
  const account = await db.prepare('SELECT id, link_version, status FROM portal_accounts WHERE id = @id LIMIT 1')
    .get<{ id: number; link_version: number; status: string }>({ id: accountId })
  if (!account) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const canSeeCustomers = viewerCanSeeCustomers(c)
  const rows = await db.prepare(`
    SELECT e.id, e.account_id, e.action, e.from_customer_id, e.to_customer_id, e.evidence, e.reason_code, e.note,
           e.match_basis, e.group_id, e.reverts_event_id, e.link_request_id, e.link_version_after, e.actor_name, e.created_at,
           fc.name AS from_name, fc.membership_number AS from_membership_number,
           tc.name AS to_name, tc.membership_number AS to_membership_number,
           EXISTS (SELECT 1 FROM portal_member_link_events rv WHERE rv.reverts_event_id = e.id) AS reverted
    FROM portal_member_link_events e
    LEFT JOIN customers fc ON fc.id = e.from_customer_id
    LEFT JOIN customers tc ON tc.id = e.to_customer_id
    WHERE e.account_id = @id
    ORDER BY e.id DESC
    LIMIT ${HISTORY_LIMIT}
  `).all<EventRow & { from_name: string | null; from_membership_number: string | null; to_name: string | null; to_membership_number: string | null; reverted: number }>({ id: accountId })
  const customerRef = (id: number | null, name: string | null, number: string | null) => (
    id == null || !canSeeCustomers ? null : { id: Number(id), name, membershipNumber: number })
  return c.json({
    linkVersion: Number(account.link_version),
    customerVisible: canSeeCustomers,
    events: rows.map((row) => ({
      id: Number(row.id),
      action: row.action,
      fromCustomer: customerRef(row.from_customer_id, row.from_name, row.from_membership_number),
      toCustomer: customerRef(row.to_customer_id, row.to_name, row.to_membership_number),
      evidence: row.evidence,
      reasonCode: row.reason_code,
      note: row.note,
      matchBasis: row.match_basis ? JSON.parse(row.match_basis) : null,
      groupId: row.group_id,
      revertsEventId: row.reverts_event_id == null ? null : Number(row.reverts_event_id),
      linkRequestId: row.link_request_id == null ? null : Number(row.link_request_id),
      linkVersionAfter: Number(row.link_version_after),
      actorName: row.actor_name,
      createdAt: row.created_at,
      // The server checks again on Revert; this only decides whether to show the icon.
      // A closed member is never reverted (E2), and a links-only user cannot
      // revert an event that would put the member back on a customer.
      revertible: MEMBER_REVERTIBLE_ACTIONS.includes(row.action)
        && account.status !== 'closed'
        && Number(row.reverted) === 0
        && Number(row.link_version_after) === Number(account.link_version)
        && (canSeeCustomers || row.from_customer_id == null),
    })),
  })
})

app.get('/:id/suggestions', async (c) => {
  if (!canViewCustomers(c.get('user'))) return contactsViewRequired(c)
  const accountId = positiveInt(c.req.param('id'))
  if (!accountId) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const db = getDb(c.env)
  const member = await db.prepare('SELECT id, name, phone, email FROM portal_accounts WHERE id = @id LIMIT 1')
    .get<{ id: number; name: string; phone: string | null; email: string | null }>({ id: accountId })
  if (!member) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const phone = canonicalizePhone(member.phone)
  const email = normalizeMemberEmail(member.email)
  if (!phone && !email) return c.json({ suggestions: [] })
  // Primary phones by the indexed canonical key; Contact Option phones (JSON in
  // `address`) and email by one bounded scan, confirmed in classifyMemberSuggestions.
  // Option phones are stored display-formatted ("097 555 000"), so the scan
  // looks for both the bare digits and that spaced form, without the leading 0
  // so a +855 entry matches too.
  const columns = 'id, name, phone, address, email, membership_number, is_anonymous'
  const likeDigits = phone ? `%${phone.slice(1)}%` : ''
  const likeFormatted = phone ? `%${formatPhoneP8(phone).slice(1)}%` : ''
  const [byPrimary, byScan] = await db.batch([
    { sql: `SELECT ${columns} FROM customers WHERE @phone IS NOT NULL AND phone_normalized = @phone LIMIT 25`, params: { phone } },
    {
      sql: `SELECT ${columns} FROM customers
        WHERE (@likeDigits <> '' AND (address LIKE @likeDigits OR address LIKE @likeFormatted))
           OR (@email <> '' AND lower(trim(COALESCE(email, ''))) = @email)
        LIMIT 50`,
      params: { likeDigits, likeFormatted, email },
    },
  ])
  const candidates = [
    ...((byPrimary?.results ?? []) as MemberSuggestionCandidate[]),
    ...((byScan?.results ?? []) as MemberSuggestionCandidate[]),
  ]
  const ids = [...new Set(candidates.map((row) => Number(row.id)))].slice(0, 75)
  const linked = new Map<number, number>()
  if (ids.length) {
    // Server-produced customer ids (rows of the two queries above, at most 75),
    // inlined as integers so no bound-parameter budget is spent.
    const holders = await db.prepare(`SELECT id, contact_id FROM portal_accounts WHERE contact_id IN (${inlineIntegerIds(ids)})`)
      .all<{ id: number; contact_id: number }>([])
    for (const holder of holders) linked.set(Number(holder.contact_id), Number(holder.id))
  }
  return c.json({ suggestions: classifyMemberSuggestions(member, candidates, linked) })
})

// ---------------------------------------------------------------------------
// Writes.
type AccountState = { id: number; status: string; link_version: number; contact_id: number | null; phone: string | null }

async function loadAccountState(env: Env, accountId: number): Promise<AccountState | null> {
  return (await getDb(env).prepare('SELECT id, status, link_version, contact_id, phone FROM portal_accounts WHERE id = @id LIMIT 1')
    .get<AccountState>({ id: accountId })) ?? null
}

async function staleResponse(c: Ctx, accountId: number) {
  return conflict(c, 'member_link_stale', 'This member changed since you opened it. Refresh and try again.', { member: await loadMember(c, accountId) })
}

function isUniqueContactViolation(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '')
  return /UNIQUE constraint failed/i.test(message) && /contact_id/i.test(message)
}

async function runBatch(env: Env, statements: MemberLinkStatement[]): Promise<unknown | null> {
  try {
    await getDb(env).batch(statements)
    return null
  } catch (error) {
    return error ?? new Error('batch_failed')
  }
}

app.post('/:id/link', async (c) => {
  // Before ANY lookup: a links-only user must not learn whether a customer id
  // exists, who holds it, or its name and LC (E1.8, E1.9).
  if (!viewerCanSeeCustomers(c)) return contactsViewRequired(c)
  const accountId = positiveInt(c.req.param('id'))
  if (!accountId) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const body = await readBody(c)
  const user = c.get('user')
  const env = c.env
  const db = getDb(env)
  const clientRequestId = clientRequestIdOf(body.clientRequestId)

  const account = await loadAccountState(env, accountId)
  if (!account) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  // A double-submitted dialog: the first one already landed.
  if (await replayedEvent(env, accountId, clientRequestId)) return c.json({ ok: true, replayed: true, member: await loadMember(c, accountId) })
  if (account.status === 'closed') return conflict(c, 'member_closed', 'This member closed their account.')
  const expectedLinkVersion = nonNegativeInt(body.expectedLinkVersion)
  if (expectedLinkVersion == null) return c.json({ error: 'expectedLinkVersion is required.', code: 'member_link_version_required' }, 400)
  if (Number(account.link_version) !== expectedLinkVersion) return staleResponse(c, accountId)

  const customerId = positiveInt(body.customerId)
  if (!customerId) return c.json({ error: 'Choose a customer.', code: 'customer_required' }, 400)
  const customer = await db.prepare('SELECT id, is_anonymous FROM customers WHERE id = @id LIMIT 1').get<{ id: number; is_anonymous: number | null }>({ id: customerId })
  if (!customer) return c.json({ error: 'Customer not found.', code: 'customer_not_found' }, 404)
  if (isAnonymousCustomer(customer)) return conflict(c, 'member_link_customer_unavailable', 'This is the anonymous walk-in record; it cannot be linked.')
  if (account.contact_id === customerId) return conflict(c, 'member_link_unchanged', 'This member is already linked to that customer.')

  const holder = await db.prepare('SELECT id, link_version, member_code, name FROM portal_accounts WHERE contact_id = @cid AND id <> @aid LIMIT 1')
    .get<{ id: number; link_version: number; member_code: string | null; name: string }>({ cid: customerId, aid: accountId })
  let move: { holderAccountId: number; holderLinkVersion: number } | null = null
  if (holder) {
    const holderView = { id: Number(holder.id), memberCode: holder.member_code ?? null, name: holder.name, linkVersion: Number(holder.link_version) }
    if (body.move !== true) {
      return conflict(c, 'member_link_customer_taken', 'This customer is already linked to another member. Move the link to continue.', { holder: holderView })
    }
    const expectedHolder = body.expectedHolderLinkVersion == null ? Number(holder.link_version) : nonNegativeInt(body.expectedHolderLinkVersion)
    if (expectedHolder !== Number(holder.link_version)) return conflict(c, 'member_link_stale', 'The other member changed since you opened this. Refresh and try again.', { holder: holderView })
    move = { holderAccountId: Number(holder.id), holderLinkVersion: Number(holder.link_version) }
  }

  let checkCodeValid: boolean | null = null
  if (body.evidence === 'called_number_on_file') {
    const rate = await checkRateLimit(env, 'portal-member:link-check', `${user?.id ?? 0}:${accountId}`, LINK_CHECK_MAX_ATTEMPTS, LINK_CHECK_WINDOW_MS)
    if (!rate.allowed) {
      c.header('Retry-After', String(rate.retryAfterSeconds))
      return c.json({ error: 'Too many code attempts. Try again later.', code: 'rate_limited' }, 429)
    }
    checkCodeValid = await verifyPortalLinkCheckCode(env, accountId, expectedLinkVersion, body.checkCode)
  }
  const evidence = checkMemberLinkEvidence({ evidence: body.evidence, note: body.note, isAdmin: isAdminControlUser(user), checkCodeValid })
  if (!evidence.ok) return c.json({ error: evidence.error, code: evidence.code }, evidence.status)

  const linkRequestId = body.linkRequestId == null ? null : positiveInt(body.linkRequestId)
  if (body.linkRequestId != null && !linkRequestId) return conflict(c, 'member_link_request_not_pending', 'This request was already decided or withdrawn.')
  const actor = actorOf(user)
  const statements = buildMemberLinkStatements({
    accountId,
    expectedLinkVersion,
    fromCustomerId: account.contact_id,
    toCustomerId: customerId,
    move,
    evidence: evidence.evidence,
    note: evidence.note,
    matchBasis: matchBasisOf(body.matchBasis),
    clientRequestId,
    linkRequestId,
    groupId: move ? crypto.randomUUID() : null,
    actor,
  })
  const failure = await runBatch(env, statements)
  if (failure) {
    if (await replayedEvent(env, accountId, clientRequestId)) return c.json({ ok: true, replayed: true, member: await loadMember(c, accountId) })
    const now = await loadAccountState(env, accountId)
    if (!now || Number(now.link_version) !== expectedLinkVersion || now.contact_id !== account.contact_id) return staleResponse(c, accountId)
    if (isUniqueContactViolation(failure)) return conflict(c, 'member_link_customer_taken', 'This customer was just linked to another member. Refresh and try again.')
    if (move) {
      const holderNow = await loadAccountState(env, move.holderAccountId)
      if (!holderNow || Number(holderNow.link_version) !== move.holderLinkVersion || holderNow.contact_id !== customerId) return staleResponse(c, accountId)
    }
    const customerNow = await db.prepare(`SELECT id FROM customers WHERE id = @id AND ${customerIsProfileSql()} LIMIT 1`).get<{ id: number }>({ id: customerId })
    if (!customerNow) return conflict(c, 'member_link_customer_unavailable', 'This customer is no longer available.')
    if (linkRequestId != null) {
      const request = await db.prepare("SELECT id FROM portal_member_link_requests WHERE id = @id AND account_id = @aid AND status = 'pending' LIMIT 1").get<{ id: number }>({ id: linkRequestId, aid: accountId })
      if (!request) return conflict(c, 'member_link_request_not_pending', 'This request was already decided or withdrawn.')
    }
    throw failure
  }
  const action = move ? 'member_move' : account.contact_id == null ? 'member_link' : 'member_relink'
  await audit(env, actor.userId, actor.userName, action, 'portal_member', accountId, {
    customerId,
    fromCustomerId: account.contact_id,
    evidence: evidence.evidence,
    movedFromAccountId: move?.holderAccountId ?? null,
    linkRequestId,
  })
  return c.json({ ok: true, member: await loadMember(c, accountId) })
})

app.post('/:id/unlink', async (c) => {
  const accountId = positiveInt(c.req.param('id'))
  if (!accountId) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const body = await readBody(c)
  const env = c.env
  const clientRequestId = clientRequestIdOf(body.clientRequestId)
  const account = await loadAccountState(env, accountId)
  if (!account) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  if (await replayedEvent(env, accountId, clientRequestId)) return c.json({ ok: true, replayed: true, member: await loadMember(c, accountId) })
  const expectedLinkVersion = nonNegativeInt(body.expectedLinkVersion)
  if (expectedLinkVersion == null) return c.json({ error: 'expectedLinkVersion is required.', code: 'member_link_version_required' }, 400)
  const reasonCode = String(body.reasonCode ?? '') as MemberUnlinkReason
  if (!MEMBER_UNLINK_REASONS.includes(reasonCode)) return c.json({ error: 'Choose a reason.', code: 'member_unlink_reason_required' }, 400)
  const note = noteOf(body.note)
  if (reasonCode === 'other' && !note) return c.json({ error: 'Add a note for "Other".', code: 'member_link_note_required' }, 400)
  if (Number(account.link_version) !== expectedLinkVersion) return staleResponse(c, accountId)
  if (account.contact_id == null) return conflict(c, 'member_not_linked', 'This member is not linked.')

  const actor = actorOf(c.get('user'))
  const failure = await runBatch(env, buildMemberUnlinkStatements({
    accountId, expectedLinkVersion, fromCustomerId: account.contact_id, reasonCode, note, clientRequestId, actor,
  }))
  if (failure) {
    if (await replayedEvent(env, accountId, clientRequestId)) return c.json({ ok: true, replayed: true, member: await loadMember(c, accountId) })
    const now = await loadAccountState(env, accountId)
    if (!now || Number(now.link_version) !== expectedLinkVersion || now.contact_id !== account.contact_id) return staleResponse(c, accountId)
    throw failure
  }
  await audit(env, actor.userId, actor.userName, 'member_unlink', 'portal_member', accountId, { fromCustomerId: account.contact_id, reasonCode })
  return c.json({ ok: true, member: await loadMember(c, accountId) })
})

app.post('/:id/revert', async (c) => {
  const accountId = positiveInt(c.req.param('id'))
  if (!accountId) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const body = await readBody(c)
  const env = c.env
  const db = getDb(env)
  const clientRequestId = clientRequestIdOf(body.clientRequestId)
  const eventId = positiveInt(body.eventId)
  if (!eventId) return c.json({ error: 'Choose an event to revert.', code: 'member_link_event_not_found' }, 404)
  const event = await db.prepare('SELECT * FROM portal_member_link_events WHERE id = @id AND account_id = @aid LIMIT 1').get<EventRow>({ id: eventId, aid: accountId })
  if (!event) return c.json({ error: 'Event not found.', code: 'member_link_event_not_found' }, 404)
  if (await replayedEvent(env, accountId, clientRequestId)) return c.json({ ok: true, replayed: true, member: await loadMember(c, accountId) })
  // As /link: a closed member is never relinked or otherwise changed (E2).
  const urlAccount = await loadAccountState(env, accountId)
  if (!urlAccount) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  if (urlAccount.status === 'closed') return conflict(c, 'member_closed', 'This member closed their account.')
  if (!MEMBER_REVERTIBLE_ACTIONS.includes(event.action)) return conflict(c, 'member_link_not_revertible', 'This entry cannot be reverted.')

  // A Move is two events under one group id; revert them together.
  const events = event.group_id
    ? await db.prepare('SELECT * FROM portal_member_link_events WHERE group_id = @g ORDER BY id').all<EventRow>({ g: event.group_id })
    : [event]
  if (events.some((row) => !MEMBER_REVERTIBLE_ACTIONS.includes(row.action))) return conflict(c, 'member_link_not_revertible', 'This entry cannot be reverted.')
  const targets: MemberRevertTarget[] = events.map((row) => ({
    accountId: Number(row.account_id),
    eventId: Number(row.id),
    linkVersionAfter: Number(row.link_version_after),
    currentCustomerId: row.to_customer_id == null ? null : Number(row.to_customer_id),
    restoreCustomerId: row.from_customer_id == null ? null : Number(row.from_customer_id),
  }))
  // Event ids read from portal_member_link_events above (one, or a Move's two).
  const revertedSql = `SELECT 1 AS hit FROM portal_member_link_events WHERE reverts_event_id IN (${inlineIntegerIds(targets.map((target) => target.eventId))}) LIMIT 1`
  const reverted = await db.prepare(revertedSql).get<{ hit: number }>([])
  if (reverted) return conflict(c, 'member_link_already_reverted', 'This entry was already reverted.')
  for (const target of targets) {
    const state = await loadAccountState(env, target.accountId)
    if (state?.status === 'closed') return conflict(c, 'member_closed', 'A member in this change closed their account.')
    if (!state || Number(state.link_version) !== target.linkVersionAfter || state.contact_id !== target.currentCustomerId) return staleResponse(c, accountId)
  }

  // E3: a revert that puts a member back on a customer re-creates a link and
  // needs the same evidence as /link. The six-digit code proves ONE member,
  // so it is accepted only when exactly one member is relinked; it is checked
  // against that member's current link version and rate-limited as on /link.
  const user = c.get('user')
  const relinked = targets.filter((target) => target.restoreCustomerId != null)
  // Relinking is a link: the linker must see who they link to (E1).
  if (relinked.length && !viewerCanSeeCustomers(c)) return contactsViewRequired(c)
  let evidence: { evidence: MemberLinkEvidence; note: string | null } | null = null
  if (relinked.length) {
    let checkCodeValid: boolean | null = null
    if (body.evidence === 'called_number_on_file') {
      if (relinked.length !== 1) {
        return c.json({ error: 'This revert reconnects more than one member. Confirm in person, or as an owner override.', code: 'member_revert_check_one_member' }, 400)
      }
      const subject = relinked[0]
      const rate = await checkRateLimit(env, 'portal-member:link-check', `${user?.id ?? 0}:${subject.accountId}`, LINK_CHECK_MAX_ATTEMPTS, LINK_CHECK_WINDOW_MS)
      if (!rate.allowed) {
        c.header('Retry-After', String(rate.retryAfterSeconds))
        return c.json({ error: 'Too many code attempts. Try again later.', code: 'rate_limited' }, 429)
      }
      checkCodeValid = await verifyPortalLinkCheckCode(env, subject.accountId, subject.linkVersionAfter, body.checkCode)
    }
    const checked = checkMemberLinkEvidence({ evidence: body.evidence, note: body.note, isAdmin: isAdminControlUser(user), checkCodeValid })
    if (!checked.ok) return c.json({ error: checked.error, code: checked.code }, checked.status)
    evidence = { evidence: checked.evidence, note: checked.note }
  }

  const actor = actorOf(user)
  const failure = await runBatch(env, buildMemberRevertStatements({
    targets,
    groupId: targets.length > 1 ? crypto.randomUUID() : null,
    note: evidence ? evidence.note : noteOf(body.note),
    clientRequestId,
    actor,
    evidence: evidence?.evidence ?? null,
  }))
  if (failure) {
    if (await replayedEvent(env, accountId, clientRequestId)) return c.json({ ok: true, replayed: true, member: await loadMember(c, accountId) })
    const again = await db.prepare(revertedSql).get<{ hit: number }>([])
    if (again) return conflict(c, 'member_link_already_reverted', 'This entry was already reverted.')
    for (const target of targets) {
      if ((await loadAccountState(env, target.accountId))?.status === 'closed') return conflict(c, 'member_closed', 'A member in this change closed their account.')
    }
    for (const target of targets) {
      if (target.restoreCustomerId == null) continue
      const customerNow = await db.prepare(`SELECT id FROM customers WHERE id = @id AND ${customerIsProfileSql()} LIMIT 1`).get<{ id: number }>({ id: target.restoreCustomerId })
      if (!customerNow) return conflict(c, 'member_link_customer_unavailable', 'The earlier customer is no longer available.')
    }
    // A version moved, or the earlier customer is now linked to someone else.
    return staleResponse(c, accountId)
  }
  await audit(env, actor.userId, actor.userName, 'member_revert', 'portal_member', accountId, {
    eventIds: targets.map((target) => target.eventId),
    accountIds: targets.map((target) => target.accountId),
    evidence: evidence?.evidence ?? null,
  })
  return c.json({ ok: true, member: await loadMember(c, accountId) })
})

// Suspend: the member cannot sign in and loses every session (design S6).
async function setStatus(c: Ctx, from: 'active' | 'suspended', to: 'active' | 'suspended', action: string) {
  const accountId = positiveInt(c.req.param('id'))
  if (!accountId) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const env = c.env
  const account = await loadAccountState(env, accountId)
  if (!account) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  if (account.status !== from) return conflict(c, 'member_status_conflict', `This member is not ${from}.`, { member: await loadMember(c, accountId) })
  const body = await readBody(c)
  const statements: MemberLinkStatement[] = [
    {
      sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM portal_accounts WHERE id = @id AND status = @from) THEN 1 ELSE json_extract('member_status_conflict', '$') END AS member_status_guard",
      params: { id: accountId, from },
    },
    { sql: 'UPDATE portal_accounts SET status = @to, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND status = @from', params: { id: accountId, from, to } },
  ]
  if (to === 'suspended') {
    const revoke = revokePortalSessionsStatement([accountId])
    if (revoke) statements.push(revoke)
  }
  if (await runBatch(env, statements)) return conflict(c, 'member_status_conflict', `This member is not ${from}.`, { member: await loadMember(c, accountId) })
  const actor = actorOf(c.get('user'))
  await audit(env, actor.userId, actor.userName, action, 'portal_member', accountId, { note: noteOf(body.note) })
  return c.json({ ok: true, member: await loadMember(c, accountId) })
}

app.post('/:id/suspend', (c) => setStatus(c, 'active', 'suspended', 'member_suspend'))
app.post('/:id/reactivate', (c) => setStatus(c, 'suspended', 'active', 'member_reactivate'))

// Staff password reset for a legacy phone + password account (re-homed from
// the old POST /api/customers/:id/portal-reset, which had no caller and no
// identity check). The member cannot sign in to show a code, so
// called_number_on_file here means staff called the phone on the account (or
// on the linked customer) and spoke to the member. The member cannot prove
// who they are from a signed-in account on ANY path here, so every staff
// reset -- in_person included -- carries the same trust: owner default
// (G38 E6) is ADMIN-ONLY with a note saying how the member was identified;
// the note goes to the audit log. Returns the temporary password once.
app.post('/:id/reset-password', async (c) => {
  const accountId = positiveInt(c.req.param('id'))
  if (!accountId) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  const body = await readBody(c)
  const user = c.get('user')
  const env = c.env
  const isAdmin = isAdminControlUser(user)
  if (!isAdmin) return c.json({ error: 'Only an administrator can reset a member\'s password.', code: 'member_reset_admin_only' }, 403)
  const account = await loadAccountState(env, accountId)
  if (!account) return c.json({ error: 'Member not found.', code: 'member_not_found' }, 404)
  if (account.status !== 'active' || !account.phone) {
    return conflict(c, 'member_reset_unavailable', 'Only an active phone + password account can be reset here.')
  }
  if (!noteOf(body.note)) return c.json({ error: 'Add a note: how you identified the member (who, where, which number).', code: 'member_link_note_required' }, 400)
  // No code exists for a member who cannot sign in, so identity is taken on
  // the admin's word, recorded in the note, rather than verified.
  const evidence = checkMemberLinkEvidence({ evidence: body.evidence, note: body.note, isAdmin, checkCodeValid: true })
  if (!evidence.ok) return c.json({ error: evidence.error, code: evidence.code }, evidence.status)
  // A readable-but-random temporary password (no ambiguous characters).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  const tempPassword = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
  const passwordHash = await hashPassword(tempPassword, env)
  const statements: MemberLinkStatement[] = [
    {
      sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM portal_accounts WHERE id = @id AND status = 'active' AND phone IS NOT NULL) THEN 1 ELSE json_extract('member_reset_unavailable', '$') END AS member_reset_guard",
      params: { id: accountId },
    },
    { sql: 'UPDATE portal_accounts SET password_hash = @hash, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { hash: passwordHash, id: accountId } },
  ]
  const revoke = revokePortalSessionsStatement([accountId])
  if (revoke) statements.push(revoke)
  if (await runBatch(env, statements)) return conflict(c, 'member_reset_unavailable', 'Only an active phone + password account can be reset here.')
  const actor = actorOf(user)
  await audit(env, actor.userId, actor.userName, 'portal_reset', 'portal_member', accountId, { evidence: evidence.evidence, note: evidence.note })
  return c.json({ ok: true, temporaryPassword: tempPassword })
})

export default app
