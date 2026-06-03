import { shouldPersistLocalMirror as shouldPersistLocalMirrorByPolicy, LIVE_SERVER_SENSITIVE_MIRROR_TABLES } from '../platform/storage/storagePolicy.ts'
import { getSyncServerUrl, route } from './http.ts'

type MirrorRows = Record<string, unknown>
type MirrorFn<TResult> = (result: TResult) => unknown | Promise<unknown>
type RouteFn<TResult> = () => TResult | Promise<TResult>
type IdleCallback = (deadline?: unknown) => void

let sensitiveMirrorPurgePromise: Promise<unknown> | null = null
let localDbPromise: Promise<typeof import('./localDb.ts')> | null = null
const MIRROR_WRITE_IDLE_DELAY_MS = 2500

function getLocalDbModule(): Promise<typeof import('./localDb.ts')> {
  if (!localDbPromise) localDbPromise = import('./localDb.ts')
  return localDbPromise
}

function scheduleMirrorWrite(run: () => void): void {
  if (typeof window === 'undefined') {
    Promise.resolve().then(run).catch(() => {})
    return
  }
  window.setTimeout(() => {
    const idle = (window as unknown as { requestIdleCallback?: (callback: IdleCallback, options?: { timeout?: number }) => number }).requestIdleCallback
    if (typeof idle === 'function') {
      idle(() => run(), { timeout: MIRROR_WRITE_IDLE_DELAY_MS })
      return
    }
    run()
  }, MIRROR_WRITE_IDLE_DELAY_MS)
}

export function mirrorReadResult<TResult>(mirrorFn: MirrorFn<TResult> | null | undefined, result: TResult): TResult {
  if (typeof mirrorFn === 'function') {
    scheduleMirrorWrite(() => {
      Promise.resolve()
        .then(() => mirrorFn(result))
        .catch(() => {})
    })
  }
  return result
}

export function routeMirrored<TResult>(
  channel: string,
  serverFn: RouteFn<TResult>,
  localFn?: RouteFn<TResult>,
  mirrorFn?: MirrorFn<TResult>,
): Promise<TResult | null> {
  return route(channel, async () => mirrorReadResult(mirrorFn, await serverFn()), localFn)
}

export function shouldPersistLocalMirror(tableName: string): boolean {
  return shouldPersistLocalMirrorByPolicy(tableName, getSyncServerUrl())
}

export async function purgeSensitiveLiveServerMirrors(): Promise<void> {
  if (!getSyncServerUrl()) {
    sensitiveMirrorPurgePromise = null
    return
  }
  if (!sensitiveMirrorPurgePromise) {
    const { clearLocalMirrorTables } = await getLocalDbModule()
    sensitiveMirrorPurgePromise = clearLocalMirrorTables([...LIVE_SERVER_SENSITIVE_MIRROR_TABLES]).catch(() => {})
  }
  await sensitiveMirrorPurgePromise
}

export function mirrorTable(tableName: string) {
  return async (rows: unknown): Promise<unknown> => {
    const { clearLocalMirrorTables, replaceTableContents } = await getLocalDbModule()
    if (!shouldPersistLocalMirror(tableName)) {
      await clearLocalMirrorTables([tableName]).catch(() => {})
      return []
    }
    const incomingRows: MirrorRows[] = []
    for (const row of Array.isArray(rows) ? rows : []) {
      incomingRows.push({ ...(row || {}) })
    }
    return replaceTableContents(tableName, incomingRows)
  }
}
