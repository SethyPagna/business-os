import { shouldPersistLocalMirror as shouldPersistLocalMirrorByPolicy, LIVE_SERVER_SENSITIVE_MIRROR_TABLES } from '../platform/storage/storagePolicy.ts'
import { getSyncServerUrl, route } from './http.ts'
import { actorReadResultScope, assertActorReadScope, captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from './actorReadScope.ts'

type MirrorRows = Record<string, unknown>
type MirrorFn<TResult> = (result: TResult) => unknown | Promise<unknown>
type RouteFn<TResult> = () => TResult | Promise<TResult>
type IdleCallback = (deadline?: unknown) => void

let sensitiveMirrorPurgePromise: Promise<unknown> | null = null
let localDbPromise: Promise<typeof import('./localDb.ts')> | null = null
const MIRROR_WRITE_IDLE_DELAY_MS = 10_000

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

export function mirrorReadResult<TResult>(mirrorFn: MirrorFn<TResult> | null | undefined, result: TResult, scope = captureActorReadScope()): TResult {
  scope = actorReadResultScope(result, scope)
  if (typeof mirrorFn === 'function') {
    scheduleMirrorWrite(() => {
      Promise.resolve()
        .then(() => isActorReadScopeCurrent(scope) ? mirrorFn(result) : undefined)
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
  return route(channel, async () => {
    const scope = captureActorReadScope(channel)
    return mirrorReadResult(mirrorFn, await serverFn(), scope)
  }, localFn)
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

export function mirrorTable(tableName: string, scope: ActorReadScope = captureActorReadScope(tableName)) {
  return async (rows: unknown): Promise<unknown> => {
    const resultScope = actorReadResultScope(rows, scope)
    const { dexieDb, clearLocalMirrorTables, replaceTableContents } = await getLocalDbModule()
    if (!isActorReadScopeCurrent(resultScope)) return []
    if (!shouldPersistLocalMirror(tableName)) {
      await clearLocalMirrorTables([tableName]).catch(() => {})
      return []
    }
    const incomingRows: MirrorRows[] = []
    for (const row of Array.isArray(rows) ? rows : []) {
      incomingRows.push({ ...(row || {}) })
    }
    // Keep the final authority check INSIDE the IndexedDB transaction: throwing
    // after a queued put rolls it back instead of publishing into a new actor.
    return dexieDb.transaction('rw', dexieDb.table(tableName), async () => {
      assertActorReadScope(resultScope)
      const result = await replaceTableContents(tableName, incomingRows)
      assertActorReadScope(resultScope)
      return result
    })
  }
}
