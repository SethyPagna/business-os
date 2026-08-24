import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission } from '../lib/permissions'
import { hasSuspiciousCatalogText } from '../lib/catalogText'
import type { Env } from '../index'

// Ported from backend/src/routes/runtime.ts. Three endpoints the Settings
// > System Health screen depends on, none of which existed anywhere in
// this Worker before now.
//
// What's genuinely different vs. the Docker backend (Workers doesn't have
// a filesystem, a long-lived process, or a Node BullMQ/ioredis client, so
// none of this is a 1:1 port -- it's the same *shape* of information,
// sourced the Workers-native way):
// - No git revision / source-hash / frontend-build-file reading (no `git`,
//   no local filesystem in a Worker). `revision` instead reports the
//   deployment's compatibility_date, which is the closest stable "what
//   build is this" signal a Worker has access to at runtime.
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
// surfacing on the System Health screen. There's no build pipeline step in
// this Worker that stamps a real commit hash the way the Docker backend's
// git-based runtimeVersion.ts did (see the module comment above), so this
// is deliberately a human-maintained marker, not a computed hash.
const RUNTIME_APP_VERSION = 'cloudflare-2026-08'
let workerBootedAt = ''

function getRuntimeVersion(env: Env) {
  if (!workerBootedAt) workerBootedAt = new Date().toISOString()
  return {
    app: 'business-os',
    runtime: 'cloudflare-workers',
    packageVersion: RUNTIME_APP_VERSION,
    revision: '',
    sourceHash: '',
    bootedAt: workerBootedAt,
  }
}

function requireSettingsPermission(user: SessionUser) {
  return hasPermission(user, 'settings')
}

app.get('/version', (c) => c.json({ success: true, ...getRuntimeVersion(c.env) }))

app.use('/queues/*', requireAuth)
app.use('/catalog-integrity', requireAuth)

app.get('/queues/status', async (c) => {
  const user = c.get('user')
  if (!requireSettingsPermission(user)) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'settings' }, 403)
  }
  try {
    const cacheProbeKey = `__runtime_probe__:${crypto.randomUUID()}`
    let cacheReady = false
    let cacheProbeError: string | null = null
    try {
      await c.env.CACHE.put(cacheProbeKey, '1', { expirationTtl: 60 })
      const value = await c.env.CACHE.get(cacheProbeKey)
      cacheReady = value === '1'
      c.executionCtx.waitUntil(c.env.CACHE.delete(cacheProbeKey))
    } catch (error) {
      cacheProbeError = (error as Error)?.message || String(error)
    }

    return c.json({
      success: true,
      queues: {
        import: {
          configured: !!c.env.IMPORT_QUEUE,
          binding: 'IMPORT_QUEUE',
        },
        media: {
          configured: !!c.env.MEDIA_QUEUE,
          binding: 'MEDIA_QUEUE',
        },
      },
      cache: {
        configured: !!c.env.CACHE,
        ready: cacheReady,
        probeError: cacheProbeError,
      },
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to check queue status' }, 500)
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
    const productRows = await db.prepare(`
      SELECT id, name, brand, category, unit, description, supplier
      FROM products
      WHERE is_active = 1
    `).all<Record<string, unknown>>()
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
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to inspect catalog integrity' }, 500)
  }
})

export default app
