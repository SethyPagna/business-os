// Chunk-recovery reload guard -- shared by App.tsx (page chunks) and
// utils/lazyImport.ts (nested modal/sheet chunks).
//
// Why this exists (Sep 2026 incident): the Worker ships a new hashed asset
// graph on every deploy, and the service worker retains only the previous
// static-cache generation (service-worker.ts activate). A tab that stays open
// across two or more deploys -- a POS tab lives for days -- has NO server-side
// channel that tells it a newer build exists: /health reports a static string
// and /api/auth/bootstrap's runtime block carries no frontend hash, so the
// hash-keyed runtime-mismatch reload in AppContext never fires on Cloudflare.
// The only signal is a lazy import failing, and a missing /assets/*.js comes
// back as the SPA fallback (200 text/html), i.e. "not a valid JavaScript MIME
// type".
//
// Both recovery paths used to arm a tab-lifetime sessionStorage sentinel ('1')
// after ONE reload. If that reload did not land on a working build (edge cache
// still serving the old index, a second deploy in between, a transient fetch
// failure), the sentinel stayed set and every later deploy left that tab
// permanently unable to self-heal: every modal/page behind a stale chunk kept
// failing until someone hard-refreshed.
//
// The guard below keys "already reloaded" on the BUILD the reload was for:
//   - when the live manifest (/business-os-build.json, emitted by
//     vite.config.ts emitBuildManifest) is reachable, one reload per
//     (chunk key, live build hash). A newer deploy is a new live hash, so the
//     guard re-arms by itself.
//   - when the manifest is unreachable (offline, SPA fallback HTML, timeout),
//     one reload per (chunk key, running build hash). A reload that lands on a
//     different build re-arms; one that lands on the same build does not.
// For any fixed (live, running) pair that bounds a key to at most two reloads,
// so the loop-safety of the old sentinel is kept without its dead end. The
// marker is cleared only by a successful import -- never on a final failure,
// which would re-arm the same build and turn every navigation into a reload.
//
// Legacy '1' sentinels written by pre-fix builds parse as "no marker" on
// purpose: the whole point is that a newer build must be allowed to try.

declare const __FRONTEND_BUILD_HASH__: string | undefined

export const LIVE_BUILD_MANIFEST_URL = '/business-os-build.json'
export const LIVE_BUILD_FETCH_TIMEOUT_MS = 2_500

export const RUNNING_BUILD_HASH: string = (
  typeof __FRONTEND_BUILD_HASH__ !== 'undefined' ? String(__FRONTEND_BUILD_HASH__ || '').trim() : ''
) || 'dev'

export type ChunkReloadMarker = {
  /** Live build hash the last reload was issued for, when it was known. */
  live: string | null
  /** Build hash that was RUNNING when the last reload was issued. */
  build: string | null
}

export type ChunkReloadReason =
  | 'live-build-first-attempt'
  | 'live-build-changed'
  | 'live-build-already-tried'
  | 'running-build-first-attempt'
  | 'running-build-already-tried'
  | 'marker-unavailable'

export type ChunkReloadDecision = {
  allow: boolean
  marker: ChunkReloadMarker
  reason: ChunkReloadReason
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function parseChunkReloadMarker(raw: string | null | undefined): ChunkReloadMarker | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { live?: unknown; build?: unknown } | null
    if (!parsed || typeof parsed !== 'object') return null
    const live = typeof parsed.live === 'string' && parsed.live.trim() ? parsed.live.trim() : null
    const build = typeof parsed.build === 'string' && parsed.build.trim() ? parsed.build.trim() : null
    if (!live && !build) return null
    return { live, build }
  } catch {
    // Legacy '1' sentinel or garbage: must never block a newer build.
    return null
  }
}

export function serializeChunkReloadMarker(marker: ChunkReloadMarker): string {
  return JSON.stringify({ live: marker.live || null, build: marker.build || null })
}

/**
 * Pure decision: may this chunk key trigger a recovery reload now?
 * See the header comment for the two rules and the loop bound.
 */
export function decideChunkReload(
  previous: ChunkReloadMarker | null,
  liveBuildHash: string | null,
  runningBuildHash: string,
): ChunkReloadDecision {
  const running = String(runningBuildHash || '').trim() || 'dev'
  const live = liveBuildHash ? String(liveBuildHash).trim() || null : null

  if (live) {
    const alreadyTried = previous?.live === live
    return {
      allow: !alreadyTried,
      marker: { live, build: running },
      reason: alreadyTried
        ? 'live-build-already-tried'
        : (previous?.live ? 'live-build-changed' : 'live-build-first-attempt'),
    }
  }

  const alreadyTried = previous?.build === running
  return {
    allow: !alreadyTried,
    marker: { live: previous?.live ?? null, build: running },
    reason: alreadyTried ? 'running-build-already-tried' : 'running-build-first-attempt',
  }
}

/**
 * Reads the live build hash from the deployed manifest. Returns null on any
 * failure -- offline, timeout, non-2xx, or the SPA fallback answering with
 * HTML -- so callers fall back to the running-build rule instead of looping.
 */
export async function fetchLiveBuildHash(
  fetchImpl?: FetchLike,
  timeoutMs: number = LIVE_BUILD_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  const doFetch: FetchLike | null = fetchImpl
    || (typeof fetch === 'function' ? (input, init) => fetch(input, init) : null)
  if (!doFetch) return null
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined
    const response = await doFetch(LIVE_BUILD_MANIFEST_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    })
    if (!response || !response.ok) return null
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase()
    // A missing manifest is answered by the single-page-application fallback
    // (200 text/html); treating that as "unknown" is what keeps this honest.
    if (!contentType.includes('json')) return null
    const body = await response.json().catch(() => null) as { hash?: unknown } | null
    const hash = typeof body?.hash === 'string' ? body.hash.trim() : ''
    return hash || null
  } catch {
    return null
  }
}

export function readChunkReloadMarker(storageKey: string): ChunkReloadMarker | null {
  try {
    return parseChunkReloadMarker(window.sessionStorage.getItem(storageKey))
  } catch {
    return null
  }
}

export function writeChunkReloadMarker(storageKey: string, marker: ChunkReloadMarker): boolean {
  try {
    window.sessionStorage.setItem(storageKey, serializeChunkReloadMarker(marker))
    return true
  } catch {
    return false
  }
}

export function clearChunkReloadMarker(storageKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey)
  } catch {
    // storage unavailable -- nothing to clear
  }
}

/**
 * Decide AND persist. When the decision is "allow" the marker is written
 * before the caller navigates; if the marker cannot be written the reload is
 * refused, because an unrecorded reload is the one way to loop.
 */
export async function claimChunkReload(
  storageKey: string,
  options: { runningBuildHash?: string; fetchImpl?: FetchLike } = {},
): Promise<ChunkReloadDecision> {
  const previous = readChunkReloadMarker(storageKey)
  const live = await fetchLiveBuildHash(options.fetchImpl)
  const decision = decideChunkReload(previous, live, options.runningBuildHash ?? RUNNING_BUILD_HASH)
  if (!decision.allow) return decision
  if (!writeChunkReloadMarker(storageKey, decision.marker)) {
    return { ...decision, allow: false, reason: 'marker-unavailable' }
  }
  return decision
}
