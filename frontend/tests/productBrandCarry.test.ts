import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { executeProductEditRequest } from '../src/utils/productEditRequests.ts'

const source = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ProductForm.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function actualFunction(name: string, scope: Record<string, unknown>): any {
  const matches: ts.FunctionDeclaration[] = []
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, name)
  const javascript = ts.transpileModule(matches[0].getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), `${javascript}; return ${name}`)(...Object.values(scope))
}
const clearAfterSuccessfulProductSave = actualFunction('clearAfterSuccessfulProductSave', {})
const numberInput = (value: unknown, fallback = 0) => value == null || value === '' ? fallback : Number(value)
function formFixture({ confirm = true, choice = 'carry', outcome = 'applied' } = {}) {
  const events: string[] = [], payloads: Record<string, unknown>[] = [], sent: Array<Record<string, unknown>> = [], alerts: string[] = []
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  let directRenames = 0, sends = 0, cleared = 0, closed = 0, lastReceipt: any
  const product = { id: 1, name: 'Soap', brand: 'Old brand' }
  const form = { ...product, brand: 'New brand', barcode: '0012', selling_price_usd: '4', cost_price_usd: '2.5' }
  const pointer = { applier: 'product.edit.v1', operation_id: '72', generation: 0 }
  const receipt = { applied: true, action_history_id: 88, operation_id: '72', generation: 0,
    history: { id: 88, undo_payload: pointer, redo_payload: pointer } }
  const saveForm = actualFunction('saveForm', {
    saving: false, saveInFlightRef: { current: false }, imageUploading: false, imageUploadInFlightRef: { current: false },
    form, product, initialForm: form, user: {}, createSessionDuplicate: false, isCreateMode: false, branches: [],
    canManageImages: true, imageListRef: { current: ['uploads/soap.png'] }, ADMIN_MAX_PRODUCT_GALLERY_IMAGES: 5,
    omitUnauthorizedCatalogCosts: (payload: unknown) => payload, normalizePriceValue: Number, normalizeInternalMoney: Number,
    parseNumericInput: numberInput, canViewCosts: true, blindCostInputs: { usd: '', khr: '' }, showReceivedDate: false,
    canonicalizePersistedMediaPath: (value: unknown) => String(value || ''),
    getRenameImpact: async () => ({ products_primary: 2, products_secondary: 1 }),
    askRenameChoice: async () => { events.push('choice'); return choice },
    renameBrandEverywhere: async () => { directRenames++; events.push('standalone-rename') },
    askSaveConfirm: async () => { events.push('confirm'); return confirm }, setSaving() {},
    onSave: async (payload: Record<string, unknown>) => {
      events.push('save'); payloads.push(payload)
      lastReceipt = await executeProductEditRequest(storage, 'brand-edit', 1, { ...payload, expectedUpdatedAt: 'original-version' }, async intent => {
        sends++; sent.push(intent.body)
        if (outcome === 'lost' && sends === 1) throw new Error('lost response')
        if (outcome === 'refused') throw Object.assign(new Error('permission denied'), { status: 403 })
        if (outcome === 'pending') return { pending: true, applied: false, pendingActionId: 5, operation_id: '72', generation: 0 }
        return receipt
      }, () => {})
      return lastReceipt
    },
    clearAfterSuccessfulProductSave, clearCurrentProductDraft: () => { cleared++ }, onClose: () => { closed++ },
    tr: (_key: string, english: string) => english, alert: (message: string) => { alerts.push(message) },
    getErrorMessage: (error: Error) => error.message,
  })
  return { saveForm, events, payloads, sent, alerts, pending: () => values.get('brand-edit'),
    counts: () => ({ directRenames, sends, cleared, closed }), receipt: () => lastReceipt }
}

const canceled = formFixture({ confirm: false })
await canceled.saveForm()
assert.deepEqual(canceled.counts(), { directRenames: 0, sends: 0, cleared: 0, closed: 0 }, 'final Cancel must leave the entire catalog and draft untouched')
assert.deepEqual(canceled.events, ['choice', 'confirm'])
const rejected = formFixture({ choice: 'cancel' })
await rejected.saveForm()
assert.deepEqual(rejected.counts(), { directRenames: 0, sends: 0, cleared: 0, closed: 0 })
assert.deepEqual(rejected.events, ['choice'])
console.log('PASS actual ProductForm final Cancel and rename Cancel send zero writes')

for (const choice of ['carry', 'only']) {
  const fixture = formFixture({ choice })
  await fixture.saveForm()
  assert.deepEqual(fixture.events, ['choice', 'confirm', 'save'])
  assert.deepEqual(fixture.counts(), { directRenames: 0, sends: 1, cleared: 1, closed: 1 })
  assert.deepEqual(fixture.sent[0].__brand_rename, choice === 'carry' ? { from: 'Old brand', to: 'New brand' } : undefined)
  assert.deepEqual(fixture.sent[0].image_gallery, ['uploads/soap.png'])
  assert.equal(fixture.sent[0].cost_price_usd, 2.5)
  assert.equal(fixture.sent[0].selling_price_usd, 4)
}
console.log('PASS brand carry travels in the same actual form save body with gallery and money; only-this-row omits carry')

const lost = formFixture({ outcome: 'lost' })
await lost.saveForm()
assert.ok(lost.pending())
assert.deepEqual(lost.counts(), { directRenames: 0, sends: 1, cleared: 0, closed: 0 })
await lost.saveForm()
assert.deepEqual(lost.sent[0], lost.sent[1], 'the original request identity and brand carry must survive a lost response')
assert.ok(lost.sent[0].client_request_id)
assert.equal(lost.pending(), undefined)
assert.deepEqual(lost.counts(), { directRenames: 0, sends: 2, cleared: 1, closed: 1 })

const refused = formFixture({ outcome: 'refused' })
await refused.saveForm()
assert.deepEqual(refused.counts(), { directRenames: 0, sends: 1, cleared: 0, closed: 0 })
assert.match(refused.alerts[0], /permission denied/)
const pending = formFixture({ choice: 'only', outcome: 'pending' })
await pending.saveForm()
assert.equal(pending.receipt().pending, true)
assert.equal(pending.receipt().applied, false)
assert.equal(pending.counts().directRenames, 0)
assert.equal(pending.sent[0].__brand_rename, undefined)
console.log('PASS carry retry preserves the durable body, refusal preserves draft, and ordinary only-row review stays pending')
