#!/usr/bin/env node
/*
 * PREPARED REPORT GENERATOR ONLY -- NEVER RUN AGAINST PRODUCTION BY AN AGENT.
 *
 * This module has no database, network, R2 or Wrangler capability of its own,
 * and it has NO --apply mode at all. It reads a JSON export you already made
 * and prints a plan: what exists, and the exact commands an authorized human
 * would run. Nothing here writes to anything. Per AGENTS.md, remote D1 and
 * production object storage are the owner's to touch, not an agent's.
 *
 * WHY THIS EXISTS (N45, storefront legal/compliance pass, 2026-09-07)
 *
 * Until this pass, POST /api/portal/submissions wrote customer-uploaded
 * screenshots to `uploads/` in the ASSETS bucket. cloudflare/src/index.ts
 * serves GET /uploads/* to anyone, unauthenticated, with
 * `cache-control: public, max-age=31536000, immutable`. So every screenshot a
 * customer ever sent -- typically a photograph of their own social feed, often
 * showing other people's names and faces -- is a permanent public URL, cached
 * for a year, that anybody holding the link can open. Nothing in the codebase
 * ever deleted one.
 *
 * The code fix moves NEW screenshots to `private/portal-submissions/`, which
 * nothing public serves; the only way back out is the staff-only route
 * GET /api/portal/submissions/:id/screenshot/:index. That fixes the flow. It
 * does NOT fix what is already sitting in the bucket, and deliberately so:
 * the existing rows still render in the staff review queue through their old
 * `/uploads/...` paths, and an agent moving production objects on its own is
 * exactly the class of action this repository forbids.
 *
 * So this script exists to hand the owner a decision, with numbers.
 *
 * WHAT IT CANNOT KNOW: whether a given `/uploads/...` link has already been
 * shared, indexed or cached downstream. Moving the object breaks the public
 * URL, which is the point, but a year-long immutable cache header means a
 * copy may survive in a CDN or a browser for a while afterwards. That is an
 * argument for doing this sooner, not for not doing it.
 *
 * HOW TO PRODUCE THE INPUT (run manually, by the owner or an explicitly
 * authorized session -- this repository's convention for reading rows from
 * remote D1 is `--command`, never `--file`, because `--file` prints only a
 * change summary and no rows):
 *
 *   npx wrangler d1 execute business-os --remote --json --command \
 *     "SELECT id, customer_id, status, reviewed_at, created_at, screenshots_json FROM customer_share_submissions ORDER BY id" \
 *     > share-submissions.json
 *
 * THEN run this planner locally (safe -- it reads that one file and writes
 * text to stdout):
 *
 *   node ops/scripts/migration/plan-portal-submission-screenshot-relocation.mjs share-submissions.json
 *
 * The export is a `wrangler d1 execute --json` array whose first element has a
 * `.results` array; a bare row array is accepted too, so a hand-trimmed file
 * also works.
 *
 * WHAT THE PLAN CONTAINS
 *   1. Counts: rows read, objects already private, objects still public,
 *      values the planner did not recognise.
 *   2. For each still-public object, the `wrangler r2 object get/put` pair
 *      that copies it to its private key, and later the `delete`.
 *   3. One idempotent UPDATE per row rewriting screenshots_json, to be applied
 *      only after every copy has succeeded.
 *   4. Pre- and post-assertions to run either side of the batch.
 *   5. A recovery note.
 *
 * RECOVERY: the relocation is copy-then-delete, so until the delete step runs
 * the old object still exists and nothing is lost by stopping. After the
 * UPDATE step, an abandoned run leaves rows pointing at private keys that
 * already exist -- safe. To undo entirely, copy each private key back to its
 * `uploads/` name and restore screenshots_json from the JSON export this plan
 * was built from, which is why that export must be kept until the owner is
 * satisfied.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Must match PORTAL_SUBMISSION_PREFIX in cloudflare/src/routes/portal.ts and
// SUBMISSION_OBJECT_PREFIX in cloudflare/src/lib/ephemeralRetention.ts.
export const PRIVATE_PREFIX = 'private/portal-submissions/'
export const PUBLIC_PATH_PREFIX = '/uploads/'
export const BUCKET_BINDING = 'ASSETS'

export function extractRows(parsed) {
  if (Array.isArray(parsed) && parsed.length && parsed[0] && Array.isArray(parsed[0].results)) return parsed[0].results
  if (Array.isArray(parsed)) return parsed
  if (parsed && Array.isArray(parsed.results)) return parsed.results
  return []
}

/**
 * Classify one stored screenshot value.
 *   'private' -- already under the private prefix; nothing to do.
 *   'public'  -- a legacy `/uploads/NAME` path served to the whole internet.
 *   'inline'  -- a data: URL that was never materialized. Should not exist,
 *                but a row from a half-failed write could hold one, and it is
 *                not an object, so no move applies.
 *   'unknown' -- anything else. Reported, never touched: guessing at a key
 *                is how a plan deletes the wrong object.
 */
export function classifyScreenshot(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { kind: 'unknown', value: raw }
  if (raw.startsWith(PRIVATE_PREFIX)) return { kind: 'private', value: raw }
  if (raw.startsWith('data:')) return { kind: 'inline', value: raw.slice(0, 32) + '...' }
  if (raw.startsWith(PUBLIC_PATH_PREFIX)) {
    const name = raw.slice(PUBLIC_PATH_PREFIX.length)
    // A value with a further slash is not the flat upload name this app
    // writes; refuse it rather than build a key that addresses something else.
    if (!name || name.includes('/')) return { kind: 'unknown', value: raw }
    return { kind: 'public', value: raw, oldKey: 'uploads/' + name, newKey: PRIVATE_PREFIX + name }
  }
  return { kind: 'unknown', value: raw }
}

export function planRows(rows) {
  const plan = { rows: 0, alreadyPrivate: 0, toMove: 0, inline: 0, unknown: 0, moves: [], updates: [], unknowns: [] }
  for (const row of rows) {
    plan.rows += 1
    let parsed = []
    try { parsed = JSON.parse(String(row && row.screenshots_json != null ? row.screenshots_json : '[]')) } catch { parsed = null }
    if (!Array.isArray(parsed)) {
      plan.unknown += 1
      plan.unknowns.push({ id: row && row.id, reason: 'screenshots_json is not a JSON array' })
      continue
    }
    const rewritten = []
    let rowChanged = false
    for (const entry of parsed) {
      const item = classifyScreenshot(entry)
      if (item.kind === 'private') { plan.alreadyPrivate += 1; rewritten.push(item.value); continue }
      if (item.kind === 'public') {
        plan.toMove += 1
        rowChanged = true
        plan.moves.push({ id: row && row.id, oldKey: item.oldKey, newKey: item.newKey })
        rewritten.push(item.newKey)
        continue
      }
      if (item.kind === 'inline') { plan.inline += 1; rewritten.push(String(entry)); continue }
      plan.unknown += 1
      plan.unknowns.push({ id: row && row.id, reason: 'unrecognized screenshot value: ' + item.value })
      rewritten.push(String(entry == null ? '' : entry))
    }
    if (rowChanged) plan.updates.push({ id: row && row.id, screenshotsJson: JSON.stringify(rewritten) })
  }
  return plan
}

function sqlQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

export function buildPlanText(plan) {
  const lines = []
  lines.push('PORTAL SUBMISSION SCREENSHOT RELOCATION -- PLAN ONLY, NOTHING WAS RUN')
  lines.push('')
  lines.push('submission rows read ............. ' + plan.rows)
  lines.push('objects already private .......... ' + plan.alreadyPrivate)
  lines.push('objects still publicly served .... ' + plan.toMove)
  lines.push('inline data: values (no object) .. ' + plan.inline)
  lines.push('values not understood ............ ' + plan.unknown)
  lines.push('')

  if (!plan.toMove) {
    lines.push('Nothing to move. Every stored screenshot is already under the private')
    lines.push('prefix, or is not an object at all. No action is required.')
    if (plan.unknowns.length) {
      lines.push('')
      lines.push('Values this planner did not recognise (reported, never touched):')
      for (const item of plan.unknowns) lines.push('  row ' + item.id + ': ' + item.reason)
    }
    return lines.join('\n')
  }

  lines.push('PRE-ASSERTIONS -- run these first and record the numbers.')
  lines.push('')
  lines.push('  npx wrangler d1 execute business-os --remote --command \\')
  lines.push('    "SELECT COUNT(*) AS rows_with_public_screenshots FROM customer_share_submissions WHERE screenshots_json LIKE \'%/uploads/%\'"')
  lines.push('  -- expected: ' + plan.updates.length)
  lines.push('')
  lines.push('STEP 1 -- copy each object to its private key. Copy FIRST and delete')
  lines.push('LAST, so an interrupted run never loses an image.')
  lines.push('')
  for (const move of plan.moves) {
    lines.push('  # submission ' + move.id)
    lines.push('  npx wrangler r2 object get ' + BUCKET_BINDING + '/' + move.oldKey + ' --file ./relocate/' + path.basename(move.oldKey) + ' --remote')
    lines.push('  npx wrangler r2 object put ' + BUCKET_BINDING + '/' + move.newKey + ' --file ./relocate/' + path.basename(move.oldKey) + ' --remote')
  }
  lines.push('')
  lines.push('STEP 2 -- point the rows at the new keys, only after every copy above has')
  lines.push('succeeded. Each statement is idempotent: re-running it is a no-op.')
  lines.push('')
  for (const update of plan.updates) {
    lines.push('  UPDATE customer_share_submissions SET screenshots_json = ' + sqlQuote(update.screenshotsJson) + ' WHERE id = ' + Number(update.id) + ';')
  }
  lines.push('')
  lines.push('STEP 3 -- only once STEP 2 is applied AND the staff review queue still')
  lines.push('renders the images, delete the public originals. This is the step that')
  lines.push('actually closes the public URL, and the only irreversible one.')
  lines.push('')
  for (const move of plan.moves) {
    lines.push('  npx wrangler r2 object delete ' + BUCKET_BINDING + '/' + move.oldKey + ' --remote')
  }
  lines.push('')
  lines.push('POST-ASSERTIONS')
  lines.push('')
  lines.push('  npx wrangler d1 execute business-os --remote --command \\')
  lines.push('    "SELECT COUNT(*) AS still_public FROM customer_share_submissions WHERE screenshots_json LIKE \'%/uploads/%\'"')
  lines.push('  -- expected: 0')
  lines.push('')
  lines.push('  npx wrangler d1 execute business-os --remote --command \\')
  lines.push('    "SELECT COUNT(*) AS now_private FROM customer_share_submissions WHERE screenshots_json LIKE \'%' + PRIVATE_PREFIX + '%\'"')
  lines.push('  -- expected: at least ' + plan.updates.length)
  lines.push('')
  lines.push('  Open the staff review queue and confirm the thumbnails still load. They')
  lines.push('  are served by GET /api/portal/submissions/:id/screenshot/:index, which')
  lines.push('  reads the private key and requires a staff session.')
  lines.push('')
  lines.push('  Then confirm one old URL is really gone, in a signed-out browser:')
  lines.push('    https://<storefront-host>/' + plan.moves[0].oldKey)
  lines.push('  -- expected: 404. A cached copy may persist briefly; the object is gone.')
  lines.push('')
  lines.push('RECOVERY: until STEP 3 runs the original object still exists and nothing')
  lines.push('is lost by stopping. Keep the JSON export this plan was built from until')
  lines.push('the owner is satisfied -- it is the only record of the old paths.')
  if (plan.unknowns.length) {
    lines.push('')
    lines.push('Values this planner did not recognise (reported, never touched):')
    for (const item of plan.unknowns) lines.push('  row ' + item.id + ': ' + item.reason)
  }
  return lines.join('\n')
}

// --- CLI (never invoked by an agent; see the header) -----------------------
function main() {
  const inputPath = process.argv.slice(2)[0]
  if (!inputPath) {
    console.error('Usage: node plan-portal-submission-screenshot-relocation.mjs <share-submissions.json>')
    console.error('See the file header for the read-only wrangler command that produces the input.')
    process.exitCode = 1
    return
  }
  const rows = extractRows(JSON.parse(fs.readFileSync(inputPath, 'utf8')))
  console.log(buildPlanText(planRows(rows)))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
