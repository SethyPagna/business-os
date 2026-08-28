import { Hono } from 'hono'
import { enqueueImageNormalization } from '../lib/imageAudit'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, getPermissionTier } from '../lib/permissions'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { getMediaType, buildUniqueStoredName, sanitizeOriginalFileName } from '../lib/fileAssets'
import { logicalLibraryName } from '../lib/libraryLogicalAssets'
import { validateUploadedBuffer } from '../lib/uploadSecurity'
import { audit } from '../lib/audit'
import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

// Library view/manage split (this session, supersedes the Review-Required
// shape described in progress.md's older "Permissions UI redesign" library
// spec -- that spec is recorded in progress.md as superseded, not deleted,
// per this project's own convention). New rule, explicit user ask: browsing
// the Library (list/search/preview -- GET below) is available to ANY
// authenticated user, no `library` grant needed at all -- "can show by
// default... click to view." Uploading ("import"), downloading ("export"),
// renaming, and deleting are all management actions and now require real
// Full Access to `library` (or the legacy `settings` full grant, same
// transitional OR Part 156 already established, kept so no existing
// installation is locked out the moment this ships). Review Required tier
// no longer grants any of upload/rename/delete either -- narrower than the
// old spec, on purpose, per this session's explicit "only with full
// permission" instruction.
//
// The one deliberate exception: a user whose only route into product data
// is `products_image_only`, or who has real (full or review) `products`
// access, can still use the upload endpoint specifically to wire a new
// image onto a product via the file picker -- that flow calls this same
// `/upload` route (FilePickerModal.tsx has no separate endpoint), so the
// gate below has to allow it explicitly rather than only checking
// `library`. This does not widen what that upload can be used for beyond
// "adds one asset to file_assets" -- it does not grant list/rename/delete,
// which stay Full-Access-only below.
function hasFullLibraryAccess(user: SessionUser): boolean {
  return getPermissionTier(user, 'library') === 'full' || hasPermission(user, 'settings')
}
function canWireProductImages(user: SessionUser): boolean {
  return getPermissionTier(user, 'products') !== 'none' || hasPermission(user, 'products_image_only')
}

const ALLOWED_MEDIA_TYPES = new Set(['all', 'image', 'video', 'document', 'file'])
const MAX_FILE_SEARCH_LENGTH = 120
const DEFAULT_FILE_PAGE_SIZE = 24
const MAX_FILE_PAGE_SIZE = 60

const LOGICAL_LIBRARY_CTE = `
  WITH product_refs AS (
    SELECT image_path AS public_path, id AS product_id, name AS product_name
    FROM products
    WHERE is_active = 1 AND image_path IS NOT NULL AND image_path != ''
    UNION
    SELECT pi.image_path AS public_path, p.id AS product_id, p.name AS product_name
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id AND p.is_active = 1
    WHERE pi.image_path IS NOT NULL AND pi.image_path != ''
  ),
  logical_assets AS (
    SELECT fa.*, refs.product_id AS reference_product_id, refs.product_name AS reference_product_name
    FROM file_assets fa
    LEFT JOIN product_refs refs ON refs.public_path = fa.public_path
  )
`

function isPathReferencedInSettings(values: readonly { value: string }[], publicPath: string): boolean {
  // Do this precise substring check in application code.  D1 can reject a
  // LIKE pattern as "too complex" when a setting happens to contain a large
  // JSON document; a file-library listing must not become unavailable merely
  // because an unrelated portal setting is large.
  return values.some((row) => String(row.value || '').includes(publicPath))
}

// The Docker path used to run `sharp` server-side to compress oversized
// images; `sharp` doesn't run in a Workers isolate (see
// lib/uploadSecurity.ts), so there's no equivalent server-side step here.
// Instead, the frontend now compresses/resizes images with Canvas before
// they're ever uploaded (frontend/src/utils/imageCompression.ts), targeting
// 180KB per image -- this limit is a tight safety net (1MB, not the old
// 8MB), not the primary size control: a source that genuinely ran
// compressImageFile's full plan never lands anywhere near 1MB, so
// crossing this line means compression didn't happen at all. Video still
// isn't transcoded anywhere in this stack (no ffmpeg/Container wired up
// -- see MIGRATION.md's ffmpeg section); video uploads are stored as-is,
// just renamed to a unique key and filed into the library like any other
// asset, and are NOT covered by this image-only cap.
const MAX_IMAGE_UPLOAD_BYTES = 1 * 1024 * 1024
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

// View is unconditional (see comment above) -- no permission check beyond
// requireAuth. Any authenticated user can browse/search/preview the
// library, they just can't upload/download/rename/delete without the
// gates the write routes below apply.
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
    // A shared object is presented under each product name, so searching
    // must match that logical name as well as the physical upload name.
    where.push(`(lower(original_name) LIKE @search OR lower(COALESCE(reference_product_name, '')) LIKE @search)`)
    params.search = `%${search.toLowerCase()}%`
  }
  if (mediaType !== 'all') {
    where.push('media_type = @mediaType')
    params.mediaType = mediaType
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // Count/page the logical rows, not physical objects. Otherwise a page can
  // render more cards than pageSize and its "x / total" indicator lies as
  // soon as one photo is shared by two products.
  const totalRow = await db.prepare(`${LOGICAL_LIBRARY_CTE} SELECT COUNT(*) AS count FROM logical_assets ${whereSql}`).get<{ count: number }>(params)
  // usage_count cross-references each asset's public_path against every place
  // a file can be referenced elsewhere in the app: a product's cover image,
  // its gallery, a user's avatar, and any business/portal setting (logo,
  // favicon, cover, etc. -- settings is a generic key/value table, so a LIKE
  // scan of `value` catches all of those without hardcoding every key). This
  // used to be missing entirely, which left every asset's usage looking like
  // zero and the frontend's canDelete flag always undefined/false --
  // deleting was silently disabled for every file in the Library, in-use or
  // not.
  const [rawItems, settingValues] = await Promise.all([
    db.prepare(`
    ${LOGICAL_LIBRARY_CTE}
    SELECT id, original_name, stored_name, public_path, mime_type, media_type, byte_size,
           width, height, source, created_by_id, created_by_name, created_at, updated_at,
           optimization_status, optimization_note, reference_product_id, reference_product_name,
           (SELECT COUNT(*) FROM products WHERE image_path = logical_assets.public_path) AS product_usage,
           (SELECT COUNT(*) FROM product_images WHERE image_path = logical_assets.public_path) AS gallery_usage,
           (SELECT COUNT(*) FROM users WHERE avatar_path = logical_assets.public_path) AS avatar_usage
    FROM logical_assets ${whereSql}
    ORDER BY id DESC, reference_product_name COLLATE NOCASE ASC, reference_product_id ASC
    LIMIT @limit OFFSET @offset
    `).all(params),
    db.prepare('SELECT value FROM settings').all<{ value: string }>(),
  ])

  // User-reported gap: the delete lock previously gave no reason beyond a
  // generic "in use" -- surfaced now as a per-row breakdown (`usage`) so
  // the Library list can say exactly what's referencing a locked file
  // (e.g. "Used by 2 products") instead of leaving the person to guess.
  const items = rawItems.map((row) => {
    const settingsUsage = isPathReferencedInSettings(settingValues, String(row.public_path || '')) ? 1 : 0
    const usage = {
      products: Number(row.product_usage || 0),
      gallery: Number(row.gallery_usage || 0),
      avatars: Number(row.avatar_usage || 0),
      settings: settingsUsage,
    }
    const usageCount = usage.products + usage.gallery + usage.avatars + usage.settings
    const { product_usage: _p, gallery_usage: _g, avatar_usage: _a, ...rest } = row
    const referenceProductId = row.reference_product_id == null ? null : Number(row.reference_product_id)
    const referenceProductName = String(row.reference_product_name || '').trim() || null
    return {
      ...rest,
      logical_id: referenceProductId ? `${row.id}:product:${referenceProductId}` : `${row.id}:asset`,
      logical_name: logicalLibraryName(row.original_name, referenceProductName),
      physical_original_name: row.original_name,
      referenceProduct: referenceProductId ? { id: referenceProductId, name: referenceProductName } : null,
      usageCount,
      usage,
      canDelete: usageCount === 0,
    }
  })

  return c.json({ items, total: totalRow?.count || 0, page, pageSize })
})

app.post('/upload', async (c) => {
  const user = c.get('user')
  if (!hasFullLibraryAccess(user) && !canWireProductImages(user)) {
    return c.json({ error: 'Uploading to the library requires Full Access to Library.' }, 403)
  }
  const rlKey = user?.id ? `user:${user.id}` : getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env, 'files:upload', rlKey, 30, 5 * 60 * 1000)
  if (!rl.allowed) return c.json({ error: 'Too many file uploads. Try again shortly.' }, 429)
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
    return c.json({ error: 'Image is too large to save (over 1MB after your browser attempted to compress it). Please try again, or pick a smaller/simpler source photo.' }, 400)
  }

  const storedName = buildUniqueStoredName(originalName)
  const objectKey = `uploads/${storedName}`
  await c.env.ASSETS.put(objectKey, buffer, { httpMetadata: { contentType: mimeType } })
  // K3: fresh image uploads normalize via the media queue within seconds
  // (the 6h sweep stays the safety net); videos wait on the container path.
  if (mediaType === 'image') await enqueueImageNormalization(c.env, objectKey)

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
  await audit(c.env, user.id, user.username || null, 'upload', 'file', insert.lastInsertRowid, {
    original_name: originalName,
    media_type: mediaType,
    byte_size: buffer.byteLength,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'files', { action: 'upload', id: insert.lastInsertRowid }))
  return c.json(asset)
})

// Streams the one stored object with a caller-selected logical filename.
// The filename is presentation only (Content-Disposition); R2 is never
// copied or renamed. Full Library access matches the existing bulk-download
// gate in FilesPage and prevents the public asset URL from becoming an
// alternate permission bypass for export actions.
app.get('/:id/download', async (c) => {
  const user = c.get('user')
  if (!hasFullLibraryAccess(user)) {
    return c.json({ error: 'Downloading a file requires Full Access to Library.' }, 403)
  }
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid file id' }, 400)

  const db = getDb(c.env)
  const asset = await db.prepare(`
    SELECT stored_name, original_name, mime_type FROM file_assets WHERE id = @id
  `).get<{ stored_name: string; original_name: string; mime_type: string | null }>({ id })
  if (!asset) return c.json({ error: 'File not found' }, 404)

  const object = await c.env.ASSETS.get(`uploads/${asset.stored_name}`)
  if (!object) return c.json({ error: 'Stored file object not found' }, 404)

  const requestedName = c.req.query('name') || asset.original_name
  const downloadName = sanitizeOriginalFileName(requestedName)
  const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download'
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Type', asset.mime_type || headers.get('Content-Type') || 'application/octet-stream')
  headers.set('Content-Length', String(object.size))
  headers.set('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'private, no-store')
  return new Response(object.body, { headers })
})

// Renames only the display name (`original_name`) shown in the Library --
// the R2 storage key (`stored_name`) and the `public_path` every product
// image / avatar / setting actually references are left untouched, so a
// rename can never break something that links to this file. Management
// action -- Full Access to Library only, same as delete below.
app.patch('/:id', async (c) => {
  const user = c.get('user')
  if (!hasFullLibraryAccess(user)) {
    return c.json({ error: 'Renaming a file requires Full Access to Library.' }, 403)
  }
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid file id' }, 400)
  }
  const body = await c.req.json<{ original_name?: unknown }>().catch(() => ({} as Record<string, unknown>))
  const rawName = typeof body.original_name === 'string' ? body.original_name : ''
  const nextName = sanitizeOriginalFileName(rawName)
  if (!rawName.trim() || nextName === 'file') {
    return c.json({ error: 'A valid file name is required' }, 400)
  }

  const db = getDb(c.env)
  const existing = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get<{ id: number; original_name: string }>([id])
  if (!existing) return c.json({ error: 'File not found' }, 404)

  await db.prepare(`
    UPDATE file_assets SET original_name = @original_name, updated_at = CURRENT_TIMESTAMP WHERE id = @id
  `).run({ id, original_name: nextName })

  const asset = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get([id])
  await audit(c.env, user.id, user.username || null, 'rename', 'file', id, {
    from: existing.original_name,
    to: nextName,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'files', { action: 'rename', id }))
  return c.json(asset)
})

app.delete('/:id', async (c) => {
  const user = c.get('user')
  // Management/export-adjacent action -- Full Access to Library only.
  // Neither Review Required nor the product-image-wiring exception
  // (canWireProductImages, see the top-of-file comment) grants delete --
  // that exception only ever covers the /upload route, on purpose.
  if (!hasFullLibraryAccess(user)) {
    return c.json({ error: 'Deleting a file requires Full Access to Library.' }, 403)
  }
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid file id' }, 400)
  }
  const db = getDb(c.env)
  const asset = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get<{ id: number; stored_name: string; public_path: string; original_name: string }>([id])
  if (!asset) return c.json({ error: 'File not found' }, 404)

  // User-reported gap: the "in use" block was silent about WHY (no
  // breakdown of what's actually referencing it) and gave no way to
  // proceed even when the person deliberately wants to delete it anyway
  // ("make sure i can unlock this lock...just need reminder and confirm
  // text 'CONFIRM DELETE'"). This now (a) breaks the usage count down by
  // source so the list endpoint/frontend can say exactly what's using it,
  // and (b) accepts an explicit `force` override -- gated on the SAME
  // literal confirmation phrase the frontend now requires the user to
  // type ("CONFIRM DELETE"), checked here too so a force-delete can't
  // happen from a stale client that never actually showed that prompt.
  const body = await c.req.json<{ force?: boolean; confirmText?: string }>().catch(() => ({}) as { force?: boolean; confirmText?: string })
  const [usageBreakdown, settingValues] = await Promise.all([
    db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE image_path = @publicPath) AS product_count,
      (SELECT COUNT(*) FROM product_images WHERE image_path = @publicPath) AS gallery_count,
      (SELECT COUNT(*) FROM users WHERE avatar_path = @publicPath) AS avatar_count
    `).get<{ product_count: number; gallery_count: number; avatar_count: number }>({ publicPath: asset.public_path }),
    db.prepare('SELECT value FROM settings').all<{ value: string }>(),
  ])
  const settingsUsage = isPathReferencedInSettings(settingValues, asset.public_path) ? 1 : 0
  const usageCount = Number(usageBreakdown?.product_count || 0) + Number(usageBreakdown?.gallery_count || 0) + Number(usageBreakdown?.avatar_count || 0) + settingsUsage
  if (usageCount > 0) {
    const forceRequested = body.force === true && String(body.confirmText || '').trim().toUpperCase() === 'CONFIRM DELETE'
    if (!forceRequested) {
      return c.json({
        error: 'This file is still in use and cannot be deleted.',
        usage: {
          products: Number(usageBreakdown?.product_count || 0),
          gallery: Number(usageBreakdown?.gallery_count || 0),
          avatars: Number(usageBreakdown?.avatar_count || 0),
          settings: settingsUsage,
        },
        forceable: true,
      }, 409)
    }
  }

  await c.env.ASSETS.delete(`uploads/${asset.stored_name}`)
  await db.prepare('DELETE FROM file_assets WHERE id = ?').run([id])

  // `forced` records that the user typed the CONFIRM DELETE override past a
  // real usage count -- the one variant of this delete worth flagging later.
  await audit(c.env, user.id, user.username || null, 'delete', 'file', id, {
    original_name: asset.original_name,
    forced: usageCount > 0,
    usage: usageCount > 0
      ? {
          products: Number(usageBreakdown?.product_count || 0),
          gallery: Number(usageBreakdown?.gallery_count || 0),
          avatars: Number(usageBreakdown?.avatar_count || 0),
          settings: settingsUsage,
        }
      : undefined,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'files', { action: 'delete', id }))
  return c.json(asset)
})

export default app
