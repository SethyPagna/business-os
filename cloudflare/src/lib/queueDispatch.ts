// One place that decides HOW a unit of import work gets run: through
// Cloudflare Queues when the IMPORT_QUEUE binding exists, or inline in the
// current invocation when it does not.
//
// Why this exists at all. Before this file, nine call sites did a bare
// `env.IMPORT_QUEUE.send(...)` (five in importEngine.ts, three in
// routes/importJobs.ts, one in bulkDeleteEngine.ts). If the binding is
// missing -- a deployment from a config whose [[queues.producers]] block was
// dropped, a preview/dev environment, a partially-applied config swap -- every
// one of them throws `Cannot read properties of undefined (reading 'send')`
// AFTER the job row has already been written, so the import shows as queued
// forever and the caller gets a 500 with an unrecognisable message. That is
// the failure mode the free-vs-paid split has to survive, because the whole
// point of shipping two configs is that the deployment can be wrong about
// which one it is running.
//
// Note this is NOT a free-plan thing: Cloudflare Queues are available on the
// Free plan too, and wrangler.free.toml binds IMPORT_QUEUE exactly like
// wrangler.toml does (it only lowers max_batch_size). So on a correct free
// deployment this module still returns 'queued'. The inline path is the
// auto-fallback for a deployment with no queue binding at all, whatever plan
// it is on -- which is why it reads the binding and never the plan tier.
//
// The inline path is a degraded mode, honestly:
//   - It runs the work in the caller's invocation, so a large import will be
//     cut short by the platform CPU limit rather than finishing.
//   - That is survivable because every self-continuation site checkpoints its
//     cursor to D1 (saveChunkState / saveMaterializeState) BEFORE dispatching
//     the next unit. A killed invocation loses the in-flight chunk, not the
//     progress, and Retry from the Import Jobs screen resumes from the last
//     committed cursor.
//   - It is a trampoline, not recursion: a nested dispatch from inside a
//     running chunk is appended to `pending` and picked up by the loop below,
//     so a thousand-chunk import does not build a thousand-frame stack.

import type { Env } from '../index'

/**
 * Same shape queue.ts's consumer reads out of `message.body` -- kept here so
 * the producers and the consumer cannot drift apart silently.
 */
export type ImportQueueMessage = { jobId: string; kind: 'analyze' | 'apply' | 'bulk-delete' }

/** 'queued' = handed to Cloudflare Queues. 'inline' = ran (or is running) here. */
export type ImportDispatchMode = 'queued' | 'inline'

type InlineImportRunner = (env: Env, message: ImportQueueMessage) => Promise<void>

// Registered by src/queue.ts at module load (index.ts imports queue.ts on
// every isolate, so this is always wired in a real Worker). Registration
// rather than a direct import because importEngine.ts and bulkDeleteEngine.ts
// both import THIS module -- importing them from here would be a cycle.
let inlineRunner: InlineImportRunner | null = null

export function registerInlineImportRunner(runner: InlineImportRunner): void {
  inlineRunner = runner
}

type InlineScope = { pending: ImportQueueMessage[]; active: boolean }
// Only private runner-facing wrappers are keys, never the shared Worker Env.
// Thus two requests with the same Env still own independent completion/error.
// Weak keys do not retain an invocation after its runner releases the wrapper.
let inlineScopes = new WeakMap<Env, InlineScope>()

/**
 * Dispatch one unit of import work. Never throws for a missing binding; the
 * only errors that escape are the ones the work itself raises (which the
 * callers already handle -- markJobFailed etc.).
 */
export async function dispatchImportWork(env: Env, message: ImportQueueMessage): Promise<ImportDispatchMode> {
  const queue = env?.IMPORT_QUEUE
  if (queue) {
    await queue.send(message)
    return 'queued'
  }

  if (!inlineRunner) {
    // Only reachable if queue.ts never loaded (a harness that loads
    // importEngine.ts standalone and hands it an env with no IMPORT_QUEUE).
    // Loud on purpose: silently dropping the message would leave the job row
    // stuck in 'queued' with nothing on its way to pick it up.
    throw new Error('No IMPORT_QUEUE binding and no inline import runner registered; import work cannot be dispatched.')
  }

  const inherited = env && inlineScopes.get(env)
  if (inherited) {
    if (!inherited.active) throw new Error('The inline import dispatch scope has already completed.')
    inherited.pending.push(message)
    // Only continuations carrying THIS root's private wrapper may return
    // early. The root caller awaits the entire flat drain, including errors.
    return 'inline'
  }

  const scope: InlineScope = { pending: [message], active: true }
  // Forward bindings without copying, rebinding or annotating the shared Env.
  // Reflect with the original receiver also preserves accessor-backed bindings;
  // own keys/descriptors and binding object identity remain unchanged.
  const scopedEnv = new Proxy(env ?? {} as Env, {
    get: (target, property) => Reflect.get(target, property, target),
  })
  inlineScopes.set(scopedEnv, scope)
  const runner = inlineRunner
  try {
    while (scope.pending.length) {
      const next = scope.pending.shift() as ImportQueueMessage
      await runner(scopedEnv, next)
    }
  } finally {
    scope.active = false
    // Abandon only this root's continuations. Keep the closed scope associated
    // with a retained wrapper so a late callback cannot resurrect failed work.
    scope.pending.length = 0
  }
  return 'inline'
}

// Floor for the redelivery back-off below. A chunk this small is slow (many
// more queue hops per import) but is what gets a job that keeps dying on CPU
// past the row that is killing it, instead of re-running the same oversized
// window until Cloudflare Queues gives up and DLQs it.
export const MIN_IMPORT_CHUNK_ROWS = 25

/**
 * Chunk size for THIS delivery of a queue message.
 *
 * The honest version of what this can and cannot do: when a Worker isolate
 * blows its CPU limit, the isolate is torn down. There is no exception, no
 * catch block runs, no `finally` runs, the job row keeps whatever status the
 * last committed write left on it. So nothing inside the Worker can "notice"
 * a CPU kill and retry smaller -- queue.ts's own `catch { message.retry() }`
 * never runs for that case. What DOES survive is Cloudflare Queues'
 * at-least-once delivery: the message was never acked, so it comes back, with
 * `message.attempts` incremented. That redelivery is the only signal there
 * is, and this function is what turns it into a smaller window.
 *
 * Halving per attempt: 600 -> 300 -> 150 -> 75 -> 37 -> 25 on paid (free
 * starts at 150, so 150 -> 75 -> 37 -> 25). Cursor progress is already
 * checkpointed per chunk, so a smaller retry resumes from where the killed
 * one committed; it does not restart the file.
 *
 * Note this also fires for redeliveries that had nothing to do with CPU (a
 * D1 blip, an R2 hiccup). Running those a bit smaller is harmless; guessing
 * which kind of failure it was is not possible from here.
 */
export function chunkRowsForAttempt(limit: number, attempt?: number): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt as number)) : 1
  // Cap the shift rather than using `>>`, which wraps into nonsense past 31.
  const halvings = Math.min(n - 1, 16)
  const scaled = Math.floor(limit / Math.pow(2, halvings))
  // A tier whose own limit is already below the floor keeps its own limit --
  // the floor is a back-off floor, never a raise.
  return Math.max(Math.min(limit, MIN_IMPORT_CHUNK_ROWS), scaled)
}

/** Test seam; use only when no dispatch is in flight. */
export function __resetQueueDispatchForTests(): void {
  inlineRunner = null
  inlineScopes = new WeakMap()
}
