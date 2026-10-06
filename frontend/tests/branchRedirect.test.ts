// CUTOVER-LR (owner ruling 6 Oct 2026): a write addressed to a disabled branch is refused by the Worker with 409
// branch_redirect_required; api/http.ts asks the one registered host (float -> confirm) and sends the SAME request
// again with the confirmed branch in X-Branch-Redirect. Back ends in branch_redirect_declined with nothing written.
// These checks drive the real apiFetch over a mocked fetch, and the helpers the float and the sale modal share.
import assert from 'node:assert/strict'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  apiFetch,
  setSyncServerUrl,
  setSyncToken,
} from '../src/api/http.ts'
import {
  BRANCH_REDIRECT_DECLINED_CODE,
  BRANCH_REDIRECT_HEADER,
  askBranchRedirect,
  branchRedirectRequestOf,
  clientBranchRedirectDetail,
  defaultRedirectTarget,
  registerBranchRedirectHandler,
  type BranchRedirectRequest,
} from '../src/api/branchRedirect.ts'
import en from '../src/lang/en.json' with { type: 'json' }

type FetchCall = Parameters<typeof fetch>
let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const OLD_SHOP = { id: 1, name: 'Old Shop', role: 'shop', is_active: 0, successor_branch_id: 2 }
const LC_STORE = { id: 2, name: 'LC Store', role: 'shop', is_active: 1, successor_branch_id: null }
const STORAGE = { id: 3, name: 'Back Room', role: 'warehouse', is_active: 1, successor_branch_id: null }

const REFUSAL = {
  error: en.branch_redirect_required,
  code: 'branch_redirect_required',
  redirect: {
    addressed_branch_id: 1,
    addressed_branch_name: 'Old Shop',
    successor_branch_id: 2,
    successor_branch_name: 'LC Store',
    targets: [{ id: 2, name: 'LC Store' }, { id: 3, name: 'Back Room' }],
    requested_target_id: null,
  },
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function headerOf(call: FetchCall): string | null {
  const headers = (call[1]?.headers || {}) as Record<string, string>
  const key = Object.keys(headers).find((name) => name.toLowerCase() === BRANCH_REDIRECT_HEADER.toLowerCase())
  return key ? headers[key] : null
}

async function withServer(responses: Array<() => Response>, fn: (calls: FetchCall[]) => Promise<void>): Promise<void> {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('https://sync.example.test')
  setSyncToken('')
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return Promise.resolve(next())
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = originalFetch
    __resetApiWriteDedupeForTests()
    __resetApiHealthForTests()
    setSyncServerUrl('')
  }
}

await runTest('the refusal parses into a request; anything else, or a refusal without targets, does not', () => {
  const request = branchRedirectRequestOf(REFUSAL)
  assert.ok(request)
  assert.equal(request.code, 'branch_redirect_required')
  assert.deepEqual(request.detail.targets.map((row) => row.id), [2, 3])
  assert.equal(defaultRedirectTarget(request.detail), 2, 'the successor leads')
  assert.equal(branchRedirectRequestOf({ ...REFUSAL, code: 'branch_retired_no_successor' }), null)
  assert.equal(branchRedirectRequestOf({ ...REFUSAL, redirect: { ...REFUSAL.redirect, targets: [] } }), null)
  assert.equal(branchRedirectRequestOf({ ...REFUSAL, redirect: undefined }), null)
  assert.equal(branchRedirectRequestOf(new Error('boom')), null)
  const invalid = branchRedirectRequestOf({ ...REFUSAL, code: 'branch_redirect_target_invalid', redirect: { ...REFUSAL.redirect, requested_target_id: 9 } })
  assert.equal(invalid?.detail.requested_target_id, 9, 'a rejected pick is carried so the float can say so')
})

await runTest('the client twin of the Worker detail: nothing to ask for an active branch, sellers only when the change sells', () => {
  const rows = [STORAGE, LC_STORE, OLD_SHOP]
  assert.equal(clientBranchRedirectDetail(rows, 2), null, 'an active branch is never redirected')
  assert.equal(clientBranchRedirectDetail(rows, 99), null)
  const any = clientBranchRedirectDetail(rows, 1)
  assert.deepEqual(any?.targets.map((row) => row.id), [2, 3], 'successor first, then by name')
  assert.equal(any?.successor_branch_name, 'LC Store')
  const selling = clientBranchRedirectDetail(rows, 1, { sells: true })
  assert.deepEqual(selling?.targets.map((row) => row.id), [2], 'a sale line can only go to a selling branch')
  assert.equal(clientBranchRedirectDetail([OLD_SHOP, STORAGE], 1, { sells: true }), null, 'no seller: nothing to offer')
})

await runTest('askBranchRedirect: no host answers null; a host answer outside the targets is refused; questions queue', async () => {
  const request = branchRedirectRequestOf(REFUSAL) as BranchRedirectRequest
  assert.equal(await askBranchRedirect(request), null, 'no registered host')
  const seen: number[] = []
  const unregister = registerBranchRedirectHandler(async (ask) => { seen.push(ask.detail.addressed_branch_id); return 7 })
  assert.equal(await askBranchRedirect(request), null, 'an id that is not an offered target never goes out')
  unregister()
  let release!: (value: number) => void
  const order: string[] = []
  const unregister2 = registerBranchRedirectHandler((ask) => new Promise<number | null>((done) => {
    order.push(`ask ${ask.detail.addressed_branch_id}`)
    if (order.length === 1) release = done
    else done(3)
  }))
  const first = askBranchRedirect(request)
  const second = askBranchRedirect(request)
  await new Promise((done) => setTimeout(done, 5))
  assert.deepEqual(order, ['ask 1'], 'the second question waits for the first answer')
  release(2)
  assert.equal(await first, 2)
  assert.equal(await second, 3)
  unregister2()
  assert.deepEqual(seen, [1])
})

await runTest('no host (before the cutover, or a page without the app shell): the refusal surfaces unchanged, one request', async () => {
  await withServer([() => json(409, REFUSAL)], async (calls) => {
    await assert.rejects(apiFetch('POST', '/api/sales/5/items', { items: [] }, 1000), (error: Error & { code?: string; status?: number }) => {
      assert.equal(error.code, 'branch_redirect_required')
      assert.equal(error.status, 409)
      return true
    })
    assert.equal(calls.length, 1)
    assert.equal(headerOf(calls[0]), null)
  })
})

await runTest('confirmed: the same request goes again with the chosen branch in X-Branch-Redirect, and its answer is returned', async () => {
  const asked: BranchRedirectRequest[] = []
  const unregister = registerBranchRedirectHandler(async (request) => { asked.push(request); return 2 })
  try {
    await withServer([() => json(409, REFUSAL), () => json(200, { success: true, id: 5 })], async (calls) => {
      const body = { items: [{ product_id: 4, quantity: 1 }] }
      assert.deepEqual(await apiFetch('POST', '/api/sales/5/items', body, 1000), { success: true, id: 5 })
      assert.equal(calls.length, 2)
      assert.equal(headerOf(calls[0]), null, 'the first attempt carries no redirect')
      assert.equal(headerOf(calls[1]), '2', 'the retry carries the confirmed branch')
      assert.equal(String(calls[1][0]), String(calls[0][0]), 'same endpoint')
      assert.equal(calls[1][1]?.method, 'POST')
      assert.equal(calls[1][1]?.body, calls[0][1]?.body, 'same body')
      assert.equal(asked.length, 1)
      assert.equal(asked[0].detail.addressed_branch_name, 'Old Shop')
    })
  } finally {
    unregister()
  }
})

await runTest('a pick the Worker no longer accepts asks again, naming the rejected pick; Back then declines', async () => {
  const answers = [3, null]
  const asked: BranchRedirectRequest[] = []
  const unregister = registerBranchRedirectHandler(async (request) => { asked.push(request); return answers.shift() ?? null })
  const invalid = { ...REFUSAL, code: 'branch_redirect_target_invalid', error: en.branch_redirect_target_invalid, redirect: { ...REFUSAL.redirect, requested_target_id: 3 } }
  try {
    await withServer([() => json(409, REFUSAL), () => json(409, invalid)], async (calls) => {
      await assert.rejects(apiFetch('PATCH', '/api/fees/8', { amount: 1 }, 1000), (error: Error & { code?: string; userCancelled?: boolean }) => {
        assert.equal(error.code, BRANCH_REDIRECT_DECLINED_CODE)
        assert.equal(error.userCancelled, true, 'Back is a cancel, not a failure toast')
        assert.equal(error.message, en.branch_redirect_declined.replace('{branch}', 'Old Shop'))
        return true
      })
      assert.equal(calls.length, 2, 'Back sends nothing more')
      assert.equal(headerOf(calls[1]), '3')
      assert.equal(asked[1].code, 'branch_redirect_target_invalid')
      assert.equal(asked[1].detail.requested_target_id, 3)
    })
  } finally {
    unregister()
  }
})

await runTest('reads never ask, and other refusals pass through untouched', async () => {
  let asked = 0
  const unregister = registerBranchRedirectHandler(async () => { asked += 1; return 2 })
  try {
    await withServer([() => json(409, REFUSAL)], async () => {
      await assert.rejects(apiFetch('GET', '/api/sales/5', undefined, 1000), (error: Error & { code?: string }) => error.code === 'branch_redirect_required')
    })
    await withServer([() => json(409, { error: 'other', code: 'write_conflict' })], async (calls) => {
      await assert.rejects(apiFetch('POST', '/api/sales/5/items', {}, 1000), (error: Error & { code?: string }) => error.code === 'write_conflict')
      assert.equal(calls.length, 1)
    })
    assert.equal(asked, 0)
  } finally {
    unregister()
  }
})

await runTest('a caller that asked up front sends the header on its first request', async () => {
  await withServer([() => json(200, { success: true })], async (calls) => {
    await apiFetch('POST', '/api/sales/5/items', {}, 1000, { branchRedirect: 2 })
    assert.equal(headerOf(calls[0]), '2')
  })
})

if (failed) {
  console.error(`${failed} branch redirect test(s) failed`)
  process.exit(1)
}
console.log('branch redirect tests passed')
