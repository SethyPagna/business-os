import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { stripSensitiveSettings } from '../lib/settingsSensitive'
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
])

function normalizeReferenceName(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

async function loadPaymentMethods(env: Env): Promise<string[]> {
  const row = await getDb(env).prepare("SELECT value FROM settings WHERE key = 'pos_payment_methods'").get<{ value: string }>()
  try {
    const parsed = JSON.parse(row?.value || '[]')
    return Array.isArray(parsed) ? parsed.map((value) => String(value || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

// Preview and exact replacement for configured payment methods. Report/audit
// evidence is explicit: linked mode updates the live sales reporting dimension
// and itemized tender JSON, while audit logs remain immutable.
app.get('/payment-methods/impact', async (c) => {
  const from = String(c.req.query('from') || '').trim()
  const to = String(c.req.query('to') || '').trim()
  if (!from || !to) return c.json({ error: 'Source and target payment methods are required' }, 400)
  const db = getDb(c.env)
  const sales = Number((await db.prepare("SELECT COUNT(*) AS n FROM sales WHERE lower(trim(COALESCE(payment_method,''))) = @from").get<{ n: number }>({ from: normalizeReferenceName(from) }))?.n || 0)
  const rows = await db.prepare("SELECT payment_details FROM sales WHERE payment_details IS NOT NULL AND trim(payment_details) != ''").all<{ payment_details: string }>()
  let detailLines = 0
  for (const row of rows) {
    try {
      const details = JSON.parse(row.payment_details)
      if (Array.isArray(details)) detailLines += details.filter((detail) => normalizeReferenceName(detail?.method) === normalizeReferenceName(from)).length
    } catch { /* malformed legacy JSON is preserved, never guessed */ }
  }
  const methods = await loadPaymentMethods(c.env)
  return c.json({
    from, to, configured: methods.some((method) => normalizeReferenceName(method) === normalizeReferenceName(from)),
    target_exists: methods.some((method) => normalizeReferenceName(method) === normalizeReferenceName(to)),
    live_snapshots: { sales, payment_detail_lines: detailLines },
    linked_records: sales + detailLines,
    historical_snapshots_preserved: ['audit_logs', 'action history payloads'],
  })
})

app.post('/payment-methods/replace', async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'sales_policy') && !hasPermission(user, 'settings')) return c.json({ error: 'No permission' }, 403)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const from = String(body.from || '').trim()
  const to = String(body.to || '').trim()
  const scope = body.scope === 'linked' ? 'linked' : 'settings_only'
  if (!from || !to) return c.json({ error: 'Source and target payment methods are required' }, 400)
  const fromKey = normalizeReferenceName(from)
  const toKey = normalizeReferenceName(to)
  const methods = await loadPaymentMethods(c.env)
  const next: string[] = []
  const seen = new Set<string>()
  for (const method of methods) {
    const replaced = normalizeReferenceName(method) === fromKey ? to : method
    const key = normalizeReferenceName(replaced)
    if (!key || seen.has(key)) continue
    seen.add(key)
    next.push(replaced)
  }
  if (!seen.has(toKey)) next.push(to)
  const db = getDb(c.env)
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [{
    sql: `INSERT INTO settings (key, value, updated_at) VALUES ('pos_payment_methods', @value, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    params: { value: JSON.stringify(next) },
  }]
  let linkedSales = 0
  let linkedDetails = 0
  if (scope === 'linked') {
    const saleRows = await db.prepare("SELECT id, payment_method, payment_details FROM sales WHERE lower(trim(COALESCE(payment_method,''))) = @from OR (payment_details IS NOT NULL AND trim(payment_details) != '')").all<{ id: number; payment_method: string; payment_details: string | null }>({ from: fromKey })
    for (const sale of saleRows) {
      const summaryMatches = normalizeReferenceName(sale.payment_method) === fromKey
      let detailsChanged = false
      let paymentDetails = sale.payment_details
      if (paymentDetails) {
        try {
          const details = JSON.parse(paymentDetails)
          if (Array.isArray(details)) {
            for (const detail of details) {
              if (normalizeReferenceName(detail?.method) === fromKey) {
                detail.method = to
                detailsChanged = true
                linkedDetails += 1
              }
            }
            if (detailsChanged) paymentDetails = JSON.stringify(details)
          }
        } catch { /* preserve malformed legacy JSON */ }
      }
      if (!summaryMatches && !detailsChanged) continue
      if (summaryMatches) linkedSales += 1
      statements.push({
        sql: `UPDATE sales SET payment_method = @method, payment_details = @details, updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
        params: { method: summaryMatches ? to : sale.payment_method, details: paymentDetails, id: sale.id },
      })
    }
  }
  await db.batch(statements)
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'replace', 'payment_method', null, { from, to, scope, linkedSales, linkedDetails })
  await Promise.all([bumpVersion(c.env, 'settings'), bumpVersion(c.env, 'sales')])
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'payment_method_replace', from, to, scope }))
  return c.json({ success: true, methods: next, scope, linkedSales, linkedDetails })
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
