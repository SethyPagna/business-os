import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const blocked = () => { throw new DOMException('Storage blocked', 'SecurityError') }
const browser = { addEventListener() {}, get localStorage(): Storage { return blocked() } }
Object.assign(globalThis, { window: browser })
const scope = await import('../src/api/actorReadScope.ts')
assert.equal(scope.isActorCookieMutationPending(), true)
assert.equal(scope.isActorSessionQuarantined(), true)
assert.equal(scope.actorCookieMutationPendingStatus(), 'storage-unavailable')
assert.equal(scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker()), false)
assert.throws(() => scope.assertActorSessionDispatchAllowed(), (error: any) => error.outcome === 'not_dispatched')

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let messageExpression = ''
function visit(node: ts.Node) {
  if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'message.textContent' && node.right.getText(tree).includes("status === 'storage-unavailable'")) messageExpression = node.right.getText(tree)
  ts.forEachChild(node, visit)
}
visit(tree)
assert.ok(messageExpression)
const messageFor = new Function('status', `const signingOut = status.startsWith('signout-'); return (${messageExpression});`)
const message = messageFor(scope.actorCookieMutationPendingStatus())
assert.match(message, /Enable cookies and site data/)
assert.match(messageFor(scope.actorSessionQuarantineStatus()), /Enable cookies and site data/, 'actual displayed sign-out storage status must provide actionable recovery')
assert.match(message, /[ក-៿]/)
assert.doesNotMatch(message, /another tab/)
assert.match(messageFor('authentication-pending'), /another tab/)

// Execute the provider's actual status-setting branch; it must retain the early
// return instead of proceeding into reconciliation with an unreadable fence.
const provider = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const providerTree = ts.createSourceFile('AppContext.tsx', provider, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let pendingBranch = ''
function find(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(providerTree) === 'isActorCookieMutationPending()' && node.thenStatement.getText(providerTree).includes('setActorSessionQuarantineStatus')) pendingBranch = node.getText(providerTree)
  ts.forEachChild(node, find)
}
find(providerTree)
assert.ok(pendingBranch)
let status = ''
let reachedRecovery = false
new Function('isActorCookieMutationPending', 'actorCookieMutationPendingStatus', 'setActorSessionQuarantineStatus', 'recover', `${pendingBranch}; recover();`)(scope.isActorCookieMutationPending, scope.actorCookieMutationPendingStatus, (value: string) => { status = value }, () => { reachedRecovery = true })
assert.equal(status, 'storage-unavailable')
assert.equal(reachedRecovery, false)

Object.defineProperty(browser, 'localStorage', { value: { getItem: (key: string) => key === 'businessos_auth_cookie_pending' ? 'auth-pending:real-other-tab' : null } })
assert.equal(scope.actorCookieMutationPendingStatus(), 'authentication-pending')
assert.equal(scope.isActorCookieMutationPending(), true)
assert.equal(scope.isActorSessionQuarantined(), true)
assert.equal(scope.completeActorSessionReconciliation(scope.actorSessionReconciliationMarker()), false)
assert.throws(() => scope.assertActorSessionDispatchAllowed(), (error: any) => error.outcome === 'not_dispatched')
console.log('PASS blocked storage has actionable bilingual recovery text while synthetic and real pending fences remain closed')

// A mid-reconciliation storage failure must return a closed UI decision, not
// reject the provider's fire-and-forget reconciliation task.
const signout = await import('../src/api/unresolvedSignout.ts')
const intent = { version: 1, token: 'confirmed-storage-fixture', authority: 'https://blocked.test', actor_id: 71, organization_id: null, phase: 'confirmed' }
let clears = 0
let statusEvents = 0
Object.assign(globalThis, { window: { dispatchEvent() { statusEvents++ }, location: { origin: intent.authority }, navigator: { locks: { request: async (_name: string, _options: unknown, action: () => unknown) => action() } }, localStorage: { getItem(key: string) { if (key === 'businessos_auth_cookie_pending') return blocked(); return JSON.stringify(intent) } } } })
assert.equal(await signout.prepareConfirmedSignoutUi(intent.token, () => { clears++ }), false)
assert.equal(clears, 0)
assert.equal(signout.isSignoutBlocked(), true)
assert.equal(signout.signoutStatus(), 'signout-storage-unavailable')
assert.equal(await signout.prepareConfirmedSignoutUi(intent.token, () => { clears++ }), false)
assert.equal(statusEvents, 1, 'one status update shows recovery copy without a repeated notification/retry loop')
console.log('PASS confirmed sign-out storage failure retains the fence without rejecting UI reconciliation')
