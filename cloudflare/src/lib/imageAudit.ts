// The 6-hourly image audit, and the reprocessing pass it feeds.
//
// Two separate jobs on purpose:
//
//   sweepImageAudit()      -- lists R2 and records what is oversized. Cheap:
//                             `.info()` is not billed and object size comes
//                             straight off the listing, so a full sweep costs
//                             no transformation quota at all.
//
//   reprocessAuditedImages() -- takes a small batch of what the sweep found
//                             and actually re-encodes it. This is the part
//                             that costs quota, so it is paced deliberately
//                             rather than run to completion.
//
// Doing both inline in one cron tick was the obvious design and the wrong
// one: a sweep that measures AND rewrites thousands of objects cannot finish
// in one invocation's CPU budget, and a half-finished pass with no record of
// where it stopped would restart from the beginning every six hours and never
// converge on a large library.
//
// Nothing here deletes an original. A failed optimisation leaves the object
// exactly as it was and records why -- storage saved is never worth an
// unrecoverable loss.

import type { Env } from '../index'
import { getDb } from './db'
import { recordAnalytics } from './analytics'
import { consumeQuota } from './quotaGuard'
import { IMAGE_MAX_BYTES, needsOptimization, optimizeImage } from './imagePipeline'

/** Objects examined per sweep. Bounded so the cron tick stays predictable. */
const SWEEP_BATCH = 400
/** KV key holding the rolling R2 list cursor so successive sweeps cover the
 *  WHOLE uploads/ prefix instead of re-scanning the first SWEEP_BATCH keys. */
const IMAGE_AUDIT_CURSOR_KEY = 'system-cursor:image-audit-sweep'
/** Images re-encoded per pass. Small on purpose -- this is the metered half. */
const REPROCESS_BATCH = 25

const IMAGE_KEY_RE = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i

// Returns the UPDATE statement rather than running it -- normalizeStoredImage
// batches this together with its own image_audit upsert (one db.batch() round
// trip for the two independent per-message writes instead of two sequential
// awaits). Returns null when there is no file_assets row to touch (same
// early-outs as before: a non-uploads/ key, or an empty stored name).
function buildFileAssetMetadataStatement(
  key: string,
  fields: { byteSize: number; contentType?: string | null; optimized?: boolean; provider?: string | null },
): { sql: string; params: Record<string, unknown> } | null {
  if (!key.startsWith('uploads/')) return null
  const storedName = key.slice('uploads/'.length)
  if (!storedName) return null
  return {
    sql: `
      UPDATE file_assets SET
        original_byte_size = CASE WHEN @optimized = 1 THEN COALESCE(original_byte_size, byte_size) ELSE original_byte_size END,
        optimized_byte_size = CASE WHEN @optimized = 1 THEN @byteSize ELSE optimized_byte_size END,
        byte_size = @byteSize,
        mime_type = COALESCE(@contentType, mime_type),
        media_type = CASE WHEN @contentType LIKE 'image/%' THEN 'image' ELSE media_type END,
        optimization_status = CASE WHEN @optimized = 1 THEN 'optimized' ELSE optimization_status END,
        optimization_note = CASE WHEN @optimized = 1 THEN @optimizationNote ELSE optimization_note END,
        updated_at = CURRENT_TIMESTAMP
      WHERE stored_name = @storedName OR public_path = @publicPath
    `,
    params: {
      byteSize: Math.max(0, Number(fields.byteSize) || 0),
      contentType: fields.contentType || null,
      optimized: fields.optimized ? 1 : 0,
      optimizationNote: fields.optimized ? `Optimized by ${fields.provider || 'media pipeline'}` : null,
      storedName,
      publicPath: `/${key}`,
    },
  }
}

export type SweepResult = {
  examined: number
  oversized: number
  done: boolean
}

/**
 * Records which stored images are outside the band.
 *
 * Uses the size R2 already reports in its listing rather than reading each
 * object: the question here is only "is this too big", and fetching every
 * object to answer it would cost class-B operations for information already
 * in hand.
 */
export async function sweepImageAudit(env: Env): Promise<SweepResult> {
  const db = getDb(env)
  let examined = 0
  let oversized = 0

  // Rotating cursor (persisted in KV, same pattern as backup.ts's asset-copy
  // cursor). The sweep used to listObjects('uploads/') -- which fully paginates
  // -- then .slice(0, SWEEP_BATCH), so it re-examined only the lexicographically
  // first 400 keys every 6h forever; on a library larger than 400 objects
  // everything past them was never recorded oversized and never reprocessed.
  // Reading ONE cursored page and advancing the cursor makes successive ticks
  // walk the whole library and wrap.
  const priorCursor = (await env.CACHE.get(IMAGE_AUDIT_CURSOR_KEY)) || undefined
  const page = await env.ASSETS.list({ prefix: 'uploads/', cursor: priorCursor, limit: SWEEP_BATCH })
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = []

  for (const object of page.objects || []) {
    const key = String(object.key || '')
    if (!IMAGE_KEY_RE.test(key)) continue
    examined += 1
    const byteSize = Number(object.size || 0)
    const isOversized = needsOptimization(byteSize)
    if (isOversized) oversized += 1
    statements.push({
      // An object already recorded as 'optimized' must not be reset to
      // 'oversized' by a later sweep -- it would be re-encoded every six
      // hours forever, burning quota to produce a file it already produced.
      // Its size is re-checked, but its verdict is only revised when the
      // stored bytes actually changed.
      sql: `
        INSERT INTO image_audit (key, byte_size, status, checked_at)
        VALUES (@key, @byteSize, @status, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          byte_size = @byteSize,
          checked_at = CURRENT_TIMESTAMP,
          status = CASE
            WHEN image_audit.status = 'optimized' AND @byteSize <= @ceiling THEN 'optimized'
            WHEN image_audit.status = 'failed' AND image_audit.byte_size = @byteSize THEN 'failed'
            ELSE @status
          END
      `,
      params: { key, byteSize, status: isOversized ? 'oversized' : 'ok', ceiling: IMAGE_MAX_BYTES },
    })
  }

  if (statements.length) await db.batch(statements)

  await db.prepare(`
    INSERT INTO image_audit_state (id, last_run_at, swept)
    VALUES (1, CURRENT_TIMESTAMP, @swept)
    ON CONFLICT(id) DO UPDATE SET last_run_at = CURRENT_TIMESTAMP, swept = @swept
  `).run({ swept: examined })

  // Advance the cursor; clear it at the end of the listing so the next tick
  // wraps to the start of uploads/ and keeps coverage rolling.
  if (page.truncated && page.cursor) await env.CACHE.put(IMAGE_AUDIT_CURSOR_KEY, page.cursor)
  else await env.CACHE.delete(IMAGE_AUDIT_CURSOR_KEY)

  recordAnalytics(env, { kind: 'image_audit_sweep', labels: [], values: [examined, oversized] })
  return { examined, oversized, done: !page.truncated }
}

export type ReprocessResult = {
  attempted: number
  optimized: number
  failed: number
  bytesSaved: number
}

/**
 * Re-encodes a batch of the oversized objects the sweep found.
 *
 * Largest first: those are where the storage actually is, and if the month's
 * transformation budget runs out part-way it should have been spent on the
 * files that mattered rather than alphabetically.
 */
export async function reprocessAuditedImages(env: Env): Promise<ReprocessResult> {
  const db = getDb(env)
  const pending = await db.prepare(`
    SELECT key, byte_size FROM image_audit
    WHERE status = 'oversized'
    ORDER BY byte_size DESC
    LIMIT @limit
  `).all<{ key: string; byte_size: number }>({ limit: REPROCESS_BATCH })

  let optimized = 0
  let failed = 0
  let bytesSaved = 0

  for (const row of pending) {
    const key = String(row.key)
    const object = await env.ASSETS.get(key)
    if (!object) {
      // Deleted since the sweep. Drop the row rather than retrying forever.
      await db.prepare(`DELETE FROM image_audit WHERE key = @key`).run({ key })
      continue
    }
    const source = await object.arrayBuffer()
    const result = await optimizeImage(env, source, key.split('/').pop() || 'image')

    if (!result.ok || !result.bytes) {
      failed += 1
      await db.prepare(`
        UPDATE image_audit SET status = 'failed', reason = @reason, provider = @provider, checked_at = CURRENT_TIMESTAMP
        WHERE key = @key
      `).run({ key, reason: String(result.reason || 'unknown').slice(0, 120), provider: result.provider })
      // A provider-level wall stops the whole pass: every remaining file
      // would fail the same way, and hammering it just burns invocations.
      if (result.reason === 'no_provider_available' || result.reason === 'quota_exhausted') break
      continue
    }

    // Only replace when the result is genuinely smaller. A "successful"
    // transform that grew the file would cost storage AND quality.
    if (result.byteSize && result.byteSize >= source.byteLength) {
      await db.prepare(`
        UPDATE image_audit SET status = 'skipped', reason = 'no_saving', provider = @provider, checked_at = CURRENT_TIMESTAMP
        WHERE key = @key
      `).run({ key, provider: result.provider })
      continue
    }

    await env.ASSETS.put(key, result.bytes, {
      httpMetadata: { contentType: result.contentType || 'image/webp' },
    })
    await consumeQuota(env, 'r2_class_a', 1)
    optimized += 1
    bytesSaved += source.byteLength - (result.byteSize || 0)
    // Two independent writes (image_audit, file_assets) with no data
    // dependency on each other -- one db.batch() round trip instead of two
    // sequential awaits per reprocessed image.
    const statements: Array<{ sql: string; params: Record<string, unknown> }> = [{
      sql: `
        UPDATE image_audit SET
          status = 'optimized', provider = @provider, reason = NULL,
          original_size = COALESCE(original_size, @originalSize),
          byte_size = @byteSize, optimized_at = CURRENT_TIMESTAMP, checked_at = CURRENT_TIMESTAMP
        WHERE key = @key
      `,
      params: { key, provider: result.provider, originalSize: source.byteLength, byteSize: result.byteSize || 0 },
    }]
    const fileAssetStatement = buildFileAssetMetadataStatement(key, {
      byteSize: result.byteSize || result.bytes.byteLength,
      contentType: result.contentType || 'image/webp',
      optimized: true,
      provider: result.provider,
    })
    if (fileAssetStatement) statements.push(fileAssetStatement)
    await db.batch(statements)
  }

  if (optimized || failed) {
    recordAnalytics(env, { kind: 'image_reprocess', labels: [], values: [optimized, failed, bytesSaved] })
  }
  return { attempted: pending.length, optimized, failed, bytesSaved }
}

export type NormalizeOutcome = 'optimized' | 'skipped' | 'failed' | 'missing' | 'not_image'

/**
 * K3 (Part 417): normalize ONE stored object NOW -- the queue-side kernel
 * behind the on-upload path, so a fresh upload doesn't sit oversized for
 * up to six hours waiting for the sweep to list it. Same rules as
 * reprocessAuditedImages, one key at a time:
 *
 *   - only objects over the ceiling enter the ladder (needsOptimization);
 *     smaller ones are recorded 'ok' so the sweep needn't re-discover them
 *   - a result that isn't genuinely smaller is never stored ('no_saving')
 *   - a failed optimisation leaves the object exactly as it was and
 *     records why -- nothing here ever deletes or degrades an original
 */
export async function normalizeStoredImage(env: Env, key: string): Promise<NormalizeOutcome> {
  if (!IMAGE_KEY_RE.test(String(key || ''))) return 'not_image'
  const db = getDb(env)
  const buildUpsert = (fields: { byteSize: number; status: string; reason?: string | null; provider?: string | null; originalSize?: number | null; optimized?: boolean }): { sql: string; params: Record<string, unknown> } => ({
    sql: `
      INSERT INTO image_audit (key, byte_size, status, reason, provider, original_size, optimized_at, checked_at)
      VALUES (@key, @byteSize, @status, @reason, @provider, @originalSize, ${fields.optimized ? 'CURRENT_TIMESTAMP' : 'NULL'}, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        byte_size = @byteSize, status = @status, reason = @reason,
        provider = COALESCE(@provider, image_audit.provider),
        original_size = COALESCE(image_audit.original_size, @originalSize),
        ${fields.optimized ? 'optimized_at = CURRENT_TIMESTAMP,' : ''}
        checked_at = CURRENT_TIMESTAMP
    `,
    params: { key, byteSize: fields.byteSize, status: fields.status, reason: fields.reason ?? null, provider: fields.provider ?? null, originalSize: fields.originalSize ?? null },
  })
  // The image_audit upsert and the file_assets metadata sync are two
  // independent writes to two different tables with no data dependency on
  // each other -- one db.batch() round trip per message instead of two
  // sequential awaits (skipped in the 'failed'/'no_saving' branches below,
  // which never touch file_assets).
  const runUpsert = (
    fields: { byteSize: number; status: string; reason?: string | null; provider?: string | null; originalSize?: number | null; optimized?: boolean },
    fileAssetFields?: { byteSize: number; contentType?: string | null; optimized?: boolean; provider?: string | null },
  ) => {
    const statements = [buildUpsert(fields)]
    if (fileAssetFields) {
      const fileAssetStatement = buildFileAssetMetadataStatement(key, fileAssetFields)
      if (fileAssetStatement) statements.push(fileAssetStatement)
    }
    return db.batch(statements)
  }

  const object = await env.ASSETS.get(key)
  if (!object) return 'missing'
  const source = await object.arrayBuffer()
  if (!needsOptimization(source.byteLength)) {
    await runUpsert({ byteSize: source.byteLength, status: 'ok' }, {
      byteSize: source.byteLength,
      contentType: object.httpMetadata?.contentType || null,
    })
    return 'skipped'
  }
  const result = await optimizeImage(env, source, key.split('/').pop() || 'image')
  if (!result.ok || !result.bytes) {
    await runUpsert({ byteSize: source.byteLength, status: 'failed', reason: String(result.reason || 'unknown').slice(0, 120), provider: result.provider })
    return 'failed'
  }
  if (result.byteSize && result.byteSize >= source.byteLength) {
    await runUpsert({ byteSize: source.byteLength, status: 'skipped', reason: 'no_saving', provider: result.provider })
    return 'skipped'
  }
  await env.ASSETS.put(key, result.bytes, {
    httpMetadata: { contentType: result.contentType || 'image/webp' },
  })
  await consumeQuota(env, 'r2_class_a', 1)
  await runUpsert(
    { byteSize: result.byteSize || 0, status: 'optimized', provider: result.provider, originalSize: source.byteLength, optimized: true },
    { byteSize: result.byteSize || result.bytes.byteLength, contentType: result.contentType || 'image/webp', optimized: true, provider: result.provider },
  )
  recordAnalytics(env, { kind: 'image_reprocess', labels: ['on_upload'], values: [1, 0, source.byteLength - (result.byteSize || 0)] })
  return 'optimized'
}

/**
 * The producer half: fire one optimize-image message for a key that was
 * just written. Deliberately swallowing -- an upload must never fail
 * because the queue hiccuped, and the 6h sweep remains the safety net
 * that catches anything this misses (queue absent locally, send error,
 * consumer crash).
 */
export async function enqueueImageNormalization(env: Env, key: string): Promise<void> {
  if (!env.MEDIA_QUEUE || !IMAGE_KEY_RE.test(String(key || ''))) return
  try {
    await env.MEDIA_QUEUE.send({ assetKey: key, kind: 'optimize-image' })
  } catch (error) {
    console.error('[image-audit] enqueue failed (the 6h sweep will catch it)', error)
  }
}

/**
 * One cron tick: measure, then reprocess a small batch.
 *
 * Never throws. This runs alongside backup and drive-sync in the same
 * scheduled handler, and an image problem must not stop a backup.
 */
export async function maybeRunScheduledImageAudit(env: Env): Promise<void> {
  try {
    await sweepImageAudit(env)
    await reprocessAuditedImages(env)
  } catch (error) {
    console.error('[image-audit] pass failed', error)
  }
}
