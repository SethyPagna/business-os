// Review Queue against the K3 / K6 / K7 Worker (fees-k). The REAL queue is mounted over a transport whose answers
// the test controls, in both language packs.
//
//   reject dialog   the reason is asked in the shared compact dialog (never the browser's prompt()), capped at the
//                   Worker's 512 with a visible counter, and the dialog shows the request and its status before and
//                   after (Open -> Rejected)
//   reject refusals reason_too_long / invalid_reason keep the dialog open with the reason intact and say why in the
//                   pack's language; review_already_decided closes it and refreshes the queue
//   approve refusals review_entity_changed (the expense was edited after the delete was requested -- the request
//                   stays open) and review_already_decided (another reviewer won) are stated in the pack's language
//                   and the queue is re-read from the server, not served from the read cache, so no dead row stays
//   not stale       any other failure keeps its own message and does not claim a refresh
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createHarness, accessibleText, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(read(`../src/lang/${lang}.json`))])) as Record<string, Record<string, string>>
const MAX = 512

const baseRow = {
  id: 41, section: 'fees', action_type: 'delete', entity_type: 'fee', entity_id: 7, payload_json: JSON.stringify({ id: 7 }),
  summary: 'Delete fee #7: Staff lunch', status: 'open', requested_by: 2, requested_by_name: 'Cashier', reviewed_by: null,
  reviewed_by_name: null, reviewed_at: null, reject_reason: null, created_at: '2026-10-13T03:00:00Z', updated_at: '2026-10-13T03:00:00Z',
}
const refusal = (status: number, body: { error: string; code?: string; conflict?: boolean }) => Object.assign(new Error(body.error), { status, code: body.code ?? null, conflict: body.conflict === true })

const harness = await createHarness({ observe: ['api/http.ts'] })
let failed = 0

type Setup = { approve?: () => Promise<unknown>; reject?: (id: number, reason: unknown) => Promise<unknown>; afterDecision?: 'row-gone' | 'row-stays' }

async function mount(lang: 'en' | 'km', setup: Setup) {
  const words = packs[lang]
  const notices: Array<{ message: string; type?: string }> = []
  const rejected: unknown[][] = []
  const invalidated: string[] = []
  const state = { listReads: 0, decided: false }
  const app = {
    page: 'review', t: (key: string) => words[key] || '', notify: (message: string, type?: string) => { notices.push({ message, type }) },
    getPermissionTier: () => 'full', can: () => true, hasPermission: () => true, navigateTo: () => {}, user: { id: 1 },
  }
  const surface = await harness.mount({
    component: 'components/review/ReviewQueue.tsx', props: {}, app,
    doubles: {
      // The read cache: a refusal that says the queue is out of date did not go through the write path that clears it.
      'api/http.ts': { cacheInvalidate: (prefix: string) => { invalidated.push(prefix) } },
      'api/reviewQueueTransport.ts': {
        getPendingActions: async () => {
          state.listReads += 1
          return { data: state.decided && setup.afterDecision === 'row-gone' ? [] : [baseRow] }
        },
        approvePendingAction: async () => { if (setup.approve) return setup.approve(); return { success: true, data: { ...baseRow, status: 'approved' } } },
        rejectPendingAction: async (id: number, reason: unknown) => {
          rejected.push([id, reason])
          if (setup.reject) return setup.reject(id, reason)
          return { success: true, data: { ...baseRow, status: 'rejected' } }
        },
      },
    },
  })
  return { surface, words, notices, rejected, invalidated, state }
}

const buttonsNamed = (surface: MountedSurface, name: string): MemoryNode[] => surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node) === name)
const textareas = (surface: MountedSurface): MemoryNode[] => surface.findAll((node) => node.tagName === 'TEXTAREA')
const maxLengthOf = (node: MemoryNode): number => Number(node.getAttribute('maxlength') ?? node.getAttribute('maxLength') ?? 0)

async function openRejectDialog(ctx: Awaited<ReturnType<typeof mount>>): Promise<MemoryNode> {
  await ctx.surface.click(buttonsNamed(ctx.surface, ctx.words.reject)[0])
  const fields = textareas(ctx.surface)
  assert.equal(fields.length, 1, 'Reject opened a dialog with one reason field')
  return fields[0]
}
const confirmReject = async (ctx: Awaited<ReturnType<typeof mount>>): Promise<void> => {
  const named = buttonsNamed(ctx.surface, ctx.words.reject)
  assert.equal(named.length, 2, 'the row button and the dialog button')
  await ctx.surface.click(named[named.length - 1])
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

try {
  for (const lang of ['en', 'km'] as const) {
    const words = packs[lang]
    await check(`${lang} pack carries the four refusals, and km is translated rather than an English placeholder`, async () => {
      for (const key of ['reason_too_long', 'invalid_reason', 'review_entity_changed', 'review_already_decided']) {
        assert.ok(words[key] && words[key].trim(), `${lang} pack carries ${key}`)
        if (lang === 'km') assert.notEqual(words[key], packs.en[key], `km ${key} is translated, not the English placeholder`)
      }
      assert.ok(words.reason_too_long.includes('{max}'), 'and keeps the {max} slot the dialog fills')
    })

    await check(`${lang} reject: the reason is asked in the shared dialog with a visible 512 counter, and sent trimmed`, async () => {
      const ctx = await mount(lang, {})
      try {
        const field = await openRejectDialog(ctx)
        assert.equal(maxLengthOf(field), MAX, 'the field itself stops at the Worker cap')
        assert.ok(ctx.surface.text().includes(`0/${MAX}`), 'the counter is visible from first paint')
        assert.ok(ctx.surface.text().includes(baseRow.summary), 'the dialog names the request being rejected')
        assert.ok(ctx.surface.text().includes(`${words.open} → ${words.rejected}`), 'the dialog shows the status before and after')
        await ctx.surface.type(field, '  Not needed  ')
        assert.ok(ctx.surface.text().includes(`14/${MAX}`), 'the counter follows what is typed')
        await confirmReject(ctx)
        assert.deepEqual(ctx.rejected, [[41, 'Not needed']], 'the reason is sent trimmed')
        assert.deepEqual(ctx.notices, [{ message: words.pending_action_rejected, type: 'success' }])
        assert.equal(textareas(ctx.surface).length, 0, 'the dialog closed')
        assert.equal(ctx.state.listReads, 2, 'and the queue was re-read')
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} reject: an empty reason is allowed and sent as null; the cap holds even if text is forced past it`, async () => {
      const ctx = await mount(lang, {})
      try {
        const field = await openRejectDialog(ctx)
        await ctx.surface.type(field, 'x'.repeat(MAX + 88))
        assert.ok(ctx.surface.text().includes(`${MAX}/${MAX}`), 'text past the cap is cut at the cap, never sent over it')
        await ctx.surface.type(field, '   ')
        await confirmReject(ctx)
        assert.deepEqual(ctx.rejected, [[41, null]])
      } finally { await ctx.surface.unmount() }
    })

    for (const [code, key] of [['reason_too_long', 'reason_too_long'], ['invalid_reason', 'invalid_reason']] as const) {
      await check(`${lang} reject refused ${code}: the dialog stays open with the reason and says why in the pack's language`, async () => {
        const ctx = await mount(lang, { reject: async () => { throw refusal(400, { error: `English ${code}`, code }) } })
        try {
          const field = await openRejectDialog(ctx)
          await ctx.surface.type(field, 'Keep this text')
          await confirmReject(ctx)
          assert.equal(textareas(ctx.surface).length, 1, 'still open')
          assert.equal((textareas(ctx.surface)[0] as unknown as { value: string }).value, 'Keep this text', 'the typed reason is intact')
          const wanted = words[key].replace('{max}', String(MAX))
          assert.ok(ctx.surface.text().includes(wanted), `the refusal reads: ${wanted}`)
          assert.ok(!ctx.surface.text().includes(`English ${code}`), "not the Worker's English")
          assert.equal(ctx.state.listReads, 1, 'nothing changed, so nothing is re-read')
          assert.deepEqual(ctx.invalidated, [])
          // The way out: Cancel closes it without sending anything more.
          await ctx.surface.click(buttonsNamed(ctx.surface, words.cancel)[0])
          assert.equal(textareas(ctx.surface).length, 0, 'Cancel closes it')
          assert.equal(ctx.rejected.length, 1)
        } finally { await ctx.surface.unmount() }
      })
    }

    await check(`${lang} reject refused review_already_decided: dialog closes, one message, the queue is refreshed`, async () => {
      const ctx = await mount(lang, {
        afterDecision: 'row-gone',
        reject: async () => { ctx.state.decided = true; throw refusal(409, { error: 'Already reviewed or not found', code: 'review_already_decided' }) },
      })
      try {
        await openRejectDialog(ctx)
        await confirmReject(ctx)
        assert.deepEqual(ctx.notices, [{ message: words.review_already_decided, type: 'warning' }])
        assert.equal(textareas(ctx.surface).length, 0)
        assert.equal(ctx.state.listReads, 2, 'the queue was re-read')
        assert.deepEqual(ctx.invalidated, ['review'], 'from the server, not the read cache')
        assert.ok(ctx.surface.text().includes(words.no_pending_actions), 'and the decided row is gone, not left with live buttons')
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} reject refused with the Worker's uncoded "Already reviewed" 409 is the same stale answer`, async () => {
      const ctx = await mount(lang, { afterDecision: 'row-gone', reject: async () => { ctx.state.decided = true; throw refusal(409, { error: 'Already reviewed or not found' }) } })
      try {
        await openRejectDialog(ctx)
        await confirmReject(ctx)
        assert.deepEqual(ctx.notices, [{ message: words.review_already_decided, type: 'warning' }])
        assert.equal(ctx.state.listReads, 2)
        assert.deepEqual(ctx.invalidated, ['review'])
      } finally { await ctx.surface.unmount() }
    })

    await check(`${lang} reject failing for another reason keeps its own message, closes, and does not claim a refresh`, async () => {
      const ctx = await mount(lang, { reject: async () => { throw refusal(500, { error: 'Internal error' }) } })
      try {
        await openRejectDialog(ctx)
        await confirmReject(ctx)
        assert.deepEqual(ctx.notices, [{ message: 'Internal error', type: 'error' }])
        assert.equal(ctx.state.listReads, 1)
        assert.deepEqual(ctx.invalidated, [])
      } finally { await ctx.surface.unmount() }
    })

    for (const [name, error, key, rowGone] of [
      ['review_entity_changed', refusal(409, { error: 'This expense changed after the delete was requested.', code: 'review_entity_changed', conflict: true }), 'review_entity_changed', false],
      ['review_already_decided', refusal(409, { error: 'Already reviewed or not found', code: 'review_already_decided' }), 'review_already_decided', true],
      ['an uncoded "Already reviewed" 409', refusal(409, { error: 'Already reviewed' }), 'review_already_decided', true],
    ] as const) {
      await check(`${lang} approve refused ${name}: stated in the pack's language and the queue re-read fresh`, async () => {
        const ctx = await mount(lang, { afterDecision: rowGone ? 'row-gone' : 'row-stays', approve: async () => { ctx.state.decided = true; throw error } })
        try {
          await ctx.surface.click(buttonsNamed(ctx.surface, words.approve)[0])
          assert.deepEqual(ctx.notices, [{ message: words[key], type: 'warning' }], 'one message, not the Worker English')
          assert.equal(ctx.state.listReads, 2, 'the queue was re-read after the refusal')
          assert.deepEqual(ctx.invalidated, ['review'], 'from the server, not the read cache')
          if (rowGone) assert.ok(ctx.surface.text().includes(words.no_pending_actions), 'a request someone else decided is not left on screen with live buttons')
          else assert.equal(buttonsNamed(ctx.surface, words.approve).length, 1, 'a request that is still open stays, so it can be rejected')
        } finally { await ctx.surface.unmount() }
      })
    }

    await check(`${lang} approve failing for another reason (incl. an uncoded 409 that is not "Already reviewed") keeps its own message`, async () => {
      for (const error of [refusal(500, { error: 'Internal error' }), refusal(409, { error: 'The requester no longer has permission to edit branches.' })]) {
        const ctx = await mount(lang, { approve: async () => { throw error } })
        try {
          await ctx.surface.click(buttonsNamed(ctx.surface, words.approve)[0])
          assert.deepEqual(ctx.notices, [{ message: error.message, type: 'error' }])
          assert.equal(ctx.state.listReads, 1, 'no refresh is claimed')
          assert.deepEqual(ctx.invalidated, [])
        } finally { await ctx.surface.unmount() }
      }
    })
  }
} finally {
  await harness.close()
}

// The browser's prompt() cannot be translated, cannot show a counter and cannot be capped; the reject reason must not come back to it.
await check('the Review Queue no longer calls the native prompt()', async () => {
  // A real parse: a comment that mentions prompt() is not a call.
  const file = ts.createSourceFile('ReviewQueue.tsx', read('../src/components/review/ReviewQueue.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const calls: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'prompt') calls.push('prompt()')
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'prompt') calls.push(`${callee.getText(file)}()`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.deepEqual(calls, [])
})
await check("the global conflict dialog leaves the review approval to the queue's own message", async () => {
  assert.match(read('../src/AppContext.tsx'), /\['fees:delete', 'review:approve'\]\.includes\(String\(detail\.channel \|\| ''\)\)\) return/)
})
await check("the page's cap is the Worker's cap", async () => {
  const worker = read('../../cloudflare/src/lib/pendingActions.ts')
  assert.match(worker, /export const REVIEW_REASON_MAX_LENGTH = (\d+)/)
  assert.equal(Number(/export const REVIEW_REASON_MAX_LENGTH = (\d+)/.exec(worker)![1]), MAX)
  assert.match(read('../src/api/branchRuleErrors.ts'), new RegExp(`export const REVIEW_REASON_MAX_LENGTH = ${MAX}\\b`))
})

// The premise of "re-read fresh": the REAL queue read is cached, and a refused write does not clear that cache, so
// without cacheInvalidate('review') the very next read would hand back the same dead row.
await check('the queue read is cached until cacheInvalidate("review") clears it', async () => {
  const { __resetApiWriteDedupeForTests, cacheInvalidate, setSyncServerUrl } = await import('../src/api/http.ts')
  const { getPendingActions } = await import('../src/api/reviewQueueTransport.ts')
  const originalFetch = globalThis.fetch
  let served = 0
  globalThis.fetch = (async () => {
    served += 1
    return new Response(JSON.stringify({ success: true, data: [{ ...baseRow, id: 100 + served }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  setSyncServerUrl('https://sync.example.test')
  try {
    cacheInvalidate('review')
    const first = await getPendingActions({ status: 'open' })
    const again = await getPendingActions({ status: 'open' })
    assert.deepEqual(again, first, 'a repeat read inside the cache window is served from the cache')
    assert.equal(served, 1)
    cacheInvalidate('review')
    const fresh = await getPendingActions({ status: 'open' })
    assert.equal(served, 2, 'after cacheInvalidate("review") the server is asked again')
    assert.notDeepEqual(fresh, first)
  } finally {
    globalThis.fetch = originalFetch
    setSyncServerUrl('')
    __resetApiWriteDedupeForTests()
  }
})

if (failed) process.exit(1)
