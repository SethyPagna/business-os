// What the role editor shows for the Products switches the Worker honours at Partial Access, checked against the
// Worker's own evaluation: the real getActionTier for each tier and switch state, the route source for what a
// Partial Access caller gets, and the real editor rendered in English and Khmer.
//
// Run: node tests/permissionPartialTier.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { getActionTier } from '../../cloudflare/src/lib/permissions.ts'
import { PERMISSION_ACTIONS, actionAllowed, outcomeAt, type ActionOutcome } from '../src/utils/permissionActions.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const productsRoute = readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const rowOf = (section: string, key: string) => PERMISSION_ACTIONS[section].find((action) => action.key === key)!
const workerTier = (permissions: Record<string, unknown>, section: string, action: string) =>
  getActionTier({ role_code: 'staff', permissions: JSON.stringify(permissions) }, section, action)

// What a Partial Access caller gets from the Worker for each switch that is not off, read from the routes.
const PARTIAL_ACCESS: Array<{ action: string; label: string; badge: ActionOutcome; tool: 'full only' | 'same'; proof: RegExp[] }> = [
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

test('the Worker evaluates each of these switches as Partial Access unless it is off', () => {
  for (const { action } of PARTIAL_ACCESS) {
    assert.equal(workerTier({}, 'products', action), 'none', `${action}: no Products grant`)
    assert.equal(workerTier({ products: 'review' }, 'products', action), 'review', `${action}: Partial Access, not switched off`)
    assert.equal(workerTier({ products: 'review', [`products:${action}`]: false }, 'products', action), 'none', `${action}: Partial Access, switched off`)
    assert.equal(workerTier({ products: true }, 'products', action), 'full', `${action}: Full Access`)
    assert.equal(workerTier({ products: true, [`products:${action}`]: false }, 'products', action), 'none', `${action}: Full Access, switched off`)
  }
})

test('the routes still treat Partial Access the way the table says', () => {
  for (const { action, proof } of PARTIAL_ACCESS) {
    for (const pattern of proof) assert.match(productsRoute, pattern, `${action}: the Worker no longer behaves as pinned (${pattern})`)
  }
})

test('the table gives each switch the outcome the Worker gives it at Partial Access', () => {
  for (const { action, badge } of PARTIAL_ACCESS) {
    assert.equal(outcomeAt(rowOf('products', action), 'review'), badge, `${action} at Partial Access`)
    assert.equal(outcomeAt(rowOf('products', action), 'full'), 'allow', `${action} at Full Access`)
    assert.equal(outcomeAt(rowOf('products', action), 'none'), 'block', `${action} with no Products grant`)
  }
})

test('the page tool behind a row keeps its own Partial Access answer', () => {
  for (const { action, tool } of PARTIAL_ACCESS) {
    const expected = tool === 'full only' ? false : true
    assert.equal(actionAllowed('products', action, 'review'), expected, `${action}: the page control at Partial Access`)
    assert.equal(actionAllowed('products', action, 'full'), true)
    assert.equal(actionAllowed('products', action, 'full', () => false, (section, key) => section === 'products' && key === action), false, `${action}: switched off wins`)
    assert.equal(actionAllowed('products', action, 'review', () => false, (section, key) => section === 'products' && key === action), false, `${action}: switched off wins at Partial Access`)
  }
})

test('a row that shows a different outcome from its page tool says so and only does so at Partial Access', () => {
  for (const [section, actions] of Object.entries(PERMISSION_ACTIONS)) {
    for (const action of actions) {
      if (action.controlReview === undefined) continue
      assert.equal(action.controlReview, 'block', `${section}.${action.key}: only a stricter page tool is modelled`)
      assert.notEqual(action.review, 'block', `${section}.${action.key}: a blocked row has no second outcome to describe`)
      assert.equal(actionAllowed(section, action.key, 'view'), outcomeAt(action, 'view') !== 'block', `${section}.${action.key}: View only is unaffected`)
      assert.equal(actionAllowed(section, action.key, 'full'), true, `${section}.${action.key}: Full Access is unaffected`)
    }
  }
})

const stubs: Record<string, string> = {
  InfoHint: `export default function InfoHint(props) { return null }`,
  AppSelect: `export default function AppSelect(props) { return null }`,
}
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/users/PermissionEditor.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  plugins: [{
    name: 'stub-shared-widgets',
    setup(b) {
      b.onResolve({ filter: /shared\/(InfoHint|AppSelect)\.tsx$/ }, (args) => ({ path: args.path.replace(/.*shared\/(\w+)\.tsx$/, '$1'), namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }))
    },
  }],
})
const mod = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(nodeRequire, mod, mod.exports)
const PermissionEditor = mod.exports.default as React.ComponentType<Record<string, unknown>>

const render = (pack: Record<string, string>, permissions: Record<string, unknown>) => renderToStaticMarkup(React.createElement(PermissionEditor, {
  permissions, onChange: () => {}, t: (key: string) => pack[key],
}))
const rowButton = (html: string, label: string): string => {
  const found = html.match(new RegExp(`<button(?:(?!</button>)[\\s\\S])*?${label}(?:(?!</button>)[\\s\\S])*?</button>`))
  assert.ok(found, `the editor renders no "${label}" row`)
  return found[0]
}
const attribute = (button: string, name: string): string | null => button.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null
const isDisabled = (button: string) => /<button[^>]*\sdisabled(?:=""|\s|>)/.test(button)

for (const [name, pack] of [['English', en], ['Khmer', km]] as const) {
  for (const { action, label, badge } of PARTIAL_ACCESS) {
    const text = pack[label]
    const badgeText = pack[badge === 'queue' ? 'perm_outcome_queue' : 'perm_outcome_allow']

    test(`${name}: ${action} at Partial Access is a real control showing what the Worker does`, () => {
      const row = rowButton(render(pack, { products: 'review' }), text)
      assert.ok(!isDisabled(row), 'the row can be switched off')
      assert.ok(row.includes(`>${badgeText}<`), `the badge reads ${badgeText}`)
      assert.equal(attribute(row, 'aria-pressed'), 'true')
      assert.ok(!(attribute(row, 'title') ?? '').includes(pack.perm_action_tier_blocked), 'the tooltip must not claim the tier blocks it')
      assert.ok((attribute(row, 'title') ?? '').includes(pack.perm_action_switch_off), 'the tooltip offers the switch-off')
    })

    test(`${name}: ${action} switched off at Partial Access can be handed back`, () => {
      const row = rowButton(render(pack, { products: 'review', [`products:${action}`]: false }), text)
      assert.ok(!isDisabled(row), 'a stored false must stay reachable at this tier')
      assert.ok(row.includes(`>${pack.perm_action_off}<`) && row.includes('line-through'))
      assert.equal(attribute(row, 'aria-pressed'), 'false')
      assert.ok((attribute(row, 'title') ?? '').includes(pack.perm_action_restore))
    })

    test(`${name}: ${action} with no Products grant is inert, neutral and says the tier blocks it`, () => {
      const row = rowButton(render(pack, { product_cost_view: true }), text)
      assert.ok(isDisabled(row))
      assert.ok(row.includes(`>${pack.perm_outcome_block}<`))
      assert.equal(attribute(row, 'aria-disabled'), 'true')
      assert.equal(attribute(row, 'aria-pressed'), null)
      assert.equal(attribute(row, 'title'), pack.perm_action_tier_blocked)
    })
  }

  test(`${name}: a page tool that stays Full only is explained on its Partial Access row`, () => {
    const html = render(pack, { products: 'review' })
    for (const { action, label, tool } of PARTIAL_ACCESS) {
      const title = attribute(rowButton(html, pack[label]), 'title') ?? ''
      assert.equal(title.includes(pack.perm_action_review_tool_full ?? '\u0000'), tool === 'full only', `${action}: tooltip names the Full Access tool exactly when the tool differs`)
    }
  })
}

test('a row the tier blocks is inert and neutral: disabled, aria-disabled, never pressed', () => {
  const html = render(en, { products: 'review' })
  const bulk = rowButton(html, en.perm_act_products_bulk_delete)
  assert.ok(isDisabled(bulk), 'a Full only row is inert at Partial Access')
  assert.ok(bulk.includes(`>${en.perm_outcome_block}<`))
  assert.equal(attribute(bulk, 'aria-disabled'), 'true')
  assert.equal(attribute(bulk, 'aria-pressed'), null, 'a disabled Hidden row is not "pressed"')
  assert.equal(attribute(bulk, 'title'), en.perm_action_tier_blocked)

  const pos = rowButton(render(en, { pos: false }), en.manage_address_presets)
  assert.ok(isDisabled(pos) && attribute(pos, 'aria-disabled') === 'true' && attribute(pos, 'aria-pressed') === null)
  const posOff = rowButton(render(en, { pos: false, 'pos:manage_address_presets': false }), en.manage_address_presets)
  assert.equal(attribute(posOff, 'aria-pressed'), null, 'a stored false under a blocked tier is still neutral')

  const posOn = rowButton(render(en, { pos: true }), en.manage_address_presets)
  assert.equal(attribute(posOn, 'aria-pressed'), 'true')
  assert.equal(attribute(posOn, 'aria-disabled'), null)
})

test('the View lock keeps its on state: pressed and disabled', () => {
  const html = render(en, { contacts: true, 'contacts:add': true, 'contacts:view': false })
  const view = rowButton(html, `${en.perm_act_contacts_view}<`)
  assert.ok(isDisabled(view) && attribute(view, 'aria-pressed') === 'true' && attribute(view, 'aria-disabled') === 'true')
  assert.equal(attribute(view, 'title'), en.perm_view_implied)
})

test('the new tooltip is translated', () => {
  assert.ok(en.perm_action_review_tool_full && km.perm_action_review_tool_full, 'both packs carry it')
  assert.notEqual(km.perm_action_review_tool_full, en.perm_action_review_tool_full)
  assert.ok(/[ក-៿]/.test(km.perm_action_review_tool_full))
})

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1
