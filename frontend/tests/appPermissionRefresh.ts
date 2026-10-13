import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { STORAGE_KEYS } from '../src/constants.ts'

// The app's own storage resets, for tests: AppContext's clearLocalBusinessState
// and resetLocalBusinessState read from its source, over the real runtime reset
// (clientRuntime.ts, IndexedDB stubbed), called with the option literal each
// AppContext caller passes. Whatever mapping AppContext builds is what runs.

const js = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const appSource = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const appTree = ts.createSourceFile('AppContext.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function appDeclaration(name: string, deps: Record<string, unknown>): any {
  let found: ts.VariableDeclaration | undefined
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(appTree) === name) found = node; if (!found) ts.forEachChild(node, visit) }
  visit(appTree)
  assert(found, name)
  return new Function(...Object.keys(deps), `${js(`const ${found.getText(appTree)}`)}; return ${name}`)(...Object.values(deps))
}

function appCallOptions(callee: string, wanted: (options: Record<string, unknown>) => boolean): Record<string, unknown> {
  const hits: Array<Record<string, unknown>> = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(appTree) === callee && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      hits.push(new Function(`return (${node.arguments[0].getText(appTree)})`)())
    }
    ts.forEachChild(node, visit)
  }
  visit(appTree)
  const match = hits.filter(wanted)
  assert.equal(match.length, 1, `${callee}: one caller matches`)
  return match[0]
}

type Actor = { isActorSessionQuarantined(): boolean; resetActorReadSession(): void }

export function appStorageResets(actor: Actor) {
  let inside: (() => void | Promise<void>) | null = null
  const localDb = {
    async resetLocalMirrorDbPreservingOfflineWork() { await inside?.() },
    async resetLocalMirrorDb() { await inside?.() },
    async clearLocalMirrorTables() { await inside?.() },
  }
  const runtimeModule = { exports: {} as { resetClientRuntimeState(options: Record<string, unknown>): Promise<void> } }
  const runtimeSource = readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
  new Function('require', 'module', 'exports', js(runtimeSource))((request: string) => {
    if (request === '../../constants.ts') return { STORAGE_KEYS }
    if (request === '../../api/localDb.ts') return localDb
    throw new Error(`Unexpected production dependency: ${request}`)
  }, runtimeModule, runtimeModule.exports)
  const useCallback = <T>(fn: T) => fn
  const resetLocalBusinessState = appDeclaration('resetLocalBusinessState', { useCallback, resetClientRuntimeState: runtimeModule.exports.resetClientRuntimeState, cacheClearAll() {} })
  const clearLocalBusinessState = appDeclaration('clearLocalBusinessState', { useCallback, isActorSessionQuarantined: actor.isActorSessionQuarantined, resetActorReadSession: actor.resetActorReadSession, resetLocalBusinessState })
  const options = {
    // refreshPermissions: users/roles pushes, a reconnect after a network blip.
    permissionRefresh: appCallOptions('clearLocalBusinessState', (o) => o.clearAuth === false && o.preserveUiDrafts === true),
    // handleUnauthorizedSession: the session expired.
    sessionExpiry: appCallOptions('clearLocalBusinessState', (o) => o.clearAuth === true),
    // The confirmed sign-out.
    signOut: appCallOptions('resetLocalBusinessState', (o) => o.clearAuth === true),
  }
  const run = async (reset: () => Promise<void>, during?: () => void | Promise<void>) => {
    inside = during ?? null
    try { await reset() } finally { inside = null }
  }
  return {
    options,
    /** The same-user permission refresh, up to where it waits for the bootstrap. */
    permissionRefresh: (during?: () => void | Promise<void>) => run(() => clearLocalBusinessState(options.permissionRefresh), during),
    sessionExpiry: (during?: () => void | Promise<void>) => run(() => clearLocalBusinessState(options.sessionExpiry), during),
    signOut: (during?: () => void | Promise<void>) => run(() => resetLocalBusinessState(options.signOut), during),
  }
}
