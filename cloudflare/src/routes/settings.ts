import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { stripSensitiveSettings } from '../lib/settingsSensitive'
// Shared with routes/sales.ts, which folds a method into this list the moment
// a sale uses one. Both sides use the same rules so an automatic registration
// and this file's manual backfill can never disagree about what counts as
// "already configured", or resurrect a retired method.
import {
  MAX_CONFIGURED_METHODS,
  MAX_METHOD_LENGTH,
  mergePaymentMethods,
  parseConfiguredMethods,
  parseConfiguredMethodsStrict,
  paymentMethodKey,
  saleMethodsUsed,
} from '../lib/paymentMethodRegistry'
import { renameSalePaymentMethod } from '../lib/paymentSettlement'
import { normalizedHaystackSql } from '../lib/searchMatch'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

// The full settings table can hold anything an admin has configured, not
// just customer-facing portal branding -- the original backend
// (backend/src/routes/settings.ts) requires auth on every endpoint here,
// including plain reads. This was a real bug in an earlier version of this
// port: GET / had no requireAuth, making the entire settings table publicly
// readable. Public portal branding is served through a separate, curated
// endpoint instead -- see routes/portal.ts's GET /config -- which only
// returns an explicit whitelist of customer-facing fields, not this table.
app.use('*', requireAuth)

async function getSettingsUpdatedAt(env: Env, keys?: string[]): Promise<string | null> {
  const db = getDb(env)
  if (keys && keys.length) {
    // A per-key `IN (?,?,?...)` placeholder list used to be built here --
    // one bound parameter per key. That's fine for a handful of keys, but
    // D1 hard-caps bound parameters at 100 per statement: once a save
    // touched ~100 settings keys at once (this app's settings page saves
    // its whole section in one request, not just the changed fields), the
    // query itself threw `D1_ERROR: too many SQL variables` -- which
    // index.ts's global onError() then flattened into the generic "Write
    // failed... Something went wrong processing that request" toast, with
    // no indication this was a fixed, deterministic cap being hit rather
    // than a transient fault. json_each() expands the whole key list from
    // a single bound JSON-string parameter instead, so this scales to any
    // number of keys with exactly one placeholder.
    const row = await db.prepare(
      `SELECT MAX(updated_at) AS updated_at FROM settings WHERE key IN (SELECT value FROM json_each(@keysJson))`,
    ).get<{ updated_at: string | null }>({ keysJson: JSON.stringify(keys) })
    if (row?.updated_at) return row.updated_at
  }
  const row = await db.prepare('SELECT MAX(updated_at) AS updated_at FROM settings').get<{ updated_at: string | null }>()
  return row?.updated_at || new Date().toISOString()
}

// Keep the settings conflict payload scoped to exactly the fields the client
// was editing.  Sending the whole settings table would leak unrelated
// configuration into a conflict response and would make it far too easy for
// a retry to overwrite another page's work.
async function getSettingsValues(env: Env, keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {}
  const db = getDb(env)
  const rows = await db.prepare(
    `SELECT key, value FROM settings WHERE key IN (SELECT value FROM json_each(@keysJson))`,
  ).all<{ key: string; value: string }>({ keysJson: JSON.stringify(keys) })
  return rows.reduce<Record<string, string>>((values, row) => {
    values[row.key] = row.value
    return values
  }, {})
}

app.get('/', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  // Secret-bearing keys (Drive OAuth tokens etc.) never leave the Worker --
  // see lib/settingsSensitive.ts. requireAuth alone is not enough here:
  // every logged-in cashier gets this map.
  return c.json({ ...stripSensitiveSettings(map), updatedAt: await getSettingsUpdatedAt(c.env) })
})

// Real, confirmed bug (traced from a live user report of "Portal settings
// changed on another device" firing on essentially every save of the
// customer-portal editor, even though nothing else was touching those
// fields): this endpoint always returned the GLOBAL max updated_at across
// EVERY row in the settings table, but POST /'s own conflict check scopes
// its comparison to only the specific keys being written
// (`getSettingsUpdatedAt(c.env, attemptedKeys)` above). Any settings save
// ANYWHERE in the app -- switching theme, editing receipt settings, an
// unrelated toggle -- bumps that global max. The portal editor writes ~60
// customer_portal_* keys in one request; by the time the person clicks
// Save, it's overwhelmingly likely some unrelated setting was touched more
// recently than those specific keys, so the client's cached global
// "expectedUpdatedAt" almost never equals the server's per-key-scoped
// actual value -- a near-guaranteed false conflict, not an occasional one.
// A small single-key save (e.g. a lone toggle) rarely hits this in
// practice since it's often itself the most-recently-touched row, which is
// why "the other pages are working" while the portal editor reliably
// failed. Fix: accept an optional `keys` query param (comma-separated) and
// scope the same way POST / already does, so a caller that knows which
// keys it's about to write can ask "what's the real current version of
// THOSE keys" instead of "what's the newest anything in this whole table".
app.get('/meta', async (c) => {
  const keysParam = c.req.query('keys')
  const keys = keysParam
    ? keysParam.split(',').map((key) => key.trim()).filter(Boolean)
    : undefined
  return c.json({ updatedAt: await getSettingsUpdatedAt(c.env, keys) })
})

// POST / -- bulk upsert, matching the real backend's shape exactly (not a
// PUT /:key single-setting endpoint, which is what an earlier version of
// this port invented and which the real frontend never calls). Any key in
// the body except expectedUpdatedAt/expected_updated_at/updatedAt is
// treated as a setting to write.
const METADATA_KEYS = new Set(['expectedUpdatedAt', 'expected_updated_at', 'updatedAt', 'updated_at'])

// Per-field settings permissions (this session). The Permission Editor has
// long offered `business_identity`/`sales_policy` as independently
// grantable rows under the Settings section ("Business identity, logo,
// public profile" / "Sales, return, and financial policy"), but this route
// used to check only the single blanket `settings` key for every field in
// the body -- a real looks-wired-but-isn't gap: granting a user just
// `business_identity` let them see the Permission Editor say so, but they
// still couldn't save a single settings field, including their own
// business-identity ones, because the route never looked at that key.
// Fixed by partitioning the write into buckets and checking each key
// against the bucket it actually belongs to. Any settings key NOT listed
// in a bucket below (appearance/typography, navigation layout, timezone,
// notifications, audit log retention, etc.) still falls under the plain
// `settings` grant only -- those were never offered as their own
// Permission Editor row, so narrowing them now would be a scope change,
// not a bug fix.
//
// `security_settings` ("Security and sign-in settings") is deliberately
// NOT wired to a bucket here -- traced this against the whole app and
// found no admin-configurable security/sign-in settings feature exists
// anywhere to gate (UserProfileModal.tsx's own "security settings
// updated" toast is a user's own password/2FA self-service, unrelated to
// this admin grant and correctly ungated since it's their own account).
// `security_settings` stays a defined, grantable permission key with
// nothing behind it yet -- flagged in progress.md as needing either a
// real feature or a decision to remove the row, not guessed at here.
const BUSINESS_IDENTITY_KEYS = new Set([
  'business_name',
  'business_phone',
  'business_address',
  'business_email',
  'tax_id',
  'business_website',
  'ui_app_favicon_image',
  'ui_app_favicon_fit',
  'ui_app_favicon_zoom',
  'ui_app_favicon_position_x',
  'ui_app_favicon_position_y',
])
const SALES_POLICY_KEYS = new Set([
  'currency_usd_symbol',
  'currency_khr_symbol',
  'exchange_rate',
  // Separate USD->KHR rate applied only to change handed back to the customer
  // (business rule, Aug 31 2026). Buckets with the main rate under sales_policy.
  'change_exchange_rate',
  'tax_rate',
  // S4-30: the owner's on/off for tax. Buckets with the rate it governs, so a
  // 'sales_policy' settings user can turn tax off without needing 'all'.
  'tax_enabled',
  'display_currency',
  'pos_show_item_discount',
  'pos_payment_methods',
  // The wholesale auto-apply automation ("wholesale only > N", 2026-09-04).
  // It decides what a customer is charged, so it belongs with tax_rate and
  // the exchange rates under sales_policy rather than the blanket `settings`
  // grant -- a shop can hand someone pricing policy without handing them the
  // whole settings table.
  'pos_wholesale_auto_enabled',
  'pos_wholesale_auto_min_qty',
  // The owner's master switch for membership points (user, Sep 4 2026: "make
  // the membership points on off in settings"). Buckets here with tax_enabled
  // for the same reason: it decides what a customer is charged and what they
  // accrue, so a shop can hand someone sales policy without handing them the
  // whole settings table.
  'loyalty_points_enabled',
])

function normalizeReferenceName(value: unknown): string {
  return paymentMethodKey(value)
}

const PAYMENT_METHOD_SCAN_PAGE_SIZE = 200

type PaymentMethodSettingSnapshot = {
  raw: string
  updatedAt: string | null
  methods: string[]
}

type PaymentMethodSaleRow = {
  id: number
  receipt_number: string | null
  cashier_name: string | null
  customer_name: string | null
  customer_phone: string | null
  branch_name: string | null
  payment_method: string | null
  payment_details: string | null
  write_revision: number
}

type PaymentMethodImpactSummary = {
  candidateCount: number
  linkedSales: number
  linkedDetails: number
  summaryMatches: number
  splitSummarySales: number
  malformedSales: number
  malformedSaleIds: number[]
}

const PAYMENT_SUMMARY_SOURCE_MATCH_SQL = `EXISTS(
  WITH RECURSIVE split(rest,token) AS (
    SELECT COALESCE(s.payment_method,'') || '+',''
    UNION ALL
    SELECT substr(rest,instr(rest,'+')+1),trim(substr(rest,1,instr(rest,'+')-1))
    FROM split WHERE rest!=''
  )
  SELECT 1 FROM split WHERE lower(token)=@source
)`

const PAYMENT_METHOD_CANDIDATE_WHERE = `(
  ${PAYMENT_SUMMARY_SOURCE_MATCH_SQL}
  OR EXISTS(
    SELECT 1 FROM json_each(CASE WHEN json_valid(s.payment_details) THEN s.payment_details ELSE '[]' END) detail
    WHERE lower(trim(COALESCE(json_extract(detail.value,'$.method'),'')))=@source
  )
  OR (
    s.payment_details IS NOT NULL AND NOT json_valid(s.payment_details)
    AND instr(lower(s.payment_details),@source)>0
  )
)`

const VALID_PAYMENT_DETAILS_SQL = `(
  s.payment_details IS NOT NULL AND trim(s.payment_details)!=''
  AND json_valid(s.payment_details) AND json_type(s.payment_details)='array'
)`

const PAYMENT_DETAILS_RENAME_SQL = `(
  SELECT json_group_array(json(
    CASE WHEN lower(trim(COALESCE(json_extract(detail.value,'$.method'),'')))=@source
      THEN json_set(detail.value,'$.method',@target)
      ELSE detail.value END
  ))
  FROM json_each(s.payment_details) detail
)`

const PAYMENT_SUMMARY_FROM_DETAILS_SQL = `(
  SELECT group_concat(method,' + ') FROM (
    SELECT method,MIN(ordinal) AS first_ordinal FROM (
      SELECT CASE WHEN lower(trim(COALESCE(json_extract(detail.value,'$.method'),'')))=@source
        THEN @target ELSE trim(COALESCE(json_extract(detail.value,'$.method'),'')) END AS method,
        CAST(detail.key AS INTEGER) AS ordinal
      FROM json_each(s.payment_details) detail
    ) renamed_methods
    WHERE method!=''
    GROUP BY lower(method)
    ORDER BY first_ordinal
  )
)`

const PAYMENT_SUMMARY_FROM_TEXT_SQL = `(
  WITH RECURSIVE split(rest,token,ordinal) AS (
    SELECT COALESCE(s.payment_method,'') || '+','',0
    UNION ALL
    SELECT substr(rest,instr(rest,'+')+1),trim(substr(rest,1,instr(rest,'+')-1)),ordinal+1
    FROM split WHERE rest!=''
  ), renamed AS (
    SELECT CASE WHEN lower(token)=@source THEN @target ELSE token END AS method,ordinal
    FROM split WHERE token!=''
  )
  SELECT group_concat(method,' + ') FROM (
    SELECT method,MIN(ordinal) AS first_ordinal FROM renamed
    GROUP BY lower(method)
    ORDER BY first_ordinal
  )
)`

const PAYMENT_METHOD_RENAMED_SUMMARY_SQL = `CASE
  WHEN ${VALID_PAYMENT_DETAILS_SQL} AND json_array_length(s.payment_details)>0
    THEN ${PAYMENT_SUMMARY_FROM_DETAILS_SQL}
  ELSE ${PAYMENT_SUMMARY_FROM_TEXT_SQL}
END`

const PAYMENT_METHOD_SEARCH_SQL = normalizedHaystackSql(`(
  COALESCE(s.receipt_number,'') || ' ' || COALESCE(s.cashier_name,'') || ' ' ||
  COALESCE(s.customer_name,'') || ' ' || COALESCE(s.customer_phone,'') || ' ' ||
  COALESCE(s.branch_name,'') || ' ' || COALESCE(${PAYMENT_METHOD_RENAMED_SUMMARY_SQL},'')
)`)

const PAYMENT_METHOD_MALFORMED_RELEVANT_SQL = `(
  ${PAYMENT_METHOD_CANDIDATE_WHERE}
  AND s.payment_details IS NOT NULL AND trim(s.payment_details)!=''
  AND (
    NOT json_valid(s.payment_details)
    OR json_type(s.payment_details)!='array'
    OR EXISTS(
      SELECT 1 FROM json_each(CASE WHEN json_valid(s.payment_details) AND json_type(s.payment_details)='array' THEN s.payment_details ELSE '[]' END) detail
      WHERE json_type(detail.value)!='object'
        OR trim(COALESCE(json_extract(detail.value,'$.method'),''))=''
        OR length(trim(COALESCE(json_extract(detail.value,'$.method'),'')))>${MAX_METHOD_LENGTH}
        OR EXISTS(
          SELECT 1 FROM json_each(json_array('amount_usd','amount_khr')) amount_field
          WHERE json_type(detail.value,'$.' || amount_field.value) NOT IN ('null','integer','real','text')
            OR (
              json_type(detail.value,'$.' || amount_field.value) IN ('integer','real')
              AND CAST(json_extract(detail.value,'$.' || amount_field.value) AS REAL)<0
            )
            OR (
              json_type(detail.value,'$.' || amount_field.value)='text'
              AND trim(CAST(json_extract(detail.value,'$.' || amount_field.value) AS TEXT))!=''
              AND (
                NOT json_valid('[' || trim(CAST(json_extract(detail.value,'$.' || amount_field.value) AS TEXT)) || ']')
                OR json_type('[' || trim(CAST(json_extract(detail.value,'$.' || amount_field.value) AS TEXT)) || ']','$[0]') NOT IN ('integer','real')
                OR CAST(json_extract(detail.value,'$.' || amount_field.value) AS REAL)<0
              )
            )
        )
    )
  )
)`

function validMethodName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const method = value.trim()
  return method && method.length <= MAX_METHOD_LENGTH ? method : null
}

function paymentMethodListForWrite(raw: unknown): string[] | null {
  let values: unknown = raw
  if (typeof raw === 'string') {
    try { values = JSON.parse(raw) } catch { return null }
  }
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_CONFIGURED_METHODS) return null
  if (values.some((value) => !validMethodName(value))) return null
  const normalized = parseConfiguredMethods(values)
  return normalized.length ? normalized : null
}

async function loadPaymentMethodSetting(env: Env): Promise<PaymentMethodSettingSnapshot | null> {
  const row = await getDb(env).prepare(
    "SELECT value,updated_at FROM settings WHERE key='pos_payment_methods'",
  ).get<{ value: string; updated_at: string | null }>()
  const parsed = parseConfiguredMethodsStrict(row?.value)
  if (!row || !parsed.ok) return null
  let supplied: unknown
  try { supplied = JSON.parse(row.value) } catch { return null }
  if (!Array.isArray(supplied) || supplied.length !== parsed.methods.length || supplied.some((value) => !validMethodName(value))) return null
  const suppliedKeys = supplied.map(paymentMethodKey)
  if (new Set(suppliedKeys).size !== suppliedKeys.length) return null
  return { raw: row.value, updatedAt: row.updated_at ?? null, methods: parsed.methods }
}

function paymentSummaryMatches(raw: unknown, source: string): { matches: number; split: boolean } {
  const tokens = String(raw ?? '').split('+').map((part) => part.trim()).filter(Boolean)
  return {
    matches: tokens.filter((token) => paymentMethodKey(token) === source).length,
    split: tokens.length > 1,
  }
}

function malformedPaymentDetails(raw: unknown): boolean {
  if (raw == null || String(raw).trim() === '') return false
  let parsed: unknown
  try { parsed = JSON.parse(String(raw)) } catch { return true }
  if (!Array.isArray(parsed)) return true
  return parsed.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true
    const detail = entry as Record<string, unknown>
    if (!validMethodName(detail.method)) return true
    return ['amount_usd', 'amount_khr'].some((field) => {
      const value = detail[field]
      if (value == null || value === '') return false
      if (!['number', 'string'].includes(typeof value)) return true
      if (typeof value === 'string') {
        const text = value.trim()
        if (!text) return false
        try {
          const parsed = JSON.parse(`[${text}]`)
          if (!Array.isArray(parsed) || typeof parsed[0] !== 'number') return true
        } catch { return true }
      }
      const numeric = Number(value)
      return !Number.isFinite(numeric) || numeric < 0
    })
  })
}

async function loadPaymentMethodCandidates(
  env: Env,
  from: string,
  to: string,
): Promise<PaymentMethodImpactSummary> {
  const db = getDb(env)
  const source = paymentMethodKey(from)
  const summary: PaymentMethodImpactSummary = {
    candidateCount: 0,
    linkedSales: 0,
    linkedDetails: 0,
    summaryMatches: 0,
    splitSummarySales: 0,
    malformedSales: 0,
    malformedSaleIds: [],
  }
  let afterId = 0
  for (;;) {
    const rows = await db.prepare(`
      SELECT s.id,s.receipt_number,s.cashier_name,s.customer_name,s.customer_phone,s.branch_name,
             s.payment_method,s.payment_details,COALESCE(v.revision,0) AS write_revision
      FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id
      WHERE s.id>@afterId AND ${PAYMENT_METHOD_CANDIDATE_WHERE}
      ORDER BY s.id LIMIT @pageSize
    `).all<PaymentMethodSaleRow>({ source, afterId, pageSize: PAYMENT_METHOD_SCAN_PAGE_SIZE })
    if (!rows.length) break
    summary.candidateCount += rows.length
    for (const row of rows) {
      if (malformedPaymentDetails(row.payment_details)) {
        summary.malformedSales += 1
        if (summary.malformedSaleIds.length < 20) summary.malformedSaleIds.push(Number(row.id))
        continue
      }
      const renamed = renameSalePaymentMethod(row.payment_method, row.payment_details, from, to)
      if (!renamed.ok) {
        if (renamed.relevant) {
          summary.malformedSales += 1
          if (summary.malformedSaleIds.length < 20) summary.malformedSaleIds.push(Number(row.id))
        }
        continue
      }
      if (!renamed.changed) continue
      const currentSummary = paymentSummaryMatches(row.payment_method, source)
      summary.linkedSales += 1
      summary.linkedDetails += renamed.detailMatches
      summary.summaryMatches += currentSummary.matches
      if (currentSummary.matches > 0 && currentSummary.split) summary.splitSummarySales += 1
    }
    afterId = Number(rows[rows.length - 1].id)
    if (rows.length < PAYMENT_METHOD_SCAN_PAGE_SIZE) break
  }
  return summary
}

/**
 * Methods that sales already use but Settings does not list.
 *
 * From Sep 4 2026 a live sale registers its own methods (routes/sales.ts), so
 * this closes the OTHER half: every sale recorded before that, plus every
 * imported historical row, whose methods were never folded in. It is a read;
 * the write is the POST below, because pulling a legacy CSV's spellings into
 * the checkout list is an operator's decision, not something a GET should do
 * behind their back.
 *
 * Reads `payment_method` only, not `payment_details`: the summary column is
 * built from the detail methods joined with ' + ' by every writer in the
 * system, and `saleMethodsUsed` splits it back apart -- so one cheap DISTINCT
 * over a low-cardinality column sees exactly the same method set as a full
 * scan of the JSON would, without reading 15k JSON blobs.
 */
app.get('/payment-methods/unregistered', async (c) => {
  const rows = await getDb(c.env).prepare(
    "SELECT DISTINCT payment_method FROM sales WHERE payment_method IS NOT NULL AND trim(payment_method) != ''",
  ).all<{ payment_method: string }>()
  const configured = parseConfiguredMethods((await getDb(c.env).prepare("SELECT value FROM settings WHERE key = 'pos_payment_methods'").get<{ value: string }>())?.value)
  const used = rows.flatMap((row) => saleMethodsUsed({ payment_method: row.payment_method }))
  const merged = mergePaymentMethods(configured, used)
  return c.json({ configured, missing: merged.added, missing_count: merged.added.length })
})

app.post('/payment-methods/backfill', async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'sales_policy') && !hasPermission(user, 'settings')) return c.json({ error: 'No permission' }, 403)
  const db = getDb(c.env)
  const rows = await db.prepare(
    "SELECT DISTINCT payment_method FROM sales WHERE payment_method IS NOT NULL AND trim(payment_method) != ''",
  ).all<{ payment_method: string }>()
  const configured = parseConfiguredMethods((await db.prepare("SELECT value FROM settings WHERE key = 'pos_payment_methods'").get<{ value: string }>())?.value)
  const merged = mergePaymentMethods(configured, rows.flatMap((row) => saleMethodsUsed({ payment_method: row.payment_method })))
  if (!merged.changed) return c.json({ methods: merged.methods, added: [] })
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('pos_payment_methods', @value, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run({ value: JSON.stringify(merged.methods) })
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'settings', 'pos_payment_methods', {
    action: 'payment_methods_backfill',
    added: merged.added,
  })
  c.executionCtx.waitUntil(Promise.all([bumpVersion(c.env, 'settings'), bumpVersion(c.env, 'sales')]))
  return c.json({ methods: merged.methods, added: merged.added })
})

// Preview and exact replacement for configured payment methods. Report/audit
// evidence is explicit: linked mode updates the live sales reporting dimension
// and itemized tender JSON, while audit logs remain immutable.
app.get('/payment-methods/impact', async (c) => {
  const from = String(c.req.query('from') || '').trim()
  const to = String(c.req.query('to') || '').trim()
  if (!from || !to || from.length > MAX_METHOD_LENGTH || to.length > MAX_METHOD_LENGTH) {
    return c.json({ error: `Source and target payment methods are required and must be at most ${MAX_METHOD_LENGTH} characters.` }, 400)
  }
  if (from === to) return c.json({ error: 'Source and target payment methods are already identical.' }, 400)
  const setting = await loadPaymentMethodSetting(c.env)
  if (!setting) {
    return c.json({ error: 'Configured payment methods are unreadable. Repair them before renaming a method.', code: 'invalid_payment_methods_setting' }, 409)
  }
  const impact = await loadPaymentMethodCandidates(c.env, from, to)
  const sourceKey = paymentMethodKey(from)
  const targetKey = paymentMethodKey(to)
  return c.json({
    from,
    to,
    configured: setting.methods.some((method) => paymentMethodKey(method) === sourceKey),
    configured_methods: setting.methods,
    target_exists: setting.methods.some((method) => paymentMethodKey(method) === targetKey),
    settings_updated_at: setting.updatedAt,
    live_snapshots: {
      sales: impact.linkedSales,
      payment_detail_lines: impact.linkedDetails,
      summary_matches: impact.summaryMatches,
      split_summary_sales: impact.splitSummarySales,
      malformed_sales: impact.malformedSales,
    },
    malformed_sale_ids: impact.malformedSaleIds,
    linked_records: impact.linkedSales + impact.linkedDetails,
    historical_snapshots_preserved: ['audit_logs', 'action history payloads'],
  })
})

app.post('/payment-methods/replace', async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'sales_policy') && !hasPermission(user, 'settings')) return c.json({ error: 'No permission' }, 403)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const from = String(body.from || '').trim()
  const to = String(body.to || '').trim()
  if (body.scope !== 'linked' && body.scope !== 'settings_only') return c.json({ error: 'Choose whether linked sales should be updated.' }, 400)
  const scope = body.scope
  if (!from || !to || from.length > MAX_METHOD_LENGTH || to.length > MAX_METHOD_LENGTH) {
    return c.json({ error: `Source and target payment methods are required and must be at most ${MAX_METHOD_LENGTH} characters.` }, 400)
  }
  if (from === to) return c.json({ error: 'Source and target payment methods are already identical.' }, 400)
  const fromKey = normalizeReferenceName(from)
  const toKey = normalizeReferenceName(to)
  if (fromKey === toKey && scope !== 'linked') {
    return c.json({ error: 'A spelling-only rename must update linked sales at the same time.', code: 'linked_rename_required' }, 409)
  }
  const setting = await loadPaymentMethodSetting(c.env)
  if (!setting) {
    return c.json({ error: 'Configured payment methods are unreadable. Repair them before renaming a method.', code: 'invalid_payment_methods_setting' }, 409)
  }
  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  if (expectedUpdatedAt && expectedUpdatedAt !== setting.updatedAt) {
    return c.json({
      error: 'Payment methods changed after this review. Refresh and try again.',
      code: 'write_conflict',
      conflict: true,
      expectedUpdatedAt,
      actualUpdatedAt: setting.updatedAt,
      current: { updated_at: setting.updatedAt, configured_methods: setting.methods },
    }, 409)
  }
  if (!setting.methods.some((method) => paymentMethodKey(method) === fromKey)) {
    return c.json({
      error: 'The source payment method is no longer configured. Refresh and review the rename again.',
      code: 'write_conflict',
      conflict: true,
      current: { updated_at: setting.updatedAt, configured_methods: setting.methods },
    }, 409)
  }
  const next: string[] = []
  const seen = new Set<string>()
  for (const method of setting.methods) {
    const keyBefore = normalizeReferenceName(method)
    const replaced = keyBefore === fromKey || keyBefore === toKey ? to : method
    const key = normalizeReferenceName(replaced)
    if (!key || seen.has(key)) continue
    seen.add(key)
    next.push(replaced)
  }
  if (!seen.has(toKey)) next.push(to)
  if (!next.length || next.length > MAX_CONFIGURED_METHODS) {
    return c.json({ error: 'The resulting payment-method list is invalid.', code: 'invalid_payment_methods_setting' }, 400)
  }
  const db = getDb(c.env)
  const impact = await loadPaymentMethodCandidates(c.env, from, to)
  if (scope === 'linked' && impact.malformedSales > 0) {
    return c.json({
      error: `${impact.malformedSales} linked sale${impact.malformedSales === 1 ? '' : 's'} have unreadable payment allocations. Repair them before renaming this method.`,
      code: 'malformed_payment_details',
      malformed_sales: impact.malformedSales,
      malformed_sale_ids: impact.malformedSaleIds,
    }, 409)
  }

  const stamp = new Date().toISOString()
  const operationId = crypto.randomUUID()
  const nextRaw = JSON.stringify(next)
  const saleRevisionRow = scope === 'linked'
    ? await db.prepare('SELECT COALESCE(SUM(revision),0) AS revision_sum FROM sale_write_revisions').get<{ revision_sum: number }>()
    : null
  const expectedSaleRevisionSum = Number(saleRevisionRow?.revision_sum || 0)
  const auditDetails = {
    action: 'payment_method_replace',
    operationId,
    from,
    to,
    scope,
    configuredBefore: setting.methods,
    configuredAfter: next,
  }
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [
    { sql: 'DELETE FROM sale_mutation_guards', params: {} },
    {
      sql: `INSERT INTO sale_mutation_guards(id,guard_value)
            SELECT 1,CASE WHEN
              EXISTS(SELECT 1 FROM settings WHERE key='pos_payment_methods' AND value=@expectedRaw)
              ${scope === 'linked' ? `AND COALESCE((SELECT SUM(revision) FROM sale_write_revisions),0)=@expectedSaleRevisionSum
              AND NOT EXISTS(SELECT 1 FROM sales s WHERE ${PAYMENT_METHOD_MALFORMED_RELEVANT_SQL})` : ''}
            THEN 1 ELSE 0 END`,
      params: { expectedRaw: setting.raw, expectedSaleRevisionSum, source: fromKey },
    },
    {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value,device_name,device_tz,created_at)
            SELECT @userId,@userName,'replace','payment_method',@operationId,
              json_set(@details,'$.linkedSales',${scope === 'linked' ? `(SELECT COUNT(*) FROM sales s WHERE ${PAYMENT_METHOD_CANDIDATE_WHERE})` : '0'},
                '$.linkedDetails',${scope === 'linked' ? `(SELECT COUNT(*) FROM sales s,json_each(CASE WHEN json_valid(s.payment_details) AND json_type(s.payment_details)='array' THEN s.payment_details ELSE '[]' END) detail WHERE lower(trim(COALESCE(json_extract(detail.value,'$.method'),'')))=@source)` : '0'}),
              'payment_method',@operationId,
              json_set(@details,'$.linkedSales',${scope === 'linked' ? `(SELECT COUNT(*) FROM sales s WHERE ${PAYMENT_METHOD_CANDIDATE_WHERE})` : '0'},
                '$.linkedDetails',${scope === 'linked' ? `(SELECT COUNT(*) FROM sales s,json_each(CASE WHEN json_valid(s.payment_details) AND json_type(s.payment_details)='array' THEN s.payment_details ELSE '[]' END) detail WHERE lower(trim(COALESCE(json_extract(detail.value,'$.method'),'')))=@source)` : '0'}),
              (SELECT device_name FROM user_sessions WHERE user_id=@userId AND revoked_at IS NULL ORDER BY last_seen_at DESC,id DESC LIMIT 1),
              (SELECT device_tz FROM user_sessions WHERE user_id=@userId AND revoked_at IS NULL ORDER BY last_seen_at DESC,id DESC LIMIT 1),
              @stamp`,
      params: { userId: user?.id ?? null, userName: user?.name ?? null, operationId, details: JSON.stringify(auditDetails), source: fromKey, stamp },
    },
    {
      sql: `INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods',@value,@stamp)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      params: { value: nextRaw, stamp },
    },
  ]
  if (scope === 'linked') {
    statements.push({
      sql: `UPDATE sales AS s SET
              payment_method=${PAYMENT_METHOD_RENAMED_SUMMARY_SQL},
              payment_details=CASE WHEN ${VALID_PAYMENT_DETAILS_SQL} THEN ${PAYMENT_DETAILS_RENAME_SQL} ELSE s.payment_details END,
              search_normalized=${PAYMENT_METHOD_SEARCH_SQL},
              updated_at=@stamp
            WHERE ${PAYMENT_METHOD_CANDIDATE_WHERE}`,
      params: { source: fromKey, target: to, stamp },
    })
  }
  statements.push({ sql: 'DELETE FROM sale_mutation_guards', params: {} })
  try {
    await db.batch(statements)
  } catch (error) {
    if (/guard_value/i.test(String(error))) {
      return c.json({ error: 'Payment methods or linked sales changed during the rename. Refresh and try again.', code: 'write_conflict', conflict: true }, 409)
    }
    throw error
  }
  const auditRow = await db.prepare('SELECT details FROM audit_logs WHERE entity_id=@operationId AND entity=\'payment_method\'').get<{ details: string }>({ operationId })
  let committedCounts = { linkedSales: scope === 'linked' ? impact.linkedSales : 0, linkedDetails: scope === 'linked' ? impact.linkedDetails : 0 }
  try {
    const parsed = JSON.parse(auditRow?.details || '{}') as { linkedSales?: number; linkedDetails?: number }
    committedCounts = { linkedSales: Number(parsed.linkedSales || 0), linkedDetails: Number(parsed.linkedDetails || 0) }
  } catch { /* the committed audit row remains the authoritative evidence */ }
  await Promise.all([bumpVersion(c.env, 'settings'), bumpVersion(c.env, 'sales')])
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'payment_method_replace', from, to, scope }))
  return c.json({ success: true, methods: next, scope, ...committedCounts, settings_updated_at: stamp })
})

// Customer-portal content buckets (Part 557 slice 8): the storefront editor is
// broken into per-area grants so a role (e.g. an employee) can be given exactly
// the areas it should manage. Posts/FAQ/About each get their own key; every
// OTHER customer_portal_* key (branding, theme, catalog display, social, AI,
// maps, translations, publish, loyalty, submissions) falls under the catch-all
// `customer_portal` "portal config" grant. Like the buckets above, holding the
// broad `settings` grant (or admin) satisfies any of these, so no existing
// Settings admin regresses.
const PORTAL_POSTS_KEYS = new Set([
  'customer_portal_promo_items',
  'customer_portal_promotions_title',
  'customer_portal_promotions_intro',
  'customer_portal_show_promotions',
])
const PORTAL_FAQ_KEYS = new Set([
  'customer_portal_faq_items',
  'customer_portal_faq_title',
  'customer_portal_show_faq',
])
const PORTAL_ABOUT_KEYS = new Set([
  'customer_portal_about_title',
  'customer_portal_about_content',
  'customer_portal_about_blocks',
  'customer_portal_show_about',
])

function settingsBucketPermissionFor(key: string): string | null {
  if (BUSINESS_IDENTITY_KEYS.has(key)) return 'business_identity'
  if (SALES_POLICY_KEYS.has(key)) return 'sales_policy'
  if (PORTAL_POSTS_KEYS.has(key)) return 'portal_posts'
  if (PORTAL_FAQ_KEYS.has(key)) return 'portal_faq'
  if (PORTAL_ABOUT_KEYS.has(key)) return 'portal_about'
  // Every remaining storefront-editor key is "portal config".
  if (key.startsWith('customer_portal_')) return 'customer_portal'
  return null
}

// Human labels for the bucket error message, so a rejected save names the exact
// grant the caller is missing rather than a bare permission key.
const SETTINGS_BUCKET_LABELS: Record<string, string> = {
  business_identity: 'Business identity',
  sales_policy: 'Sales policy',
  portal_posts: 'Manage portal posts',
  portal_faq: 'Manage portal FAQ',
  portal_about: 'Manage portal About',
  customer_portal: 'Manage portal config',
}

// Section 4 (2026-09-02 RC): the receipt's "Text contrast" setting
// (Normal | Maximum black) lives inside the opaque receipt_template JSON
// blob, same as font family/size/alignment/etc. Every other template field
// is untouched here -- the frontend already merges it against its own
// defaults (receiptAppliedConfig.ts's normalizeReceiptTemplate) and this
// route otherwise just stores whatever JSON string the client sent, like
// every other settings key. text_contrast gets its own server-side guard
// because an invalid value here would change how EVERY future receipt
// renders (all-black vs normal), not just redraw one widget, so it is
// enum-validated on write rather than trusted like the rest of the blob.
// Anything other than the literal 'maximum' resolves to the 'normal'
// default. Mirrors frontend/src/utils/receiptTextContrast.ts's
// normalizeReceiptTextContrast -- duplicated rather than imported because
// the Worker and the frontend are separate packages (cloudflare/tsconfig.json
// only includes "src"; there is no cross-package import path).
function sanitizeReceiptTemplateValue(raw: unknown): string {
  const asString = typeof raw === 'string' ? raw : JSON.stringify(raw)
  let parsed: Record<string, unknown>
  try {
    const candidate = JSON.parse(asString)
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return asString
    parsed = candidate as Record<string, unknown>
  } catch {
    // Malformed JSON is preserved as-is (same "never guess at unparsable
    // legacy data" stance the rest of this file takes), not discarded.
    return asString
  }
  parsed.text_contrast = parsed.text_contrast === 'maximum' ? 'maximum' : 'normal'
  return JSON.stringify(parsed)
}

app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<Record<string, unknown>>()
  const attemptedKeys = Object.keys(body).filter((key) => !METADATA_KEYS.has(key))
  if (attemptedKeys.length === 0) {
    return c.json({ error: 'No settings provided' }, 400)
  }

  // No shortcuts on writes: this is an all-or-nothing check across every
  // key in the request, not a silent per-key partial apply -- a save that
  // includes one field the caller can't touch is rejected outright, named
  // by permission bucket, matching the app's own "no silent partial
  // writes" standard elsewhere. A key with its own bucket permission
  // (`business_identity`/`sales_policy`) is allowed through by holding
  // EITHER that specific grant OR the broader `settings` grant (holding
  // `settings` implies every narrower settings permission, same as
  // lib/permissions.ts's hasPermission() already encodes for these two
  // keys). A key with no bucket falls back to requiring plain `settings`.
  const missingBucket = attemptedKeys.find((key) => {
    const bucket = settingsBucketPermissionFor(key)
    if (bucket) return !hasPermission(user, bucket) && !hasPermission(user, 'settings')
    return !hasPermission(user, 'settings')
  })
  if (missingBucket) {
    const bucket = settingsBucketPermissionFor(missingBucket)
    return c.json({
      error: bucket
        ? `You do not have permission to change "${missingBucket}" (requires ${SETTINGS_BUCKET_LABELS[bucket] || bucket} access or full Settings access).`
        : 'You do not have permission to perform this action',
    }, 403)
  }

  // The ordinary Settings save may add, remove, or reorder methods, but it
  // must not provide a quiet second route for changing the canonical casing
  // of a method that is already present on sales. That correction belongs to
  // the impact-reviewed linked replacement above. Normalize duplicate input
  // identities here so the persisted chooser can never contain FCB and fcb.
  if (attemptedKeys.includes('pos_payment_methods')) {
    const normalized = paymentMethodListForWrite(body.pos_payment_methods)
    if (!normalized) {
      return c.json({ error: 'Payment methods must be a non-empty JSON list of bounded names.', code: 'invalid_payment_methods_setting' }, 400)
    }
    const current = await loadPaymentMethodSetting(c.env)
    if (current) {
      const spellingOnlyChange = current.methods.find((method) => {
        const replacement = normalized.find((candidate) => paymentMethodKey(candidate) === paymentMethodKey(method))
        return replacement !== undefined && replacement !== method
      })
      if (spellingOnlyChange) {
        return c.json({
          error: `Rename "${spellingOnlyChange}" through the reviewed payment-method rename action so linked sales stay consistent.`,
          code: 'linked_rename_required',
        }, 409)
      }
    }
    body.pos_payment_methods = JSON.stringify(normalized)
  }

  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  if (expectedUpdatedAt) {
    const currentUpdatedAt = await getSettingsUpdatedAt(c.env, attemptedKeys)
    try {
      assertUpdatedAtMatch('settings', { updated_at: currentUpdatedAt }, expectedUpdatedAt)
    } catch (error) {
      if (error instanceof WriteConflictError) {
        const { body: conflictBody, status } = writeConflictResponse(error)
        // The client uses these values to distinguish an unrelated update
        // from a real edit to one of its own fields before it retries.  The
        // generic `current` record only has an updated_at timestamp here.
        return c.json({
          ...conflictBody,
          currentSettings: await getSettingsValues(c.env, attemptedKeys),
        }, status)
      }
      throw error
    }
  }

  const db = getDb(c.env)
  const statements = attemptedKeys.map((key) => {
    const raw = body[key]
    const value = key === 'receipt_template' ? sanitizeReceiptTemplateValue(raw) : (typeof raw === 'string' ? raw : JSON.stringify(raw))
    return {
      sql: `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      params: { key, value },
    }
  })
  await db.batch(statements)

  const updatedAt = await getSettingsUpdatedAt(c.env)
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'settings', null, { keys: attemptedKeys })
  // 6.3 (reproduced live by the Part-400 sweep): the portal caches its
  // config/catalog responses keyed on a version this route never bumped,
  // so every customer_portal_* save -- map embed included, the user's
  // "stale cache of embedded sites" -- served the OLD value until the TTL
  // died (~60s). Settings writes now carry their own version; the portal
  // cache key composes it (see portalCacheVersion).
  c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'update', keys: attemptedKeys }))
  return c.json({ updatedAt, keys: attemptedKeys })
})

export default app
