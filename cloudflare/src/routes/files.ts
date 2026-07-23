import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getMediaType, buildUniqueStoredName, sanitizeOriginalFileName } from '../lib/fileAssets'
import { validateUploadedBuffer } from '../lib/uploadSecurity'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

const ALLOWED_MEDIA_TYPES = new Set(['all', 'image', 'video', 'document', 'file'])
const MAX_FILE_SEARCH_LENGTH = 120
const DEFAULT_FILE_PAGE_SIZE = 24
const MAX_FILE_PAGE_SIZE = 60

// Same 40KB image budget the Docker path enforces via sharp compression --
// ported here as a hard upload-size limit for images instead, since sharp
// itself doesn't run in a Workers isolate (see lib/uploadSecurity.ts). This
// is a real behavioral difference, not an oversight: the Docker path
// compresses an oversized image down to fit; this path rejects it outright
// and asks for a smaller source image. Closing that gap needs Cloudflare
// Images or a Container (documented in MIGRATION.md's ffmpeg section,
// same category of problem).
const MAX_IMAGE_UPLOAD_BYTES = 40 * 1024
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

app.get('/', async (c) => {
  const db = getDb(c.env)
  const search = c.req.query('search')?.trim() || ''
  if (search.length > MAX_FILE_SEARCH_LENGTH) {
    return c.json({ error: `Search must be ${MAX_FILE_SEARCH_LENGTH} characters or fewer` }, 400)
  }
  const mediaType = (c.req.query('mediaType') || 'all').toLowerCase()
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return c.json({ error: 'Invalid media type filter' }, 400)
  }
  const pageSize = Math.min(MAX_FILE_PAGE_SIZE, Math.max(1, Number.parseInt(c.req.query('pageSize') || String(DEFAULT_FILE_PAGE_SIZE), 10) || DEFAULT_FILE_PAGE_SIZE))
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: Record<string, unknown> = { limit: pageSize, offset }
  if (search) {
    where.push('lower(original_name) LIKE @search')
    params.search = `%${search.toLowerCase()}%`
  }
  if (mediaType !== 'all') {
    where.push('media_type = @mediaType')
    params.mediaType = mediaType
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM file_assets ${whereSql}`).get<{ count: number }>(params)
  const items = await db.prepare(`
    SELECT id, original_name, stored_name, public_path, mime_type, media_type, byte_size,
           width, height, source, created_by_id, created_by_name, created_at, updated_at,
           optimization_status, optimization_note
    FROM file_assets ${whereSql}
    ORDER BY id DESC
    LIMIT @limit OFFSET @offset
  `).all(params)

  return c.json({ items, total: totalRow?.count || 0, page, pageSize })
})

app.post('/upload', async (c) => {
  const user = c.get('user')
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400)
  }
  if (file.size === 0) {
    return c.json({ error: 'Uploaded file is empty' }, 400)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `File is too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)` }, 400)
  }

  const originalName = sanitizeOriginalFileName(file.name || 'file')
  const mimeType = file.type || 'application/octet-stream'
  const mediaType = getMediaType(mimeType, originalName)

  const buffer = new Uint8Array(await file.arrayBuffer())
  try {
    validateUploadedBuffer(buffer, mimeType, originalName)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }

  if (mediaType === 'image' && buffer.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    return c.json({ error: 'Images and logos must be 40KB or less on this path (server-side compression is not available yet here -- see MIGRATION.md). Please upload a smaller or already-compressed source image.' }, 400)
  }

  const storedName = buildUniqueStoredName(originalName)
  const objectKey = `uploads/${storedName}`
  await c.env.ASSETS.put(objectKey, buffer, { httpMetadata: { contentType: mimeType } })

  const publicPath = `/uploads/${storedName}`
  const db = getDb(c.env)
  const insert = await db.prepare(`
    INSERT INTO file_assets (
      original_name, stored_name, public_path, mime_type, media_type, byte_size,
      source, created_by_id, created_by_name, optimization_status
    ) VALUES (@original_name, @stored_name, @public_path, @mime_type, @media_type, @byte_size,
      'upload', @created_by_id, @created_by_name, @optimization_status)
  `).run({
    original_name: originalName,
    stored_name: storedName,
    public_path: publicPath,
    mime_type: mimeType,
    media_type: mediaType,
    byte_size: buffer.byteLength,
    created_by_id: user?.id ?? null,
    created_by_name: user?.name ?? null,
    // 'not_applicable_no_sharp' for images specifically flags that this path
    // does not compress (unlike the Docker path, where an image landing
    // here would normally show 'optimized' or 'already_within_budget') --
    // callers that display this status should not assume the two backends
    // mean the same thing by it.
    optimization_status: mediaType === 'image' ? 'not_applicable_no_sharp' : 'not_applicable',
  })

  const asset = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get([insert.lastInsertRowid])
  return c.json(asset)
})

app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid file id' }, 400)
  }
  const db = getDb(c.env)
  const asset = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get<{ id: number; stored_name: string; public_path: string; original_name: string }>([id])
  if (!asset) return c.json({ error: 'File not found' }, 404)

  await c.env.ASSETS.delete(`uploads/${asset.stored_name}`)
  await db.prepare('DELETE FROM file_assets WHERE id = ?').run([id])

  return c.json(asset)
})

export default app
