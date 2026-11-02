'use strict'
// P2.8 (6.0.1046): a defect in the phone masking must turn a test red. Runs each of the phone tests' mutants (a defect
// applied to ONE source file in the in-memory Worker bundle; src/ is never touched) and requires the test to FAIL, and to
// fail for a reason (not because the mutant's anchor text moved). A survivor means a green run proves nothing.
//
//   crawl   test-phone-leak-crawl-native.cjs         the egress projection and the grant-keyed caches
//   oracle  test-phone-search-oracle-native.cjs      search must not spell out a hidden number
//   write   test-phone-write-guard-native.cjs        a mask must never overwrite a real number
//
// Run (from cloudflare/): node scripts/test-phone-leak-mutants-native.cjs
// Four mutant worlds run at a time; each boots its own Worker under Miniflare.
const { spawn } = require('node:child_process')
const path = require('node:path')

const RUNS = [
  ['crawl', 'no-egress-projection', {}],
  ['crawl', 'one-route-bypasses-c-json', { PHONE_CRAWL_FILTER: 'api/sales/delivery-options' }],
  ['crawl', 'cache-shared-key', { PHONE_WORLD: 'egress-off', PHONE_MODE: 'cache' }],
  ['crawl', 'cache-stores-full-body', { PHONE_WORLD: 'egress-off', PHONE_MODE: 'cache' }],
  ['crawl', 'cache-variant-ignores-grant', { PHONE_WORLD: 'egress-off', PHONE_MODE: 'cache' }],
  ...['sales digit words read the phone', 'sales whole number not compared', 'sales number saved as a name readable', 'delivery picker matches phone fragments',
    'returns digit words read the name', 'audit search reads phone text', 'contacts search ignores the grant', 'sales stats cache shared across grants'].map((name) => ['oracle', name, {}]),
  ...['edit saves the mask it was shown', 'edit saves masked Contact Options', 'create accepts a mask', 'resolver accepts a mask of another number',
    'merge accepts a masked custom phone'].map((name) => ['write', name, {}]),
]
const FILES = { crawl: 'test-phone-leak-crawl-native.cjs', oracle: 'test-phone-search-oracle-native.cjs', write: 'test-phone-write-guard-native.cjs' }
const PARALLEL = 4

function run([kind, name, env]) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, FILES[kind])], { env: { ...process.env, PHONE_MUTANT: name, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('close', (code) => {
      const anchor = /mutant anchor missing|unknown PHONE_MUTANT/.test(output)
      const red = (output.match(/^RED /gm) || []).length
      resolve({ kind, name, code, anchor, red })
    })
  })
}

async function main() {
  const queue = [...RUNS]
  const results = []
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const result = await run(queue.shift())
      results.push(result)
      const killed = result.code !== 0 && result.red > 0 && !result.anchor
      console.log(`${killed ? 'killed  ' : 'SURVIVED'} ${result.kind}: ${result.name}${result.anchor ? ' (the mutant\'s anchor text is gone: update the mutant)' : ` (${result.red} red case${result.red === 1 ? '' : 's'})`}`)
    }
  }))
  const survivors = results.filter((result) => !(result.code !== 0 && result.red > 0 && !result.anchor))
  if (survivors.length) { console.error(`FAIL ${survivors.length} mutant(s) survived`); process.exit(1) }
  console.log(`PASS ${results.length} phone mutants killed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
