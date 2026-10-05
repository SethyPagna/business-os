// What a Save sends, and how its answer is read.
//
// Owner, 5 Oct 2026: Save "updates EVERYTHING to latest instead of only the
// changed fields". The Settings form resends the whole map it loaded and the
// Website Editor ~105 keys; every one of them cost a D1 write on the Worker.
// The Worker now writes only keys whose stored text differs (routes/settings.ts
// POST /); this module is the client half: send only what differs from the
// snapshot the form started from, and read the answer without guessing.

type SettingsRecord = Record<string, unknown>

// The Worker stores a string as is and anything else as JSON text
// (routes/settings.ts). Comparing in that same form is what makes "unchanged"
// mean "the Worker would store exactly what it already holds".
export function serializeSettingValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? ''
}

export interface SettingsDiff<V = unknown> {
  changed: Record<string, V>
  unchanged: string[]
}

/**
 * Split `updates` into the keys that differ from `loaded` and those that do not.
 *
 * A key is only ever dropped when `loaded` holds it and holds the same text; a
 * key `loaded` has never seen is always sent, and so is any key named in
 * `keep` (a deliberate clear must reach the Worker whatever the snapshot says).
 * `undefined` values are never sent: JSON drops them anyway.
 */
export function diffSettings<V = unknown>(
  updates: Record<string, V>,
  loaded: SettingsRecord | null | undefined,
  keep: Iterable<string> = [],
): SettingsDiff<V> {
  const kept = new Set(keep)
  const snapshot = loaded && typeof loaded === 'object' ? loaded : {}
  const changed: Record<string, V> = {}
  const unchanged: string[] = []
  for (const [key, value] of Object.entries(updates || {})) {
    if (value === undefined) continue
    const known = Object.prototype.hasOwnProperty.call(snapshot, key) && snapshot[key] !== undefined
    if (known && !kept.has(key) && serializeSettingValue(snapshot[key]) === serializeSettingValue(value)) {
      unchanged.push(key)
    } else {
      changed[key] = value
    }
  }
  return { changed, unchanged }
}

export interface SendChangedSettingsInput {
  /** What the caller wants stored (server keys only). */
  requested: SettingsRecord
  /** The settings this tab holds right now. */
  snapshot: SettingsRecord
  /** Keys with a save already in flight (counts); updated while this one runs. */
  inFlight: Map<string, number>
  /** Keys that must be sent even when equal (a deliberate clear). */
  clearKeys?: readonly string[]
  /** The real request. Called at most once, with only the changed keys. */
  send: (changed: SettingsRecord) => Promise<unknown>
}

export interface SendChangedSettingsResult {
  /** The keys that were sent (empty: nothing differed, no request was made). */
  sent: SettingsRecord
  /** A write conflict answer, returned as is for the caller to surface. */
  conflict: unknown
  /** Values the Worker stored differently from what was sent. */
  normalised: SettingsRecord
}

/**
 * The single save pipeline behind AppContext.saveSettings: send only what
 * differs from the held settings, make no request at all when nothing does, and
 * track keys in flight so a second save of the same key is never judged
 * "unchanged" against a snapshot that has not caught up. A failed request
 * rejects (the caller turns that into its own { success: false }).
 */
export async function sendChangedSettings(input: SendChangedSettingsInput): Promise<SendChangedSettingsResult> {
  const { changed } = diffSettings(input.requested, input.snapshot, [...(input.clearKeys || []), ...input.inFlight.keys()])
  const keys = Object.keys(changed)
  if (!keys.length) return { sent: {}, conflict: null, normalised: {} }
  for (const key of keys) input.inFlight.set(key, (input.inFlight.get(key) || 0) + 1)
  try {
    const answer = await input.send(changed)
    if (answer && typeof answer === 'object' && (answer as { conflict?: unknown }).conflict) {
      return { sent: changed, conflict: answer, normalised: {} }
    }
    const saved = (answer as { saved?: unknown } | null | undefined)?.saved
    const normalised = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as SettingsRecord : {}
    return { sent: changed, conflict: null, normalised }
  } finally {
    for (const key of keys) {
      const remaining = (input.inFlight.get(key) || 1) - 1
      if (remaining > 0) input.inFlight.set(key, remaining)
      else input.inFlight.delete(key)
    }
  }
}

export type SettingsSaveOutcome = 'saved' | 'unchanged' | 'conflict' | 'failed'

/**
 * The one reading of what AppContext.saveSettings answers. It never throws for
 * a failed write -- it answers `{ success: false, error }` after showing its
 * own toast -- so a caller that only checks `conflict` or only catches carries
 * on as though the write landed (a false "saved" toast, a cleared dirty flag).
 */
export function settingsSaveOutcome(result: unknown): SettingsSaveOutcome {
  if (!result || typeof result !== 'object') return 'failed'
  const answer = result as { conflict?: unknown; success?: unknown; unchanged?: unknown }
  if (answer.conflict) return 'conflict'
  if (answer.success === false) return 'failed'
  if (answer.unchanged === true) return 'unchanged'
  return 'saved'
}

// Keys the Worker stored differently from what was sent (a trimmed link, a
// defaulted language, ...). Empty when the save stored exactly what it sent.
export function settingsSaveNormalisedKeys(result: unknown): string[] {
  const keys = result && typeof result === 'object' ? (result as { normalized?: unknown }).normalized : null
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []
}

export function settingsSaveSucceeded(result: unknown): boolean {
  const outcome = settingsSaveOutcome(result)
  return outcome === 'saved' || outcome === 'unchanged'
}

// ---------------------------------------------------------------------------
// Own-write echo. The Worker broadcasts every settings write to every open
// socket, the saver's included. The saver already holds the saved values (it
// merged them when the answer arrived), so reloading the whole settings table
// on its own echo is a pure waste. The answer and the broadcast carry the same
// `writeId`; remembering the ids this tab wrote lets it recognise the echo.
const OWN_WRITE_TTL_MS = 2 * 60 * 1000
const ownWrites = new Map<string, number>()

function pruneOwnWrites(now: number): void {
  for (const [id, at] of ownWrites) if (now - at > OWN_WRITE_TTL_MS) ownWrites.delete(id)
}

export function rememberOwnSettingsWrite(writeId: unknown, now: number = Date.now()): void {
  if (typeof writeId !== 'string' || !writeId) return
  pruneOwnWrites(now)
  ownWrites.set(writeId, now)
}

export function isOwnSettingsWrite(payload: unknown, now: number = Date.now()): boolean {
  if (!payload || typeof payload !== 'object') return false
  const writeId = (payload as { writeId?: unknown }).writeId
  if (typeof writeId !== 'string' || !writeId) return false
  pruneOwnWrites(now)
  return ownWrites.has(writeId)
}

export function resetOwnSettingsWritesForTests(): void {
  ownWrites.clear()
}
