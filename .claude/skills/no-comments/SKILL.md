---
name: no-comments
description: Keep code self-explaining, with few comments and only true ones. Use when writing or reviewing code, when a diff adds comments, and when running a comment cleanup. Defers to the Golden Rules in progress.md (a reader gets what the code does and why in under 10 seconds). Defines which comments stay (short why comments, tool directives), which go (restating, narrative, stale, commented-out code), and how to strip comments safely at scale.
---

<!-- Generated from agent-team/skills/no-comments/SKILL.md. -->

# Few comments, all true

The Golden Rules in `progress.md` win over this skill: another engineer must understand what the
code does and why in under 10 seconds. Names, types and tests carry most of that because they are
checked; comments are not, and agents read a stale comment as truth. Keep the comments that carry a
reason nothing else can, and remove the rest.

## Writing code
- Put the meaning in a name, a named constant, a small function, a type, or a test whose name states the rule first.
- Keep a short *why* comment when the reason cannot live in a name, a test or the commit message: an owner decision, an external constraint (an API, platform or tool limit), a counter-intuitive workaround. One or two lines, next to the code it explains.
- Do not add comments that restate the code, narrate history ("until Sep 6 this was…"), or label sections.
- Never leave commented-out code or TODOs; TODOs go to the `progress.md` queue.

## Must keep
- The short why comments above.
- Tool directives: `// @ts-expect-error` / `@ts-ignore` (with reason), `eslint-disable*`, `/// <reference …>`, `/* @vite-ignore */` and bundler magic comments, `#!` shebangs, license headers, JSDoc that a tool consumes, comments inside JSONC configs (`tsconfig*.json`, `wrangler.jsonc`), and anything inside SQL migration files (append-only — never edit an applied migration).

## Removing comments at scale
1. Inventory by class: directive (keep) / why that only a comment can carry (keep) / why that fits a name or test (convert, then delete) / restating or narrative (delete) / stale (delete) / commented-out code (delete) / TODO (move).
2. Convert the "why" class first, by hand, in the owning lane.
3. Strip mechanically with a tokenizer-aware script (TypeScript compiler API scanner), never regex — strings, template literals, regex literals and JSX text contain `//` and `/*`. The script keeps every comment the inventory marked keep.
4. Only on files no in-flight lane owns; one lane does the strip.
5. Verify: both typechecks, build, every test file alone, and a comparison of the emitted JS with comments removed on both sides (must be identical).

## Review
A restating, narrative or stale comment, or commented-out code, is a **style** finding. A wrong comment is a **confirmed defect**: it misleads. A short why comment that meets the rule above is not a finding.
