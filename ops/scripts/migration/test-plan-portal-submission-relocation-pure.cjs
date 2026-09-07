// Pure test for plan-portal-submission-screenshot-relocation.mjs.
//
// The planner never touches production, so the only thing that can be wrong
// with it is the plan itself -- and a wrong plan is how somebody deletes an
// object that was not theirs to delete. The cases below are the ones where a
// naive implementation gets it wrong: a value that is already private, a value
// that is not a flat upload name, a data: URL that has no object at all, and
// the ordering rule that copy comes before delete.
//
// Run: node ops/scripts/migration/test-plan-portal-submission-relocation-pure.cjs

const assert = require('node:assert/strict')

;(async () => {
  const planner = await import('./plan-portal-submission-screenshot-relocation.mjs')

  // --- classification -------------------------------------------------------
  assert.equal(planner.classifyScreenshot('private/portal-submissions/a.jpg').kind, 'private')
  assert.equal(planner.classifyScreenshot('/uploads/a.jpg').kind, 'public')
  assert.equal(planner.classifyScreenshot('data:image/png;base64,AAAA').kind, 'inline')
  assert.equal(planner.classifyScreenshot('').kind, 'unknown')
  assert.equal(planner.classifyScreenshot(null).kind, 'unknown')
  assert.equal(planner.classifyScreenshot('https://elsewhere.example/a.jpg').kind, 'unknown')

  // The one that matters: a nested path is NOT the flat upload name this app
  // writes, so it must not be turned into a key. Treating it as one would
  // produce a delete command for an object in another part of the bucket.
  assert.equal(planner.classifyScreenshot('/uploads/../products/hero.jpg').kind, 'unknown',
    'a value with a further slash must never be turned into an object key')
  assert.equal(planner.classifyScreenshot('/uploads/nested/a.jpg').kind, 'unknown')

  const publicItem = planner.classifyScreenshot('/uploads/portal-submission-1-abc.jpg')
  assert.equal(publicItem.oldKey, 'uploads/portal-submission-1-abc.jpg')
  assert.equal(publicItem.newKey, 'private/portal-submissions/portal-submission-1-abc.jpg')

  // --- planning -------------------------------------------------------------
  const rows = [
    { id: 1, screenshots_json: JSON.stringify(['/uploads/one.jpg', '/uploads/two.jpg']) },
    { id: 2, screenshots_json: JSON.stringify(['private/portal-submissions/three.jpg']) },
    { id: 3, screenshots_json: JSON.stringify(['/uploads/nested/four.jpg']) },
    { id: 4, screenshots_json: '[]' },
    { id: 5, screenshots_json: 'not json at all' },
  ]
  const plan = planner.planRows(rows)
  assert.equal(plan.rows, 5)
  assert.equal(plan.toMove, 2, 'only row 1 has movable objects')
  assert.equal(plan.alreadyPrivate, 1)
  assert.equal(plan.unknown, 2, 'the nested path and the unparseable row')

  // A row is updated only if something in it actually moved. Rewriting a row
  // whose values are unchanged would be a production write for no reason.
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].id, 1)
  assert.deepEqual(JSON.parse(plan.updates[0].screenshotsJson), [
    'private/portal-submissions/one.jpg',
    'private/portal-submissions/two.jpg',
  ])

  // The already-private row and the unrecognised row must NOT appear in moves.
  for (const move of plan.moves) {
    assert.equal(move.id, 1, 'no row other than 1 may produce a move')
    assert.ok(move.oldKey.startsWith('uploads/'))
    assert.ok(move.newKey.startsWith('private/portal-submissions/'))
  }

  // --- the plan text --------------------------------------------------------
  const text = planner.buildPlanText(plan)
  const putAt = text.indexOf('r2 object put')
  const deleteAt = text.indexOf('r2 object delete')
  assert.ok(putAt > 0 && deleteAt > 0, 'the plan must contain both a copy and a delete')
  assert.ok(putAt < deleteAt, 'copy must be planned before delete, so an interrupted run loses nothing')
  assert.match(text, /PRE-ASSERTIONS/)
  assert.match(text, /POST-ASSERTIONS/)
  assert.match(text, /RECOVERY:/)
  assert.match(text, /PLAN ONLY, NOTHING WAS RUN/)
  // It may be REPORTED (the owner needs to know it exists) but it must never
  // appear inside a command the owner is told to run.
  assert.match(text, /unrecognized screenshot value: \/uploads\/nested\/four\.jpg/, 'an unrecognised value must still be reported')
  const commandLines = text.split('\n').filter((line) => line.includes('npx wrangler') || line.trim().startsWith('UPDATE '))
  for (const line of commandLines) {
    assert.doesNotMatch(line, /nested/, 'an unrecognised value must never reach a command: ' + line)
  }

  // Nothing to do reads as nothing to do -- no commands, no assertions to run.
  const emptyPlan = planner.planRows([{ id: 9, screenshots_json: JSON.stringify(['private/portal-submissions/x.jpg']) }])
  const emptyText = planner.buildPlanText(emptyPlan)
  assert.match(emptyText, /No action is required/)
  assert.doesNotMatch(emptyText, /r2 object delete/, 'a no-op plan must not print a delete command')

  // The module must not be able to reach production even if someone runs it.
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, 'plan-portal-submission-screenshot-relocation.mjs'), 'utf8')
  for (const forbidden of ['child_process', 'spawnSync', 'execSync', 'fetch(']) {
    assert.ok(!source.includes(forbidden), `the planner must have no way to execute anything: found ${forbidden}`)
  }
  // The header explains why there is no apply mode; what must not exist is
  // code that reacts to one.
  const code = source.slice(source.indexOf('*/') + 2)
  assert.ok(!code.includes('--apply'), 'this planner deliberately has no apply mode')

  console.log('PASS plan-portal-submission-screenshot-relocation: classification, plan, ordering and no-execution guard')
})().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
