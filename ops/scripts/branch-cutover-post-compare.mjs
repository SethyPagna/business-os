#!/usr/bin/env node
// Branch cutover post-check comparison (runbook P10, G12-CUTOVER-READINESS.md 3.4). The comparable
// post-check queries (ops/queries/branch-cutover-post-stock.sql and branch-cutover-post-labels.sql)
// run twice through the Ops d1-export task: at P7, right after begin under the fence, and at P10,
// after finalize. Each output is one row. The queries already put back what the owner's lot-merge
// rulings change on purpose (from the run's own fold audit rows), so PASS means every column not
// prefixed info_ is equal in the two outputs:
//   - value_* columns within VALUE_TOLERANCE (sums of REAL products in a different order);
//   - every other column exactly, and every compared value must be a number (a NULL fails);
//   - the two outputs must come from the same query text.
// Runs on the owner's machine on the decrypted outputs (ops/scripts/ops-decrypt.mjs):
//   node ops/scripts/branch-cutover-post-compare.mjs <p7.json> <p10.json>
// Prints one line per compared column and exits 0 on PASS, 1 on FAIL, 2 on bad input.
// Paired test: cloudflare/scripts/test-branch-cutover-post-checks-native.cjs

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export const VALUE_TOLERANCE = 0.000005

/** The single result row of a decrypted d1-export payload, a { rows } object, an array or a bare row. */
export function cutoverPostRow(input) {
  const rows = Array.isArray(input) ? input : input && Array.isArray(input.rows) ? input.rows : input && typeof input === 'object' ? [input] : []
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0])) throw new Error('expected exactly one result row')
  return rows[0]
}

export function compareCutoverPost(baselineInput, postInput) {
  const baseline = cutoverPostRow(baselineInput), post = cutoverPostRow(postInput)
  const problems = []
  for (const [name, input] of [['query', 'query'], ['sql', 'sql']]) {
    const a = baselineInput && baselineInput[input], b = postInput && postInput[input]
    if (a !== undefined && b !== undefined && a !== b) problems.push(`the two outputs come from different ${name === 'sql' ? 'query text' : 'queries'}`)
  }
  const names = [...new Set([...Object.keys(baseline), ...Object.keys(post)])].filter(name => !name.startsWith('info_')).sort()
  if (!names.length) problems.push('no compared columns')
  const columns = names.map(column => {
    const a = baseline[column], b = post[column]
    let ok = typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)
    if (ok) ok = column.startsWith('value_') ? Math.abs(a - b) <= VALUE_TOLERANCE : a === b
    return { column, baseline: a, post: b, ok }
  })
  return { ok: !problems.length && columns.every(c => c.ok), problems, columns,
    info: Object.fromEntries(Object.keys(post).filter(name => name.startsWith('info_')).map(name => [name, { baseline: baseline[name], post: post[name] }])) }
}

function main(argv) {
  if (argv.length !== 2) {
    process.stderr.write('Usage: node ops/scripts/branch-cutover-post-compare.mjs <p7.json> <p10.json>\n')
    return 2
  }
  let result
  try {
    const [a, b] = argv.map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
    result = compareCutoverPost(a, b)
  } catch (error) {
    process.stderr.write(`branch-cutover-post-compare: ${error.message}\n`)
    return 2
  }
  for (const problem of result.problems) process.stdout.write(`FAIL ${problem}\n`)
  for (const c of result.columns) process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'} ${c.column}: ${c.baseline} -> ${c.post}\n`)
  for (const [name, v] of Object.entries(result.info)) process.stdout.write(`info ${name}: ${v.baseline} -> ${v.post}\n`)
  process.stdout.write(result.ok ? 'PASS\n' : 'FAIL\n')
  return result.ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
