---
name: skill-wiki
description: Turn agent experience into durable skills, tests and checks, and keep the skill library organized. Use after any human correction, repeated review comment, escaped bug or repeated mistake; when asked to create, edit, merge, retire, index or optimize skills; when asked to "remember how we did this", "make this a skill", or "organize the skills"; and at the end of a work-mode task.
---

<!-- Generated from agent-team/skills/skill-wiki/SKILL.md. -->

# Skill wiki

The repository teaches the agents. Every correction should make a whole category of mistake harder.

## 1. Classify the correction
| What went wrong | Durable artifact |
|---|---|
| Agent lacked project knowledge | one line in `AGENTS.md` (only if needed almost every task) or a skill reference file |
| Agent did not know the procedure | a skill (new, or a step in an existing playbook) |
| A bug escaped | a regression test that fails on the old code |
| Same review comment twice | a mechanical check (`frontend/tests/sourceSyntaxCheck.ts`-style source check, test, or CI step) |
| Same architectural mistake | a dependency/import check, or restructure so the easy path is right |
| Task was ambiguous | a better task/lane brief template |
| Agent trusted itself too easily | a refuter step (`review-change`) in the playbook |
Prefer the most mechanical artifact that works: check > test > skill > AGENTS.md line > memory.

## 2. Write or edit a skill
- Canonical source: `agent-team/skills/<name>/SKILL.md` (+ optional `references/`, `scripts/`). Never edit the generated copies in `.claude/skills`, `.agents/skills`, `.github/skills`.
- Frontmatter: `name` = folder name (kebab-case), `description` ≤ 1024 chars that says **what** and **when** (the trigger phrases users actually say). The description is what makes a skill load.
- Body: steps an agent can follow without this conversation; harness-neutral wording; ≤ ~250 lines; move detail to `references/`.
- Deterministic parts become scripts in the skill folder or `agent-team/scripts/`.
- Evidence: cite the incident/commit that motivated the rule (one line), not a story.
- Run `node agent-team/scripts/sync-adapters.mjs` then `node agent-team/scripts/validate-team.mjs`.

## 3. Keep the library healthy
- `agent-team/skills/INDEX.md` (generated) lists every skill; read it before creating one — extend instead of duplicating.
- Merge skills whose triggers overlap; split a skill whose description needs "and also".
- Retire a skill that no task loaded in a month or whose rule became a check (the check is the rule now).
- Owner-specific or machine-specific paths go in the owner's local records or memory, not in a committed skill.
- `repo-patterns` mines git history for candidate skills; a pattern needs repeated evidence, not frequency alone.

## 4. Close the loop
At the end of a task, list corrections received and the artifact each became (or why none). No artifact = the same mistake will recur.
