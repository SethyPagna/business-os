// Undo / Redo refused 409 undo_history_stale: the server row is not in the state this tab thinks it is, because another
// session's Undo or Redo got there first. Nothing may be written over that session's result.
// The REAL useActionHistory hook is mounted (tests/actionHistoryHost.ts) over a transport whose answers the test controls.
//
//   stale refusal   no status is written; the recorded list is re-read; the operator is told (the transport's message);
//                   the tab's own copy of the entry is dropped, so Undo is not offered again for a record it can no longer
//                   undo -- on the Undo path, the Redo path, and the recorded-list (server) path
//   controls        every OTHER failure still behaves as it did: a refusal before the server flipped marks 'failed'; a
//                   closure that fails AFTER the server flipped restores the status it flipped from
import assert from 'node:assert/strict'
import { createHarness, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const harness = await createHarness()
let failed = 0

const refusal = (status: number, code: string | null, message: string) => Object.assign(new Error(message), { status, code })
const STALE_MESSAGE = 'This history entry is out of date, so Undo was refused. Refresh the history and try again. Nothing was changed.'
const user = { id: 1, username: 'owner', role_code: 'cashier', role_permissions: { products: true } }

type Calls = { reads: number; updates: unknown[][]; undone: unknown[][]; redone: unknown[][]; created: number }
type Script = {
  undo?: () => Promise<unknown>
  redo?: () => Promise<unknown>
  recorded?: Array<Record<string, unknown>>
}

async function mount(script: Script, closures: { undo: () => unknown; redo: () => unknown } = { undo: () => 'closure-undo', redo: () => 'closure-redo' }) {
  const calls: Calls = { reads: 0, updates: [], undone: [], redone: [], created: 0 }
  const notices: Array<{ message: string; type?: string }> = []
  const surface = await harness.mount({
    component: '../tests/actionHistoryHost.ts',
    props: { notify: (message: string, type?: string) => { notices.push({ message, type }) }, user, entry: { label: 'Rename unit', ...closures }, recordedServerId: 91 },
    app: { page: 'products' },
    doubles: {
      'api/actionHistoryTransport.ts': {
        getActionHistory: async () => { calls.reads += 1; return { items: script.recorded ?? [] } },
        getActionHistoryUsers: async () => [],
        createActionHistory: async () => { calls.created += 1; return { id: 77 } },
        updateActionHistory: async (...args: unknown[]) => { calls.updates.push(args); return { success: true } },
        undoActionHistory: async (...args: unknown[]) => { calls.undone.push(args); return script.undo ? script.undo() : { success: true, applied: false } },
        redoActionHistory: async (...args: unknown[]) => { calls.redone.push(args); return script.redo ? script.redo() : { success: true, applied: false } },
      },
    },
  })
  return { surface, calls, notices }
}

const press = (surface: MountedSurface, name: string): Promise<void> => surface.click(surface.find((node: MemoryNode) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === name, `${name} button`))
const stateOf = (surface: MountedSurface): { canUndo: boolean; canRedo: boolean; busy: string; recorded: string[] } => JSON.parse(surface.find((node: MemoryNode) => node.getAttribute('data-state') !== null, 'state').textContent)

async function ready(ctx: Awaited<ReturnType<typeof mount>>): Promise<void> {
  await press(ctx.surface, 'load')
  await press(ctx.surface, 'push')
  await ctx.surface.waitFor(() => ctx.calls.created === 1 && stateOf(ctx.surface).canUndo, 'the pushed action')
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

try {
  await check('Undo refused stale: nothing is written to the row, the list is re-read, the dead entry is dropped', async () => {
    const ctx = await mount({ undo: async () => { throw refusal(409, 'undo_history_stale', STALE_MESSAGE) } })
    try {
      await ready(ctx)
      const readsBefore = ctx.calls.reads
      await press(ctx.surface, 'undo')
      assert.equal(ctx.calls.undone.length, 1)
      assert.deepEqual(ctx.calls.updates, [], "the other session's result is not overwritten with 'failed'")
      assert.ok(ctx.calls.reads > readsBefore, 'the recorded history was re-read')
      assert.deepEqual(ctx.notices, [{ message: STALE_MESSAGE, type: 'error' }], 'and the operator is told')
      assert.equal(stateOf(ctx.surface).canUndo, false, 'Undo is not offered again for an entry this tab can no longer undo')
      assert.equal(stateOf(ctx.surface).canRedo, false, 'and it did not move to Redo')
    } finally { await ctx.surface.unmount() }
  })

  await check('Redo refused stale: the same, on the Redo path', async () => {
    const ctx = await mount({ redo: async () => { throw refusal(409, 'undo_history_stale', STALE_MESSAGE) } })
    try {
      await ready(ctx)
      await press(ctx.surface, 'undo')
      await ctx.surface.waitFor(() => stateOf(ctx.surface).canRedo, 'the entry on the Redo stack')
      ctx.calls.updates.length = 0
      const readsBefore = ctx.calls.reads
      await press(ctx.surface, 'redo')
      assert.equal(ctx.calls.redone.length, 1)
      assert.deepEqual(ctx.calls.updates, [], "the other session's result is not overwritten with 'failed'")
      assert.ok(ctx.calls.reads > readsBefore, 'the recorded history was re-read')
      assert.equal(ctx.notices.at(-1)?.message, STALE_MESSAGE)
      assert.equal(stateOf(ctx.surface).canRedo, false)
      assert.equal(stateOf(ctx.surface).canUndo, false)
    } finally { await ctx.surface.unmount() }
  })

  await check('recorded-list Undo refused stale: the list is re-read so the dead row stops being offered', async () => {
    const recorded = [{ id: 91, label: 'Other tab rename', status: 'undoable', server_replayable: true, undo_payload: { applier: 'unit.rename' }, redo_payload: {} }]
    const ctx = await mount({ undo: async () => { throw refusal(409, 'undo_history_stale', STALE_MESSAGE) }, recorded })
    try {
      await press(ctx.surface, 'load')
      await ctx.surface.waitFor(() => stateOf(ctx.surface).recorded.length === 1, 'the recorded row')
      const readsBefore = ctx.calls.reads
      await press(ctx.surface, 'undo-recorded')
      assert.equal(ctx.calls.undone.length, 1)
      assert.deepEqual(ctx.calls.updates, [])
      assert.ok(ctx.calls.reads > readsBefore, 'the recorded history was re-read')
      assert.equal(ctx.notices.at(-1)?.message, STALE_MESSAGE)
    } finally { await ctx.surface.unmount() }
  })

  await check('control: a refusal that is NOT stale still marks the row failed (unchanged behaviour)', async () => {
    for (const error of [refusal(409, 'undo_record_changed', 'The record changed.'), refusal(500, null, 'Internal error'), refusal(404, null, 'Action history item not found')]) {
      const ctx = await mount({ undo: async () => { throw error } })
      try {
        await ready(ctx)
        await press(ctx.surface, 'undo')
        await ctx.surface.waitFor(() => ctx.calls.updates.length === 1, `the failed marker for ${error.message}`)
        assert.deepEqual(ctx.calls.updates[0], [77, { status: 'failed', last_error: error.message }], `${error.message}: marked failed`)
        assert.equal(ctx.notices.at(-1)?.message, error.message)
      } finally { await ctx.surface.unmount() }
    }
  })

  await check('control: a closure that fails AFTER the server flipped the row restores the status it flipped from', async () => {
    const ctx = await mount({ undo: async () => ({ success: true, applied: false }) }, { undo: () => { throw new Error('closure failed') }, redo: () => 'closure-redo' })
    try {
      await ready(ctx)
      await press(ctx.surface, 'undo')
      await ctx.surface.waitFor(() => ctx.calls.updates.length === 1, 'the restore of the flipped status')
      assert.deepEqual(ctx.calls.updates[0], [77, { status: 'undoable', last_error: 'closure failed' }])
      assert.equal(ctx.notices.at(-1)?.message, 'closure failed')
    } finally { await ctx.surface.unmount() }
  })

  await check('control: a stale code from the CLOSURE (after the server flipped) is not the other session; the flipped status is restored', async () => {
    const ctx = await mount({ undo: async () => ({ success: true, applied: false }) }, { undo: () => { throw refusal(409, 'undo_history_stale', STALE_MESSAGE) }, redo: () => 'closure-redo' })
    try {
      await ready(ctx)
      await press(ctx.surface, 'undo')
      await ctx.surface.waitFor(() => ctx.calls.updates.length === 1, 'the restore of the flipped status')
      assert.deepEqual(ctx.calls.updates[0], [77, { status: 'undoable', last_error: STALE_MESSAGE }])
    } finally { await ctx.surface.unmount() }
  })

  await check('control: a successful Undo still moves the entry to Redo and writes nothing', async () => {
    const ctx = await mount({})
    try {
      await ready(ctx)
      await press(ctx.surface, 'undo')
      await ctx.surface.waitFor(() => stateOf(ctx.surface).canRedo, 'the entry on the Redo stack')
      assert.equal(stateOf(ctx.surface).canUndo, false)
      assert.equal(ctx.notices.length, 0)
    } finally { await ctx.surface.unmount() }
  })
} finally {
  await harness.close()
}

if (failed) process.exit(1)
