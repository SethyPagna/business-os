// The Audit Log detail float: the recorded context, and what a row with only
// one side is allowed to claim.
//
// Two defects the phase-1 verification found on real rows, pinned here against
// the real builder and the real line component:
//
//   E6  `details` -- the payload a route writes beside the pair (a payment
//       method rename's linked-sale counts, a profile save's mode, the
//       operator's reason) -- was never rendered in the float. An opted-in
//       save whose columns happened not to move showed NOTHING at all.
//   E4  A row with no old side (a legacy row whose payload is the details, a
//       create) was rendered as a wall of additions: `From | null | Coke
//       330 ml [added]`. Nothing was added. Those are context rows now, and
//       added/removed/changed is reserved for rows carrying both sides --
//       which is the discriminating pair below: same shape, opposite answer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { buildAuditFieldDiff } from '../src/utils/auditLogFieldDiff.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')

// The line component, compiled from source: what the page actually renders.
const lineSource = readFileSync(new URL('../src/components/utils-settings/AuditFieldDiffLine.tsx', import.meta.url), 'utf8')
const lineModule = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', transformSync(lineSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(
  (id: string) => require(id),
  lineModule,
  lineModule.exports,
)
const AuditFieldDiffLine = lineModule.exports.default as React.ComponentType<{ row: unknown }>

const render = (rows: unknown[]): string => renderToStaticMarkup(
  React.createElement('div', null, rows.map((row, index) => React.createElement(AuditFieldDiffLine, { key: index, row }))),
)

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// ---------------------------------------------------------------- fixtures
// A legacy group-scope rename: no old side at all, the payload IS the details.
const LEGACY_RENAME = JSON.stringify({ from: 'Coke 330 ml', to: 'Coke Zero', rows: 1, scope: 'group' })

// An opted-in payment-method rename (cloudflare/src/routes/settings.ts): the
// pair is written to old_value/new_value, the counts stay in details.
const RENAME_BEFORE = JSON.stringify({ payment_method: 'ABA', configured_methods: ['Cash', 'ABA'] })
const RENAME_AFTER = JSON.stringify({ payment_method: 'ABA Bank', configured_methods: ['Cash', 'ABA Bank'] })
const RENAME_DETAILS = JSON.stringify({
  action: 'payment_method_replace', from: 'ABA', to: 'ABA Bank', scope: 'linked', linkedSales: 12, linkedDetails: 30,
})

// An opted-in profile save that changed nothing (users.ts writes { mode }).
const PROFILE_SAME = JSON.stringify({ name: 'Dara', phone: '012' })
const PROFILE_DETAILS = JSON.stringify({ mode: 'profile' })

test('E4: a legacy details row is CONTEXT, never a wall of additions', () => {
  const rows = buildAuditFieldDiff(null, LEGACY_RENAME)
  assert.equal(rows.length, 4)
  assert.deepEqual([...new Set(rows.map((row) => row.changeType))], ['context'])
  const html = render(rows)
  assert.ok(html.includes('data-audit-diff-row="context"'))
  assert.ok(!html.includes('line-through'), 'a context row must not strike anything out')
  assert.ok(!html.includes('&#x2192;') && !html.includes('→'), 'a context row has nothing to point at')
  // The values are still there -- this is about the claim, not about hiding.
  for (const value of ['Coke 330 ml', 'Coke Zero', 'From', 'To', 'Scope']) {
    assert.ok(html.includes(value), `${value} disappeared from the context row`)
  }
})

test('DISCRIMINATING CONTROL: the same field WITH both sides is still a change', () => {
  const rows = buildAuditFieldDiff(JSON.stringify({ to: 'Coke Zero' }), JSON.stringify({ to: 'Coke Zero 330 ml' }))
  assert.equal(rows[0].changeType, 'changed')
  const html = render(rows)
  assert.ok(html.includes('line-through'), 'a real change still shows what it was')
  // And a key that genuinely appears only on the new side of a real pair is
  // still an addition -- the badge vocabulary survives where it means
  // something.
  const added = buildAuditFieldDiff(JSON.stringify({ to: 'A' }), JSON.stringify({ to: 'A', note: 'added later' }))
  assert.equal(added.length, 1)
  assert.equal(added[0].changeType, 'added')
  assert.ok(render(added).includes('data-audit-diff-row="added"'))
})

test('E6: the recorded context renders from `details`, beside the pair', () => {
  const pair = buildAuditFieldDiff(RENAME_BEFORE, RENAME_AFTER)
  const pairHtml = render(pair)
  assert.ok(pairHtml.includes('ABA Bank'))
  assert.ok(pairHtml.includes('data-audit-diff-row="changed"'))

  // The float builds the context block with the SAME call the page makes.
  const context = buildAuditFieldDiff(null, RENAME_DETAILS)
  const labels = context.map((row) => row.label)
  assert.ok(labels.includes('Linked Sales'), `linked sale count missing: ${labels.join(', ')}`)
  assert.ok(labels.includes('Linked Details'))
  assert.ok(labels.includes('Scope'))
  const html = render(context)
  assert.ok(html.includes('12') && html.includes('30'), 'the counts the rename actually touched')
  assert.deepEqual([...new Set(context.map((row) => row.changeType))], ['context'])
})

test('E6: an opted-in save with an empty diff still has something to show', () => {
  assert.deepEqual(buildAuditFieldDiff(PROFILE_SAME, PROFILE_SAME), [], 'nothing moved')
  const context = buildAuditFieldDiff(null, PROFILE_DETAILS)
  assert.equal(context.length, 1)
  assert.equal(context[0].label, 'Mode')
  assert.equal(context[0].after, 'profile')

  // ...and the page says so in words rather than rendering an empty box.
  const page = readFileSync(new URL('../src/components/utils-settings/AuditLog.tsx', import.meta.url), 'utf8')
  assert.match(page, /const contextRows = buildAuditFieldDiff\(null, detailLog\.details\)/)
  assert.match(page, /if \(!hasRawData && !contextRows\.length\) return null/)
  assert.match(page, /hasRawData && !fieldDiffRows\.length \? \([\s\S]{0,400}copy\('no_field_changed'/)
  assert.match(page, /copy\('recorded_context'/)
  // One line component for both blocks: the pair and the context cannot drift.
  assert.match(page, /fieldDiffRows\.map\(\(row\) => <AuditFieldDiffLine/)
  assert.match(page, /contextRows\.map\(\(row\) => <AuditFieldDiffLine/)
})

test('a nested object is nested rows, not one unreadable line', () => {
  const rows = buildAuditFieldDiff(
    JSON.stringify({ address: { street: 'St 271', city: 'Phnom Penh' } }),
    JSON.stringify({ address: { street: 'St 271', city: 'Siem Reap' } }),
  )
  assert.equal(rows.length, 1, 'only the child that moved')
  assert.equal(rows[0].label, 'Address - City')
  assert.equal(rows[0].depth, 1)
  assert.equal(rows[0].before, 'Phnom Penh')
  assert.equal(rows[0].after, 'Siem Reap')
  // POSITIVE CONTROL: past the depth cap the flattened line is still used, so
  // a deep payload cannot explode into hundreds of rows.
  const deep = buildAuditFieldDiff(null, JSON.stringify({ a: { b: { c: { d: 'x' } } } }))
  assert.equal(deep.length, 1)
  assert.equal(deep[0].depth, 2)
  assert.equal(deep[0].label, 'A - B - C')
})

test('a long value gets its own scrolling block, not an endless row', () => {
  const template = 'LINE '.repeat(400)
  const rows = buildAuditFieldDiff(null, JSON.stringify({ receipt_template: template, shop_name: 'Shop' }))
  const long = rows.find((row) => row.key === 'receipt_template')
  const short = rows.find((row) => row.key === 'shop_name')
  assert.ok(long?.long, 'the template must be flagged long')
  assert.equal(short?.long, false, 'a short value must not be')
  const html = render([long, short])
  assert.match(html, /<pre class="max-h-40 overflow-auto/)
  assert.equal((html.match(/<pre /g) || []).length, 1, 'only the long value gets a block')
})

if (failed) { console.error(`${failed} audit detail context case(s) failed`); process.exit(1) }
console.log('audit detail context: all cases pass')
