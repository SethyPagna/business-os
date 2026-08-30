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
  'tax_rate',
  'display_currency',
  'pos_show_item_discount',
  'pos_payment_methods',
])

function settingsBucketPermissionFor(key: string): string | null {
  if (BUSINESS_IDENTITY_KEYS.has(key)) return 'business_identity'
  if (SALES_POLICY_KEYS.has(key)) return 'sales_policy'
  return null
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
        ? `You do not have permission to change "${missingBucket}" (requires ${bucket === 'business_identity' ? 'Business identity' : 'Sales policy'} access or full Settings access).`
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
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw)
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
