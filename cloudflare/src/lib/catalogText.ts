// Ported from backend/src/catalogTextIntegrity.ts. Pure string logic (no
// Node dependencies in the original either) -- exact behavioral port. Only
// the subset actually used by routes/products.ts's lookups/usage endpoint
// is included here (normalizeCatalogText, hasSuspiciousCatalogText,
// normalizeOptionList); assertCatalogTextIntegrity/listSuspiciousCatalogFields
// (used on product create/update validation) are not needed for this
// read-only endpoint and can be added later if a future section ports
// product create/update validation.

const SUSPICIOUS_REPEATED_QUESTION_RE = /\?{2,}/
const SUSPICIOUS_MOJIBAKE_RE = /(?:Ã¯Â¿|Ã¢â‚¬|Ã¢â€š|Ãƒ[\x80-\xBF]|Ã‚[\x80-\xBF])/i
const SUSPICIOUS_SINGLE_QUESTION_RE = /(?:[A-Za-z\u00C0-\u024F]\?[A-Za-z\u00C0-\u024F])|(?:[A-Za-z\u00C0-\u024F]'\?[A-Za-z\u00C0-\u024F])|(?:^\?+$)/u

export function normalizeCatalogText(value: unknown, options: { defaultValue?: string; preserveNull?: boolean } = {}): string | null {
  const { defaultValue = '', preserveNull = false } = options
  if (value === undefined || value === null) return preserveNull ? null : defaultValue
  const normalized = String(value)
    .normalize('NFC')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  return normalized || (preserveNull ? null : defaultValue)
}

export function hasSuspiciousCatalogText(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = normalizeCatalogText(value) || ''
  if (!normalized) return false
  if (normalized.includes('\ufffd')) return true
  if (SUSPICIOUS_REPEATED_QUESTION_RE.test(normalized)) return true
  if (SUSPICIOUS_SINGLE_QUESTION_RE.test(normalized)) return true
  return SUSPICIOUS_MOJIBAKE_RE.test(normalized)
}

export function listSuspiciousCatalogFields(record: Record<string, unknown> = {}, fields: unknown[] = []): string[] {
  const suspiciousFields: string[] = []
  for (const value of Array.isArray(fields) ? fields : []) {
    const field = String(value || '').trim()
    if (field && hasSuspiciousCatalogText(record?.[field])) suspiciousFields.push(field)
  }
  return suspiciousFields
}

// Ported from backend/src/catalogTextIntegrity.ts's assertCatalogTextIntegrity.
// Used by units/categories create+rename so a mojibake/garbled name (e.g.
// pasted from a broken CSV) is rejected with a clear error instead of being
// saved and then silently mangling every product that references it.
export function assertCatalogTextIntegrity(record: Record<string, unknown> = {}, fields: unknown[] = [], label = 'catalog text'): void {
  const suspiciousFields = listSuspiciousCatalogFields(record, fields)
  if (suspiciousFields.length) throw new Error(`${label} looks corrupted in: ${suspiciousFields.join(', ')}`)
}

export function normalizeOptionList(values: unknown[] = []): string[] {
  const canonical = new Map<string, string>()
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = normalizeCatalogText(rawValue)
    if (!value) continue
    const key = value.toLocaleLowerCase()
    if (!canonical.has(key)) canonical.set(key, value)
  }
  return [...canonical.values()]
}
