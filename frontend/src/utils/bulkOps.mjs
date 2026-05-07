export async function runConcurrentTasks(items = [], worker, options = {}) {
  const safeItems = Array.isArray(items) ? items : []
  const concurrency = Math.max(1, Math.min(Number(options.concurrency || 6) || 6, safeItems.length || 1))
  const results = new Array(safeItems.length)
  let cursor = 0

  async function runner() {
    while (cursor < safeItems.length) {
      const index = cursor
      cursor += 1
      const item = safeItems[index]
      try {
        const value = await worker(item, index)
        results[index] = { ok: true, item, index, value }
      } catch (error) {
        results[index] = { ok: false, item, index, error }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()))

  return {
    results,
    successes: results.filter((entry) => entry?.ok),
    failures: results.filter((entry) => entry && !entry.ok),
  }
}

