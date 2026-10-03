import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as branchErrors from '../src/api/branchRuleErrors.ts'
import { beginKeyedAction, finishKeyedAction } from '../src/utils/actionGuards.ts'

const ts = createRequire(import.meta.url)('typescript')
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
function load(source: string, name: string, dependencies: Record<string, unknown> = {}): any {
  const tree = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: any
  const visit = (node: any): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.text === name) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(found, `actual ${name}`)
  const declaration = ts.isVariableDeclaration(found) ? `const ${found.getText(tree)}` : found.getText(tree)
  const compiled = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(dependencies), 'exports', `${compiled};return ${name}`)(...Object.values(dependencies), {})
}
const http = read('../src/api/http.ts')
const createApiError = load(http, 'createApiError', {
  isTransientGatewayError: load(http, 'isTransientGatewayError', {
    TRANSIENT_GATEWAY_STATUSES: load(http, 'TRANSIENT_GATEWAY_STATUSES'),
  }),
})
const source = read('../src/components/review/ReviewQueue.tsx')
const transport = read('../src/api/reviewQueueTransport.ts')
const branchRow = { id: 31, section: 'branches', action_type: 'update', entity_type: 'branch', status: 'open' }
const english = {
  branch_approval_unknown_outcome: 'The result could not be confirmed. Retry the same approval request.',
  branch_approval_review_permission_revoked: 'Your permission to review has changed. This approval may already have completed. Refresh the review queue.',
  branch_approval_request_permission_revoked: 'The requester no longer has permission to edit branches.',
  branch_edit_conflict: 'This branch edit can no longer be verified. Refresh Branches and submit a new edit.',
  branch_review_schema_required: 'Branch review is not ready. Refresh after the update and try again.',
}
function fixture(language: 'en' | 'km', response: unknown, error?: Error) {
  const pack = JSON.parse(read(`../src/lang/${language}.json`))
  const effects = { calls: [] as string[], notices: [] as unknown[][], loads: 0, busy: [] as unknown[], locks: { current: new Set<string>() } }
  const approvePendingAction = load(transport, 'approvePendingAction', {
    route: (_key: unknown, remote: () => unknown) => remote(),
    apiFetch: async (_method: string, url: string) => { effects.calls.push(url); if (error) throw error; return response },
  })
  const run = load(source, 'handleApprove', {
    canReview: true, actionRef: effects.locks, beginKeyedAction, finishKeyedAction,
    setBusyId: (id: unknown) => effects.busy.push(id), approvePendingAction,
    withLoaderTimeout: (loader: () => unknown) => loader(), REVIEW_MUTATION_TIMEOUT_MS: 12000,
    notify: (...args: unknown[]) => effects.notices.push(args),
    tr: (key: string, fallback: string) => pack[key] || fallback,
    load: async () => { effects.loads++ }, ...branchErrors,
  })
  return { run, effects, pack, setOutcome(nextResponse: unknown, nextError?: Error) { response = nextResponse; error = nextError } }
}
let failed = 0
async function check(name: string, body: () => Promise<void> | void) {
  try { await body(); console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}
for (const language of ['en', 'km'] as const) {
  for (const [code, status, key] of [
    ['unknown_outcome', 503, 'branch_approval_unknown_outcome'],
    ['review_permission_revoked', 403, 'branch_approval_review_permission_revoked'],
    ['request_permission_revoked', 409, 'branch_approval_request_permission_revoked'],
    ['branch_edit_conflict', 409, 'branch_edit_conflict'],
    ['branch_review_schema_required', 409, 'branch_review_schema_required'],
  ] as const) {
    await check(`${language} actual branch approval ${code} localizes without success or optimistic apply`, async () => {
      const error = createApiError(status, { error: english[key], code, ...(code === 'unknown_outcome' ? { action: 'retry_same_request' } : {}) }, '')
      const { run, effects, pack } = fixture(language, null, error)
      const row = { ...branchRow }
      await run(row)
      await run(row)
      assert.ok(typeof pack[key] === 'string' && pack[key].trim())
      if (language === 'en') assert.equal(pack[key], english[key])
      assert.equal(effects.notices[0][0], pack[key])
      assert.ok(effects.notices.every(notice => notice[1] === 'error'))
      assert.deepEqual(effects.calls, ['/api/review/31/approve', '/api/review/31/approve'])
      assert.deepEqual(row, branchRow)
      assert.equal(effects.loads, 0)
      assert.equal(effects.locks.current.size, 0)
      assert.equal(effects.busy.at(-1), null)
    })
  }
  await check(`${language} ordinary and replayed approved receipts succeed; 202 does not claim application`, async () => {
    for (const replayed of [false, true]) {
      const { run, effects } = fixture(language, { success: true, data: { ...branchRow, status: 'approved' }, replayed })
      await run(branchRow)
      assert.equal(effects.notices[0][1], 'success')
      assert.equal(effects.loads, 1)
    }
    const { run, effects, pack } = fixture(language, { success: true, pending: true, data: branchRow })
    await run(branchRow)
    assert.equal(effects.notices[0][0], pack.branch_approval_unknown_outcome)
    assert.equal(effects.notices[0][1], 'error')
    assert.equal(effects.loads, 0)
    const genericRow = { ...branchRow, section: 'products', entity_type: 'product' }
    const generic = fixture(language, { success: true, pending: true, data: genericRow })
    await generic.run(genericRow)
    assert.equal(generic.effects.notices[0][1], 'success', 'branch receipt guard must not change generic queue behavior')
    assert.equal(generic.effects.loads, 1)
  })
  await check(`${language} retry after unknown outcome uses the same approval ID and accepts its recovered receipt`, async () => {
    const flow = fixture(language, null, createApiError(503, { error: english.branch_approval_unknown_outcome, code: 'unknown_outcome', action: 'retry_same_request' }, ''))
    await flow.run(branchRow)
    flow.setOutcome({ success: true, data: { ...branchRow, status: 'approved' }, replayed: true })
    await flow.run(branchRow)
    assert.deepEqual(flow.effects.calls, ['/api/review/31/approve', '/api/review/31/approve'])
    assert.deepEqual(flow.effects.notices.map(notice => notice[1]), ['error', 'success'])
    assert.equal(flow.effects.loads, 1)
  })
  await check(`${language} unknown branch errors and other queue entities keep exact messages`, async () => {
    for (const row of [branchRow, { ...branchRow, section: 'products', entity_type: 'product' }, { ...branchRow, action_type: 'create' }, { ...branchRow, entity_type: 'product' }]) {
      const payload = row === branchRow
        ? { error: 'Unknown approval refusal', code: 'future_refusal' }
        : { error: english.branch_approval_unknown_outcome, code: 'unknown_outcome' }
      const { run, effects } = fixture(language, null, createApiError(503, payload, ''))
      await run(row)
      assert.equal(effects.notices[0][0], payload.error)
      assert.equal(effects.notices[0][1], 'error')
    }
  })
  await check(`${language} exact legacy approval messages and current reviewer Forbidden preserve uncertainty`, async () => {
    for (const key of ['branch_approval_unknown_outcome', 'branch_approval_review_permission_revoked', 'branch_approval_request_permission_revoked'] as const) {
      const { run, effects, pack } = fixture(language, null, createApiError(409, { error: english[key] }, ''))
      await run(branchRow)
      assert.equal(effects.notices[0][0], pack[key])
    }
    const { run, effects, pack } = fixture(language, null, createApiError(403, { error: 'Forbidden' }, ''))
    await run(branchRow)
    assert.equal(effects.notices[0][0], pack.branch_approval_review_permission_revoked)
    assert.equal(effects.notices[0][1], 'error')
  })
}
await check('generic queue primitive and structured failures retain prior notification formatting', () => {
  const row = { ...branchRow, section: 'products' }
  for (const error of [false, 0, null, undefined, { error: 'specific' }, 'specific']) {
    assert.equal(branchErrors.localizeBranchReviewError(row, error, () => 'translated'), String(error || ''))
  }
})
if (failed) process.exitCode = 1
