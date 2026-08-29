import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { getPermissionTier } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { maybeQueueForReview } from '../lib/reviewGate'
import type { Env } from '../index'

// Standalone Fees page (migrations/0018_fees.sql) -- manual-entry fee
// records (tax, delivery, change, other) that can optionally be matched to
// an existing sale but survive independently of it. This is distinct from
// Inventory.tsx's read-only "Fees collected" stat card, which only ever
// summed tax + delivery off completed sales and had no individually
// editable record -- see progress.md for the full rationale.
//
// Gated behind a dedicated `fees` permission key rather than reusing
// `sales`/`inventory` -- fee records are money-bearing and edited/deleted
// independently of both those areas, so they get their own grant. Nobody
// has this permission by default until an admin explicitly grants it
// (Roles page), same as every other permission key in this app -- it does
// NOT silently fall back to any other permission.

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', async (c, next) => {
  const user = c.get('user')
  // Tier-aware, not the plain hasPermission() boolean check: 'fees' is a
  // REVIEW_TIER_KEYS section (permissions.ts), and a Review Required user
  // must reach every route below -- everything except delete is allowed
  // directly under that tier (see the DELETE handler below for the one
  // exception). Only 'none' 403s here; 'full' and 'review' both pass.
  if (getPermissionTier(user, 'fees') === 'none') return c.json({ error: 'Forbidden' }, 403)
  await next()
})

// 'expense' joined with the old-system expense migration (Part 379): 4,240
// historical entries carry it, and manual entry offers it. Without it here,
// normalizeFeeType would silently rewrite a saved 'expense' back to 'other'.
export const FEE_TYPES = Object.freeze(['tax', 'delivery', 'change', 'expense', 'other'])
type FeeType = (typeof FEE_TYPES)[number]

type FeeRow = {
  id: number
  fee_type: FeeType
  label: string | null
  amount_usd: number
  amount_khr: number
  fee_date: string
  sale_id: number | null
  branch_id: number | null
  branch_name?: string | null
  notes: string | null
  created_by: number | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeFeeType(value: unknown): FeeType {
  const normalized = String(value || '').trim().toLowerCase()
  return FEE_TYPES.includes(normalized) ? (normalized as FeeType) : 'other'
}

function normalizeText(value: unknown, maxLength = 500): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  if (!str) return null
  return str.length > maxLength ? str.slice(0, maxLength) : str
}

function normalizeDate(value: unknown): string {
  const str = typeof value === 'string' ? value.trim() : ''
  const parsed = str ? new Date(str) : new Date()
  const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  return safe.toISOString().slice(0, 10)
}

// GET /api/fees -- list, newest fee_date first, with optional filters.
// Search matches label/notes/fee_type, same "one field, several columns"
// pattern sales.ts's list endpoint already uses rather than a bespoke
// per-page search implementation.
app.get('/', async (c) => {
  const db = getDb(c.env)
  const { search, fee_type: feeType, from, to, sale_id: saleId, branch_id: branchId, limit: limitParam, offset: offsetParam } = c.req.query()

  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (search && search.trim()) {
    conditions.push('(f.label LIKE @search OR f.notes LIKE @search OR f.fee_type LIKE @search)')
    params.search = `%${search.trim()}%`
  }
  if (feeType && feeType.trim() && feeType !== 'all') {
    conditions.push('f.fee_type = @feeType')
    params.feeType = normalizeFeeType(feeType)
  }
  if (from && from.trim()) {
    conditions.push('f.fee_date >= @from')
    params.from = from.trim()
  }
  if (to && to.trim()) {
    conditions.push('f.fee_date <= @to')
    params.to = to.trim()
  }
  if (saleId && saleId.trim()) {
    conditions.push('f.sale_id = @saleId')
    params.saleId = Number(saleId)
  }
  if (branchId && branchId.trim()) {
    // branch_id is nullable on the row itself (a fee doesn't have to be
    // tied to a branch) -- this filter only ever narrows to a SPECIFIC
    // branch when asked, same as sale_id above; there's no "unassigned"
    // variant requested anywhere else in this file's filter set, so none
    // is added here either.
    conditions.push('f.branch_id = @branchId')
    params.branchId = Number(branchId)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(Math.max(toNumber(limitParam, 100), 1), 500)
  const offset = Math.max(toNumber(offsetParam, 0), 0)

  const rows = await db.prepare(`
    SELECT f.*, s.receipt_number AS sale_receipt_number, b.name AS branch_name
    FROM fees f
    LEFT JOIN sales s ON s.id = f.sale_id
    LEFT JOIN branches b ON b.id = f.branch_id
    ${where}
    ORDER BY f.fee_date DESC, f.id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset })

  const totalRow = await db.prepare(`SELECT COUNT(*) as count FROM fees f ${where}`).get<{ count: number }>(params)

  const summaryRows = await db.prepare(`
    SELECT fee_type, COUNT(*) as count, COALESCE(SUM(amount_usd), 0) as total_usd, COALESCE(SUM(amount_khr), 0) as total_khr
    FROM fees f
    ${where}
    GROUP BY fee_type
  `).all(params)

  return c.json({
    fees: rows || [],
    total: totalRow?.count || 0,
    limit,
    offset,
    summary: summaryRows || [],
  })
})

// GET /api/fees/report?startDate&endDate&branchId -- fee totals over a range
// for the Reports hub: range totals, a per-day series (keyed on fee_date, the
// effective date the fee is booked to, not created_at), and a per-fee-type
// breakdown. Registered before /:id so 'report' is not eaten by the id param
// route. Auto-gated by the fees-permission middleware above.
app.get('/report', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const startDate = String(query.startDate || '').slice(0, 10)
  const endDate = String(query.endDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return c.json({ error: 'startDate and endDate (YYYY-MM-DD) are required' }, 400)
  }
  const clauses = ['f.fee_date BETWEEN @startDate AND @endDate']
  const params: Record<string, unknown> = { startDate, endDate }
  if (query.branchId) { clauses.push('f.branch_id = @branchId'); params.branchId = query.branchId }
  const where = clauses.join(' AND ')
  const [totals, days, byType] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, ROUND(COALESCE(SUM(amount_usd), 0), 2) AS amount_usd FROM fees f WHERE ${where}`).get<Record<string, number>>(params),
    db.prepare(`SELECT f.fee_date AS date, COUNT(*) AS count, ROUND(COALESCE(SUM(amount_usd), 0), 2) AS amount_usd FROM fees f WHERE ${where} GROUP BY f.fee_date ORDER BY f.fee_date DESC`).all<Record<string, unknown>>(params),
    db.prepare(`SELECT f.fee_type AS fee_type, COUNT(*) AS count, ROUND(COALESCE(SUM(amount_usd), 0), 2) AS amount_usd FROM fees f WHERE ${where} GROUP BY f.fee_type ORDER BY amount_usd DESC`).all<Record<string, unknown>>(params),
  ])
  return c.json({
    startDate,
    endDate,
    totals: { count: Number(totals?.count || 0), amount_usd: Number(totals?.amount_usd || 0) },
    days: (days || []).map((d) => ({ date: String(d.date || ''), count: Number(d.count || 0), amount_usd: Number(d.amount_usd || 0) })),
    by_type: (byType || []).map((r) => ({ fee_type: String(r.fee_type || ''), count: Number(r.count || 0), amount_usd: Number(r.amount_usd || 0) })),
  })
})

// GET /api/fees/:id
app.get('/:id', async (c) => {
  const db = getDb(c.env)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid fee id' }, 400)
  const fee = await db.prepare(`
    SELECT f.*, s.receipt_number AS sale_receipt_number, b.name AS branch_name
    FROM fees f
    LEFT JOIN sales s ON s.id = f.sale_id
    LEFT JOIN branches b ON b.id = f.branch_id
    WHERE f.id = @id
  `).get<FeeRow>({ id })
  if (!fee) return c.json({ error: 'Fee not found' }, 404)
  return c.json({ fee })
})

// POST /api/fees -- create a fee record.
app.post('/', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))

  const feeType = normalizeFeeType(body.fee_type ?? body.feeType)
  const label = normalizeText(body.label, 200)
  const amountUsd = round2(Math.max(toNumber(body.amount_usd ?? body.amountUsd), 0))
  const amountKhr = round2(Math.max(toNumber(body.amount_khr ?? body.amountKhr), 0))
  const feeDate = normalizeDate(body.fee_date ?? body.feeDate)
  const saleId = body.sale_id != null && body.sale_id !== '' ? Number(body.sale_id) : null
  const branchId = body.branch_id != null && body.branch_id !== '' ? Number(body.branch_id) : null
  const notes = normalizeText(body.notes, 2000)
  const now = new Date().toISOString()

  const result = await db.prepare(`
    INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, sale_id, branch_id, notes, created_by, created_by_name, created_at, updated_at)
    VALUES (@feeType, @label, @amountUsd, @amountKhr, @feeDate, @saleId, @branchId, @notes, @createdBy, @createdByName, @now, @now)
  `).run({
    feeType, label, amountUsd, amountKhr, feeDate,
    saleId: Number.isFinite(saleId as number) ? saleId : null,
    branchId: Number.isFinite(branchId as number) ? branchId : null,
    notes, createdBy: user.id, createdByName: user.username || null, now,
  })

  const fee = await db.prepare(`SELECT * FROM fees WHERE id = @id`).get<FeeRow>({ id: result.lastInsertRowid })
  await audit(c.env, user.id, user.username || null, 'create', 'fee', result.lastInsertRowid, { fee_type: feeType, amount_usd: amountUsd, amount_khr: amountKhr })
  await broadcast(c.env, 'fees', { type: 'created', id: result.lastInsertRowid })
  return c.json({ fee }, 201)
})

// PUT /api/fees/:id -- edit, with the same optimistic-concurrency pattern
// every other editable record in this app uses.
app.put('/:id', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid fee id' }, 400)
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))

  const existing = await db.prepare(`SELECT * FROM fees WHERE id = @id`).get<FeeRow>({ id })
  if (!existing) return c.json({ error: 'Fee not found' }, 404)

  try {
    assertUpdatedAtMatch('fee', existing, getExpectedUpdatedAt(body))
  } catch (err) {
    if (err instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(err)
      return c.json(conflictBody, status)
    }
    throw err
  }

  const feeType = body.fee_type !== undefined || body.feeType !== undefined ? normalizeFeeType(body.fee_type ?? body.feeType) : existing.fee_type
  const label = body.label !== undefined ? normalizeText(body.label, 200) : existing.label
  const amountUsd = body.amount_usd !== undefined || body.amountUsd !== undefined ? round2(Math.max(toNumber(body.amount_usd ?? body.amountUsd), 0)) : existing.amount_usd
  const amountKhr = body.amount_khr !== undefined || body.amountKhr !== undefined ? round2(Math.max(toNumber(body.amount_khr ?? body.amountKhr), 0)) : existing.amount_khr
  const feeDate = body.fee_date !== undefined || body.feeDate !== undefined ? normalizeDate(body.fee_date ?? body.feeDate) : existing.fee_date
  const saleId = body.sale_id !== undefined ? (body.sale_id === null || body.sale_id === '' ? null : Number(body.sale_id)) : existing.sale_id
  const branchId = body.branch_id !== undefined ? (body.branch_id === null || body.branch_id === '' ? null : Number(body.branch_id)) : existing.branch_id
  const notes = body.notes !== undefined ? normalizeText(body.notes, 2000) : existing.notes
  const now = new Date().toISOString()

  await db.prepare(`
    UPDATE fees SET fee_type = @feeType, label = @label, amount_usd = @amountUsd, amount_khr = @amountKhr,
      fee_date = @feeDate, sale_id = @saleId, branch_id = @branchId, notes = @notes, updated_at = @now
    WHERE id = @id
  `).run({ feeType, label, amountUsd, amountKhr, feeDate, saleId, branchId, notes, now, id })

  const fee = await db.prepare(`SELECT * FROM fees WHERE id = @id`).get<FeeRow>({ id })
  await audit(c.env, user.id, user.username || null, 'update', 'fee', id, { fee_type: feeType, amount_usd: amountUsd, amount_khr: amountKhr })
  await broadcast(c.env, 'fees', { type: 'updated', id })
  return c.json({ fee })
})

// DELETE /api/fees/:id
// Per progress.md's Fees tier spec ("Full / Review Required -- everything
// allowed directly except delete, which needs admin review"), this is the
// ONLY fees write route gated through the review queue -- POST/PUT above
// stay direct-write regardless of tier, matching that spec exactly.
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid fee id' }, 400)
  const existing = await db.prepare(`SELECT id FROM fees WHERE id = @id`).get<{ id: number }>({ id })
  if (!existing) return c.json({ error: 'Fee not found' }, 404)

  const pendingId = await maybeQueueForReview(c.env, user, 'fees', {
    actionType: 'delete',
    entityType: 'fee',
    entityId: id,
    payload: { id },
    summary: `Delete fee #${id}`,
  })
  if (pendingId != null) {
    return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)
  }

  await db.prepare(`DELETE FROM fees WHERE id = @id`).run({ id })
  await audit(c.env, user.id, user.username || null, 'delete', 'fee', id, null)
  await broadcast(c.env, 'fees', { type: 'deleted', id })
  return c.json({ success: true })
})

export default app
