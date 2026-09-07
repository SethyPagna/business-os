# Multi-agent examples

## Plan a cross-layer feature

> Use the orchestrate-team skill. Run the feature planner, product designer, Business OS architect, and security reviewer in parallel as read-only agents. Give each a bounded task contract. Wait for all four, show disagreements, then produce one acceptance-criteria matrix and non-overlapping implementation slices. Do not implement yet.

CLI-neutral setup before writers begin:

```powershell
node agent-team/scripts/team-state.mjs status
node agent-team/scripts/team-state.mjs claim --task reports-discount --agent codex/build-fixer --mode write --path cloudflare/src/lib/salesAnalytics.ts --worktree C:/path/to/worktree --branch codex/reports-discount
```

The claim prevents cooperative agents from taking the same path. It does not grant filesystem, network, deployment, or production permission.

## Fix a difficult regression

> Have the architect trace the failing path and the security reviewer inspect its trust boundary in parallel. Then give the build fixer sole ownership of the identified files. After the fix, use a fresh read-only reviewer to verify the integrated diff and actual focused test output.

## Introduce Playwright safely

> Ask the Playwright tester to confirm the applicability gate first. If Playwright is absent, return a bootstrap plan and exact files without installing anything. After I approve the bootstrap, isolate its writes to Playwright config and E2E files and keep production URLs forbidden.

## Cross-tool handoff

> Codex: plan the feature with read-only specialists and write the result envelope to a committed planning document. Claude Code: implement from that commit in a worktree using the matching generated specialist. Copilot: review the branch with the generated security-reviewer profile. The final lead must re-run integrated verification and reconcile all findings.

Claude Code normal subagents work without experimental settings. For sustained communicating teammates, opt in for that invocation only:

```powershell
$env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS='1'
claude
```

Do not commit that environment choice into shared settings.

## Mine a new reusable skill

> Use the skill miner to run the Git-history report, validate the pattern against representative commits and current code, and propose one narrow skill. Do not create it unless the evidence shows a recurring workflow that is not already covered.
