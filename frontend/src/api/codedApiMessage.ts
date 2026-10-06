// A refusal the Worker marks with a stable `code` can be shown in the
// operator's language without every caller translating it: http.ts runs the
// thrown error's message through here once, so each surface that already shows
// `error.message` (batch edit, stock receipts, stock sessions, Expenses,
// products, promotions) gets the translated sentence.
//
// DATE-W: an unreadable typed date is refused with 400 `invalid_date` by every
// route that stores one. The sentence is the same one the date field itself
// shows (`date_entry_invalid`), so the field and the server's refusal agree.
//
// Only the codes listed here are touched; any other refusal keeps the server's
// own sentence. The packs are read the way api/fileTransport.ts reads them:
// from the language AppContext applies to <html lang>, loaded on demand, and
// the server's sentence is kept if a pack cannot be loaded.

export const CODED_API_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  invalid_date: 'date_entry_invalid',
}

/** The pack sentence for a refusal code, or null when the code has none (or the pack lacks the key). */
export function codedApiMessageFromPack(code: unknown, pack: Record<string, unknown> | null | undefined): string | null {
  const key = typeof code === 'string' && Object.prototype.hasOwnProperty.call(CODED_API_MESSAGE_KEYS, code) ? CODED_API_MESSAGE_KEYS[code] : ''
  const value = key && pack ? pack[key] : null
  return typeof value === 'string' && value.trim() ? value : null
}

export function hasCodedApiMessage(code: unknown): boolean {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CODED_API_MESSAGE_KEYS, code)
}

type PackLoader = (language: string) => Promise<Record<string, unknown>>

// Vite turns these into the named lang-km / lang-en chunks, fetched only when a
// coded refusal actually happens.
const loadBundledPack: PackLoader = async (language) =>
  (language.startsWith('km') ? (await import('../lang/km.json')).default : (await import('../lang/en.json')).default) as Record<string, unknown>

let packLoader: PackLoader = loadBundledPack

/** Test seam (node cannot import a .json module without Vite): swap the pack source. null restores it. */
export function __setCodedApiPackLoaderForTests(loader: PackLoader | null): void {
  packLoader = loader || loadBundledPack
}

/** Replace the message of a coded refusal with the one in the UI language. Never throws. */
export async function localizeCodedApiError<T extends { code?: unknown; message?: string }>(error: T): Promise<T> {
  if (!hasCodedApiMessage(error?.code)) return error
  try {
    const language = typeof document !== 'undefined' ? String(document.documentElement?.getAttribute('lang') || '').trim().toLowerCase() : ''
    const message = codedApiMessageFromPack(error.code, await packLoader(language))
    if (message) error.message = message
  } catch {
    // Keep the server's sentence.
  }
  return error
}
