// Cloudflare Queues consumer, replacing backend/src/services/importJobs.ts
// and mediaQueue.ts's BullMQ+Redis workers.
//
// Producer side (wired in wrangler.toml as [[queues.producers]]):
// routes/importJobs.ts does `await c.env.IMPORT_QUEUE.send({ jobId, kind })`
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
import { runImportAnalyze, runImportApply, markJobFailed } from './lib/importEngine'
import { runBulkDeleteJob } from './lib/bulkDeleteEngine'
import { continueCloudflareBackupAssetCopy, type BackupQueueMessage } from './lib/backup'
import { normalizeStoredImage } from './lib/imageAudit'

type ImportJobMessage = { jobId: string; kind: 'analyze' | 'apply' | 'bulk-delete' }
type MediaJobMessage = { assetKey: string; kind: 'optimize-video' | 'optimize-image' }

export async function handleImportQueue(batch: MessageBatch<ImportJobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { jobId, kind } = message.body
      // message.timestamp is when Cloudflare Queues accepted the message
      // (enqueue time); the delta to now is how long it sat queued before
      // this consumer picked it up -- one of the phases the backlog
      // explicitly asked to stop guessing about ("D1 batch size, or Queue
      // throughput"). Recorded into summary_json.timings alongside the
      // in-Worker phase timings so both show up in the same place.
      const queueLatencyMs = Date.now() - message.timestamp.getTime()
      if (kind === 'analyze') {
        await runImportAnalyze(env, jobId, queueLatencyMs)
      } else if (kind === 'apply') {
        await runImportApply(env, jobId, queueLatencyMs)
      } else {
        // bulk-delete jobs share this queue rather than a dedicated one --
        // see bulk_delete_jobs migration's header for why. No
        // queueLatencyMs plumbing here (yet) since bulk-delete jobs don't
        // have a summary_json.timings field to record it into the way
        // import jobs do; the job row's started_at/finished_at cover it.
        await runBulkDeleteJob(env, jobId)
      }
      message.ack()
    } catch (error) {
      console.error('[import-queue] job failed', message.body, error)
      // D1 writes inside runImportAnalyze/runImportApply already record the
      // failure onto the job row (status='failed', last_error) before
      // re-throwing -- retrying here covers transient infra errors (a D1
      // hiccup, an R2 read blip), not application-level validation errors,
      // which will fail identically on retry and just burn the queue's
      // retry budget. Cloudflare Queues' own max_retries (wrangler.toml,
      // defaults to a small number) caps how many times this actually
      // re-runs before the message goes to a dead-letter queue (if
      // configured) or is dropped.
      message.retry()
    }
  }
}

// Dead-letter consumer for 'business-os-import'. Cloudflare Queues delivers
// here automatically once a message has thrown on every one of its
// max_retries attempts (wrangler.toml's `dead_letter_queue` on the
// business-os-import consumer routes it here) -- this is NOT something
// application code sends to directly.
//
// Before this existed, that exhausted-retries case had no handler at all:
// the message just vanished into a DLQ nobody read, while the job row
// itself stayed wherever runImportAnalyze/runImportApply's own catch block
// had last left it -- 'failed' with a real last_error, IF the failing
// invocation got far enough to run that catch (see markJobFailed); or
// stuck showing 'analyzing'/'applying' forever with no further progress
// and no error at all, if the invocation was killed outright (e.g. a D1
// CPU-limit reset that tears down the connection before any JS catch runs)
// -- indistinguishable, from the tracker's point of view, from a job that
// was still genuinely working. The 20-minute stalled-job reaper (see
// routes/importJobs.ts's reapStalledImportJobs) eventually catches that
// second case, but only after sitting silently for up to 20 minutes.
//
// This closes the loop immediately instead of waiting on the reaper:
// mark the job definitively failed, with a last_error that's honest about
// what happened (repeated infra-level retries, not a data problem) and
// actionable (retry is safe -- see isFreshImportRun's comment for why a
// retry-from-here correctly resumes rather than restarts, and why a retry
// from routes/importJobs.ts's /:id/retry starts clean either way since
// that route always sets status='queued' before re-enqueueing).
export async function handleImportDeadLetterQueue(batch: MessageBatch<ImportJobMessage>, env: Env): Promise<void> {
  const db = getDb(env)
  for (const message of batch.messages) {
    try {
      const { jobId, kind } = message.body
      console.error('[import-queue] job exhausted all retries, moved to DLQ', { jobId, kind })
      if (kind === 'bulk-delete') {
        // Same terminal-failure bookkeeping as the import branch below, but
        // against bulk_delete_jobs -- markJobFailed (import-specific) can't
        // be reused here since it writes to the import_jobs table.
        // processed_count already reflects however many chunks committed
        // before the failure (each chunk updates it as it goes -- see
        // runBulkDeleteJob), so this doesn't lose progress, it just stops
        // resuming it automatically; retrying re-enqueues the same jobId
        // and picks up from that cursor.
        await db.prepare(`
          UPDATE bulk_delete_jobs
          SET status = 'failed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
              last_error = 'Bulk delete failed after repeated retries (a persistent infrastructure error). Already-processed ids stay deleted; safe to retry the rest.'
          WHERE id = @id AND finished_at IS NULL
        `).run({ id: jobId }).catch((writeError) => console.error('[import-queue] could not record bulk-delete DLQ failure', jobId, writeError))
      } else {
        await markJobFailed(
          db,
          jobId,
          `Import ${kind === 'analyze' ? 'analysis' : 'apply'} failed after repeated retries (a persistent infrastructure error, not a problem with your file). Safe to retry from the Import Jobs screen.`,
        )
        // markJobFailed already retries its own write internally and never
        // throws (see its own comment) -- once it returns, the failure is
        // recorded as best as it can be, so finished_at can be set directly
        // here rather than through another retry loop. Unlike markJobFailed
        // (also called from inside a chunk that might still be retried),
        // THIS call site is genuinely terminal: Cloudflare has already given
        // up on the message, nothing will resume it.
        await db.prepare(`UPDATE import_jobs SET finished_at = CURRENT_TIMESTAMP WHERE id = @id AND finished_at IS NULL`).run({ id: jobId }).catch(() => { /* best-effort -- markJobFailed's own write already recorded the failure */ })
      }
    } catch (error) {
      // markJobFailed is designed not to throw, so reaching here means
      // something more fundamental (e.g. message.body itself is malformed)
      // -- log it and ack anyway. Retrying a DLQ message that's already
      // exhausted retries would just loop forever with no way out.
      console.error('[import-queue] dead-letter handling itself failed', message.body, error)
    }
    message.ack()
  }
}

export async function handleMediaQueue(batch: MessageBatch<MediaJobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { assetKey, kind } = message.body
      if (kind === 'optimize-image') {
        // K3 (Part 417): the on-upload normalization path -- every image
        // ASSETS.put enqueues one of these (see enqueueImageNormalization),
        // so a fresh upload is normalized within seconds instead of waiting
        // for the 6h sweep. Same never-store-larger / never-delete rules as
        // the sweep; see lib/imageAudit.ts's normalizeStoredImage.
        await normalizeStoredImage(env, assetKey)
      }
      if (kind === 'optimize-video') {
        // ffmpeg cannot run inside a Worker (V8 isolate, no native binaries).
        // Hand off to a Cloudflare Container instead -- a real Docker image
        // with ffmpeg installed, running on Cloudflare's own infrastructure,
        // invoked from the Worker over HTTP:
        //
        //   const container = env.MEDIA_CONTAINER.get(env.MEDIA_CONTAINER.idFromName(assetKey))
        //   await container.fetch('http://container/optimize', { method: 'POST', body: JSON.stringify({ assetKey }) })
        //
        // The container reads the source from R2, runs the same ffmpeg
        // command the legacy backend's fileAssets.ts used to build
        // (buildVideoOptimizationArgs), and writes the result back to R2.
        // This needs a `containers` block in wrangler.toml -- the Dockerfile
        // already exists at cloudflare/containers/media-optimize.Dockerfile
        // (ffmpeg install step, reserved server.js slot) -- not implemented
        // in this pass; see that file's header comment for the wiring
        // steps. Not part of the import-jobs section -- tracked separately.
      }
      message.ack()
    } catch (error) {
      message.retry()
    }
  }
}

// Consumer for 'business-os-backup-assets' (Part 122). Each message is one
// continuation step of a single backup's full-asset-coverage copy --
// continueCloudflareBackupAssetCopy does the actual work (read the small
// lifecycle sidecar, copy the next free-plan-safe slice, update the sidecar,
// re-enqueue itself if more remain) and is unit-tested directly in
// scripts/test-backup-pure.cjs; it never reparses the large DB manifest.
// this consumer is just the queue-delivery plumbing around it, same shape
// as handleImportQueue/handleMediaQueue above.
export async function handleBackupQueue(batch: MessageBatch<BackupQueueMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { backupName, nextIndex } = message.body
      await continueCloudflareBackupAssetCopy(env, backupName, nextIndex)
      message.ack()
    } catch (error) {
      console.error('[backup-queue] continuation failed', message.body, error)
      // Transient infra errors (a D1/R2 hiccup) are worth retrying -- the
      // manifest read+update is idempotent-ish (re-running the same
      // nextIndex just re-copies the same slice, which is safe: copyObject
      // overwrites the same dest key with the same bytes). Cloudflare
      // Queues' own max_retries (wrangler.toml) caps how many times this
      // re-runs before the message is dropped (no dead-letter queue
      // configured for this consumer -- see wrangler.toml's comment on it).
      message.retry()
    }
  }
}
