// H1 (OPUS-CORRECTNESS-HUNT-R2): every refusal a reviewer can hit in the Review Queue reads in the UI language.
// Before this, a Khmer reviewer who approved an expense delete after the expense was edited, lost a two-reviewer race, or
// lacked a per-action grant read the Worker's English sentence, and the reject path showed `error.message` raw.
//
// The six codes the hunt named (Worker routes/reviewQueue.ts, lib/reviewApprovalPermission.ts, lib/reviewApply.ts):
//   review_action_full_required  403 -- the reviewer lacks the grant the direct route demands; body.permission names it
//   review_entity_changed        409 -- the record changed after the request was made (K3)
//   review_already_decided       409 -- someone else decided first (K6)
//   invalid_reason / reason_too_long   400 -- the reject reason (K7)
//   no_review_applier            501 -- a kind of request with no approval rule
//
// What is proved, in both packs and from the real pieces:
//   the pack           every key exists in en and km, km is translated (not the English), slots survive
//   the text           reviewApprovalRefusalText answers all six (and still the three N12 / Finding I codes), naming the
//                      permission the way the Users screen names it; any other code stays null
//   the error          the REAL createApiError carries the Worker's `permission` onto the error the queue receives
//   the queue          the REAL ReviewQueue, approving and rejecting, shows the pack's sentence, never the Worker's English
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { reviewApprovalRefusalText } from '../src/api/branchRuleErrors.ts'
import { createHarness, accessibleText, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const ts = createRequire(import.meta.url)('typescript')
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(read(`../src/lang/${lang}.json`))])) as Record<string, Record<string, string>>

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
  isTransientGatewayError: load(http, 'isTransientGatewayError', { TRANSIENT_GATEWAY_STATUSES: load(http, 'TRANSIENT_GATEWAY_STATUSES') }),
})

const SIX = ['review_action_full_required', 'review_entity_changed', 'review_already_decided', 'invalid_reason', 'reason_too_long', 'no_review_applier'] as const
const NEW_KEYS = ['review_action_full_required', 'no_review_applier'] as const
const MAX = 512

// The bodies as the Worker sends them. Pinned to the Worker's own source at the bottom of this file.
const WORKER_BODIES: Record<string, { status: number; body: Record<string, unknown> }> = {
  review_action_full_required: { status: 403, body: { error: 'Full products:price permission is required to approve this request.', code: 'review_action_full_required', permission: 'products:price' } },
  review_entity_changed: { status: 409, body: { success: false, error: 'This expense changed after the delete was requested. Nothing was deleted.', code: 'review_entity_changed', conflict: true } },
  review_already_decided: { status: 409, body: { error: 'Already reviewed or not found', code: 'review_already_decided' } },
  invalid_reason: { status: 400, body: { error: 'The reason must be text.', code: 'invalid_reason' } },
  reason_too_long: { status: 400, body: { error: `Reason is too long (max ${MAX} characters)`, code: 'reason_too_long' } },
  no_review_applier: { status: 501, body: { error: 'This kind of request has no approval rule, so it cannot be approved.', code: 'no_review_applier' } },
}
const apiError = (code: string) => createApiError(WORKER_BODIES[code].status, WORKER_BODIES[code].body, '')

const baseRow = {
  id: 41, section: 'fees', action_type: 'delete', entity_type: 'fee', entity_id: 7, payload_json: JSON.stringify({ id: 7 }),
  summary: 'Delete fee #7: Staff lunch', status: 'open', requested_by: 2, requested_by_name: 'Cashier', reviewed_by: null,
  reviewed_by_name: null, reviewed_at: null, reject_reason: null, created_at: '2026-10-13T03:00:00Z', updated_at: '2026-10-13T03:00:00Z',
}

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

for (const lang of ['en', 'km'] as const) {
  const words = packs[lang]
  const t = (key: string) => words[key]

  await check(`${lang} pack carries all six refusals; km is translated rather than an English placeholder; slots survive`, () => {
    for (const key of SIX) {
      assert.ok(words[key] && words[key].trim(), `${lang} pack carries ${key}`)
      if (lang === 'km') assert.notEqual(words[key], packs.en[key], `km ${key} is translated, not the English placeholder`)
    }
    assert.ok(words.review_action_full_required.includes('{permission}'), 'the permission slot')
    assert.ok(words.reason_too_long.includes('{max}'), 'the cap slot')
    if (lang === 'km') for (const key of NEW_KEYS) assert.match(words[key], /[ក-៿]/, `${key} is Khmer script`)
  })

  await check(`${lang} reviewApprovalRefusalText answers all six codes, and the three it already knew`, () => {
    assert.equal(reviewApprovalRefusalText('review_entity_changed', 'fees', t), words.review_entity_changed)
    assert.equal(reviewApprovalRefusalText('review_already_decided', 'fees', t), words.review_already_decided)
    assert.equal(reviewApprovalRefusalText('invalid_reason', 'fees', t), words.invalid_reason)
    assert.equal(reviewApprovalRefusalText('reason_too_long', 'fees', t), words.reason_too_long.replace('{max}', String(MAX)))
    assert.equal(reviewApprovalRefusalText('no_review_applier', 'fees', t), words.no_review_applier)
    for (const code of ['review_self_approval', 'review_section_full_required', 'review_identity_conflict']) {
      assert.ok(reviewApprovalRefusalText(code, 'products', t), `${code} still answered`)
    }
    for (const code of ['write_conflict', 'unknown_outcome', 'review_permission_revoked', '', null, undefined]) {
      assert.equal(reviewApprovalRefusalText(code, 'fees', t, 'fees:delete'), null, `${String(code)} falls through to the caller`)
    }
  })

  await check(`${lang} review_action_full_required names the permission the way the Users screen does`, () => {
    const sentence = (permission: unknown, section: unknown = 'products') => reviewApprovalRefusalText('review_action_full_required', section, t, permission) || ''
    // a section:action grant -> the action's label (perm_act_<section>_<action>)
    for (const [permission, key] of [['fees:delete', 'perm_act_fees_delete'], ['products:price', 'perm_act_products_price'], ['products:image', 'perm_act_products_image'],
      ['inventory:edit_reasons', 'perm_act_inventory_edit_reasons'], ['branches:add', 'perm_act_branches_add']] as const) {
      assert.ok(words[key], `${lang} has ${key}`)
      assert.equal(sentence(permission), words.review_action_full_required.replace('{permission}', words[key]), `${permission} -> ${key}`)
    }
    // a bare grant -> perm_<name>
    assert.equal(sentence('product_cost_edit'), words.review_action_full_required.replace('{permission}', words.perm_product_cost_edit))
    // a grant this client has no label for is named as the Worker named it, never a bare slot
    assert.equal(sentence('widgets:polish'), words.review_action_full_required.replace('{permission}', 'widgets:polish'))
    // a refusal that names none (an older Worker) falls back to the request's section, in the pack's language
    assert.equal(sentence(undefined, 'fees'), words.review_action_full_required.replace('{permission}', words.fees))
    assert.ok(!sentence(undefined, 'fees').includes('{permission}'))
    // the sentence differs by permission, so a hard-coded name cannot pass
    assert.notEqual(sentence('fees:delete'), sentence('products:price'))
  })

  await check(`${lang} the real createApiError carries the Worker's permission onto the error the queue receives`, () => {
    const error = apiError('review_action_full_required')
    assert.equal(error.status, 403)
    assert.equal(error.code, 'review_action_full_required')
    assert.equal(error.permission, 'products:price')
    assert.equal(apiError('no_review_applier').permission, null, 'a refusal that names no permission carries none')
    assert.equal(reviewApprovalRefusalText(error.code, 'products', t, error.permission),
      words.review_action_full_required.replace('{permission}', words.perm_act_products_price), 'and the sentence names it')
  })
}

// ---- the REAL queue ---------------------------------------------------------------------------------------------------
const harness = await createHarness({ observe: ['api/http.ts'] })

type Setup = { approve?: () => Promise<unknown>; reject?: () => Promise<unknown> }
async function mount(lang: 'en' | 'km', setup: Setup) {
  const words = packs[lang]
  const notices: Array<{ message: string; type?: string }> = []
  const state = { listReads: 0 }
  const surface = await harness.mount({
    component: 'components/review/ReviewQueue.tsx', props: {},
    app: {
      page: 'review', t: (key: string) => words[key] || '', notify: (message: string, type?: string) => { notices.push({ message, type }) },
      getPermissionTier: () => 'full', can: () => true, hasPermission: () => true, navigateTo: () => {}, user: { id: 1 },
    },
    doubles: {
      'api/http.ts': { cacheInvalidate: () => {} },
      'api/reviewQueueTransport.ts': {
        getPendingActions: async () => { state.listReads += 1; return { data: [baseRow] } },
        approvePendingAction: async () => { if (setup.approve) return setup.approve(); return { success: true, data: { ...baseRow, status: 'approved' } } },
        rejectPendingAction: async () => { if (setup.reject) return setup.reject(); return { success: true, data: { ...baseRow, status: 'rejected' } } },
      },
    },
  })
  return { surface, words, notices, state }
}
const buttonsNamed = (surface: MountedSurface, name: string): MemoryNode[] => surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node) === name)

try {
  for (const lang of ['en', 'km'] as const) {
    const words = packs[lang]
    const wanted = (code: string): string => {
      const error = apiError(code)
      return reviewApprovalRefusalText(error.code, baseRow.section, (key) => words[key], error.permission) as string
    }

    // Approve: every code the Worker can answer here, as the error the real http layer builds from the Worker's body.
    for (const code of ['review_action_full_required', 'no_review_applier', 'review_entity_changed', 'review_already_decided'] as const) {
      await check(`${lang} approve refused ${code}: the pack's sentence, never the Worker's English`, async () => {
        const ctx = await mount(lang, { approve: async () => { throw apiError(code) } })
        try {
          await ctx.surface.click(buttonsNamed(ctx.surface, words.approve)[0])
          const stale = code === 'review_entity_changed' || code === 'review_already_decided'
          assert.deepEqual(ctx.notices, [{ message: wanted(code), type: stale ? 'warning' : 'error' }])
          // (The English pack may legitimately restate the Worker's sentence; the Khmer one must not leak it.)
          if (lang === 'km') assert.ok(!ctx.notices.some((notice) => notice.message.includes(String(WORKER_BODIES[code].body.error))), "not the Worker's English")
          assert.equal(ctx.state.listReads, stale ? 2 : 1, stale ? 'a stale queue is re-read' : 'nothing changed, nothing is re-read')
          if (code === 'review_action_full_required') assert.ok(ctx.notices[0].message.includes(words.perm_act_products_price), 'and it names the permission that is missing')
        } finally { await ctx.surface.unmount() }
      })
    }

    // Reject: the same sentences. The dialog closes on any refusal that is not about the reason (the reason ones keep it
    // open -- tests/reviewQueueRejectReason.test.ts), and the message is the pack's, not `error.message`.
    for (const code of ['review_action_full_required', 'no_review_applier'] as const) {
      await check(`${lang} reject refused ${code}: the pack's sentence instead of error.message`, async () => {
        const ctx = await mount(lang, { reject: async () => { throw apiError(code) } })
        try {
          await ctx.surface.click(buttonsNamed(ctx.surface, words.reject)[0])
          const named = buttonsNamed(ctx.surface, words.reject)
          await ctx.surface.click(named[named.length - 1])
          assert.deepEqual(ctx.notices, [{ message: wanted(code), type: 'error' }])
          if (lang === 'km') assert.ok(!ctx.notices.some((notice) => notice.message.includes(String(WORKER_BODIES[code].body.error))), "not the Worker's English")
        } finally { await ctx.surface.unmount() }
      })
    }

    // Controls: an error with no code the client knows keeps its own message (it is not swallowed into a refusal).
    await check(`${lang} control: an uncoded failure keeps its own message on approve and on reject`, async () => {
      for (const [path, setup] of [['approve', { approve: async () => { throw Object.assign(new Error('Internal error'), { status: 500 }) } }],
        ['reject', { reject: async () => { throw Object.assign(new Error('Internal error'), { status: 500 }) } }]] as const) {
        const ctx = await mount(lang, setup)
        try {
          await ctx.surface.click(buttonsNamed(ctx.surface, path === 'approve' ? words.approve : words.reject)[0])
          if (path === 'reject') { const named = buttonsNamed(ctx.surface, words.reject); await ctx.surface.click(named[named.length - 1]) }
          assert.deepEqual(ctx.notices, [{ message: 'Internal error', type: 'error' }], path)
        } finally { await ctx.surface.unmount() }
      }
    })
  }
} finally {
  await harness.close()
}

// ---- the Worker's side ------------------------------------------------------------------------------------------------
await check("the codes, the permission field and the cap are the Worker's", () => {
  const route = read('../../cloudflare/src/routes/reviewQueue.ts')
  const permission = read('../../cloudflare/src/lib/reviewApprovalPermission.ts')
  const apply = read('../../cloudflare/src/lib/reviewApply.ts')
  assert.ok(permission.includes("code: 'review_action_full_required', permission }"), 'review_action_full_required carries `permission`')
  assert.ok(permission.includes("code: 'no_review_applier'"), 'no_review_applier from the pre-check')
  assert.ok(route.includes("code: 'no_review_applier'"), 'and from the applier lookup')
  assert.ok(route.includes("code: 'invalid_reason'") && route.includes("code: 'reason_too_long'"))
  assert.ok(apply.includes("readonly code = 'review_entity_changed'") && apply.includes("readonly code = 'review_already_decided'"))
  assert.equal(Number(/export const REVIEW_REASON_MAX_LENGTH = (\d+)/.exec(read('../../cloudflare/src/lib/pendingActions.ts'))![1]), MAX)
  // every permission the Worker can name has a label in both packs (REVIEW_ACTIONS values + the price/image/cost grants)
  const actions = [...permission.matchAll(/^ {2}'([a-z_]+):[a-z_]+:[a-z_]+': '([a-z_]+)',?$/gm)].map((match) => `${match[1]}:${match[2]}`)
  assert.ok(actions.length >= 8, 'the Worker maps its queued actions')
  for (const name of [...new Set([...actions, 'products:price', 'products:image'])]) {
    const [section, action] = name.split(':')
    for (const lang of ['en', 'km']) assert.ok(packs[lang][`perm_act_${section}_${action}`], `${lang} labels ${name}`)
  }
  for (const lang of ['en', 'km']) assert.ok(packs[lang].perm_product_cost_edit, `${lang} labels product_cost_edit`)
})

if (failed) process.exit(1)
