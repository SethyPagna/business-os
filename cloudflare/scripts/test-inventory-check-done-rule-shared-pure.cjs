'use strict'
// Count tasks: the done rule has ONE text of "a final count". The done check (taskItemDoneSql), the reopen's skip and its `l` read finalCountSql, so they can never disagree
// (owner, 19 Nov: a task's state follows the counts in effect). A copy of the predicate written out again inside one of them would drift; this pin fails on it.
//
// Run: node scripts/test-inventory-check-done-rule-shared-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const cache = new Map()
const load = (file) => {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    (request) => request.startsWith('.') ? load(path.resolve(path.dirname(file), request.endsWith('.ts') ? request : request + '.ts')) : require(request), module, module.exports)
  return module.exports
}
const tasks = load(path.join(__dirname, '../src/lib/inventoryCheckTasks.ts'))
const source = fs.readFileSync(path.join(__dirname, '../src/lib/inventoryCheckTasks.ts'), 'utf8').replace(/\r\n/g, '\n')

const final = tasks.finalCountSql('x', 'xs', '@org')
const done = tasks.taskItemDoneSql('item', '@branchId', 'since', '@org')
assert.ok(final.includes("x.state IN ('done','issue')") && final.includes("xs.status='closed'") && final.includes("'stock_set_undo'") && final.includes('$.restore'), 'finalCountSql is the whole predicate: Done or Differs, closed session, not an Undo copy, not a Redo restore')
assert.ok(done.includes(final), 'taskItemDoneSql contains finalCountSql verbatim (alias x, session xs, the organization expression)')
// the same text, other aliases and organization parameter: the shared function, not a pasted literal
assert.ok(tasks.taskItemDoneSql('k', '@branchId', 'k.at', '@org').includes(tasks.finalCountSql('x', 'xs', '@org')), 'the reopen\'s skip reads the same text')
// no other place writes the predicate out again: the state test appears once in the module's source, inside finalCountSql
assert.equal(source.split("IN ('done','issue') AND").length - 1, 1, "the final-count predicate is written once (finalCountSql); everything else calls it")
// and the reopen's gap (taken counts, skip, newest remaining count) all go through the helper
assert.ok(source.split('${finalCountSql(').length - 1 >= 2,'finalCountSql is called by the done check and by the reopen (the gap `l`)')
console.log('PASS the done rule shares one text of a final count (taskItemDoneSql contains finalCountSql; the reopen reads it too)')
