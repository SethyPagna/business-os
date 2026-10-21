// What the role editor shows for the Products switches the Worker honours at Review, checked against the
// Worker's own evaluation: the real getActionTier for each tier and switch state, the route source for what a
// Review caller gets, and the real editor rendered in English and Khmer.
//
// Run: node tests/permissionPartialTier.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getActionTier } from '../../cloudflare/src/lib/permissions.ts'
import { PERMISSION_ACTIONS, actionAllowed, outcomeAt, type ActionOutcome } from '../src/utils/permissionActions.ts'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const productsRoute = readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')

let failed = 0
// The harness reads one shared document, so a test that throws before unmounting must not hand its editor to the next one.
const live: MountedSurface[] = []
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const surface of live.splice(0)) await surface.unmount()
  }
}

const rowOf = (section: string, key: string) => PERMISSION_ACTIONS[section].find((action) => action.key === key)!
const workerTier = (permissions: Record<string, unknown>, section: string, action: string) =>
  getActionTier({ role_code: 'staff', permissions: JSON.stringify(permissions) }, section, action)

// What a Review caller gets from the Worker for each switch that is not off, read from the routes.
const REVIEW_TIER_CASES: Array<{ action: string; label: string; badge: ActionOutcome; tool: 'full only' | 'same'; proof: RegExp[] }> = [
  {
    action: 'merge_duplicates', label: 'perm_act_products_merge_duplicates', badge: 'queue', tool: 'full only',
    proof: [
      /getActionTier\(user, 'products', 'merge_duplicates'\) === 'none'\) \{\s*return c\.json\(PRODUCT_MERGE_PERMISSION_REFUSAL, 403\)/,
      /if \(pendingId != null\) return c\.json\(\{ success: true, pending: true, pendingActionId: pendingId \}, 202\)/,
      /getActionTier\(user, 'products', 'merge_duplicates'\) !== 'full'/,
    ],
  },
  {
    action: 'image', label: 'perm_act_products_image', badge: 'queue', tool: 'full only',
    proof: [
      /return changed && !imageOnlyEdit && getActionTier\(user, 'products', 'image'\) === 'none'/,
      /getActionTier\(user, 'products', 'image'\) !== 'full'/,
    ],
  },
  {
    action: 'price', label: 'perm_act_products_price', badge: 'queue', tool: 'same',
    proof: [
      /getActionTier\(user, 'products', 'price'\) === 'none' && productPriceChanged\(readProductMoneyPlan\(body\)\)/,
      /const duplicate = getPermissionTier\(user, 'products'\) === 'review'/,
    ],
  },
  {
    action: 'history', label: 'perm_act_products_history', badge: 'allow', tool: 'same',
    proof: [/getPermissionTier\(user, 'products'\) !== 'none' && getActionTier\(user, 'products', 'history'\) === 'none'\) return false/],
  },
]

await test('the Worker evaluates each of these switches as Review unless it is off', () => {
  for (const { action } of REVIEW_TIER_CASES) {
    assert.equal(workerTier({}, 'products', action), 'none', `${action}: no Products grant`)
    assert.equal(workerTier({ products: 'review' }, 'products', action), 'review', `${action}: Review, not switched off`)
    assert.equal(workerTier({ products: 'review', [`products:${action}`]: false }, 'products', action), 'none', `${action}: Review, switched off`)
    assert.equal(workerTier({ products: true }, 'products', action), 'full', `${action}: Full Access`)
    assert.equal(workerTier({ products: true, [`products:${action}`]: false }, 'products', action), 'none', `${action}: Full Access, switched off`)
  }
})

await test('the routes still treat Review the way the table says', () => {
  for (const { action, proof } of REVIEW_TIER_CASES) {
    for (const pattern of proof) assert.match(productsRoute, pattern, `${action}: the Worker no longer behaves as pinned (${pattern})`)
  }
})

await test('the table gives each switch the outcome the Worker gives it at Review', () => {
  for (const { action, badge } of REVIEW_TIER_CASES) {
    assert.equal(outcomeAt(rowOf('products', action), 'review'), badge, `${action} at Review`)
    assert.equal(outcomeAt(rowOf('products', action), 'full'), 'allow', `${action} at Full Access`)
    assert.equal(outcomeAt(rowOf('products', action), 'none'), 'block', `${action} with no Products grant`)
  }
})

await test('the page tool behind a row keeps its own Review answer', () => {
  for (const { action, tool } of REVIEW_TIER_CASES) {
    const expected = tool === 'full only' ? false : true
    assert.equal(actionAllowed('products', action, 'review'), expected, `${action}: the page control at Review`)
    assert.equal(actionAllowed('products', action, 'full'), true)
    assert.equal(actionAllowed('products', action, 'full', () => false, (section, key) => section === 'products' && key === action), false, `${action}: switched off wins`)
    assert.equal(actionAllowed('products', action, 'review', () => false, (section, key) => section === 'products' && key === action), false, `${action}: switched off wins at Review`)
  }
})

await test('a row that shows a different outcome from its page tool says so and only does so at Review', () => {
  for (const [section, actions] of Object.entries(PERMISSION_ACTIONS)) {
    for (const action of actions) {
      if (action.controlReview === undefined) continue
      assert.equal(action.controlReview, 'block', `${section}.${action.key}: only a stricter page tool is modelled`)
      assert.notEqual(action.review, 'block', `${section}.${action.key}: a blocked row has no second outcome to describe`)
      assert.equal(actionAllowed(section, action.key, 'view'), outcomeAt(action, 'view') !== 'block', `${section}.${action.key}: View is unaffected`)
      assert.equal(actionAllowed(section, action.key, 'full'), true, `${section}.${action.key}: Full Access is unaffected`)
    }
  }
})

// The editor, mounted for real with every row open: each chip is found by data-perm-action and read through its
// mark, pressed state and tooltip. A module at None lists no chips at all, so an action the role cannot reach is
// never drawn as if it were live.
const harness = await createHarness()

const ancestors = (node: MemoryNode): MemoryNode[] => {
  const chain: MemoryNode[] = []
  for (let current = node.parentNode; current; current = current.parentNode) chain.push(current)
  return chain
}
const within = (node: MemoryNode, root: MemoryNode) => node === root || ancestors(node).includes(root)

async function render(pack: Record<string, string>, permissions: Record<string, unknown>): Promise<MountedSurface> {
  // The harness reads one shared document, so a second editor would be found beside the first: one at a time.
  for (const previous of live.splice(0)) await previous.unmount()
  const t = (key: string) => pack[key]
  const surface = await harness.mount({
    component: 'components/users/PermissionEditor.tsx',
    props: { permissions, onChange: () => {}, t },
    app: { t },
    doubles: {},
  })
  live.push(surface)
  for (const id of surface.findAll((node) => node.getAttribute('data-perm-module') !== null).map((node) => node.getAttribute('data-perm-module') as string)) {
    const root = surface.find((node) => node.getAttribute('data-perm-module') === id, `module ${id}`)
    const toggle = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, root), `${id} expander`)
    if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  }
  return surface
}
const chips = (surface: MountedSurface, module: string, key: string): MemoryNode[] => {
  const root = surface.find((node) => node.getAttribute('data-perm-module') === module, `module ${module}`)
  return surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-action') === key && within(node, root))
}
const chip = (surface: MountedSurface, module: string, key: string): MemoryNode => {
  const found = chips(surface, module, key)
  assert.equal(found.length, 1, `the editor renders one ${module}.${key} chip`)
  return found[0]
}
const title = (node: MemoryNode) => node.getAttribute('title') ?? ''
const isDisabled = (node: MemoryNode) => (node as unknown as { disabled?: boolean }).disabled === true || node.getAttribute('disabled') !== null

for (const [name, pack] of [['English', en], ['Khmer', km]] as const) {
  for (const { action, badge } of REVIEW_TIER_CASES) {
    await test(`${name}: ${action} at Review is a real control showing what the Worker does`, async () => {
      const row = chip(await render(pack, { products: 'review' }), 'products', action)
      assert.ok(!isDisabled(row), 'the chip can be switched off')
      assert.equal(row.getAttribute('data-perm-mark'), badge, `the mark reads ${badge}`)
      assert.equal(row.getAttribute('aria-pressed'), 'true')
      assert.ok(!title(row).includes(pack.perm_outcome_full_only), 'the tooltip must not claim only Full reaches it')
      assert.ok(title(row).includes(pack.perm_tap_to_switch_off), 'the tooltip offers the switch-off')
    })

    await test(`${name}: ${action} switched off at Review can be handed back`, async () => {
      const row = chip(await render(pack, { products: 'review', [`products:${action}`]: false }), 'products', action)
      assert.ok(!isDisabled(row), 'a stored false must stay reachable at this level')
      assert.equal(row.getAttribute('data-perm-mark'), 'off')
      assert.ok(/line-through/.test(row.className))
      assert.equal(row.getAttribute('aria-pressed'), 'false')
      assert.ok(title(row).includes(pack.perm_tap_to_turn_on))
    })

    await test(`${name}: ${action} with no Products grant is not offered at all`, async () => {
      const surface = await render(pack, { product_cost_view: true })
      assert.equal(chips(surface, 'products', action).length, 0, 'a module at None draws no chips')
    })
  }

  await test(`${name}: a page tool that stays Full only is explained on its Review chip`, async () => {
    const surface = await render(pack, { products: 'review' })
    for (const { action, tool } of REVIEW_TIER_CASES) {
      assert.equal(title(chip(surface, 'products', action)).includes(pack.perm_action_review_tool_full ?? '\u0000'), tool === 'full only', `${action}: tooltip names the Full Access tool exactly when the tool differs`)
    }
  })
}

await test('a chip the level blocks is inert and neutral: disabled, aria-disabled, never pressed', async () => {
  const surface = await render(en, { products: 'review' })
  const bulk = chip(surface, 'products', 'bulk_delete')
  assert.ok(isDisabled(bulk), 'a Full only chip is inert at Review')
  assert.equal(bulk.getAttribute('data-perm-mark'), 'fullOnly')
  assert.equal(bulk.getAttribute('aria-disabled'), 'true')
  assert.equal(bulk.getAttribute('aria-pressed'), null, 'an inert chip is not "pressed"')
  assert.ok(title(bulk).includes(en.perm_outcome_full_only))

  const stored = chip(await render(en, { products: 'review', 'products:bulk_delete': false }), 'products', 'bulk_delete')
  assert.equal(stored.getAttribute('aria-pressed'), null, 'a stored false under a blocked level is still neutral')
  assert.equal(stored.getAttribute('data-perm-mark'), 'fullOnly')

  assert.equal(chips(await render(en, { pos: false }), 'pos', 'manage_address_presets').length, 0, 'POS off lists nothing')
  assert.equal(chips(await render(en, { pos: false, 'pos:manage_address_presets': false }), 'pos', 'manage_address_presets').length, 0, 'a stored false under POS off lists nothing either')

  const posOn = chip(await render(en, { pos: true }), 'pos', 'manage_address_presets')
  assert.equal(posOn.getAttribute('aria-pressed'), 'true')
  assert.equal(posOn.getAttribute('aria-disabled'), null)
})

await test('the View lock keeps its on state: pressed and disabled', async () => {
  const view = chip(await render(en, { contacts: true, 'contacts:add': true, 'contacts:view': false }), 'contacts', 'view')
  assert.ok(isDisabled(view) && view.getAttribute('aria-pressed') === 'true' && view.getAttribute('aria-disabled') === 'true')
  assert.ok(title(view).includes(en.perm_view_implied))
})

await test('the new tooltip is translated', async () => {
  assert.ok(en.perm_action_review_tool_full && km.perm_action_review_tool_full, 'both packs carry it')
  assert.notEqual(km.perm_action_review_tool_full, en.perm_action_review_tool_full)
  assert.ok(/[ក-៿]/.test(km.perm_action_review_tool_full))
})

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1
