// Whether this shop charges tax, and at what rate -- ONE rule, read the same
// way by the till, the Settings screen and every sale surface.
//
// The owner ruled on 2026-09-04: "tax can turn on off in settings which will
// show based on that, if off, doesn't show." Before that the only signal was
// `settings.tax_rate`, and POS.tsx inferred "off" from a rate of zero. That
// inference is kept as the FALLBACK rather than replaced, which is what makes
// this change invisible to an install that has never touched the new switch:
// with `tax_enabled` absent, tax is on exactly when a positive rate is set --
// today's behaviour, to the cent.
//
// The Worker applies the identical rule in lib/saleAmendments.ts
// (resolveTaxSettings), so an amendment can never disagree with the till about
// whether tax applies. Changing one of the two without the other is the bug
// this pairing exists to prevent.

export const TAX_ENABLED_SETTING_KEY = 'tax_enabled'
export const TAX_RATE_SETTING_KEY = 'tax_rate'

/** The stored rate as a MULTIPLIER (settings hold a percent: "10" -> 0.1). */
export function resolveTaxRate(rawRate: unknown): number {
  const percent = Number(String(rawRate ?? '').trim())
  return Number.isFinite(percent) && percent > 0 ? percent / 100 : 0
}

/**
 * `rawEnabled` is the raw setting value; `rawRate` is only consulted when the
 * switch has never been set. Anything the shop would read as "no" counts as
 * off, because these values reach the database as free text from more than one
 * writer (the Settings form, an import, a direct edit).
 */
export function resolveTaxEnabled(rawEnabled: unknown, rawRate: unknown): boolean {
  const text = String(rawEnabled ?? '').trim().toLowerCase()
  if (text === '') return resolveTaxRate(rawRate) > 0
  return !(text === '0' || text === 'false' || text === 'off' || text === 'no')
}

/** The rate actually applied: zero whenever the switch is off. */
export function effectiveTaxRate(rawEnabled: unknown, rawRate: unknown): number {
  return resolveTaxEnabled(rawEnabled, rawRate) ? resolveTaxRate(rawRate) : 0
}
