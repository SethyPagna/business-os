// Canonical phone key for the storefront account system.
//
// The repo already has several phone helpers, none of which produce a stable
// equality key across the shapes a human actually types:
//   - lib/contactDuplicates.ts::normalizePhone keeps a leading '+' and does
//     NOT fold the 855 country code, so "+855 12 345 678" and "012 345 678"
//     hash differently.
//   - routes/portal.ts's local normalizePhone strips '+' but also doesn't fold
//     855.
//   - lib/contactDuplicates.ts::formatPhoneP8 DOES fold 855 -> 0, but only for
//     display, and only for numbers it recognizes as Cambodian.
//
// A customer account is keyed on phone (one account per number), so the same
// person MUST hash to one key whether they enter local, +855, or 855 form, or
// two accounts get created for one human. This is the single canonical
// function every account store / lookup / existing-customer probe uses. It
// intentionally reuses formatPhoneP8's conservative 855->0 rule so the key
// agrees with how customers.phone was already migrated (0087 backfills
// customers.phone_normalized with the SQL equivalent of this).

export function canonicalizePhone(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  // Digits only — drops spaces, dashes, parens, dots, and any leading '+'.
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  // Fold the Cambodian country code to its 0-leading national form. A local
  // Cambodian number is 9-10 digits (0 + 8/9), so with the 855 code it is
  // 11-12 digits. Anything else (foreign / dual / partial) keeps its digit
  // string as-is — still a stable, self-consistent key, just not folded.
  if (/^855\d{8,9}$/.test(digits)) return `0${digits.slice(3)}`
  return digits
}

// True when two raw phone inputs denote the same number under the canonical
// key. Both blank is NOT a match (a blank phone can't identify anyone).
export function samePhone(a: unknown, b: unknown): boolean {
  const ca = canonicalizePhone(a)
  const cb = canonicalizePhone(b)
  return !!ca && !!cb && ca === cb
}
