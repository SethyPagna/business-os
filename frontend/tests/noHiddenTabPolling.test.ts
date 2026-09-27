// F2 sweep: no interval in src/ may poll the server from a hidden tab.
// Every setInterval call site must either go through startVisibleInterval
// (src/utils/visibilityPolling.ts) or be listed here with the reason it is
// allowed. A new raw setInterval fails this test until someone decides which
// of the two it is -- that decision is the point.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))

// file (relative to src, forward slashes) -> [allowed call count, reason]
const ALLOWED: Record<string, [number, string]> = {
  'utils/visibilityPolling.ts': [2, 'the primitive itself (browser host + its own interval)'],
  'api/http.ts': [1, '30 s health tick; shouldRunScheduledHealthProbe returns false in a hidden tab'],
  'api/websocket.ts': [1, 'socket keep-alive, not a poll; the hub auto-responds without waking'],
  'index.tsx': [1, 'service-worker update check; returns early in a hidden tab, checks on visibilitychange'],
  'components/pos/ShiftGate.tsx': [1, 'local clock, no request'],
  'components/server/ServerPage.tsx': [1, 'local 1 s clock, no request'],
  'components/utils-settings/Settings.tsx': [1, 'local 1 s preview clock, no request'],
  'components/utils-settings/ResetData.tsx': [1, 'local elapsed counter, no request'],
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

// Call sites only: `setInterval(` not preceded by an identifier character or
// a dot-less property key such as `setInterval: (`.
const CALL = /(?<![\w$])(?:window\.|globalThis\.|host\.)?setInterval\(/g

const found: Record<string, number> = {}
for (const file of walk(srcRoot)) {
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const count = (text.match(CALL) || []).length
  if (count) found[relative(srcRoot, file).split('\\').join('/')] = count
}

const unexpected = Object.entries(found)
  .filter(([file, count]) => !ALLOWED[file] || count > ALLOWED[file][0])
  .map(([file, count]) => `${file} (${count})`)
assert.deepEqual(unexpected, [], 'raw setInterval outside the allowlist -- use startVisibleInterval, or allowlist it with a reason')

// The allowlist must not go stale either: an entry whose call is gone is
// either a removed poll (drop the entry) or one that moved (re-check it).
const stale = Object.keys(ALLOWED).filter((file) => !found[file])
assert.deepEqual(stale, [], 'allowlisted files with no setInterval left')

// The allowlisted server-touching intervals keep their hidden-tab guards.
const http = readFileSync(join(srcRoot, 'api/http.ts'), 'utf8')
assert.match(http, /if \(state\.hidden\) return false/)
const index = readFileSync(join(srcRoot, 'index.tsx'), 'utf8')
assert.match(index, /window\.setInterval\(\(\) => \{\s*\/\/[^\n]*\n\s*if \(document\.visibilityState === 'hidden'\) return/)

// Self-rescheduling job-status chains wait for visibility before each read.
// Deliberately NOT here: api/systemJobs.ts pollSystemJob, whose caller awaits
// it against a wall-clock timeout -- pausing it in a hidden tab would turn a
// finished job into a "still running" error.
for (const file of [
  'components/imports/ServerImportReviewScreen.tsx',
  'components/products/import/ProductServerImportReviewScreen.tsx',
  'components/contacts/ContactImportModal.tsx',
  'components/utils-settings/Backup.tsx',
]) {
  const text = readFileSync(join(srcRoot, file), 'utf8')
  assert.match(text, /visibleTimeout\(/, file + ' schedules its next status read with visibleTimeout')
  assert.doesNotMatch(text, /window\.setTimeout\((?:poll|tick|\(\) => pollPostStartJob)\b/, file + ' has no raw setTimeout poll chain left')
}

console.log(`no hidden-tab polling: ok (${Object.keys(found).length} files with setInterval checked)`)
