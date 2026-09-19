# AI Council and maintainability review protocol

Apply this protocol when the owner submits an idea or decision for evaluation or requests an AI Council / maintainability review. Routine implementation and status updates do not require a council ceremony.

## Independent views, then critique, then verdict

1. Gather five first-pass views independently: Contrarian Skeptic (failure modes and worst case); First-Principles Engineer (provable facts and invariants); Expansionist (ambitious unconstrained end state, explicitly aspirational); Outsider (fresh reading without historical assumptions); Executor (one simple next experiment).
2. Present the first-pass proposals under anonymous labels for cross-critique. Each reviewer identifies strongest points and blind spots. Preserve disagreements and distinguish evidence from conjecture.
3. The Chairman supplies the one-hour decision, the biggest risk, and the number-one next step.

Use bounded read-only agents when appropriate and authorized. If one model simulates the views, disclose this; do not claim five independent reviewers or blind validation. The expansionist does not waive safety, business constraints or action permissions. Follow agent-team/TEAMWORK.md for durable coordination.

## Required code-review evidence

Cover dead functions, files, UI components, routes, APIs, variables, imports and dependencies; duplicate logic; needless complexity; legacy paths; redundant queries and requests; disconnected files; and technical debt.

Every finding needs an ID, location, evidence and confidence, reason it is unnecessary/costly, estimated impact, deletion risks, recommended action and verification. Publish coverage and limitations. Search misses and unused declarations are not alone proof that a runtime path is dead. Trace dynamic entrypoints, external clients, service workers, background jobs, imports, permissions, offline work, accounting snapshots, audit and undo consumers.

Recommend staged cleanup with focused regression tests, package gates and rollback. Preserve migrations and business evidence. Do not delete or deploy merely because a review recommends it. Prefer measured improvements over speculative savings.

## Laptop checkout cleanup

An old directory name does not prove redundancy. Before removal, verify its exact resolved path, Git common-directory dependency, uncommitted and untracked work, ignored local data/secrets, unique commits, current remote reachability, running processes and active agent claims. GitHub contains committed/pushed material, not necessarily local source files, database fixtures, receipts, credentials or audit evidence.

Keep the selected current workspace and its Git common directory. Classify candidates as retain, preserve-and-review, or safe-to-remove. Do not delete the primary checkout while linked worktrees depend on its .git directory. Use an exact approved manifest and recoverable archive where practical. Never target all Downloads or the user's home directory. Record what was removed and recovery location.
