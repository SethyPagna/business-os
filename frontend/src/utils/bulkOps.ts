interface RunConcurrentTasksOptions {
  concurrency?: unknown
}

type RunConcurrentTaskWorker<TItem, TValue> = (item: TItem, index: number) => Promise<TValue> | TValue

interface RunConcurrentTaskSuccess<TItem, TValue> {
  ok: true
  item: TItem
  index: number
  value: TValue
}

interface RunConcurrentTaskFailure<TItem> {
  ok: false
  item: TItem
  index: number
  error: unknown
}

type RunConcurrentTaskResult<TItem, TValue> =
  | RunConcurrentTaskSuccess<TItem, TValue>
  | RunConcurrentTaskFailure<TItem>

function isSuccess<TItem, TValue>(
  entry: RunConcurrentTaskResult<TItem, TValue> | undefined,
): entry is RunConcurrentTaskSuccess<TItem, TValue> {
  return !!entry?.ok
}

function isFailure<TItem, TValue>(
  entry: RunConcurrentTaskResult<TItem, TValue> | undefined,
): entry is RunConcurrentTaskFailure<TItem> {
  return !!entry && !entry.ok
}

export async function runConcurrentTasks<TItem = unknown, TValue = unknown>(
  items: TItem[] = [],
  worker: unknown,
  options: RunConcurrentTasksOptions = {},
) {
  const safeItems = Array.isArray(items) ? items : []
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || 6) || 6, safeItems.length || 1))
  const results: Array<RunConcurrentTaskResult<TItem, TValue> | undefined> = new Array(safeItems.length)
  let cursor = 0

  async function runner() {
    while (cursor < safeItems.length) {
      const index = cursor
      cursor += 1
      const item = safeItems[index]
      try {
        const value = await (worker as RunConcurrentTaskWorker<TItem, TValue>)(item, index)
        results[index] = { ok: true, item, index, value }
      } catch (error) {
        results[index] = { ok: false, item, index, error }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()))

  return {
    results,
    successes: results.filter(isSuccess),
    failures: results.filter(isFailure),
  }
}
