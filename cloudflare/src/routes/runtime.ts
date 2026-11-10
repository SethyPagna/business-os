import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, isAdminControlUser } from '../lib/permissions'
import { buildAuditStatement, changedFields } from '../lib/audit'
import { getMaintenance } from '../lib/maintenance'
import { ONLINE_METHOD_STORED_SQL, ONLINE_PAYMENT_METHOD_KEY } from '../lib/onlineOrderFulfil'
import {
  KNOWN_READ_SWITCHES, buildFlipStatements, formatSwitchToken, isKnownReadSwitch, parseFlipState,
  parseReadSwitches, primeReadSwitches, serializeReadSwitches, splitSwitchRows, SWITCH_ROWS_PARAMS, SWITCH_ROWS_SQL, type ReadSwitches,
} from '../lib/readSwitches'
import { hasSuspiciousCatalogText } from '../lib/catalogText'
import { getBuildStamp } from '../lib/buildStamp'
import { getPlanLimits, resolvePlanTier } from '../lib/planTier'
import { evaluateCronHealth, parseRotationState, CRON_STATE_KEY, CRON_HEAVY_STATE_KEY, CRON_HEAVY_TICK_MS, CRON_ROTATION_TICK_MS } from '../lib/cronRotation'
import { ROTATION_STEP_IDS, HEAVY_STEP_IDS } from '../lib/cronStepIds'
import type { Env } from '../index'

// Ported from backend/src/routes/runtime.ts. Three endpoints the Settings
// > System Health screen depends on, none of which existed anywhere in
// this Worker before now.
//
// What's genuinely different vs. the Docker backend (Workers doesn't have
// a filesystem, a long-lived process, or a Node BullMQ/ioredis client, so
// none of this is a 1:1 port -- it's the same *shape* of information,
// sourced the Workers-native way):
// - No frontend-build-file reading (no local filesystem in a Worker). The
//   git revision and source hash ARE reported: they are substituted into the
//   bundle at build time from `--define` flags (see lib/buildStamp.ts and
//   scripts/deploy.cjs), the same way frontend/vite.config.ts stamps the SPA.
//   A build that reports 'dev' here was deployed without going through that
//   path, which is itself worth seeing.
// - No BullMQ/ioredis "queue depth" introspection -- Cloudflare Queues
//   doesn't expose a public API for a consumer Worker to introspect its own
//   queue depth. `queues.status` instead reports binding presence (is the
//   producer wired up at all) plus a live round-trip probe (send + let the
//   consumer's own success/failure speak for itself via Cloudflare's
//   dashboard), which answers the operationally important question --
//   "is this queue configured and reachable" -- without needing an API
//   Cloudflare doesn't offer.
// - Cache status pings the real KV binding (put+get+delete of a throwaway
//   key) instead of a Redis PING.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

const PRODUCT_CATALOG_FIELDS = ['name', 'brand', 'category', 'unit', 'description', 'supplier'] as const
const SUSPICIOUS_PRODUCT_SAMPLE_LIMIT = 25
const SUSPICIOUS_BRAND_OPTION_LIMIT = 100

// Bumped by hand when a release changes runtime-visible behavior worth
// surfacing on the System Health screen. This is a human-maintained marker,
// NOT build provenance -- it did not change across any of the three Sep-3
// deploys. `revision` and `sourceHash` below are the computed values; read
// those when you need to know what is running.
const RUNTIME_APP_VERSION = 'cloudflare-2026-08'
let workerBootedAt = ''

function getRuntimeVersion(env: Env) {
  if (!workerBootedAt) workerBootedAt = new Date().toISOString()
  const stamp = getBuildStamp()
  return {
    app: 'business-os',
    runtime: 'cloudflare-workers',
    packageVersion: RUNTIME_APP_VERSION,
    revision: stamp.revision,
    sourceHash: stamp.sourceHash,
    builtAt: stamp.builtAt,
    bootedAt: workerBootedAt,
    // Which plan this deployment was built for -- the ONE readout every
    // other surface reuses (GET /runtime/version, the auth bootstrap, the
    // integration doctor). Read from the deploy-time PLAN_TIER var, never
    // inferred from which bindings happen to be present.
    tier: resolvePlanTier(env),
  }
}

function requireSettingsPermission(user: SessionUser) {
  return hasPermission(user, 'settings')
}

app.get('/version', (c) => c.json({ success: true, ...getRuntimeVersion(c.env) }))

app.use('/catalog-integrity', requireAuth)
app.use('/cron-health', requireAuth)

// Health row for the rotating cron: which background step ran when, which are
// failing, killed mid-step (CPU limit) or starved. Settings permission, like
// the other diagnostics; no personal data in it.
app.get('/cron-health', async (c) => {
  const user = c.get('user')
  if (!requireSettingsPermission(user)) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'settings' }, 403)
  }
  try {
    const db = getDb(c.env)
    const read = async (key: string) => (await db.prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key }))?.value
    const now = Date.now()
    // A state that has never been written is 'pending', not unhealthy, until this build is older than one tick.
    const deployedAt = Date.parse(getBuildStamp().builtAt)
    const rotation = evaluateCronHealth(parseRotationState(await read(CRON_STATE_KEY)), ROTATION_STEP_IDS, now, CRON_ROTATION_TICK_MS, deployedAt)
    const heavy = evaluateCronHealth(parseRotationState(await read(CRON_HEAVY_STATE_KEY)), HEAVY_STEP_IDS, now, CRON_HEAVY_TICK_MS, deployedAt)
    return c.json({
      success: true,
      healthy: rotation.healthy && heavy.healthy,
      problems: [...rotation.problems, ...heavy.problems],
      stateUpdatedAt: rotation.stateUpdatedAt,
      stale: rotation.stale,
      pending: rotation.pending || heavy.pending,
      steps: [...rotation.steps, ...heavy.steps],
      heavy: { stateUpdatedAt: heavy.stateUpdatedAt, stale: heavy.stale },
    })
  } catch (error) {
    // The detail stays in the Worker log; the response carries nothing from the database or runtime.
    console.error('[runtime/cron-health] failed:', (error as Error)?.message || error)
    return c.json({ success: false, error: 'Failed to read cron health' }, 500)
  }
})

function createProductFieldCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const field of PRODUCT_CATALOG_FIELDS) counts[field] = 0
  return counts
}

function collectSuspiciousProductFields(row: Record<string, unknown>, fieldCounts: Record<string, number>): string[] {
  const fields: string[] = []
  for (const field of PRODUCT_CATALOG_FIELDS) {
    if (!hasSuspiciousCatalogText(row?.[field])) continue
    fieldCounts[field] += 1
    fields.push(field)
  }
  return fields
}

function summarizeSuspiciousProducts(productRows: Record<string, unknown>[]) {
  const productFieldCounts = createProductFieldCounts()
  const suspiciousProducts: Array<{ id: number | null; name: string; fields: string[] }> = []
  let suspiciousProductCount = 0

  for (const row of productRows) {
    const fields = collectSuspiciousProductFields(row, productFieldCounts)
    if (!fields.length) continue
    suspiciousProductCount += 1
    if (suspiciousProducts.length >= SUSPICIOUS_PRODUCT_SAMPLE_LIMIT) continue
    suspiciousProducts.push({
      id: Number(row.id || 0) || null,
      name: String(row.name || '').trim(),
      fields,
    })
  }

  return { productFieldCounts, suspiciousProducts, suspiciousProductCount }
}

function parseJsonArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function summarizeSuspiciousTextValues(values: unknown[], limit: number) {
  const sample: string[] = []
  let count = 0
  for (const rawValue of values) {
    const value = String(rawValue || '').trim()
    if (!hasSuspiciousCatalogText(value)) continue
    count += 1
    if (sample.length < limit) sample.push(value)
  }
  return { count, sample }
}

app.get('/catalog-integrity', async (c) => {
  const user = c.get('user')
  if (!requireSettingsPermission(user)) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'settings' }, 403)
  }
  try {
    const db = getDb(c.env)
    // Bounded, and honest about it. This used to select every active
    // product with no LIMIT at all; on the free plan that is both a 10 ms
    // CPU budget and a 5,000,000-rows-read-per-day D1 ceiling being spent by
    // a diagnostic screen. Reading cap + 1 rows is what lets the response
    // distinguish "the whole catalog was checked" from "there is more",
    // rather than silently truncating and reporting a clean bill of health
    // for a catalog it never looked at.
    const catalogIntegrityMaxProducts = getPlanLimits(c.env).catalogIntegrityMaxProducts
    const scanned = await db.prepare(`
      SELECT id, name, brand, category, unit, description, supplier
      FROM products
      WHERE is_active = 1
      ORDER BY id
      LIMIT ${catalogIntegrityMaxProducts + 1}
    `).all<Record<string, unknown>>()
    const catalogPartial = scanned.length > catalogIntegrityMaxProducts
    const productRows = catalogPartial ? scanned.slice(0, catalogIntegrityMaxProducts) : scanned
    const { productFieldCounts, suspiciousProducts, suspiciousProductCount } = summarizeSuspiciousProducts(productRows)

    const brandOptionsRow = await db.prepare("SELECT value FROM settings WHERE key = 'product_brand_options'").get<{ value: string }>()
    const suspiciousBrandOptions = summarizeSuspiciousTextValues(
      parseJsonArray(brandOptionsRow?.value || '[]'),
      SUSPICIOUS_BRAND_OPTION_LIMIT,
    )

    return c.json({
      success: true,
      runtime: getRuntimeVersion(c.env),
      summary: {
        suspicious_products: suspiciousProductCount,
        suspicious_brand_options: suspiciousBrandOptions.count,
        product_field_counts: productFieldCounts,
      },
      suspiciousProducts,
      suspiciousBrandOptions: suspiciousBrandOptions.sample,
      // Null when the whole catalog was covered, so the presence of a code
      // IS the condition the UI keys off (same shape as the import
      // preflight's partialCode).
      partial: catalogPartial,
      checkedProducts: productRows.length,
      maxCheckedProducts: catalogIntegrityMaxProducts,
      partialCode: catalogPartial ? 'catalog_integrity_partial' : null,
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to inspect catalog integrity' }, 500)
  }
})


const SWITCH_FLIP_FIELDS = ['name', 'state', 'expectedEpoch']
async function storedSwitches(db: ReturnType<typeof getDb>): Promise<string | null> {
  return splitSwitchRows(await db.prepare(SWITCH_ROWS_SQL).all<{ key: string; value: string }>(SWITCH_ROWS_PARAMS)).switchesRaw
}
function switchListing(env: Env, current: ReadSwitches) {
  return {
    epoch: current.epoch,
    setAt: current.setAt,
    setBy: current.setBy,
    switches: KNOWN_READ_SWITCHES.map((name) => ({ name, state: current.switches[name].state, rate: current.switches[name].rate })),
    memoSeconds: getPlanLimits(env).readSwitchMemoSeconds,
  }
}

app.use('/read-switches', requireAuth)

app.get('/read-switches', async (c) => {
  if (!isAdminControlUser(c.get('user'))) return c.json({ success: false, error: 'No permission', code: 'forbidden' }, 403)
  const current = parseReadSwitches(await storedSwitches(getDb(c.env)))
  primeReadSwitches(c.env, current)
  return c.json({ success: true, ...switchListing(c.env, current) })
})

app.put('/read-switches', async (c) => {
  const user = c.get('user')
  if (!isAdminControlUser(user)) return c.json({ success: false, error: 'No permission', code: 'forbidden' }, 403)
  const body: unknown = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ success: false, error: 'A flip needs a JSON object.', code: 'read_switch_body' }, 400)
  const { name, state, expectedEpoch } = body as Record<string, unknown>
  if (Object.keys(body).some((field) => !SWITCH_FLIP_FIELDS.includes(field))) return c.json({ success: false, error: 'Only name, state and expectedEpoch are accepted.', code: 'read_switch_body' }, 400)
  if (!isKnownReadSwitch(name)) return c.json({ success: false, error: 'Unknown switch.', code: 'read_switch_unknown' }, 400)
  const target = parseFlipState(state)
  if (!target) return c.json({ success: false, error: 'State must be off, on or shadow:<rate>.', code: 'read_switch_state' }, 400)
  if (typeof expectedEpoch !== 'number' || !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0) return c.json({ success: false, error: 'expectedEpoch must be a whole number.', code: 'read_switch_epoch' }, 400)

  const db = getDb(c.env)
  const storedRaw = await storedSwitches(db)
  const current = parseReadSwitches(storedRaw)
  if (current.epoch !== expectedEpoch) return c.json({ success: false, error: 'The switches changed since this page loaded.', code: 'read_switch_epoch_stale', epoch: current.epoch }, 409)
  const from = formatSwitchToken(current.switches[name])
  const to = formatSwitchToken(target)
  if (from === to) {
    primeReadSwitches(c.env, current)
    return c.json({ success: true, changed: false, ...switchListing(c.env, current) })
  }

  const needsMethod = name === 'online_orders' && target.state === 'on'
  if (needsMethod) {
    const method = await db.prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string | null }>({ key: ONLINE_PAYMENT_METHOD_KEY })
    if (!String(method?.value ?? '').trim()) return c.json({ success: false, error: 'Choose the online payment method in Settings before turning online orders on.', code: 'online_method_required' }, 409)
  }

  const epoch = current.epoch + 1
  const value = serializeReadSwitches(storedRaw, { name, entry: target }, { epoch, setAt: new Date().toISOString(), setBy: user.id })
  const record = buildAuditStatement(user.id, user.name, 'read_switch_set', 'read_switch', name,
    { name, from, to, epochBefore: current.epoch, epochAfter: epoch }, changedFields({ state: from, epoch: current.epoch }, { state: to, epoch }))
  try {
    await db.batch(buildFlipStatements({ record, value, expected: storedRaw, off: target.state === 'off', requirement: needsMethod ? ONLINE_METHOD_STORED_SQL : undefined }))
  } catch (error) {
    const after = await storedSwitches(db)
    if (after !== value) {
      if (after !== storedRaw) return c.json({ success: false, error: 'The switches changed since this page loaded.', code: 'read_switch_epoch_stale', epoch: parseReadSwitches(after).epoch }, 409)
      if (needsMethod && !String((await db.prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string | null }>({ key: ONLINE_PAYMENT_METHOD_KEY }))?.value ?? '').trim()) return c.json({ success: false, error: 'Choose the online payment method in Settings before turning online orders on.', code: 'online_method_required' }, 409)
      if (target.state !== 'off' && await getMaintenance(c.env)) return c.json({ success: false, error: 'Writes are held; only OFF is allowed now.', code: 'read_switch_maintenance' }, 503)
      throw error
    }
  }
  const written = parseReadSwitches(value)
  primeReadSwitches(c.env, written)
  return c.json({ success: true, changed: true, ...switchListing(c.env, written) })
})

export default app
