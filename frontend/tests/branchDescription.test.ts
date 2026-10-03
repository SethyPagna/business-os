import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const form = read('../src/components/branches/BranchForm.tsx')
const description = form.slice(form.indexOf('<label htmlFor="branch-notes"'), form.indexOf('<div className="flex flex-col gap-2">'))
assert.match(description, /t\('description'\)/)
assert.match(description, /value=\{form\.notes\}/)
assert.match(description, /set\('notes', event\.target\.value\)/)
assert.match(form, /notes: branch\?\.notes \|\| ''/)
for (const language of ['en', 'km']) {
  const pack = JSON.parse(read(`../src/lang/${language}.json`))
  assert.ok(typeof pack.description === 'string' && pack.description.trim())
}
console.log('PASS branch descriptions reuse existing notes and both language packs')
