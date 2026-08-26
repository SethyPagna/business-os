// Attaching matched images to products is an EXPLICIT action, not automatic.
//
// It used to run on the first chunk of any products import that had images
// attached. That is the wrong default for the case it is actually used in --
// a delete-and-reimport -- where the operator wants to see which images
// matched which rows, and how many matched nothing, BEFORE anything is
// attached. Once it has run automatically there is no "not yet": the only
// way back is another delete and another re-upload.
//
// So the engine now skips matching unless the job's policy says to wire, and
// POST /:id/images/wire is what sets that. Until then, analyze and apply
// behave exactly as they would for a CSV with no images at all -- a safe
// state, not a half-applied one.
//
// Run: node scripts/test-image-wire-optin-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const engine = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')
const route = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'importJobs.ts'), 'utf8')

// Lift the real predicate rather than restating it.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-images-'))
const fnSrc = (() => {
  const start = engine.indexOf('export function shouldWireImages')
  assert.ok(start > 0, 'shouldWireImages not found -- update this test')
  const open = engine.indexOf('{', start)
  let depth = 0
  for (let i = open; i < engine.length; i += 1) {
    if (engine[i] === '{') depth += 1
    else if (engine[i] === '}') { depth -= 1; if (depth === 0) return engine.slice(start, i + 1) }
  }
  throw new Error('could not read shouldWireImages')
})()
const tsPath = path.join(tmpDir, 'wire.ts')
fs.writeFileSync(tsPath, fnSrc)
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { shouldWireImages } = require(path.join(tmpDir, 'wire.js'))

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

check('images are NOT wired unless the job explicitly opted in', () => {
  for (const policy of [null, undefined, '', '{}', '{"import_mode":"merge"}']) {
    assert.equal(shouldWireImages(policy), false, `${JSON.stringify(policy)} must not wire`)
  }
  assert.equal(shouldWireImages('{"wire_images":true}'), true)
})

check('only a real boolean true counts -- a truthy string does not', () => {
  // A stray "true"/1 from a hand-edited policy must not silently attach every
  // image in the job. Opting in should require having actually opted in.
  for (const value of ['"true"', '1', '"yes"', 'null', 'false']) {
    assert.equal(shouldWireImages(`{"wire_images":${value}}`), false, `${value} must not count as opt-in`)
  }
})

check('malformed policy JSON fails CLOSED, not open', () => {
  // The safe direction: a corrupt policy attaches nothing, rather than
  // attaching everything to rows nobody reviewed.
  for (const bad of ['{oops', 'not json', '[1,2,3']) {
    assert.equal(shouldWireImages(bad), false)
  }
})

check('a job created before this existed also needs the button', () => {
  // Deliberate. Silently wiring images for an in-flight job is exactly the
  // surprise this change removes, so old jobs get the same explicit step.
  assert.equal(shouldWireImages('{"import_mode":"replace_all","decisions":{}}'), false)
})

// ---- the engine must actually consult it ----
check('both analyze and apply gate image matching on the flag', () => {
  const gated = engine.match(/&& shouldWireImages\((?:meta\.policyJson|job\.policy_json)\)/g) || []
  assert.equal(gated.length, 2, 'analyze and apply must both be gated, or one phase wires and the other does not')
  assert.ok(
    !/if \((?:meta|job)\.type === 'products' && !imageMatchCache\) \{/.test(engine),
    'the old ungated branch must be gone',
  )
})

// ---- the endpoint ----
check('the wire endpoint exists, is permission-checked, and reports what it found', () => {
  assert.match(route, /app\.post\('\/:id\/images\/wire'/)
  assert.match(route, /const denied = await requireImportPermission\(c as any, job\)/)
  assert.match(route, /policy\.wire_images = true/)
  assert.match(route, /imageCount: Number\(imageCount\?\.n \|\| 0\)/, 'the response should say how many images this affects')
})

check('it refuses while a phase is mid-flight', () => {
  // Flipping the flag under a running job would have later chunks wire
  // images and earlier ones not -- a half-matched import that looks complete.
  const block = route.slice(route.indexOf("app.post('/:id/images/wire'"))
  assert.match(
    block.slice(0, 1800),
    /if \(status === 'analyzing' \|\| status === 'applying'\) \{/,
    'must reject while analyzing or applying',
  )
  assert.match(block.slice(0, 1800), /409/, 'a conflict, not a silent success')
})

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
