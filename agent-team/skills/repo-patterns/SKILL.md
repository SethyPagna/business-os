---
name: repo-patterns
description: Mine this repository's Git history for repeated coding, review, testing, migration, and release conventions, then use evidence-backed patterns to plan work or propose reusable skills. Do not use commit frequency alone as proof of a rule.
---

# Repository patterns

Run `node agent-team/scripts/mine-git-history.mjs` and read the cache path it prints before planning cross-cutting work, reviewing a change, or proposing another project skill. The report lives under Git's shared metadata so every worktree can use it without dirtying the repository.

Treat the report as evidence, not authority. Validate a pattern against `AGENTS.md`, `progress.md`, current code, and representative commits. Durable instructions belong in a skill only when they recur, change future decisions, and are not temporary lane status. Never infer permission to deploy, migrate, overwrite, or stage files from historical behavior.

When proposing a new skill, provide its trigger, the non-obvious decisions it improves, Git and current-code evidence, essential instructions and resources, and overlap with existing skills. Save candidates outside active skill directories; promotion into an active skill requires normal review.
