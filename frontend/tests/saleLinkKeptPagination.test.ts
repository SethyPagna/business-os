import assert from 'node:assert/strict'
import React from 'react'
import { createHarness } from './mountedComponentHarness.ts'

type ReadOptions = { includeDismissed: boolean; mismatchPage: number; missingPage: number; pageSize: number }
const calls: ReadOptions[] = []
const harness = await createHarness({ observe: ['components/contacts/contactDuplicates.ts'] })
try {
  const fixture = await harness.mount({
    component: 'components/contacts/SaleLinkConflictsSection.tsx',
    app: { can: () => true, t: () => '', settings: {}, user: { id: 7 } },
    props: {
      t: () => '', notify: () => {},
      renderToolbar: (controls: { showKept: boolean; setShowKept: (value: boolean) => void; refresh: () => void }) =>
        React.createElement('div', null,
          React.createElement('button', { onClick: () => controls.setShowKept(!controls.showKept) }, 'Toggle kept'),
          React.createElement('button', { onClick: controls.refresh }, 'Refresh conflicts')),
    },
    doubles: {
      'components/contacts/contactDuplicates.ts': {
        getSaleLinkConflicts: async (options: ReadOptions) => {
          calls.push({ ...options })
          return { mismatches: [], missing: [], pagination: {
            pageSize: 20,
            mismatches: { page: options.mismatchPage, total: 200, totalPages: 10 },
            missing: { page: options.missingPage, total: 200, totalPages: 10 },
          } }
        },
      },
    },
  })
  async function selectPages(mismatch: number, missing: number) {
    for (const [index, value] of [mismatch, missing].entries()) {
      const input = fixture.findAll(node => node.tagName === 'INPUT')[index]
      await fixture.type(input, String(value))
      await fixture.call(input, 'onBlur', [{ currentTarget: { value: String(value) } }])
      await fixture.settle()
    }
    assert.equal(calls.at(-1)?.mismatchPage, mismatch)
    assert.equal(calls.at(-1)?.missingPage, missing)
  }
  for (const includeDismissed of [true, false]) {
    await selectPages(3, 4)
    const before = calls.length
    await fixture.click(fixture.button('Toggle kept'))
    await fixture.settle()
    assert.deepEqual(calls.slice(before), [{ includeDismissed, mismatchPage: 1, missingPage: 1, pageSize: 20 }],
      'changing kept visibility resets both pagers in the same request')
  }
  await selectPages(2, 5)
  const beforeRefresh = calls.length
  await fixture.click(fixture.button('Refresh conflicts'))
  await fixture.settle()
  assert.deepEqual(calls.slice(beforeRefresh), [{ includeDismissed: false, mismatchPage: 2, missingPage: 5, pageSize: 20 }],
    'refreshing the same filter preserves the selected pages')
  await fixture.unmount()
  console.log('PASS actual kept-filter toolbar resets both pagers on each direction; same-filter refresh retains pages')
} finally { await harness.close() }
