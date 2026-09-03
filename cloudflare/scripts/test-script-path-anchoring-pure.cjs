const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Every pure test script must resolve the files it reads against its own
// location, never against the caller's working directory.
//
// This is not style. `test-inventory-adjust-set-pure.cjs` read
// 'src/routes/inventory.ts' relative to the cwd, so the whole suite was green
// when swept from `cloudflare/` and threw ENOENT when swept from
// `cloudflare/scripts/` -- and `cloudflare/scripts/` is exactly where
// CLAUDE.md's documented sweep command cds to:
//
//   cd cloudflare && npx tsc --noEmit && cd scripts && for f in test-*.cjs; ...
//
// So the documented procedure produced a failure, three separate lanes reported
// it as a red they had caused, and each spent time proving they had not. A
// check that reports a different verdict depending on where it was invoked from
// is worse than no check: it teaches people to distrust real reds.
//
// The rule is enforced structurally rather than by re-running the suite from
// two directories, because a path only breaks when its branch executes.

const scriptsDir = __dirname
const files = fs.readdirSync(scriptsDir).filter((name) => /^test-.*\.cjs$/.test(name))

assert.ok(files.length > 100, `expected the pure suite to be discovered, saw ${files.length} files`)

// A read is anchored if its path argument starts from __dirname (directly, or
// through a helper built from it). Anything else -- a bare 'src/...' or a
// '../frontend/...' -- resolves against the cwd.
const CWD_RELATIVE = /\b(?:readFileSync|readdirSync|existsSync|createReadStream)\s*\(\s*['"`](?!\/)(?:\.\.?\/)?[A-Za-z.]/

const offenders = []
for (const name of files) {
  const source = fs.readFileSync(path.join(scriptsDir, name), 'utf8')
  source.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().startsWith('//')) return
    if (!CWD_RELATIVE.test(line)) return
    offenders.push(`${name}:${index + 1}  ${line.trim().slice(0, 120)}`)
  })
}

assert.deepEqual(
  offenders,
  [],
  'these pure tests read a path relative to the caller\'s cwd, so they pass from cloudflare/ and throw ENOENT from cloudflare/scripts/. '
    + 'Anchor them with path.join(__dirname, ...) instead:\n  ' + offenders.join('\n  '),
)

// The file this rule was written for must stay anchored, named so a revert is
// reported by name rather than as a generic count.
const fixed = fs.readFileSync(path.join(scriptsDir, 'test-inventory-adjust-set-pure.cjs'), 'utf8')
assert.match(fixed, /path\.resolve\(__dirname/, 'test-inventory-adjust-set-pure.cjs must anchor its reads to __dirname')

console.log(`PASS all ${files.length} pure test scripts anchor their reads to __dirname, not to the caller's cwd`)
