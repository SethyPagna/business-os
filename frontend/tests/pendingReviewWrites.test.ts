// Every write that a Review Required user can have QUEUED must tell the user so, and must refresh
// the "waiting for review" tags straight away (owner, 13 Oct 2026; refuter S1).
//
// The Worker answers 202 { success: true, pending: true } to such a write: nothing was stored. Three
// places used to ignore that and carry on as if it had been:
//   - Promotions > Discounts saved a product discount through updateProduct() and toasted "Product
//     discount saved." although the discount was only submitted for review;
//   - Stock-in > create a new product ("Adjust stock" on Products) handled the 202 but never refreshed
//     the Add button's waiting count;
//   - Expenses > delete handled the 202 but never refreshed the row's tag.
//
// The Promotions save is the REAL saveDiscount function lifted out of the page and run on a recording
// harness, so 202 vs 200 is tested as behaviour. The other two sit in components too large to mount,
// so their wiring is pinned in the source, each with a negative control.
//
// Run: node tests/pendingReviewWrites.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const ts = createRequire(new URL('../../cloudflare/package.json', import.meta.url))('typescript')
const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const promotionsSource = read('../src/components/promotions/PromotionsPage.tsx')
const stockInSource = read('../src/components/inventory/FastStockInModal.tsx')
const feesSource = read('../src/components/fees/FeesPage.tsx')
const packs = { en: JSON.parse(read('../src/lang/en.json')) as Record<string, string>, km: JSON.parse(read('../src/lang/km.json')) as Record<string, string> }

function declaration(source: string, name: string): string {
  const tree = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: any
  const visit = (node: any): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.text === name) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(found, `the page declares ${name}`)
  return ts.isVariableDeclaration(found) ? `const ${found.getText(tree)}` : found.getText(tree)
}
function load(source: string, name: string, dependencies: Record<string, unknown>): any {
  const compiled = ts.transpileModule(declaration(source, name), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(dependencies), 'exports', `${compiled}; return ${name}`)(...Object.values(dependencies), {})
}

// ---- Promotions > Discounts: the real saveDiscount on a recording harness ----
const product = { id: 41, updated_at: '2026-10-13 09:00:00' }
const draft = {
  product,
  discount_enabled: true,
  discount_type: 'percent',
  discount_percent: '10',
  discount_amount_usd: '',
  discount_amount_khr: '',
  discount_label: ' Sale ',
  discount_badge_color: '#e11d48',
  discount_starts_at: '',
  discount_ends_at: '',
}

async function saveDiscountWith(answer: () => Promise<unknown>, language: 'en' | 'km' = 'en', source = promotionsSource) {
  const calls: Array<[string, ...unknown[]]> = []
  const pack = packs[language]
  const run = load(source, 'saveDiscount', {
    canManageDiscounts: true,
    discountDraft: draft,
    savingDiscount: false,
    t: (key: string) => pack[key],
    notify: (message: string, kind?: string) => { calls.push(['notify', message, kind]) },
    setSavingDiscount: (value: boolean) => { calls.push(['setSavingDiscount', value]) },
    updateProduct: async (...args: unknown[]) => { calls.push(['updateProduct', ...args]); return answer() },
    // The real function only refreshes on { pending: true }; the harness records what it was handed.
    noteQueuedForReview: (response: unknown) => { calls.push(['noteQueuedForReview', response]); return response },
    setDiscountDraft: (value: unknown) => { calls.push(['setDiscountDraft', value]) },
    setProductQuery: (value: string) => { calls.push(['setProductQuery', value]) },
    setProductResults: (value: unknown[]) => { calls.push(['setProductResults', value]) },
    loadDiscounted: async () => { calls.push(['loadDiscounted']) },
  })
  await run()
  const toasts = calls.filter(([name]) => name === 'notify').map(([, message, kind]) => ({ message, kind }))
  const names = calls.map(([name]) => name)
  return { calls, toasts, names }
}

const QUEUED = { success: true, pending: true, pendingActionId: 12 }

async function scenarioQueuedEditIsNotSaved(language: 'en' | 'km', source = promotionsSource): Promise<void> {
  const saved = packs[language].promo_discount_saved
  const queued = packs[language].reason_submitted_for_review
  assert.ok(saved && queued && saved !== queued, 'both messages exist in the pack and differ')
  const { toasts, calls } = await saveDiscountWith(async () => QUEUED, language, source)
  assert.deepEqual(toasts, [{ message: queued, kind: undefined }], 'exactly one toast: the submitted-for-review message')
  assert.ok(!toasts.some((toast) => toast.message === saved), 'the saved message is not shown for a queued edit')
  assert.deepEqual(calls.find(([name]) => name === 'noteQueuedForReview'), ['noteQueuedForReview', QUEUED], 'the response is handed to the tag refresh')
}

for (const language of ['en', 'km'] as const) {
  test(`${language}: a discount edit answered 202 says it was submitted for review, never that it was saved`, async () => {
    await scenarioQueuedEditIsNotSaved(language)
  })
}

test('a discount edit answered 200 still says it was saved, and the editor closes on a re-read list', async () => {
  const { toasts, names } = await saveDiscountWith(async () => ({ success: true }))
  assert.deepEqual(toasts, [{ message: packs.en.promo_discount_saved, kind: undefined }])
  assert.ok(!toasts.some((toast) => toast.message === packs.en.reason_submitted_for_review))
  assert.deepEqual(names, ['setSavingDiscount', 'updateProduct', 'noteQueuedForReview', 'notify', 'setDiscountDraft', 'setProductQuery', 'setProductResults', 'loadDiscounted', 'setSavingDiscount'])
})

test('a queued edit keeps the form honest: no optimistic value is applied, the list is re-read from the server', async () => {
  const { calls, names } = await saveDiscountWith(async () => QUEUED)
  // The only state the save touches is closing the editor and clearing the picker; the discounted list is
  // reloaded (it still shows the discount that is really on the product), never patched with the draft.
  assert.deepEqual(names, ['setSavingDiscount', 'updateProduct', 'noteQueuedForReview', 'notify', 'setDiscountDraft', 'setProductQuery', 'setProductResults', 'loadDiscounted', 'setSavingDiscount'])
  assert.deepEqual(calls.find(([name]) => name === 'setDiscountDraft'), ['setDiscountDraft', null])
  const sent = calls.find(([name]) => name === 'updateProduct') as [string, number, Record<string, unknown>]
  assert.equal(sent[1], 41)
  assert.equal(sent[2].discount_percent, 10)
  assert.equal(sent[2].discount_label, 'Sale')
})

test('a refused discount edit still shows the error and does not reload', async () => {
  const { toasts, names } = await saveDiscountWith(async () => { throw new Error('nope') })
  assert.deepEqual(toasts, [{ message: 'nope', kind: 'error' }])
  assert.ok(!names.includes('loadDiscounted') && !names.includes('noteQueuedForReview'))
})

// ---- the other two 202s: the wiring, in the source ----
const stockInWired = (source: string): boolean =>
  /import \{ refreshPendingReviewAfterWrite \} from '\.\.\/\.\.\/utils\/pendingReviewTargets\.ts'/.test(source)
  && /const reviewPending = [^\n]*'product_pending_review'\n\s*if \(reviewPending\) refreshPendingReviewAfterWrite\(\)\n/.test(source)
const feesWired = (source: string): boolean =>
  /import \{ refreshPendingReviewAfterWrite \} from '\.\.\/\.\.\/utils\/pendingReviewTargets\.ts'/.test(source)
  && /onSuccess: async \(outcome\) => \{\n\s*if \(outcome === 'pending'\) refreshPendingReviewAfterWrite\(\)\n/.test(source)

test('a product created from the stock-in session and queued for review refreshes the Add button\'s count', () => {
  assert.ok(stockInWired(stockInSource), 'FastStockInModal refreshes the tags where Complete Session reads a product_pending_review outcome')
})

test('an expense delete queued for review refreshes the row\'s tag', () => {
  assert.ok(feesWired(feesSource), 'FeesPage refreshes the tags when its delete outcome is pending')
})

// ---- negative controls: the same source with one rule removed must fail its check ----
function mutate(source: string, from: string, to: string): string {
  assert.equal(source.split(from).length, 2, `negative control anchor must match exactly once: ${from.slice(0, 60)}`)
  return source.replace(from, to)
}

test('MUTANT the save ignores the 202: a queued edit is toasted as saved', async () => {
  const code = mutate(promotionsSource, "const queued = (noteQueuedForReview(result) as { pending?: unknown } | null | undefined)?.pending === true", 'const queued = false')
  await assert.rejects(scenarioQueuedEditIsNotSaved('en', code), (error: Error) => /exactly one toast/.test(error.message))
})

test('MUTANT the save never hands the response to the tag refresh', async () => {
  const code = mutate(promotionsSource, "(noteQueuedForReview(result) as { pending?: unknown } | null | undefined)?.pending === true", "(result as { pending?: unknown } | null | undefined)?.pending === true")
  await assert.rejects(scenarioQueuedEditIsNotSaved('en', code), (error: Error) => /handed to the tag refresh/.test(error.message))
})

test('MUTANT stock-in forgets the refresh, and so does the expense delete', () => {
  assert.equal(stockInWired(mutate(stockInSource, '        if (reviewPending) refreshPendingReviewAfterWrite()\n', '')), false)
  assert.equal(feesWired(mutate(feesSource, "        if (outcome === 'pending') refreshPendingReviewAfterWrite()\n", '')), false)
})
