import { tokenizeSearchWords } from '../utils/searchMatch.ts'

type SalesCustomerPickerCandidate = {
  name?: unknown
  phone?: unknown
  membership_number?: unknown
}

function canonicalizePickerPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (/^855\d{8,9}$/.test(digits)) return `0${digits.slice(3)}`
  return digits
}

function pickerPhoneAlternatives(rawSearch: string): string[] {
  if (!/^[+\d\s().-]+$/.test(rawSearch)) return []
  const digits = rawSearch.replace(/\D/g, '')
  if (digits.length < 3 || digits.length > 15) return []
  const canonical = canonicalizePickerPhone(rawSearch) || digits
  const alternatives = new Set([digits, canonical])
  if (/^0\d{8,9}$/.test(canonical)) alternatives.add(`855${canonical.slice(1)}`)
  return [...alternatives]
}

/**
 * In-memory counterpart of the Sales/POS customer picker's authoritative
 * search. This is used only after the existing transport has already decided
 * a local fallback is allowed; it does not enable offline reads or widen the
 * server's permission-scoped response.
 */
export function salesCustomerPickerFallbackMatches(row: SalesCustomerPickerCandidate, rawSearch: unknown): boolean {
  const search = String(rawSearch ?? '').trim()
  if (!search) return true

  // The server's unicode FTS query ANDs normalized word prefixes, so token
  // order is irrelevant ("Dara Sok" finds "Sok Dara") and partial final
  // words still work. Keep membership in the same text pool as the previous
  // fallback and the server index; do not inspect any private finance fields.
  const queryWords = tokenizeSearchWords(search)
  const candidateWords = tokenizeSearchWords(`${String(row.name ?? '')} ${String(row.membership_number ?? '')}`, 64)
  const textMatches = queryWords.length > 0
    && queryWords.every((queryWord) => candidateWords.some((candidateWord) => candidateWord.startsWith(queryWord)))

  // Match the Worker's salesCustomerSearch compatibility path exactly for
  // phone-shaped input: formatting is ignored, Cambodian +855 and local 0
  // forms are equivalent, and 3+ digit fragments remain searchable.
  const displayDigits = String(row.phone ?? '').replace(/\D/g, '')
  const canonicalPhone = canonicalizePickerPhone(row.phone)
  const phoneMatches = pickerPhoneAlternatives(search).some((candidate) => (
    candidate === canonicalPhone || displayDigits.includes(candidate)
  ))

  return textMatches || phoneMatches
}
