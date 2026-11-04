'use strict'
// P2.8 (6.0.1046): a defect in the phone masking must turn a test red. Runs each of the phone tests' mutants (a defect
// applied to ONE source file in the in-memory Worker bundle; src/ is never touched) and requires the test to FAIL, and to
// fail for a reason (not because the mutant's anchor text moved). A survivor means a green run proves nothing.
//
//   crawl   test-phone-leak-crawl-native.cjs         the egress projection and the grant-keyed caches
//   oracle  test-phone-search-oracle-native.cjs      search must not spell out a hidden number
//   write   test-phone-write-guard-native.cjs        a mask must never overwrite a real number
//   text    test-phone-masked-text-native.cjs        a mask must never overwrite a name, note or label; people-only name masking; no key leaks
//
// Run (from cloudflare/): node scripts/test-phone-leak-mutants-crawl-native.cjs   (crawl, write, text)
//                          node scripts/test-phone-leak-mutants-oracle-native.cjs  (oracle)
// Four mutant worlds run at a time; each boots its own Worker under Miniflare.
const { spawn } = require('node:child_process')
const path = require('node:path')

const RUNS = [
  ['crawl', 'no-egress-projection', {}],
  ['crawl', 'one-route-bypasses-c-json', { PHONE_CRAWL_FILTER: 'api/sales/delivery-options' }],
  ['crawl', 'duplicate pair value kept', { PHONE_CRAWL_FILTER: 'duplicates' }],
  ['crawl', 'people: contact_person is not a name', { PHONE_CRAWL_FILTER: 'api/suppliers?page=1' }],
  ['crawl', 'cache-shared-key', { PHONE_WORLD: 'egress-off', PHONE_MODE: 'cache' }],
  ['crawl', 'cache-stores-full-body', { PHONE_WORLD: 'egress-off', PHONE_MODE: 'cache' }],
  ['crawl', 'cache-variant-ignores-grant', { PHONE_WORLD: 'egress-off', PHONE_MODE: 'cache' }],
  ...['sales digit words read the phone', 'sales digit words guarded only for a raw all-digit search', 'contacts only an all-digit word is guarded',
    'sales whole number not compared', 'sales number saved as a name readable', 'delivery picker matches phone fragments',
    'returns digit words read the name', 'returns digit words guarded only for a raw all-digit search', 'audit search reads phone text', 'contacts search ignores the grant',
    'contacts digit words guarded only for a raw all-digit search', 'sales stats cache shared across grants', 'reports sales list matches the phone by substring',
    'reports sales export matches the phone by substring', 'reports returns search reads a numeric name', 'delivery picker reads a numeric courier name', 'non-ASCII digits are not folded',
    'sales zero-to-o retry reaches the phone column', 'returns zero-to-o retry reaches the folded copy', 'zero-to-o retry also for a digit-only word', 'zero-to-o retry removed (a mixed word is lost again)',
    'sales note that is a number readable', 'sales cashier that is a number readable', 'sales cashier filter reads the number',
    'returns note that is a number readable', 'returns supplier saved under a number readable'].map((name) => ['oracle', name, {}]),
  ...['edit saves the mask it was shown', 'edit saves masked Contact Options', 'create accepts a mask', 'resolver accepts a mask of another number',
    'merge accepts a masked custom phone', 'mask matched against any stored number, first hit wins', 'option mask resolved against all stored options',
    'asterisk phone that is not a mask saved as typed', 'position match trusted without a uniqueness check',
    'duplicate dismissal accepts a mask'].map((name) => ['write', name, {}]),
  ...['write: the masked values are not taken out of the request', 'write: the masked values are also taken out of an account that holds the grant', 'write: any text that contains *** is taken for a mask', 'catalog: a product or branch name is masked like a person', 'people: contact_person and cashier are not names',
    'people: username is not a name', 'people: the cashiers list key is shown', 'search: a supplier contact person is readable through a digit word',
    'search: the legacy deleted reason is read raw', 'search: the legacy deleted cashier filter reads the number'].map((name) => ['text', name, {}]),
]
const FILES = { crawl: 'test-phone-leak-crawl-native.cjs', oracle: 'test-phone-search-oracle-native.cjs', write: 'test-phone-write-guard-native.cjs', text: 'test-phone-masked-text-native.cjs' }
// The mutants are split over two test files so that each fits the gate's first try (10 min) with margin: one file took 675 s on a loaded machine.
// Every kind belongs to exactly one group (checked below), so no mutant is dropped by the split.
const GROUPS = { crawl: ['crawl', 'write', 'text'], oracle: ['oracle'] }
const PARALLEL = Math.max(1, Number(process.env.PHONE_MUTANT_PARALLEL) || 4)

function run([kind, name, env]) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', FILES[kind])], { env: { ...process.env, PHONE_MUTANT: name, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
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

const grouped = new Set(Object.values(GROUPS).flat())
for (const [kind, name] of RUNS) if (!grouped.has(kind)) throw new Error(`mutant ${kind}: ${name} is in no group`)

async function main(group) {
  const kinds = GROUPS[group]
  if (!kinds) throw new Error(`unknown mutant group ${group}`)
  const queue = RUNS.filter(([kind]) => kinds.includes(kind))
  const results = []
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const job = queue.shift()
      let result = await run(job)
      // A world that died before it ran one check (a failed process start on a busy machine) says nothing about the mutant: run it once more.
      const crashed = (r) => r.code !== 0 && r.red === 0 && !r.anchor
      const retried = crashed(result)
      if (retried) result = await run(job)
      results.push(result)
      const killed = result.code !== 0 && result.red > 0 && !result.anchor
      console.log(`${killed ? 'killed  ' : 'SURVIVED'} ${result.kind}: ${result.name}${result.anchor ? ' (the mutant\'s anchor text is gone: update the mutant)' : ` (${result.red} red case${result.red === 1 ? '' : 's'}${retried ? ', after one restart of a crashed world' : ''})`}`)
    }
  }))
  if (!results.length) { console.error(`FAIL group ${group} ran no mutant`); process.exit(1) }
  const survivors = results.filter((result) => !(result.code !== 0 && result.red > 0 && !result.anchor))
  if (survivors.length) { console.error(`FAIL ${survivors.length} mutant(s) survived`); process.exit(1) }
  console.log(`PASS ${results.length} phone mutants killed (${group})`)
}

module.exports = { main: (group) => main(group).catch((error) => { console.error(error); process.exit(1) }), GROUPS, RUNS }
