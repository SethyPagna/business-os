// Cloudflare Queues consumer, replacing backend/src/services/importJobs.ts
// and mediaQueue.ts's BullMQ+Redis workers.
//
// Producer side (already wired in wrangler.toml as [[queues.producers]]):
// a route handler does `await c.env.IMPORT_QUEUE.send({ jobId, ... })`
// instead of `importQueue.add('analyze', payload)`. Same idea, no Redis.
//
// Consumer side (this file, exported as the `queue` handler below): Cloudflare
// invokes it automatically with a batch of messages. No polling, no worker
// process to keep alive, no "is the worker container still running" to
// monitor -- Cloudflare schedules the invocations.
//
// max_batch_size / max_batch_timeout in wrangler.toml control batching;
// message.retry() / message.ack() control at-least-once delivery, same
// concept as BullMQ's job.retry()/job.moveToCompleted().

import type { Env } from './index'
import { getDb } from './lib/db'

type ImportJobMessage = { jobId: string; kind: 'analyze' | 'apply' }
type MediaJobMessage = { assetKey: string; kind: 'optimize-video' | 'optimize-image' }

export async function handleImportQueue(batch: MessageBatch<ImportJobMessage>, env: Env): Promise<void> {
  const db = getDb(env)
  for (const message of batch.messages) {
    try {
      const { jobId, kind } = message.body
      // Same phase/progress-tracking columns the Docker path already writes
      // to (import_jobs.phase, processed_rows, failed_rows, ...) -- only the
      // trigger mechanism changed, not the schema or the job bookkeeping.
      await db.prepare(`UPDATE import_jobs SET phase = @phase, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
        .run({ id: jobId, phase: kind === 'analyze' ? 'analyzing' : 'applying' })

      // ... row-by-row CSV/ZIP processing goes here, following the same
      // logic as backend/src/services/importJobs.ts, reading the uploaded
      // file from R2 (env.ASSETS) in streaming chunks to stay within the
      // Worker's memory/CPU limits. Large files (this app allows up to
      // 2048MB ZIPs) may need chunked re-invocation: process N rows, write
      // progress, re-enqueue a continuation message for the rest, rather
      // than one Worker invocation processing the whole file -- Workers
      // have a CPU-time limit per invocation that a single Docker container
      // process did not.

      message.ack()
    } catch (error) {
      message.retry()
    }
  }
}

export async function handleMediaQueue(batch: MessageBatch<MediaJobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { assetKey, kind } = message.body
      if (kind === 'optimize-video') {
        // ffmpeg cannot run inside a Worker (V8 isolate, no native binaries).
        // Hand off to a Cloudflare Container instead -- a real Docker image
        // with ffmpeg installed, running on Cloudflare's own infrastructure
        // (GA as of April 2026), invoked from the Worker over HTTP:
        //
        //   const container = env.MEDIA_CONTAINER.get(env.MEDIA_CONTAINER.idFromName(assetKey))
        //   await container.fetch('http://container/optimize', { method: 'POST', body: JSON.stringify({ assetKey }) })
        //
        // The container reads the source from R2, runs the same ffmpeg
        // command backend/src/fileAssets.ts already builds
        // (buildVideoOptimizationArgs), and writes the result back to R2.
        // This needs a `containers` block in wrangler.toml and a Dockerfile
        // (can reuse ops/docker/Dockerfile.release's ffmpeg install step) --
        // not implemented in this pass; see MIGRATION.md.
      }
      message.ack()
    } catch (error) {
      message.retry()
    }
  }
}
