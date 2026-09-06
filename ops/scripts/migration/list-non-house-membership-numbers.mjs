#!/usr/bin/env node
/*
 * PREPARED REPORT GENERATOR ONLY -- NEVER RUN AGAINST PRODUCTION BY AN AGENT.
 *
 * This module has no database, network, or Wrangler capability of its own. It
 * only classifies rows you already exported and formats a report from them.
 * Per AGENTS.md ("Treat deployments, remote migrations, secret sync, and
 * remote D1 commands as production actions requiring explicit user
 * authorization. Planning and review agents must not run them."), fetching
 * the input JSON below is a step for the OWNER or an explicitly authorized
 * session to run -- not something this script, or the agent that wrote it,
 * executes on its own.
 *
 * WHY THIS EXISTS (owner, 2026-09-06): a minting regression ("fix: scope
 * membership lookup and per-order defaults; mint secure IDs") briefly handed
 * out random eight-character membership numbers instead of the house
 * `LC-#####` sequence (see cloudflare/src/lib/membershipNumber.ts, fixed
 * alongside this script). Migration 0110 already backfilled the 4,966
 * customers that existed at that time to LC-00001..LC-04966, so this report
 * exists to answer one question: did anything besides that already-backfilled
 * set end up with a non-house number (from the regression window, from a
 * hand-typed vanity number, or from a still-open legacy `LCMN-XXXXXXXX` row)?
 *
 * DEFAULT RECOMMENDATION: leave legacy/non-house numbers alone. Renumbering
 * an existing customer or portal account changes an identifier that may
 * already be printed on physical receipts, quoted back to the customer, or
 * stored in the portal session/cookie -- the house format only needs to be
 * true for numbers minted from here on (which the code fix guarantees; see
 * mintMembershipNumber in cloudflare/src/lib/membershipNumber.ts). This
 * script's job is to give the owner the actual list so THEY can decide,
 * case by case, whether any particular row is worth renumbering -- not to
 * recommend or perform a bulk renumbering itself.
 *
 * HOW TO PRODUCE THE INPUT (run manually, by the owner or an authorized
 * session -- this repository's convention for a read from remote D1 is
 * `--command`, not `--file`; `--file` prints only a change summary, never
 * rows):
 *
 *   npx wrangler d1 execute business-os --remote --json --command \
 *     "SELECT id, membership_number, created_at FROM customers WHERE membership_number IS NOT NULL AND TRIM(membership_number) <> ''" \
 *     > customers-membership.json
 *
 *   npx wrangler d1 execute business-os --remote --json --command \
 *     "SELECT id, membership_id AS membership_number, created_at FROM portal_accounts" \
 *     > portal-accounts-membership.json
 *
 * THEN run this report locally (safe -- it only reads the two JSON files
 * above and writes text to stdout):
 *
 *   node ops/scripts/migration/list-non-house-membership-numbers.mjs \
 *     customers-membership.json portal-accounts-membership.json
 *
 * Each `wrangler d1 execute --json` file is an array whose first element has
 * a `.results` array of row objects -- this script accepts either that shape
 * or a bare row array, so a hand-trimmed JSON file also works.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Mirrors cloudflare/src/lib/membershipNumber.ts's isHouseMembershipNumber /
// parseMembershipSequence exactly (trim + uppercase, then `LC-` + digits
// only, sequence >= 1) -- kept in sync by hand since this report runs as a
// standalone .mjs with no build step pulling in the TypeScript source. If the
// house pattern in that file ever changes, update HOUSE_MEMBERSHIP_PATTERN
// here to match, or this report will misclassify.
const HOUSE_MEMBERSHIP_PATTERN = /^LC-(\d+)$/

export function isHouseMembershipNumber(value) {
  const raw = String(value ?? '').trim().toUpperCase()
  const match = HOUSE_MEMBERSHIP_PATTERN.exec(raw)
  if (!match) return false
  const sequence = Number(match[1])
  return Number.isSafeInteger(sequence) && sequence >= 1
}

/**
 * `rows` is an array of `{ id, membership_number, created_at }` (portal rows
 * are pre-mapped to the same shape by the caller -- see CLI section below).
 * Returns only the rows whose number is NOT the house `LC-#####` format,
 * blank/null numbers excluded (nothing to report on a row with no number at
 * all -- it isn't "non-house", it's unset).
 */
export function findNonHouseRows(rows) {
  return (rows ?? []).filter((row) => {
    const value = row?.membership_number
    if (value === null || value === undefined || String(value).trim() === '') return false
    return !isHouseMembershipNumber(value)
  })
}

/** Accepts either a bare row array or wrangler's `[{ results: [...] }]` shape. */
export function extractRows(parsed) {
  if (Array.isArray(parsed) && parsed.length && parsed[0] && Array.isArray(parsed[0].results)) {
    return parsed[0].results
  }
  if (Array.isArray(parsed)) return parsed
  return []
}

/**
 * Builds the printable report from already-classified non-house rows. Pure
 * (no I/O) so it can be tested directly -- see
 * test-list-non-house-membership-numbers-pure.cjs.
 */
export function buildReport(customerNonHouseRows, portalNonHouseRows) {
  const lines = []
  lines.push('Non-house membership numbers (not `LC-#####`)')
  lines.push('='.repeat(48))
  lines.push('')
  lines.push(`customers:       ${customerNonHouseRows.length}`)
  lines.push(`portal_accounts: ${portalNonHouseRows.length}`)
  lines.push(`total:           ${customerNonHouseRows.length + portalNonHouseRows.length}`)
  lines.push('')
  const section = (label, rows) => {
    lines.push(`-- ${label} (${rows.length}) ${'-'.repeat(Math.max(0, 40 - label.length))}`)
    if (!rows.length) {
      lines.push('  (none)')
    } else {
      for (const row of rows) {
        lines.push(`  id=${row.id}\tmembership_number=${JSON.stringify(row.membership_number)}\tcreated_at=${row.created_at ?? '(unknown)'}`)
      }
    }
    lines.push('')
  }
  section('customers', customerNonHouseRows)
  section('portal_accounts', portalNonHouseRows)
  lines.push('Recommendation: leave these as-is. Renumbering only matters for rows the')
  lines.push('owner specifically decides to change (e.g. a receipt has not yet been')
  lines.push('printed) -- every number minted going forward is already `LC-#####`.')
  return lines.join('\n')
}

// --- CLI (never invoked by an agent; see the header) -----------------------
async function main() {
  const [customersPath, portalPath] = process.argv.slice(2)
  if (!customersPath || !portalPath) {
    console.error('Usage: node list-non-house-membership-numbers.mjs <customers.json> <portal_accounts.json>')
    console.error('See the file header for the read-only wrangler commands that produce these two inputs.')
    process.exitCode = 1
    return
  }
  const customerRows = extractRows(JSON.parse(fs.readFileSync(customersPath, 'utf8')))
  const portalRowsRaw = extractRows(JSON.parse(fs.readFileSync(portalPath, 'utf8')))
  // portal_accounts rows are selected `AS membership_number` in the header's
  // sample query already, but tolerate a raw `membership_id` column too.
  const portalRows = portalRowsRaw.map((row) => ({
    id: row.id,
    membership_number: row.membership_number ?? row.membership_id,
    created_at: row.created_at,
  }))
  console.log(buildReport(findNonHouseRows(customerRows), findNonHouseRows(portalRows)))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
