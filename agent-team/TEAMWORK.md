# Cross-tool teamwork protocol

## Task contract

The lead creates one contract per delegated task:

| Field | Required content |
|---|---|
| Objective | One observable outcome |
| Acceptance | Checks that decide done/not done |
| Role | One generated specialist name |
| Access | Read-only or workspace-write |
| Ownership | Exact files or directories; `none` for review |
| Dependencies | Inputs that must arrive first |
| Verification | Commands or observations required |
| Stop conditions | Scope conflict, missing authority, unsafe data, or repeated failure |

Create shared claims with `node agent-team/scripts/team-state.mjs claim ...` before write work. All worktrees use the same state beneath Git's common directory. Use `status`, `heartbeat`, `message`, `inbox`, and `release` for provider-neutral coordination; native agent messaging is an optimization, not the only record. This ledger is a cooperative collision guard, not an authorization system. It rejects `production` claims and all `--authorization` flags so no agent can manufacture an approval marker. Use the `production-coordination` resource only for mutual exclusion, while every executing tool separately re-checks the user's explicit approval immediately before a production action.

## Execution waves

1. **Discover:** parallel read-only planner, architect, designer, security, documentation, or test investigations.
2. **Decide:** the lead resolves conflicting recommendations and records acceptance criteria and path ownership.
3. **Implement:** one writer per file set. Independent writers use separate worktrees; otherwise serialize them.
4. **Verify:** a reviewer or tester rechecks the integrated result from source and observable behavior. A writer's green result is evidence, not certification.
5. **Synthesize:** the lead reports the final outcome, commands actually run, residual risks, and anything not done.

## Cross-tool handoff

Codex, Claude Code, and Copilot do not share a live message bus. They collaborate through committed branches or explicit workspace artifacts, not assumed memory. A handoff must include the shared result envelope, base commit, branch/worktree, owned paths, and whether changes are committed. Never ask a second tool to continue from “what the other agent said” without those artifacts.

Use subagents for bounded context isolation and noisy reads. Use full parallel sessions or agent teams for sustained work. Use worktrees whenever writers could overlap. More agents are not automatically better: coordination cost rises quickly beyond four active specialists on one feature. For Claude Code agent teams, use only roles whose `teamEligible` value is not `false`; the remaining roles rely on normal subagent permission/worktree controls and must not be promoted to teammates.

## Conflict rules

- A reply or task contract naming a path is binding ownership.
- New overlap stops the later writer until the lead reallocates or serializes work.
- Never resolve conflicts by discarding another agent's changes.
- Reviewers do not make opportunistic fixes.
- Production mutations stay user-gated regardless of which tool performs them.

## Result validity

Use `agent-team/schemas/task-envelope.schema.json` and `agent-team/schemas/result.schema.json` for durable cross-tool handoffs. A “green” claim without command, scope, exit code, expected result, and observed result is invalid. Handoffs between tools must pin `base_sha`, `head_sha`, branch/worktree, commits, dirty state, and uncompleted work.

Run `node agent-team/scripts/test-team-state.mjs` after changing coordination, claim, production-guard, or envelope-validation behavior.
