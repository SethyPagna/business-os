import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { getPermissionTier, getActionTier } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { maybeQueueForReview } from '../lib/reviewGate'
import { businessToday } from '../lib/businessDateWindow'
import { sendTelegramEvent, telegramMoney } from '../lib/telegram'
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

// Labels are reusable tags (the /labels endpoint below feeds them back as
// suggestions), so a whole sentence typed into one poisons the suggestion
// list forever. Cap: 6 whitespace-separated words / 60 chars, enforced on
// BOTH ends (FeeForm clamps live; this guards imports and raw API calls).
// Khmer script has no spaces, so the word cap is effectively latin-only --
// the char cap is what bounds an unspaced Khmer sentence.
export const FEE_LABEL_MAX_WORDS = 6
export const FEE_LABEL_MAX_CHARS = 60

export function normalizeFeeLabel(value: unknown): string | null {
  const str = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!str) return null
  const words = str.split(' ').slice(0, FEE_LABEL_MAX_WORDS).join(' ')
  return words.length > FEE_LABEL_MAX_CHARS ? words.slice(0, FEE_LABEL_MAX_CHARS).trim() : words
}

function normalizeDate(value: unknown): string {
  const str = typeof value === 'string' ? value.trim() : ''
  // fee_date is a business CALENDAR date. Preserve an explicit YYYY-MM-DD
  // literally; do not round-trip it through UTC. If omitted/invalid, default
  // to Cambodia's current business day rather than the UTC day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  if (str) {
    const parsed = new Date(str)
    if (!Number.isNaN(parsed.getTime())) return businessToday(parsed.getTime())
  }
  return businessToday()
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
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) {
    return c.json({ error: 'startDate/endDate must use YYYY-MM-DD' }, 400)
  }
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  if (startDate) { clauses.push('f.fee_date >= @startDate'); params.startDate = startDate }
  if (endDate) { clauses.push('f.fee_date <= @endDate'); params.endDate = endDate }
  if (query.branchId) { clauses.push('f.branch_id = @branchId'); params.branchId = query.branchId }
  const where = clauses.length ? clauses.join(' AND ') : '1=1'
  // Sum BOTH currencies. Fees are recorded in EITHER USD or KHR (never both
  // on one row -- confirmed in data: 186 USD-only vs 4,054 KHR-only), so a
  // report that only summed amount_usd showed "$0.00" for a whole month of
  // real KHR-denominated fees (user report: "fees showing no rows even
  // though there are many fees"). No conversion is applied -- there is no
  // per-fee stored rate and the global one can be blank -- so both raw
  // totals are returned and the UI shows "$X · Y៛".
  const money = 'ROUND(COALESCE(SUM(amount_usd), 0), 2) AS amount_usd, ROUND(COALESCE(SUM(amount_khr), 0), 0) AS amount_khr'
  const [totals, days, byType, byCategory] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, ${money} FROM fees f WHERE ${where}`).get<Record<string, number>>(params),
    db.prepare(`SELECT f.fee_date AS date, COUNT(*) AS count, ${money} FROM fees f WHERE ${where} GROUP BY f.fee_date ORDER BY f.fee_date DESC`).all<Record<string, unknown>>(params),
    db.prepare(`SELECT f.fee_type AS fee_type, COUNT(*) AS count, ${money} FROM fees f WHERE ${where} GROUP BY f.fee_type ORDER BY amount_usd DESC, amount_khr DESC`).all<Record<string, unknown>>(params),
    db.prepare(`
      SELECT f.fee_type AS fee_type,
        COALESCE(NULLIF(MIN(TRIM(f.label)), ''), '') AS label,
        COUNT(*) AS count, ${money}
      FROM fees f
      WHERE ${where}
      GROUP BY f.fee_type, lower(trim(COALESCE(f.label, '')))
      ORDER BY amount_usd DESC, amount_khr DESC, label
    `).all<Record<string, unknown>>(params),
  ])
  return c.json({
    startDate,
    endDate,
    totals: { count: Number(totals?.count || 0), amount_usd: Number(totals?.amount_usd || 0), amount_khr: Number(totals?.amount_khr || 0) },
    days: (days || []).map((d) => ({ date: String(d.date || ''), count: Number(d.count || 0), amount_usd: Number(d.amount_usd || 0), amount_khr: Number(d.amount_khr || 0) })),
    by_type: (byType || []).map((r) => ({ fee_type: String(r.fee_type || ''), count: Number(r.count || 0), amount_usd: Number(r.amount_usd || 0), amount_khr: Number(r.amount_khr || 0) })),
    by_category: (byCategory || []).map((r) => ({ label: String(r.label || ''), fee_type: String(r.fee_type || ''), count: Number(r.count || 0), amount_usd: Number(r.amount_usd || 0), amount_khr: Number(r.amount_khr || 0) })),
  })
})

// GET /api/fees/labels -- every distinct saved label with its usage count
// and dominant fee type, most-used first. Feeds FeeForm's label suggestions
// so a recurring expense ("Grab", "ទឹកភ្លើង") is picked, not retyped -- and
// the dominant type lets the form auto-select the right fee type when a
// known label is chosen (six real rows were saved as 'expense' while
// carrying delivery-company labels before this existed). Registered before
// /:id so 'labels' is not eaten by the id param route.
app.get('/labels', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare(`
    SELECT MIN(TRIM(f.label)) AS label, f.fee_type AS fee_type, COUNT(*) AS uses
    FROM fees f
    WHERE f.label IS NOT NULL AND TRIM(f.label) <> ''
    GROUP BY lower(trim(f.label)), f.fee_type
    ORDER BY lower(trim(f.label)), uses DESC, f.fee_type
  `).all<{ label: string; uses: number; fee_type: string }>()
  const catalog = new Map<string, { label: string; uses: number; type_counts: Array<{ fee_type: FeeType; uses: number }> }>()
  for (const row of rows || []) {
    const label = String(row.label || '').trim()
    if (!label) continue
    const key = label.toLowerCase()
    const entry = catalog.get(key) || { label, uses: 0, type_counts: [] }
    const uses = Number(row.uses) || 0
    entry.uses += uses
    entry.type_counts.push({ fee_type: normalizeFeeType(row.fee_type), uses })
    catalog.set(key, entry)
  }
  return c.json({
    labels: [...catalog.values()]
      .map((entry) => ({
        ...entry,
        fee_type: [...entry.type_counts].sort((a, b) => b.uses - a.uses || a.fee_type.localeCompare(b.fee_type))[0]?.fee_type || 'other',
      }))
      .sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label)),
  })
})

app.get('/labels/impact', async (c) => {
  const from = normalizeFeeLabel(c.req.query('from'))
  const to = normalizeFeeLabel(c.req.query('to'))
  if (!from || !to) return c.json({ error: 'Source and target labels are required' }, 400)
  const db = getDb(c.env)
  const rows = Number((await db.prepare("SELECT COUNT(*) AS n FROM fees WHERE lower(trim(COALESCE(label,''))) = @from").get<{ n: number }>({ from: from.toLowerCase() }))?.n || 0)
  const target = Number((await db.prepare("SELECT COUNT(*) AS n FROM fees WHERE lower(trim(COALESCE(label,''))) = @to").get<{ n: number }>({ to: to.toLowerCase() }))?.n || 0)
  const typeCounts = await db.prepare(`
    SELECT fee_type, COUNT(*) AS uses FROM fees
    WHERE lower(trim(COALESCE(label,''))) = @from
    GROUP BY fee_type ORDER BY uses DESC, fee_type
  `).all<{ fee_type: string; uses: number }>({ from: from.toLowerCase() })
  return c.json({ from, to, linked_records: rows, target_exists: target > 0, type_counts: (typeCounts || []).map((row) => ({ fee_type: normalizeFeeType(row.fee_type), uses: Number(row.uses) || 0 })), live_snapshots: { fees: rows }, historical_snapshots_preserved: ['audit_logs', 'action history payloads'] })
})

app.post('/labels/replace', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'fees', 'edit') === 'none') return c.json({ error: 'No permission' }, 403)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const from = normalizeFeeLabel(body.from)
  const to = normalizeFeeLabel(body.to)
  if (!from || !to) return c.json({ error: 'Source and target labels are required' }, 400)
  const result = await getDb(c.env).prepare(`
    UPDATE fees SET label = @to, updated_at = CURRENT_TIMESTAMP
    WHERE lower(trim(COALESCE(label,''))) = @from
  `).run({ from: from.toLowerCase(), to })
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'replace', 'fee_label', null, { from, to, changed: result.changes })
  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'label_replace', from, to }))
  return c.json({ success: true, changed: result.changes })
})

// Reclassify one exact saved label through the same catalog that feeds the
// Expense form and label manager. This deliberately does not contain a
// hardcoded carrier list: Grab, J&T, Capital Express, Virak Buntam and every
// evidenced spelling remain source labels. Operators can preview and assign
// any one of them to Delivery (or another existing expense type) here, and
// every live exact match follows while audit/action history stays immutable.
app.get('/labels/type-impact', async (c) => {
  const label = normalizeFeeLabel(c.req.query('label'))
  if (!label) return c.json({ error: 'Label is required' }, 400)
  const rows = await getDb(c.env).prepare(`
    SELECT fee_type, COUNT(*) AS uses FROM fees
    WHERE lower(trim(COALESCE(label,''))) = @label
    GROUP BY fee_type ORDER BY uses DESC, fee_type
  `).all<{ fee_type: string; uses: number }>({ label: label.toLowerCase() })
  const typeCounts = (rows || []).map((row) => ({ fee_type: normalizeFeeType(row.fee_type), uses: Number(row.uses) || 0 }))
  return c.json({ label, linked_records: typeCounts.reduce((sum, row) => sum + row.uses, 0), type_counts: typeCounts, historical_snapshots_preserved: ['audit_logs', 'action history payloads'] })
})

app.post('/labels/classify', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'fees', 'edit') === 'none') return c.json({ error: 'No permission' }, 403)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const label = normalizeFeeLabel(body.label)
  const requestedType = String(body.fee_type ?? body.feeType ?? '').trim().toLowerCase()
  if (!label) return c.json({ error: 'Label is required' }, 400)
  if (!FEE_TYPES.includes(requestedType)) return c.json({ error: 'Invalid expense type' }, 400)
  const feeType = requestedType as FeeType
  const result = await getDb(c.env).prepare(`
    UPDATE fees SET fee_type = @feeType, updated_at = CURRENT_TIMESTAMP
    WHERE lower(trim(COALESCE(label,''))) = @label AND fee_type <> @feeType
  `).run({ label: label.toLowerCase(), feeType })
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'classify', 'fee_label', null, { label, fee_type: feeType, changed: result.changes })
  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'label_classify', label, fee_type: feeType }))
  return c.json({ success: true, changed: result.changes, label, fee_type: feeType })
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
  // Per-action override (Part 546): an admin can switch 'fees:add' off for
  // a role that otherwise has the fees grant -- getActionTier folds that
  // narrowing into the ordinary tier answer.
  if (getActionTier(user, 'fees', 'add') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const db = getDb(c.env)
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))

  const feeType = normalizeFeeType(body.fee_type ?? body.feeType)
  const label = normalizeFeeLabel(body.label)
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
  c.executionCtx.waitUntil(sendTelegramEvent(c.env, {
    type: 'fees',
    lines: [
      `Type: ${feeType}`,
      `Amount: ${telegramMoney(amountUsd, amountKhr)}`,
      `Date: ${feeDate}`,
      label ? `Label: ${label}` : '',
      notes ? `Note: ${notes}` : '',
    ],
  }).catch((error) => console.error('[telegram] fee notification failed', error)))
  return c.json({ fee }, 201)
})

// PUT /api/fees/:id -- edit, with the same optimistic-concurrency pattern
// every other editable record in this app uses.
app.put('/:id', async (c) => {
  const user = c.get('user')
  // Per-action override (Part 546) -- see POST / above.
  if (getActionTier(user, 'fees', 'edit') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
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
  const label = body.label !== undefined ? normalizeFeeLabel(body.label) : existing.label
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
  // Per-action override (Part 546) -- checked before the review-queue
  // branch below, so 'fees:delete' switched off blocks BOTH the direct
  // delete and the queue path.
  if (getActionTier(user, 'fees', 'delete') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
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
