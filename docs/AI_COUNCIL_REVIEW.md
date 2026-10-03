# AI Council and maintainability review protocol

Apply this protocol when the owner submits an idea or decision for evaluation or requests an AI Council / maintainability review. Routine implementation and status updates do not require a council ceremony.

## Independent views, then critique, then verdict

1. Gather five first-pass views independently: Contrarian Skeptic (failure modes and worst case); First-Principles Engineer (provable facts and invariants); Expansionist (ambitious unconstrained end state, explicitly aspirational); Outsider (fresh reading without historical assumptions); Executor (one simple next experiment).
2. Present the first-pass proposals under anonymous labels for cross-critique. Each reviewer identifies strongest points and blind spots. Preserve disagreements and distinguish evidence from conjecture.
3. The Chairman supplies the one-hour decision, the biggest risk, and the number-one next step.

Use bounded read-only agents when appropriate and authorized. If one model simulates the views, disclose this; do not claim five independent reviewers or blind validation. The expansionist does not waive safety, business constraints or action permissions. Follow agent-team/TEAMWORK.md for durable coordination.

## Evidence and refutation discipline

- Give an independent reviewer the owner acceptance criteria and exact base/head artifacts before the author's conclusions. Separate contexts using the same model are separate reviews, not model diversity. Record any exposure to peer conclusions; filter coordination inventories to claims so historical messages do not contaminate a blind first pass.
- Every perspective challenges a different assumption and proposes a discriminating counterexample. Anonymous cross-critique must preserve disagreements. A majority verdict is not proof of correctness; the Chairman names the unresolved risk and the next experiment that can disprove the preferred design.
- Bind each observation to committed source, dirty state, command or method, raw result and coverage. Distinguish pure invariants, actual route/database behavior, failure/race/replay controls, composed whole-suite checks, browser interaction and deployed provenance. Passing one layer does not imply another ran.
- A test must fail for a plausible wrong implementation. Check semantic error identity and persisted state, not only a status code or toast. Permissive import stubs can silently accept invalid inputs or ignore filters; enumerate recursive, custom, extracted and inherited loaders as well as named loader patterns.
- Preserve original failures and retries. Classify infrastructure failures separately from assertions; a corrected test fixture needs its own evidence that the original business assertions remain intact. Source-equivalent evidence is qualified by exact content comparison and does not replace the release gate on the final SHA.
- A precise protective refusal is a useful interim safeguard, not completion of a requested user flow. State unsupported consumers and recovery paths explicitly and keep the full owner acceptance scope until they pass. Never promise absence of all loopholes from a finite test or review scope.

Incident: an independent October 2026 date review found a profit fixture's no-op helper silently returned revenue outside the selected time window while its existing tests passed; custom loader and exact boundary controls exposed the gap.

## Required code-review evidence

Cover dead functions, files, UI components, routes, APIs, variables, imports and dependencies; duplicate logic; needless complexity; legacy paths; redundant queries and requests; disconnected files; and technical debt.

Every finding needs an ID, location, evidence and confidence, reason it is unnecessary/costly, estimated impact, deletion risks, recommended action and verification. Publish coverage and limitations. Search misses and unused declarations are not alone proof that a runtime path is dead. Trace dynamic entrypoints, external clients, service workers, background jobs, imports, permissions, offline work, accounting snapshots, audit and undo consumers.

Recommend staged cleanup with focused regression tests, package gates and rollback. Preserve migrations and business evidence. Do not delete or deploy merely because a review recommends it. Prefer measured improvements over speculative savings.

## Laptop checkout cleanup

An old directory name does not prove redundancy. Before removal, verify its exact resolved path, Git common-directory dependency, uncommitted and untracked work, ignored local data/secrets, unique commits, current remote reachability, running processes and active agent claims. GitHub contains committed/pushed material, not necessarily local source files, database fixtures, receipts, credentials or audit evidence.

Keep the selected current workspace and its Git common directory. Classify candidates as retain, preserve-and-review, or safe-to-remove. Do not delete the primary checkout while linked worktrees depend on its .git directory. Use an exact approved manifest and recoverable archive where practical. Never target all Downloads or the user's home directory. Record what was removed and recovery location.
