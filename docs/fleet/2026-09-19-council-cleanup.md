# Council protocol and laptop cleanup checkpoint

## Newest execution checkpoint

Goal active. Owner confirmed Claude processes are idle. Fresh origin fetch
succeeded; current pre-cleanup HEAD fe4d035f has 22 commits not reachable from
origin refs. Full read-only scan completed for all 596 registered worktrees:
2 required, 160 local-work/unbacked-HEAD, 372 ignored-data review, 62 clean
remote-contained candidates. No missing registered paths. Local generated
manifest: outputs/checkout-cleanup-20260919/manifest.json.

Removed exactly three redundant checkouts using `git worktree remove` WITHOUT
force, after fresh clean/ignored/HEAD/path/nesting/process/claim checks and live
`ls-remote` verification of the archive branches:

- C:/Users/mrkl6/Downloads/bos-active-data-completeness-20260908
  — e4d9e0b71a0b13afbbe0fa5a2a0f1059405d1972
- C:/Users/mrkl6/Downloads/bos-backend-gate-merge-harness-20260908
  — 804bc0ef05899206a14f6d3f1673958b8a6827c6
- C:/Users/mrkl6/Downloads/bos-canonical-branch-i18n-20260908
  — 146a365a7678295d88dbb2849eb0d3330ab088f6

No branches or commits removed. Recovery: `git worktree add <original-path>
<retained-branch>` or a detached checkout at the recorded commit. Exact branches
and remote evidence are in outputs/checkout-cleanup-20260919/removed.json.
No reparse points inside these candidates; no inbound link found at registered
root/frontend/cloudflare/node_modules dependency locations. This was not a scan
of every arbitrary filesystem reference on the laptop.

Postcheck: 593 registered worktrees; active HEAD unchanged fe4d035f; shared Git
directory still resolves; tracked active files unchanged by removal. No runtime
changes or deploy. Remaining 59 clean candidates need final checks, then ignored
and local-only material must be preserved/reviewed. Earlier no-deletion statements
below are historical and superseded by this execution checkpoint only.

## Delivered

Personal Codex skill: `C:/Users/mrkl6/.codex/skills/ai-council-review/SKILL.md`.
Cross-provider tracked protocol: `docs/AI_COUNCIL_REVIEW.md`, linked from AGENTS.md.
Five independent first passes, anonymized cross-critique and Chairman verdict are
required for council reviews; single-model simulation must be disclosed. Detailed
maintainability review evidence and deletion safeguards are included. Existing
findings remain in `2026-09-19-maintainability-audit.md`; the deeper account/tier
audit is `2026-09-19-device-tier-audit.md`. These are findings, NOT completed fixes.

Standard skill quick_validate.py could not execute because the available Python
lacks PyYAML. A separate structural check covers frontmatter and required stages;
it is not independent behavioral certification.

## Cleanup inventory — read-only

Actual Downloads directory-name scan: 500 bos/business-os-prefixed directories.
Git registration inventory: 596 worktrees, including 505 Downloads/bos* and 60
Downloads/business-os-v1* paths, 31 elsewhere, 58 detached and no prunable flags.
Registration counts differ from physical scan; reconcile exact paths before use.

Keep `C:/Users/mrkl6/Downloads/business-os-v1`: it owns the common .git directory.
Keep `C:/Users/mrkl6/Downloads/bos-supplier-settlement-20260918`: active continuation,
linked to that common directory. The primary contains 73 tracked changes, 232
untracked entries and 2,040 ignored entries (not all expendable; includes local
credentials/config). Active HEAD before this documentation work was 53253782;
21 commits were not reachable from any local remote-tracking reference. No fresh
GitHub fetch/verification was performed, so remote absence is not established.

Three sampled recent worktrees (legacy-account-cleanup, blocked-storage-auth and
p10-18-payment, all 20260918) are tracked/untracked clean but their HEADs are not
in active ancestry or any local remote-tracking ref. They contain node_modules
junctions to retained workspaces. None is proven disposable by this sample.

## Next safe cleanup steps

1. Inventory every exact candidate, active claims/processes and junctions.
2. Verify fresh remote reachability; preserve unique commits without rewriting
   history. Preserve non-rebuildable ignored/untracked material securely; do not
   upload secrets to GitHub as a backup strategy.
3. Resolve the desired retained workspace with the owner. Keep primary Git
   storage until an explicitly verified relocation is complete.
4. Present an exact remove/archive manifest. Use Git-aware removal only for
   verified clean redundant worktrees, without force; archive uncertain material.
5. Recheck retained repository, build dependencies and handoff after cleanup.

No directories or files deleted. No production changes or deployment.
