// Section 4 (2026-09-02 RC): receipt "Text contrast" setting.
//
// One value drives one root-level switch. `normal` changes nothing (today's
// receipt colours). `maximum` sets `data-receipt-contrast="maximum"` on the
// receipt's shell element(s) (Receipt.tsx), which a single stylesheet rule
// in styles/main.css turns into `color:#000 !important; opacity:1 !important;
// border-color:#000 !important` on every descendant -- header, meta rows,
// line items, totals, footer, QR captions, and every divider/border. Nothing
// here touches font-size or font-weight.
//
// Kept as its own tiny module (rather than inlined in receiptAppliedConfig.ts
// or constants.ts) so the enum and its default have exactly one definition
// that both the settings model and the frontend test can import, instead of
// three copies of the same two literal strings drifting apart.
export const RECEIPT_TEXT_CONTRAST_VALUES = ['normal', 'maximum'] as const

export type ReceiptTextContrast = typeof RECEIPT_TEXT_CONTRAST_VALUES[number]

// The default is MAXIMUM (user, Sep 3 2026: "the receipt contrast is not
// bold, not super contrast very dark... my printer is not printing with good
// ink"). A record that never stored the field -- which is every account that
// predates the setting -- prints pure black; 'normal' is the opt-out.
export const DEFAULT_RECEIPT_TEXT_CONTRAST: ReceiptTextContrast = 'maximum'

// The DOM attribute the receipt root(s) carry; styles/main.css's override
// selector must stay in sync with this name.
export const RECEIPT_CONTRAST_ATTR = 'data-receipt-contrast'

/**
 * Coerces any stored/user-supplied value to a known contrast mode. Only the
 * two literal enum strings pass through; anything else (typos, legacy junk,
 * a missing field) resolves to the default -- this is the single point both
 * the client (Receipt.tsx, ReceiptSettings.tsx) and the settings save path
 * lean on, so a corrupted or pre-feature record always renders the default
 * instead of guessing.
 */
export function normalizeReceiptTextContrast(value: unknown): ReceiptTextContrast {
  return (RECEIPT_TEXT_CONTRAST_VALUES as readonly unknown[]).includes(value) ? (value as ReceiptTextContrast) : DEFAULT_RECEIPT_TEXT_CONTRAST
}
