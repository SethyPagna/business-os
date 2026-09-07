// WCAG 2.1 AA contrast maths for the PUBLIC STOREFRONT palette.
//
// Two jobs, both of which the storefront got wrong before this module existed:
//
//  1. The fixed theme tokens. Several of the muted/accent tokens the portal
//     paints on its own flat background do not reach AA: `text-slate-400` on
//     the light ground (#ffffff) is 2.56:1 and was carrying REAL copy (the
//     list-drawer hint, empty states, price lines, the product sheet's
//     "Shop's Product Name" eyebrow, the account form's hints); the account
//     form's `bg-emerald-500` submit button with white text is 2.54:1;
//     `text-sky-600` on white is 4.10:1; `text-rose-600` on `bg-rose-50` is
//     4.28:1; and dark mode's `text-neutral-500` on #0b0b0c is 4.15:1.
//     PORTAL_CONTRAST_PAIRS enumerates every text/background pair the
//     storefront theme produces and tests/portalContrast.test.ts asserts each
//     one clears its AA threshold, so a token cannot regress unnoticed.
//
//  2. The MERCHANT-CHOSEN colours. Promotion badge colours and promo-rule chip
//     colours are arbitrary hex values typed into the portal editor, and the
//     components hardcoded `text-white` / `color: '#fff'` on top of them --
//     white on the shipped default #dc2626 is 4.83:1, but a merchant who picks
//     a pale yellow gets ~1.1:1 and the badge text vanishes. readableTextOn()
//     picks the better of the two storefront inks for any background, and
//     ensureAccessibleSurface() additionally walks the background toward the
//     ink's opposite until the pair actually clears the threshold, because for
//     mid-greys NEITHER ink reaches 4.5:1 on the unmodified colour (#808080
//     tops out at 4.52:1 with dark ink and 3.95:1 with white -- and the dark
//     ink only just clears, so a shade either side of it fails both ways).
//
// Pure data + maths: no React, no DOM. Imported by the storefront components
// and by the pure test.

/** AA thresholds. Large text is >=18.66px bold or >=24px. */
export const PORTAL_CONTRAST_AA_TEXT = 4.5
export const PORTAL_CONTRAST_AA_LARGE = 3
/** Non-text UI components and graphical objects (WCAG 1.4.11). */
export const PORTAL_CONTRAST_AA_UI = 3

export type PortalContrastKind = 'text' | 'large' | 'ui'

/** Ink used on light surfaces -- the storefront's charcoal, not pure black. */
export const PORTAL_INK_ON_LIGHT = '#0f172a'
/** Ink used on dark surfaces. */
export const PORTAL_INK_ON_DARK = '#ffffff'

/** The two page grounds the storefront paints (buildPortalBackground). */
export const PORTAL_LIGHT_SURFACE = '#ffffff'
export const PORTAL_DARK_SURFACE = '#0b0b0c'

export function normalizePortalHex(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const s = raw.slice(1).toLowerCase()
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
  }
  return fallback
}

function channels(hex: string): [number, number, number] {
  const s = normalizePortalHex(hex, '#000000').slice(1)
  return [
    Number.parseInt(s.slice(0, 2), 16),
    Number.parseInt(s.slice(2, 4), 16),
    Number.parseInt(s.slice(4, 6), 16),
  ]
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

export function requiredRatio(kind: PortalContrastKind): number {
  if (kind === 'large') return PORTAL_CONTRAST_AA_LARGE
  if (kind === 'ui') return PORTAL_CONTRAST_AA_UI
  return PORTAL_CONTRAST_AA_TEXT
}

export function meetsContrast(foreground: string, background: string, kind: PortalContrastKind = 'text'): boolean {
  // Round to 2dp first: the published ratios for the shipped tokens are quoted
  // at 2dp, and 4.4999 vs 4.5 is not a difference any eye or checker resolves.
  return Number(contrastRatio(foreground, background).toFixed(2)) >= requiredRatio(kind)
}

/**
 * The better of the two storefront inks for an arbitrary merchant-chosen
 * background. Never throws and never returns a third colour, so a caller can
 * put the result straight into a `color:` style.
 */
export function readableTextOn(background: unknown): string {
  const bg = normalizePortalHex(background, PORTAL_DARK_SURFACE)
  const onDark = contrastRatio(PORTAL_INK_ON_DARK, bg)
  const onLight = contrastRatio(PORTAL_INK_ON_LIGHT, bg)
  return onDark >= onLight ? PORTAL_INK_ON_DARK : PORTAL_INK_ON_LIGHT
}

/** Blend `hex` toward `target` by `amount` (0..1). */
function mix(hex: string, target: string, amount: number): string {
  const [r1, g1, b1] = channels(hex)
  const [r2, g2, b2] = channels(target)
  const t = Math.max(0, Math.min(1, amount))
  return toHex(r1 + ((r2 - r1) * t), g1 + ((g2 - g1) * t), b1 + ((b2 - b1) * t))
}

export type PortalAccessibleSurface = {
  /** The background to actually paint -- the merchant's colour, darkened or
   *  lightened only as far as the threshold requires. */
  background: string
  /** The ink to paint on it. */
  color: string
  ratio: number
  /** True when the merchant's colour was usable unchanged. */
  exact: boolean
}

/**
 * Make any merchant-chosen colour safe to put text on. Picks the better ink,
 * then -- only if the pair still misses the threshold -- steps the background
 * toward the ink's opposite in 4% increments until it clears. Deterministic:
 * the same input always yields the same output, which is what lets the pure
 * test assert the whole merchant-colour space rather than a few samples.
 */
export function ensureAccessibleSurface(
  background: unknown,
  kind: PortalContrastKind = 'text',
  fallback = '#e11d48',
): PortalAccessibleSurface {
  const target = requiredRatio(kind)
  const base = normalizePortalHex(background, fallback)
  const color = readableTextOn(base)
  const away = color === PORTAL_INK_ON_DARK ? '#000000' : '#ffffff'
  const baseRatio = contrastRatio(color, base)
  if (Number(baseRatio.toFixed(2)) >= target) {
    return { background: base, color, ratio: baseRatio, exact: true }
  }
  for (let step = 1; step <= 25; step++) {
    const candidate = mix(base, away, step * 0.04)
    const ratio = contrastRatio(color, candidate)
    if (Number(ratio.toFixed(2)) >= target) {
      return { background: candidate, color, ratio, exact: false }
    }
  }
  // Fully mixed = pure black or pure white, which always clears 4.5:1 against
  // the opposite ink; this branch is unreachable but keeps the function total.
  const last = mix(base, away, 1)
  return { background: last, color, ratio: contrastRatio(color, last), exact: false }
}

/**
 * A merchant colour used as INK on one of the two flat page grounds (the promo
 * strip prints a promoted product's price in the campaign's own colour on the
 * white / near-black card). Darkens or lightens the colour toward the ground's
 * opposite until it is legible on that ground.
 */
export function readableInkOn(color: unknown, surface: string, kind: PortalContrastKind = 'text'): string {
  const target = requiredRatio(kind)
  const base = normalizePortalHex(color, PORTAL_INK_ON_LIGHT)
  const ground = normalizePortalHex(surface, PORTAL_LIGHT_SURFACE)
  if (Number(contrastRatio(base, ground).toFixed(2)) >= target) return base
  // Move the ink AWAY from the surface: toward black on a light ground,
  // toward white on a dark one.
  const away = relativeLuminance(ground) > 0.5 ? '#000000' : '#ffffff'
  for (let step = 1; step <= 25; step++) {
    const candidate = mix(base, away, step * 0.04)
    if (Number(contrastRatio(candidate, ground).toFixed(2)) >= target) return candidate
  }
  return away
}

export type PortalContrastPair = {
  /** Human name, used as the test's assertion label. */
  name: string
  foreground: string
  background: string
  kind: PortalContrastKind
  /** Where in the storefront this pair is painted. */
  where: string
}

/**
 * Every text / background pair the storefront theme produces, in both themes.
 * Hex values are the resolved Tailwind tokens the components carry; when a
 * token here changes, the class in the component changes with it (the test
 * also greps the components for the specific tokens that used to fail).
 */
export const PORTAL_CONTRAST_PAIRS: PortalContrastPair[] = [
  // --- light theme, on the flat #ffffff ground -------------------------------
  { name: 'heading text (slate-900)', foreground: '#0f172a', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'catalogUi SectionShell title, product name' },
  { name: 'body text (slate-600)', foreground: '#475569', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'product detail body copy' },
  { name: 'muted text (slate-500)', foreground: '#64748b', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'hints, empty states, list-drawer prices' },
  { name: 'promotions card link (sky-700)', foreground: '#0369a1', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'PortalPromotionsBanner view-product line' },
  { name: 'account submit button label', foreground: '#ffffff', background: '#047857', kind: 'text', where: 'CatalogAccountSection sign in / create account' },
  { name: 'primary button label (slate-900 ground)', foreground: '#ffffff', background: '#0f172a', kind: 'text', where: 'add to list, copy list, bucket FAB' },
  { name: 'stock badge: in stock (emerald-700 on the white pill)', foreground: '#047857', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'catalogUi StatusPill' },
  { name: 'stock badge: low stock (amber-700 on the white pill)', foreground: '#b45309', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'catalogUi StatusPill' },
  { name: 'stock badge: out of stock (rose-700 on the white pill)', foreground: '#be123c', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'catalogUi StatusPill' },
  { name: 'discount chip (rose-700 on rose-50)', foreground: '#be123c', background: '#fff1f2', kind: 'text', where: 'product card + detail sheet discount chip' },
  { name: 'form error text (rose-700 on rose-50)', foreground: '#be123c', background: '#fff1f2', kind: 'text', where: 'CatalogAccountSection error alert' },
  { name: 'copy-failed notice (rose-700)', foreground: '#be123c', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'PublicCatalogPage list drawer' },
  { name: 'selected filter option (blue-700 on blue-50)', foreground: '#1d4ed8', background: '#eff6ff', kind: 'text', where: 'PortalFilterCombobox option row' },
  { name: 'promotions hero card body (rose-50 on rose-700)', foreground: '#fff1f2', background: '#be123c', kind: 'text', where: 'CatalogProductsSection promotion article' },
  { name: 'promotions hero card CTA (rose-700 on white)', foreground: '#be123c', background: PORTAL_LIGHT_SURFACE, kind: 'text', where: 'CatalogProductsSection promotion CTA' },
  { name: 'no-payment notice (emerald-800 on emerald-50)', foreground: '#065f46', background: '#ecfdf5', kind: 'text', where: 'PortalNoPaymentNotice' },
  { name: 'signup reminder (amber-800 on amber-50)', foreground: '#92400e', background: '#fffbeb', kind: 'text', where: 'CatalogAccountSection membership reminder' },
  { name: 'destructive icon button (rose-600)', foreground: '#e11d48', background: PORTAL_LIGHT_SURFACE, kind: 'ui', where: 'remove-from-list / remove-from-wishlist' },
  { name: 'inactive promo dot (slate-500)', foreground: '#64748b', background: PORTAL_LIGHT_SURFACE, kind: 'ui', where: 'PortalPromoStrip dot row' },
  { name: 'focus ring against the light ground', foreground: '#0369a1', background: PORTAL_LIGHT_SURFACE, kind: 'ui', where: 'public-portal.css :focus-visible outline + the focus-visible:outline-[] classes on the createPortal()ed popups and the account form' },

  // --- dark theme, on the flat #0b0b0c ground --------------------------------
  { name: 'dark heading text (neutral-100)', foreground: '#f5f5f5', background: PORTAL_DARK_SURFACE, kind: 'text', where: 'catalogUi SectionShell title, product name' },
  { name: 'dark body text (neutral-300)', foreground: '#d4d4d4', background: PORTAL_DARK_SURFACE, kind: 'text', where: 'product detail body copy' },
  { name: 'dark muted text (neutral-400)', foreground: '#a3a3a3', background: PORTAL_DARK_SURFACE, kind: 'text', where: 'hints, empty states, list-drawer prices' },
  { name: 'dark promotions card link (amber-400)', foreground: '#fbbf24', background: PORTAL_DARK_SURFACE, kind: 'text', where: 'PortalPromotionsBanner view-product line' },
  { name: 'dark primary button label (neutral-950 on white)', foreground: '#0a0a0a', background: '#ffffff', kind: 'text', where: 'add to list, copy list, bucket FAB' },
  { name: 'dark selected filter option (amber-300 on neutral-900)', foreground: '#fcd34d', background: '#171717', kind: 'text', where: 'PortalFilterCombobox option row' },
  { name: 'dark stock badge: in stock (emerald-300 on the neutral-900 pill)', foreground: '#6ee7b7', background: '#171717', kind: 'text', where: 'catalogUi StatusPill' },
  { name: 'dark stock badge: low stock (amber-300 on the neutral-900 pill)', foreground: '#fcd34d', background: '#171717', kind: 'text', where: 'catalogUi StatusPill' },
  { name: 'dark stock badge: out of stock (rose-300 on the neutral-900 pill)', foreground: '#fda4af', background: '#171717', kind: 'text', where: 'catalogUi StatusPill' },
  { name: 'dark destructive icon button (rose-400)', foreground: '#fb7185', background: PORTAL_DARK_SURFACE, kind: 'ui', where: 'remove-from-list / remove-from-wishlist' },
  { name: 'dark inactive promo dot (neutral-400)', foreground: '#a3a3a3', background: PORTAL_DARK_SURFACE, kind: 'ui', where: 'PortalPromoStrip dot row' },
  { name: 'dark focus ring against the dark ground', foreground: '#fcd34d', background: PORTAL_DARK_SURFACE, kind: 'ui', where: 'public-portal.css :focus-visible outline + the focus-visible:outline-[] classes on the createPortal()ed popups and the account form' },
]

/**
 * The hero-gradient defaults served by cloudflare/src/routes/portal.ts as
 * customer_portal_hero_gradient_start / _mid / _end. White on the end stop
 * (#ea580c) is only 3.56:1, which is why the About banner that paints this
 * gradient carries NO text of its own (CatalogSecondaryTabs renders it as an
 * empty h-20/h-28 band, with the name and story on the plain card below). The
 * test pins that: any storefront text painted over a merchant-chosen colour
 * has to take its ink from readableTextOn() / ensureAccessibleSurface(),
 * never a hardcoded text-white.
 */
export const PORTAL_HERO_GRADIENT_DEFAULTS = {
  start: '#0f172a',
  mid: '#14532d',
  end: '#ea580c',
} as const

/** Merchant-colour defaults the storefront ships (promotion badge / promo rule chip). */
export const PORTAL_MERCHANT_COLOR_DEFAULTS = {
  promotionBadge: '#dc2626',
  promoRuleChip: '#e11d48',
} as const
