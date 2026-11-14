#!/usr/bin/env node
// The owner's Core Rule (14 Nov 2026) is written twice: progress.md -> Golden Rules for sessions, AGENTS.md for every tool.
// It never changes, so the two copies must stay identical and keep all six points.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')

function coreRule(text, name) {
  const start = text.indexOf('### The Core Rule\n')
  assert.ok(start >= 0, `${name} has "### The Core Rule"`)
  const rest = text.slice(start)
  const end = rest.search(/\n(?=#{2,3} |- \*\*)/)
  return (end < 0 ? rest : rest.slice(0, end)).trimEnd()
}

const fromProgress = coreRule(read('progress.md'), 'progress.md')
const fromAgents = coreRule(read('AGENTS.md'), 'AGENTS.md')

assert.strictEqual(fromAgents, fromProgress, 'AGENTS.md and progress.md carry the same Core Rule text')
for (const point of ['1. **Quality.**', '2. **Quality control.**', '3. **Standards and concepts.**', '4. **Requirements.**', '5. **Efficiency, targeted and scalable.**', '6. **Process efficiency.**']) {
  assert.ok(fromProgress.includes(point), `the Core Rule keeps point ${point}`)
}
assert.ok(fromProgress.includes('getPlanLimits(env)'), 'the efficiency point names getPlanLimits(env)')
assert.ok(fromProgress.includes('correctness wins'), 'the Core Rule says correctness wins a conflict')
assert.ok(read('progress.md').indexOf('### The Core Rule') > read('progress.md').indexOf('## Golden Rules'), 'the Core Rule sits inside Golden Rules')

console.log('PASS the Core Rule is identical in progress.md and AGENTS.md and keeps its six points')
