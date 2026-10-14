import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const calls: unknown[][] = []
const originalWindow = (globalThis as any).window
const source = readFileSync(new URL('../src/api/systemRuntime.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const apiModule = { exports: {} as any }
new Function('exports', 'require', compiled)(apiModule.exports, (name: string) => name.includes('http') ? {
  apiFetch: (...args: unknown[]) => { calls.push(args); return Promise.resolve({ success: true }) },
  route: (_key: string, run: () => unknown) => run(),
} : { SYNC: { REQUEST_TIMEOUT_MS: 12000 } })
for (const mode of ['sales', 'products', 'all']) {
  const phrase = { sales: 'RESET SALES', products: 'RESET PRODUCTS', all: 'DELETE ALL DATA' }[mode]
  for (const options of [{}, { confirm: 'WRONG', acknowledged: true }, { confirm: 'WRONG', acknowledged: true, currentPassword: 'fixture' }, { confirm: phrase }, { confirm: phrase, currentPassword: 'fixture' }, { confirm: phrase, acknowledged: true }, { confirm: phrase, acknowledged: true, currentPassword: '' }]) {
    await assert.rejects(apiModule.exports.resetData(mode, options))
    assert.equal(calls.length, 0, 'invalid acknowledgement never sends a request')
  }
}
await assert.rejects(apiModule.exports.factoryReset({ confirm: 'FACTORY RESET', currentPassword: 'fixture' }))
assert.equal(calls.length, 0)
for (const [mode, confirm] of [['sales', 'RESET SALES'], ['products', 'RESET PRODUCTS'], ['all', 'DELETE ALL DATA']]) {
  await apiModule.exports.resetData(mode, { confirm, acknowledged: true, currentPassword: 'fixture' })
  assert.deepEqual(calls.at(-1)?.[2], { mode, confirm, acknowledged: true, currentPassword: 'fixture' })
}
await assert.rejects(apiModule.exports.resetData('unknown', { confirm: 'RESET SALES', acknowledged: true, currentPassword: 'fixture' }))
const sentBeforeSection = calls.length
for (const confirmation of [{}, { confirm: 'RESET CUSTOMERS' }, { confirm: 'RESET CUSTOMERS', acknowledged: true }, { confirm: 'RESET CUSTOMERS', currentPassword: 'fixture' }, { acknowledged: true, currentPassword: 'fixture' }, { confirm: 'RESET CUSTOMERS', acknowledged: true, currentPassword: '' }]) {
  await assert.rejects(apiModule.exports.resetSection('customers', confirmation))
}
assert.equal(calls.length, sentBeforeSection, 'a page reset missing the phrase, acknowledgement or password never sends a request')
await apiModule.exports.resetSection('customers', { confirm: 'RESET CUSTOMERS', acknowledged: true, currentPassword: 'fixture' })
assert.deepEqual(calls.at(-1)?.[2], { section: 'customers', confirm: 'RESET CUSTOMERS', acknowledged: true, currentPassword: 'fixture' })
await apiModule.exports.factoryReset({ confirm: 'FACTORY RESET', acknowledged: true, currentPassword: 'fixture' })
assert.equal((calls.at(-1)?.[2] as any).acknowledged, true)
console.log('PASS reset API refuses missing acknowledgement/wrong phrases/missing password; valid mode/section/factory payloads preserve acknowledgement and password')

let states: any[] = [], cursor = 0
const react = {
  useState(initial: any) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value: any) => { states[i] = value }] },
  useRef(initial: any) { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i] },
  useEffect() {},
}
const jsx = (type: any, props: any) => ({ type, props })
let user: any = { username: 'admin', role_code: 'admin' }
const requests: any[] = []
const notifications: any[] = []
const componentSource = readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
const builtInAdminModule = { exports: {} as any }
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/utils/builtInAdmin.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(builtInAdminModule.exports)
const componentModule = { exports: {} as any }
const code = ts.transpileModule(componentSource + '\nexport { ConfirmReset };', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
new Function('exports', 'require', code)(componentModule.exports, (name: string) => {
  if (name === 'react') return react
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
  if (name.includes('AppContext')) return { useApp: () => ({ user, hasPermission: () => true, notify: (...args: any[]) => notifications.push(args) }) }
  if (name.includes('actionGuards')) return { beginSingleAction: () => true, finishSingleAction() {} }
  if (name.includes('appRefresh')) return { refreshAppData() {} }
  if (name.includes('loaders')) return { withLoaderTimeout: (run: () => unknown) => run() }
  if (name.includes('builtInAdmin')) return builtInAdminModule.exports
  if (name.includes('permissions')) return { isAdminControlUser: () => true }
  return { default: () => null }
})
;(globalThis as any).window = { api: { resetData: async (...args: any[]) => { requests.push(args); return { success: true } }, factoryReset: async (...args: any[]) => { requests.push(args); return { success: true } }, resetSection: async (...args: any[]) => { requests.push(args); return { success: true } } } }
function render(name: string, props: any = {}) { cursor = 0; return componentModule.exports[name](props) }
function nodes(tree: any): any[] { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] }
function confirmation(tree: any) { return nodes(tree).find(node => node.type === componentModule.exports.ConfirmReset) }
for (const account of [{ username: 'other', role_code: 'admin' }, { username: 'admin', role_code: 'manager', permissions: { all: true } }, { username: 'admin', role_code: 'custom-admin', role_permissions: { all: true } }]) {
  user = account
  for (const panel of ['ResetData', 'SectionReset']) {
    states = []
    const prompt = confirmation(render(panel))
    assert.equal(prompt.props.allowed, false)
    await prompt.props.onConfirm({ confirm: panel === 'ResetData' ? 'RESET SALES' : 'RESET PRODUCTS', acknowledged: true, currentPassword: 'fixture' })
    assert.equal(requests.length, 0, 'other admin/full-grant account cannot reset stock')
  }
  states = [2, 'FACTORY RESET', true, 'fixture']
  const factoryButton = nodes(render('FactoryReset')).find(node => node.type === 'button' && node.props.onClick?.name === 'doFactoryReset')
  await factoryButton?.props.onClick()
  assert.equal(requests.length, 0)
}
user = { username: ' ADMIN ', role_code: ' Admin ' }
for (const panel of ['ResetData', 'SectionReset']) {
  states = []
  await confirmation(render(panel)).props.onConfirm({ confirm: panel === 'ResetData' ? 'RESET SALES' : 'RESET PRODUCTS', currentPassword: 'fixture' })
  assert.equal(requests.length, 0)
}
for (const panel of ['ResetData', 'SectionReset']) {
  states = []
  assert.equal(confirmation(render(panel)).props.requirePassword, true, 'the reset dialog asks for the current password')
  await confirmation(render(panel)).props.onConfirm({ confirm: panel === 'ResetData' ? 'RESET SALES' : 'RESET PRODUCTS', acknowledged: true })
  assert.equal(requests.length, 0, 'a submit without the password never reaches the API')
}
states = []
await confirmation(render('ResetData')).props.onConfirm({ confirm: 'RESET SALES', acknowledged: true, currentPassword: 'fixture' })
assert.deepEqual(requests.pop(), ['sales', { confirm: 'RESET SALES', acknowledged: true, currentPassword: 'fixture' }])
states = ['all']
await confirmation(render('ResetData')).props.onConfirm({ confirm: 'DELETE ALL DATA', acknowledged: true, currentPassword: 'fixture' })
assert.deepEqual(requests.pop(), ['all', { confirm: 'DELETE ALL DATA', acknowledged: true, currentPassword: 'fixture' }])
states = []
await confirmation(render('SectionReset')).props.onConfirm({ confirm: 'RESET PRODUCTS', acknowledged: true, currentPassword: 'fixture' })
assert.deepEqual(requests.pop(), ['products', { includeMovements: false, includeSales: false, includeImages: false, confirm: 'RESET PRODUCTS', acknowledged: true, currentPassword: 'fixture' }])
for (const ack of [false, true]) {
  states = [2, 'FACTORY RESET', ack, 'fixture']
  const button = nodes(render('FactoryReset')).find(node => node.type === 'button' && node.props.onClick?.name === 'doFactoryReset')
  await button.props.onClick()
  if (ack) assert.deepEqual(requests.pop(), [{ confirm: 'FACTORY RESET', acknowledged: true, currentPassword: 'fixture' }])
  else assert.equal(requests.length, 0)
}
user = { username: 'other', role_code: 'manager' }
states = ['customers']
await confirmation(render('SectionReset')).props.onConfirm({ confirm: 'RESET CUSTOMERS', acknowledged: true })
assert.equal(requests.length, 0, 'a page reset without the password never reaches the API')
await confirmation(render('SectionReset')).props.onConfirm({ confirm: 'RESET CUSTOMERS', acknowledged: true, currentPassword: 'fixture' })
assert.deepEqual(requests.pop(), ['customers', { confirm: 'RESET CUSTOMERS', acknowledged: true, currentPassword: 'fixture' }], 'ordinary resetSection permission behavior remains unchanged: no built-in-admin gate, the password rides along')
console.log('PASS real reset components reject other admins/full grants and admit normalized built-in account')

let accepted: any
const props = { title: 'Fixture', description: '', whatDeleted: '', confirmWord: 'RESET SALES', working: false, buttonLabel: 'Reset', onConfirm: (value: any) => { accepted = value } }
states = [2, 'RESET SALES', false]
let tree = render('ConfirmReset', props)
let button = nodes(tree).find(node => node.type === 'button' && node.props.className.includes('text-white'))
assert.equal(button.props.disabled, true)
button.props.onClick()
assert.equal(accepted, undefined, 'typed phrase alone does not acknowledge warning')
states = []
tree = render('ConfirmReset', props)
nodes(tree).find(node => node.type === 'button').props.onClick()
tree = render('ConfirmReset', props)
nodes(tree).find(node => node.type === 'button').props.onClick()
tree = render('ConfirmReset', props)
nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'RESET SALES' } })
tree = render('ConfirmReset', props)
button = nodes(tree).find(node => node.type === 'button' && node.props.className.includes('text-white'))
assert.equal(button.props.disabled, false)
button.props.onClick()
assert.deepEqual(accepted, { confirm: 'RESET SALES', acknowledged: true })
console.log('PASS existing warning→typed stage records first acknowledgement without extra modal')

accepted = undefined
const passwordProps = { ...props, requirePassword: true, username: 'admin' }
states = [2, 'RESET SALES', true, '']
button = nodes(render('ConfirmReset', passwordProps)).find(node => node.type === 'button' && node.props.className.includes('text-white'))
assert.equal(button.props.disabled, true, 'phrase and acknowledgement alone do not enable a password-requiring reset')
button.props.onClick()
assert.equal(accepted, undefined)
tree = render('ConfirmReset', passwordProps)
const passwordInput = nodes(tree).find(node => node.type === 'input' && node.props.type === 'password')
assert.ok(passwordInput, 'the dialog asks for the current password')
passwordInput.props.onChange({ target: { value: 'fixture' } })
tree = render('ConfirmReset', passwordProps)
button = nodes(tree).find(node => node.type === 'button' && node.props.className.includes('text-white'))
assert.equal(button.props.disabled, false)
button.props.onClick()
assert.deepEqual(accepted, { confirm: 'RESET SALES', acknowledged: true, currentPassword: 'fixture' })
console.log('PASS password-requiring confirmation stays disabled until the password is typed and forwards it')
;(globalThis as any).window = originalWindow
