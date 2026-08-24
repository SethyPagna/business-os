import { lazy, type ComponentType } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React's own lazy() signature (ComponentType<any>), so components with concrete prop types can be passed through unchanged.
type LazyImporter<T> = () => Promise<{ default: T }>

const RETRY_ATTEMPTS = 3
const RETRY_DELAY_MS = 350
const IMPORT_TIMEOUT_MS = 15000

function isRetryableChunkError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message || error || '')
  return /Loading chunk/i.test(message)
    || /ChunkLoadError/i.test(message)
    || /Failed to fetch dynamically imported module/i.test(message)
    || /Importing a module script failed/i.test(message)
    || /timed out/i.test(message)
    || /network/i.test(message)
    || /aborted/i.test(message)
}

function createTimeoutError(key: string): Error {
  const error = new Error(`Loading "${key}" timed out. Please try again.`)
  error.name = 'ChunkTimeoutError'
  return error
}

async function importWithTimeout<T>(importer: LazyImporter<T>, key: string): Promise<{ default: T }> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      importer(),
      new Promise<{ default: T }>((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(key)), IMPORT_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}

/**
 * Drop-in replacement for React.lazy(importer) that silently retries a
 * failed/slow chunk fetch a couple of times before giving up. Use this for
 * any lazily-loaded modal, sheet, or sub-component nested inside a page.
 */
export function lazyRetry<T extends ComponentType<any>>(importer: LazyImporter<T>, key: string) {
  return lazy(async () => {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await importWithTimeout(importer, key)
      } catch (error) {
        const isFinalAttempt = attempt >= RETRY_ATTEMPTS
        if (isFinalAttempt || !isRetryableChunkError(error)) throw error
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
    throw createTimeoutError(key)
  })
}
