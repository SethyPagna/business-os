// Lock: no React hook body (useCallback / useMemo / useEffect) reads a *Filter
// useState variable that is missing from that hook's dependency array -- the
// stale-closure class where a filter silently never triggers its refetch or
// recompute. Two real ones shipped before this lock existed (both fixed on
// hf/review-fixes, 2026-09-03):
//   - Products.tsx productFilterSections useMemo read mergedFilter and
//     promoFilter without depending on them, so the Merged / Promotions chips
//     in the FilterMenu showed a stale selection after a click.
//   - ProductsImageOnlyView.tsx load useCallback read categoryFilter and
//     brandFilter without depending on them, so picking a category or brand
//     never refetched the grid.
//
// KNOWN FALSE-POSITIVE CLASSES, in the order they bit during the 2026-09-03 sweep:
//   1. DELIBERATE omissions. Some hooks exclude filter values on purpose (POS.tsx's
//      metadata-pruning effect omits them so it cannot fight the user's own filter
//      clicks). Only an ALLOWLIST entry can express that -- see ALLOWLIST below.
//   2. INDIRECT re-runs. A hook may depend on a derived scope value (a useMemo over
//      the filters) or be re-triggered by a loading cycle, so it is correct despite
//      the literal omission. Products.tsx's filter-metadata effect is this shape.
//      The scanner cannot see it; a human must trace the trigger chain.
//   3. OBJECT KEYS that share a state variable's name (`stockFilter: effectiveStockState`
//      reads effectiveStockState, not stockFilter). Not detected -- verify by eye.
//   4. Comments, string literals and type annotations mentioning the name. These ARE
//      stripped below; without stripping, this comment-heavy codebase produced ~5
//      spurious hits out of 20.
// So: every hit is a CANDIDATE. When this test goes red, read the site: either fix
// the dependency array, or -- only when the omission is deliberate and you can say
// why -- add an ALLOWLIST entry with the reason.
//
// Provenance: written by session business-os-v1-16 (2026-09-03) as a read-only
// sweep scanner after the getProductsByIds wrong-product root cause, adopted here
// by hf/review-fixes. The durable fix for this whole class is ESLint with
// react-hooks/exhaustive-deps, which this repository has never had (no eslint
// config, dependency or lint script anywhere); this test is the interim lock,
// not a substitute for that lane.
//
// Run: node tests/hookDepsFilterState.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKSLASH = String.fromCharCode(92)

type AllowEntry = { file: string; names: string[]; line?: number; reason: string }
type Finding = { file: string; line: number; hook: string; name: string }

// Sites verified as deliberate. Keep the reason -- an allowlist without one
// decays into a list of things nobody dares delete.
export const ALLOWLIST: AllowEntry[] = [
  {
    file: 'components/pos/POS.tsx',
    names: ['categoryFilter', 'brandFilter', 'branchFilter', 'supplierFilter'],
    reason:
      'Prunes filter values that no longer exist against freshly loaded metadata. '
      + 'Depending on the filter values would re-run and "correct" a value the user just '
      + 'picked, fighting their own clicks. Documented in a comment at the site.',
  },
  {
    file: 'components/products/Products.tsx',
    names: ['branchFilter', 'brandFilter', 'catFilter', 'groupFilter', 'stockFilter', 'supplierFilter'],
    line: 1259,
    reason:
      'Filter-metadata effect. Re-runs INDIRECTLY: filterMetaScope (a useMemo over all '
      + 'six filters, :1236) changes -> the effect at :1244 resets filterMetaLoadedRef and '
      + 'filterMetaReady -> load()\'s loading cycle re-triggers :1250 -> this effect runs '
      + 'again with a fresh closure. Verified 2026-09-03; RE-VERIFIED 2026-09-06 at the '
      + 'repinned line -- the three sites above were read again and the chain is unchanged. '
      + 'No path found where a filter changes without load() running. FRAGILE: it depends '
      + 'on `loading` cycling, so if that chain is ever refactored this entry must be '
      + 're-verified, not trusted. (Repinned from :1196: the site had drifted 60 lines, '
      + 'exactly the DRIFT budget, so the next line added anywhere above it -- here a CSS '
      + 'import -- tipped it to STALE. A pin at its true line is the point.)',
  },
  {
    file: 'components/products/Products.tsx',
    names: ['stockFilter'],
    line: 2168,
    reason:
      'False-positive class 3. `stockFilter:` here is an OBJECT KEY -- the value read is '
      + 'effectiveStockState, which IS in the deps. Nothing to fix.',
  },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, out)
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// End of the hook call: from `useX(` to the `)` that closes it, tracking paren
// depth while skipping strings, template literals and comments.
function spanEnd(src: string, open: number): number {
  let depth = 0
  let i = open
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i)
      if (i < 0) return -1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i)
      if (i < 0) return -1
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === BACKSLASH) i++
        i++
      }
      i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

// False-positive class 4: a name mentioned in prose or a type is not a read.
function stripNonCode(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\n\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\n\\]|\\.)*"/g, '""')
    // Inline object types -- `JSON.parse(raw) as { stockFilter?: unknown }` names
    // the variable without reading it. Assertions and generic arguments both.
    .replace(/\bas\s+\{[^{}]*\}/g, ' as _')
    .replace(/<\{[^{}]*\}>/g, '<_>')
}

function wordRe(name: string, flags?: string): RegExp {
  return new RegExp('(?<![' + BACKSLASH + 'w$.])' + name + '(?![' + BACKSLASH + 'w$])', flags)
}

// An allowlist keyed only on file+name would mask a genuine NEW bug on the same
// state variable elsewhere in that file; keyed on an exact line it goes stale the
// moment anything above it shifts. So: match file+name, and when the entry pins a
// line, allow drift within DRIFT lines. A hit that matches file+name but has moved
// further than that is neither passed nor silently failed -- it is reported as
// STALE so a human re-verifies the site and repins the entry.
const DRIFT = 60

function classify(relFile: string, name: string, line: number): 'flag' | 'allowed' | 'stale' {
  // One file can hold several entries for the SAME state variable at different
  // sites (Products.tsx pins stockFilter twice). Pick the nearest pin, not the
  // first match, or a distant entry wrongly reports its neighbour as stale.
  const matches = ALLOWLIST.filter((e) => e.file === relFile && e.names.includes(name))
  if (!matches.length) return 'flag'
  if (matches.some((e) => e.line == null)) return 'allowed'
  const nearest = Math.min(...matches.map((e) => Math.abs(line - (e.line as number))))
  return nearest <= DRIFT ? 'allowed' : 'stale'
}

export function scan(root: string): Finding[] {
  const findings: Finding[] = []
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(root, file).replace(/\\/g, '/')
    const lineAt = (idx: number) => src.slice(0, idx).split('\n').length

    // Only filter-ish useState variables declared in this same file.
    const stateNames = new Set<string>()
    for (const m of src.matchAll(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*set[\w$]*\s*\]\s*=\s*useState/g)) {
      if (/filter/i.test(m[1])) stateNames.add(m[1])
    }
    if (!stateNames.size) continue

    for (const m of src.matchAll(/\buse(Callback|Memo|Effect)\s*\(/g)) {
      const open = (m.index as number) + m[0].length - 1
      const end = spanEnd(src, open)
      if (end < 0) continue
      const span = src.slice(open, end + 1)

      // A hook with NO dependency array runs every render -- not this bug.
      const depMatch = span.match(/,\s*\[([\s\S]*?)\]\s*\)\s*$/)
      if (!depMatch) continue
      const deps = depMatch[1]
      const body = stripNonCode(span.slice(0, span.length - depMatch[0].length))

      // Names declared inside the body are fresh each run, not stale closures.
      const localDecl = new Set<string>()
      for (const d of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) localDecl.add(d[1])

      for (const name of stateNames) {
        if (localDecl.has(name)) continue
        if (!wordRe(name, 'g').test(body)) continue
        if (wordRe(name).test(deps)) continue
        findings.push({ file: rel, line: lineAt(m.index as number), hook: 'use' + m[1], name })
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name))
  return findings
}

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', 'src')
const all = scan(root)
const flagged: Finding[] = []
const stale: Finding[] = []
let allowed = 0
for (const f of all) {
  const verdict = classify(f.file, f.name, f.line)
  if (verdict === 'allowed') allowed++
  else if (verdict === 'stale') stale.push(f)
  else flagged.push(f)
}

// The scanner must still be able to SEE the class it guards: every allowlisted
// site is a real hit, so a silent regex breakage (zero hits everywhere) would
// otherwise pass as "nothing found".
assert.ok(allowed >= ALLOWLIST.length, `scanner found only ${allowed} allowlisted hits; expected at least ${ALLOWLIST.length} -- the scanner itself may be broken`)

const lines = [
  ...flagged.map((f) => `${f.file}:${f.line}  ${f.hook}  reads '${f.name}' -- not in deps`),
  ...stale.map((f) => `${f.file}:${f.line}  ${f.hook}  reads '${f.name}' -- STALE ALLOWLIST: an entry covers this name but pinned a different line. Re-verify the site and repin.`),
]
assert.deepEqual(
  lines, [],
  `hook bodies read a *Filter state variable missing from their dependency array (fix the deps, or allowlist WITH a reason):\n  ${lines.join('\n  ')}`,
)

console.log(`PASS hookDepsFilterState: 0 unlisted hits, 0 stale allowlist entries, ${allowed} allowlisted`)
