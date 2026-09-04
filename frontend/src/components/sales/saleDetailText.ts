const MOJIBAKE_MARKERS = /[\u00c2\u00c3\u00e2\u00f0\ufffd]/

/** Clean imported driver fields without damaging Khmer or ordinary Unicode. */
export function sanitizeSaleDetailText(value: unknown): string {
  let text = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text || /[\u1780-\u17ff]/.test(text) || !MOJIBAKE_MARKERS.test(text)) return text
  if (![...text].every((char) => char.codePointAt(0)! <= 0xff)) return text

  try {
    const bytes = Uint8Array.from([...text], (char) => char.charCodeAt(0))
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    if (repaired && !repaired.includes('\ufffd')) text = repaired
  } catch {
    // Keep the cleaned source when it was not actually UTF-8 decoded as Latin-1.
  }
  return text
}
