---
name: no-comments
description: Keep code self-explaining instead of commented. Use when writing or reviewing code, when a diff adds comments, and when running a comment cleanup. Defines which comments must stay (tool directives), where the meaning of a removed comment goes (name, type, test, doc), and how to strip comments safely at scale.
---

<!-- Generated from agent-team/skills/no-comments/SKILL.md. -->

# No comments

Comments rot; names, types and tests are checked. Agents also read stale comments as truth.

## Writing code
- Do not add comments that restate the code, narrate history ("until Sep 6 this was…"), or label sections.
- When you feel a "why" comment is needed, first try: a better name, a named constant, a small function, a type, or a test whose name states the rule. If the reason is a business rule or incident, put it in the test name and, if long, in `docs/`.
- Never leave commented-out code or TODOs; TODOs go to the `progress.md` queue.

## Must keep (tool directives)
`// @ts-expect-error` / `@ts-ignore` (with reason), `eslint-disable*`, `/// <reference …>`, `/* @vite-ignore */` and bundler magic comments, `#!` shebangs, license headers, JSDoc that a tool consumes, comments inside JSONC configs (`tsconfig*.json`, `wrangler.jsonc`), and anything inside SQL migration files (append-only — never edit an applied migration).

## Removing comments at scale
1. Inventory by class: directive (keep) / restating or narrative (delete) / stale (delete) / why (convert, then delete) / commented-out code (delete) / TODO (move).
2. Convert the "why" class first, by hand, in the owning lane.
3. Strip mechanically with a tokenizer-aware script (TypeScript compiler API scanner), never regex — strings, template literals, regex literals and JSX text contain `//` and `/*`.
4. Only on files no in-flight lane owns; one lane does the strip.
5. Verify: both typechecks, build, every test file alone, and a comparison of the emitted JS with comments removed on both sides (must be identical).

## Review
A reviewer flags added comments as **style** unless the comment is wrong (then **confirmed defect**: it misleads).
