import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'
import * as branchErrors from '../src/api/branchRuleErrors.ts'
import { replayBranchEdit } from '../src/components/branches/branchHistoryReplay.ts'
import { resolveReplayAction } from '../src/utils/actionReplay.ts'
import { withLoaderTimeout } from '../src/utils/loaders.ts'
import { withWriteTimeout } from '../src/utils/writeIntent.ts'

const ts = createRequire(new URL('../../cloudflare/package.json', import.meta.url))('typescript')
const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')
const formSource = read('../src/components/branches/BranchForm.tsx')
const pageSource = read('../src/components/branches/Branches.tsx')
function declaration(source: string, name: string): string {
  const tree = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: any
  const visit = (node: any): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.text === name) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(found, `actual ${name} declaration exists`)
  return ts.isVariableDeclaration(found) ? `const ${found.getText(tree)}` : found.getText(tree)
}
function load(source: string, name: string, dependencies: Record<string, unknown> = {}): any {
  const compiled = ts.transpileModule(declaration(source, name), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(dependencies), 'exports', `${compiled}; return ${name}`)(...Object.values(dependencies), {})
}
const initial = load(formSource, 'initialBranchForm')
const restore = load(formSource, 'restoreBranchForm')
const httpSource = read('../src/api/http.ts')
const createApiError = load(httpSource, 'createApiError', {
  isTransientGatewayError: load(httpSource, 'isTransientGatewayError', {
    TRANSIENT_GATEWAY_STATUSES: load(httpSource, 'TRANSIENT_GATEWAY_STATUSES'),
  }),
})
const branch = { id: 2, name: 'Old Shop', location: 'A', phone: '', manager: '', notes: 'saved', is_active: 0, is_default: 0, updated_at: 'same second', edit_etag: 'original' }
let failed = 0
async function check(name: string, run: () => unknown | Promise<unknown>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}
function formSave(outcome: unknown) {
  const effects = { cleared: 0, closed: 0, saved: { current: false }, dirty: { current: true }, restored: { current: { data: { notes: 'unsaved' } } as unknown } }
  const run = load(formSource, 'handleSave', {
    setSaving: () => {}, onSave: async () => typeof outcome === 'function' ? outcome() : outcome, form: { notes: 'unsaved' },
    savedRef: effects.saved, dirtyRef: effects.dirty, restoredDraftRef: effects.restored,
    clearWorkDraft: () => { effects.cleared++ }, draftKey: 'branch_2', onClose: () => { effects.closed++ },
  })
  return { effects, run }
}
function pageSave(response: unknown, error?: Error, language?: 'en' | 'km', dependencies: Record<string, unknown> = {}) {
  const pack = language ? JSON.parse(read(`../src/lang/${language}.json`)) : {}
  const effects = { sent: [] as any[], history: [] as any[], closed: 0, notices: [] as unknown[], replay: [] as any[] }
  const run = load(pageSource, 'handleSaveBranch', {
    selected: { ...branch, edit_etag: 'current' }, user: { id: 7, name: 'Editor' }, saveInFlightRef: { current: false },
    beginSingleAction: () => true, finishSingleAction: () => {},
    cloneHistorySnapshot: (value: unknown) => JSON.parse(JSON.stringify(value)),
    runBranchMutation: (fn: () => unknown) => fn(), branchApi: { updateBranch: async (_id: unknown, payload: unknown) => {
      effects.sent.push(payload); if (error) throw error; return response
    } },
    notify: (...args: unknown[]) => effects.notices.push(args), tr: (key: string, fallback: string) => pack[key] || fallback,
    getErrorMessage: (value: unknown, fallback: string) => (value as Error)?.message || fallback,
    ...branchErrors,
    buildBranchPayload: (value: unknown) => value,
    actionHistory: { pushAction: (value: unknown) => effects.history.push(value) },
    branchReplayRequest: (direction: string, fields: unknown, expected: unknown) => ({ direction, fields, expected }),
    replayBranchEdit: async (request: any) => { effects.replay.push(JSON.parse(JSON.stringify(request))); return { ...request.fields, edit_etag: request.direction + '-committed' } },
    setModal: () => { effects.closed++ }, setSelected: () => {}, load: async () => {},
    ...dependencies,
  })
  return { effects, run }
}

await check('form captures the server content token when opened', () => {
  assert.equal(initial(branch).expectedEditEtag, 'original')
})
await check('minimized draft retains its original token when current row changed in the same second', () => {
  const restored = restore(initial({ ...branch, edit_etag: 'newer' }), { ...initial(branch), notes: 'draft' })
  assert.equal(restored.expectedEditEtag, 'original')
  assert.equal(restored.notes, 'draft')
})
await check('legacy draft without a token never inherits the new row token', () => {
  const restored = restore(initial({ ...branch, edit_etag: 'newer' }), { notes: 'old draft' })
  assert.equal(restored.expectedEditEtag, '')
  assert.equal(restored.notes, 'old draft')
})
await check('draft reader does not discard stale input by updated_at before showing conflict', () => {
  const component = declaration(formSource, 'BranchForm')
  assert.doesNotMatch(component, /notOlderThanMs/)
})
await check('false save result keeps modal, draft and dirty state', async () => {
  const { run, effects } = formSave(false)
  await run()
  assert.equal(effects.closed, 0)
  assert.equal(effects.cleared, 0)
  assert.equal(effects.saved.current, false)
  assert.equal(effects.dirty.current, true)
  assert.notEqual(effects.restored.current, null)
})
await check('true save result clears exactly once and closes', async () => {
  const { run, effects } = formSave(true)
  await run()
  assert.equal(effects.closed, 1)
  assert.equal(effects.cleared, 1)
  assert.equal(effects.saved.current, true)
})
await check('caught branch conflict returns false and records no applied history', async () => {
  const conflict = Object.assign(new Error('This branch edit can no longer be verified. Refresh Branches and submit a new edit.'), { code: 'branch_edit_conflict', conflict: true, status: 409 })
  const { run, effects } = pageSave(null, conflict)
  assert.equal(await run({ ...initial(branch), expectedEditEtag: 'original' }), false)
  assert.equal(effects.closed, 0)
  assert.equal(effects.history.length, 0)
  assert.equal(effects.sent[0].expectedEditEtag, 'original')
})
await check('resolved failure returns false and cannot clear the form', async () => {
  const { run, effects } = pageSave({ success: false, error: 'Denied' })
  assert.equal(await run({ ...initial(branch), expectedEditEtag: 'original' }), false)
  assert.equal(effects.history.length, 0)
})
await check('missing captured token refuses without sending a write', async () => {
  const { run, effects } = pageSave({ success: true })
  assert.equal(await run({ ...initial(branch), expectedEditEtag: '' }), false)
  assert.equal(effects.sent.length, 0)
  assert.equal(effects.history.length, 0)
})
await check('review 202 is successful submission with no local applied Undo', async () => {
  const { run, effects } = pageSave({ success: true, pending: true, pendingActionId: 44 })
  assert.equal(await run({ ...initial(branch), expectedEditEtag: 'original' }), true)
  assert.equal(effects.history.length, 0)
  assert.ok(JSON.stringify(effects.notices).includes('Submitted for review'))
})
await check('successful save stores committed token and each local replay records its returned token', async () => {
  const { run, effects } = pageSave({ success: true, branch: { ...branch, notes: 'saved edit', edit_etag: 'committed' } })
  assert.equal(await run({ ...initial(branch), expectedEditEtag: 'original', notes: 'saved edit' }), true)
  assert.equal(effects.history.length, 1)
  await effects.history[0].undo()
  assert.equal(effects.replay[0].expected.edit_etag, 'committed')
  await effects.history[0].redo()
  assert.equal(effects.replay[1].expected.edit_etag, 'undo-committed')
  await effects.history[0].undo()
  assert.equal(effects.replay[2].expected.edit_etag, 'redo-committed')
})
await check('both new server errors localize by code and exact fallback in both packs', () => {
  const messages = {
    branch_edit_conflict: 'This branch edit can no longer be verified. Refresh Branches and submit a new edit.',
    branch_review_schema_required: 'Branch review is not ready. Refresh after the update and try again.',
  }
  for (const language of ['en', 'km']) {
    const pack = JSON.parse(read(`../src/lang/${language}.json`))
    for (const [code, message] of Object.entries(messages)) {
      assert.ok(typeof pack[code] === 'string' && pack[code].trim())
      if (language === 'en') assert.equal(pack[code], message)
      assert.equal(localizeBranchRuleError({ code, message }, key => pack[key]), pack[code])
      assert.equal(localizeBranchRuleError(message, key => pack[key]), pack[code])
    }
  }
})
for (const language of ['en', 'km'] as const) {
  const pack = JSON.parse(read(`../src/lang/${language}.json`))
  for (const [label, status, payload, key] of [
    ['legacy permission', 403, { error: 'You do not have permission to perform this action' }, 'permission_denied'],
    ['coded permission', 403, { error: 'Permission changed', code: 'permission_denied' }, 'permission_denied'],
    ['timestamp conflict', 409, { error: 'This branch changed on another device. Refresh and try again.', code: 'write_conflict', conflict: true, entity: 'branch' }, 'branch_edit_conflict'],
    ['legacy timestamp conflict', 409, { error: 'This branch changed on another device. Refresh and try again.' }, 'branch_edit_conflict'],
    ['content conflict', 409, { error: 'This branch edit can no longer be verified. Refresh Branches and submit a new edit.', code: 'branch_edit_conflict', conflict: true }, 'branch_edit_conflict'],
  ] as const) {
    await check(`actual API error through ${language} save localizes ${label} and preserves draft`, async () => {
      const error = createApiError(status, payload, '')
      const page = pageSave(null, error, language)
      const form = formSave(() => page.run(initial(branch)))
      await form.run()
      assert.equal((page.effects.notices[0] as unknown[])[0], pack[key])
      assert.equal(form.effects.cleared, 0)
      assert.equal(form.effects.closed, 0)
      assert.equal(form.effects.dirty.current, true)
      assert.equal(page.effects.history.length, 0)
    })
  }
}
await check('unknown save errors retain their exact message; shared branch-rule callers are unchanged', async () => {
  for (const payload of [
    { error: 'Unrecognized server fault', code: 'future_server_fault' },
    { error: 'You do not have permission to perform this action on a locked batch' },
    { error: 'This product changed on another device. Refresh and try again.' },
  ]) {
    const page = pageSave(null, createApiError(409, payload, ''), 'km')
    assert.equal(await page.run(initial(branch)), false)
    assert.equal((page.effects.notices[0] as unknown[])[0], payload.error)
  }
  const english = 'You do not have permission to perform this action'
  assert.equal(localizeBranchRuleError(english, () => 'translation'), english)
  const timestamp = createApiError(409, { error: 'This branch changed on another device. Refresh and try again.', code: 'write_conflict' }, '')
  assert.equal(localizeBranchRuleError(timestamp, () => 'translation'), timestamp.message)
})
async function replayWorkflow(language: 'en' | 'km', direction: 'undo' | 'redo') {
  const pack = JSON.parse(read(`../src/lang/${language}.json`))
  let row = { ...branch }
  let token = 0
  let rejection: Error | undefined
  let queued = false
  const notices: unknown[][] = []
  let undoStack: any[] = []
  let redoStack: any[] = []
  const tr = (key: string, fallback: string) => pack[key] || fallback
  const api = {
    getBranches: async () => [{ ...row }],
    updateBranch: async (_id: unknown, body: any) => {
      if (rejection) throw rejection
      if (queued) return { success: true, pending: true }
      row = { ...row, notes: body.notes, edit_etag: `committed-${++token}` }
      return { success: true, branch: { ...row } }
    },
  }
  const buildBranchPayload = load(pageSource, 'buildBranchPayload', { useCallback: (fn: unknown) => fn, user: { id: 7, name: 'Editor' } })
  const branchReplayRequest = load(pageSource, 'branchReplayRequest', {
    useCallback: (fn: unknown) => fn, branchApi: api, buildBranchPayload, tr,
    runBranchMutation: (fn: () => unknown) => fn(), withLoaderTimeout: (fn: () => unknown) => fn(),
    BRANCHES_LIST_TIMEOUT_MS: 12000, isBranchRecord: load(pageSource, 'isBranchRecord'), ...branchErrors,
  })
  const page = pageSave(null, undefined, language, {
    selected: { ...branch }, branchApi: api, buildBranchPayload, branchReplayRequest, replayBranchEdit,
    actionHistory: { pushAction: (entry: any) => { undoStack.push({ ...entry, id: 1 }) } },
  })
  assert.equal(await page.run({ ...initial(branch), notes: 'committed edit' }), true)
  const historySource = read('../src/utils/actionHistory.ts')
  const run = (action: 'undo' | 'redo') => load(historySource, 'runEntry', {
    useCallback: (fn: unknown) => fn, undoStack, redoStack, busy: '', limit: 10,
    setBusy: () => {}, refreshServerItems: () => {}, resolveReplayAction,
    setUndoStack: (update: (current: any[]) => any[]) => { undoStack = update(undoStack) },
    setRedoStack: (update: (current: any[]) => any[]) => { redoStack = update(redoStack) },
    notify: (...args: unknown[]) => notices.push(args), getErrorMessage: load(historySource, 'getErrorMessage'),
  })(action)
  if (direction === 'redo') assert.equal(await run('undo'), true)
  return {
    pack, notices, run, get row() { return row },
    get entry() { return (direction === 'undo' ? undoStack : redoStack)[0] },
    reject(error: Error) { rejection = error }, queue() { queued = true },
  }
}
for (const language of ['en', 'km'] as const) {
  for (const direction of ['undo', 'redo'] as const) {
    for (const kind of ['permission', 'timestamp'] as const) {
      await check(`actual successful save then ${language} local ${direction} ${kind} refusal reaches translated history notification`, async () => {
        const flow = await replayWorkflow(language, direction)
        const error = kind === 'permission'
          ? createApiError(403, { error: 'You do not have permission to perform this action' }, '')
          : createApiError(409, { error: 'This branch changed on another device. Refresh and try again.', code: 'write_conflict', conflict: true }, '')
        flow.reject(error)
        const before = { ...flow.row }
        const key = kind === 'permission' ? 'permission_denied' : `${direction}_refused_record_changed`
        assert.equal(await flow.run(direction), false)
        assert.equal(flow.notices[0][0], flow.pack[key])
        assert.deepEqual(flow.row, before)
        assert.ok(flow.entry, 'refused replay keeps its original history stack')
        await assert.rejects(flow.entry[direction](), (caught: any) => {
          assert.equal(caught.status, error.status)
          assert.equal(caught.code, error.code)
          assert.ok(caught === error || caught.cause, 'localized wrapper preserves the original error chain')
          return true
        })
      })
    }
  }
}
await check('unknown replay error remains the original error and queued replay cannot move local history', async () => {
  for (const direction of ['undo', 'redo'] as const) {
    const flow = await replayWorkflow('km', direction)
    const error = createApiError(503, { error: 'Unknown upstream failure', code: 'future_failure' }, '')
    flow.reject(error)
    await assert.rejects(flow.entry[direction](), (caught: unknown) => caught === error)
    assert.equal(await flow.run(direction), false)
    assert.equal(flow.notices[0][0], error.message)
    const queued = await replayWorkflow('km', direction)
    queued.queue()
    const before = { ...queued.row }
    assert.equal(await queued.run(direction), false)
    assert.deepEqual(queued.row, before)
    assert.ok(queued.entry)
  }
})
const unknownBranchEdit = 'The result of this branch edit could not be confirmed. It may have been saved. Refresh Branches and check the details before making another edit.'
for (const language of ['en', 'km'] as const) {
  await check(`${language} actual direct 503 and network unknown preserve captured draft and never claim application`, async () => {
    const pack = JSON.parse(read(`../src/lang/${language}.json`))
    const errors = [
      createApiError(503, { error: unknownBranchEdit, code: 'branch_edit_outcome_unknown', outcome: 'unknown', action: 'refresh_before_edit' }, ''),
      Object.assign(new TypeError('Failed to fetch'), { code: 'write_outcome_unknown', outcome: 'unknown' }),
      Object.assign(new Error('Request timed out after 45s'), { code: 'request_timeout', outcome: 'unknown' }),
    ]
    for (const error of errors) {
      const page = pageSave(null, error, language)
      const draft = initial(branch)
      const form = formSave(() => page.run(draft))
      await form.run()
      assert.ok(pack.branch_edit_outcome_unknown)
      assert.equal((page.effects.notices[0] as unknown[])[0], pack.branch_edit_outcome_unknown)
      assert.equal(form.effects.closed, 0)
      assert.equal(form.effects.cleared, 0)
      assert.equal(form.effects.dirty.current, true)
      assert.equal(page.effects.history.length, 0)
      assert.equal(page.effects.sent.length, 1)
      assert.equal(page.effects.sent[0].expectedEditEtag, 'original')
      assert.equal(draft.expectedEditEtag, 'original')
    }
    if (language === 'en') assert.equal(pack.branch_edit_outcome_unknown, unknownBranchEdit)
  })
  await check(`${language} actual mutation deadline reports uncertainty while its single write can commit late`, async () => {
    const pack = JSON.parse(read(`../src/lang/${language}.json`))
    const tr = (key: string, fallback: string) => pack[key] || fallback
    const mutate = load(pageSource, 'runBranchMutation', { useCallback: (fn: unknown) => fn, withLoaderTimeout, withWriteTimeout, BRANCH_MUTATION_TIMEOUT_MS: 12000, tr })
    const timers: Array<{ fire: () => void; ms: number }> = []
    const originalSet = globalThis.setTimeout
    const originalClear = globalThis.clearTimeout
    let complete!: () => void
    let calls = 0
    let commits = 0
    let caught: any
    try {
      globalThis.setTimeout = ((fire: () => void, ms: number) => { timers.push({ fire, ms }); return 1 }) as any
      globalThis.clearTimeout = (() => {}) as any
      const page = pageSave(null, undefined, language, {
        runBranchMutation: async (loader: () => Promise<unknown>, label: string) => { try { return await mutate(loader, label) } catch (error) { caught = error; throw error } },
        branchApi: { updateBranch: async () => { calls++; return new Promise(resolve => {
          complete = () => { commits++; resolve({ success: true, branch: { ...branch, edit_etag: 'late-committed' } }) }
        }) } },
      })
      const draft = initial(branch)
      const form = formSave(() => page.run(draft))
      const saved = form.run()
      assert.equal(timers.length, 1)
      assert.equal(timers[0].ms, 12000)
      timers[0].fire()
      await saved
      assert.equal(caught.code, 'loader_timeout')
      assert.equal(caught.outcome, 'unknown')
      assert.equal(caught.timeoutMs, 12000)
      assert.equal((page.effects.notices[0] as unknown[])[0], pack.branch_edit_outcome_unknown)
      complete()
      await Promise.resolve()
      assert.equal(calls, 1)
      assert.equal(commits, 1)
      assert.equal(form.effects.closed, 0)
      assert.equal(form.effects.cleared, 0)
      assert.equal(form.effects.dirty.current, true)
      assert.equal(draft.expectedEditEtag, 'original')
      assert.equal(page.effects.history.length, 0)
    } finally {
      globalThis.setTimeout = originalSet
      globalThis.clearTimeout = originalClear
    }
  })
  await check(`${language} local replay uncertainty preserves its history entry and expected state`, async () => {
    for (const direction of ['undo', 'redo'] as const) {
      const flow = await replayWorkflow(language, direction)
      const before = { ...flow.row }
      const entry = flow.entry
      const error = Object.assign(createApiError(503, { error: unknownBranchEdit, code: 'branch_edit_outcome_unknown' }, ''), { outcome: 'unknown' })
      flow.reject(error)
      assert.equal(await flow.run(direction), false)
      assert.equal(flow.notices[0][0], flow.pack.branch_edit_outcome_unknown)
      assert.deepEqual(flow.row, before)
      assert.equal(flow.entry, entry)
      await assert.rejects(flow.entry[direction](), (caught: any) => caught.code === error.code && caught.status === 503 && caught.outcome === 'unknown')
    }
  })
}
if (failed) process.exitCode = 1
