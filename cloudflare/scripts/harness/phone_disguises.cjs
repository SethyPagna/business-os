'use strict'
// P2.8-F (3 Nov 2026): the spellings of a digit fragment the P2.8 security review (Opus, 6.0.1046) used to try to get a hidden
// phone number out of a search box without the grant, kept as a test table. disguises('654') is 42 spellings: 15 combining/format
// marks glued after the digits, 9 invisible characters inside, 7 other digit scripts, superscript, circled, URL-encoded and HTML
// entity digits, and look-alike letters for each digit. A digit fragment needs none of them to be found by the holder; an
// account WITHOUT the grant must find nothing through any of them, on every search surface. The fragment itself is a made-up
// number part (the repo is public).
const U = (cp) => String.fromCodePoint(cp)
const MARKS = [0x301, 0x34f, 0xfe0f, 0xfe00, 0x1dc0, 0x20d0, 0xfe20, 0xe31, 0x17c9, 0x20e3, 0x483, 0x5b0, 0x610, 0x93c, 0x1ab0]
const INVISIBLE = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xad, 0x180e, 0x2061, 0x34f]
const SCRIPT_ZERO = { fullwidth: 0xff10, 'arabic-indic': 0x660, thai: 0xe50, devanagari: 0x966, myanmar: 0x1040, khmer: 0x17e0, 'math-bold': 0x1d7ce }
const SUPERSCRIPT = [0x2070, 0xb9, 0xb2, 0xb3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079]
const LOOK_ALIKE = {
  0: ['o', 'O', U(0x43e), U(0x3bf), U(0xff2f), 'D', 'Q'], 1: ['l', 'I', 'i', U(0x7c), U(0x406)], 2: ['Z', 'z'], 3: ['E', U(0x417)], 4: ['A', 'h'],
  5: ['S', 's'], 6: ['b', 'G'], 7: ['T'], 8: ['B', U(0x222)], 9: ['g', 'q'],
}
const inScript = (text, zero) => [...text].map((ch) => (/\d/.test(ch) ? U(zero + Number(ch)) : ch)).join('')

/** [label, spelling] for every disguise of the ASCII digit fragment `frag`. */
function disguises(frag) {
  const out = []
  for (const mark of MARKS) out.push([`mark U+${mark.toString(16)}`, frag + U(mark)])
  for (const invisible of INVISIBLE) out.push([`invisible U+${invisible.toString(16)} inside`, frag.slice(0, 1) + U(invisible) + frag.slice(1)])
  for (const [name, zero] of Object.entries(SCRIPT_ZERO)) out.push([`digits ${name}`, inScript(frag, zero)])
  out.push(['superscript', [...frag].map((ch) => U(SUPERSCRIPT[Number(ch)])).join('')])
  out.push(['circled', [...frag].map((ch) => (ch === '0' ? U(0x24ea) : U(0x245f + Number(ch)))).join('')])
  out.push(['url-encoded literal', [...frag].map((ch) => `%3${ch}`).join('')])
  out.push(['html decimal', [...frag].map((ch) => `&#${ch.charCodeAt(0)};`).join('')])
  out.push(['html hex', [...frag].map((ch) => `&#x${ch.charCodeAt(0).toString(16)};`).join('')])
  for (let index = 0; index < frag.length; index += 1) {
    for (const letter of LOOK_ALIKE[frag[index]] || []) out.push([`look-alike ${JSON.stringify(letter)} for ${frag[index]} at ${index}`, frag.slice(0, index) + letter + frag.slice(index + 1)])
  }
  return out
}

module.exports = { disguises }
