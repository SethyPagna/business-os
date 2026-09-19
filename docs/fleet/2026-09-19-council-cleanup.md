# Council protocol and laptop cleanup checkpoint

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
