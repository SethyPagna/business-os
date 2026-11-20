// A product's category and brand are stored as text in three shapes: `||`-joined ("Skincare||Gift Set", what
// cloudflare/src/lib/productWrites.ts normalizeMultiValue writes), JSON array text ('["Skincare"]'), or one plain
// name. Every storefront surface that prints or groups a category or brand reads it through here, so none of them
// shows brackets or quotes.

function collect(raw: unknown, out: string[], depth: number): void {
  if (raw === null || raw === undefined) return
  if (Array.isArray(raw)) {
    raw.forEach((entry) => collect(entry, out, depth))
    return
  }
  const text = String(raw).trim()
  if (!text) return
  if (depth < 2 && ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('"') && text.endsWith('"')))) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed) || typeof parsed === 'string') {
        collect(parsed, out, depth + 1)
        return
      }
    } catch {
      // Not JSON after all: a name that happens to start with a bracket stays as written.
    }
  }
  text.split('||').forEach((part) => {
    const name = part.trim()
    if (name) out.push(name)
  })
}

/** Every clean name in a stored category or brand cell, in order, without case-insensitive duplicates. */
export function splitPortalValues(raw: unknown): string[] {
  const all: string[] = []
  collect(raw, all, 0)
  const seen = new Set<string>()
  return all.filter((name) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The multi-value column when it carries names, else the single column. */
export function portalValues(multi: unknown, single: unknown): string[] {
  const fromMulti = splitPortalValues(multi)
  return fromMulti.length ? fromMulti : splitPortalValues(single)
}

/** The one name a card or group heading shows: the single (primary) column first, then the multi-value column. */
export function portalPrimaryValue(single: unknown, multi?: unknown): string {
  return splitPortalValues(single)[0] || splitPortalValues(multi)[0] || ''
}
