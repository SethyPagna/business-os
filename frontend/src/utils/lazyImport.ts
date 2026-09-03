import { lazy, type ComponentType } from 'react'
import { claimChunkReload, clearChunkReloadMarker } from './chunkReloadGuard.ts'
import { flushPendingWorkDrafts } from './workDrafts.ts'

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
    || /(?:not a valid|expected a).*JavaScript.*MIME type/i.test(message)
    || /MIME type[^\n]*text\/html/i.test(message)
    || /timed out/i.test(message)
    || /network/i.test(message)
    || /aborted/i.test(message)
}

const nestedMarkerKey = (key: string): string => `bos-nested-lazy-reload:${key}`

function clearLazyRetryMarker(key: string): void {
  clearChunkReloadMarker(nestedMarkerKey(key))
}

// One recovery reload per (chunk key, build) -- see utils/chunkReloadGuard.ts.
// The old tab-lifetime '1' sentinel left a long-lived tab unable to self-heal
// after any later deploy once a single reload had not landed on a good build.
async function triggerLazyChunkRecovery(key: string): Promise<boolean> {
  if (typeof window === 'undefined' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false
  const decision = await claimChunkReload(nestedMarkerKey(key))
  if (!decision.allow) return false
  // This path reloads immediately (a modal chunk, not a page): persist any
  // debounced draft first so the reload cannot become silent form/cart loss.
  flushPendingWorkDrafts()
  const url = new URL(window.location.href)
  url.searchParams.set('__bos_reload', String(Date.now()))
  url.searchParams.set('__bos_reason', `nested-chunk:${key}:${decision.reason}`)
  if (decision.marker.live) url.searchParams.set('__bos_server_build', decision.marker.live)
  window.location.replace(url.toString())
  return true
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
        const loaded = await importWithTimeout(importer, key)
        if (typeof window !== 'undefined') clearLazyRetryMarker(key)
        return loaded
      } catch (error) {
        const isFinalAttempt = attempt >= RETRY_ATTEMPTS
        if (!isRetryableChunkError(error)) throw error
        if (isFinalAttempt) {
          if (await triggerLazyChunkRecovery(key)) return await new Promise<never>(() => {})
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
    throw createTimeoutError(key)
  })
}
