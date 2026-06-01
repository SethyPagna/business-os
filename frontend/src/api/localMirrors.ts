import { shouldPersistLocalMirror as shouldPersistLocalMirrorByPolicy, LIVE_SERVER_SENSITIVE_MIRROR_TABLES } from '../platform/storage/storagePolicy.ts'
import { getSyncServerUrl, route } from './http.ts'
import { clearLocalMirrorTables, replaceTableContents } from './localDb.ts'

type MirrorRows = Record<string, unknown>
type MirrorFn<TResult> = (result: TResult) => unknown | Promise<unknown>
type RouteFn<TResult> = () => TResult | Promise<TResult>

let sensitiveMirrorPurgePromise: Promise<unknown> | null = null

export function mirrorReadResult<TResult>(mirrorFn: MirrorFn<TResult> | null | undefined, result: TResult): TResult {
  if (typeof mirrorFn === 'function') {
    Promise.resolve()
      .then(() => mirrorFn(result))
      .catch(() => {})
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
    sensitiveMirrorPurgePromise = clearLocalMirrorTables([...LIVE_SERVER_SENSITIVE_MIRROR_TABLES]).catch(() => {})
  }
  await sensitiveMirrorPurgePromise
}

export function mirrorTable(tableName: string) {
  return async (rows: unknown): Promise<unknown> => {
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
