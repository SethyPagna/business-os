// Two pack defects that verify-i18n could not see by construction, both found
// live on 2026-09-06. Kept as pure functions so they can be exercised on
// crafted input (frontend/tests/i18nPackGates.test.ts) rather than only on
// whatever the shipped packs happen to hold.

/**
 * Top-level keys that appear more than once in the RAW pack text.
 *
 * Two lanes adding the same key at different places in the file auto-merge
 * without a conflict -- the hunks never touch. JSON.parse then keeps the LAST
 * definition silently, so the earlier one is dead and no reader can tell which
 * value shipped. Every existing check ran on the parsed object, where the
 * duplicate has already been resolved away; this one must read the text.
 *
 * The packs are emitted one `  "key": value` per line, so depth is read from
 * the indent: exactly two spaces is top level.
 */
export function duplicateTopLevelKeys(rawPack: string): string[] {
  const seen = new Map<string, number>()
  const duplicates: string[] = []
  rawPack.split(/\r?\n/).forEach((line, index) => {
    const match = /^ {2}"((?:[^"\\]|\\.)*)":/.exec(line)
    if (!match) return
    const key = match[1]
    const first = seen.get(key)
    if (first === undefined) { seen.set(key, index + 1); return }
    duplicates.push(
      `duplicate top-level key '${key}' (line ${first} and line ${index + 1}) — ` +
        'git never conflicts on this shape and JSON.parse keeps only the last, ' +
        'so the earlier value is dead; delete one',
    )
  })
  return duplicates
}

/** `{slot}` placeholders, the only interpolation shape the app substitutes. */
const SLOT = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g

/**
 * Call sites that pass an inline English fallback beside the key. Both live
 * shapes: `tr('key', 'Fallback')` and `tr(t, 'key', 'Fallback')`. Only
 * single-quoted fallbacks are read -- a template literal carries `${}`
 * interpolation of its own and is not a pack-substitutable string.
 */
const FALLBACK_SHAPES = [
  /\b(?:T|tr|safeT|copy|translate)\(\s*'([a-z][a-z0-9_]*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g,
  /\b(?:T|tr|safeT|copy|translate)\(\s*t\s*,\s*'([a-z][a-z0-9_]*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g,
]

export type PackPair = { en: Record<string, string>; km: Record<string, string> }
export type SourceFile = { file: string; text: string }

/**
 * Pack values that DROP a placeholder their own call site substitutes.
 *
 * The existing en-vs-km slot check compares the two packs against each other,
 * so it passes when both lost the same slot -- which is how
 * confirm_complete_stock_session_mixed shipped in both languages with none of
 * {lines}, {adds}, {removes}, {sets} or {branch}, quietly dropping the line
 * count, the add/remove/set breakdown and the branch name from a mutating
 * stock confirmation. The source's inline fallback is the statement of what
 * the call site actually substitutes, so it is the reference.
 *
 * Only DROPPED slots are reported: a pack may legitimately add one (Khmer word
 * order can need a slot English states inline), and that loses nothing.
 */
export function fallbackSlotRegressions(sources: SourceFile[], packs: PackPair): string[] {
  const expected = new Map<string, { slots: Set<string>; file: string }>()
  for (const { file, text } of sources) {
    for (const shape of FALLBACK_SHAPES) {
      for (const match of text.matchAll(shape)) {
        const slots = new Set(match[2].match(SLOT) ?? [])
        if (!slots.size) continue
        const prior = expected.get(match[1])
        if (prior) for (const slot of slots) prior.slots.add(slot)
        else expected.set(match[1], { slots, file })
      }
    }
  }
  const problems: string[] = []
  for (const [key, { slots, file }] of [...expected.entries()].sort()) {
    for (const packName of ['en', 'km'] as const) {
      const value = packs[packName][key]
      if (typeof value !== 'string') continue
      const missing = [...slots].filter((slot) => !value.includes(slot))
      if (!missing.length) continue
      problems.push(
        `${packName}.json '${key}' drops ${missing.join(' ')} that ${file} substitutes — ` +
          'the replace is a no-op and the value vanishes from that language',
      )
    }
  }
  return problems
}
