import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// S4-20, made mechanical: "Save button at the end of the page, not beside the
// close (X) button -- product edit, transfer, adjust stock, and their
// siblings."
//
// The siblings are the point. Fourteen modals had grown the same shape --
// a phone-sized primary in the fixed header, next to the ✕, with the real
// footer marked `hidden ... sm:flex` so a phone had no other way to submit.
// It spread because each one was copied from the last, and a fix that lists
// the fourteen by hand would let the fifteenth in. So this enumerates every
// component in the app instead of naming any.
//
// The shape it looks for is a class string that is BOTH breakpoint-hidden and
// a primary action. That is exactly the duplicate: a control that exists only
// on phones, only because the real one was unreachable there. Making the
// footer reachable at every breakpoint removes the reason for it.
//
// If a future surface genuinely needs a phone-only primary, this file is
// where the exception gets written down with its reason -- not where it gets
// deleted.

const PRIMARY_TOKENS = [
  'btn-primary',
  'primaryActionClass',
  'bg-blue-600',
  'bg-red-600',
  'bg-green-600',
  'bg-purple-600',
  'bg-emerald-600',
]

/** Class strings written as className="..." or className={`...`}. */
function classStrings(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/className="([^"]*)"/g)) found.push(match[1])
  for (const match of source.matchAll(/className=\{`([\s\S]*?)`\}/g)) found.push(match[1])
  return found
}

function everyComponentFile(): string[] {
  const root = new URL('../src/components/', import.meta.url)
  const found: string[] = []
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`); continue }
      if (entry.name.endsWith('.tsx')) found.push(`components/${prefix}${entry.name}`)
    }
  }
  walk(root, '')
  return found.sort()
}

const files = everyComponentFile()
assert.ok(files.length > 200, `the sweep must actually walk the app (found ${files.length})`)

const offenders: string[] = []
for (const file of files) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  for (const classes of classStrings(source)) {
    if (!classes.includes('sm:hidden')) continue
    const token = PRIMARY_TOKENS.find((candidate) => classes.includes(candidate))
    if (token) offenders.push(`${file} (${token})`)
  }
}
assert.deepEqual(
  offenders,
  [],
  'a phone-only primary action is the duplicate S4-20 removed -- put the action in the end-of-panel footer instead',
)

// The other half of the same shape: a footer that only exists from `sm` up.
// `hidden ... sm:flex` on an action row means phones were expected to submit
// from somewhere else, which is what put the button beside the ✕.
const desktopOnlyFooters: string[] = []
for (const file of files) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  for (const classes of classStrings(source)) {
    if (!/\bhidden\b/.test(classes) || !/\bsm:(flex|grid)\b/.test(classes)) continue
    // Only action rows matter here, not hidden decorations or step meters.
    if (!/border-t|sticky bottom-0/.test(classes)) continue
    desktopOnlyFooters.push(file)
  }
}
assert.deepEqual(
  [...new Set(desktopOnlyFooters)],
  [],
  'an action footer must be visible at every breakpoint, not from sm up',
)

console.log(`PASS no modal hides its primary action behind a breakpoint (${files.length} components swept)`)
