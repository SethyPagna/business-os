import { Hono, type Context } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { buildAuditStatement, currentRequestDevice } from '../lib/audit'
import { getActionTier } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersions } from '../lib/cache'
import { canViewCourierCost } from '../lib/courierCostAccess'
import { whereActiveSales, type SalesFilters } from '../lib/salesAnalytics'
import { courierPayoutExpressions } from '../lib/shiftReconciliation'
import { localDateExpr } from '../lib/businessDateWindow'
import { actorSnapshot } from '../lib/actorSnapshot'
import { decodeFeeCursor, encodeFeeCursor, expenseReadsOn, type FeeExportCursor } from '../lib/expenseReads'
import { getPlanLimits } from '../lib/planTier'
import {
  FEE_TYPES,
  collapseFeeName,
  feeNameKey,
  feeNameKeySql,
  feeRangePredicate,
  feesAccess,
  normalizeFeeLabel,
  normalizeFeeTypeName,
  queryFeeList,
  resolveFeeType,
  resolveFeeTypeFilter,
  type FeeListPage,
} from './fees'
import type { Env } from '../index'

// The Expenses page's second half (6.0.1053): the label and type catalogs an operator can add to, rename and archive, and the
// list that also shows the courier cost recorded on sales. Mounted before routes/fees.ts at /api/fees; a request this file does
// not own falls through to that file untouched (requireAuth skips a request that is already authenticated).
//
// Expenses keep storing the type and label as TEXT. The catalogs (migration 0292) supply the choices and the archive state; a
// rename rewrites the exact matching expenses and writes one audit row per expense, in the same commit as the catalog change.
// Nothing here deletes a label, a type or an expense: the strongest act is an archive, which only hides the name from pickers.

type Ctx = Context<{ Bindings: Env; Variables: { user: SessionUser } }>
type Db = ReturnType<typeof getDb>
type Statement = { sql: string; params: Record<string, unknown> }

// The same key as feeNameKey(), computed in SQL: a stored label and a typed one meet on it (fees.ts explains why lower(trim()) is not enough).
const LABEL_KEY_SQL = feeNameKeySql('label')
const LABEL_KEY_SQL_F = feeNameKeySql('f.label')
const NO_PERMISSION = { error: 'You do not have permission to perform this action' } as const

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', feesAccess)

const fail = (c: Ctx, status: 400 | 404 | 409, code: string, error: string) => c.json({ error, code }, status)
const canManage = (user: SessionUser): boolean => getActionTier(user, 'fees', 'edit') !== 'none'
const flag = (value: string | undefined): boolean => value === '1' || value === 'true'

async function readBody(c: Ctx): Promise<Record<string, unknown>> {
  return c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalog reads. A missing table (the migration not applied yet) reads as an empty catalog, so this Worker still serves the
// five built-in types and the labels found on expenses.
// ---------------------------------------------------------------------------------------------------------------------
type TypeCatalogRow = { id: number; name: string; name_key: string; archived_at: string | null }
type LabelCatalogRow = { id: number; name: string; name_key: string; fee_type: string | null; archived_at: string | null }

async function typeCatalog(db: Db): Promise<TypeCatalogRow[]> {
  try {
    return (await db.prepare('SELECT id, name, name_key, archived_at FROM fee_types ORDER BY id').all<TypeCatalogRow>()) || []
  } catch {
    return []
  }
}

async function catalogTypeByKey(db: Db, key: string): Promise<TypeCatalogRow | null> {
  try {
    return (await db.prepare('SELECT id, name, name_key, archived_at FROM fee_types WHERE name_key = @key').get<TypeCatalogRow>({ key })) ?? null
  } catch {
    return null
  }
}

async function catalogLabelByKey(db: Db, key: string): Promise<LabelCatalogRow | null> {
  try {
    return (await db.prepare('SELECT id, name, name_key, fee_type, archived_at FROM fee_labels WHERE name_key = @key').get<LabelCatalogRow>({ key })) ?? null
  } catch {
    return null
  }
}

const countRows = async (db: Db, sql: string, params: Record<string, unknown>): Promise<number> =>
  Number((await db.prepare(sql).get<{ n: number }>(params))?.n || 0)

/** The spelling the expenses of a label already use (the most common one, whitespace collapsed), or null when none carries it. */
async function rowsSpelling(db: Db, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT TRIM(label) AS label FROM fees WHERE ${LABEL_KEY_SQL} = @key
    GROUP BY TRIM(label) ORDER BY COUNT(*) DESC, TRIM(label) LIMIT 1`).get<{ label: string }>({ key })
  const spelling = collapseFeeName(row?.label || '')
  return spelling || null
}

const labelRowCount = (db: Db, key: string) =>
  countRows(db, `SELECT COUNT(*) AS n FROM fees WHERE ${LABEL_KEY_SQL} = @key`, { key })

// ---------------------------------------------------------------------------------------------------------------------
// Statements that ride in the same batch as the change they record.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One audit row per expense about to change, written BEFORE the update so it holds the old value. It is the same
 * (entity 'fee', action 'update') row an edit of the expense writes, so the expense's own Records shows the rename.
 */
function feeRowsAuditStatement(user: SessionUser, field: 'label' | 'fee_type', via: string, to: string, where: string, whereParams: Record<string, unknown>): Statement {
  // The device is the one that sent THIS request, exactly as buildAuditStatement does; only an act outside a request falls back to the freshest session.
  const device = currentRequestDevice()
  return {
    sql: `
      INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value, device_name, device_tz)
      SELECT
        @a_user_id,
        COALESCE(NULLIF(TRIM(u.username), ''), NULLIF(TRIM(@a_user_name), '')),
        'update', 'fee', f.id,
        json_object('via', @a_via, 'before', json_object('${field}', f.${field}), 'after', json_object('${field}', @a_to)),
        'fee', f.id,
        json_object('${field}', f.${field}), json_object('${field}', @a_to),
        CASE WHEN @a_request_user_id IS NOT NULL AND @a_request_user_id = @a_user_id THEN @a_request_device_name ELSE s.device_name END,
        CASE WHEN @a_request_user_id IS NOT NULL AND @a_request_user_id = @a_user_id THEN @a_request_device_tz ELSE s.device_tz END
      FROM fees f
      LEFT JOIN users u ON u.id = @a_user_id
      LEFT JOIN (
        SELECT device_name, device_tz FROM user_sessions
        WHERE user_id = @a_user_id AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, id DESC LIMIT 1
      ) AS s ON 1 = 1
      WHERE ${where}`,
    params: {
      ...whereParams, a_user_id: user.id, a_user_name: actorSnapshot(user), a_via: via, a_to: to,
      a_request_user_id: device ? device.userId : null, a_request_device_name: device ? device.deviceName : null, a_request_device_tz: device ? device.deviceTz : null,
    },
  }
}

/**
 * buildAuditStatement's option for the audit row of an act on a label: the entity id is looked up by key inside the batch of the act. An act
 * on a label only expenses knew registers it first (ensureLabelStatement), so the id is not known before the batch runs.
 */
const labelEntityIn = (key: string) => ({
  entityIdSubquery: { sql: '(SELECT id FROM fee_labels WHERE name_key = @audit_label_key)', params: { audit_label_key: key } },
})

/** Registers a label found only on expenses, so it can carry an archive flag or a default type. Does nothing when it is already registered. */
const ensureLabelStatement = (user: SessionUser, name: string, key: string, feeType: string | null, now: string): Statement => ({
  sql: `INSERT OR IGNORE INTO fee_labels (name, name_key, fee_type, created_by, created_by_name, created_at, updated_at)
        VALUES (@name, @key, @feeType, @by, @byName, @now, @now)`,
  params: { name, key, feeType, by: user.id, byName: actorSnapshot(user), now },
})

const isUniqueViolation = (error: unknown): boolean => /UNIQUE|constraint/i.test(String((error as Error)?.message || ''))

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------
type TypeEntry = { value: string; name: string; builtin: boolean; id: number | null; registered: boolean; archived: boolean; uses?: number }

/** GET /api/fees/types -- the five built-in types, then the custom ones. `?uses=1` adds expense counts (and lists legacy unregistered types); `?include_archived=1` keeps the archived. */
app.get('/types', async (c) => {
  const db = getDb(c.env)
  const withUses = flag(c.req.query('uses'))
  const includeArchived = flag(c.req.query('include_archived'))
  const [custom, usage] = await Promise.all([
    typeCatalog(db),
    withUses
      ? db.prepare('SELECT fee_type, COUNT(*) AS uses FROM fees GROUP BY fee_type').all<{ fee_type: string; uses: number }>()
      : Promise.resolve(null),
  ])
  const uses = new Map<string, number>()
  for (const row of usage || []) uses.set(String(row.fee_type ?? ''), Number(row.uses) || 0)
  const entries: TypeEntry[] = FEE_TYPES.map((value) => ({
    value, name: value, builtin: true, id: null, registered: true, archived: false, ...(withUses ? { uses: uses.get(value) ?? 0 } : {}),
  }))
  const known = new Set<string>(FEE_TYPES)
  for (const row of custom) {
    known.add(row.name_key)
    if (row.archived_at && !includeArchived) continue
    entries.push({ value: row.name, name: row.name, builtin: false, id: row.id, registered: true, archived: Boolean(row.archived_at), ...(withUses ? { uses: uses.get(row.name) ?? 0 } : {}) })
  }
  if (withUses) {
    for (const [value, count] of uses) {
      const text = String(value || '').trim()
      if (!text || known.has(feeNameKey(text))) continue
      known.add(feeNameKey(text))
      entries.push({ value: text, name: text, builtin: false, id: null, registered: false, archived: false, uses: count })
    }
  }
  return c.json({ types: entries })
})

app.get('/types/impact', async (c) => {
  const name = normalizeFeeTypeName(c.req.query('name'))
  if (!name) return fail(c, 400, 'type_name_invalid', 'A type name is required')
  const row = await catalogTypeByKey(getDb(c.env), feeNameKey(name))
  const linked = await countRows(getDb(c.env), 'SELECT COUNT(*) AS n FROM fees WHERE fee_type = @name', { name: row?.name ?? name })
  return c.json({ name: row?.name ?? name, linked_records: linked, registered: Boolean(row), archived: Boolean(row?.archived_at), historical_snapshots_preserved: ['audit_logs', 'action history payloads'] })
})

app.post('/types', async (c) => {
  const user = c.get('user')
  if (!canManage(user)) return c.json(NO_PERMISSION, 403)
  const db = getDb(c.env)
  const body = await readBody(c)
  const name = normalizeFeeTypeName(body.name)
  if (!name) return fail(c, 400, 'type_name_invalid', `A type name is 1 to 40 characters.`)
  const key = feeNameKey(name)
  if ((FEE_TYPES as readonly string[]).includes(key)) return fail(c, 409, 'type_exists', 'That is a built-in expense type.')
  const existing = await catalogTypeByKey(db, key)
  if (existing) return fail(c, 409, existing.archived_at ? 'type_archived' : 'type_exists', existing.archived_at ? 'That type is archived. Restore it instead.' : 'That type already exists.')
  const now = new Date().toISOString()
  try {
    await db.batch([
      {
        sql: `INSERT INTO fee_types (name, name_key, created_by, created_by_name, created_at, updated_at) VALUES (@name, @key, @by, @byName, @now, @now)`,
        params: { name, key, by: user.id, byName: actorSnapshot(user), now },
      },
      buildAuditStatement(user.id, user.username || null, 'create', 'fee_type', null, { name }, undefined, { entityIdFromLastInsert: true }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) return fail(c, 409, 'type_exists', 'That type already exists.')
    throw error
  }
  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'type_create', name }))
  return c.json({ success: true, name }, 201)
})

app.post('/types/rename', async (c) => {
  const user = c.get('user')
  if (!canManage(user)) return c.json(NO_PERMISSION, 403)
  const db = getDb(c.env)
  const body = await readBody(c)
  const fromText = typeof body.from === 'string' ? body.from.trim() : ''
  const to = normalizeFeeTypeName(body.to)
  if (!fromText || !to) return fail(c, 400, 'type_name_invalid', 'Source and target type names are required')
  const fromKey = feeNameKey(fromText)
  if ((FEE_TYPES as readonly string[]).includes(fromKey)) return fail(c, 400, 'type_builtin', 'Built-in expense types cannot be renamed.')
  const source = await catalogTypeByKey(db, fromKey)
  if (!source) return fail(c, 404, 'type_not_found', 'That type is not in the catalog. Add it first.')
  const toKey = feeNameKey(to)
  if ((FEE_TYPES as readonly string[]).includes(toKey)) return fail(c, 409, 'type_exists', 'That is a built-in expense type.')
  if (to === source.name) return c.json({ success: true, changed: 0, name: to })
  if (toKey !== fromKey) {
    const clash = await catalogTypeByKey(db, toKey)
    if (clash) return fail(c, 409, 'type_exists', 'That type already exists.')
    if (await countRows(db, `SELECT COUNT(*) AS n FROM fees WHERE ${feeNameKeySql('fee_type')} = @key`, { key: toKey }) > 0) {
      return fail(c, 409, 'type_exists', 'Expenses already use that name. Add it as a type first.')
    }
  }
  const linked = await countRows(db, 'SELECT COUNT(*) AS n FROM fees WHERE fee_type = @from', { from: source.name })
  const now = new Date().toISOString()
  try {
    await db.batch([
      feeRowsAuditStatement(user, 'fee_type', 'type_rename', to, 'f.fee_type = @from', { from: source.name }),
      { sql: 'UPDATE fees SET fee_type = @to, updated_at = @now WHERE fee_type = @from', params: { to, from: source.name, now } },
      { sql: 'UPDATE fee_labels SET fee_type = @to, updated_at = @now WHERE fee_type = @from', params: { to, from: source.name, now } },
      { sql: 'UPDATE fee_types SET name = @to, name_key = @toKey, updated_at = @now WHERE id = @id', params: { to, toKey, now, id: source.id } },
      buildAuditStatement(user.id, user.username || null, 'rename', 'fee_type', source.id, { from: source.name, to, changed: linked }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) return fail(c, 409, 'type_exists', 'That type already exists.')
    throw error
  }
  // Moves fee rows the sales report snapshot reads: bump sales (awaited) before the broadcast. Skipped when no row changed.
  if (linked > 0) await bumpVersions(c.env, ['sales'])
  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'type_rename', from: source.name, to }))
  return c.json({ success: true, changed: linked, name: to })
})

for (const action of ['archive', 'restore'] as const) {
  app.post(`/types/${action}`, async (c) => {
    const user = c.get('user')
    if (!canManage(user)) return c.json(NO_PERMISSION, 403)
    const db = getDb(c.env)
    const body = await readBody(c)
    const text = typeof body.name === 'string' ? body.name.trim() : ''
    if (!text) return fail(c, 400, 'type_name_invalid', 'A type name is required')
    const key = feeNameKey(text)
    if ((FEE_TYPES as readonly string[]).includes(key)) return fail(c, 400, 'type_builtin', 'Built-in expense types cannot be archived.')
    const row = await catalogTypeByKey(db, key)
    if (!row) return fail(c, 404, 'type_not_found', 'That type is not in the catalog.')
    const archiving = action === 'archive'
    if (archiving === Boolean(row.archived_at)) return c.json({ success: true, name: row.name, archived: archiving, changed: 0 })
    const now = new Date().toISOString()
    await db.batch([
      { sql: 'UPDATE fee_types SET archived_at = @archivedAt, updated_at = @now WHERE id = @id', params: { archivedAt: archiving ? now : null, now, id: row.id } },
      buildAuditStatement(user.id, user.username || null, archiving ? 'archive' : 'restore', 'fee_type', row.id, { name: row.name, linked_records: await countRows(db, 'SELECT COUNT(*) AS n FROM fees WHERE fee_type = @name', { name: row.name }) }),
    ])
    c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: `type_${action}`, name: row.name }))
    return c.json({ success: true, name: row.name, archived: archiving, changed: 1 })
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------------------------------
type LabelEntry = {
  label: string
  uses: number
  fee_type: string
  type_counts: Array<{ fee_type: string; uses: number }>
  id: number | null
  registered: boolean
  archived: boolean
}

const LABELS_ON_EXPENSES_SQL = `
  SELECT MIN(TRIM(f.label)) AS label, f.fee_type AS fee_type, COUNT(*) AS uses
  FROM fees f
  WHERE f.label IS NOT NULL AND TRIM(f.label) <> ''
  GROUP BY ${LABEL_KEY_SQL_F}, f.fee_type
  ORDER BY ${LABEL_KEY_SQL_F}, uses DESC, f.fee_type
`
const LABEL_CATALOG_SQL = `
  SELECT l.id, l.name, l.name_key, l.fee_type, l.archived_at,
    (SELECT t.archived_at FROM fee_types t WHERE t.name = l.fee_type) AS type_archived_at
  FROM fee_labels l ORDER BY l.id
`

/** GET /api/fees/labels -- every label with its use count, most used first. A registered label with no expense is listed with 0 uses; archived ones only with `?include_archived=1`. */
app.get('/labels', async (c) => {
  const db = getDb(c.env)
  const includeArchived = flag(c.req.query('include_archived'))
  // The labels found on expenses and the registered ones (with the archive state of the type each defaults to) in ONE round trip.
  // Before migration 0292 the catalog statement fails with "no such table": the expenses' labels alone are the answer then.
  let rows: Array<{ label: string; uses: number; fee_type: string }>
  let registered: Array<LabelCatalogRow & { type_archived_at: string | null }> = []
  try {
    const [found, catalog] = await db.batch([
      { sql: LABELS_ON_EXPENSES_SQL, params: {} },
      { sql: LABEL_CATALOG_SQL, params: {} },
    ])
    rows = (found.results || []) as typeof rows
    registered = (catalog.results || []) as typeof registered
  } catch (error) {
    if (!/no such table/i.test(String((error as Error)?.message || ''))) throw error
    rows = (await db.prepare(LABELS_ON_EXPENSES_SQL).all<{ label: string; uses: number; fee_type: string }>()) || []
  }
  const catalog = new Map<string, LabelEntry>()
  for (const row of rows || []) {
    const label = collapseFeeName(String(row.label || ''))
    if (!label) continue
    const key = feeNameKey(label)
    const entry = catalog.get(key) || { label, uses: 0, fee_type: 'other', type_counts: [], id: null, registered: false, archived: false }
    const uses = Number(row.uses) || 0
    entry.uses += uses
    entry.type_counts.push({ fee_type: String(row.fee_type || 'other'), uses })
    catalog.set(key, entry)
  }
  for (const entry of catalog.values()) {
    entry.fee_type = [...entry.type_counts].sort((a, b) => b.uses - a.uses || a.fee_type.localeCompare(b.fee_type))[0]?.fee_type || 'other'
  }
  for (const row of registered) {
    const entry = catalog.get(row.name_key) || { label: row.name, uses: 0, fee_type: 'other', type_counts: [], id: null, registered: false, archived: false }
    entry.label = row.name
    entry.id = row.id
    entry.registered = true
    entry.archived = Boolean(row.archived_at)
    // A default type the operator chose wins over the dominant one, unless that type has since been archived.
    if (row.fee_type && !row.type_archived_at) entry.fee_type = row.fee_type
    catalog.set(row.name_key, entry)
  }
  return c.json({
    labels: [...catalog.values()]
      .filter((entry) => includeArchived || !entry.archived)
      .sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label)),
  })
})

app.get('/labels/impact', async (c) => {
  const from = normalizeFeeLabel(c.req.query('from'))
  const to = normalizeFeeLabel(c.req.query('to'))
  if (!from || !to) return c.json({ error: 'Source and target labels are required' }, 400)
  const db = getDb(c.env)
  const rows = await labelRowCount(db, feeNameKey(from))
  const target = await labelRowCount(db, feeNameKey(to))
  const targetRegistered = await catalogLabelByKey(db, feeNameKey(to))
  const typeCounts = await db.prepare(`
    SELECT fee_type, COUNT(*) AS uses FROM fees
    WHERE ${LABEL_KEY_SQL} = @from
    GROUP BY fee_type ORDER BY uses DESC, fee_type
  `).all<{ fee_type: string; uses: number }>({ from: feeNameKey(from) })
  return c.json({
    from, to, linked_records: rows, target_exists: target > 0 || Boolean(targetRegistered), target_archived: Boolean(targetRegistered?.archived_at),
    type_counts: (typeCounts || []).map((row) => ({ fee_type: String(row.fee_type || 'other'), uses: Number(row.uses) || 0 })),
    live_snapshots: { fees: rows }, historical_snapshots_preserved: ['audit_logs', 'action history payloads'],
  })
})

app.get('/labels/type-impact', async (c) => {
  const label = normalizeFeeLabel(c.req.query('label'))
  if (!label) return c.json({ error: 'Label is required' }, 400)
  const rows = await getDb(c.env).prepare(`
    SELECT fee_type, COUNT(*) AS uses FROM fees
    WHERE ${LABEL_KEY_SQL} = @label
    GROUP BY fee_type ORDER BY uses DESC, fee_type
  `).all<{ fee_type: string; uses: number }>({ label: feeNameKey(label) })
  const typeCounts = (rows || []).map((row) => ({ fee_type: String(row.fee_type || 'other'), uses: Number(row.uses) || 0 }))
  return c.json({ label, linked_records: typeCounts.reduce((sum, row) => sum + row.uses, 0), type_counts: typeCounts, historical_snapshots_preserved: ['audit_logs', 'action history payloads'] })
})

/** A typed label exactly as the operator wrote it, or a refusal: nothing is shortened silently. */
function typedLabel(value: unknown): { label: string } | { code: string; error: string } {
  const typed = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!typed) return { code: 'label_required', error: 'A label is required.' }
  const label = normalizeFeeLabel(typed)
  if (!label || label !== typed) return { code: 'label_too_long', error: 'A label is a short tag: up to 6 words and 60 characters.' }
  return { label }
}

const TYPE_NOT_CHOOSABLE = 'That expense type is archived or does not exist. Choose an active type from the list.'

/** An existing type chosen for a label or an expense: built-in or ACTIVE custom. The spelling to store, or null. */
async function chosenType(db: Db, value: unknown): Promise<string | null> {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  const resolved = await resolveFeeType(db, text)
  return resolved.ok ? resolved.type : null
}

app.post('/labels', async (c) => {
  const user = c.get('user')
  if (!canManage(user)) return c.json(NO_PERMISSION, 403)
  const db = getDb(c.env)
  const body = await readBody(c)
  const typed = typedLabel(body.label)
  if ('code' in typed) return fail(c, 400, typed.code, typed.error)
  const key = feeNameKey(typed.label)
  let feeType: string | null = null
  if (body.fee_type !== undefined && body.fee_type !== null && body.fee_type !== '') {
    feeType = await chosenType(db, body.fee_type)
    if (!feeType) return fail(c, 400, 'fee_type_invalid', TYPE_NOT_CHOOSABLE)
  }
  const existing = await catalogLabelByKey(db, key)
  if (existing) return fail(c, 409, existing.archived_at ? 'label_archived' : 'label_exists', existing.archived_at ? 'That label is archived. Restore it instead.' : 'That label already exists.')
  const now = new Date().toISOString()
  const used = await labelRowCount(db, key)
  try {
    await db.batch([
      {
        sql: `INSERT INTO fee_labels (name, name_key, fee_type, created_by, created_by_name, created_at, updated_at)
              VALUES (@name, @key, @feeType, @by, @byName, @now, @now)`,
        params: { name: typed.label, key, feeType, by: user.id, byName: actorSnapshot(user), now },
      },
      buildAuditStatement(user.id, user.username || null, 'create', 'fee_label', null, { label: typed.label, fee_type: feeType, already_on_expenses: used }, undefined, { entityIdFromLastInsert: true }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) return fail(c, 409, 'label_exists', 'That label already exists.')
    throw error
  }
  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'label_create', label: typed.label }))
  return c.json({ success: true, label: typed.label, fee_type: feeType, uses: used }, 201)
})

app.post('/labels/replace', async (c) => {
  const user = c.get('user')
  if (!canManage(user)) return c.json(NO_PERMISSION, 403)
  const db = getDb(c.env)
  const body = await readBody(c)
  const from = normalizeFeeLabel(body.from)
  if (!from || !normalizeFeeLabel(body.to)) return c.json({ error: 'Source and target labels are required' }, 400)
  const typed = typedLabel(body.to)
  if ('code' in typed) return fail(c, 400, typed.code, typed.error)
  const fromKey = feeNameKey(from)
  const toKey = feeNameKey(typed.label)
  const sameKey = toKey === fromKey
  const [sourceRow, targetRow, sourceUses, targetUses] = await Promise.all([
    catalogLabelByKey(db, fromKey),
    sameKey ? Promise.resolve(null) : catalogLabelByKey(db, toKey),
    labelRowCount(db, fromKey),
    sameKey ? Promise.resolve(0) : labelRowCount(db, toKey),
  ])
  if (!sourceRow && sourceUses === 0) return fail(c, 404, 'label_not_found', 'That label no longer exists.')
  if (targetRow?.archived_at) return fail(c, 409, 'label_archived', 'That label is archived. Restore it first.')
  // A target that already exists (registered, or used by any expense) makes this a merge into it, in the spelling it already has.
  const merge = !sameKey && Boolean(targetRow || targetUses > 0)
  let toName = targetRow ? targetRow.name : typed.label
  // A target only the expenses know keeps the spelling they already use, not the one typed.
  if (merge && !targetRow) toName = (await rowsSpelling(db, toKey)) ?? toName
  const sourceName = sourceRow ? sourceRow.name : ((await rowsSpelling(db, fromKey)) ?? from)
  if (sameKey && toName === sourceName && sourceRow) return c.json({ success: true, changed: 0, merged: false, label: toName })
  const now = new Date().toISOString()
  const rows = { where: `${LABEL_KEY_SQL} = @fromKey AND COALESCE(label,'') <> @toName`, auditWhere: `${LABEL_KEY_SQL_F} = @fromKey AND COALESCE(f.label,'') <> @toName` }
  const statements: Statement[] = []
  if (!sourceRow) statements.push(ensureLabelStatement(user, sourceName, fromKey, null, now))
  if (merge && !targetRow) statements.push(ensureLabelStatement(user, toName, toKey, null, now))
  statements.push(
    feeRowsAuditStatement(user, 'label', merge ? 'label_merge' : 'label_rename', toName, rows.auditWhere, { fromKey, toName }),
    { sql: `UPDATE fees SET label = @toName, updated_at = @now WHERE ${rows.where}`, params: { fromKey, toName, now } },
    merge
      ? { sql: 'UPDATE fee_labels SET archived_at = @now, updated_at = @now WHERE name_key = @fromKey', params: { now, fromKey } }
      : { sql: 'UPDATE fee_labels SET name = @toName, name_key = @toKey, updated_at = @now WHERE name_key = @fromKey', params: { toName, toKey, now, fromKey } },
    // A rename moves the catalog row to its new key; a merge archives the source row under its old one.
    buildAuditStatement(user.id, user.username || null, 'replace', 'fee_label', null, { from: sourceName, to: toName, merged: merge, changed: sourceUses }, undefined, labelEntityIn(merge ? fromKey : toKey)),
  )
  try {
    await db.batch(statements)
  } catch (error) {
    if (isUniqueViolation(error)) return fail(c, 409, 'label_exists', 'That label already exists.')
    throw error
  }
  // Moves fee rows the sales report snapshot reads: bump sales (awaited) before the broadcast. Skipped when no row changed.
  if (sourceUses > 0) await bumpVersions(c.env, ['sales'])
  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'label_replace', from: sourceName, to: toName }))
  return c.json({ success: true, changed: sourceUses, merged: merge, label: toName })
})

app.post('/labels/classify', async (c) => {
  const user = c.get('user')
  if (!canManage(user)) return c.json(NO_PERMISSION, 403)
  const db = getDb(c.env)
  const body = await readBody(c)
  const typed = typedLabel(body.label)
  if ('code' in typed) return fail(c, 400, typed.code, typed.error)
  const feeType = await chosenType(db, body.fee_type ?? body.feeType)
  if (!feeType) return fail(c, 400, 'fee_type_invalid', TYPE_NOT_CHOOSABLE)
  const key = feeNameKey(typed.label)
  const [row, uses] = await Promise.all([catalogLabelByKey(db, key), labelRowCount(db, key)])
  if (!row && uses === 0) return fail(c, 404, 'label_not_found', 'That label no longer exists.')
  const now = new Date().toISOString()
  const name = row ? row.name : ((await rowsSpelling(db, key)) ?? typed.label)
  const changing = await countRows(db, `SELECT COUNT(*) AS n FROM fees WHERE ${LABEL_KEY_SQL} = @key AND fee_type <> @feeType`, { key, feeType })
  const where = `${LABEL_KEY_SQL_F} = @key AND f.fee_type <> @feeType`
  await db.batch([
    ensureLabelStatement(user, name, key, feeType, now),
    feeRowsAuditStatement(user, 'fee_type', 'label_classify', feeType, where, { key, feeType }),
    { sql: `UPDATE fees SET fee_type = @feeType, updated_at = @now WHERE ${LABEL_KEY_SQL} = @key AND fee_type <> @feeType`, params: { key, feeType, now } },
    { sql: 'UPDATE fee_labels SET fee_type = @feeType, updated_at = @now WHERE name_key = @key', params: { feeType, now, key } },
    buildAuditStatement(user.id, user.username || null, 'classify', 'fee_label', null, { label: name, fee_type: feeType, changed: changing }, undefined, labelEntityIn(key)),
  ])
  // Moves fee rows the sales report snapshot reads: bump sales (awaited) before the broadcast. Skipped when no row changed.
  if (changing > 0) await bumpVersions(c.env, ['sales'])
  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'label_classify', label: name, fee_type: feeType }))
  return c.json({ success: true, changed: changing, label: name, fee_type: feeType })
})

for (const action of ['archive', 'restore'] as const) {
  app.post(`/labels/${action}`, async (c) => {
    const user = c.get('user')
    if (!canManage(user)) return c.json(NO_PERMISSION, 403)
    const db = getDb(c.env)
    const body = await readBody(c)
    const typed = typedLabel(body.label)
    if ('code' in typed) return fail(c, 400, typed.code, typed.error)
    const key = feeNameKey(typed.label)
    const [row, uses] = await Promise.all([catalogLabelByKey(db, key), labelRowCount(db, key)])
    if (!row && uses === 0) return fail(c, 404, 'label_not_found', 'That label no longer exists.')
    const archiving = action === 'archive'
    if (row && archiving === Boolean(row.archived_at)) return c.json({ success: true, label: row.name, archived: archiving, changed: 0 })
    if (!row && !archiving) return c.json({ success: true, label: typed.label, archived: false, changed: 0 })
    const now = new Date().toISOString()
    const name = row ? row.name : ((await rowsSpelling(db, key)) ?? typed.label)
    await db.batch([
      ensureLabelStatement(user, name, key, null, now),
      { sql: 'UPDATE fee_labels SET archived_at = @archivedAt, updated_at = @now WHERE name_key = @key', params: { archivedAt: archiving ? now : null, now, key } },
      buildAuditStatement(user.id, user.username || null, archiving ? 'archive' : 'restore', 'fee_label', null, { label: name, linked_records: uses }, undefined, labelEntityIn(key)),
    ])
    c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: `label_${action}`, label: name }))
    return c.json({ success: true, label: name, archived: archiving, changed: 1 })
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Courier cost recorded on sales, shown beside the expenses
// ---------------------------------------------------------------------------------------------------------------------
// The canonical Expenses definition (Telegram shift report, day summary and post-close overview; shift reconciliation) is every
// `fees` row plus the courier payouts read off the day's non-cancelled sales by courierPayoutsWhere. This list shows that second
// half row by row, using the SAME expressions (courierPayoutExpressions), so its sum is courierPayoutsWhere's answer for the same
// window by construction. It never reads sale lines: cost of goods is not an expense, and neither is the shop-paid delivery FEE
// (the waived fee cancels against the shop's payment of it; only the courier cost counts).
type SaleDeliveryRow = {
  id: number
  receipt_number: string | null
  created_at: string
  d: string
  branch_id: number | null
  branch_name: string | null
  delivery_contact_id: number | null
  delivery_contact_name: string | null
  amount_usd: number
  amount_khr: number
  /** datetime(created_at): present only on the keyed statement (the export cursor's middle sort key). */
  dt?: string
}

export type SaleScope = { sql: string; params: Record<string, unknown> }

const toNumber = (value: unknown, fallback: number): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const roundKhr = (value: number): number => Math.round(value / 100) * 100

/**
 * The sales whose recorded courier cost counts, for the window and filters of an expense request. Window, branch and
 * cancelled-sale rules are whereActiveSales' own (the clause every kernel report reads). Null when the filters exclude every
 * sale row (a type filter other than delivery).
 */
export async function saleScope(db: Db, query: Record<string, string>, narrow: boolean): Promise<SaleScope | null> {
  const range = feeRangePredicate(query)
  const filters: SalesFilters = {
    startDate: String(query.from || query.startDate || '').trim() || null,
    endDate: String(query.to || query.endDate || '').trim() || null,
    createdFrom: (range.params.createdFrom as string | undefined) ?? null,
    createdTo: (range.params.createdTo as string | undefined) ?? null,
  }
  const active = whereActiveSales('sales', filters)
  const expressions = courierPayoutExpressions()
  const clauses = [
    active.sql,
    // Same text as the partial index idx_sales_courier_cost (0292): only sales that carry a courier cost are read.
    '(sales.delivery_actual_cost_usd IS NOT NULL OR sales.delivery_actual_cost_khr IS NOT NULL)',
    `(${expressions.usd} <> 0 OR ${expressions.khr} <> 0)`,
  ]
  const params: Record<string, unknown> = { ...active.params }
  // The branch is NOT passed through whereActiveSales: `sales.branch_id = ?` makes the planner walk idx_sales_branch_created, which visits every sale
  // of the branch (after the consolidation, nearly all of them) to find the ~2% that carry a courier cost. The unary plus keeps the equality out of
  // index selection, so idx_sales_courier_cost leads and the branch is checked on those few rows. The plus also drops the column's integer
  // affinity, so the id is bound as a NUMBER (a text '1' would never equal the integer 1 without it). Only decimal digits are an id (Number() would
  // also read `0x1`, `1e0` and `1.0` as branch 1), the same rule as the expense half; anything else matches no sale, as `branch_id = 'abc'` always did.
  const branchText = String(query.branch_id || query.branchId || '').trim()
  if (branchText) {
    const branchId = /^\d+$/.test(branchText) ? Number(branchText) : Number.NaN
    if (Number.isSafeInteger(branchId) && branchId > 0) {
      clauses.push('+sales.branch_id = @saleBranchId')
      params.saleBranchId = branchId
    } else {
      clauses.push('1 = 0')
    }
  }
  if (narrow) {
    const type = String(query.fee_type || '').trim()
    if (type && type !== 'all' && await resolveFeeTypeFilter(db, type) !== 'delivery') return null
    const search = String(query.search || '').trim()
    if (search) {
      clauses.push("(sales.receipt_number LIKE @saleSearch OR sales.delivery_contact_name LIKE @saleSearch OR 'delivery' LIKE @saleSearch)")
      params.saleSearch = `%${search}%`
    }
    const saleId = String(query.sale_id || '').trim()
    if (saleId) { clauses.push('sales.id = @saleFilterId'); params.saleFilterId = Number(saleId) }
    const contact = String(query.delivery_contact_id || '').trim()
    if (contact) { clauses.push('sales.delivery_contact_id = @saleFilterContact'); params.saleFilterContact = Number(contact) }
  }
  return { sql: clauses.join(' AND '), params }
}

/** `withUndated` adds the number of rows whose created_at has no readable day (the export cursor needs it); off, the text is the 6.0.1053 statement. */
export function saleDeliveryTotalsSql(scope: SaleScope, withUndated = false): string {
  const expressions = courierPayoutExpressions()
  const undated = withUndated ? `, COALESCE(SUM(CASE WHEN ${localDateExpr('sales.created_at')} IS NULL THEN 1 ELSE 0 END), 0) AS undated` : ''
  return `SELECT COUNT(*) AS count, COALESCE(SUM(${expressions.usd}), 0) AS usd, COALESCE(SUM(${expressions.khr}), 0) AS khr${undated}
    FROM sales WHERE ${scope.sql}`
}

async function saleDeliveryTotals(db: Db, scope: SaleScope): Promise<{ count: number; usd: number; khr: number }> {
  const row = await db.prepare(saleDeliveryTotalsSql(scope)).get<{ count: number; usd: number; khr: number }>(scope.params)
  return { count: Number(row?.count || 0), usd: round2(Number(row?.usd || 0)), khr: roundKhr(Number(row?.khr || 0)) }
}

/** The export's first page: the same totals plus how many of those rows have no readable day (they sort last and are served by their own phase). */
async function saleDeliveryTotalsForExport(db: Db, scope: SaleScope): Promise<{ count: number; usd: number; khr: number; undated: number }> {
  const row = await db.prepare(saleDeliveryTotalsSql(scope, true)).get<{ count: number; usd: number; khr: number; undated: number }>(scope.params)
  return { count: Number(row?.count || 0), usd: round2(Number(row?.usd || 0)), khr: roundKhr(Number(row?.khr || 0)), undated: Number(row?.undated || 0) }
}

/** `keyed` adds the normalized entry time (`dt`), the middle part of the list's order and of the export cursor's sale key. Off, the text is the 6.0.1053 statement. */
export function saleDeliveryRowsSql(scope: SaleScope, keyed = false): string {
  const expressions = courierPayoutExpressions()
  return `
    SELECT sales.id, sales.receipt_number, sales.created_at, ${localDateExpr('sales.created_at')} AS d, sales.branch_id,${keyed ? ' datetime(sales.created_at) AS dt,' : ''}
      COALESCE(NULLIF(TRIM(sales.branch_name), ''), b.name) AS branch_name,
      sales.delivery_contact_id, NULLIF(TRIM(sales.delivery_contact_name), '') AS delivery_contact_name,
      ${expressions.usd} AS amount_usd, ${expressions.khr} AS amount_khr
    FROM sales
    LEFT JOIN branches b ON b.id = sales.branch_id
    WHERE ${scope.sql}
    ORDER BY d DESC, datetime(sales.created_at) DESC, sales.id DESC
    LIMIT @saleLimit
  `
}

async function saleDeliveryRows(db: Db, scope: SaleScope, limit: number, keyed = false): Promise<SaleDeliveryRow[]> {
  return (await db.prepare(saleDeliveryRowsSql(scope, keyed)).all<SaleDeliveryRow>({ ...scope.params, saleLimit: limit })) || []
}

/** The sale half of the cursor: [day, entry time, id] of the last sale row served; the day and time are null for a row with no readable created_at. */
type SaleKey = [string | null, string | null, number]

/** The rows with no readable day (last in the list): from the head, or below the key `after`, newest entry time first, then the highest id. */
async function saleDeliveryUndatedRows(db: Db, scope: SaleScope, after: SaleKey | null, limit: number): Promise<SaleDeliveryRow[]> {
  const entry = 'datetime(sales.created_at)'
  let sql = `${scope.sql} AND ${localDateExpr('sales.created_at')} IS NULL`
  const params: Record<string, unknown> = { ...scope.params }
  if (after) {
    // list order inside the group: entry time descending (NULL last), then id descending
    sql += after[1] === null
      ? ` AND ${entry} IS NULL AND sales.id < @afterId`
      : ` AND (${entry} < @afterAt OR ${entry} IS NULL OR (${entry} = @afterAt AND sales.id < @afterId))`
    if (after[1] !== null) params.afterAt = after[1]
    params.afterId = after[2]
  }
  return saleDeliveryRows(db, { sql, params }, limit, true)
}

/**
 * The next `limit` sale rows below the cursor's sale key (the list's order is day, entry time, id, all descending), reading about 2 x limit sale rows
 * however far into the list the cursor is. The order is not an index order: entry times come in two spellings ('YYYY-MM-DD HH:MM:SS' and ISO
 * 'T..Z', and an offset such as '-07:00' or '+12:00') that interleave on one day, so idx_sales_courier_cost (created_at) cannot serve it. A cheap probe walks
 * that index in raw order for `limit` rows; the ordered statement then reads only the rows from two days before the probe's last raw day. No cursor = the head
 * of the list.
 *
 * Why two days, and why the bounds are only a narrowing: a row's raw text carries its own clock, whose date R can differ from its Cambodia day L (UTC+7) by
 * the offset it was written with. Offsets run from -12:00 to +14:00, so L - R lies between -1 and +1 day for every spelling (R <= L + 1 and L <= R + 1).
 * Upper bound: a row below the cursor has L <= A, so R <= A + 1, so its text is below date(A, '+2 day'). Floor: the probe's `limit` rows all have R >= P,
 * so L >= P - 1; a row whose text is below date(P, '-2 day') has R <= P - 3 and L <= P - 2, which puts all `limit` of them ahead of it: it is not on the page.
 * The exact comparison on the Cambodia day (below) is the filter; the bounds only narrow the index range. A one-day margin (the first design) lost rows written
 * with an offset ahead of +07:00: their text date is a day after their Cambodia day. Assumes the text starts with its date, as every spelling the app writes does.
 *
 * A row whose created_at has no readable day (garbage, an empty string) has a NULL day and a NULL entry time. ORDER BY d DESC puts those rows LAST, after
 * every dated row, ordered by entry time then id, and the offset list serves them the same way. They cannot ride the probe (a raw created_at order puts
 * 'garbage' above every date and '' below), so they are a second phase: `undated` says the scope holds some (the first page counted them); the dated
 * phase then leaves them out and, when it runs out of dated rows, the undated phase fills the page. A key whose day is null is already in that phase.
 */
async function saleDeliveryRowsAfter(db: Db, scope: SaleScope, after: SaleKey | null, limit: number, undated: boolean): Promise<SaleDeliveryRow[]> {
  if (after && after[0] === null) return saleDeliveryUndatedRows(db, scope, after, limit)
  const dated: SaleScope = undated && !after ? { sql: `${scope.sql} AND ${localDateExpr('sales.created_at')} IS NOT NULL`, params: scope.params } : scope
  const bounded: SaleScope = after ? {
    sql: `${dated.sql} AND sales.created_at < date(@afterDay, '+2 day') AND (${localDateExpr('sales.created_at')} < @afterDay
      OR (${localDateExpr('sales.created_at')} = @afterDay AND (datetime(sales.created_at) < @afterAt OR (datetime(sales.created_at) = @afterAt AND sales.id < @afterId))))`,
    params: { ...dated.params, afterDay: after[0], afterAt: after[1], afterId: after[2] },
  } : dated
  const probe = await db.prepare(`SELECT sales.created_at AS created_at FROM sales WHERE ${bounded.sql} ORDER BY sales.created_at DESC LIMIT @probeLimit`)
    .all<{ created_at: string }>({ ...bounded.params, probeLimit: limit })
  const day = String(probe?.[limit - 1]?.created_at || '').slice(0, 10)
  const floored: SaleScope = /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`))
    ? { sql: `${bounded.sql} AND sales.created_at >= date(@probeDay, '-2 day')`, params: { ...bounded.params, probeDay: day } }
    : bounded
  const rows = await saleDeliveryRows(db, floored, limit, true)
  // fewer dated rows than the page wants = the dated list is over: the undated rows (last in the list) fill what is left
  return undated && rows.length < limit ? [...rows, ...await saleDeliveryUndatedRows(db, scope, null, limit - rows.length)] : rows
}

const saleRowOut = (row: SaleDeliveryRow) => ({
  kind: 'sale_delivery' as const,
  id: row.id,
  fee_type: 'delivery',
  label: row.delivery_contact_name,
  amount_usd: Number(row.amount_usd) || 0,
  amount_khr: Number(row.amount_khr) || 0,
  fee_date: row.d,
  sale_id: row.id,
  sale_receipt_number: row.receipt_number,
  branch_id: row.branch_id,
  branch_name: row.branch_name,
  delivery_contact_id: row.delivery_contact_id,
  delivery_contact_name: row.delivery_contact_name,
  notes: null,
  created_by: null,
  created_by_name: null,
  created_at: row.created_at,
  updated_at: row.created_at,
})

type MergeRow = Record<string, unknown> & { kind: 'expense' | 'sale_delivery' }

/**
 * Two lists, each already newest-first, merged into one. A stored expense sorts by its booked date, a sale row by the sale's
 * business day; on one date the later entry time comes first, and an expense wins a tie. The first k merged rows depend only on
 * the first k of each list, so any page can be rebuilt from the top (offset + limit) rows of both.
 */
export function mergeExpenseRows(expenses: MergeRow[], sales: MergeRow[]): MergeRow[] {
  const stamp = (row: MergeRow) => String(row.created_at || '').replace('T', ' ').slice(0, 19)
  const out: MergeRow[] = []
  let i = 0
  let j = 0
  while (i < expenses.length || j < sales.length) {
    if (j >= sales.length) { out.push(expenses[i++]); continue }
    if (i >= expenses.length) { out.push(sales[j++]); continue }
    const a = expenses[i]
    const b = sales[j]
    const dateA = String(a.fee_date || '')
    const dateB = String(b.fee_date || '')
    const saleFirst = dateB > dateA || (dateB === dateA && stamp(b) > stamp(a))
    out.push(saleFirst ? sales[j++] : expenses[i++])
  }
  return out
}

const highestId = async (db: Db, table: 'fees' | 'sales'): Promise<number> =>
  Number((await db.prepare(`SELECT MAX(id) AS id FROM ${table}`).get<{ id: number | null }>())?.id || 0)

/**
 * One page of the export by cursor (read switch `expense_reads`; `cursor=start` asks for the first). The order is the merge's, unchanged: between the two
 * lists the later booked day goes first, then the later entry time, and an expense goes before a sale row on an exact tie; inside a list its own key
 * decides (expenses: fee_date, id; sale rows: day, normalized entry time, id; all descending), so rows with the same timestamp are ordered by id and never
 * reshuffled between pages. The merge above takes its next rows from the heads of the
 * two lists, so the page after one that served i expenses and j sale rows is the merge of the next `limit` rows of each list below the last row served from
 * it: the same rows offset i + j would give, read without reading the i + j rows before them. One row more than the page is read from each list to know
 * whether another page follows. Only the first page carries the totals.
 *
 * The first page reads the two lists exactly as the offset export's first page does (no id bound, and no probe when the whole sale list fits the page: its
 * totals are read first, and a list of at most one page is read by the plain statement). It takes the snapshot only when another page follows: the highest ids
 * (`snapshot_max_id`) are read after the page and ride in the cursor, so a row created later is in no page; an edit that moves a row across the cursor is the one
 * change no stateless paging can hide. An export that fits one page reads no id at all, which is what keeps a month's export no dearer than today's.
 */
async function exportPage(c: Ctx, db: Db, query: Record<string, string>, source: 'all' | 'sale', cursor: FeeExportCursor | null) {
  const first = !cursor
  const limit = Math.min(Math.max(toNumber(query.limit, 100), 1), getPlanLimits(c.env).expenseExportPageRows)
  const showSales = canViewCourierCost(c.get('user'))
  const base = showSales ? await saleScope(db, query, true) : null
  // `+sales.id` keeps the bound out of index selection: the bound is checked on the rows idx_sales_courier_cost yields (the few that carry a courier cost) and
  // never lets the planner walk the sales primary key (every sale) instead. A plain `sales.id <= ?` did exactly that to the totals statement in the first design
  // of this export, and it is the same trap as the branch filter in saleScope. Only pages after the first carry the bound (the first page takes the snapshot later).
  const scope: SaleScope | null = base && (cursor ? { sql: `${base.sql} AND +sales.id <= @saleHi`, params: { ...base.params, saleHi: cursor.h[1] } } : base)
  const noSales = { totals: { count: 0, usd: 0, khr: 0, undated: 0 }, rows: [] as SaleDeliveryRow[] }
  const [fees, sales] = await Promise.all([
    source === 'all'
      ? queryFeeList(db, query, limit + 1, 0, { upToId: cursor ? cursor.h[0] : null, after: cursor?.e ? { feeDate: cursor.e[0], id: cursor.e[1] } : null, rowsOnly: !first }, c.get('user'))
      : Promise.resolve<FeeListPage>({ fees: [], total: 0, summary: [] }),
    !scope ? Promise.resolve(noSales) : cursor
      ? saleDeliveryRowsAfter(db, scope, cursor.s, limit + 1, cursor.u > 0).then((rows) => ({ ...noSales, rows }))
      : saleDeliveryTotalsForExport(db, scope).then(async (totals) => ({
        totals,
        rows: totals.count <= limit + 1
          ? await saleDeliveryRows(db, scope, limit + 1, true)
          : await saleDeliveryRowsAfter(db, scope, null, limit + 1, totals.undated > 0),
      })),
  ])
  const saleTotals = sales.totals
  const merged = mergeExpenseRows(
    fees.fees.map((row) => ({ ...row, kind: 'expense' as const })),
    sales.rows.map(saleRowOut),
  )
  const page = merged.slice(0, limit)
  const hasMore = merged.length > limit
  const entryTimes = new Map(sales.rows.map((row) => [row.id, row.dt]))
  let lastExpense = cursor?.e ?? null
  let lastSale = cursor?.s ?? null
  for (const row of page) {
    if (row.kind === 'expense') lastExpense = [String(row.fee_date), Number(row.id)]
    else {
      // a NULL day or entry time stays null in the cursor (String(null) would write the text 'null' and the next page would look for it)
      const at = entryTimes.get(Number(row.id))
      lastSale = [row.fee_date == null ? null : String(row.fee_date), at == null ? null : String(at), Number(row.id)]
    }
  }
  // The sale half of the snapshot is read, kept in the cursor and shown only to a caller who may read courier cost: the highest sale id is about the number of sales.
  const hi: [number, number] | null = cursor ? cursor.h
    : hasMore ? await Promise.all([highestId(db, 'fees'), showSales ? highestId(db, 'sales') : 0]) as [number, number] : null
  return c.json({
    fees: page,
    ...(first ? {
      total: fees.total + saleTotals.count, offset: 0, summary: fees.summary,
      sale_delivery: showSales ? { count: saleTotals.count, usd: saleTotals.usd, khr: saleTotals.khr } : null,
    } : {}),
    limit,
    has_more: hasMore,
    next_cursor: hasMore && hi ? encodeFeeCursor({ e: lastExpense, s: lastSale, h: hi, u: cursor ? cursor.u : saleTotals.undated }) : null,
    snapshot_max_id: hi ? { fees: hi[0], sales: showSales ? hi[1] : null } : null,
  })
}

app.get('/', async (c, next) => {
  const source = c.req.query('source')
  if (source !== 'all' && source !== 'sale') return next()
  const db = getDb(c.env)
  const query = c.req.query()
  const limit = Math.min(Math.max(toNumber(query.limit, 100), 1), 500)
  const offset = Math.max(toNumber(query.offset, 0), 0)
  const need = offset + limit
  const showSales = canViewCourierCost(c.get('user'))
  try {
    // The export pages by cursor when the switch is on. A cursor this Worker did not hand out is ignored and the request pages by `offset`, which the
    // export client sends with every request; with the switch off the parameter is never read, so the answer is the 6.0.1053 one.
    const cursorText = c.req.query('cursor')
    if (cursorText && await expenseReadsOn(c.env)) {
      const cursor = cursorText === 'start' ? null : decodeFeeCursor(cursorText)
      if (cursorText === 'start' || cursor) return await exportPage(c, db, query, source, cursor)
    }
    const scope = showSales ? await saleScope(db, query, true) : null
    const [fees, saleTotals, saleRows] = await Promise.all([
      source === 'all' ? queryFeeList(db, query, need, 0, undefined, c.get('user')) : Promise.resolve<FeeListPage>({ fees: [], total: 0, summary: [] }),
      scope ? saleDeliveryTotals(db, scope) : Promise.resolve({ count: 0, usd: 0, khr: 0 }),
      scope ? saleDeliveryRows(db, scope, need) : Promise.resolve<SaleDeliveryRow[]>([]),
    ])
    const merged = mergeExpenseRows(
      fees.fees.map((row) => ({ ...row, kind: 'expense' as const })),
      saleRows.map(saleRowOut),
    )
    return c.json({
      fees: merged.slice(offset, offset + limit),
      total: fees.total + saleTotals.count,
      limit,
      offset,
      summary: fees.summary,
      // null = the caller may not read courier cost: no sale row, no count, no amount.
      sale_delivery: showSales ? saleTotals : null,
    })
  } catch (error) {
    if (error instanceof RangeError) return c.json({ error: error.message }, 400)
    throw error
  }
})

// GET /api/fees/report?include=sales: the unchanged fees report (fees.ts answers it first) plus the sale courier-cost block for the same range and branch.
app.get('/report', async (c, next) => {
  if (c.req.query('include') !== 'sales') return next()
  await next()
  if (c.res.status !== 200) return
  const body = await c.res.clone().json<Record<string, unknown>>().catch(() => null)
  if (!body) return
  const showSales = canViewCourierCost(c.get('user'))
  let saleDelivery: { count: number; usd: number; khr: number } | null = null
  if (showSales) {
    const query = c.req.query()
    const scope = await saleScope(getDb(c.env), { ...query, branch_id: query.branchId || '' }, false)
    saleDelivery = scope ? await saleDeliveryTotals(getDb(c.env), scope) : { count: 0, usd: 0, khr: 0 }
  }
  c.res = c.json({ ...body, sale_delivery: saleDelivery })
})

export default app
