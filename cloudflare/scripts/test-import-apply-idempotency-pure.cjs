// Locks the Part-77 HIGH fix (pipelines audit): the generic import apply
// (products merge_stock/override_add, inventory) is now redelivery-safe.
// The queue is at-least-once and a chunk is not one transaction
// (runD1BatchInChunks splits it), so a redelivered or crash-retried chunk
// used to re-run every additive stock write -- doubling branch stock,
// duplicating inventory movements, re-adding stock deltas. Each such row's
// writes now travel as ONE atomic group with a guard row in the generic
// import_stock_action_guards ledger; a retry pre-reads the guards and
// composes nothing for applied rows.
//
// Tests the REAL transpiled runD1BatchGroupsInChunks (group packing +
// group-boundary CPU splits) plus source locks on the composition.
//
// Run: node scripts/test-import-apply-idempotency-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')

// importEngine.ts is a 5.5k-line module with heavy imports -- rather than
// shimming its whole graph, the two functions under test are extracted
// verbatim from the source and evaluated in isolation. The source locks
// below pin that they still exist in the file with this exact shape, so
// this cannot drift into testing a copy of something that changed.
const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts'), 'utf8')

function extractFunction(name) {
  const start = engineSrc.indexOf(`export async function ${name}(`)
  assert.ok(start > -1, `expected ${name} in importEngine.ts`)
  // Brace-count from the BODY's opening brace (the one after the return
  // type), not the first '{' -- the parameter types contain object braces.
  const bodyAnchor = '): Promise<void> {'
  const anchorAt = engineSrc.indexOf(bodyAnchor, start)
  assert.ok(anchorAt > -1, `expected ${name} to return Promise<void>`)
  const open = anchorAt + bodyAnchor.length - 1
  let depth = 0
  let end = open
  for (let i = open; i < engineSrc.length; i += 1) {
    if (engineSrc[i] === '{') depth += 1
    else if (engineSrc[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i + 1; break }
    }
  }
  return engineSrc.slice(start, end)
}

const ts = require('typescript')
const helpers = `
const D1_IMPORT_BATCH_CHUNK_SIZE = 300
${extractFunction('runD1BatchInChunks').replace('export async function', 'async function')}
function isD1CpuLimitError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /CPU time limit|D1_ERROR/i.test(message)
}
${extractFunction('runD1BatchGroupsInChunks').replace('export async function', 'async function')}
module.exports = { runD1BatchGroupsInChunks }
`
const compiled = ts.transpileModule(helpers, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const sandbox = { exports: {} }
new Function('exports', 'require', 'module', compiled)(sandbox.exports, require, sandbox)
const { runD1BatchGroupsInChunks } = sandbox.exports

function spyDb(failTimes = new Map()) {
  const batches = []
  return {
    batches,
    batch: async (statements) => {
      const key = statements.map((s) => s.sql).join('|')
      const remaining = failTimes.get(key) || 0
      if (remaining > 0) {
        failTimes.set(key, remaining - 1)
        throw new Error('D1_ERROR: CPU time limit exceeded')
      }
      batches.push(statements.map((s) => s.sql))
    },
  }
}

const g = (name, size) => Array.from({ length: size }, (_, i) => ({ sql: `${name}:${i}`, params: {} }))

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {

await check('groups pack whole -- a group is never split across db.batch() calls', async () => {
  const db = spyDb()
  await runD1BatchGroupsInChunks(db, [g('a', 3), g('b', 3), g('c', 3)], 7)
  assert.deepStrictEqual(db.batches.map((b) => b.length), [6, 3], 'a+b fit in one 7-statement batch; c starts its own')
  assert.deepStrictEqual(db.batches[0], ['a:0', 'a:1', 'a:2', 'b:0', 'b:1', 'b:2'])
  assert.deepStrictEqual(db.batches[1], ['c:0', 'c:1', 'c:2'])
})

await check('a CPU-limit failure splits at GROUP boundaries, never through a group', async () => {
  const fullKey = [...g('a', 2), ...g('b', 2)].map((s) => s.sql).join('|')
  const db = spyDb(new Map([[fullKey, 1]]))
  await runD1BatchGroupsInChunks(db, [g('a', 2), g('b', 2)], 10)
  // First attempt (a+b together) fails once, then each group lands whole.
  assert.deepStrictEqual(db.batches, [['a:0', 'a:1'], ['b:0', 'b:1']])
})

await check('a single group that alone blows the budget re-throws instead of breaking atomicity', async () => {
  const group = g('big', 4)
  const db = spyDb(new Map([[group.map((s) => s.sql).join('|'), 99]]))
  await assert.rejects(() => runD1BatchGroupsInChunks(db, [group], 10), /CPU time limit/)
  assert.strictEqual(db.batches.length, 0)
})

await check('source lock: the apply composes guarded groups for both additive branches and pre-reads applied guards', () => {
  assert.ok(/const appliedRowGuards = new Set\(/.test(engineSrc), 'the chunk must pre-read applied guard keys')
  assert.ok(/action_key = @ak/.test(engineSrc), 'guards are scoped by action_key')
  const guardChecks = engineSrc.match(/appliedRowGuards\.has\(`row:\$\{r\.rowNumber\}`\)/g) || []
  assert.ok(guardChecks.length >= 2, `both the products additive branch and the inventory branch must consult the guards (found ${guardChecks.length})`)
  const guardFirst = engineSrc.match(/= \[rowGuardStatement\(r\.rowNumber\)\]/g) || []
  assert.ok(guardFirst.length >= 2, 'each guarded group must LEAD with its guard row so it commits with the writes')
  assert.ok(/if \(guardedGroups\.length\) await runD1BatchGroupsInChunks\(db, guardedGroups\)/.test(engineSrc), 'guarded groups must run through the group-atomic runner')
})

await check('source lock: the guard rides the generic import_stock_action_guards ledger keyed by row', () => {
  assert.ok(/INSERT INTO import_stock_action_guards \(job_id, action_key, guard_key, guard_value\) VALUES \(@jobId, @actionKey, @guardKey, 1\)/.test(engineSrc))
  assert.ok(/guardKey: `row:\$\{rowNumber\}`/.test(engineSrc))
})

}

main().then(() => {
  console.log(`\n${passed} check(s) passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
