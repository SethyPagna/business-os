---
name: orchestrate-team
description: Coordinate specialized agents across Codex, Claude Code, or Copilot for complex repository work using bounded roles, non-overlapping ownership, evidence-based handoffs, and staged verification. Use when the user requests multiple agents, parallel work, an agent team, or cross-tool collaboration.
---

# Orchestrate the agent team

Read `agent-team/TEAMWORK.md`, then choose the smallest useful topology:

- Work directly for a small, sequential, single-surface task.
- Use parallel read-only specialists for independent exploration, design, architecture, security, documentation, or test analysis.
- Use a sequential pipeline when one result determines the next: plan → implement → verify.
- Use isolated worktrees for concurrent writers or overlapping file sets. If isolation is unavailable, serialize writers.

Do not spawn every role by default. Usually two to four specialists plus the lead is enough. The lead owns requirements, decisions, path allocation, synthesis, and the final truth claim. Agents return the shared result envelope from `agent-team/prompts/_base.md`.

Before delegation, create a task contract with objective, acceptance criteria, allowed actions, owned paths, dependencies, and verification. One path has one writer. Reviewers remain read-only. Wait for all required evidence, reconcile disagreements explicitly, and verify the integrated result rather than trusting individual summaries.

For ready-to-use prompts, read `agent-team/EXAMPLES.md`.

