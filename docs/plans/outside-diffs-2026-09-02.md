# Outside-session diff record — RC `rc/coordinated-2026-09-02`

Reference to re-verify (run the commands again before acting on it). This file records what
changed OUTSIDE this release-candidate effort while it ran — other sessions' commits on
`origin/main`, other branches, and the main checkout's uncommitted state — so the RC can be
compared against them without ever pulling, merging, rebasing, or cherry-picking them in.

Base commit of the RC: `57d8f1a2` (fix(release): capture consolidated runtime and scanner lifecycle).

## Sweep 1 — after Gate 1 + first three merges

| Check | Command | Result |
|---|---|---|
| Commits on origin/main beyond base | `git log --oneline 57d8f1a2..origin/main` | none |
| Commits on local main beyond base | `git log --oneline 57d8f1a2..main` | none |
| Remote branches ahead of origin/main | `git rev-list --count origin/main..<branch>` for every `origin/*` | none (incl. `codex/spark-product-ui-suite` = 0) |
| Main checkout dirty state vs baseline snapshot | `git status --porcelain` vs `bos-rc-workers/baseline/main-status.txt` | identical: `Dashboard.tsx` (1 line), `dashboardDataReliability.test.ts` (+2), `progress.md` (+3/-1), plus untracked `CHECKPOINT*`, `run-log.txt`, `tmp/`, `outputs/`, `Migration from old system/` |

Overlap risk with the RC so far: the main checkout's uncommitted `progress.md` hunk (+3/-1) will
conflict with Section 9's restructure when the RC lands — re-apply that hunk into the new Status
block by hand at that time.

## Sweep 2 — at RC certification

(filled in at the end of the effort)
