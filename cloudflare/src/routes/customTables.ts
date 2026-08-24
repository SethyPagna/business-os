import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', async (c, next) => {
  if (!hasPermission(c.get('user'), 'settings')) return c.json({ error: 'Permission denied' }, 403)
  await next()
})

// Ported from backend/src/routes/customTables.ts. User-defined tables let
// settings admins create arbitrary data tables (e.g. "Warranty Claims",
// "Supplier Contacts") with a JSON-described column schema, then CRUD rows
// into them. Table/column names are attacker-controlled strings that get
// interpolated straight into SQL identifiers (there's no other way to do
// dynamic DDL), so sanitizeCustomTableName/escapeIdentifier below are load-
// bearing, not decoration -- keep them exactly as strict as the original.
//
// Two real differences vs. the original, both because the original is
// Postgres and this is D1/SQLite:
// 1. Column types map to SQLite affinities (INTEGER PRIMARY KEY
//    AUTOINCREMENT instead of SERIAL, TEXT instead of TIMESTAMPTZ) --
//    same convention every other table in migrations/0001_init.sql uses.
// 2. Dropped ensureCustomTableRowVersioning's ALTER TABLE ADD COLUMN
//    "migration" path entirely. That existed in the original only to
//    backfill `updated_at` onto custom tables created before the column
//    existed in the schema -- every table this route creates already
//    includes `updated_at` in its CREATE TABLE below, so there's nothing
//    to backfill. hasColumn/markColumnPresent (backend/src/schemaMetadata.ts)
//    were Postgres information_schema helpers built for that migration
//    path specifically; nothing else in this Worker needs them, so they
//    aren't ported.
//
// D1Database.exec() (used for the CREATE TABLE DDL below) takes a raw SQL
// string with no parameter binding -- that's fine here since every value
// going into the DDL string is either a whitelisted type keyword or has
// already been through escapeIdentifier, never a raw user string.

const CUSTOM_TABLE_COLUMN_TYPES = new Set(['text', 'long_text', 'number', 'decimal', 'boolean', 'date', 'timestamp', 'dropdown'])
const CUSTOM_TABLE_SYSTEM_FIELDS = new Set(['id', 'created_at', 'updated_at', 'expectedUpdatedAt', 'expected_updated_at', 'updatedAt'])
const SQLITE_COLUMN_TYPE: Record<string, string> = {
  text: 'TEXT',
  long_text: 'TEXT',
  number: 'INTEGER',
  decimal: 'REAL',
  boolean: 'INTEGER',
  date: 'TEXT',
  timestamp: 'TEXT',
  dropdown: 'TEXT',
}

type CustomColumn = { name: string; type: string; required: boolean }

function humanizeTableName(tableName = ''): string {
  const parts: string[] = []
  for (const part of String(tableName || '').replace(/^ct_/, '').split('_')) {
    if (part) parts.push(part.charAt(0).toUpperCase() + part.slice(1))
  }
  return parts.join(' ') || 'Custom Table'
}

function serializeCustomTable(row: Record<string, unknown>) {
  return {
    ...row,
    display_name: humanizeTableName(String(row.name || '')),
    schema: row.schema || row.columns || '[]',
  }
}

function sanitizeCustomTableName(value = ''): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  return `ct_${raw.replace(/\W+/g, '_').replace(/^ct_+/, '').slice(0, 40)}`
}

function escapeIdentifier(value = ''): string {
  return String(value || '').replace(/"/g, '""')
}

function normalizeCustomTableSchema(schema: unknown): CustomColumn[] {
  if (!Array.isArray(schema) || schema.length === 0) throw new Error('At least one column is required')
  const seenNames = new Set<string>()
  const normalized: CustomColumn[] = []
  for (const column of schema as Array<Record<string, unknown>>) {
    const name = String(column?.name || '').trim()
    const type = String(column?.type || 'text').trim().toLowerCase()
    if (!name) throw new Error('Every column needs a name')
    const normalizedName = name.toLowerCase()
    if (seenNames.has(normalizedName)) throw new Error(`Duplicate column name: ${name}`)
    seenNames.add(normalizedName)
    if (!CUSTOM_TABLE_COLUMN_TYPES.has(type)) throw new Error(`Unsupported column type: ${type}`)
    normalized.push({ name, type, required: !!column?.required })
  }
  return normalized
}

function getWritableCustomTableKeys(data: Record<string, unknown>): string[] {
  const keys: string[] = []
  for (const key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue
    if (CUSTOM_TABLE_SYSTEM_FIELDS.has(key)) continue
    keys.push(key)
  }
  return keys
}

async function resolveCustomTableRow(env: Env, name: string): Promise<{ name: string; columns: string } | null> {
  const tableName = sanitizeCustomTableName(name)
  if (!tableName) return null
  const db = getDb(env)
  const row = await db.prepare('SELECT * FROM custom_tables WHERE name = ? LIMIT 1').get<{ name: string; columns: string }>([tableName])
  return row || null
}

app.get('/', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM custom_tables ORDER BY name').all<Record<string, unknown>>()
  return c.json(rows.map(serializeCustomTable))
})

app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ name?: string; display_name?: string; schema?: unknown; [key: string]: unknown }>().catch(() => ({} as Record<string, unknown>))
  const name = (body.name as string | undefined)?.trim()
  const schema = body.schema
  if (!name || !Array.isArray(schema)) return c.json({ error: 'name and schema required' }, 400)

  const tableName = sanitizeCustomTableName(name)
  if (!tableName) return c.json({ error: 'Valid table name required' }, 400)

  let normalizedSchema: CustomColumn[]
  try {
    normalizedSchema = normalizeCustomTableSchema(schema)
  } catch (error) {
    return c.json({ error: (error as Error).message || 'Invalid custom table schema' }, 400)
  }

  const columnParts = normalizedSchema.map((column) => `"${escapeIdentifier(column.name)}" ${SQLITE_COLUMN_TYPE[column.type] || 'TEXT'}`)

  try {
    // Raw DDL -- see the file-level note above on why .exec() (not the
    // D1Compat wrapper) is correct here.
    await c.env.DB.exec(
      `CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columnParts.join(', ')}, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    )
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }

  const db = getDb(c.env)
  const now = new Date().toISOString()
  const displayName = String((body.display_name as string | undefined) || name || '').trim() || humanizeTableName(tableName)
  try {
    const inserted = await db.prepare('INSERT INTO custom_tables (name, columns, updated_at) VALUES (@name, @columns, @updated_at)').run({
      name: tableName,
      columns: JSON.stringify(normalizedSchema),
      updated_at: now,
    })
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', 'custom_table', inserted.lastInsertRowid, { name: tableName, display_name: displayName })
    return c.json({
      id: inserted.lastInsertRowid,
      name: tableName,
      display_name: displayName,
      schema: JSON.stringify(normalizedSchema),
      updated_at: now,
    })
  } catch (error) {
    const message = (error as Error).message || ''
    return c.json({ error: /unique/i.test(message) ? 'Custom table already exists' : message }, 400)
  }
})

app.get('/:name/data', async (c) => {
  try {
    const table = await resolveCustomTableRow(c.env, c.req.param('name'))
    if (!table) return c.json([])
    const db = getDb(c.env)
    const rows = await db.prepare(`SELECT * FROM "${escapeIdentifier(table.name)}" ORDER BY id DESC LIMIT 1000`).all()
    return c.json(rows)
  } catch {
    return c.json([])
  }
})

app.post('/:name/rows', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ data?: Record<string, unknown>; [key: string]: unknown }>().catch(() => ({} as Record<string, unknown>))
  const data = body.data as Record<string, unknown> | undefined
  if (!data) return c.json({ error: 'data required' }, 400)

  const table = await resolveCustomTableRow(c.env, c.req.param('name'))
  if (!table) return c.json({ error: 'Custom table not found' }, 404)

  const db = getDb(c.env)
  const keys = getWritableCustomTableKeys(data)
  const columns = keys.map((key) => `"${escapeIdentifier(key)}"`)
  const placeholders = keys.map((key) => `@${key}`)
  const params: Record<string, unknown> = {}
  for (const key of keys) params[key] = data[key]
  columns.push('"updated_at"')
  placeholders.push('@updated_at')
  params.updated_at = new Date().toISOString()

  try {
    const safeTable = escapeIdentifier(table.name)
    const inserted = await db.prepare(`INSERT INTO "${safeTable}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`).run(params)
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', 'custom_table_row', inserted.lastInsertRowid, { table_name: table.name })
    const row = await db.prepare(`SELECT * FROM "${safeTable}" WHERE id = ?`).get([inserted.lastInsertRowid])
    return c.json(row)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

app.put('/:name/rows/:id', async (c) => {
  const user = c.get('user')
  const rowId = c.req.param('id')
  const body = await c.req.json<{ data?: Record<string, unknown>; [key: string]: unknown }>().catch(() => ({} as Record<string, unknown>))
  const data = body.data as Record<string, unknown> | undefined
  if (!data) return c.json({ error: 'data required' }, 400)

  const table = await resolveCustomTableRow(c.env, c.req.param('name'))
  if (!table) return c.json({ error: 'Custom table not found' }, 404)

  const db = getDb(c.env)
  const safeTable = escapeIdentifier(table.name)
  const current = await db.prepare(`SELECT * FROM "${safeTable}" WHERE id = ?`).get<Record<string, unknown>>([rowId])
  if (!current) return c.json({ error: 'Custom table row not found' }, 404)

  try {
    assertUpdatedAtMatch('custom table row', current, getExpectedUpdatedAt({ ...body, ...data }))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }

  const keys = getWritableCustomTableKeys(data)
  const sets = keys.map((key) => `"${escapeIdentifier(key)}" = @${key}`)
  const params: Record<string, unknown> = { id: rowId }
  for (const key of keys) params[key] = data[key]
  sets.push('"updated_at" = @updated_at')
  params.updated_at = new Date().toISOString()

  try {
    await db.prepare(`UPDATE "${safeTable}" SET ${sets.join(', ')} WHERE id = @id`).run(params)
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'custom_table_row', rowId, { table_name: table.name })
    const row = await db.prepare(`SELECT * FROM "${safeTable}" WHERE id = ?`).get([rowId])
    return c.json(row)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

app.delete('/:name/rows/:id', async (c) => {
  const user = c.get('user')
  const rowId = c.req.param('id')
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))

  const table = await resolveCustomTableRow(c.env, c.req.param('name'))
  if (!table) return c.json({ error: 'Custom table not found' }, 404)

  const db = getDb(c.env)
  const safeTable = escapeIdentifier(table.name)
  const current = await db.prepare(`SELECT * FROM "${safeTable}" WHERE id = ?`).get<Record<string, unknown>>([rowId])
  if (!current) return c.json({ error: 'Custom table row not found' }, 404)

  try {
    assertUpdatedAtMatch('custom table row', current, getExpectedUpdatedAt({ ...(body as Record<string, unknown>), ...Object.fromEntries(new URL(c.req.url).searchParams) }))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }

  await db.prepare(`DELETE FROM "${safeTable}" WHERE id = ?`).run([rowId])
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'delete', 'custom_table_row', rowId, { table_name: table.name })
  return c.json({})
})

export default app
