// How the About cover is laid out, decided by the picture's own shape so no frame colour
// is ever visible beside it. The page reads naturalWidth / naturalHeight on load.
export type CoverShape = 'wide' | 'tall'

/** A picture this much wider than tall runs as a full-width banner. */
export const COVER_WIDE_FROM = 1.6
/** A banner never grows taller than this, however wide the screen. */
export const COVER_BANNER_MAX_PX = 520

export function coverRatio(width: number, height: number): number | null {
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? width / height : null
}

export function coverShape(ratio: number | null): CoverShape | null {
  if (ratio === null) return null
  return ratio >= COVER_WIDE_FROM ? 'wide' : 'tall'
}

/** The same upload served twice (cover and logo): compared by path, never by cache-busting query. */
export function sameImageFile(a: string | undefined, b: string | undefined): boolean {
  const key = (value: string | undefined): string => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    try {
      const url = new URL(raw, 'https://relative.invalid')
      return `${url.hostname === 'relative.invalid' ? '' : url.host}${url.pathname}`
    } catch {
      return raw.split(/[?#]/)[0]
    }
  }
  const left = key(a)
  return left !== '' && left === key(b)
}
