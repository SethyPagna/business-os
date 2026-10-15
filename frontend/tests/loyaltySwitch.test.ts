import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const page = fs.readFileSync(new URL('../src/components/loyalty-points/LoyaltyPointsPage.tsx', import.meta.url), 'utf8')
const posAst = ts.createSourceFile('POS.tsx', pos, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const pageAst = ts.createSourceFile('LoyaltyPointsPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function evaluate(source: string, scope: Record<string, unknown> = {}): Record<string, any> {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('exports', ...Object.keys(scope), output)(exports, ...Object.values(scope))
  return exports
}

const resolver = posAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveOrderLoyaltyAccrual')
assert.ok(resolver)
const resolve = evaluate(resolver.getText(posAst)).resolveOrderLoyaltyAccrual
const settingsExpressions: string[] = []
function collectSettings(node: ts.Node): void {
  if (ts.isPropertyAssignment(node) && node.name.getText(pageAst) === 'loyalty_points_enabled') {
    settingsExpressions.push(node.initializer.getText(pageAst))
  }
  ts.forEachChild(node, collectSettings)
}
collectSettings(pageAst)
assert.equal(settingsExpressions.length, 3, 'initial form, loaded settings and saved payload are all covered')
const [initialSetting, loadedSetting, savedSetting] = settingsExpressions
const expression = (source: string, scope: Record<string, unknown> = {}) => evaluate(`export const value = (${source})`, scope).value
assert.equal(expression(initialSetting), false, 'first render defaults off before settings arrive')

const offSettings = [undefined, null, false, 0, '', 'false', 'OFF', ' no ', '0', 'invalid']
const onSettings = [true, 1, 'true', 'TRUE', ' on ', 'yes', '1']
for (const setting of offSettings) {
  assert.equal(expression(loadedSetting, { settings: { loyalty_points_enabled: setting } }), false)
  for (const override of [undefined, null, false, true, 'true', 1]) {
    assert.equal(resolve(override, setting), false, `disabled setting ${String(setting)} gates override ${String(override)}`)
  }
}
for (const setting of onSettings) {
  assert.equal(expression(loadedSetting, { settings: { loyalty_points_enabled: setting } }), true)
  assert.equal(resolve(undefined, setting), true)
  assert.equal(resolve(true, setting), true)
  assert.equal(resolve(false, setting), false, 'explicit false remains an opt-out')
}
for (const enabled of [false, true]) {
  assert.equal(expression(savedSetting, { form: { loyalty_points_enabled: enabled } }), String(enabled))
}

for (const choice of [false, true]) {
  const draft = JSON.parse(JSON.stringify({ loyaltyAccrual: choice }))
  assert.equal(resolve(draft.loyaltyAccrual, undefined), false)
  assert.equal(resolve(draft.loyaltyAccrual, 'true'), choice)
  assert.equal(resolve(draft.loyaltyAccrual, 'false'), false)
  assert.equal(JSON.parse(JSON.stringify({ loyalty_accrual: resolve(draft.loyaltyAccrual, 'false') })).loyalty_accrual, false)
}

let disabledExpression = ''
function collectSwitch(node: ts.Node): void {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(posAst) === 'button') {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
    const checked = attributes.find(attribute => attribute.name.getText(posAst) === 'aria-checked')
    if (checked?.initializer?.getText(posAst) === '{loyaltyAccrual}') {
      const disabled = attributes.find(attribute => attribute.name.getText(posAst) === 'disabled')
      assert.ok(disabled?.initializer && ts.isJsxExpression(disabled.initializer) && disabled.initializer.expression)
      disabledExpression = disabled.initializer.expression.getText(posAst)
    }
  }
  ts.forEachChild(node, collectSwitch)
}
collectSwitch(posAst)
assert.ok(disabledExpression)
for (const setting of [...offSettings, ...onSettings]) {
  assert.equal(expression(disabledExpression, { resolveOrderLoyaltyAccrual: resolve, settings: { loyalty_points_enabled: setting } }), !onSettings.some(value => value === setting))
}

const oldResolve = evaluate(`export function resolve(override: unknown, setting: unknown) {
  return typeof override === 'boolean' ? override : !['0', 'false', 'no', 'off'].includes(String(setting ?? 'true').trim().toLowerCase())
}`).resolve
assert.throws(() => assert.equal(oldResolve(undefined, undefined), false), 'old missing-setting default must fail')
assert.throws(() => assert.equal(oldResolve(true, 'false'), false), 'old explicit-true bypass must fail')
assert.throws(() => assert.equal(expression("!['0', 'false', 'no', 'off'].includes(String(settings.loyalty_points_enabled ?? 'true').trim().toLowerCase())", { settings: {} }), false), 'old settings hydration must fail')

console.log('PASS loyalty switch defaults, settings save, global gate, draft opt-out and disabled POS control; three old-behavior controls fail')
