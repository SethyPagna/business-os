const assert = require('assert')
const fs = require('fs')
const path = require('path')

const engine = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts'), 'utf8')
const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'importJobs.ts'), 'utf8')

assert.match(engine, /SELECT \* FROM "\$\{table\}" ORDER BY id ASC/, 'contact candidate reads have deterministic ordering')
assert.match(engine, /const byName = new Map<string, ExistingContact\[\]>/, 'exact names retain every candidate instead of overwriting a Map value')
assert.match(engine, /target_existing_id\?: number/, 'review decisions carry the explicit contact target')
assert.match(engine, /rawNameMatches\.find\(\(candidate\) => Number\(candidate\.id\) === selectedTargetId\)/, 'the target is revalidated against the live candidate set')
const classifyAt = engine.indexOf("const results = job.type === 'products'")
const driftAt = engine.indexOf('contactMatchTargetInvalid', classifyAt)
const actionableAt = engine.indexOf('const actionable = results.filter', classifyAt)
assert.ok(classifyAt > 0 && driftAt > classifyAt && actionableAt > driftAt, 'apply refuses target drift before composing any write statements')

assert.match(route, /decision\.action !== 'apply'.*!Number\.isSafeInteger\(targetId\)/s, 'only a positive integer apply target crosses the decisions route')
assert.match(route, /Invalid contact merge target/, 'malformed contact targets return an honest client error')

console.log('PASS contact imports require and revalidate an explicit target for ambiguous exact-name matches')
