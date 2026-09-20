# Business OS agent operating guide

Read `progress.md` before planning or editing. It is the live coordination and deployment ledger. Load the relevant project skill from the current tool's skill directory. Tool-specific adapters may add mechanics but must not override this provider-neutral guide.

## Specialized delegation

For owner-submitted ideas/decisions and maintainability reviews, follow
`docs/AI_COUNCIL_REVIEW.md`: five independent perspectives, anonymized
cross-critique, then a Chairman verdict. Disclose simulated rather than independent
reviews. Codex can also load the personal `ai-council-review` skill. This process
does not authorize runtime edits, deletion, data mutations or deployment.

For complex work, delegate independent read-heavy tasks first and consolidate their evidence before edits. Canonical roles live in `agent-team/agents.json` and generate adapters for Codex, Claude Code, and Copilot:

- `feature_planner` for feature scope and acceptance criteria.
- `product_designer` for interaction, responsive, accessibility, and i18n review.
- `business_os_architect` for cross-layer architecture and data-impact plans.
- `security_reviewer` for threat-focused, read-only reviews.
- `build_fixer` for reproducing and repairing build/type/test failures.
- `implementation_worker` for one bounded, isolated implementation slice.
- `playwright_tester` for browser E2E work when Playwright is installed.
- `go_reviewer` only when Go files or a Go module are in scope.
- `skill_miner` for converting repeated repository patterns into skill proposals.
- `docs_researcher` for version-sensitive API documentation.
- `verifier` for adversarial certification without fixes.
- `reconciler` for integrating completed branches without behavioral loss.

Do not delegate overlapping write ownership. Parallel agents should normally explore, review, or test; assign one implementation owner per file set. Wait for delegated results and report disagreements rather than silently choosing one.

Use `node agent-team/scripts/team-state.mjs` for cross-tool claims, heartbeats, messages, and releases. Native tool messaging alone is not a durable handoff. Writers use isolated worktrees; if isolation is unavailable, serialize them. Use the task and result schemas in `agent-team/schemas/` for durable handoffs.

## Non-negotiable repository rules

- Preserve the dirty shared worktree. Never reset, discard, stage, or rewrite changes you do not own. Do not use `git add .` or `git add -A`.
- Trace sibling UI, API, import, bulk, offline, permissions, i18n, audit, and undo surfaces before declaring a feature complete.
- Frontend validation must have backend enforcement and a focused parity test.
- Treat deployments, remote migrations, secret sync, and remote D1 commands as production actions requiring explicit user authorization. Planning and review agents must not run them.
- Never infer that `main` is deployed. Production claims require recorded commit/deployment provenance.
- D1 migrations are append-only. Keep trigger SQL LF-only and pair data changes with pre/post assertions and recovery notes.

## Local verification

## Continuous cleanup and compact-UI acceptance gates

- Apply `docs/AI_COUNCIL_REVIEW.md` throughout substantive design, cleanup and release decisions: independent perspectives, cross-critique and evidence-based verdict. Routine implementation/status does not require repeating the ceremony; preserve its decisions and unresolved objections. Disclose simulated reviews.
- Inspect touched surfaces for dead code, duplicate logic, unused UI/dependencies, redundant requests and avoidable complexity. Remove only proven-unused behavior after tracing dynamic, external, permission, audit, recovery and historical consumers. Do not remove safety checks or financial rules as "debloat". Record candidates, evidence, risk, tests and rollback; preserve migrations and recovery evidence.
- Preserve the owner's established compact UI. Fit related controls/metadata in one useful row first; wrap only when necessary for readability, localization, touch targets or available width. Use two-column pairings where useful, including public-portal details/forms; do not default every item to a full-width row or card.
- Reuse existing shared controls and Manage-height button conventions; keep sibling pages consistent. Avoid introducing competing spacing, size or date-control variants. Preserve established product-name wrapping, invisible horizontal scrolling and compact edit/read modes.
- Verify affected layouts at narrow/mobile and desktop widths, EN/KM and long-content cases. No clipped values, out-of-bounds inputs/tooltips, inaccessible actions or accidental page-wide horizontal overflow. Compactness must not hide required information or weaken permission/data-isolation boundaries.

## Verification commands

Use the smallest focused test first, then the affected package gates:

```powershell
Push-Location frontend
npm run typecheck
npm run verify:i18n
npm run build
Pop-Location

Push-Location cloudflare
npm run typecheck
Pop-Location
```

`frontend npm run test:utils` and the full `cloudflare/scripts/test-*.cjs` sweep are broad certification gates. `run/verify-local.bat` is the canonical local wrapper but installs/builds and cleans known strays, so use it intentionally. Never run `run/full-automation.bat` as verification.
