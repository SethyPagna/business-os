const MOJIBAKE_MARKERS = /[\u00c2\u00c3\u00e1\u00e2\u00f0]/
// Windows-1252's 80–9F bytes can appear as punctuation outside Latin-1.
const WINDOWS_1252_BYTES = new Map(
  [...'\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178']
    .map((char, index) => [char.codePointAt(0)!, 0x80 + index]),
)
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const utf8Encoder = new TextEncoder()

function repairMojibake(text: string): string {
  if (!MOJIBAKE_MARKERS.test(text)) return text

  const chars = [...text]
  const result: string[] = []
  // One pass, at most four source characters per candidate. Never reinterpret
  // valid surrounding Unicode or recursively guess at multiple encoding layers.
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    if (MOJIBAKE_MARKERS.test(char)) {
      const lead = char.charCodeAt(0)
      const length = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
      const candidate = chars.slice(index, index + length)
      const bytes = candidate.map((part) => {
        const code = part.codePointAt(0)!
        return code <= 0xff ? code : WINDOWS_1252_BYTES.get(code) ?? -1
      })
      if (bytes.length === length && bytes.slice(1).every((byte) => byte >= 0x80 && byte <= 0xbf)) {
        try {
          const repaired = utf8Decoder.decode(Uint8Array.from(bytes))
          const encoded = utf8Encoder.encode(repaired)
          if (!/[\u0080-\u009f\ufffd]/.test(repaired)
            && encoded.length === bytes.length
            && encoded.every((byte, offset) => byte === bytes[offset])) {
            result.push(repaired)
            index += length - 1
            continue
          }
        } catch {
          // Invalid/overlong UTF-8 is not evidence of reversible mojibake.
        }
      }
    }
    result.push(char)
  }
  return result.join('')
}

/** Clean imported driver fields without damaging Khmer or ordinary Unicode. */
export function sanitizeSaleDetailText(value: unknown): string {
  // Repair first: a Latin-1 A0 byte can be part of Khmer UTF-8, not whitespace.
  return repairMojibake(String(value ?? ''))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
