import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
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
    const placeholders = keys.map(() => '?').join(',')
    const row = await db.prepare(`SELECT MAX(updated_at) AS updated_at FROM settings WHERE key IN (${placeholders})`).get<{ updated_at: string | null }>(keys)
    if (row?.updated_at) return row.updated_at
  }
  const row = await db.prepare('SELECT MAX(updated_at) AS updated_at FROM settings').get<{ updated_at: string | null }>()
  return row?.updated_at || new Date().toISOString()
}

app.get('/', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return c.json({ ...map, updatedAt: await getSettingsUpdatedAt(c.env) })
})

app.get('/meta', async (c) => {
  return c.json({ updatedAt: await getSettingsUpdatedAt(c.env) })
})

// POST / -- bulk upsert, matching the real backend's shape exactly (not a
// PUT /:key single-setting endpoint, which is what an earlier version of
// this port invented and which the real frontend never calls). Any key in
// the body except expectedUpdatedAt/expected_updated_at/updatedAt is
// treated as a setting to write.
const METADATA_KEYS = new Set(['expectedUpdatedAt', 'expected_updated_at', 'updatedAt', 'updated_at'])

app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<Record<string, unknown>>()
  const attemptedKeys = Object.keys(body).filter((key) => !METADATA_KEYS.has(key))
  if (attemptedKeys.length === 0) {
    return c.json({ error: 'No settings provided' }, 400)
  }

  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  if (expectedUpdatedAt) {
    const currentUpdatedAt = await getSettingsUpdatedAt(c.env, attemptedKeys)
    try {
      assertUpdatedAtMatch('settings', { updated_at: currentUpdatedAt }, expectedUpdatedAt)
    } catch (error) {
      if (error instanceof WriteConflictError) {
        const { body: conflictBody, status } = writeConflictResponse(error)
        return c.json(conflictBody, status)
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
  return c.json({ updatedAt, keys: attemptedKeys })
})

export default app
