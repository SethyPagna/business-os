# Cross-tool agent team setup

This repository has one provider-neutral team definition under `agent-team/`. A deterministic generator creates equivalent adapters for Codex, Claude Code, and GitHub Copilot. `AGENTS.md` holds shared rules; provider-specific files contain only mechanics.

Run these after editing canonical definitions:

```powershell
node agent-team/scripts/sync-adapters.mjs
node agent-team/scripts/validate-team.mjs
node agent-team/scripts/team-state.mjs doctor
node agent-team/scripts/test-team-state.mjs
```

## Example prompts

- “Use the feature planner, architect, designer, and security reviewer in parallel. Plan this feature, wait for all agents, then give me one reconciled implementation plan.”
- “Have the build fixer reproduce this failure and repair it. Keep the security reviewer read-only and ask it to inspect the resulting diff.”
- “Use the Playwright tester to cover this checkout flow.” If Playwright is not installed, it will report the missing prerequisite instead of inventing a test run.
- “Use the skill miner to inspect Git history and propose one new skill. Do not create it until the evidence is convincing.”

## What learns automatically

Session-start hooks summarize the last 300 commits into a shared cache beneath Git's common directory. This avoids dirtying the checkout and makes the same report visible from every worktree. The `repo-patterns` skill requires validation against current code and instructions before a reviewed promotion into a durable skill.

Codex requires project trust and a one-time review of new or changed hooks. Claude Code loads its hook from `.claude/settings.json`. Inspect hooks with `/hooks` in either client and restart after changing agent definitions. Claude's experimental communicating agent teams are intentionally opt-in; ordinary subagents work without enabling them.

## Prebuilt MCP

The `docs-researcher` role includes the official OpenAI Developer Docs MCP as a read-only example. Claude Code reads the shared root `.mcp.json`; Codex receives its adapter in the generated agent TOML; Copilot receives an inline MCP declaration in its generated custom-agent profile. `agent-team/capabilities.json` describes capability intent independently of provider server names.

## Cross-tool coordination

Claims and messages live under Git's common directory, shared by all worktrees without entering commits:

```powershell
node agent-team/scripts/team-state.mjs status
node agent-team/scripts/team-state.mjs claim --task example --agent claude-code/build-fixer --mode write --path frontend/src/example.ts --worktree C:/worktrees/example --branch claude/example
node agent-team/scripts/team-state.mjs message --from codex/architect --to claude-code/build-fixer --text "Contract is frozen at commit abc1234"
node agent-team/scripts/team-state.mjs inbox --agent claude-code/build-fixer
node agent-team/scripts/team-state.mjs release --claim CLAIM_ID
```

The shared ledger is a cooperative collision guard, not a permission grant. It deliberately refuses `production` claims and authorization flags. Clients may claim `production-coordination` for mutual exclusion, but must still enforce their own approval rules and re-check the user's authorization immediately before acting.

## Boundaries

This repository has no Go module, so the Go reviewer stays activation-gated. The Playwright suite lives in `frontend/e2e/` (see its README); the Playwright tester runs it. The existing application is React/Vite plus Cloudflare Workers/D1, with extensive Node-based contract tests. Production deployment and remote migration remain explicitly user-gated.
