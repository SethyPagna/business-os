function normalizeHex(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.slice(1).split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return ''
}

function relativeLuminance(hex) {
  const normalized = normalizeHex(hex)
  if (!normalized) return 0
  const rgb = normalized
    .slice(1)
    .match(/.{2}/g)
    .map((part) => parseInt(part, 16) / 255)
    .map((value) => (
      value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4
    ))
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])
}

export function getContrastingTextColor(backgroundColor, dark = '#111827', light = '#ffffff') {
  const luminance = relativeLuminance(backgroundColor)
  return luminance > 0.45 ? dark : light
}

