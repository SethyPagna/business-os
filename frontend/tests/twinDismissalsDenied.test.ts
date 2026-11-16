// Owner, 16 Nov 2026: a tag must never be a dead end. Round 5 review, L3: the shell reads the Keep-both rulings for every account that can open Products, Inventory, Branches
// or POS, but the Worker refuses the route (productSearchIndexDenialReason) to a role with no product search access, a branches-only role or an image-only Products reader. The
// refusal was swallowed, so those roles saw the Duplicate tag for ever on pairs already ruled Keep both.
// The choice: the route is NOT widened (its payload is the names and barcodes of every dismissed cluster, which a role the Worker keeps out of the catalogue must not read), and
// a role that is refused gets no tag. This runs the REAL transport, the real rulings store and the real tag component (react-dom/server) with only the network stubbed:
// an answer shows the tag, a 403 takes it off and is not asked again for the account, a new account asks again, and other failures (a network error, a forced password change)
// leave the tag as it was. The Worker side of each role is tests in cloudflare/scripts/test-twin-conflicts-resolve-native.cjs. Mutants edit the real sources.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function compile(code: string, resolve: (id: string) => unknown): Record<string, any> {
  const mod: { exports: Record<string, any> } = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(code, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    return resolve(id)
  }, mod, mod.exports)
  return mod.exports
}

type Answer = { ok: true } | { status?: number; code?: string }
type Sources = { transport?: string; tag?: string }
function load(sources: Sources = {}) {
  const calls: string[] = []
  let answer: Answer = { ok: true }
  const grouping = compile(read('utils/productGrouping.ts'), (id) => {
    if (id.endsWith('initials.ts')) return require('../src/utils/initials.ts')
    if (id.endsWith('productDetailRule.ts')) return require('../src/utils/productDetailRule.ts')
    if (id.endsWith('productMerge.ts')) return require('../src/utils/productMerge.ts')
    throw new Error(`unexpected require ${id}`)
  })
  const store = compile(read('utils/productTwinDismissals.ts'), (id) => {
    if (id.endsWith('productGrouping.ts')) return grouping
    if (id.endsWith('productDetailRule.ts')) return require('../src/utils/productDetailRule.ts')
    throw new Error(`unexpected require ${id}`)
  })
  const transport = compile(sources.transport ?? read('components/shared/twinDismissalsTransport.ts'), (id) => {
    if (id.endsWith('http.ts')) {
      return { apiFetch: async (method: string, path: string) => {
        calls.push(`${method} ${path}`)
        if ('ok' in answer) return { dismissals: [['barcode', '8851']] }
        throw Object.assign(new Error('refused'), answer)
      } }
    }
    if (id.endsWith('productWriteTransport.ts')) return { dismissProductDuplicateCluster: async () => ({ success: true }) }
    if (id.endsWith('productTwinDismissals.ts')) return store
    if (id.endsWith('exactDuplicateProducts.ts')) return {}
    throw new Error(`unexpected require ${id}`)
  })
  const tag = compile(sources.tag ?? read('components/products/UnmergedTwinTag.tsx'), (id) => {
    if (id.includes('lucide-react')) return { default: () => null, __esModule: true }
    if (id.endsWith('productTwinDismissals.ts')) return store
    throw new Error(`unexpected require ${id}`)
  })
  const markup = (): string => renderToStaticMarkup(React.createElement(tag.default, { label: 'Duplicate', hint: 'x' }))
  return { transport, store, calls, markup, answer: (next: Answer) => { answer = next } }
}

function probe(sources: Sources = {}): Promise<string[]> {
  return (async () => {
    const failures: string[] = []
    const world = load(sources)
    if (!world.markup().includes('data-unmerged-twin')) failures.push('before any read the tag shows (rulings unknown is not a refusal)')

    await world.transport.refreshTwinDismissals()
    if (!world.markup().includes('data-unmerged-twin')) failures.push('after an answer the tag shows')
    if (!world.store.getTwinDismissals().has(world.store.twinDismissalKey('barcode', '8851'))) failures.push('and the rulings are held')

    world.answer({ status: 403 })
    await world.transport.refreshTwinDismissals()
    if (world.markup() !== '') failures.push('a 403 takes the tag off: that role cannot tell a ruled pair from an open one')
    if (world.store.areTwinDismissalsReadable()) failures.push('and marks the rulings unreadable')
    const asked = world.calls.length
    await world.transport.refreshTwinDismissals()
    await world.transport.refreshTwinDismissals()
    if (world.calls.length !== asked) failures.push('a refused account is not asked again on every products change')

    world.transport.forgetTwinDismissalDenial()
    if (!world.markup().includes('data-unmerged-twin')) failures.push('a new account (or a sign-out) starts with the tag showing again')
    world.answer({ ok: true })
    await world.transport.refreshTwinDismissals()
    if (world.calls.length !== asked + 1) failures.push('and asks the route again')

    for (const [label, other] of [['a network failure', {}], ['a server error', { status: 500 }], ['a forced password change', { status: 403, code: 'password_change_required' }]] as Array<[string, Answer]>) {
      const second = load(sources)
      second.answer(other)
      await second.transport.refreshTwinDismissals()
      if (!second.markup().includes('data-unmerged-twin')) failures.push(`${label} is not a refusal of the role: the tag stays`)
      second.answer({ ok: true })
      await second.transport.refreshTwinDismissals()
      if (second.calls.length !== 2) failures.push(`${label} is asked again`)
    }
    return failures
  })()
}

assert.deepEqual(await probe(), [], 'the real transport and tag')

const transportSource = read('components/shared/twinDismissalsTransport.ts')
const tagSource = read('components/products/UnmergedTwinTag.tsx')
const REFUSAL = "    if (token === readToken && Number(refusal?.status) === 403 && refusal?.code !== 'password_change_required') {"
const mutants: Array<{ name: string; file: 'transport' | 'tag'; from: string; to: string }> = [
  { name: 'a 403 is swallowed like any failure (the pre-L3 behaviour)', file: 'transport', from: REFUSAL, to: '    if (false) {' },
  { name: 'every error is a refusal', file: 'transport', from: REFUSAL, to: '    if (token === readToken) {' },
  { name: 'a forced password change is a refusal', file: 'transport', from: "Number(refusal?.status) === 403 && refusal?.code !== 'password_change_required'", to: 'Number(refusal?.status) === 403' },
  { name: 'a refused account is asked again', file: 'transport', from: '  if (denied) return\n', to: '' },
  { name: 'a new account keeps the refusal', file: 'transport', from: '  denied = false\n  setTwinDismissalsReadable(true)', to: '  setTwinDismissalsReadable(true)' },
  { name: 'the tag ignores the refusal', file: 'tag', from: '  if (!rulingsReadable) return null\n', to: '' },
]
for (const mutant of mutants) {
  const source = mutant.file === 'tag' ? tagSource : transportSource
  assert.ok(source.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const patched = source.replace(mutant.from, mutant.to)
  assert.ok((await probe(mutant.file === 'tag' ? { tag: patched } : { transport: patched })).length > 0, `mutant survived: ${mutant.name}`)
}

// Wiring: the shell's loader forgets a refusal when the account changes or signs out, so a refusal is the account's and not the browser's.
const loader = read('components/shared/useTwinDismissalsLoader.ts')
assert.match(loader, /if \(loadedFor\.current !== accountKey\) forgetTwinDismissalDenial\(\)/, 'a new account asks again')
assert.match(loader, /loadedFor\.current = ''\n      forgetTwinDismissalDenial\(\)/, 'and a sign-out forgets the refusal')
// The route is not widened: it still refuses a role with no product search access, and the tag is the only thing a refused role loses.
const route = readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
assert.match(route, /app\.get\('\/duplicate-dismissals', async \(c\) => \{\n  const denial = productSearchIndexDenialReason\(c\.get\('user'\)\)\n  if \(denial\) return c\.json\(\{ success: false, error: denial \}, 403\)/, 'the route still refuses what the search index refuses')

console.log(`PASS twin dismissals denied: an answer shows the tag, a 403 takes it off and is not asked again, a new account asks again, a network error or a forced password change leaves it; ${mutants.length} mutants killed; the route is not widened`)
