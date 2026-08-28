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
import { listObjects } from './r2'
import { recordAnalytics } from './analytics'
import { consumeQuota } from './quotaGuard'
import { IMAGE_MAX_BYTES, needsOptimization, optimizeImage } from './imagePipeline'

/** Objects examined per sweep. Bounded so the cron tick stays predictable. */
const SWEEP_BATCH = 400
/** Images re-encoded per pass. Small on purpose -- this is the metered half. */
const REPROCESS_BATCH = 25

const IMAGE_KEY_RE = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i

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

  const objects = await listObjects(env.ASSETS, 'uploads/')
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = []

  for (const object of objects.slice(0, SWEEP_BATCH)) {
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

  recordAnalytics(env, { kind: 'image_audit_sweep', labels: [], values: [examined, oversized] })
  return { examined, oversized, done: objects.length <= SWEEP_BATCH }
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
    await db.prepare(`
      UPDATE image_audit SET
        status = 'optimized', provider = @provider, reason = NULL,
        original_size = COALESCE(original_size, @originalSize),
        byte_size = @byteSize, optimized_at = CURRENT_TIMESTAMP, checked_at = CURRENT_TIMESTAMP
      WHERE key = @key
    `).run({ key, provider: result.provider, originalSize: source.byteLength, byteSize: result.byteSize || 0 })
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
  const upsert = (fields: { byteSize: number; status: string; reason?: string | null; provider?: string | null; originalSize?: number | null; optimized?: boolean }) => db.prepare(`
    INSERT INTO image_audit (key, byte_size, status, reason, provider, original_size, optimized_at, checked_at)
    VALUES (@key, @byteSize, @status, @reason, @provider, @originalSize, ${fields.optimized ? 'CURRENT_TIMESTAMP' : 'NULL'}, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      byte_size = @byteSize, status = @status, reason = @reason,
      provider = COALESCE(@provider, image_audit.provider),
      original_size = COALESCE(image_audit.original_size, @originalSize),
      ${fields.optimized ? 'optimized_at = CURRENT_TIMESTAMP,' : ''}
      checked_at = CURRENT_TIMESTAMP
  `).run({ key, byteSize: fields.byteSize, status: fields.status, reason: fields.reason ?? null, provider: fields.provider ?? null, originalSize: fields.originalSize ?? null })

  const object = await env.ASSETS.get(key)
  if (!object) return 'missing'
  const source = await object.arrayBuffer()
  if (!needsOptimization(source.byteLength)) {
    await upsert({ byteSize: source.byteLength, status: 'ok' })
    return 'skipped'
  }
  const result = await optimizeImage(env, source, key.split('/').pop() || 'image')
  if (!result.ok || !result.bytes) {
    await upsert({ byteSize: source.byteLength, status: 'failed', reason: String(result.reason || 'unknown').slice(0, 120), provider: result.provider })
    return 'failed'
  }
  if (result.byteSize && result.byteSize >= source.byteLength) {
    await upsert({ byteSize: source.byteLength, status: 'skipped', reason: 'no_saving', provider: result.provider })
    return 'skipped'
  }
  await env.ASSETS.put(key, result.bytes, {
    httpMetadata: { contentType: result.contentType || 'image/webp' },
  })
  await consumeQuota(env, 'r2_class_a', 1)
  await upsert({ byteSize: result.byteSize || 0, status: 'optimized', provider: result.provider, originalSize: source.byteLength, optimized: true })
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
