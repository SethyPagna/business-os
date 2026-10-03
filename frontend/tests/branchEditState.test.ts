import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'

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
const branch = { id: 2, name: 'Old Shop', location: 'A', phone: '', manager: '', notes: 'saved', is_active: 0, is_default: 0, updated_at: 'same second', edit_etag: 'original' }
let failed = 0
async function check(name: string, run: () => unknown | Promise<unknown>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}
function formSave(outcome: unknown) {
  const effects = { cleared: 0, closed: 0, saved: { current: false }, dirty: { current: true }, restored: { current: { data: { notes: 'unsaved' } } as unknown } }
  const run = load(formSource, 'handleSave', {
    setSaving: () => {}, onSave: async () => outcome, form: { notes: 'unsaved' },
    savedRef: effects.saved, dirtyRef: effects.dirty, restoredDraftRef: effects.restored,
    clearWorkDraft: () => { effects.cleared++ }, draftKey: 'branch_2', onClose: () => { effects.closed++ },
  })
  return { effects, run }
}
function pageSave(response: unknown, error?: Error) {
  const effects = { sent: [] as any[], history: [] as any[], closed: 0, notices: [] as unknown[], replay: [] as any[] }
  const run = load(pageSource, 'handleSaveBranch', {
    selected: { ...branch, edit_etag: 'current' }, user: { id: 7, name: 'Editor' }, saveInFlightRef: { current: false },
    beginSingleAction: () => true, finishSingleAction: () => {},
    cloneHistorySnapshot: (value: unknown) => JSON.parse(JSON.stringify(value)),
    runBranchMutation: (fn: () => unknown) => fn(), branchApi: { updateBranch: async (_id: unknown, payload: unknown) => {
      effects.sent.push(payload); if (error) throw error; return response
    } },
    notify: (...args: unknown[]) => effects.notices.push(args), tr: (_key: string, fallback: string) => fallback,
    getErrorMessage: (value: unknown, fallback: string) => (value as Error)?.message || fallback,
    localizeBranchRuleError: (value: unknown) => (value as Error)?.message || String(value),
    branchRuleErrorKey: () => null,
    buildBranchPayload: (value: unknown) => value,
    actionHistory: { pushAction: (value: unknown) => effects.history.push(value) },
    branchReplayRequest: (direction: string, fields: unknown, expected: unknown) => ({ direction, fields, expected }),
    replayBranchEdit: async (request: any) => { effects.replay.push(JSON.parse(JSON.stringify(request))); return { ...request.fields, edit_etag: request.direction + '-committed' } },
    setModal: () => { effects.closed++ }, setSelected: () => {}, load: async () => {},
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
if (failed) process.exitCode = 1
