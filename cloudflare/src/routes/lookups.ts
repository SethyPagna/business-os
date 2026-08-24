import { Hono, type Context } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { hasPermission } from '../lib/permissions'
import { assertCatalogTextIntegrity, normalizeCatalogText } from '../lib/catalogText'
import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'

// Categories and units ("lookups"), ported from backend/src/routes/categories.ts
// and backend/src/routes/units.ts. Both admin pages were 404ing on Cloudflare
// because only GET existed (in routes/compat.ts) -- create/rename/delete never
// had a route at all. This file replaces that stub with the real thing,
// including the rename-merges-into-duplicate behavior the Docker backend has
// (renaming "Drinks" to an existing "Beverages" merges the two instead of
// erroring), and reassigns/clears the matching text on every product row so
// the catalog never points at a deleted category/unit.

type LookupKind = 'category' | 'unit'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
// Scoped to the two path prefixes this router actually owns, NOT '*'.
// See index.ts: this router is mounted at the bare `/api` prefix, so a
// `app.use('*', ...)` here registers as `/api/*` middleware and runs for
// every OTHER `/api/...` route mounted after it too. Confirmed live
// against a local Worker: that leak made `/api/organizations/search` and
// `/api/organizations/bootstrap` -- both deliberately public, both called
// by the LOGIN screen before anyone has a session -- return
// 401 invalid_session, so the organization picker could never load and
// login was impossible on a fresh browser.
// routes/compat.ts already had exactly this fix (see its own NOTE about
// the same 401-everything symptom); it was simply never applied to this
// file, contacts.ts, or users.ts, which share the identical mount + `'*'`
// shape.
// Registered as an exact path AND a subtree wildcard per prefix. Hono does
// not treat a bare trailing `*` (`/categories*`) as a wildcard -- verified
// live: that form matched nothing at all and silently left these routes
// completely UNAUTHENTICATED, which is worse than the leak it was meant to
// fix. `/categories` + `/categories/*` is the form Hono actually matches.
for (const prefix of ['/categories', '/units']) {
  app.use(prefix, requireAuth)
  app.use(`${prefix}/*`, requireAuth)
}
// Both backend/src/routes/units.ts and categories.ts gate every *write*
// route behind requirePermission('products') (categories/units are catalog
// metadata, same permission bucket as products) -- kept as a per-route
// check below, not a blanket one, for a real reason found this session:
// a blanket `app.use('*', ...)` here previously gated GET too, so any
// authenticated user without the 'products' permission (a cashier-only
// role, for instance) got a 403 reading the plain category/unit list --
// not just a 404/empty result, a hard failure that loadCategoryOptions
// (POS.tsx) quietly swallowed into "the Category filter section just
// never appears" (its `categories.length > 0` guard in FilterPanel.tsx
// never becomes true). Read access to "what categories/units exist" isn't
// sensitive the way create/rename/delete is -- POS, Inventory, and the
// public portal's own product listings all already expose category names
// to any authenticated (POS) or even anonymous (portal) reader; the only
// thing that actually needs gating is *writing* to this shared lookup
// table. GET stays open to any authenticated user (requireAuth above);
// every mutating verb gets its own `requireProductsPermission` check.
function requireProductsPermission(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>): Response | null {
  if (!hasPermission(c.get('user'), 'products')) {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'products' }, 403)
  }
  return null
}

const DEFAULT_COLOR = '#6366f1'

function normalizeLookupText(value: unknown): string {
  return normalizeCatalogText(value) || ''
}

function normalizeLower(value: unknown): string {
  return normalizeLookupText(value).toLowerCase()
}

function normalizeColor(value: unknown): string {
  const raw = String(value ?? '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : DEFAULT_COLOR
}

function conflict(error: unknown) {
  if (error instanceof WriteConflictError) {
    const { body, status } = writeConflictResponse(error)
    return { body, status }
  }
  return null
}

function registerLookupRoutes(kind: LookupKind, table: 'categories' | 'units', productColumn: 'category' | 'unit') {
  app.get(`/${table}`, async (c) => {
    const rows = await getDb(c.env).prepare(`SELECT * FROM ${table} ORDER BY lower(name) ASC`).all()
    return c.json(rows || [])
  })

  app.post(`/${table}`, async (c) => {
    const denied = requireProductsPermission(c)
    if (denied) return denied
    const user = c.get('user')
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const name = normalizeLookupText(body.name)
    if (!name) return c.json({ error: 'Name required' }, 400)
    try {
      assertCatalogTextIntegrity({ name }, ['name'], kind === 'category' ? 'Category name' : 'Unit name')
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Name looks corrupted' }, 400)
    }

    const db = getDb(c.env)
    const duplicate = await db.prepare(`SELECT id FROM ${table} WHERE lower(trim(name)) = lower(trim(@name)) LIMIT 1`).get({ name })
    if (duplicate) return c.json({ error: `${kind === 'category' ? 'Category' : 'Unit'} already exists` }, 400)

    const color = normalizeColor(body.color)
    const result = await db.prepare(`INSERT INTO ${table} (name, color, updated_at) VALUES (@name, @color, CURRENT_TIMESTAMP)`).run({ name, color })
    const id = result.lastInsertRowid
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', kind, id, { name })
    const item = await db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get({ id })
    c.executionCtx.waitUntil(broadcast(c.env, table, { action: 'create', id }))
    return c.json(item)
  })

  async function updateHandler(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>) {
    const denied = requireProductsPermission(c)
    if (denied) return denied
    const user = c.get('user')
    const id = Number(c.req.param('id'))
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const name = normalizeLookupText(body.name)
    if (!id) return c.json({ error: `Invalid ${kind}` }, 400)
    if (!name) return c.json({ error: 'Name required' }, 400)
    try {
      assertCatalogTextIntegrity({ name }, ['name'], kind === 'category' ? 'Category name' : 'Unit name')
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Name looks corrupted' }, 400)
    }

    const db = getDb(c.env)
    const current = await db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get<Record<string, unknown>>({ id })
    if (!current) return c.json({ error: `${kind === 'category' ? 'Category' : 'Unit'} not found` }, 404)
    try {
      assertUpdatedAtMatch(kind, current, getExpectedUpdatedAt(body))
    } catch (error) {
      const result = conflict(error)
      if (result) return c.json(result.body, result.status)
      throw error
    }

    const color = normalizeColor(body.color)
    const duplicate = await db.prepare(`SELECT * FROM ${table} WHERE id != @id AND lower(trim(name)) = lower(trim(@name)) LIMIT 1`).get<Record<string, unknown>>({ id, name })
    const normalizedCurrent = normalizeLower(current.name)

    let responseRow: Record<string, unknown> | undefined
    let mergedIntoId: number | null = null

    if (duplicate) {
      await db.batch([
        { sql: `UPDATE ${table} SET name = @name, color = @color, updated_at = CURRENT_TIMESTAMP WHERE id = @id`, params: { name, color, id: duplicate.id } },
        { sql: `UPDATE products SET ${productColumn} = @name, updated_at = CURRENT_TIMESTAMP WHERE lower(trim(${productColumn})) IN (@a, @b)`, params: { name, a: normalizedCurrent, b: normalizeLower(name) } },
        { sql: `DELETE FROM ${table} WHERE id = @id`, params: { id } },
      ])
      responseRow = await db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get({ id: duplicate.id })
      mergedIntoId = Number(duplicate.id)
    } else {
      await db.batch([
        { sql: `UPDATE ${table} SET name = @name, color = @color, updated_at = CURRENT_TIMESTAMP WHERE id = @id`, params: { name, color, id } },
        { sql: `UPDATE products SET ${productColumn} = @name, updated_at = CURRENT_TIMESTAMP WHERE lower(trim(${productColumn})) = @current`, params: { name, current: normalizedCurrent } },
      ])
      responseRow = await db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get({ id })
    }

    await audit(c.env, user?.id ?? null, user?.name ?? null, duplicate ? 'merge' : 'update', kind, mergedIntoId || id, { name, merged_from_id: duplicate ? id : null })
    c.executionCtx.waitUntil(broadcast(c.env, table, { action: duplicate ? 'merge' : 'update', id: mergedIntoId || id }))
    return c.json({ ...responseRow, merged: !!duplicate, merged_from_id: duplicate ? id : null })
  }

  app.put(`/${table}/:id`, updateHandler)
  app.patch(`/${table}/:id`, updateHandler)

  app.delete(`/${table}/:id`, async (c) => {
    const denied = requireProductsPermission(c)
    if (denied) return denied
    const user = c.get('user')
    const id = c.req.param('id')
    const db = getDb(c.env)
    const current = await db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get<Record<string, unknown>>({ id })
    if (!current) return c.json({ error: `${kind === 'category' ? 'Category' : 'Unit'} not found` }, 404)

    const query = Object.fromEntries(new URL(c.req.url).searchParams)
    let bodyForConflict: Record<string, unknown> = query
    try {
      bodyForConflict = (await c.req.json<Record<string, unknown>>().catch(() => query)) as Record<string, unknown>
    } catch (_) {
      // no body sent -- fall back to query params, matching the Docker backend
    }
    try {
      assertUpdatedAtMatch(kind, current, getExpectedUpdatedAt(bodyForConflict))
    } catch (error) {
      const result = conflict(error)
      if (result) return c.json(result.body, result.status)
      throw error
    }

    const normalizedCurrent = normalizeLower(current.name)
    await db.batch([
      { sql: `UPDATE products SET ${productColumn} = NULL, updated_at = CURRENT_TIMESTAMP WHERE lower(trim(${productColumn})) = @current`, params: { current: normalizedCurrent } },
      { sql: `DELETE FROM ${table} WHERE id = @id`, params: { id } },
    ])
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'delete', kind, id, { name: current.name, cleared_products: true })
    c.executionCtx.waitUntil(broadcast(c.env, table, { action: 'delete', id }))
    return c.json({})
  })
}

registerLookupRoutes('category', 'categories', 'category')
registerLookupRoutes('unit', 'units', 'unit')

export default app
