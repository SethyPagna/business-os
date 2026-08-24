import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth, type SessionUser } from '../lib/auth'

// Ported from backend/src/routes/sync.ts. Read this before touching it --
// the design is NOT "real-time multi-device sync" -- there's no live
// push/pull between devices here, in the legacy backend either. It's an
// *offline outbox replay*: while offline, the client queues writes (create
// a sale, adjust stock, etc) locally; once back online, it POSTs the queued
// batch here, and each operation is replayed against this same Worker's own
// real REST endpoints, one at a time, in order. That's it. No Durable
// Object is needed for the outbox itself -- the legacy version replayed by
// making a loopback HTTP call back into its own Express server
// (`http://127.0.0.1:${PORT}${routePath}`); the Workers-native equivalent
// of "call back into my own server" is Hono's `app.request()`, an in-process
// dispatch with no network hop at all, which is what `createSyncRoute`
// below uses.
//
// The one part of this system that genuinely benefits from a Durable
// Object is the chunked file upload used for large offline attachments
// (see ../durable-objects/syncUploadSession.ts) -- reassembling a
// multi-request binary upload needs a single consistent place to
// accumulate chunks across requests that may land on different edge
// locations, which is exactly what a DO instance-per-uploadId gives you.

const OUTBOX_OPERATION_MAP: Record<string, {
  method: 'POST' | 'PUT' | 'DELETE'
  path: string | ((operation: OutboxOperation) => string)
  onlineOnly?: boolean
}> = {
  'products.create': { method: 'POST', path: '/api/products' },
  'products.update': { method: 'PUT', path: (op) => `/api/products/${encodeURIComponent(String(op.entity_id ?? (op.payload as Record<string, unknown>)?.id ?? ''))}` },
  'products.delete': { method: 'DELETE', path: (op) => `/api/products/${encodeURIComponent(String(op.entity_id ?? (op.payload as Record<string, unknown>)?.id ?? ''))}` },
  'products.variant.create': { method: 'POST', path: '/api/products/variant' },
  'inventory.adjust': { method: 'POST', path: '/api/inventory/adjust' },
  'inventory.transfer': { method: 'POST', path: '/api/inventory/transfer' },
  'branches.create': { method: 'POST', path: '/api/branches' },
  'branches.update': { method: 'PUT', path: (op) => `/api/branches/${encodeURIComponent(String(op.entity_id ?? (op.payload as Record<string, unknown>)?.id ?? ''))}` },
  'contacts.customers.create': { method: 'POST', path: '/api/customers' },
  'contacts.customers.update': { method: 'PUT', path: (op) => `/api/customers/${encodeURIComponent(String(op.entity_id ?? (op.payload as Record<string, unknown>)?.id ?? ''))}` },
  'contacts.suppliers.create': { method: 'POST', path: '/api/suppliers' },
  'contacts.suppliers.update': { method: 'PUT', path: (op) => `/api/suppliers/${encodeURIComponent(String(op.entity_id ?? (op.payload as Record<string, unknown>)?.id ?? ''))}` },
  'sales.create': { method: 'POST', path: '/api/sales' },
  'returns.create': { method: 'POST', path: '/api/returns' },
  'settings.update': { method: 'POST', path: '/api/settings' },
  // Genuinely unsupported on Cloudflare still (kept out of the map so they
  // return 'unsupported_operation' honestly instead of a wrong path):
  // products.discount.update (no dedicated endpoint ported yet),
  // portal.content.update (portal content isn't a separate write endpoint
  // on Cloudflare yet), files.upload (binary uploads go through the
  // chunked flow below, not JSON replay -- matches the legacy backend's
  // own split between the two).
  //
  // categories.*/units.* were removed from this map (2026-08-03 session --
  // see CHANGES-VERIFIED.md). An earlier version mapped them to
  // `/api/categories`/`/api/units` "for parity with the legacy server-side
  // op table", but no such routes are actually mounted anywhere in
  // `cloudflare/src/index.ts` -- `compat.ts` only has
  // `app.use('/categories*', requireAuth)`/`app.use('/units*', requireAuth)`
  // (auth middleware, no handler), so a replay would 404 instead of
  // cleanly rejecting as unsupported. Confirmed today's frontend still
  // never queues these into the offline outbox at all (no
  // `categories.create`/`units.create` operation_id anywhere in
  // `frontend/src`, category/unit management is online-only), so this
  // wasn't a live bug -- but leaving it mapped was a landmine for the day
  // someone does wire it up and trusts the map. If categories/units ever
  // get real Cloudflare routes, re-add these pointed at them.
  dangerous: { method: 'POST', path: '', onlineOnly: true },
  'users.update': { method: 'POST', path: '', onlineOnly: true },
  'roles.update': { method: 'POST', path: '', onlineOnly: true },
  'backup.restore': { method: 'POST', path: '', onlineOnly: true },
  'backup.reset': { method: 'POST', path: '', onlineOnly: true },
  'google.oauth': { method: 'POST', path: '', onlineOnly: true },
}

const MAX_SYNC_OPERATIONS = 50

type OutboxOperation = {
  operation_id: string
  client_request_id: string
  schema_version: number
  base_updated_at: string | null
  payload_digest: string
  payload: Record<string, unknown>
  entity_id?: string | number
  server_updated_at?: string
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const parts = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
  return `{${parts.join(',')}}`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function verifyOperationDigest(operation: OutboxOperation): Promise<boolean> {
  const expected = String(operation.payload_digest || '').trim().toLowerCase()
  if (!expected) return false
  return (await sha256Hex(stableStringify(operation.payload || {}))) === expected
}

function normalizeOperation(raw: Record<string, unknown>): OutboxOperation {
  return {
    operation_id: String(raw.operation_id || raw.type || '').trim(),
    client_request_id: String(raw.client_request_id || raw.id || '').trim(),
    schema_version: Number(raw.schema_version || 0),
    base_updated_at: raw.base_updated_at == null ? null : String(raw.base_updated_at),
    payload_digest: String(raw.payload_digest || '').trim().toLowerCase(),
    payload: (raw.payload && typeof raw.payload === 'object' ? raw.payload : {}) as Record<string, unknown>,
    entity_id: raw.entity_id as string | number | undefined,
    server_updated_at: raw.server_updated_at as string | undefined,
  }
}

function hasWriteConflict(operation: OutboxOperation): boolean {
  const base = String(operation.base_updated_at || '').trim()
  const server = String(operation.server_updated_at || (operation.payload as Record<string, unknown>)?.server_updated_at || '').trim()
  if (!base || !server) return false
  return base !== server
}

type ReplayResult = { status: string; code: string; error?: string; response?: unknown }

async function replayOperation(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  cookieHeader: string | null,
  operation: OutboxOperation,
  route: { method: string; path: string | ((op: OutboxOperation) => string); onlineOnly?: boolean },
): Promise<ReplayResult> {
  if (route.onlineOnly) {
    return { status: 'rejected', code: 'online_only', error: 'This operation must be completed while online.' }
  }
  if (hasWriteConflict(operation)) {
    return { status: 'conflict', code: 'write_conflict', error: 'Server data changed after this offline edit was queued.' }
  }

  const routePath = typeof route.path === 'function' ? route.path(operation) : route.path
  if (!routePath || routePath.includes('%20') || routePath.endsWith('/') || routePath.endsWith('undefined')) {
    return { status: 'failed', code: 'invalid_operation_target', error: 'Operation target is incomplete.' }
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-client-request-id': operation.client_request_id,
  }
  if (cookieHeader) headers.cookie = cookieHeader

  const response = await app.request(routePath, {
    method: route.method,
    headers,
    body: route.method === 'GET' || route.method === 'DELETE' ? undefined : JSON.stringify({
      ...operation.payload,
      client_request_id: operation.client_request_id,
      base_updated_at: operation.base_updated_at,
    }),
  }, env)

  const body = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
  if (response.status === 409) {
    return { status: 'conflict', code: 'write_conflict', error: String(body?.error || 'Server data changed.') }
  }
  if (!response.ok) {
    return { status: 'failed', code: String(body?.code || 'replay_failed'), error: String(body?.error || 'Offline replay failed.') }
  }
  return { status: 'applied', code: 'applied', response: body }
}

// `mainApp` is the fully-assembled Worker app (all routes already mounted) --
// passed in from index.ts, called after every other app.route(...), so the
// closure below always dispatches against a complete router. This avoids a
// circular import (this file never imports index.ts) while still getting
// genuine in-process request replay against the real route handlers.
export function createSyncRoute(mainApp: Hono<{ Bindings: Env }>) {
  const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
  app.use('*', requireAuth)

  app.post('/outbox', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const rawOperations = Array.isArray(body.operations) ? body.operations : []
    const operations = rawOperations.map((raw) => normalizeOperation(raw as Record<string, unknown>))

    if (!operations.length) {
      return c.json({ success: true, results: [], maxOperations: MAX_SYNC_OPERATIONS })
    }
    if (operations.length > MAX_SYNC_OPERATIONS) {
      return c.json({ success: false, code: 'too_many_operations', maxOperations: MAX_SYNC_OPERATIONS, error: 'Sync batch is too large.' }, 413)
    }

    const cookieHeader = c.req.header('cookie') || null
    const results: Array<{ client_request_id: string; operation_id: string } & ReplayResult> = []

    for (const operation of operations) {
      const route = OUTBOX_OPERATION_MAP[operation.operation_id]
      if (!route) {
        results.push({ client_request_id: operation.client_request_id, operation_id: operation.operation_id, status: 'rejected', code: 'unsupported_operation' })
        continue
      }
      if (!operation.client_request_id || !operation.schema_version || !operation.base_updated_at) {
        results.push({ client_request_id: operation.client_request_id, operation_id: operation.operation_id, status: 'rejected', code: 'invalid_operation_metadata' })
        continue
      }
      if (!(await verifyOperationDigest(operation))) {
        results.push({ client_request_id: operation.client_request_id, operation_id: operation.operation_id, status: 'rejected', code: 'payload_digest_failed' })
        continue
      }
      try {
        const result = await replayOperation(mainApp, c.env, cookieHeader, operation, route)
        results.push({ client_request_id: operation.client_request_id, operation_id: operation.operation_id, ...result })
      } catch (error) {
        results.push({
          client_request_id: operation.client_request_id,
          operation_id: operation.operation_id,
          status: 'failed',
          code: 'transient_replay_error',
          error: error instanceof Error ? error.message : 'Offline replay failed.',
        })
      }
    }

    const hasConflict = results.some((result) => result.code === 'write_conflict')
    const hasBlocking = results.some((result) => ['failed', 'rejected', 'conflict'].includes(result.status))
    return c.json({ success: !hasBlocking, results, maxOperations: MAX_SYNC_OPERATIONS }, hasConflict ? 409 : 200)
  })

  // Chunked file upload: each request for a given uploadId is routed to the
  // same Durable Object instance (idFromName(uploadId)), which accumulates
  // chunks and finalizes to R2 + file_assets on /complete. See
  // ../durable-objects/syncUploadSession.ts for why a DO fits this
  // specific piece even though the outbox above doesn't need one.
  app.post('/files/chunks/init', async (c) => {
    const rawBody = await c.req.text()
    let uploadId = 'unknown'
    try {
      const parsed = JSON.parse(rawBody || '{}') as Record<string, unknown>
      const manifest = (parsed.manifest || parsed) as Record<string, unknown>
      uploadId = String(manifest.upload_id || manifest.uploadId || '').trim() || 'unknown'
    } catch { /* handled by the DO's own validation */ }
    const stub = c.env.SYNC_UPLOADS.get(c.env.SYNC_UPLOADS.idFromName(uploadId))
    const upstream = await stub.fetch('https://sync-upload/init', { method: 'POST', body: rawBody, headers: { 'content-type': 'application/json' } })
    return new Response(upstream.body, upstream)
  })

  app.post('/files/chunks/:uploadId/chunk', async (c) => {
    const uploadId = c.req.param('uploadId')
    const stub = c.env.SYNC_UPLOADS.get(c.env.SYNC_UPLOADS.idFromName(uploadId))
    const upstream = await stub.fetch('https://sync-upload/chunk', { method: 'POST', body: await c.req.text(), headers: { 'content-type': 'application/json' } })
    return new Response(upstream.body, upstream)
  })

  app.post('/files/chunks/:uploadId/complete', async (c) => {
    const uploadId = c.req.param('uploadId')
    const stub = c.env.SYNC_UPLOADS.get(c.env.SYNC_UPLOADS.idFromName(uploadId))
    const upstream = await stub.fetch('https://sync-upload/complete', { method: 'POST' })
    return new Response(upstream.body, upstream)
  })

  return app
}
