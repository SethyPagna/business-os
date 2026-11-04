'use strict'
// P2.8 (6.0.1046): "no lost function" evidence. Compares what the accounts that HOLD contacts_full_phone read on the lane with
// what the same accounts read on the base commit, route by route (PHONE_DUMP written by test-phone-leak-crawl-native.cjs, run once
// on each commit against the same seeded world). A holder must read today's output.
//
// Four kinds of difference are explained, everything else fails the run:
//   - the new permission key itself: the catalog now knows contacts_full_phone, so role and profile JSON list it;
//   - values that change on every boot: content hashes (etag / version), epoch stamps, session ids;
//   - two routes whose records tie on the second and sort either way (the sale records timeline, the session list);
//   - an ADDED match: a holder's search by a whole number written +855, 00855 or in non-ASCII digits (Khmer, full-width, ...) now finds the
//     record whose phone IS that number, where the base's word match could not read that form (6.0.1046, review N7). Accepted only when
//     the search value is such a whole number and every record the base returned is still returned (the lane may add, never lose).
// Usage: node scripts/phone-holder-parity.cjs <base-dump.json> <lane-dump.json>
const fs = require('node:fs')
const [baseFile, laneFile] = process.argv.slice(2)
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'))
const lane = JSON.parse(fs.readFileSync(laneFile, 'utf8'))

// The decimal digits of any script as ASCII (NFKC first, then each Nd character by its place in its ten-digit run).
function foldDigits(text) {
  let out = ''
  for (const char of String(text).normalize('NFKC')) {
    if (char.codePointAt(0) > 0x7f && /^\p{Nd}$/u.test(char)) {
      let start = char.codePointAt(0)
      while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start -= 1
      out += String((char.codePointAt(0) - start) % 10)
    } else out += char
  }
  return out
}
// A search value that is a whole phone number (8-15 digits) in a form the base's word match cannot read: +855, 00855, or non-ASCII digits.
function isNonPlainWholeNumber(route) {
  const query = new URLSearchParams(route.split('?')[1] || '')
  for (const key of ['search', 'q']) {
    const raw = query.get(key)
    if (raw === null) continue
    const folded = foldDigits(raw.trim())
    if (!/^[+\d\s().-]+$/.test(folded)) continue
    const digits = folded.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) continue
    const canonical = /^(?:00)?855\d{8,9}$/.test(digits) ? `0${digits.replace(/^(?:00)?855/, '')}` : digits
    const plain = /^[0-9\s().-]+$/.test(raw.trim()) && canonical === digits
    if (!plain) return true
  }
  return false
}
// "kind:id" of every record in every array of a JSON reply (lists keep their rows under items / rows / sales / customers / data ...).
function recordKeys(body) {
  const keys = new Set()
  let parsed
  try { parsed = JSON.parse(body) } catch { return keys }
  const visit = (node, name, depth) => {
    if (Array.isArray(node)) {
      for (const item of node) if (item && typeof item === 'object' && item.id != null) keys.add(`${name}:${item.id}`)
      if (depth < 3) for (const item of node) if (item && typeof item === 'object') visit(item, name, depth + 1)
    } else if (node && typeof node === 'object' && depth < 3) {
      for (const [key, value] of Object.entries(node)) visit(value, key, depth + 1)
    }
  }
  visit(parsed, 'root', 0)
  return keys
}

const TIE_ORDER = [/^\/api\/sales\/\d+\/records$/, /^\/api\/auth\/devices\/sessions$/]
const normalize = (text) => String(text)
  .replace(/(\\*)"contacts_full_phone(\\*)":(true|false),?/g, '')
  .replace(/,(\s*)([}\]])/g, '$1$2')
  .replace(/[0-9a-f]{40,}/g, '<hash>')
  .replace(/\b1[0-9]{12}\b/g, '<epoch>')
const sortedRecords = (text) => normalize(text).replace(/"id":(\d+)/g, '"id":<n>').replace(/"user_id":(\d+)/g, '"user_id":<n>')

let compared = 0
let identical = 0
let explained = 0
let tieOrder = 0
let addedMatch = 0
const different = []
for (const account of Object.keys(lane)) {
  for (const [route, mine] of Object.entries(lane[account])) {
    const theirs = base[account] && base[account][route]
    if (!theirs) { different.push(`${account} ${route}: not on the base dump`); continue }
    compared += 1
    if (mine.status === theirs.status && mine.body === theirs.body) { identical += 1; continue }
    if (mine.status === theirs.status && normalize(mine.body) === normalize(theirs.body)) { explained += 1; continue }
    if (mine.status === theirs.status && TIE_ORDER.some((re) => re.test(route.split('?')[0]))
      && [...sortedRecords(mine.body)].sort().join('') === [...sortedRecords(theirs.body)].sort().join('')) { tieOrder += 1; continue }
    if (mine.status === theirs.status && isNonPlainWholeNumber(route)) {
      const before = recordKeys(theirs.body)
      const after = recordKeys(mine.body)
      if ([...before].every((key) => after.has(key)) && after.size > before.size) { addedMatch += 1; continue }
    }
    different.push(`${account} ${route}: base ${theirs.status} (${theirs.body.length} chars) vs lane ${mine.status} (${mine.body.length} chars)`)
  }
}
console.log(`compared ${compared} holder responses (${Object.keys(lane).join(', ')}): ${identical} byte-identical, ${explained} identical apart from the new permission key / hashes / epoch stamps, ${tieOrder} same records in a different tie order, ${addedMatch} whole-number searches (+855, 00855, non-ASCII digits) that now also find the record the base missed, ${different.length} UNEXPLAINED`)
for (const line of different.slice(0, 40)) console.log(`  DIFF ${line}`)
if (different.length) process.exitCode = 1
