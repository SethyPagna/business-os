import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../../cloudflare/package.json', import.meta.url))('typescript')

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const form = read('../src/components/branches/BranchForm.tsx')
const description = form.slice(form.indexOf('<label htmlFor="branch-notes"'), form.indexOf('<div className="flex flex-col gap-2">'))
assert.match(description, /t\('description'\)/)
assert.match(description, /value=\{form\.notes\}/)
assert.match(description, /set\('notes', event\.target\.value\)/)
assert.match(form, /notes: branch\?\.notes \|\| ''/)
assert.match(form, /disabled=\{!form\.is_active\}/)
const formTree = ts.createSourceFile('BranchForm.tsx', form, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const restore = formTree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === 'restoreBranchForm')
assert.ok(restore)
const restoreCode = ts.transpileModule(restore.getText(formTree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const restoreDraft = new Function(`${restoreCode}; return restoreBranchForm`)()
const retired = { name: 'Old Shop', location: '', phone: '', manager: '', notes: 'saved', is_active: 0, is_default: 0 }
const restored = restoreDraft(retired, { name: 'Shop', is_active: 1, is_default: 1, notes: 'draft' })
assert.equal(restored.name, 'Old Shop')
assert.equal(restored.is_active, 0)
assert.equal(restored.is_default, 0)
assert.equal(restored.notes, 'draft')
const branches = read('../src/components/branches/Branches.tsx')
const tree = ts.createSourceFile('Branches.tsx', branches, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const eligibility = tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === 'canEditBranchRecord')
assert.ok(eligibility)
const eligibilityCode = ts.transpileModule(eligibility.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const roleFromName = (value: unknown) => ['shop', 'warehouse'].includes(String(value).trim().toLowerCase()) ? String(value).trim().toLowerCase() : 'other'
const canEdit = new Function('branchRoleFromName', `${eligibilityCode}; return canEditBranchRecord`)(roleFromName)
assert.equal(canEdit({ ...retired, canonical_key: 'shop', role: 'shop', successor_branch_id: 2 }), true)
assert.equal(canEdit({ ...retired, canonical_key: 'shop', successor_branch_id: null }), false)
assert.equal(canEdit({ ...retired, canonical_key: 'invalid', successor_branch_id: 2 }), false)
assert.match(branches, /canEditBranch && canEditBranchRecord\(branch\)/)
assert.match(branches, /if \(!canEditBranchRecord\(currentBranch\)\)/)
for (const language of ['en', 'km']) {
  const pack = JSON.parse(read(`../src/lang/${language}.json`))
  assert.ok(typeof pack.description === 'string' && pack.description.trim())
}
console.log('PASS branch descriptions reuse existing notes and both language packs')
