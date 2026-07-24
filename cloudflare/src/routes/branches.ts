import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

function toDbBool(value: unknown, fallback: 0 | 1 = 1): 0 | 1 {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 1 : 0
}

type BranchInput = {
  name?: string
  location?: string
  phone?: string
  manager?: string
  notes?: string
  is_default?: unknown
  is_active?: unknown
}

app.get('/', async (c) => {
  const db = getDb(c.env)
  const branches = await db.prepare('SELECT * FROM branches ORDER BY is_default DESC, name').all()
  return c.json(branches)
})

app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<BranchInput>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'Name required' }, 400)

  const db = getDb(c.env)
  const defaultFlag = toDbBool(body.is_default, 0)
  const activeFlag = toDbBool(body.is_active, 1)

  // Matches the original's db.transaction(): if this branch is being set as
  // the new default, every other branch's is_default must clear first, in
  // the same atomic unit as the insert -- otherwise a request that fails
  // partway through could leave two branches both marked default.
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  if (defaultFlag) {
    statements.push({ sql: 'UPDATE branches SET is_default = 0' })
  }
  statements.push({
    sql: `INSERT INTO branches (name, location, phone, manager, notes, is_default, is_active, updated_at)
          VALUES (@name, @location, @phone, @manager, @notes, @is_default, @is_active, CURRENT_TIMESTAMP)`,
    params: {
      name,
      location: body.location || null,
      phone: body.phone || null,
      manager: body.manager || null,
      notes: body.notes || null,
      is_default: defaultFlag,
      is_active: activeFlag,
    },
  })
  await db.batch(statements)

  const created = await db.prepare('SELECT id FROM branches WHERE name = ? ORDER BY id DESC LIMIT 1').get<{ id: number }>([name])
  if (created) {
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', 'branch', created.id, { name })
  }
  return c.json({ id: created?.id ?? null })
})

app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json<BranchInput & Record<string, unknown>>()
  const db = getDb(c.env)

  const current = await db.prepare('SELECT id, updated_at FROM branches WHERE id = ?').get<{ id: number; updated_at: string }>([id])
  try {
    assertUpdatedAtMatch('branch', current, getExpectedUpdatedAt(body))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }
  if (!current) return c.json({ error: 'Branch not found' }, 404)

  const defaultFlag = toDbBool(body.is_default, 0)
  const activeFlag = toDbBool(body.is_active, 1)
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  if (defaultFlag) statements.push({ sql: 'UPDATE branches SET is_default = 0' })
  statements.push({
    sql: `UPDATE branches SET name=@name, location=@location, phone=@phone, manager=@manager, notes=@notes,
          is_default=@is_default, is_active=@is_active, updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
    params: {
      name: body.name,
      location: body.location || null,
      phone: body.phone || null,
      manager: body.manager || null,
      notes: body.notes || null,
      is_default: defaultFlag,
      is_active: activeFlag,
      id,
    },
  })
  await db.batch(statements)

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'branch', id, { name: body.name })
  return c.json({})
})

app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const db = getDb(c.env)

  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get<{ id: number; name: string; is_default: number; updated_at: string }>([id])
  if (!branch) return c.json({ error: 'Branch not found' }, 404)

  try {
    assertUpdatedAtMatch('branch', branch, getExpectedUpdatedAt(Object.fromEntries(new URL(c.req.url).searchParams)))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }
  if (branch.is_default) return c.json({ error: 'Cannot delete the default branch' }, 400)

  const stockCheck = await db.prepare('SELECT SUM(quantity) AS total FROM branch_stock WHERE branch_id = ? AND quantity > 0').get<{ total: number | null }>([id])
  if (stockCheck && Number(stockCheck.total) > 0) {
    return c.json({ error: `Cannot delete branch - it still contains ${Math.round(Number(stockCheck.total))} unit(s) of stock. Transfer all stock to another branch first.` }, 400)
  }

  await db.batch([
    { sql: 'DELETE FROM branch_stock WHERE branch_id = ?', params: [id] },
    { sql: 'DELETE FROM branches WHERE id = ?', params: [id] },
  ])
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'delete', 'branch', id, { name: branch.name })
  return c.json({})
})

export default app
