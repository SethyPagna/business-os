import { Hono, type Context, type Next } from 'hono'
import { getDb } from '../lib/db'
import { chunkForBinding } from '../lib/sqlBinding'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { applyRenameCarry } from '../lib/renameCascade'
import { getPermissionTier, hasPermission, isAdminControlUser } from '../lib/permissions'
import { broadcast, type BroadcastChannel } from '../durable-objects/broadcastHub'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { loadSettingsMap, buildPortalConfig, summarizePoints, type SubmissionRow } from './portal'
import {
  findContactDuplicates,
  findDuplicateContactClusters,
  dismissDuplicateCluster,
  collectContactPhones,
  formatPhoneP8,
  type ContactDuplicateMatch,
  type ContactDuplicateTable,
} from '../lib/contactDuplicates'
import type { ContactOptionMode } from '../lib/contactOptions'
import { canonicalizePhone } from '../lib/phone'
import { revokePortalSessionsForAccount } from '../lib/portalSession'
import bcrypt from 'bcryptjs'
import { buildContactMatchClause } from '../lib/contactSearch'
import { createBulkDeleteJob, getBulkDeleteJob, reapStalledBulkDeleteJobs, type BulkDeleteEntityType } from '../lib/bulkDeleteEngine'
import type { Env } from '../index'

// Customers, suppliers, and delivery contacts, ported from
// backend/src/routes/contacts.ts. This never had a real route on Cloudflare
// at all -- routes/compat.ts only returned an empty list for GET, so every
// create/update/delete on these three admin pages 404ed or silently no-opped.
//
// Multi-option contacts (up to CONTACT_OPTION_LIMIT phone/address/name
// entries per contact -- see lib/contactOptions.ts) ARE supported here,
// despite an earlier version of this comment saying otherwise: the
// frontend's Customer/Supplier/Delivery "Contact Options" UI
// (contactOptionUtils.ts + each tab's form) already serializes them into
// the plain `address` TEXT column below via serializeContactOptions(), so
// no extra contact_label_*/contact_name_* D1 columns were ever needed for
// this -- that's a different, still-open gap (see MIGRATION.md): the
// Docker backend's per-FIELD CSV merge/conflict-decision system (choosing
// which specific field wins when an imported row's data differs from an
// existing contact's, row by row) isn't ported; classifyContacts()/
// runImportApply() in importEngine.ts do a full-row overwrite on match
// instead. Everyday create/edit/delete -- the actual reported failure --
// is fully real and tested against the shapes the frontend sends.

type ContactTable = 'customers' | 'suppliers' | 'delivery_contacts'

type ContactConfig = {
  table: ContactTable
  path: string
  entity: string
  columns: string[]
  channel: BroadcastChannel
  // Which Contact Option value field this table's `address` column holds
  // (see contactOptions.ts) -- delivery contacts describe a zone/`area`
  // instead of a street address. Duplicate detection needs this to parse
  // secondary phone numbers out of that JSON correctly.
  optionMode: ContactOptionMode
}

const CUSTOMERS: ContactConfig = {
  table: 'customers',
  path: '/customers',
  entity: 'customer',
  // `gender` -- new column (migration 0017), CustomerFormModal.tsx's
  // dropdown. `created_at` -- NOT surfaced in the manual add/edit form
  // (that would let an ordinary edit silently backdate a customer's join
  // date), but does need to be in this allowlist for the two callers that
  // legitimately set it on purpose: undo/redo restoring a deleted
  // customer (CustomersTab.tsx's buildCustomerPayload, so an undone
  // delete keeps its original join date instead of resetting to "now")
  // and CSV import (classifyContacts, for the "incorporate previous
  // customer dates" ask). pickColumns only ever picks a key the caller
  // actually sent, so an ordinary edit payload (no created_at field) never
  // touches it -- this only widens what's *possible* to send, not what
  // the everyday form sends.
  // `company` deliberately absent (chat, Aug 25 2026): CustomerFormModal.tsx
  // never rendered an input for it, so a customer's company could never
  // actually be set through the form UI -- a real dead field this session
  // removed end to end (form/list/import/export/API allowlist). Suppliers
  // keep `company` (below) -- a business identity genuinely applies there
  // and that form does expose it.
  columns: ['name', 'phone', 'email', 'address', 'notes', 'membership_number', 'gender', 'created_at'],
  channel: 'customers',
  optionMode: 'address',
}

const SUPPLIERS: ContactConfig = {
  table: 'suppliers',
  path: '/suppliers',
  entity: 'supplier',
  // `gender` -- migration 0022, parity with customers (see that
  // migration's comment); optional, single value, same
  // Male/Female/Other/Unspecified set.
  columns: ['name', 'phone', 'email', 'address', 'company', 'contact_person', 'notes', 'gender'],
  channel: 'suppliers',
  optionMode: 'address',
}

const DELIVERY_CONTACTS: ContactConfig = {
  table: 'delivery_contacts',
  path: '/delivery-contacts',
  entity: 'delivery_contact',
  // `gender` -- migration 0022, parity with customers/suppliers.
  columns: ['name', 'phone', 'area', 'address', 'notes', 'gender'],
  channel: 'deliveryContacts',
  optionMode: 'area',
}

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
// Scoped to the three path prefixes this router actually owns, NOT '*'.
// See index.ts: this router is mounted at the bare `/api` prefix, so a
// `app.use('*', ...)` here registers as `/api/*` middleware and runs for
// every OTHER `/api/...` route mounted after it too. Confirmed live
// against a local Worker: that leak made `/api/organizations/search` and
// `/api/organizations/bootstrap` -- both deliberately public, both called
// by the LOGIN screen before anyone has a session -- return
// 401 invalid_session, so the organization picker could never load and
// login was impossible on a fresh browser. routes/compat.ts already had
// exactly this fix (see its own NOTE); it was never applied here.
// Kept as a shared list so the permission gate below can't drift out of
// sync with the auth gate above it.
// Each prefix is registered as an exact path AND a subtree wildcard. Hono
// does not treat a bare trailing `*` (`/customers*`) as a wildcard --
// verified live: that form matched nothing and left these routes fully
// UNAUTHENTICATED, worse than the leak it was meant to fix.
const CONTACT_PATH_PREFIXES = ['/customers', '/suppliers', '/delivery-contacts'] as const
for (const prefix of CONTACT_PATH_PREFIXES) {
  app.use(prefix, requireAuth)
  app.use(`${prefix}/*`, requireAuth)
}
// Legacy gates every customers/suppliers/delivery-contacts endpoint (reads
// and writes alike) behind requirePermission('contacts') -- this Worker
// only checked requireAuth (any logged-in user), a real gap.
//
// Gate+applier wiring, contacts (picked up from Part 154's flagged next
// step): this router-wide gate used the strict `hasPermission()` (=== true
// only), same bug Part 153/154 already found and fixed on
// inventory.ts/returns.ts -- it 403'd a Review Required-tier user out of
// every contacts route, including plain reads, directly contradicting the
// spec's own "Review Required can view + add directly" line for Contacts.
// Switched to `getPermissionTier(...) !== 'none'`, same pattern as those
// two files and products.ts.
// Same path-scoping as the requireAuth registration above, and for the same
// reason -- a `'*'` here would 403 every unrelated `/api/...` route mounted
// after this router for anyone without the contacts permission.
const requireContactsAccess = async (c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, next: Next) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'contacts') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
}
for (const prefix of CONTACT_PATH_PREFIXES) {
  app.use(prefix, requireContactsAccess)
  app.use(`${prefix}/*`, requireContactsAccess)
}

// Suppliers are admin territory (Part 383 R2): the section carries contact
// details and connects to purchase-cost data, so on top of the general
// contacts gate above, every /suppliers endpoint needs the grantable
// 'contacts_suppliers' permission (admin-control users always pass -- and
// hasPermission() honors the 'all' grant, so full-access roles keep
// working). The ONE carve-out is the name-only list,
// GET /suppliers?fields=names (id + name, nothing else -- see the list
// handler): operational flows every employee legitimately uses -- the
// supplier-return picker, the product form's supplier autocomplete --
// need to pick a supplier BY NAME, and a bare name is exactly what stays
// visible to everyone on batches anyway.
const requireSupplierAccess = async (c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, next: Next) => {
  const user = c.get('user')
  if (isAdminControlUser(user) || hasPermission(user, 'contacts_suppliers')) return next()
  if (c.req.method === 'GET' && /\/suppliers\/?$/.test(c.req.path) && String(c.req.query('fields') || '') === 'names') return next()
  return c.json({ error: 'The suppliers section is admin-managed. Ask an admin for the suppliers permission if you need it.' }, 403)
}
app.use('/suppliers', requireSupplierAccess)
app.use('/suppliers/*', requireSupplierAccess)

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function pickColumns(body: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const key of columns) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const value = body[key]
      payload[key] = value === '' ? null : value
    }
  }
  return payload
}

async function generateMembershipNumber(env: Env): Promise<string> {
  const db = getDb(env)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${attempt.toString(36)}`.toUpperCase()
    const candidate = `LCMN-${entropy.slice(-8)}`
    const existing = await db.prepare('SELECT id FROM customers WHERE lower(trim(membership_number)) = lower(trim(@candidate)) LIMIT 1').get({ candidate })
    if (!existing) return candidate
  }
  throw new Error('Could not generate a unique membership number')
}

// Shared error shape for both duplicate severities the create/update
// routes actively block on. `duplicate` carries the conflicting row so
// the frontend can offer "open existing contact" instead of just showing
// text.
// Maps a ContactConfig's table name to the matching bulkDeleteEngine.ts
// entity-type key -- kept as a tiny lookup rather than storing the
// BulkDeleteEntityType directly on ContactConfig, since that type lives in
// a different module this file already imports narrowly (just the three
// functions it needs) rather than pulling the whole engine's type surface
// into ContactConfig's own shape.
function contactBulkDeleteEntityType(config: ContactConfig): BulkDeleteEntityType {
  return config.table
}

function duplicateErrorResponse(entityLabel: string, match: ContactDuplicateMatch): { body: Record<string, unknown>; status: number } {
  if (match.severity === 'phone_conflict') {
    return {
      status: 409,
      body: {
        error: `Phone "${match.matchedPhone}" is already registered to "${match.name}". Each phone number can only belong to one ${entityLabel}.`,
        code: 'phone_conflict',
        duplicate: match,
      },
    }
  }
  return {
    status: 409,
    body: {
      error: `A ${entityLabel} named "${match.name}" already uses this phone number. Save again to confirm this is a different contact.`,
      code: 'possible_duplicate',
      duplicate: match,
    },
  }
}

// Runs the duplicate check for a record about to be created/updated and
// returns a ready-to-send error response if it should be blocked, or null
// if it's clear to proceed. `confirmDuplicate: true` in the request body
// (set by the frontend after the person acknowledges the flag -- see
// ContactFormModal's duplicate banner) lets an exact_match through; a
// phone_conflict can never be overridden this way since that would let
// two different names claim the same phone, exactly what this feature
// exists to prevent.
async function checkContactDuplicateBlock(
  env: Env,
  config: ContactConfig,
  subject: { id?: number | string | null; name: string; phone: unknown; address: unknown },
  confirmDuplicate: boolean,
): Promise<{ body: Record<string, unknown>; status: number } | null> {
  const db = getDb(env)
  const phones = collectContactPhones({ phone: subject.phone, address: subject.address }, config.optionMode)
  const matches = await findContactDuplicates(db, config.table, { id: subject.id, name: subject.name, phones }, config.optionMode)
  const phoneConflict = matches.find((m) => m.severity === 'phone_conflict')
  if (phoneConflict) return duplicateErrorResponse(config.entity, phoneConflict)
  const exactMatch = matches.find((m) => m.severity === 'exact_match')
  if (exactMatch && !confirmDuplicate) return duplicateErrorResponse(config.entity, exactMatch)
  return null
}

function conflictResult(error: unknown) {
  if (error instanceof WriteConflictError) return writeConflictResponse(error)
  return null
}

// Bulk points computation for the admin side (customer list + points
// summary report). portal.ts's summarizePoints() already does this
// correctly, but only ever for a single customer at a time (the public
// portal's own membership lookup, scoped to whoever is looking themselves
// up). The admin customers table (CustomersTab.tsx) and the loyalty page
// (LoyaltyPointsPage.tsx) both read `points_balance` / `points_earned` /
// `points_redeemed` / `points_rewarded` / `points_deducted` off every
// customer row -- but `customers` has no such columns (confirmed against
// 0001_init.sql) and `GET /customers` below was a bare `SELECT *`, so
// every customer in the admin UI showed blank/zero points. This computes
// the same formula in bulk (three grouped queries, not N+1 per customer)
// and merges it onto each row.
// D1 (SQLite) caps bound parameters per statement at 100. This function used
// to build one `?` per customer id and run it against the full list in a
// single query -- fine for small shops, but any customers list past ~100
// rows (no `page`/`pageSize` query params -> withPoints() runs against every
// row) blew past that cap with `D1_ERROR: too many SQL variables ... :
// SQLITE_ERROR` and took the whole `GET /customers` request down with it.
// Batch the id list into chunks under the limit and merge the results --
// via lib/sqlBinding.ts's chunkForBinding, which is the one place that
// limit is written down now (this file and notifications.ts each carried
// their own copy of the constant and the chunker).
async function computeCustomerPointsMap(env: Env, customerIds: number[]): Promise<Map<number, ReturnType<typeof summarizePoints>>> {
  const result = new Map<number, ReturnType<typeof summarizePoints>>()
  if (customerIds.length === 0) return result

  const db = getDb(env)
  const settings = await loadSettingsMap(env)
  const config = buildPortalConfig(settings, env)
  const idChunks = chunkForBinding(customerIds)

  const salesRows: Array<{ customer_id: number; sale_status: string | null; total_usd: number; total_khr: number; membership_points_redeemed: number }> = []
  const returnRows: Array<{ customer_id: number; status: string | null; total_refund_usd: number; total_refund_khr: number }> = []
  const submissionRows: Array<{ customer_id: number; status: string; reward_points: number }> = []
  const adjustmentRows: Array<{ customer_id: number; points: number }> = []

  for (const idChunk of idChunks) {
    const placeholders = idChunk.map(() => '?').join(',')
    const [salesChunk, returnChunk, submissionChunk, adjustmentChunk] = await Promise.all([
      db.prepare(`SELECT customer_id, sale_status, total_usd, total_khr, membership_points_redeemed, COALESCE(loyalty_accrual, 1) AS loyalty_accrual FROM sales WHERE customer_id IN (${placeholders})`)
        .all<{ customer_id: number; sale_status: string | null; total_usd: number; total_khr: number; membership_points_redeemed: number }>(idChunk),
      db.prepare(`SELECT customer_id, status, total_refund_usd, total_refund_khr FROM returns WHERE customer_id IN (${placeholders})`)
        .all<{ customer_id: number; status: string | null; total_refund_usd: number; total_refund_khr: number }>(idChunk),
      db.prepare(`SELECT customer_id, status, reward_points FROM customer_share_submissions WHERE customer_id IN (${placeholders})`)
        .all<{ customer_id: number; status: string; reward_points: number }>(idChunk),
      db.prepare(`SELECT customer_id, points FROM loyalty_point_adjustments WHERE customer_id IN (${placeholders})`)
        .all<{ customer_id: number; points: number }>(idChunk),
    ])
    salesRows.push(...salesChunk)
    returnRows.push(...returnChunk)
    submissionRows.push(...submissionChunk)
    adjustmentRows.push(...adjustmentChunk)
  }

  const salesByCustomer = new Map<number, Array<Record<string, unknown>>>()
  for (const row of salesRows) {
    if (row.customer_id == null) continue
    if (!salesByCustomer.has(row.customer_id)) salesByCustomer.set(row.customer_id, [])
    salesByCustomer.get(row.customer_id)!.push(row)
  }
  const returnsByCustomer = new Map<number, Array<Record<string, unknown>>>()
  for (const row of returnRows) {
    if (row.customer_id == null) continue
    if (!returnsByCustomer.has(row.customer_id)) returnsByCustomer.set(row.customer_id, [])
    returnsByCustomer.get(row.customer_id)!.push(row)
  }
  const submissionsByCustomer = new Map<number, SubmissionRow[]>()
  for (const row of submissionRows) {
    if (row.customer_id == null) continue
    if (!submissionsByCustomer.has(row.customer_id)) submissionsByCustomer.set(row.customer_id, [])
    submissionsByCustomer.get(row.customer_id)!.push(row as unknown as SubmissionRow)
  }
  const adjustmentsByCustomer = new Map<number, Array<Record<string, unknown>>>()
  for (const row of adjustmentRows) {
    if (row.customer_id == null) continue
    if (!adjustmentsByCustomer.has(row.customer_id)) adjustmentsByCustomer.set(row.customer_id, [])
    adjustmentsByCustomer.get(row.customer_id)!.push(row)
  }

  for (const id of customerIds) {
    result.set(id, summarizePoints(
      salesByCustomer.get(id) || [],
      returnsByCustomer.get(id) || [],
      submissionsByCustomer.get(id) || [],
      config,
      adjustmentsByCustomer.get(id) || [],
    ))
  }
  return result
}

// Which of these contacts have a storefront account (§2), keyed by contact_id.
// Lets admin Contacts badge a contact that has signed up and show the
// membership id it registered under. Chunked to stay within D1's bound-param
// limit, same as computeCustomerPointsMap.
type PortalAccountFlag = { membershipId: string; createdAt: string | null }
async function computePortalAccountMap(env: Env, contactIds: number[]): Promise<Map<number, PortalAccountFlag>> {
  const result = new Map<number, PortalAccountFlag>()
  if (contactIds.length === 0) return result
  const db = getDb(env)
  for (const idChunk of chunkForBinding(contactIds)) {
    const placeholders = idChunk.map(() => '?').join(',')
    const rows = await db.prepare(
      `SELECT contact_id, membership_id, created_at FROM portal_accounts WHERE contact_id IN (${placeholders})`,
    ).all<{ contact_id: number; membership_id: string; created_at: string | null }>(idChunk)
    for (const row of rows) {
      if (row.contact_id == null) continue
      result.set(Number(row.contact_id), { membershipId: row.membership_id, createdAt: row.created_at ?? null })
    }
  }
  return result
}

// Lightweight per-contact "has past records worth knowing about before you
// delete/merge this one" summary for the Possible Duplicates review panel
// (DuplicatesTab.tsx) -- distinct from computeCustomerPointsMap's full
// earned/deducted/redeemed/rewarded breakdown (that's for the customers
// list and loyalty page, more detail than a duplicate-review card needs).
// Only customers carry a loyalty-points concept; suppliers/delivery
// contacts still get a "past records" count so a reviewer doesn't
// casually delete one with return/sale history attached to it, they just
// never get a `pointsBalance` field.
type ContactHistorySummary = { pointsBalance?: number; salesCount: number; returnsCount: number }

async function computeContactHistorySummaryMap(
  env: Env,
  table: ContactDuplicateTable,
  ids: number[],
): Promise<Map<number, ContactHistorySummary>> {
  const result = new Map<number, ContactHistorySummary>()
  if (!ids.length) return result
  const db = getDb(env)
  const idChunks = chunkForBinding(ids)

  if (table === 'customers') {
    const pointsMap = await computeCustomerPointsMap(env, ids)
    const salesCounts = new Map<number, number>()
    const returnsCounts = new Map<number, number>()
    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',')
      const [salesRows, returnRows] = await Promise.all([
        db.prepare(`SELECT customer_id, COUNT(*) as cnt FROM sales WHERE customer_id IN (${placeholders}) GROUP BY customer_id`).all<{ customer_id: number; cnt: number }>(chunk),
        db.prepare(`SELECT customer_id, COUNT(*) as cnt FROM returns WHERE customer_id IN (${placeholders}) GROUP BY customer_id`).all<{ customer_id: number; cnt: number }>(chunk),
      ])
      for (const row of salesRows) salesCounts.set(row.customer_id, row.cnt)
      for (const row of returnRows) returnsCounts.set(row.customer_id, row.cnt)
    }
    for (const id of ids) {
      result.set(id, {
        pointsBalance: pointsMap.get(id)?.balance ?? 0,
        salesCount: salesCounts.get(id) || 0,
        returnsCount: returnsCounts.get(id) || 0,
      })
    }
  } else if (table === 'suppliers') {
    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',')
      const rows = await db.prepare(`SELECT supplier_id as id, COUNT(*) as cnt FROM returns WHERE supplier_id IN (${placeholders}) GROUP BY supplier_id`).all<{ id: number; cnt: number }>(chunk)
      for (const row of rows) result.set(row.id, { salesCount: 0, returnsCount: row.cnt })
    }
  } else if (table === 'delivery_contacts') {
    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',')
      const rows = await db.prepare(`SELECT delivery_contact_id as id, COUNT(*) as cnt FROM sales WHERE delivery_contact_id IN (${placeholders}) GROUP BY delivery_contact_id`).all<{ id: number; cnt: number }>(chunk)
      for (const row of rows) result.set(row.id, { salesCount: row.cnt, returnsCount: 0 })
    }
  }
  return result
}

function registerContactRoutes(config: ContactConfig) {
  app.get(config.path, async (c) => {
    const db = getDb(c.env)
    const query = c.req.query()
    // fields=names: the picker/autocomplete contract -- id + name only,
    // nothing that counts as contact data. This is also the ONLY shape of
    // this endpoint reachable without the 'contacts_suppliers' permission
    // on the suppliers table (see requireSupplierAccess above), so keep it
    // to exactly those two columns.
    if (String(query.fields || '') === 'names') {
      const rows = await db.prepare(`SELECT id, name FROM ${config.table} ORDER BY lower(name) ASC`).all<Record<string, unknown>>()
      return c.json(rows)
    }
    const hasPaging = Object.prototype.hasOwnProperty.call(query, 'page') || Object.prototype.hasOwnProperty.call(query, 'pageSize')
    const search = String(query.search || query.q || '').trim().toLowerCase()
    const where: string[] = []
    const params: Record<string, unknown> = {}
    // Was a `lower(COALESCE(col, '')) LIKE '%term%'` OR-chain across every
    // searchable column (same full-scan cost migrations/0018_products_fts.sql
    // documented for the pre-FTS5 products search, run twice per keystroke
    // here since COUNT(*) and the page itself both build off whereSql) --
    // now FTS5-backed via migrations/0020_contacts_fts.sql, see
    // lib/contactSearch.ts for why this is a plain MATCH combine rather
    // than the products-side per-group hybrid (contacts search has never
    // had a comma-groups AND/OR UI, just one free-text phrase).
    const contactMatch = buildContactMatchClause(config.table, search, 'search')
    if (contactMatch) {
      where.push(contactMatch.sql)
      Object.assign(params, contactMatch.params)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // Only the customers table has a loyalty-points concept -- suppliers
    // and delivery_contacts skip this entirely.
    const withPoints = async (rows: Array<Record<string, unknown>>) => {
      if (config.table !== 'customers' || rows.length === 0) return rows
      const ids = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id))
      const [pointsMap, portalMap] = await Promise.all([
        computeCustomerPointsMap(c.env, ids),
        computePortalAccountMap(c.env, ids),
      ])
      return rows.map((row) => {
        const points = pointsMap.get(Number(row.id))
        const portal = portalMap.get(Number(row.id)) || null
        const base = points
          ? {
              ...row,
              points_balance: points.balance,
              points_earned: points.earned,
              points_redeemed: points.redeemed,
              points_rewarded: points.rewarded,
              points_deducted: points.deducted,
            }
          : row
        // `portal_account` flags contacts that have signed up for a storefront
        // account (§2) so admin Contacts can badge them; null when none.
        return { ...base, portal_account: portal }
      })
    }

    // Allowlisted server-side sort (unified SortChip, Aug 30): the list is
    // server-paged, so ordering must happen HERE to be correct across pages
    // -- a client-side sort would only reorder the loaded page. Only plain
    // columns are offered (points_balance is computed after the page slice
    // by withPoints above, so it cannot be honestly sorted server-side).
    // Default stays exactly the old lower(name) ASC; `id` breaks ties so
    // paging never shows a row twice across adjacent pages.
    const sortColumn = String(query.sort || '') === 'created' ? 'created_at' : 'lower(name)'
    const sortDir = String(query.dir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    const orderSql = `ORDER BY ${sortColumn} ${sortDir}, id ASC`

    if (!hasPaging) {
      const rows = await db.prepare(`SELECT * FROM ${config.table} ${whereSql} ${orderSql}`).all<Record<string, unknown>>(params)
      return c.json((await withPoints(rows || [])))
    }

    const page = clampInt(query.page, 1, 1, 100000)
    const pageSize = clampInt(query.pageSize, 20, 1, 200)
    const offset = (page - 1) * pageSize
    const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM ${config.table} ${whereSql}`).get<{ count: number }>(params)
    const total = totalRow?.count || 0
    const items = await db.prepare(`SELECT * FROM ${config.table} ${whereSql} ${orderSql} LIMIT @pageSize OFFSET @offset`).all<Record<string, unknown>>({ ...params, pageSize, offset })
    return c.json({ items: (await withPoints(items || [])), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
  })

  // Live pre-submit check, called (debounced) while the form's name/phone
  // fields are being typed -- lets the frontend show a non-blocking flag
  // banner ("possible duplicate of X") before the person even hits Save.
  // The actual hard block always happens again server-side in POST/PUT
  // below regardless of what this returned, so a stale/skipped client
  // check can never let a real conflict through.
  app.get(`${config.path}/check-duplicate`, async (c) => {
    const db = getDb(c.env)
    const query = c.req.query()
    const name = String(query.name || '').trim()
    const phone = String(query.phone || '').trim()
    const excludeId = query.excludeId || null
    if (!name && !phone) return c.json({ matches: [] })
    const phones = collectContactPhones({ phone }, config.optionMode)
    const matches = await findContactDuplicates(db, config.table, { id: excludeId, name, phones }, config.optionMode)
    return c.json({ matches })
  })

  // Whole-table sweep for the admin "Possible Duplicates" review panel --
  // surfaces clusters already sitting in the data (most commonly from
  // records entered or imported before this feature existed).
  app.get(`${config.path}/duplicates`, async (c) => {
    const db = getDb(c.env)
    const clusters = await findDuplicateContactClusters(db, config.table, config.optionMode)
    // Attach each contact's "worth knowing before you act" history summary
    // (loyalty points balance for customers, past sales/returns counts for
    // any table) so the review panel can warn a reviewer before they
    // delete a record that would silently orphan that history -- merge
    // already repoints these references, delete does not.
    const allIds = [...new Set(clusters.flatMap((cluster) => cluster.contacts.map((contact) => contact.id)))]
    const historyMap = await computeContactHistorySummaryMap(c.env, config.table, allIds)
    const enriched = clusters.map((cluster) => ({
      ...cluster,
      contacts: cluster.contacts.map((contact) => ({ ...contact, history: historyMap.get(contact.id) || null })),
    }))
    return c.json({ clusters: enriched })
  })

  // Marks one cluster (identified the same way the panel renders it -- a
  // type + normalized value, e.g. {type:'name', value:'sok dara'}) as
  // reviewed-and-not-a-duplicate so it stops resurfacing on future sweeps.
  // See contactDuplicates.ts's dismissDuplicateCluster for why this is
  // scoped to the cluster, not a specific pair of ids.
  app.post(`${config.path}/duplicates/dismiss`, async (c) => {
    const user = c.get('user')
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const type = body.type === 'phone' ? 'phone' : body.type === 'name' ? 'name' : null
    const value = String(body.value || '').trim()
    if (!type || !value) return c.json({ error: 'type ("phone" or "name") and value are required' }, 400)
    const db = getDb(c.env)
    await dismissDuplicateCluster(db, config.table, type, value, { id: user?.id ?? null, name: user?.name ?? null })
    return c.json({ ok: true })
  })

  // Merges two contact records the reviewer has confirmed really are the
  // same real-world person/business: every historical reference to
  // `mergeId` is repointed at `keepId`, any field left blank on the
  // keeper is backfilled from the merged record (never the other way --
  // the keeper's own existing data always wins), and the merged row is
  // then deleted. Same Full-Access-only gate as plain delete below, for
  // the same reason (this IS a delete, just preceded by a repoint).
  app.post(`${config.path}/merge`, async (c) => {
    const user = c.get('user')
    if (getPermissionTier(user, 'contacts') === 'review') {
      return c.json({ error: `Merging ${config.entity}s requires Full Access to Contacts -- Review Required support for this action is not built.` }, 403)
    }
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const keepId = Number(body.keepId)
    const mergeId = Number(body.mergeId)
    if (!Number.isFinite(keepId) || !Number.isFinite(mergeId) || keepId === mergeId) {
      return c.json({ error: 'keepId and mergeId (two different ids) are required' }, 400)
    }
    const db = getDb(c.env)
    const [keeper, merged] = await Promise.all([
      db.prepare(`SELECT * FROM ${config.table} WHERE id = @id`).get<Record<string, unknown>>({ id: keepId }),
      db.prepare(`SELECT * FROM ${config.table} WHERE id = @id`).get<Record<string, unknown>>({ id: mergeId }),
    ])
    if (!keeper) return c.json({ error: `Contact to keep (id ${keepId}) not found` }, 404)
    if (!merged) return c.json({ error: `Contact to merge (id ${mergeId}) not found` }, 404)

    // Backfill: only columns this table actually allows editing (same
    // allowlist POST/PUT use), and only where the keeper is genuinely
    // blank -- never overwrites a value the keeper already has.
    const backfill: Record<string, unknown> = {}
    for (const column of config.columns) {
      const keeperValue = keeper[column]
      const mergedValue = merged[column]
      const keeperBlank = keeperValue === null || keeperValue === undefined || keeperValue === ''
      const mergedHasValue = mergedValue !== null && mergedValue !== undefined && mergedValue !== ''
      if (keeperBlank && mergedHasValue) backfill[column] = mergedValue
    }
    if (Object.keys(backfill).length) {
      const setSql = Object.keys(backfill).map((col) => `${col} = @${col}`).join(', ')
      await db.prepare(`UPDATE ${config.table} SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ ...backfill, id: keepId })
    }

    // Table-specific FK repoints -- every place elsewhere in the schema
    // that references this contact by id (confirmed against
    // migrations/0001_init.sql: sales/returns/customer_share_submissions
    // for customers, returns for suppliers, sales for delivery_contacts).
    // products.supplier is a free-text name (not an id) for suppliers --
    // repointed by value, using the merged supplier's own name captured
    // above before its row is deleted.
    if (config.table === 'customers') {
      await db.batch([
        { sql: `UPDATE sales SET customer_id = @keepId WHERE customer_id = @mergeId`, params: { keepId, mergeId } },
        { sql: `UPDATE returns SET customer_id = @keepId WHERE customer_id = @mergeId`, params: { keepId, mergeId } },
        { sql: `UPDATE customer_share_submissions SET customer_id = @keepId WHERE customer_id = @mergeId`, params: { keepId, mergeId } },
        // Was missing until this session -- loyalty_point_adjustments has
        // no FK/CASCADE (confirmed against migrations/0028), so without
        // this repoint, merging a customer who had ever been manually
        // awarded points silently orphaned those adjustment rows the
        // moment `mergeId`'s row was deleted below: computeCustomerPointsMap
        // only ever queries adjustments for ids still in the customers
        // table, so the merged-away customer's manually-awarded points
        // would vanish from the survivor's balance instead of carrying
        // over, with no error and no record of what was lost.
        { sql: `UPDATE loyalty_point_adjustments SET customer_id = @keepId WHERE customer_id = @mergeId`, params: { keepId, mergeId } },
      ])
    } else if (config.table === 'suppliers') {
      const mergedName = String(merged.name || '')
      const statements: Array<{ sql: string; params: Record<string, unknown> }> = [
        { sql: `UPDATE returns SET supplier_id = @keepId WHERE supplier_id = @mergeId`, params: { keepId, mergeId } },
      ]
      if (mergedName) {
        statements.push({ sql: `UPDATE products SET supplier = @keeperName WHERE supplier = @mergedName`, params: { keeperName: keeper.name, mergedName } })
      }
      await db.batch(statements)
    } else if (config.table === 'delivery_contacts') {
      await db.batch([
        { sql: `UPDATE sales SET delivery_contact_id = @keepId WHERE delivery_contact_id = @mergeId`, params: { keepId, mergeId } },
      ])
    }

    await db.prepare(`DELETE FROM ${config.table} WHERE id = @id`).run({ id: mergeId })
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'merge', config.entity, keepId, { mergedId: mergeId, mergedName: merged.name, backfilled: Object.keys(backfill) })
    c.executionCtx.waitUntil(broadcast(c.env, config.channel, { action: 'merge', id: keepId, mergedId: mergeId }))
    const refreshed = await db.prepare(`SELECT * FROM ${config.table} WHERE id = @id`).get<Record<string, unknown>>({ id: keepId })
    return c.json({ contact: refreshed })
  })

  app.post(config.path, async (c) => {
    const user = c.get('user')
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const name = String(body.name || '').trim()
    if (!name) return c.json({ error: 'Name is required' }, 400)

    const db = getDb(c.env)
    const payload = pickColumns(body, config.columns)
    payload.name = name
    // P7-c: store the P8 display shape (0XX XXX XXX[X]) so manual creates
    // match the 10,352 migrated numbers. Matching below stays digit-based,
    // so this changes nothing about duplicate detection or linkage.
    if (Object.prototype.hasOwnProperty.call(payload, 'phone')) payload.phone = formatPhoneP8(payload.phone)
    // Keep the canonical phone key in sync so the storefront signup can detect
    // this contact as an existing customer (lib/phone.ts is the authority;
    // 0086 backfilled the historical rows). Customers only — suppliers/delivery
    // contacts have no such column.
    if (config.table === 'customers' && Object.prototype.hasOwnProperty.call(payload, 'phone')) {
      payload.phone_normalized = canonicalizePhone(payload.phone)
    }

    const duplicateBlock = await checkContactDuplicateBlock(c.env, config, { name, phone: payload.phone, address: payload.address }, body.confirmDuplicate === true)
    if (duplicateBlock) return c.json(duplicateBlock.body, duplicateBlock.status as 400 | 409)

    if (config.table === 'customers') {
      const raw = String(payload.membership_number || '').trim()
      if (raw) {
        const existing = await db.prepare('SELECT id FROM customers WHERE lower(trim(membership_number)) = lower(trim(@raw)) LIMIT 1').get({ raw })
        if (existing) return c.json({ error: `Membership number "${raw}" is already in use` }, 400)
        payload.membership_number = raw
      } else {
        payload.membership_number = await generateMembershipNumber(c.env)
      }
    }

    const columns = Object.keys(payload)
    const result = await db.prepare(`
      INSERT INTO ${config.table} (${columns.join(', ')}, updated_at)
      VALUES (${columns.map((col) => `@${col}`).join(', ')}, CURRENT_TIMESTAMP)
    `).run(payload)
    const id = result.lastInsertRowid
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', config.entity, id, { name })
    c.executionCtx.waitUntil(broadcast(c.env, config.channel, { action: 'create', id }))
    const item = await db.prepare(`SELECT * FROM ${config.table} WHERE id = @id`).get({ id })
    return c.json(item)
  })

  // Staff-initiated storefront password reset (§2, the "contact us to reset"
  // path — no SMS provider is wired for self-serve reset, and few customers
  // have an email). Issues a fresh temporary password, returns it ONCE so
  // staff can pass it to the customer, and kills every live session for that
  // account. Customers only; full contacts tier only (review tier is limited).
  if (config.table === 'customers') {
    app.post(`${config.path}/:id/portal-reset`, async (c) => {
      const user = c.get('user')
      if (getPermissionTier(user, 'contacts') !== 'full') {
        return c.json({ error: 'Resetting a storefront password needs full Contacts permission' }, 403)
      }
      const id = c.req.param('id')
      const db = getDb(c.env)
      const account = await db.prepare('SELECT id FROM portal_accounts WHERE contact_id = @id LIMIT 1').get<{ id: number }>({ id })
      if (!account) return c.json({ error: 'This contact has no storefront account' }, 404)
      // A readable-but-random temporary password (no ambiguous chars).
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
      const bytes = new Uint8Array(10)
      crypto.getRandomValues(bytes)
      const tempPassword = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
      await db.prepare('UPDATE portal_accounts SET password_hash = @h, updated_at = CURRENT_TIMESTAMP WHERE id = @aid')
        .run({ h: bcrypt.hashSync(tempPassword, 10), aid: account.id })
      await revokePortalSessionsForAccount(c.env, account.id)
      await audit(c.env, user?.id ?? null, user?.name ?? null, 'portal_reset', config.entity, id, {})
      return c.json({ ok: true, temporaryPassword: tempPassword })
    })
  }

  app.put(`${config.path}/:id`, async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const db = getDb(c.env)

    const current = await db.prepare(`SELECT * FROM ${config.table} WHERE id = @id`).get<Record<string, unknown>>({ id })
    if (!current) return c.json({ error: `${config.entity} not found` }, 404)
    try {
      assertUpdatedAtMatch(config.entity, current, getExpectedUpdatedAt(body))
    } catch (error) {
      const result = conflictResult(error)
      if (result) return c.json(result.body, result.status)
      throw error
    }

    const name = body.name != null ? String(body.name).trim() : String(current.name || '')
    if (!name) return c.json({ error: 'Name is required' }, 400)

    // Review Required tier (progress.md's "Permissions UI redesign" item):
    // Contacts' spec is narrower than Products' -- "edit limited to name
    // only", not "every edit goes to review". So this isn't a
    // maybeQueueForReview() call site like products.ts/inventory.ts's
    // gated writes: a Review Required user's edit applies directly, same
    // as Full, but only the name field is ever allowed to change. The
    // frontend's edit forms always send the full contact object, so
    // rejecting the request outright whenever any other field differs
    // would block the very name-only edit this tier is supposed to allow
    // -- instead, every non-name column is silently dropped from the
    // payload for a 'review'-tier user before it's applied, exactly like
    // pickColumns already drops any column not sent at all.
    const tier = getPermissionTier(user, 'contacts')
    const allowedColumns = tier === 'review' ? ['name'] : config.columns
    const payload = pickColumns(body, allowedColumns)
    payload.name = name
    // P7-c: same P8 display shape on edit as on create -- an update that
    // touches the phone must not undo the convention.
    if (Object.prototype.hasOwnProperty.call(payload, 'phone')) payload.phone = formatPhoneP8(payload.phone)
    // Keep the canonical phone key in sync on edit too (see create above).
    if (config.table === 'customers' && Object.prototype.hasOwnProperty.call(payload, 'phone')) {
      payload.phone_normalized = canonicalizePhone(payload.phone)
    }

    // D6: renaming a SUPPLIER used to leave every product/batch that
    // carries the old free-text name pointing at nothing. When the rename
    // dialog chose "carry", every attached row follows the new name;
    // without the flag the old (no-cascade) behavior stands, and "keep a
    // copy, new is new" is the frontend creating a fresh supplier instead.
    if (config.table === 'suppliers' && body.__rename_cascade === 'carry') {
      const fromName = String(current.name || '').trim()
      if (fromName && fromName.toLowerCase() !== name.toLowerCase()) {
        const carried = await applyRenameCarry(db, 'supplier', fromName, name, new Date().toISOString())
        await audit(c.env, user?.id ?? null, user?.name ?? null, 'rename', 'supplier_cascade', id, { from: fromName, to: name, products: carried.products, batches: carried.batches })
      }
    }
    delete (body as Record<string, unknown>).__rename_cascade

    // Flagged as a UX gap in Part 155, fixed here (Part 157): a Review
    // Required edit used to return a plain 200 even though only `name`
    // actually saved, with nothing in the response telling the frontend
    // the rest of the submitted form was silently dropped. `wasPartial`
    // is true only when there was actually something to drop -- i.e. the
    // request body contained at least one of the OTHER real columns
    // (config.columns minus 'name'), not just when the tier happens to be
    // 'review' (a review-tier user submitting a genuine name-only change
    // isn't "partial", nothing of theirs was dropped).
    const droppedColumns = tier === 'review'
      ? config.columns.filter((col) => col !== 'name' && Object.prototype.hasOwnProperty.call(body, col))
      : []
    const wasPartial = droppedColumns.length > 0

    // Duplicate check runs against the record's RESULTING phone set --
    // a partial update (e.g. editing only the notes field) still needs
    // to check the phones already on `current`, not an empty set.
    const effectivePhone = Object.prototype.hasOwnProperty.call(payload, 'phone') ? payload.phone : current.phone
    const effectiveAddress = Object.prototype.hasOwnProperty.call(payload, 'address') ? payload.address : current.address
    const duplicateBlock = await checkContactDuplicateBlock(c.env, config, { id, name, phone: effectivePhone, address: effectiveAddress }, body.confirmDuplicate === true)
    if (duplicateBlock) return c.json(duplicateBlock.body, duplicateBlock.status as 400 | 409)

    if (config.table === 'customers' && Object.prototype.hasOwnProperty.call(payload, 'membership_number')) {
      const raw = String(payload.membership_number || '').trim()
      if (raw) {
        const existing = await db.prepare('SELECT id FROM customers WHERE lower(trim(membership_number)) = lower(trim(@raw)) AND id != @id LIMIT 1').get({ raw, id })
        if (existing) return c.json({ error: `Membership number "${raw}" is already in use` }, 400)
        payload.membership_number = raw
      } else {
        payload.membership_number = current.membership_number || (await generateMembershipNumber(c.env))
      }
    }

    const columns = Object.keys(payload)
    if (columns.length) {
      await db.prepare(`
        UPDATE ${config.table}
        SET ${columns.map((col) => `${col} = @${col}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({ ...payload, id })
    }
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', config.entity, id, { name })
    c.executionCtx.waitUntil(broadcast(c.env, config.channel, { action: 'update', id }))
    const item = await db.prepare(`SELECT * FROM ${config.table} WHERE id = @id`).get({ id })
    // `partial`/`partialFields` are additive -- every existing caller reads
    // specific known fields off this response (id, name, etc.) or just
    // checks `success === false`, so a new key here doesn't change any
    // existing behavior. Only present at all when something was actually
    // dropped, so `result?.partial` stays falsy/undefined for every normal
    // Full Access save and every genuine name-only Review Required save.
    if (wasPartial) {
      return c.json({ ...item, partial: true, partialFields: droppedColumns })
    }
    return c.json(item)
  })

  app.delete(`${config.path}/:id`, async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    // Contacts' spec explicitly lists what Review Required CAN do (view +
    // add directly, name-only edit) and doesn't include delete anywhere --
    // same "don't silently turn Review Required into Full Access the
    // moment the router-wide gate loosens" discipline Part 154 used for
    // Returns' PATCH /:id. Blocked outright rather than queued: there's no
    // "no import, no export" style middle ground stated for delete, so
    // treating it as queueable would be inventing a spec line, not
    // following one.
    if (getPermissionTier(user, 'contacts') === 'review') {
      return c.json({ error: `Deleting a ${config.entity} requires Full Access to Contacts -- Review Required support for this action is not built.` }, 403)
    }

    const db = getDb(c.env)
    const current = await db.prepare(`SELECT * FROM ${config.table} WHERE id = @id`).get<Record<string, unknown>>({ id })
    if (!current) return c.json({ error: `${config.entity} not found` }, 404)

    let body: Record<string, unknown> = Object.fromEntries(new URL(c.req.url).searchParams)
    try {
      body = (await c.req.json<Record<string, unknown>>().catch(() => body)) as Record<string, unknown>
    } catch (_) {
      // no JSON body -- query params already captured above
    }
    try {
      assertUpdatedAtMatch(config.entity, current, getExpectedUpdatedAt(body))
    } catch (error) {
      const result = conflictResult(error)
      if (result) return c.json(result.body, result.status)
      throw error
    }

    await db.prepare(`DELETE FROM ${config.table} WHERE id = @id`).run({ id })
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'delete', config.entity, id, { name: current.name })
    c.executionCtx.waitUntil(broadcast(c.env, config.channel, { action: 'delete', id }))
    return c.json({})
  })

  // POST /api/{customers|suppliers|delivery-contacts}/bulk-delete-jobs --
  // the 10k+-safe path, mirroring products.ts's identical route (see
  // lib/bulkDeleteEngine.ts's header). Same permission rule as single
  // delete above: 'none' rejected outright, 'review' rejected too rather
  // than half-supported (queuing one review action per id would defeat
  // the point of batching; Contacts' spec already has no Review Required
  // story for delete at all, see the single-delete route's own comment
  // above). Small selections still go through the per-id path, unchanged.
  app.post(`${config.path}/bulk-delete-jobs`, async (c) => {
    const user = c.get('user')
    const tier = getPermissionTier(user, 'contacts')
    if (tier === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
    if (tier === 'review') {
      return c.json({ error: `Bulk delete requires Full Access to Contacts -- Review Required support for this action is not built.` }, 403)
    }

    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const reason = body.reason != null ? String(body.reason).trim() || null : null
    if (!reason) return c.json({ error: `A reason is required to delete ${config.entity}s` }, 400)

    const rawIds = Array.isArray(body.ids) ? body.ids : []
    // Same generous, untuned 50,000 ceiling as products.ts's identical route.
    if (!rawIds.length) return c.json({ error: `No ${config.entity}s selected` }, 400)
    if (rawIds.length > 50000) return c.json({ error: `Select 50,000 or fewer ${config.entity}s per bulk delete` }, 400)

    try {
      const { jobId, totalCount } = await createBulkDeleteJob(c.env, contactBulkDeleteEntityType(config), rawIds as number[], reason, { id: user?.id ?? null, name: user?.name ?? null })
      return c.json({ success: true, jobId, totalCount }, 202)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed to start bulk delete' }, 400)
    }
  })

  // GET /api/{customers|suppliers|delivery-contacts}/bulk-delete-jobs/:id --
  // polled by the frontend while a job is in flight. Cheap: one row read,
  // no join, so polling every second or two is fine.
  app.get(`${config.path}/bulk-delete-jobs/:id`, async (c) => {
    const user = c.get('user')
    if (getPermissionTier(user, 'contacts') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
    await reapStalledBulkDeleteJobs(c.env)
    const job = await getBulkDeleteJob(c.env, c.req.param('id'))
    if (!job) return c.json({ error: 'Bulk delete job not found' }, 404)
    return c.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        totalCount: job.total_count,
        processedCount: job.processed_count,
        failedCount: job.failed_count,
        lastError: job.last_error ?? null,
      },
    })
  })

  // POST /api/{customers|suppliers|delivery-contacts}/bulk-delete-jobs/:id/cancel
  // -- sets cancel_requested; the queue consumer checks it once per chunk,
  // so this takes effect within one chunk's worth of rows, not instantly.
  // Whatever's already committed at that point stays deleted -- same
  // "partial progress is kept, not rolled back" behavior as import job
  // cancellation and products.ts's identical route.
  app.post(`${config.path}/bulk-delete-jobs/:id/cancel`, async (c) => {
    const user = c.get('user')
    if (getPermissionTier(user, 'contacts') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
    await getDb(c.env).prepare(`UPDATE bulk_delete_jobs SET cancel_requested = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND status IN ('pending', 'processing')`).run({ id: c.req.param('id') })
    return c.json({ success: true })
  })

  // NOTE: contact CSV bulk-import does NOT go through a direct
  // `${config.path}/bulk-import` REST route. The real UI flow
  // (ContactImportModal.tsx / contactImportWorker.ts) submits an async
  // import job (jobType: 'customers' | 'suppliers' | 'delivery_contacts')
  // through the job system in importEngine.ts, which now uses
  // lib/contactOptions.ts to build the multi-option `address` JSON. A
  // `${config.path}/bulk-import` stub used to live here returning a 501 --
  // removed because nothing in the frontend calls it (confirmed: no
  // reference to bulkImportContact/bulkImportCustomers/bulkImportSuppliers/
  // bulkImportDeliveryContacts outside api/contactsTransport.ts and
  // api/methods.ts -- those wrapper exports are themselves unreachable dead
  // code, left in place since removing them is a separate frontend cleanup).
}

registerContactRoutes(CUSTOMERS)
registerContactRoutes(SUPPLIERS)
registerContactRoutes(DELIVERY_CONTACTS)

// D5 (Part 384): what a supplier actually supplied -- every batch
// attributed to them (0062 supplier-on-batch), with per-lot received
// totals (0067), unit cost (0065), what remains, and the paid/credit
// state. Sits under /suppliers/* so requireSupplierAccess already gates
// it -- purchase costs are exactly the data the suppliers grant protects.
// Matches by supplier_id, plus name-only batches (supplier typed free-text
// before the id existed, or the import's resolver found no contact row).
app.get('/suppliers/:id/purchases', async (c) => {
  const db = getDb(c.env)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid supplier id' }, 400)
  const supplier = await db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get<{ id: number; name: string | null }>([id])
  if (!supplier) return c.json({ error: 'Supplier not found' }, 404)

  const batches = await db.prepare(`
    SELECT pb.id, pb.batch_number, pb.lot_code, pb.received_at, pb.received_quantity,
           pb.unit_cost_usd, pb.received_cost_usd, pb.payment_status, pb.credit_due_date, pb.is_active,
           p.id AS product_id, p.name AS product_name,
           COALESCE(SUM(bbs.quantity), 0) AS remaining_quantity
    FROM product_batches pb
    JOIN products p ON p.id = pb.variant_product_id
    LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id
    WHERE pb.supplier_id = @id
       OR (pb.supplier_id IS NULL AND pb.supplier_name IS NOT NULL AND lower(trim(pb.supplier_name)) = @name)
    GROUP BY pb.id
    ORDER BY pb.received_at DESC, pb.id DESC
    LIMIT 1000
  `).all<{
    id: number; batch_number: number | null; lot_code: string | null; received_at: string | null
    received_quantity: number | null; unit_cost_usd: number | null; received_cost_usd: number | null; payment_status: string | null
    credit_due_date: string | null; is_active: number | null
    product_id: number; product_name: string | null; remaining_quantity: number
  }>({ id, name: String(supplier.name || '').trim().toLowerCase() })

  const totals = {
    batches: batches.length,
    products: new Set(batches.map((b) => b.product_id)).size,
    units_received: 0,
    // Purchase cost only where BOTH received qty and unit cost are known --
    // batches_without_cost says how many lots the total cannot see, rather
    // than quietly pretending they cost 0.
    cost_usd: 0,
    credit_open_usd: 0,
    credit_batches: 0,
    batches_without_cost: 0,
  }
  for (const batch of batches) {
    const received = Number(batch.received_quantity)
    // 0080: spend comes from the lot's recorded money, not from re-deriving
    // it as quantity x unit_cost_usd. unit_cost_usd is first-attribution, so
    // that form valued a same-day second receipt at the first receipt's
    // price -- overstating this exact figure by 11.5% on the migrated data.
    const recordedCost = Number(batch.received_cost_usd)
    if (Number.isFinite(received) && batch.received_quantity != null) totals.units_received += received
    if (batch.received_cost_usd != null && Number.isFinite(recordedCost)) {
      const cost = recordedCost
      totals.cost_usd += cost
      if (batch.payment_status === 'credit') totals.credit_open_usd += cost
    } else {
      totals.batches_without_cost += 1
    }
    if (batch.payment_status === 'credit') totals.credit_batches += 1
  }
  totals.cost_usd = Math.round(totals.cost_usd * 100) / 100
  totals.credit_open_usd = Math.round(totals.credit_open_usd * 100) / 100

  return c.json({ supplier, totals, batches })
})

// D1b: the Stock-In Invoice report -- purchases grouped supplier → invoice
// (received date) → product lines, modeled on the old system's report. An
// "invoice" here is one supplier's receipts on one calendar day: the old
// system's invoice NUMBER was never stored in this schema (batches carry
// supplier/date/cost, not an invoice column), so the date is the honest
// grouping and nothing is fabricated. Data source is product_batches
// directly (supplier 0062, cost/payment 0065, received totals 0067,
// receiving branch 0070) -- inventory_movements can't serve this report
// because movements never link to a batch row. Sits under /suppliers/* so
// requireSupplierAccess gates it: per-lot costs and supplier spend are
// exactly what the contacts_suppliers grant protects (R2), same as the
// per-supplier purchases drill above.
//
// The derived table below is shared by both report endpoints: one row per
// batch with its resolved supplier identity. supplier_id wins; a name-only
// attribution (free text, or the import matched no contact row) resolves
// to the lowest-id supplier with that normalized name so id-attributed and
// name-only lots of the SAME supplier land in the SAME group -- the same
// merge rule GET /suppliers/:id/purchases applies from the other
// direction. No supplier at all groups under 'none' ("no supplier
// recorded" -- which honestly includes non-purchase receipts like return
// restocks and count corrections; the data cannot tell them apart and the
// report says what it holds rather than hiding rows).
// Product imports create one empty placeholder lot per catalog product so
// later stock can attach to it. Those `import:*` rows are not receipts and
// must not become a giant "No supplier recorded" invoice merely because
// the catalog was imported that day. Keep genuine no-supplier receipts;
// exclude only the unmistakable all-null catalog placeholder shape.
const STOCK_IN_REPORT_SOURCE = `
  SELECT pb.id, pb.variant_product_id, pb.batch_number, pb.lot_code, pb.received_at,
         pb.received_quantity, pb.unit_cost_usd, pb.received_cost_usd, pb.payment_status, pb.credit_due_date,
         pb.received_branch_id,
         CASE
           WHEN s.id IS NOT NULL THEN 'id:' || s.id
           WHEN trim(COALESCE(pb.supplier_name, '')) <> '' THEN 'name:' || lower(trim(pb.supplier_name))
           ELSE 'none'
         END AS supplier_key,
         COALESCE(s.name, pb.supplier_name) AS supplier_display,
         COALESCE(substr(pb.received_at, 1, 10), '') AS received_day
  FROM product_batches pb
  LEFT JOIN suppliers s ON s.id = COALESCE(pb.supplier_id,
    (SELECT MIN(s2.id) FROM suppliers s2
     WHERE trim(COALESCE(pb.supplier_name, '')) <> '' AND lower(trim(s2.name)) = lower(trim(pb.supplier_name))))
  WHERE NOT (
    pb.batch_key LIKE 'import:%'
    AND pb.received_quantity IS NULL
    AND pb.supplier_id IS NULL
    AND trim(COALESCE(pb.supplier_name, '')) = ''
    AND pb.unit_cost_usd IS NULL
    AND pb.received_branch_id IS NULL
  )
`

// Builds the WHERE clause + params both endpoints share. A date bound also
// requires a recorded date -- a range filter that quietly matched no-date
// rows would misreport; those rows stay reachable with no date filter set
// (their group shows as "no date recorded").
function stockInReportFilters(query: Record<string, string | undefined>): { where: string; params: Record<string, unknown> } {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  const branchId = Number(query.branch_id)
  if (Number.isFinite(branchId) && branchId > 0) {
    conditions.push('t.received_branch_id = @branchId')
    params.branchId = branchId
  }
  const supplierKey = String(query.supplier || '').trim()
  if (supplierKey && supplierKey !== 'all') {
    conditions.push('t.supplier_key = @supplierKey')
    params.supplierKey = supplierKey
  }
  const from = String(query.from || '').slice(0, 10)
  const to = String(query.to || '').slice(0, 10)
  if (from) { conditions.push("t.received_day <> '' AND t.received_day >= @from"); params.from = from }
  if (to) { conditions.push("t.received_day <> '' AND t.received_day <= @to"); params.to = to }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

app.get('/suppliers/reports/stock-in-invoices', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const page = clampInt(query.page, 1, 1, 100000)
  const pageSize = clampInt(query.page_size, 15, 1, 25)
  const { where, params } = stockInReportFilters(query)

  type GroupRow = {
    supplier_key: string; supplier_name: string | null; received_day: string
    line_count: number; units_received: number; lines_without_qty: number
    cost_usd: number; lines_without_cost: number; credit_lines: number
    branch_ids: string | null
  }
  const invoices = await db.prepare(`
    SELECT t.supplier_key, MAX(t.supplier_display) AS supplier_name, t.received_day,
           COUNT(*) AS line_count,
           SUM(CASE WHEN t.received_quantity IS NOT NULL THEN t.received_quantity ELSE 0 END) AS units_received,
           SUM(CASE WHEN t.received_quantity IS NULL THEN 1 ELSE 0 END) AS lines_without_qty,
           SUM(COALESCE(t.received_cost_usd, 0)) AS cost_usd,
           SUM(CASE WHEN t.received_cost_usd IS NULL THEN 1 ELSE 0 END) AS lines_without_cost,
           SUM(CASE WHEN t.payment_status = 'credit' THEN 1 ELSE 0 END) AS credit_lines,
           GROUP_CONCAT(DISTINCT t.received_branch_id) AS branch_ids
    FROM (${STOCK_IN_REPORT_SOURCE}) t
    ${where}
    GROUP BY t.supplier_key, t.received_day
    ORDER BY t.received_day DESC, supplier_name COLLATE NOCASE ASC
    LIMIT @limit OFFSET @offset
  `).all<GroupRow>({ ...params, limit: pageSize, offset: (page - 1) * pageSize })

  type TotalsRow = {
    line_count: number; units_received: number; cost_usd: number
    lines_without_cost: number; credit_lines: number
  }
  const [countRow, totalsRow] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM (${STOCK_IN_REPORT_SOURCE}) t ${where} GROUP BY t.supplier_key, t.received_day
      )
    `).get<{ total: number }>(params),
    db.prepare(`
      SELECT COUNT(*) AS line_count,
             SUM(CASE WHEN t.received_quantity IS NOT NULL THEN t.received_quantity ELSE 0 END) AS units_received,
             SUM(COALESCE(t.received_cost_usd, 0)) AS cost_usd,
             SUM(CASE WHEN t.received_cost_usd IS NULL THEN 1 ELSE 0 END) AS lines_without_cost,
             SUM(CASE WHEN t.payment_status = 'credit' THEN 1 ELSE 0 END) AS credit_lines
      FROM (${STOCK_IN_REPORT_SOURCE}) t ${where}
    `).get<TotalsRow>(params),
  ])

  // When a branch filter is on, say how many invoice groups it CANNOT see
  // because their lots never had a branch recorded (pre-0070 rows, and
  // catalog-import batches) -- hidden-and-counted, never silently dropped.
  let invoicesWithoutBranch = 0
  if (params.branchId != null) {
    const noBranchQuery = { ...query, branch_id: undefined }
    const { where: baseWhere, params: baseParams } = stockInReportFilters(noBranchQuery)
    const row = await db.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM (${STOCK_IN_REPORT_SOURCE}) t
        ${baseWhere ? `${baseWhere} AND` : 'WHERE'} t.received_branch_id IS NULL
        GROUP BY t.supplier_key, t.received_day
      )
    `).get<{ total: number }>(baseParams)
    invoicesWithoutBranch = Number(row?.total) || 0
  }

  const [branches, supplierOptions] = await Promise.all([
    db.prepare('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id ASC').all<{ id: number; name: string | null }>(),
    db.prepare(`
      SELECT t.supplier_key AS key, MAX(t.supplier_display) AS name
      FROM (${STOCK_IN_REPORT_SOURCE}) t
      WHERE t.supplier_key <> 'none'
      GROUP BY t.supplier_key
      ORDER BY name COLLATE NOCASE ASC
      LIMIT 300
    `).all<{ key: string; name: string | null }>(),
  ])

  const round2 = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100
  return c.json({
    invoices: invoices.map((row) => ({ ...row, cost_usd: round2(row.cost_usd) })),
    totals: {
      invoices: Number(countRow?.total) || 0,
      lines: Number(totalsRow?.line_count) || 0,
      units_received: Number(totalsRow?.units_received) || 0,
      cost_usd: round2(totalsRow?.cost_usd),
      lines_without_cost: Number(totalsRow?.lines_without_cost) || 0,
      credit_lines: Number(totalsRow?.credit_lines) || 0,
      invoices_without_branch: invoicesWithoutBranch,
    },
    page,
    page_size: pageSize,
    total_invoices: Number(countRow?.total) || 0,
    meta: { branches, suppliers: supplierOptions },
  })
})

// One invoice group's product lines, paged -- the groups endpoint stays
// bounded no matter how big a group is (the catalog import's synthetic
// same-day batches can put thousands of lines under one date).
app.get('/suppliers/reports/stock-in-invoice-lines', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const supplierKey = String(query.supplier_key || '').trim()
  if (!supplierKey) return c.json({ error: 'supplier_key is required' }, 400)
  // The no-date group travels as 'none' (an empty query value would be
  // dropped in transit); it means received_day = '' in the source table.
  const rawDay = String(query.day || '').trim()
  if (!rawDay) return c.json({ error: 'day is required' }, 400)
  const day = rawDay === 'none' ? '' : rawDay.slice(0, 10)
  const page = clampInt(query.page, 1, 1, 100000)
  const pageSize = clampInt(query.page_size, 100, 1, 200)

  const conditions = ['t.supplier_key = @supplierKey', 't.received_day = @day']
  const params: Record<string, unknown> = { supplierKey, day }
  const branchId = Number(query.branch_id)
  if (Number.isFinite(branchId) && branchId > 0) {
    conditions.push('t.received_branch_id = @branchId')
    params.branchId = branchId
  }
  const where = `WHERE ${conditions.join(' AND ')}`

  type LineRow = {
    id: number; batch_number: number | null; lot_code: string | null; received_at: string | null
    received_quantity: number | null; unit_cost_usd: number | null; received_cost_usd: number | null; payment_status: string | null
    credit_due_date: string | null; received_branch_id: number | null; received_branch_name: string | null
    product_id: number; product_name: string | null; barcode: string | null; unit: string | null; remaining_quantity: number
  }
  const [lines, countRow] = await Promise.all([
    db.prepare(`
      SELECT t.id, t.batch_number, t.lot_code, t.received_at, t.received_quantity,
             t.unit_cost_usd, t.received_cost_usd, t.payment_status, t.credit_due_date, t.received_branch_id,
             b.name AS received_branch_name,
             p.id AS product_id, p.name AS product_name, p.barcode, p.unit,
             COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = t.id), 0) AS remaining_quantity
      FROM (${STOCK_IN_REPORT_SOURCE}) t
      JOIN products p ON p.id = t.variant_product_id
      LEFT JOIN branches b ON b.id = t.received_branch_id
      ${where}
      ORDER BY p.name COLLATE NOCASE ASC, t.id ASC
      LIMIT @limit OFFSET @offset
    `).all<LineRow>({ ...params, limit: pageSize, offset: (page - 1) * pageSize }),
    db.prepare(`SELECT COUNT(*) AS total FROM (${STOCK_IN_REPORT_SOURCE}) t ${where}`).get<{ total: number }>(params),
  ])

  return c.json({
    lines: lines.map((line) => ({
      ...line,
      // 0080: the money this lot actually recorded, not quantity x a single
      // unit cost -- a lot can hold same-day receipts bought at different
      // prices, and the old form valued all of them at the first one.
      line_total_usd: line.received_cost_usd != null
        ? Math.round(line.received_cost_usd * 100) / 100
        : null,
    })),
    page,
    page_size: pageSize,
    total_lines: Number(countRow?.total) || 0,
  })
})

// Administrator-only manual point awards. A ledger event is created instead
// of mutating a balance column, preserving the same calculable/auditable
// model used for sales, returns, and approved share rewards.
app.post('/customers/:id/points', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ error: 'Administrator access required to award loyalty points.' }, 403)
  const customerId = clampInt(c.req.param('id'), 0, 1, Number.MAX_SAFE_INTEGER)
  const body = await c.req.json<{ points?: unknown; note?: unknown }>()
  const points = Number(body.points)
  if (!Number.isFinite(points) || points <= 0 || points > 1_000_000) {
    return c.json({ error: 'Points must be a positive number no greater than 1,000,000.' }, 400)
  }
  const db = getDb(c.env)
  const customer = await db.prepare('SELECT id, name, membership_number FROM customers WHERE id = ?').get<{ id: number; name: string | null; membership_number: string | null }>([customerId])
  if (!customer) return c.json({ error: 'Customer not found.' }, 404)
  const note = String(body.note || '').trim().slice(0, 500) || null
  const result = await db.prepare(`
    INSERT INTO loyalty_point_adjustments (customer_id, points, note, created_by_id, created_by_name)
    VALUES (@customerId, @points, @note, @actorId, @actorName)
  `).run({ customerId, points: Number(points.toFixed(2)), note, actorId: actor.id, actorName: actor.name })
  await audit(c.env, actor.id, actor.name, 'award_points', 'customer', customerId, {
    adjustmentId: result.lastInsertRowid,
    customerName: customer.name,
    membershipNumber: customer.membership_number,
    points: Number(points.toFixed(2)),
    note,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'customers', { action: 'award_points', id: customerId }))
  return c.json({ success: true, id: result.lastInsertRowid, customer_id: customerId, points: Number(points.toFixed(2)) }, 201)
})

// GET /api/customers/points-summary -- was a hardcoded `[]` stub. Exported
// from the frontend transport layer (contactsTransport.ts's
// getCustomerPointSummaries) but, checked directly, not currently called
// from any page -- CustomersTab.tsx and LoyaltyPointsPage.tsx both read
// points fields directly off GET /customers rows instead (now populated,
// see registerContactRoutes above). Implementing this for real anyway
// rather than leaving the stub, since a wrong-shaped `[]` is worse than
// an unused-but-correct endpoint: silent, and indistinguishable from "no
// customers have points yet" if something starts calling it later.
app.get('/customers/points-summary', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const search = String(query.search || query.q || '').trim().toLowerCase()

  const where: string[] = []
  const params: Record<string, unknown> = {}
  // Same FTS5 swap as registerContactRoutes above -- see lib/contactSearch.ts.
  // This endpoint is currently unreachable from the frontend (see the
  // comment above this handler), but kept correct rather than left on the
  // old LIKE scan now that customers_fts/customers_fts_phone exist anyway.
  const contactMatch = buildContactMatchClause('customers', search, 'search')
  if (contactMatch) {
    where.push(contactMatch.sql)
    Object.assign(params, contactMatch.params)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = clampInt(query.limit, 500, 1, 2000)

  const customers = await db.prepare(
    `SELECT id, name, phone, membership_number FROM customers ${whereSql} ORDER BY lower(name) ASC LIMIT @limit`,
  ).all<{ id: number; name: string; phone: string | null; membership_number: string | null }>({ ...params, limit })

  if (customers.length === 0) return c.json([])

  const pointsMap = await computeCustomerPointsMap(c.env, customers.map((cust) => cust.id))
  const payload = customers.map((cust) => {
    const points = pointsMap.get(cust.id)
    return {
      id: cust.id,
      name: cust.name,
      phone: cust.phone,
      membership_number: cust.membership_number,
      points_balance: points?.balance ?? 0,
      points_earned: points?.earned ?? 0,
      points_redeemed: points?.redeemed ?? 0,
      points_rewarded: points?.rewarded ?? 0,
      points_deducted: points?.deducted ?? 0,
      redeemable_units: points?.redeemableUnits ?? 0,
    }
  })

  return c.json(payload)
})

export default app
