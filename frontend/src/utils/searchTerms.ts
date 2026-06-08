export function buildProductSearchTerms(search: unknown): string[] {
  const raw = String(search || '').trim()
  if (!raw) return []
  return raw.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
}
