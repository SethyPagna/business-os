# business-os — CLAUDE.md

Loaded into every session on this shared checkout, so this file is a short pointer document. State
(status, lane claims, the queue) lives in `progress.md`; narrative lives in
`docs/history/session-log.md`. Never add lane progress or Part numbers here.

## Start here

1. Read [progress.md](progress.md) top-to-bottom: status snapshot, *Current status* claims, the
   queue, and the **Golden Rules** section (the project's non-negotiables — authoritative there).
2. Run `ListAgents` to confirm your session name. Other sessions share this working tree and its
   one git index at the same time; some lanes work in their own `rc/*` worktrees (`git worktree list`).
3. **Talk before you touch.** Before editing any file, `SendMessage` every live peer with the exact
   files you are about to take and sweep the ChatGPT/Codex branches
   (`git fetch --prune && git branch -r --no-merged origin/main`). A reply naming a file is binding.
   Protocol: the skill's "First instinct" section.
4. Invoke `/fleet-coordination` ([.claude/skills/fleet-coordination/](.claude/skills/fleet-coordination/SKILL.md))
   whenever more than one session is active and for any coordinate / verify / reconcile / deploy /
   compaction / docs task. It is the operating playbook; this file only points at it.

## The two rules whose violation hurts peers within minutes

- Never `git add -A` or `git add .`. Stage exact paths; commit shared files atomically with
  `git commit -m "..." -- <paths>`; diff every file immediately before committing it.
- Never rewrite a pushed commit and never delete a peer's in-flight lines from the working tree.

Everything else — verify-for-real in both packages, root cause over symptom, sibling-surface parity,
both language packs, per-action permissions, staged user-gated deploys from committed HEAD, the
≤300K context ceiling — is specified in progress.md → Golden Rules and in the skill.

## Commands (Bash tool)

```bash
cd frontend && npm run test:utils && npm run verify:i18n && npm run build
```

`test:utils` runs typecheck + source checks + every `tests/*.test.ts` through `tests/runTestChain.ts`,
which discovers files by reading the directory (a new test is wired in by existing), keeps going after
a red and lists every red at the end; `--bail` restores stop-at-first and positional terms filter files
(`node tests/runTestChain.ts receipt`). The per-file loop still works when hunting:
`for f in tests/*.test.ts; do node "$f" >/dev/null 2>&1 || echo "RED $f"; done`.

```bash
cd cloudflare && npx tsc --noEmit && cd scripts && for f in test-*.cjs; do node "$f" >/dev/null 2>&1 || echo "RED $f"; done
```

Browser targets are in `.claude/launch.json` (`frontend` 5173 = live edits, proxies `/api` to the
Worker; `worker-dev` 8787 = shared Worker serving the last build; production URLs read-only). Use
Node, not Python, for scripting.

## Conventions

Dates, business-day timezone, receipt ids, the two canonical branches, the one revenue definition,
batch + branch stock identity and the UI conventions are specified with grep leads in
[.claude/skills/fleet-coordination/references/consistency-audit.md](.claude/skills/fleet-coordination/references/consistency-audit.md).

## Layout

`frontend/` (Vite + React PWA) · `cloudflare/` (Worker + D1, migrations, pure `scripts/test-*.cjs`) ·
`ops/scripts/` (verification and migration tooling) · `docs/` (dated audits, session log).
