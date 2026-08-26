// import_jobs.chunk_state_json must stay SMALL.
//
// It is JSON.parse'd at the start of every chunk and JSON.stringify'd at the
// end, so anything stored there is paid for once per chunk -- roughly 58
// times for the real 8,727-row file, inside a Worker whose entire budget is
// 10ms per invocation. Two things had been put there that scale with the
// FILE rather than with the chunk, and both were measured against a machine
// faster than a Worker isolate:
//
//   productSignatures  -- one entry per created row, GROWING each chunk.
//                         8.24 ms on the worst chunk. Moved to
//                         import_job_row_signatures (migration 0051).
//   imageMatch entries -- one per image-matched row, full size from the
//                         FIRST chunk. 7.99 ms per chunk at 10,000 images.
//                         Moved to import_job_image_matches /
//                         import_job_image_renames (migration 0052).
//
// The failure they cause is "Exceeded CPU Limit" on exactly the imports that
// matter most -- the big ones -- so this file guards the shape rather than
// waiting for a slow import to reveal it again.
//
// Run: node scripts/test-chunk-state-size-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const engine = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

// The ImportChunkState type is the contract: if a per-row collection appears
// there again, the quadratic cost comes back with it.
const stateType = (() => {
  const start = engine.indexOf('type ImportChunkState')
  assert.ok(start > 0, 'ImportChunkState not found -- update this test')
  const open = engine.indexOf('{', start)
  let depth = 0
  for (let i = open; i < engine.length; i += 1) {
    if (engine[i] === '{') depth += 1
    else if (engine[i] === '}') { depth -= 1; if (depth === 0) return engine.slice(start, i + 1) }
  }
  throw new Error('could not read ImportChunkState')
})()

// Comments in here deliberately NAME the fields that were removed, so future
// readers know where they went. Strip them before asserting, or the tests
// below trip over their own documentation.
const stateCode = stateType
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim()
    return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
  })
  .join('\n')

check('chunk state carries no per-row image collections', () => {
  assert.ok(!/rowImagePathEntries/.test(stateCode), 'rowImagePathEntries belongs in import_job_image_matches, not chunk state')
  assert.ok(!/renamePlanEntries/.test(stateCode), 'renamePlanEntries belongs in import_job_image_renames -- it is read ONCE per run, not per chunk')
})

check('chunk state carries no per-row signature ledger', () => {
  assert.ok(!/productSignatures/.test(stateCode), 'productSignatures belongs in import_job_row_signatures')
})

check('nothing array- or record-shaped that scales with the file has crept back in', () => {
  // Deliberately structural rather than a name blocklist: the next thing
  // someone parks here will not be called productSignatures.
  const offenders = []
  for (const line of stateType.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    // Allowed: scalars, and the small summary object.
    if (/Array<|\[\]|Record<[^>]*,\s*(number|string)\s*>|Map</.test(trimmed)) offenders.push(trimmed)
  }
  assert.deepEqual(
    offenders,
    [],
    `chunk state must hold scalars and small summaries only; these scale with the file: ${offenders.join(' | ')}`,
  )
})

check('image paths are read for the CURRENT WINDOW, not all at once', () => {
  assert.match(
    engine,
    /await readRowImagePaths\(db, jobId, windowRows\)/,
    'each chunk must look up only its own rows -- loading 10,000 to use 150 was the original cost',
  )
  assert.match(
    engine,
    /WHERE job_id = @id AND row_number IN \(\$\{sql\}\)/,
    'the lookup must be keyed, not a full scan',
  )
  assert.ok(
    !/new Map\(imageMatchCache\.rowImagePathEntries\)/.test(engine),
    'rebuilding the whole map per chunk is the thing being removed',
  )
})

check('the rename plan is read once per run, not carried through every chunk', () => {
  assert.match(engine, /const renamePlanEntries = await readImageRenamePlan\(db, jobId\)/)
  assert.match(engine, /isFreshStart && job\.type === 'products' && imageMatchCache\?\.hasRenamePlan/)
})

check('a re-run replaces the previous match rather than merging into it', () => {
  // A leftover row from an earlier attempt would attach the wrong photo to a
  // product -- silently, since nothing downstream re-checks it.
  assert.match(engine, /DELETE FROM import_job_image_matches WHERE job_id = @id/)
  assert.match(engine, /DELETE FROM import_job_image_renames WHERE job_id = @id/)
})

check('the dedupe ledger is cleared when a phase restarts', () => {
  // Per-RUN, not per-file: inheriting the previous run's marks would report
  // rows as merging with rows from a run that no longer exists.
  const reset = engine.slice(engine.indexOf('async function resetChunkState'))
  assert.match(reset.slice(0, 900), /DELETE FROM import_job_row_signatures WHERE job_id = @id/)
})

check('the migrations that own this data exist', () => {
  const migrations = fs.readdirSync(path.join(cloudflareRoot, 'migrations'))
  assert.ok(migrations.some((f) => f.includes('import_job_row_signatures')), 'migration 0051 missing')
  assert.ok(migrations.some((f) => f.includes('import_job_image_match')), 'migration 0052 missing')
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
