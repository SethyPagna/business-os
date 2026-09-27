---
name: blast-radius
description: >-
  Do not break the neighbours. Before and after ANY change to business-os (a fix, a feature, a
  refactor, a docs-only "cleanup" that touches code, a Codex or Claude lane being merged), trace
  the surroundings of every edited symbol — its callers, its siblings on other surfaces, the
  Worker route behind it, the language packs, the tests that pin it, the offline and PWA paths —
  and prove each one still works on the surface the owner uses. Use it whenever you are about to
  edit a file, whenever a peer's lane is being merged, and whenever the owner reports that
  "something else stopped working" after a change: images not uploading, an action refused, a
  page blank, one "isolated" error that is really one instance of a class.
---

# Blast radius — verify the affected surroundings of every change

Business OS is one interconnected system: a product save touches the product route, the image
upload, the stock ledgers, the POS sheet, the public catalog, the offline mirror, the undo/redo
chain, the conflict guard, both language packs and a dozen tests. A change that is green in its
own file has broken a neighbour more than once. The owner's rule (22 September 2026): "make a
skill and rule to not break anything and verify the affected surroundings as this system is
highly connected, interconnected. images, actions, or just one isolated error etc."

The reference case: on 22 September every product edit, image save and delete on the live app was
refused as "changed on another device". The cause was a helper that read the version token from
the local Dexie mirror, and a 12 September change had (correctly) stopped the live app from
writing those mirrors. That change was green. Nobody traced who else read the tables it froze.

## The rule

A change is not done when its own test is green. It is done when every surrounding that depends
on what you changed has been enumerated and verified, and the enumeration is written down in the
release note with a verdict per item.

## Before editing: map the neighbourhood

For every symbol, table, key, route or file you are about to change, enumerate — with
`git grep -n`, never from memory — and write the list into the session ledger:

1. **Callers and importers.** Every importer of the module, every call site of the function,
   every reader of the table or key (for Dexie mirrors and settings: who writes, who reads, and
   whether the writer still runs on the live origin). A helper with a fallback path: who lands
   on the fallback in production, not just in tests.
2. **Sibling surfaces.** The same capability on every other entry point: single and bulk, admin
   page and POS sheet, modal and inline, import and manual form, undo and redo, keyboard and
   touch, the public storefront. The consistency-audit reference lists the known families
   (`.claude/skills/fleet-coordination/references/consistency-audit.md`).
3. **The other package.** The Worker route behind a frontend write (what it reads from body vs
   query, what it strips, its 409 shape), or the frontend callers of a Worker change (payload
   keys, response fields the UI renders, both `expectedUpdatedAt` spellings).
4. **The pinned tests.** `git grep -n <symbol> -- frontend/tests cloudflare/scripts` — every test
   that names the symbol will change with it. A pinned test that turns red is data about the
   class, not an obstacle: read what it pinned before rewriting it.
5. **Cross-cutting paths.** Offline snapshot and mirrors, the PWA service-worker precache, the
   free-plan quota guard, permissions, the audit log, i18n keys in both packs, the Telegram
   report, receipts, the undo payload.

If the list has one entry, look again. The systems here rarely have one consumer.

## While editing: one class, one fix

When the owner reports one symptom, assume it is one instance of a class and search for the
rest before fixing. "Product save says changed on another device" was also branch save, contact
delete, role delete, promotion discount save and settings save. Fix the class at the seam
(delete the wrong helper), not the instance (add a token to one caller), and remove what the fix
leaves dead — only after tracing its real callers (dead-code rule in AGENTS.md).

## After editing: verify the neighbourhood, not the diff

1. **Run the pinned tests for every item on the map**, individually, before the full chain:
   `node tests/<file>.test.ts` and `node scripts/test-<name>.cjs`. Then the full gates in both
   packages (`frontend`: `test:utils`, `verify:i18n`, `build`; `cloudflare`: `tsc --noEmit` and
   every `scripts/test-*.cjs`).
2. **Add a discriminating test for the class** with a negative control: a test on which the old
   code and the new code disagree (`memory: discriminating-tests`). A source pin without a
   control proves the text exists, not that the behaviour holds.
3. **Exercise the surface the owner uses.** The live app on a phone-width viewport, the exact
   flow they named (the Products edit form with an image, not the API). A control that exists
   but is off-screen counts as missing.
4. **Read the neighbours' output.** Console errors, network 4xx/5xx, the service-worker precache
   manifest size, the offline snapshot still loading, the Khmer pack still complete.
5. **Record the matrix.** The release note lists every item from the map with file:line and a
   verdict (unchanged / fixed / deliberately not touched and why). "Deliberately not touched" is
   only allowed with a reason a reader can check.

## Merging a peer's lane (Codex or Claude)

Treat the lane's diff as the change and run this skill on it as if you wrote it: map its
neighbourhood from the diff, run the pinned tests individually on the merged tip (union defects
hide behind green line-survival, `memory: line-survival-is-not-composition`), and add the matrix
to the release note. A lane that arrives "verified" is verified for its own files; the
surroundings are your job.

## What this skill does not permit

- Declaring a symptom "by design" or "already fixed" without exercising the owner's surface.
- Skipping the map because the change is "small". The 12 September change was one boolean.
- Removing a guard, a permission check or a financial rule to make a neighbour green.
- Rewriting a red pinned test before reading what it pinned and why.
