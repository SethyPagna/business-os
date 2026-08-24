// Moved to utils/useDebouncedValue.ts (canonical shared location -- was
// duplicated here and in POS.tsx, and missing entirely from Inventory.tsx;
// see that file's comment for the full history). Re-exported so existing
// `from '../helpers/productPageHelpers'` imports keep working unchanged.
export { useDebouncedValue } from '../../../utils/useDebouncedValue.ts'

export function parseBrandColorMap(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch (_) {
    return {}
  }
}

export function normalizeBrandLookup(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}
