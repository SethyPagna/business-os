'use strict'
// P2.8 (6.0.1046): "no lost function" evidence. Compares what the accounts that HOLD contacts_full_phone read on the lane with
// what the same accounts read on the base commit, route by route (PHONE_DUMP written by test-phone-leak-crawl-native.cjs, run once
// on each commit against the same seeded world). A holder must read today's output.
//
// Three kinds of difference are explained, everything else fails the run:
//   - the new permission key itself: the catalog now knows contacts_full_phone, so role and profile JSON list it;
//   - values that change on every boot: content hashes (etag / version), epoch stamps, session ids;
//   - two routes whose records tie on the second and sort either way (the sale records timeline, the session list).
// Usage: node scripts/phone-holder-parity.cjs <base-dump.json> <lane-dump.json>
const fs = require('node:fs')
const [baseFile, laneFile] = process.argv.slice(2)
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'))
const lane = JSON.parse(fs.readFileSync(laneFile, 'utf8'))

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
    different.push(`${account} ${route}: base ${theirs.status} (${theirs.body.length} chars) vs lane ${mine.status} (${mine.body.length} chars)`)
  }
}
console.log(`compared ${compared} holder responses (${Object.keys(lane).join(', ')}): ${identical} byte-identical, ${explained} identical apart from the new permission key / hashes / epoch stamps, ${tieOrder} same records in a different tie order, ${different.length} UNEXPLAINED`)
for (const line of different.slice(0, 40)) console.log(`  DIFF ${line}`)
if (different.length) process.exitCode = 1
