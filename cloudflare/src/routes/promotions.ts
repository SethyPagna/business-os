import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { changedFields } from '../lib/audit'
import { hasPermission, getPermissionTier, getActionTier } from '../lib/permissions'
import { bumpVersion } from '../lib/cache'
import { normalizePromotionRule, isRuleActive } from '../lib/promotionRules'
import { normalizeTypedDate } from '../lib/batchCode'
import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'
import { assertRequiredUpdatedAtMatch, EXPECTED_UPDATED_AT_REQUIRED, getExpectedUpdatedAt, hasExpectedUpdatedAtField, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import {
  canonicalWriteRequest, findWriteReceipt, readWriteRequestId, receiptAbsentSql, receiptAuditStatement, receiptParams,
  WRITE_IDEMPOTENCY_CONFLICT, type WriteReceiptKey,
} from '../lib/auditWriteReceipt'
import { isSafeLinkUrl } from '../lib/safeLinkUrl'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
// Two features share this mount, gated separately (G1, Part 391):
//  - the ANNOUNCEMENT STRIP (the original endpoints below) keeps its
//    legacy `products` gate on every route;
//  - the promotion RULE engine (/rules*) manages under the new
//    `promotions` page permission, EXCEPT /rules/active, which any
//    authenticated user may read: POS cashiers price carts with these
//    rules without holding the manage permission. The blanket `products`
//    wildcard gate is gone; each route now names its own gate.
const requireKey = (key: string): MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser } }> => async (c, next) => {
  if (!hasPermission(c.get('user'), key)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
}
// The announcement-strip WRITES (POST /, PUT /:id, PUT /reorder/all, DELETE /:id) publish
// public storefront content, including an outside https link. Holding the Products section is
// not the right gate (the Employee seed holds it): they need a Website Editor grant -- the
// posts & promos area, or portal config -- or full Settings, the same "bucket OR settings"
// superset routes/settings.ts applies to the customer_portal_* keys. Admin passes inside
// hasPermission. The list (GET /) admits the same Website Editor holders as well as the products section: their Manage modal
// loads it, and a role that may write the cards must be able to see them. Mirrored in the UI by
// CatalogEditorSurface's canEditConfig || canEditPosts.
const WEBSITE_EDITOR_STRIP_KEYS = ['portal_posts', 'customer_portal', 'settings'] as const
const requireWebsiteEditor: MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser } }> = async (c, next) => {
  const user = c.get('user')
  if (!WEBSITE_EDITOR_STRIP_KEYS.some((key) => hasPermission(user, key))) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
}
const requireStripRead: MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser } }> = async (c, next) => {
  const user = c.get('user')
  if (!hasPermission(user, 'products') && !WEBSITE_EDITOR_STRIP_KEYS.some((key) => hasPermission(user, key))) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
}
// 'promotions' is a VIEW_TIER section (Part 557 slice 4): a 'view' grant can
// READ the full rule list but manage nothing. This admits view OR full (tier
// != none) for the read route; rule writes use promotions.manage at Full.
const requireReadKey = (key: string): MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser } }> => async (c, next) => {
  if (getPermissionTier(c.get('user'), key) === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
}
const requireAction = (key: string, action: string): MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser } }> => async (c, next) => {
  if (getActionTier(c.get('user'), key, action) !== 'full') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
}

// ---------------------------------------------------------------------------
// N13: every promotion write carries a request identity and a stored receipt, and
// every edit/delete of a single row states the version it read.
//
// Before, none of the seven write routes had either: a double POST created the
// card/rule twice, a retried PUT or DELETE re-ran, and a stale editor silently
// overwrote a newer edit. The receipt is the write's own audit row, committed in the
// same batch as the write (lib/auditWriteReceipt.ts -- the pattern the shift and
// loyalty routes already use), so no migration is needed and a racing twin writes
// nothing. A retry of a request that DID commit is answered from the first commit,
// even though its expected_updated_at is by then stale; the same id with different
// values is a 409 idempotency_conflict; a stale version is a 409 write_conflict.
//
// Reorder (PUT /reorder/all) takes the receipt but no version: it states an absolute
// order for the whole list, there is no single row to version, and re-applying it is
// harmless.

type PromotionContext = Context<{ Bindings: Env; Variables: { user: SessionUser } }>
type PromotionDb = ReturnType<typeof getDb>
type PromotionTable = 'promotions' | 'promotion_rules'
type Receipt = { key: WriteReceiptKey; canonical: string }
type Responder = (row: Record<string, unknown> | null, entityId: number | null) => Response

async function readWriteBody(c: PromotionContext, withQuery = false): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(() => ({}))
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  // A DELETE may carry its identity in the query string instead of a body.
  return withQuery ? { ...c.req.query(), ...body } : body
}

// null = no earlier request with this id; otherwise the response to send.
async function replayFromReceipt(
  c: PromotionContext, db: PromotionDb, receipt: Receipt, table: PromotionTable, respond: Responder,
): Promise<Response | null> {
  const prior = await findWriteReceipt(db, receipt.key)
  if (!prior) return null
  if (prior.canonical !== receipt.canonical) return c.json(WRITE_IDEMPOTENCY_CONFLICT, 409)
  const entityId = prior.entityId == null ? null : Number(prior.entityId)
  const row = entityId == null ? null : await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get<Record<string, unknown>>([entityId])
  return respond(row ?? null, entityId)
}

// The write's own statement reported no changed row: either its twin committed
// first (answer from that receipt), or the row moved/vanished after the pre-read.
async function lostWriteResponse(
  c: PromotionContext, db: PromotionDb, receipt: Receipt, table: PromotionTable, entity: string, id: number,
  expectedUpdatedAt: string | null, respond: Responder,
): Promise<Response> {
  const replay = await replayFromReceipt(c, db, receipt, table, respond)
  if (replay) return replay
  const latest = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get<Record<string, unknown>>([id])
  const { body, status } = writeConflictResponse(new WriteConflictError(entity, latest || null, expectedUpdatedAt, latest ? 'updated' : 'deleted'))
  return c.json(body, status)
}

function versionConflict(c: PromotionContext, entity: string, current: Record<string, unknown> | undefined, expected: string | null): Response | null {
  try {
    assertRequiredUpdatedAtMatch(entity, current, expected)
    return null
  } catch (error) {
    if (!(error instanceof WriteConflictError)) throw error
    const { body, status } = writeConflictResponse(error)
    return c.json(body, status)
  }
}

function rowId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// ---------------------------------------------------------------------------
// G1 promotion RULES (/rules*) -- registered BEFORE the legacy strip routes
// so /rules/:id never falls into the strip's own /:id patterns.

const RULE_TYPES = new Set(['quantity_save', 'percent_off', 'fixed_off', 'spend_save', 'quantity_percent', 'next_item'])
const RULE_SCOPES = new Set(['products', 'category', 'brand'])
const LABEL_STYLES = new Set(['save', 'get', 'free'])
// Which value fields each rule type actually uses -- everything else is
// zeroed on write so a stale field from a previous type choice can never
// leak into the evaluation.
const TYPE_USES = {
  quantity_save: { qty: true, save: true, pct: false, spend: false },
  percent_off: { qty: false, save: false, pct: true, spend: false },
  fixed_off: { qty: false, save: true, pct: false, spend: false },
  spend_save: { qty: false, save: true, pct: false, spend: true },
  quantity_percent: { qty: true, save: false, pct: true, spend: false },
  // next_item: benefit is EITHER percent (wins when > 0) or a flat amount.
  next_item: { qty: true, save: true, pct: true, spend: false },
} as const

type RuleInput = Record<string, unknown>

function normalizeRuleWrite(body: RuleInput = {}) {
  const ruleType = RULE_TYPES.has(String(body.rule_type)) ? String(body.rule_type) : 'percent_off'
  const scopeType = RULE_SCOPES.has(String(body.scope_type)) ? String(body.scope_type) : 'products'
  const ids = Array.isArray(body.product_ids) ? body.product_ids : []
  const productIds = Array.from(new Set(ids.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))).slice(0, 200)
  const money = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100)
  const dateOnly = (v: unknown) => {
    const raw = String(v || '').trim()
    if (!raw) return null
    return normalizeTypedDate(raw)
  }
  const uses = TYPE_USES[ruleType as keyof typeof TYPE_USES]
  return {
    title: String(body.title || '').trim().slice(0, 120),
    show_title: body.show_title === false || body.show_title === 0 ? 0 : 1,
    rule_type: ruleType,
    min_quantity: uses.qty ? Math.max(0, Number(body.min_quantity) || 0) : 0,
    save_usd: uses.save ? money(body.save_usd) : 0,
    save_khr: uses.save ? Math.max(0, Math.round(Number(body.save_khr) || 0)) : 0,
    percent_off: uses.pct ? Math.min(100, Math.max(0, Number(body.percent_off) || 0)) : 0,
    min_spend_usd: uses.spend ? money(body.min_spend_usd) : 0,
    min_spend_khr: uses.spend ? Math.max(0, Math.round(Number(body.min_spend_khr) || 0)) : 0,
    label_style: LABEL_STYLES.has(String(body.label_style)) ? String(body.label_style) : 'save',
    scope_type: scopeType,
    product_ids: JSON.stringify(scopeType === 'products' ? productIds : []),
    category: scopeType === 'category' ? String(body.category || '').trim().slice(0, 200) : null,
    brand: scopeType === 'brand' ? String(body.brand || '').trim().slice(0, 200) : null,
    badge_color: normalizeColor(body.badge_color) || '#e11d48',
    starts_at: dateOnly(body.starts_at),
    ends_at: dateOnly(body.ends_at),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
  }
}

function ruleWriteError(input: ReturnType<typeof normalizeRuleWrite>, body: RuleInput): string | null {
  if (!RULE_TYPES.has(input.rule_type)) return 'Unknown rule type'
  if ((input.rule_type === 'percent_off' || input.rule_type === 'quantity_percent') && input.percent_off <= 0) return 'Enter a percent greater than 0'
  if ((input.rule_type === 'quantity_save' || input.rule_type === 'fixed_off' || input.rule_type === 'spend_save') && input.save_usd <= 0 && input.save_khr <= 0) return 'Enter a save amount in USD or KHR'
  if (input.rule_type === 'next_item' && input.percent_off <= 0 && input.save_usd <= 0 && input.save_khr <= 0) return 'Enter a percent or an amount off the next item'
  if ((input.rule_type === 'quantity_save' || input.rule_type === 'quantity_percent' || input.rule_type === 'next_item') && input.min_quantity < 1) return 'Enter the minimum quantity to buy (at least 1)'
  if (input.rule_type === 'spend_save' && input.min_spend_usd <= 0 && input.min_spend_khr <= 0) return 'Enter the spend threshold in USD or KHR'
  if (input.scope_type === 'products' && JSON.parse(input.product_ids).length === 0) return 'Choose at least one product'
  if (input.scope_type === 'category' && !input.category) return 'Choose a category'
  if (input.scope_type === 'brand' && !input.brand) return 'Choose a brand'
  // A window the operator TYPED but the parser could not read must fail
  // loudly, not silently store an open-ended rule (Golden Rule: no silent
  // partial writes).
  if (String(body.starts_at || '').trim() && !input.starts_at) return 'Start date is not a real date (use dd/mm/yyyy)'
  if (String(body.ends_at || '').trim() && !input.ends_at) return 'End date is not a real date (use dd/mm/yyyy)'
  return null
}

// Any authenticated user (POS included) may READ the active rule set --
// pricing a cart is not managing promotions. Normalized through the shared
// kernel so every consumer sees the same parsed shape.
app.get('/rules/active', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM promotion_rules WHERE is_active = 1 ORDER BY id ASC').all<Record<string, unknown>>()
  const now = new Date()
  const rules = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePromotionRule(row))
    .filter((rule) => rule && isRuleActive(rule, now))
  return c.json({ rules, now: now.toISOString() })
})

app.get('/rules', requireReadKey('promotions'), async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM promotion_rules ORDER BY is_active DESC, id DESC').all<Record<string, unknown>>()
  const now = new Date()
  return c.json((Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    normalized: normalizePromotionRule(row),
    currently_active: (() => { const r = normalizePromotionRule(row); return Boolean(r && isRuleActive(r, now)) })(),
  })))
})

app.post('/rules', requireAction('promotions', 'manage'), async (c) => {
  const user = c.get('user')
  const body = await readWriteBody(c)
  const requestId = readWriteRequestId(body)
  if (!requestId.ok) return c.json(requestId.body, 400)
  const input = normalizeRuleWrite(body)
  const error = ruleWriteError(input, body)
  if (error) return c.json({ error }, 400)
  const db = getDb(c.env)
  const receipt: Receipt = {
    key: { actorId: Number(user.id), action: 'create', entity: 'promotion_rule', requestId: requestId.id },
    canonical: canonicalWriteRequest(input),
  }
  const respond: Responder = (row, entityId) => c.json(row ?? { id: entityId, replayed: true })
  const prior = await replayFromReceipt(c, db, receipt, 'promotion_rules', respond)
  if (prior) return prior
  const results = await db.batch([
    {
      sql: `INSERT INTO promotion_rules (
        title, show_title, rule_type, min_quantity, save_usd, save_khr, percent_off,
        min_spend_usd, min_spend_khr, label_style,
        scope_type, product_ids, category, brand, badge_color, starts_at, ends_at, is_active, updated_at
      ) SELECT @title, @show_title, @rule_type, @min_quantity, @save_usd, @save_khr, @percent_off,
        @min_spend_usd, @min_spend_khr, @label_style,
        @scope_type, @product_ids, @category, @brand, @badge_color, @starts_at, @ends_at, @is_active, CURRENT_TIMESTAMP
      WHERE ${receiptAbsentSql()}`,
      params: { ...input, ...receiptParams(receipt.key) },
    },
    receiptAuditStatement({
      key: receipt.key, actorName: actorSnapshot(user), entityIdFromLastInsert: true, canonical: receipt.canonical,
      details: { title: input.title, rule_type: input.rule_type, scope_type: input.scope_type },
    }),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    // Its twin committed between the replay lookup and this batch.
    const twin = await replayFromReceipt(c, db, receipt, 'promotion_rules', respond)
    if (twin) return twin
    return c.json({ error: 'The promotion could not be confirmed. Check the list before retrying.', code: 'write_outcome_unknown', outcome: 'unknown' }, 503)
  }
  const newId = Number(results[0].meta?.last_row_id ?? 0)
  // Promoted-first ordering lives inside the cached /api/products/search
  // responses -- a rule write reorders them, so it bumps the same version.
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'rule-create', id: newId }))
  const created = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get([newId])
  return c.json(created)
})

app.put('/rules/:id', requireAction('promotions', 'manage'), async (c) => {
  const user = c.get('user')
  const id = rowId(c.req.param('id'))
  const body = await readWriteBody(c)
  const requestId = readWriteRequestId(body)
  if (!requestId.ok) return c.json(requestId.body, 400)
  if (!hasExpectedUpdatedAtField(body)) return c.json(EXPECTED_UPDATED_AT_REQUIRED, 400)
  if (id == null) return c.json({ error: 'Promotion rule not found' }, 404)
  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  const input = normalizeRuleWrite(body)
  const error = ruleWriteError(input, body)
  if (error) return c.json({ error }, 400)
  const db = getDb(c.env)
  const receipt: Receipt = {
    key: { actorId: Number(user.id), action: 'update', entity: 'promotion_rule', requestId: requestId.id },
    canonical: canonicalWriteRequest({ id, expected_updated_at: expectedUpdatedAt, input }),
  }
  const respond: Responder = (row, entityId) => c.json(row ?? { id: entityId, replayed: true })
  // A retry of an edit that committed carries the OLD version, so the receipt is
  // read before the version is checked.
  const prior = await replayFromReceipt(c, db, receipt, 'promotion_rules', respond)
  if (prior) return prior
  const current = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get<Record<string, unknown>>([id])
  if (!current) return c.json({ error: 'Promotion rule not found' }, 404)
  const stale = versionConflict(c, 'promotion rule', current, expectedUpdatedAt)
  if (stale) return stale
  // A save that changes nothing writes nothing: no UPDATE, no audit row, and
  // above all no products-version bump, which throws away every cached product
  // search (the promoted-first ordering lives inside them).
  const change = changedFields(current, input as Record<string, unknown>, { keys: Object.keys(input) })
  if (!change) return c.json(current)
  const results = await db.batch([
    {
      sql: `UPDATE promotion_rules SET
        title=@title, show_title=@show_title, rule_type=@rule_type, min_quantity=@min_quantity,
        save_usd=@save_usd, save_khr=@save_khr, percent_off=@percent_off,
        min_spend_usd=@min_spend_usd, min_spend_khr=@min_spend_khr, label_style=@label_style,
        scope_type=@scope_type,
        product_ids=@product_ids, category=@category, brand=@brand, badge_color=@badge_color,
        starts_at=@starts_at, ends_at=@ends_at, is_active=@is_active, updated_at=CURRENT_TIMESTAMP
      WHERE id=@id AND updated_at IS @expectedUpdatedAt AND ${receiptAbsentSql()}`,
      params: { ...input, id, expectedUpdatedAt, ...receiptParams(receipt.key) },
    },
    // `input` is the normalized value set this UPDATE wrote and `current` is
    // the row it replaced, so its keys are the exact editable surface of a rule.
    receiptAuditStatement({
      key: receipt.key, actorName: actorSnapshot(user), entityId: id, canonical: receipt.canonical, change,
      details: { title: input.title, rule_type: input.rule_type, scope_type: input.scope_type },
    }),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return lostWriteResponse(c, db, receipt, 'promotion_rules', 'promotion rule', id, expectedUpdatedAt, respond)
  }
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'rule-update', id }))
  const updated = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get([id])
  return c.json(updated)
})

app.delete('/rules/:id', requireAction('promotions', 'manage'), async (c) => {
  const user = c.get('user')
  const id = rowId(c.req.param('id'))
  const body = await readWriteBody(c, true)
  const requestId = readWriteRequestId(body)
  if (!requestId.ok) return c.json(requestId.body, 400)
  if (!hasExpectedUpdatedAtField(body)) return c.json(EXPECTED_UPDATED_AT_REQUIRED, 400)
  if (id == null) return c.json({ error: 'Promotion rule not found' }, 404)
  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  const db = getDb(c.env)
  const receipt: Receipt = {
    key: { actorId: Number(user.id), action: 'delete', entity: 'promotion_rule', requestId: requestId.id },
    canonical: canonicalWriteRequest({ id, expected_updated_at: expectedUpdatedAt }),
  }
  const respond: Responder = () => c.json({ deleted: true })
  const prior = await replayFromReceipt(c, db, receipt, 'promotion_rules', respond)
  if (prior) return prior
  const current = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').get<Record<string, unknown>>([id])
  if (!current) return c.json({ error: 'Promotion rule not found' }, 404)
  const stale = versionConflict(c, 'promotion rule', current, expectedUpdatedAt)
  if (stale) return stale
  const results = await db.batch([
    {
      sql: `DELETE FROM promotion_rules WHERE id = @id AND updated_at IS @expectedUpdatedAt AND ${receiptAbsentSql()}`,
      params: { id, expectedUpdatedAt, ...receiptParams(receipt.key) },
    },
    // Same shape as a fee delete: the removed record IS the before image, so the
    // Audit Log can show what the rule was instead of only its title.
    receiptAuditStatement({
      key: receipt.key, actorName: actorSnapshot(user), entityId: id, canonical: receipt.canonical,
      details: { title: current.title }, change: changedFields(current, null),
    }),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return lostWriteResponse(c, db, receipt, 'promotion_rules', 'promotion rule', id, expectedUpdatedAt, respond)
  }
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'rule-delete', id }))
  return c.json({ deleted: true })
})

// ---------------------------------------------------------------------------
// Legacy announcement-strip endpoints (each keeps the products gate).

const LINK_TYPES = new Set(['none', 'product', 'url'])
const UNSAFE_LINK_ERROR = { error: 'Use a link that starts with https:// or a page path that starts with /.', code: 'invalid_link_url' }

function normalizeText(value: unknown, maxLen = 500): string {
  return String(value || '').trim().slice(0, maxLen)
}

function normalizeColor(value: unknown): string | null {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null
}

type PromotionInput = {
  title?: unknown
  subtitle?: unknown
  image_path?: unknown
  link_type?: unknown
  link_product_id?: unknown
  link_url?: unknown
  badge_text?: unknown
  badge_color?: unknown
  is_active?: unknown
  sort_order?: unknown
  starts_at?: unknown
  ends_at?: unknown
}

function normalizePromotionInput(body: PromotionInput = {}) {
  const linkType = LINK_TYPES.has(body.link_type as string) ? (body.link_type as string) : 'none'
  return {
    title: normalizeText(body.title, 120),
    subtitle: normalizeText(body.subtitle, 240) || null,
    image_path: normalizeText(body.image_path, 500) || null,
    link_type: linkType,
    link_product_id: linkType === 'product' ? (Number(body.link_product_id) || null) : null,
    link_url: linkType === 'url' ? (normalizeText(body.link_url, 500) || null) : null,
    badge_text: normalizeText(body.badge_text, 40) || null,
    badge_color: normalizeColor(body.badge_color),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
    // null when the caller sent no order: the route decides (keep the current
    // place on edit, go last on create) instead of silently jumping to 0.
    sort_order: body.sort_order == null || String(body.sort_order).trim() === '' || !Number.isFinite(Number(body.sort_order)) ? null : Number(body.sort_order),
    starts_at: body.starts_at ? String(body.starts_at) : null,
    ends_at: body.ends_at ? String(body.ends_at) : null,
  }
}

// Admin: list every promotion (active or not), for the editor.
app.get('/', requireStripRead, async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all()
  return c.json(rows)
})

app.post('/', requireWebsiteEditor, async (c) => {
  const user = c.get('user')
  const body = await readWriteBody(c) as PromotionInput & Record<string, unknown>
  const requestId = readWriteRequestId(body)
  if (!requestId.ok) return c.json(requestId.body, 400)
  const input = normalizePromotionInput(body)
  if (!input.title) return c.json({ error: 'Title required' }, 400)
  if (input.link_type === 'product' && !input.link_product_id) return c.json({ error: 'Choose a product to link to' }, 400)
  if (input.link_type === 'url' && !input.link_url) return c.json({ error: 'Enter a link URL' }, 400)
  if (input.link_type === 'url' && !isSafeLinkUrl(body.link_url)) return c.json(UNSAFE_LINK_ERROR, 400)

  const db = getDb(c.env)
  const receipt: Receipt = {
    key: { actorId: Number(user.id), action: 'create', entity: 'promotion', requestId: requestId.id },
    // sort_order may be null (the server then appends); the intent is what the client sent.
    canonical: canonicalWriteRequest(input),
  }
  const respond: Responder = (row, entityId) => c.json(row ?? { id: entityId, replayed: true })
  const prior = await replayFromReceipt(c, db, receipt, 'promotions', respond)
  if (prior) return prior
  if (input.link_type === 'product') {
    const productExists = await db.prepare('SELECT id FROM products WHERE id = ?').get([input.link_product_id])
    if (!productExists) return c.json({ error: 'Linked product not found' }, 400)
  }
  if (input.sort_order == null) {
    const last = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM promotions').get<{ max_order: number }>()
    input.sort_order = Number(last?.max_order ?? -1) + 1
  }

  const results = await db.batch([
    {
      sql: `INSERT INTO promotions (
        title, subtitle, image_path, link_type, link_product_id, link_url,
        badge_text, badge_color, is_active, sort_order, starts_at, ends_at, updated_at
      ) SELECT @title, @subtitle, @image_path, @link_type, @link_product_id, @link_url,
        @badge_text, @badge_color, @is_active, @sort_order, @starts_at, @ends_at, CURRENT_TIMESTAMP
      WHERE ${receiptAbsentSql()}`,
      params: { ...input, ...receiptParams(receipt.key) },
    },
    receiptAuditStatement({
      key: receipt.key, actorName: actorSnapshot(user), entityIdFromLastInsert: true, canonical: receipt.canonical,
      details: { title: input.title },
    }),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    const twin = await replayFromReceipt(c, db, receipt, 'promotions', respond)
    if (twin) return twin
    return c.json({ error: 'The promotion could not be confirmed. Check the list before retrying.', code: 'write_outcome_unknown', outcome: 'unknown' }, 503)
  }
  const newId = Number(results[0].meta?.last_row_id ?? 0)
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'create', id: newId }))
  const created = await db.prepare('SELECT * FROM promotions WHERE id = ?').get([newId])
  return c.json(created)
})

app.put('/:id', requireWebsiteEditor, async (c) => {
  const user = c.get('user')
  const id = rowId(c.req.param('id'))
  const body = await readWriteBody(c) as PromotionInput & Record<string, unknown>
  const requestId = readWriteRequestId(body)
  if (!requestId.ok) return c.json(requestId.body, 400)
  if (!hasExpectedUpdatedAtField(body)) return c.json(EXPECTED_UPDATED_AT_REQUIRED, 400)
  if (id == null) return c.json({ error: 'Promotion not found' }, 404)
  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  const db = getDb(c.env)

  const input = normalizePromotionInput(body)
  if (!input.title) return c.json({ error: 'Title required' }, 400)
  if (input.link_type === 'product' && !input.link_product_id) return c.json({ error: 'Choose a product to link to' }, 400)
  if (input.link_type === 'url' && !input.link_url) return c.json({ error: 'Enter a link URL' }, 400)
  if (input.link_type === 'url' && !isSafeLinkUrl(body.link_url)) return c.json(UNSAFE_LINK_ERROR, 400)
  const receipt: Receipt = {
    key: { actorId: Number(user.id), action: 'update', entity: 'promotion', requestId: requestId.id },
    canonical: canonicalWriteRequest({ id, expected_updated_at: expectedUpdatedAt, input }),
  }
  const respond: Responder = (row, entityId) => c.json(row ?? { id: entityId, replayed: true })
  // A retry of an edit that committed carries the OLD version, so the receipt is
  // read before the version is checked.
  const prior = await replayFromReceipt(c, db, receipt, 'promotions', respond)
  if (prior) return prior

  const current = await db.prepare('SELECT * FROM promotions WHERE id = ?').get<Record<string, unknown>>([id])
  if (!current) return c.json({ error: 'Promotion not found' }, 404)
  const stale = versionConflict(c, 'promotion', current, expectedUpdatedAt)
  if (stale) return stale
  if (input.link_type === 'product') {
    const productExists = await db.prepare('SELECT id FROM products WHERE id = ?').get([input.link_product_id])
    if (!productExists) return c.json({ error: 'Linked product not found' }, 400)
  }
  // No order sent: the card keeps its place (was: silently moved to 0).
  if (input.sort_order == null) input.sort_order = Number((current as { sort_order?: unknown }).sort_order ?? 0)
  // Nothing changed: nothing is written, audited or broadcast.
  const change = changedFields(current, input as Record<string, unknown>, { keys: Object.keys(input) })
  if (!change) return c.json(current)

  const results = await db.batch([
    {
      sql: `UPDATE promotions SET
        title=@title, subtitle=@subtitle, image_path=@image_path, link_type=@link_type,
        link_product_id=@link_product_id, link_url=@link_url, badge_text=@badge_text,
        badge_color=@badge_color, is_active=@is_active, sort_order=@sort_order,
        starts_at=@starts_at, ends_at=@ends_at, updated_at=CURRENT_TIMESTAMP
      WHERE id=@id AND updated_at IS @expectedUpdatedAt AND ${receiptAbsentSql()}`,
      params: { ...input, id, expectedUpdatedAt, ...receiptParams(receipt.key) },
    },
    receiptAuditStatement({
      key: receipt.key, actorName: actorSnapshot(user), entityId: id, canonical: receipt.canonical, change,
      details: { title: input.title },
    }),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return lostWriteResponse(c, db, receipt, 'promotions', 'promotion', id, expectedUpdatedAt, respond)
  }
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'update', id }))
  const updated = await db.prepare('SELECT * FROM promotions WHERE id = ?').get([id])
  return c.json(updated)
})

// Bulk reorder, for a drag-and-drop editor: body = { order: [id, id, id, ...], client_request_id }
app.put('/reorder/all', requireWebsiteEditor, async (c) => {
  const user = c.get('user')
  const body = await readWriteBody(c) as { order?: unknown[] } & Record<string, unknown>
  const requestId = readWriteRequestId(body)
  if (!requestId.ok) return c.json(requestId.body, 400)
  const order = Array.isArray(body.order) ? body.order : []
  if (!order.length) return c.json({ error: 'order array required' }, 400)

  const db = getDb(c.env)
  const receipt: Receipt = {
    key: { actorId: Number(user.id), action: 'reorder', entity: 'promotion', requestId: requestId.id },
    canonical: canonicalWriteRequest({ order: order.map((id) => Number(id)) }),
  }
  const list = async () => c.json(await db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all())
  const priorReceipt = await findWriteReceipt(db, receipt.key)
  if (priorReceipt) return priorReceipt.canonical === receipt.canonical ? list() : c.json(WRITE_IDEMPOTENCY_CONFLICT, 409)
  // Only the cards whose place actually changes are written: moving one card
  // used to rewrite sort_order and updated_at on every promotion.
  const current = await db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all<{ id: number; sort_order: number | null }>()
  const currentOrder = new Map(current.map((row) => [Number(row.id), row.sort_order]))
  const moved = order
    .map((id, index) => ({ id: Number(id), index }))
    .filter(({ id, index }) => currentOrder.has(id) && Number(currentOrder.get(id)) !== index)
  if (!moved.length) return c.json(current)
  // The receipt rides in the same batch as the moves. The first UPDATE is guarded
  // on the receipt being absent (a racing twin moves nothing); the audit row, which
  // is the receipt, is written only when that first UPDATE changed a row; the
  // remaining moves apply only once the receipt exists.
  const [first, ...rest] = moved
  const results = await db.batch([
    {
      sql: `UPDATE promotions SET sort_order = @index, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND ${receiptAbsentSql()}`,
      params: { index: first.index, id: first.id, ...receiptParams(receipt.key) },
    },
    receiptAuditStatement({
      key: receipt.key, actorName: actorSnapshot(user), entityId: null, canonical: receipt.canonical, details: { order },
    }),
    ...rest.map(({ id, index }) => ({
      sql: `UPDATE promotions SET sort_order = @index, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND NOT ${receiptAbsentSql()}`,
      params: { index, id, ...receiptParams(receipt.key) },
    })),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    const twin = await findWriteReceipt(db, receipt.key)
    if (twin) return twin.canonical === receipt.canonical ? list() : c.json(WRITE_IDEMPOTENCY_CONFLICT, 409)
    return c.json({ error: 'The new order could not be confirmed. Reload the list before retrying.', code: 'write_outcome_unknown', outcome: 'unknown' }, 503)
  }
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'reorder' }))
  // The answer is every card in its stored order, so the editor lands on what the server holds.
  const rows = await db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all()
  return c.json(rows)
})

app.delete('/:id', requireWebsiteEditor, async (c) => {
  const user = c.get('user')
  const id = rowId(c.req.param('id'))
  const body = await readWriteBody(c, true)
  const requestId = readWriteRequestId(body)
  if (!requestId.ok) return c.json(requestId.body, 400)
  if (!hasExpectedUpdatedAtField(body)) return c.json(EXPECTED_UPDATED_AT_REQUIRED, 400)
  if (id == null) return c.json({ error: 'Promotion not found' }, 404)
  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  const db = getDb(c.env)
  const receipt: Receipt = {
    key: { actorId: Number(user.id), action: 'delete', entity: 'promotion', requestId: requestId.id },
    canonical: canonicalWriteRequest({ id, expected_updated_at: expectedUpdatedAt }),
  }
  const respond: Responder = () => c.json({ deleted: true })
  const prior = await replayFromReceipt(c, db, receipt, 'promotions', respond)
  if (prior) return prior

  const current = await db.prepare('SELECT * FROM promotions WHERE id = ?').get<Record<string, unknown>>([id])
  if (!current) return c.json({ error: 'Promotion not found' }, 404)
  const stale = versionConflict(c, 'promotion', current, expectedUpdatedAt)
  if (stale) return stale
  const results = await db.batch([
    {
      sql: `DELETE FROM promotions WHERE id = @id AND updated_at IS @expectedUpdatedAt AND ${receiptAbsentSql()}`,
      params: { id, expectedUpdatedAt, ...receiptParams(receipt.key) },
    },
    receiptAuditStatement({
      key: receipt.key, actorName: actorSnapshot(user), entityId: id, canonical: receipt.canonical,
      details: { title: current.title }, change: changedFields(current, null),
    }),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return lostWriteResponse(c, db, receipt, 'promotions', 'promotion', id, expectedUpdatedAt, respond)
  }
  c.executionCtx.waitUntil(broadcast(c.env, 'promotions', { action: 'delete', id }))
  return c.json({ deleted: true })
})

export default app
