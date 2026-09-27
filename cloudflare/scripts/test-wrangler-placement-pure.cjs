// P4-4a fix 5, revised 2026-09-25: placement is pinned to Singapore next to
// the APAC D1 (`[placement]` mode "targeted", region "aws:ap-southeast-1"). Placement lets
// Cloudflare run this D1-round-trip-bound Worker's invocation near the
// backend it actually talks to, instead of always at the edge closest to the
// requesting browser. It is free on both the Workers Free and Paid plans (no
// [limits]-style Paid-only gate), so both wrangler.toml and
// wrangler.free.toml must carry it identically -- this is a source-assertion
// test on the TOML text itself, mirroring the existing wrangler-config-drift
// test's own style for these two hand-maintained files.
//
// Run: node scripts/test-wrangler-placement-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
}

const PLACEMENT_BLOCK = /\[placement\]\s*\r?\nmode\s*=\s*"targeted"\s*\r?\nregion\s*=\s*"aws:ap-southeast-1"/

function main() {
  const paidSrc = read('wrangler.toml')
  const freeSrc = read('wrangler.free.toml')

  check('wrangler.toml (paid) declares [placement] mode = "targeted" + region aws:ap-southeast-1', () => {
    assert.ok(PLACEMENT_BLOCK.test(paidSrc), 'expected a [placement]\\nmode = "targeted" + region aws:ap-southeast-1 block in wrangler.toml')
  })

  check('wrangler.free.toml declares the SAME [placement] mode = "targeted" + region aws:ap-southeast-1 (pinned to Singapore in both configs, not a plan-conditional diff)', () => {
    assert.ok(PLACEMENT_BLOCK.test(freeSrc), 'expected a [placement]\\nmode = "targeted" + region aws:ap-southeast-1 block in wrangler.free.toml')
  })

  check('[placement] is not listed as one of the documented free-vs-paid differences', () => {
    // wrangler.free.toml's own header enumerates "EXACTLY FOUR differences"
    // from wrangler.toml; placement must not need to become a fifth one.
    const diffList = freeSrc.slice(0, freeSrc.indexOf('name = "business-os"'))
    assert.ok(!/placement/i.test(diffList), 'placement should not appear in the documented free/paid diff list -- it is identical on both plans')
  })

  console.log(`\nOK ${passed} checks`)
}

main()
