import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fmtDateTime24 } from '../src/utils/formatters.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(new URL('../src/components/shared/WriteConflictModal.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText
const pack = (language: string) => JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
function render(language: string, conflict: any) {
  const messages = pack(language)
  const module = { exports: {} as any }
  const dependencies: Record<string, any> = {
    './Modal': { default: ({ title, children }: any) => React.createElement('section', { role: 'dialog' }, title, children) },
    './ConflictIcon.ts': { ConflictIcon: () => null, CONFLICT_ICON_CLASS: '' },
    '../../utils/formatters.ts': { fmtDateTime24 },
    '../../app/AppContextCore.tsx': { useApp: () => ({ t: (key: string) => messages[key] ?? key }) },
  }
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id in dependencies) return dependencies[id]
    if (id === 'react/jsx-runtime' || id === 'react') return require(id)
    throw new Error(`Unexpected component dependency: ${id}`)
  }, module, module.exports)
  const calls: string[] = []
  const tree = module.exports.default({ conflict, onClose: () => calls.push('close'), onReload: () => calls.push('reload') })
  const html = renderToStaticMarkup(tree)
  return { html, tree, calls, messages }
}
const text = (tree: any): string => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join('') : tree ? text(tree.props?.children) : ''
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
let failures = 0
function check(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}`, error) }
}
for (const language of ['en', 'km']) {
  check(language + ': SQL UTC and ISO timestamps display the same Cambodia day and hour on every client timezone', () => {
    const previousZone = process.env.TZ
    try {
      for (const zone of ['Asia/Phnom_Penh', 'America/New_York', 'UTC']) {
        process.env.TZ = zone
        for (const raw of ['2026-10-03 20:30:00', '2026-10-03T20:30:00Z', '2026-10-04T03:30:00+07:00']) {
          const { html } = render(language, { entity: 'branch', expectedUpdatedAt: raw, actualUpdatedAt: raw, current: { updated_at: raw } })
          assert.equal(html.split('04/10/2026 03:30').length - 1, 3, zone + ': raw SQL UTC must not become client-local time')
        }
      }
    } finally {
      if (previousZone === undefined) delete process.env.TZ
      else process.env.TZ = previousZone
    }
  })
  check(language + ': absent branch snapshot is unknown while a known empty value stays empty', () => {
    for (const current of [null, undefined, {}]) {
      const { tree, messages } = render(language, { entity: 'branch', attempted: { notes: 'Retained attempt' }, current })
      const rows = nodes(tree).filter(node => node.key === 'notes')
      assert.equal(rows.length, 1)
      assert(text(rows[0]).includes(messages.unknown), 'Missing branch snapshot must remain Unknown')
      assert(!text(rows[0]).includes(messages.write_conflict_empty), 'Unavailable saved data is not a known empty value')
      assert(text(rows[0]).includes('Retained attempt'))
    }
    const { tree, messages } = render(language, { entity: 'branch', attempted: { notes: 'Retained attempt' }, current: { notes: '' } })
    const rows = nodes(tree).filter(node => node.key === 'notes')
    assert.equal(rows.length, 1)
    assert(text(rows[0]).includes(messages.write_conflict_empty))
    assert(!text(rows[0]).includes(messages.unknown))
  })
  check(`${language}: rendered branch conflict localizes chrome and preserves real descriptions`, () => {
    const { html, messages } = render(language, { entity: 'branch', entityLabel: 'Branch',
      attempted: { notes: 'My description <script>keep as text</script>', location: '', is_default: false },
      current: { id: 27, name: 'Old Shop', location: null, notes: 'Saved description', is_default: true, updated_at: '2026-10-03T00:00:00Z' },
      expectedUpdatedAt: '2026-10-03T00:00:00Z', actualUpdatedAt: null })
    assert(html.includes(messages.dismiss), 'Dismiss must use the selected language')
    for (const key of ['write_conflict_title', 'write_conflict_older_version', 'write_conflict_background_refresh',
      'write_conflict_expected_version', 'write_conflict_latest_version', 'write_conflict_comparison',
      'write_conflict_your_edit', 'write_conflict_current_saved', 'write_conflict_details', 'write_conflict_reload_latest',
      'description', 'yes', 'no', 'unknown', 'write_conflict_empty']) {
      assert.equal(typeof messages[key], 'string', `${language} has ${key}`)
      const expected = messages[key].replace('{entity}', messages.branch).replace('{entityLower}', messages.branch.toLowerCase())
      assert(html.includes(expected), `${language} renders ${key}`)
    }
    assert(html.includes('My description &lt;script&gt;keep as text&lt;/script&gt;'))
    assert(html.includes('Saved description'))
    assert(html.includes(fmtDateTime24(new Date('2026-10-03T00:00:00Z'))))
    assert(!html.includes('>null<'))
    for (const key of ['default', 'updated']) assert(nodes(render(language, { entity: 'branch', current: { is_default: true, updated_at: '2026-10-03T00:00:00Z' } }).tree)
      .some(node => (node.type === 'span' || node.type === 'div') && text(node.props.children) === messages[key]), `${language} renders mapped ${key} label`)
    for (const key of ['is_default', 'updated_at']) assert(!html.includes('>' + key + '</'), `${language} must not expose raw known field ${key}`)
  })
  check(`${language}: existing variants render localized known labels without translating stored values`, () => {
    const cases = [
      ['sale', { sale_status: 'pending-custom', customer_name: 'Customer raw', notes: 'Notes raw' }, ['status', 'customer', 'notes']],
      ['return', { reason: 'Reason raw', return_type: 'Type raw', notes: 'Notes raw', total_refund_usd: 12, items: [{ quantity: 2, return_to_stock: false }] }, ['reason', 'type', 'notes', 'refund', 'items']],
      ['user', { name: 'Name raw', username: 'userraw', email: 'fixture@example.invalid', phone: 'Phone raw', role_name: 'Role raw', is_active: true }, ['name', 'username', 'email', 'phone', 'role', 'active']],
      ['role', { name: 'Role raw', code: 'custom-code', permissions: { untouched: true } }, ['role_name', 'permissions']],
      ['product', { name: 'Product raw', barcode: 'barcode-raw' }, ['product', 'barcode']],
      ['settings', { name: 'Name raw', custom_device_flag: true, notes: '' }, ['name']],
    ] as const
    for (const [entity, values, keys] of cases) {
      const { html, messages } = render(language, { entity, entityLabel: entity, attempted: values, current: values })
      for (const key of keys) assert(html.includes(messages[key]), `${entity}: ${key}`)
      if (entity === 'sale') assert(html.includes('pending-custom'))
      if (entity === 'settings') { assert(html.includes('custom_device_flag')); assert(html.includes(messages.yes)) }
      if (entity === 'return') { assert(html.includes(messages.item)); assert(html.includes(messages.write_conflict_no_restock)) }
    }
  })
  check(`${language}: known generic entities localize and unknown identity remains exact`, () => {
    for (const [entity, key] of [['fee', 'write_conflict_fee'], ['customer', 'customer'], ['supplier', 'supplier'],
      ['delivery_contact', 'delivery_contact'], ['category', 'category'], ['ai_provider_config', 'write_conflict_ai_provider'],
      ['unit', 'unit'], ['file asset', 'write_conflict_file']]) {
      const { html, messages } = render(language, { entity, entityLabel: `English ${entity}`, current: { name: 'Saved raw', custom_identity: 'Custom raw' } })
      assert(html.includes(messages[key]), `${entity} translated`)
      assert(html.includes('custom_identity')); assert(html.includes('Custom raw'))
      assert(!html.includes(`English ${entity}`))
    }
    const { html } = render(language, { entity: 'future_kind', entityLabel: 'Future Label', current: { future_field: null, updated_at: 'unparsed timestamp' } })
    assert(html.includes('Future Label')); assert(html.includes('future_field')); assert(html.includes('unparsed timestamp'))
    const unusual = render(language, { entity: 'constructor', entityLabel: 'Custom Identity', current: { constructor: 'Stored raw' } })
    assert(unusual.html.includes('Custom Identity')); assert(unusual.html.includes('constructor')); assert(unusual.html.includes('Stored raw'))
    const collision = render(language, { entity: 'future_kind', current: { cancel: 'Unchanged custom data' } })
    assert(collision.html.includes('>cancel<'), 'Unknown field identifiers must not become unrelated translated UI actions')
    assert(collision.html.includes('Unchanged custom data'))
    const flags = render(language, { entity: 'user', attempted: { is_active: 0 }, current: { is_active: 1 } })
    assert(flags.html.includes(flags.messages.no)); assert(flags.html.includes(flags.messages.yes))
  })
  check(`${language}: rendered action callbacks and read-only Modal contract remain exact`, () => {
    const { tree, calls, messages } = render(language, { entity: 'branch', current: { notes: 'Saved' } })
    assert.equal(tree.props.unsavedChanges, 'read-only'); assert.equal(tree.props.size, 'lg')
    const buttons = nodes(tree).filter(node => node.type === 'button')
    assert.equal(buttons.length, 2)
    assert.equal(text(buttons[0]), messages.dismiss)
    buttons[0].props.onClick(); buttons[1].props.onClick(); tree.props.onClose()
    assert.deepEqual(calls, ['close', 'reload', 'close'])
    assert.equal(render(language, null).html, '')
  })
  check(`${language}: distinct fields keep unique React identities when their translated labels match`, () => {
    const { tree, html } = render(language, { entity: 'settings',
      attempted: { status: 'First attempted', sale_status: 'Second attempted' },
      current: { status: 'First saved', sale_status: 'Second saved' } })
    for (const value of ['First attempted', 'Second attempted', 'First saved', 'Second saved']) assert(html.includes(value))
    let keyedLists = 0
    for (const node of nodes(tree)) {
      if (!Array.isArray(node.props?.children)) continue
      const keys = node.props.children.filter((child: any) => child?.key != null).map((child: any) => child.key)
      if (keys.length < 2) continue
      keyedLists++
      assert.equal(new Set(keys).size, keys.length, 'Distinct source fields must not share a translated React key')
    }
    assert.equal(keyedLists, 2)
  })
}
if (failures) process.exitCode = 1
