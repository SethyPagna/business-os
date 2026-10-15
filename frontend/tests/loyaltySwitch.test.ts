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
let switchElement: ts.Node | undefined
function collectSwitch(node: ts.Node): void {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(posAst) === 'button') {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
    const checked = attributes.find(attribute => attribute.name.getText(posAst) === 'aria-checked')
    if (checked?.initializer?.getText(posAst) === '{loyaltyAccrual}') {
      switchElement = node.parent
      const disabled = attributes.find(attribute => attribute.name.getText(posAst) === 'disabled')
      assert.ok(disabled?.initializer && ts.isJsxExpression(disabled.initializer) && disabled.initializer.expression)
      disabledExpression = disabled.initializer.expression.getText(posAst)
    }
  }
  ts.forEachChild(node, collectSwitch)
}
collectSwitch(posAst)
assert.ok(disabledExpression)
assert.ok(switchElement)
for (const setting of [...offSettings, ...onSettings]) {
  assert.equal(expression(disabledExpression, { resolveOrderLoyaltyAccrual: resolve, settings: { loyalty_points_enabled: setting } }), !onSettings.some(value => value === setting))
}

function switchStyles(enabled: boolean): string[] {
  const result: string[] = []
  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attribute = node.attributes.properties.filter(ts.isJsxAttribute).find(item => item.name.getText(posAst) === 'className')
      const value = attribute?.initializer
      if (value && ts.isStringLiteral(value)) result.push(value.text)
      else if (value && ts.isJsxExpression(value) && value.expression) result.push(expression(value.expression.getText(posAst), { loyaltyAccrual: enabled }))
    }
    ts.forEachChild(node, visit)
  }
  visit(switchElement!)
  return result
}
for (const enabled of [false, true]) {
  const [button, track, thumb] = switchStyles(enabled)
  assert.match(button, /\bh-11 w-11\b/, 'compact visual track retains a 44px touch target')
  assert.match(track, /\bleft-1 top-3 h-5 w-9\b/, 'track is centered in its touch target')
  assert.match(thumb, /\bleft-0\.5 top-0\.5\b/, 'thumb needs an explicit anchor before translation')
  assert.ok(thumb.split(' ').includes(enabled ? 'translate-x-4' : 'translate-x-0'))
}
assert.throws(() => assert.match('absolute top-0.5 h-4 w-4 translate-x-4', /\bleft-0\.5 top-0\.5\b/), 'old unanchored thumb must fail')

const oldResolve = evaluate(`export function resolve(override: unknown, setting: unknown) {
  return typeof override === 'boolean' ? override : !['0', 'false', 'no', 'off'].includes(String(setting ?? 'true').trim().toLowerCase())
}`).resolve
assert.throws(() => assert.equal(oldResolve(undefined, undefined), false), 'old missing-setting default must fail')
assert.throws(() => assert.equal(oldResolve(true, 'false'), false), 'old explicit-true bypass must fail')
assert.throws(() => assert.equal(expression("!['0', 'false', 'no', 'off'].includes(String(settings.loyalty_points_enabled ?? 'true').trim().toLowerCase())", { settings: {} }), false), 'old settings hydration must fail')

const copyDeclaration = pageAst.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations).find(declaration => declaration.name.getText(pageAst) === 'COPY')
assert.ok(copyDeclaration?.initializer)
const localeCopy = expression(copyDeclaration.initializer.getText(pageAst))
function verifySwitchHint(hint: string, locale: 'en' | 'km'): void {
  if (locale === 'en') {
    assert.match(hint, /cannot turn it on while this switch is off/)
    assert.doesNotMatch(hint, /overrides/)
  } else {
    assert.match(hint, /មិនអាចបើកបានទេ.*កុងតាក់នេះបិទ/)
  }
}
verifySwitchHint(localeCopy.en.membershipPointsEnabledHint, 'en')
verifySwitchHint(localeCopy.km.membershipPointsEnabledHint, 'km')
assert.throws(() => verifySwitchHint('Default points earning for each new order; the POS switch overrides it for that order only.', 'en'), 'old hint must not promise an override of global OFF')
assert.throws(() => verifySwitchHint('អ្នកអាចប្តូរបានសម្រាប់ការបញ្ជាទិញនីមួយៗនៅ POS។ ពេលបិទ មិនអាចប្តូរពិន្ទុបានទេ។', 'km'), 'old Khmer hint must fail the same contract')
assert.match(localeCopy.en.behavior3, /before the reset or while loyalty was off/)
assert.match(localeCopy.km.behavior3, /មុនការកំណត់ពិន្ទុឡើងវិញ.*ពិន្ទុសមាជិកបិទ/)
assert.match(localeCopy.en.behavior3, /Paying while loyalty is off permanently skips earning/)
assert.match(localeCopy.km.behavior3, /ការបង់ប្រាក់ពេលពិន្ទុសមាជិកបិទ.*ជាអចិន្ត្រៃយ៍/)
const guidanceKeys = new Set(['membershipPointsEnabledHint', 'membershipPointsOff', 'behavior1', 'behavior2', 'behavior3', 'behavior4', 'attachHint'])
const renderedGuidance = new Set<string>()
function verifyFallbacks(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(pageAst) === 'copy') {
    const [key, fallback] = node.arguments
    if (key && ts.isStringLiteral(key) && guidanceKeys.has(key.text)) {
      assert.ok(fallback && ts.isStringLiteral(fallback))
      assert.equal(fallback.text, localeCopy.en[key.text], `fallback must preserve ${key.text} policy`)
      renderedGuidance.add(key.text)
    }
  }
  ts.forEachChild(node, verifyFallbacks)
}
verifyFallbacks(pageAst)
assert.deepEqual(renderedGuidance, guidanceKeys)

console.log('PASS loyalty defaults, settings save, global gate, draft opt-out, POS control and EN/KM guidance; five old-behavior controls fail')
