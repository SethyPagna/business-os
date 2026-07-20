import { Hono } from 'hono'
import { getDb } from '../lib/db'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return c.json(map)
})

app.put('/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json<{ value: unknown }>()
  const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value)
  const db = getDb(c.env)
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ key, value })
  return c.json({ key, value })
})

export default app
