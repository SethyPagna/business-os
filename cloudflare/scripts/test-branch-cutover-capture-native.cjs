const assert = require('node:assert/strict')
const { world, begin, step } = require('./test-branch-cutover-parent-native.cjs')
async function main() {
  const roots = []
  for (const size of [1, 8]) {
    const w = world(); let { row } = await begin(w); let turns = 0
    while (row.phase === 'capturing' && turns++ < 150) row = (await step(w, row, size)).row
    assert.equal(row.phase, 'snapshots'); roots.push(row.capture_digest); w.raw.close()
  }
  assert.equal(roots[0], roots[1]); console.log('PASS canonical capture digest independent of page size')
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
