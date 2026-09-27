// Undo / redo of a Users-page edit replays the rename scope the edit was
// made with (U-profile3, refuter X8, 27 Sep 2026).
//
// Before: the history entry rebuilt the PUT body with a hard-coded
// `__rename_cascade: 'carry'`, so undoing "rename this account only" also
// rewrote every linked live record back -- and redoing it carried the new
// name into records the user had chosen to leave alone.
//
// Drives the real components/users/userWritePayload.ts and pins the call
// site in Users.tsx that feeds it.
//
// Run: node tests/userEditRenameScopeReplay.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

type Module = {
  buildUserWritePayload: (account: Record<string, unknown>, actor: Record<string, unknown>, scope?: string) => Record<string, unknown>
  userEditReplayScope: (before: Record<string, unknown>, after: Record<string, unknown>, chosen?: string) => string | undefined
}
let mod: Module | null = null
try {
  mod = (await import('../src/components/users/userWritePayload.ts')) as unknown as Module
} catch (error) {
  console.error('userWritePayload.ts could not be loaded:', (error as Error).message)
}
const need = (): Module => { assert.ok(mod, 'components/users/userWritePayload.ts exists'); return mod! }

const ACTOR = { id: 1, name: 'Owner' }
const BEFORE = { id: 7, name: 'Dara', username: 'dara', phone: '', email: '', avatar_path: '', role_id: 2, is_active: 1 }
const AFTER = { ...BEFORE, username: 'dara.s' }

// The Users.tsx history entry: the two bodies its undo and redo send.
function historyBodies(before: Record<string, unknown>, after: Record<string, unknown>, chosen?: string) {
  const { buildUserWritePayload, userEditReplayScope } = need()
  const scope = userEditReplayScope(before, after, chosen)
  return { undo: buildUserWritePayload(before, ACTOR, scope), redo: buildUserWritePayload(after, ACTOR, scope) }
}

await runTest('a "rename this account only" edit is undone and redone as rename-only', () => {
  const { undo, redo } = historyBodies(BEFORE, AFTER, 'record_only')
  assert.equal(undo.username, 'dara')
  assert.equal(undo.__rename_cascade, 'record_only')
  assert.equal(redo.username, 'dara.s')
  assert.equal(redo.__rename_cascade, 'record_only')
})

await runTest('a "carry to linked records" edit is undone and redone with carry', () => {
  const { undo, redo } = historyBodies(BEFORE, AFTER, 'carry')
  assert.equal(undo.__rename_cascade, 'carry')
  assert.equal(redo.__rename_cascade, 'carry')
})

await runTest('an edit that did not rename sends no rename scope at all', () => {
  const { undo, redo } = historyBodies(BEFORE, { ...BEFORE, phone: '012 345 678' }, undefined)
  assert.equal('__rename_cascade' in undo, false)
  assert.equal('__rename_cascade' in redo, false)
  assert.equal(redo.phone, '012 345 678')
})

await runTest('the body carries the account fields and the acting user', () => {
  const body = need().buildUserWritePayload({ ...AFTER, name: '  Dara S  ', avatar_path: null, is_active: 0 }, ACTOR, 'carry')
  assert.deepEqual(body, {
    name: 'Dara S', username: 'dara.s', phone: '', email: '', avatar_path: '', role_id: 2, is_active: 0,
    userId: 1, userName: 'Owner', __rename_cascade: 'carry',
  })
})

await runTest('Users.tsx feeds its undo and redo from the edit\'s own scope, never a literal', () => {
  const users = code(read('../src/components/users/Users.tsx'))
  assert.doesNotMatch(users, /__rename_cascade:\s*'carry'/, 'no hard-coded carry')
  assert.match(users, /const replayScope = userEditReplayScope\(previousSnapshot, nextSnapshot, renameScope\)/)
  assert.match(users, /updateUser\(previousSnapshot\.id, buildUserWritePayload\(previousSnapshot, actor, replayScope\)\)/)
  assert.match(users, /updateUser\(nextSnapshot\.id, buildUserWritePayload\(nextSnapshot, actor, replayScope\)\)/)
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
