import assert from 'node:assert/strict'
import { createHarness, expireWaitsSince, propsOf, timerMark } from './mountedComponentHarness.ts'

// E4 (G39 item 7). useActionHistory read /api/action-history (and
// /api/action-history/users for an admin) 2.5 s after every page activation on
// eleven pages, although nothing shows the recorded list until the History
// control is used. The real Manage Units surface is mounted (it uses the hook
// and ActionHistoryBar exactly like the pages do) and the reads are counted.

const harness = await createHarness()
const words: Record<string, string> = { history: 'History', units: 'Units' }
const t = (key: string) => words[key] || key

async function mount(role: 'admin' | 'cashier') {
  const reads = { history: 0, users: 0 }
  const app = {
    t,
    page: 'products',
    user: { id: 1, username: `fixture-${role}`, role_code: role, role_permissions: role === 'admin' ? '{"all":true}' : '{"products":true}' },
    can: () => true,
    notify: () => {},
    syncChannel: null,
  }
  const mark = timerMark()
  const surface = await harness.mount({
    component: 'components/products/lookups/ManageUnitsModal.tsx',
    props: { t, onClose: () => {} },
    app,
    doubles: {
      'api/actionHistoryTransport.ts': {
        getActionHistory: async () => { reads.history += 1; return { items: [{ id: 9, label: 'Renamed unit', status: 'recorded' }] } },
        getActionHistoryUsers: async () => { reads.users += 1; return [] },
      },
    },
  })
  // Run every long timer the mount scheduled (the old 2.5 s post-paint read).
  expireWaitsSince(mark)
  await surface.settle()
  return { surface, reads }
}

function historyButton(surface: Awaited<ReturnType<typeof mount>>['surface']) {
  return surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'History', 'History button')
}

try {
  {
    const { surface, reads } = await mount('admin')
    assert.deepEqual(reads, { history: 0, users: 0 }, 'opening a surface reads no action history, even after its long timers ran')
    await surface.call(historyButton(surface), 'onMouseEnter', [])
    assert.deepEqual(reads, { history: 1, users: 1 }, 'hovering History loads the list and, for an admin, the user filter')
    await surface.call(historyButton(surface), 'onFocus', [])
    await surface.call(historyButton(surface), 'onMouseEnter', [])
    assert.deepEqual(reads, { history: 1, users: 1 }, 'repeat hovers reuse the loaded list')
    await surface.unmount()
  }
  {
    const { surface, reads } = await mount('cashier')
    assert.equal(reads.history, 0)
    await surface.call(historyButton(surface), 'onFocus', [])
    assert.deepEqual(reads, { history: 1, users: 0 }, 'keyboard focus loads it too; a non-admin never reads the user list')
    assert.equal(typeof propsOf(historyButton(surface)).onMouseEnter, 'function')
    await surface.unmount()
  }
  console.log('PASS action history loads when the History control is used, not on page activation')
} finally {
  await harness.close()
}
