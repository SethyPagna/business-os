// Owner rule: a wrong browser flag must never block a write the server would accept, and a real outage must still block, with
// the reason. The recorded-list Undo / Redo (useActionHistory.runServerEntry) refused on navigator.onLine === false alone.
// The REAL hook is mounted (tests/actionHistoryHost.ts) over a transport double:
//   - navigator.onLine false, server answering   -> the replay is sent;
//   - navigator.onLine false, server not answering -> nothing is sent and the operator is told why.
import assert from 'node:assert/strict'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const harness = await createHarness()
const browser = globalThis as unknown as { window: { navigator: { onLine: boolean } } }
const user = { id: 1, username: 'owner', role_code: 'cashier', role_permissions: { products: true } }
const recorded = [{ id: 91, label: 'Other tab rename', status: 'undoable', server_replayable: true, undo_payload: { applier: 'unit.rename' }, redo_payload: {} }]
let failed = 0

async function run(reachable: boolean): Promise<{ replays: number; asked: number; notices: string[] }> {
  const out = { replays: 0, asked: 0, notices: [] as string[] }
  const surface: MountedSurface = await harness.mount({
    component: '../tests/actionHistoryHost.ts',
    props: { notify: (message: string) => { out.notices.push(message) }, user, entry: { label: 'Rename unit', undo: () => 1, redo: () => 1 }, recordedServerId: 91 },
    app: { page: 'products' },
    doubles: {
      'api/actionHistoryTransport.ts': {
        getActionHistory: async () => ({ items: recorded }),
        getActionHistoryUsers: async () => [],
        confirmServerReachable: async () => { out.asked += 1; return reachable },
        undoActionHistory: async () => { out.replays += 1; return { success: true, applied: false } },
      },
    },
  })
  try {
    const press = (name: string) => surface.click(surface.find((node: MemoryNode) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === name, name))
    await press('load')
    await surface.waitFor(() => JSON.parse(surface.find((node: MemoryNode) => node.getAttribute('data-state') !== null, 'state').textContent).recorded.length === 1, 'the recorded row')
    await press('undo-recorded')
    await surface.settle()
  } finally { await surface.unmount() }
  return out
}

async function check(name: string, body: () => Promise<void>): Promise<void> {
  try { await body(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally { browser.window.navigator.onLine = true }
}

try {
  await check('wrong flag: navigator.onLine false while the server answers -> the recorded Undo is sent', async () => {
    browser.window.navigator.onLine = false
    const out = await run(true)
    assert.equal(out.asked, 1, 'the server was asked')
    assert.equal(out.replays, 1, 'and the replay went out')
  })
  await check('real outage: navigator.onLine false and the server not answering -> nothing is sent and the reason is shown', async () => {
    browser.window.navigator.onLine = false
    const out = await run(false)
    assert.equal(out.replays, 0)
    assert.ok(out.notices.some((message) => /Connect to the server to replay history/.test(message)), `told why: ${out.notices.join(' | ')}`)
  })
  await check('control: online, the replay goes out without asking the server', async () => {
    browser.window.navigator.onLine = true
    const out = await run(false)
    assert.equal(out.asked, 0)
    assert.equal(out.replays, 1)
  })
} finally {
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nactionHistoryWrongOnlineFlag: all checks passed')
