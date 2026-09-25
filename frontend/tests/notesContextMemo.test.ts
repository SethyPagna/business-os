// U-sync phase 1, task 5: the NotesContext value is memoized.
//
// NotesProvider (App.tsx) calls useNotesController() once and passes its
// return value straight to NotesContext.Provider. That value was a fresh
// object literal on every render, and NotesProvider re-renders with the
// App shell, so NotesWidget and NotesPage re-rendered on every shell render.
//
// A useMemo with a missing dependency would be worse than none (a stale
// draft or a stale handler), so this test checks that the memo's deps are
// exactly the returned fields, not just that the word useMemo appears.
// It is a source check because the controller imports the .tsx context core,
// which Node's type stripping cannot load without the Vite pipeline.
//
// Red on the old code: the controller ended in a bare `return {`.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const controller = fs.readFileSync(new URL('../src/components/notes/useNotesController.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const provider = fs.readFileSync(new URL('../src/components/notes/NotesContext.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const names = (list: string) => list.split(',').map((item) => item.trim()).filter(Boolean)

const match = /\n {2}return useMemo\(\(\) => \(\{\n([\s\S]*?)\n {2}\}\), \[\n([\s\S]*?)\n {2}\]\)\n\}\n?$/.exec(controller)
assert.ok(match, 'useNotesController must end by returning a useMemo(() => ({ ... }), [ ... ]) value')
const fields = names(match[1])
const deps = names(match[2])
assert.ok(fields.length >= 15, `expected the full controller surface, got ${fields.length} fields`)
assert.deepEqual([...deps].sort(), [...fields].sort(), 'the memo deps must be exactly the returned fields')
assert.doesNotMatch(controller, /\n {2}return \{\n/, 'the unmemoized return literal must be gone')
console.log(`PASS the notes controller value is memoized on exactly its ${fields.length} fields`)

assert.match(provider, /const controller = useNotesController\(\)\n\s*return <NotesContext\.Provider value=\{controller\}>/)
console.log('PASS NotesProvider passes the memoized controller value straight through')
