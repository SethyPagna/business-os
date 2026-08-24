import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import type { Env } from '../index'

// Personal, per-user autosaved notes -- a private scratchpad, not shared
// with anyone else and not tied to any sale/product/contact record (those
// already have their own unrelated `notes` free-text fields). Every query
// below is scoped to `user_id = c.get('user').id`; there is no route that
// can read or write another user's notes, and no permission flag gates
// this beyond being logged in -- it's the same "your own data" model as
// a personal profile field, not an admin-controlled feature.

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

type NoteRow = {
  id: number
  user_id: number
  title: string
  content: string
  pinned: number
  sort_order: number
  created_at: string
  updated_at: string
}

const MAX_TITLE_LENGTH = 200
// Generous ceiling, not a real-world limit anyone will hit while typing --
// just a backstop against a single row growing unbounded (D1 row values
// cap out well above this, but a multi-MB "note" is almost certainly a bug
// on the client, not an intentional note).
const MAX_CONTENT_LENGTH = 200_000

function clean(value: unknown, maxLength: number): string {
  const str = typeof value === 'string' ? value : ''
  return str.length > maxLength ? str.slice(0, maxLength) : str
}

function deriveTitle(title: unknown, content: unknown): string {
  const explicit = clean(title, MAX_TITLE_LENGTH).trim()
  if (explicit) return explicit
  // No title yet -- fall back to the first non-blank line of the content,
  // same "auto-title from first line" behavior most notes apps use, so a
  // freshly created untitled note still shows something useful in the list.
  const firstLine = clean(content, MAX_CONTENT_LENGTH).split(/\r?\n/).find((line) => line.trim())
  return (firstLine || '').trim().slice(0, MAX_TITLE_LENGTH)
}

// GET /api/notes -- list the current user's notes, pinned first then most
// recently updated. Kept as a single unpaginated list deliberately: this
// is a personal scratchpad, not a bulk-data table, and every other note
// app's "all my notes" list works the same way.
app.get('/', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const notes = await db
    .prepare(`SELECT * FROM user_notes WHERE user_id = @userId ORDER BY pinned DESC, sort_order ASC, updated_at DESC, id DESC`)
    .all<NoteRow>({ userId: user.id })
  return c.json({ notes: notes || [] })
})

// POST /api/notes -- create a new note. Autosave on the frontend calls
// this once (on first keystroke of a brand-new note) then switches to
// PUT for every subsequent debounced save, same pattern as every other
// autosaving editor in this app (e.g. the portal editor).
app.post('/', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))
  const content = clean(body.content, MAX_CONTENT_LENGTH)
  const title = deriveTitle(body.title, content)
  const now = new Date().toISOString()
  const result = await db
    .prepare(`INSERT INTO user_notes (user_id, title, content, pinned, created_at, updated_at) VALUES (@userId, @title, @content, 0, @now, @now)`)
    .run({ userId: user.id, title, content, now })
  const note = await db
    .prepare(`SELECT * FROM user_notes WHERE id = @id AND user_id = @userId`)
    .get<NoteRow>({ id: result.lastInsertRowid, userId: user.id })
  return c.json({ note }, 201)
})

// PUT /api/notes/:id -- autosaved edits (title/content/pinned). Uses the
// same optimistic-concurrency `expectedUpdatedAt` pattern as every other
// editable table here so two tabs/devices autosaving the same note can't
// silently stomp each other -- a stale save gets a 409 with the current
// row instead of overwriting newer content.
app.put('/:id', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid note id' }, 400)
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))

  const existing = await db
    .prepare(`SELECT * FROM user_notes WHERE id = @id AND user_id = @userId`)
    .get<NoteRow>({ id, userId: user.id })
  if (!existing) return c.json({ error: 'Note not found' }, 404)

  try {
    assertUpdatedAtMatch('note', existing, getExpectedUpdatedAt(body))
  } catch (err) {
    if (err instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(err)
      return c.json(conflictBody, status)
    }
    throw err
  }

  const content = body.content !== undefined ? clean(body.content, MAX_CONTENT_LENGTH) : existing.content
  const title = body.title !== undefined || body.content !== undefined
    ? deriveTitle(body.title !== undefined ? body.title : existing.title, content)
    : existing.title
  const pinned = body.pinned !== undefined ? (body.pinned ? 1 : 0) : existing.pinned
  const now = new Date().toISOString()

  await db
    .prepare(`UPDATE user_notes SET title = @title, content = @content, pinned = @pinned, updated_at = @now WHERE id = @id AND user_id = @userId`)
    .run({ title, content, pinned, now, id, userId: user.id })
  const note = await db
    .prepare(`SELECT * FROM user_notes WHERE id = @id AND user_id = @userId`)
    .get<NoteRow>({ id, userId: user.id })
  return c.json({ note })
})

// PATCH /api/notes/reorder -- persist a manual drag-and-drop order for the
// current user's notes. Body is `{ orderedIds: number[] }`, the note ids in
// their new top-to-bottom order (as dragged in NotesPage.tsx). Assigns
// sequential sort_order values (0, 1, 2, ...) matching that order; ids that
// don't belong to this user are silently skipped rather than erroring, same
// "your own data only" scoping as every other route here -- a stale/forged
// id in the payload just doesn't move anything instead of failing the whole
// reorder. Pinned notes still sort ahead of unpinned ones regardless of
// sort_order (see the list route's ORDER BY) -- this only reorders within
// each of those two groups, matching what a single flat drag-and-drop list
// can actually express without a separate "reorder within pinned" step.
app.patch('/reorder', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))
  const orderedIds = Array.isArray(body.orderedIds)
    ? (body.orderedIds as unknown[]).map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
    : []
  if (!orderedIds.length) return c.json({ error: 'orderedIds is required' }, 400)

  const owned = await db
    .prepare(`SELECT id FROM user_notes WHERE user_id = @userId`)
    .all<{ id: number }>({ userId: user.id })
  const ownedIds = new Set((owned || []).map((row) => row.id))

  const statements = orderedIds
    .filter((id: number) => ownedIds.has(id))
    .map((id: number, index: number) => ({
      sql: `UPDATE user_notes SET sort_order = @sortOrder WHERE id = @id AND user_id = @userId`,
      params: { sortOrder: index, id, userId: user.id },
    }))
  if (statements.length) await db.batch(statements)

  const notes = await db
    .prepare(`SELECT * FROM user_notes WHERE user_id = @userId ORDER BY pinned DESC, sort_order ASC, updated_at DESC, id DESC`)
    .all<NoteRow>({ userId: user.id })
  return c.json({ notes: notes || [] })
})

// DELETE /api/notes/:id
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = getDb(c.env)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid note id' }, 400)
  const existing = await db
    .prepare(`SELECT id FROM user_notes WHERE id = @id AND user_id = @userId`)
    .get<{ id: number }>({ id, userId: user.id })
  if (!existing) return c.json({ error: 'Note not found' }, 404)
  await db.prepare(`DELETE FROM user_notes WHERE id = @id AND user_id = @userId`).run({ id, userId: user.id })
  return c.json({ success: true })
})

export default app
