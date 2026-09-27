---
name: deploy-provenance
description: >-
  Establish what production ACTUALLY contains before deploying, and reconcile the gap. Use this
  before any deploy, and whenever a deploy appears to have reverted working features, the user says
  something "came back", "reverted", "went missing", "is the old version" or "you deployed the wrong
  code", a deploy's source is unknown or undocumented, migrations disagree with the branch, or you
  are about to build from a branch tip while someone else may have deployed from a dirty tree.
  Covers: proving the live build's provenance from Cloudflare + D1 + git evidence rather than
  assuming it; the four readings that look like confirmation and are not; reconciling unmerged lanes
  into a certified branch; union-not-choice conflict resolution for the i18n packs and the
  package.json test chain; and the deploy record that stops the next session repeating it.
---

# Deploy provenance — know what is live before you replace it

A deploy does not add your changes to production. It **replaces production wholesale** with the
tree you build from. Anything live that is not in your build is deleted from production by your
deploy, silently and with a green health check.

This skill exists because that happened here on 2026-09-03: a deploy from a clean, fully certified
`main` rolled back 24 commits of hotfix lanes that were live but never committed to `main`. Every
check passed. The user found the regression, not the checks.

## The rule

> **Never deploy until you can name the source of the build you are replacing.**

Not "HEAD is certified green". Not "HEAD is a superset of the last commit production was built
from". Name the commit or branch the live build came from, or prove you cannot — and if you cannot,
reconcile before you ship.

## Step 1 — What is live right now

Run all three. They are independent, and no one of them is sufficient.

```bash
cd cloudflare && npx wrangler deployments list
```

Gives the version id and timestamp of every deploy, newest last, plus `Source` (`Unknown
(deployment)` = a `wrangler deploy`; `Secret Change` = a secret write, not a code change). It does
**not** give you the source commit — Cloudflare never sees your git history. Note the timestamp of
the deploy you are replacing; it is your anchor for step 2. Timestamps are UTC and the repo's
commit dates may be local (+07 here) — convert before comparing or you will read the branch
topology backwards.

```bash
cd cloudflare && npx wrangler d1 execute business-os --remote \
  --command "SELECT id, name FROM d1_migrations ORDER BY id DESC LIMIT 5" --json
```

The applied migration list is the **strongest** provenance evidence available, because migrations
are numbered, ordered and irreversible. A migration in production that is not on `main` proves the
live build came from a branch that has it. Follow that migration back to the branch that
introduced it and you have found the deploy source.

```bash
git for-each-ref --sort=-committerdate \
  --format='%(committerdate:iso8601) %(refname:short) %(subject)' refs/heads refs/remotes | head -25
```

Branches whose tips land in the minutes **before** the deploy timestamp are your candidates. A
burst of merge commits followed immediately by a deploy is an integration branch being shipped.

Then confirm containment rather than guessing:

```bash
git merge-base --is-ancestor <lane> <candidate> && echo IN || echo OUT
```

## Step 2 — The four readings that look like confirmation and are not

Each of these was believed in the incident above. Each was wrong.

**"`wrangler d1 migrations list --remote` says no migrations to apply, so we are in sync."**
It says your local chain is not *ahead* of production. It says the identical thing when production
is *ahead* of you — which is the dangerous case, and the one that was true. Always read
`d1_migrations` directly and compare the highest id to your migration directory.

**"Production's base commit is an ancestor of HEAD, so HEAD is a superset."**
Only true if production was built from a commit. A deploy from a dirty working tree, or from an
unmerged branch, has no commit in your ancestry to find. Commit ancestry cannot detect what it
cannot see. This is the core failure — ancestry answers a question about commits, and the deploy
was not made from one.

**"The working tree is dirty, so the uncommitted lanes must still be here."**
Maybe, but they may also have been committed onto a branch already (here, `7afc8a71` had imported
the whole working-tree batch onto the hotfix branch). Diff the tree against the candidate branch
before treating it as the only copy — and before "rescuing" work that is already safely committed
somewhere better reviewed.

**"This migration number collides, so renumber it per the standing rule."**
Check `d1_migrations` first. A migration **already applied in production** is identified by its
filename. Renumbering `0106_x.sql` to `0108_x.sql` makes D1 treat an applied migration as new and
re-run its `ALTER TABLE`, which fails the deploy. The "new migrations take NNNN or later" rule
applies to migrations that have never run anywhere. Applied filenames are frozen.

## Step 3 — Reconcile in an isolated worktree

Never reconcile in the shared tree: peers are working in it, and a merge conflict there blocks
everyone.

```bash
git worktree add -b reconcile/<date> C:/Users/mrkl6/Downloads/bos-rec main
```

Use a **short path** — deep `node_modules/.pnpm/…` paths hit the Windows MAX_PATH limit.

Merge the deployed baseline first, then each additional lane, one at a time, committing between
merges so a bad lane is a single revert. After merging, confirm the shared dirty tree has become a
subset:

```bash
git -C <main tree> diff --numstat reconcile/<date> -- frontend/src cloudflare/src | awk '$1 > 0'
```

Insertions here are what the tree still holds that the branch lacks. Read every one; most are
counterpart lines of a modified hunk, but a real unique lane hides in the same list.

### Conflicts here are unions, not choices

Three files in this repo conflict on nearly every lane merge, and picking a side silently deletes
work in all three:

- **`frontend/src/lang/en.json` / `km.json`** — each lane *adds* keys. Union both sides and dedupe
  by key. Re-`JSON.parse` both packs afterwards: the side that had been the object's last entry
  loses its trailing comma when the other side's keys are appended after it. This checkout is
  `autocrlf`, so match `\r?\n`, not `\n`.
- **`frontend/package.json`** — the `test:utils` chain is one very long single line and every lane
  appends its own `node tests/<name>.test.ts` to it. Taking either side drops a lane's test from
  the chain CI runs, silently and permanently. Union the invocations. Two test files were recovered
  this way in the incident above.

Verify the union by grepping for each side's distinctive entry afterwards. Do not trust the merge.

## Step 4 — Certify, then deploy

Certify the reconcile branch in its own worktree with a real `npm ci` — both typechecks,
`verify:i18n`, both full test sweeps, `check:source`, the chain-coverage test, and a real
`vite build`. See `fleet-coordination/references/verification.md` and `deploy.md`; the deploy
mechanics (isolated worktree, `.wrangler-auth.local`/`.dev.vars` copy, `secrets:sync` caution,
version id capture) live in `deploy.md` and are not repeated here.

Before deploying, state explicitly, from evidence: **the migration chain's top number, and
production's highest applied id.** If they are equal the deploy applies zero migrations and touches
no data. If they are not, say so out loud before proceeding.

A test that fails on a merged branch is a suspect, not a verdict. Here the by-id lock test went red
because a lane had split one expression across two lines for an unrelated reason. Check whether the
*behaviour* changed before you change the code; if only the shape moved, the assertion was pinning
formatting and the test is what needs fixing.

## Step 5 — Write the record, always

The 07:26 deploy in this incident left **no entry in `progress.md`**. That single omission is why
provenance had to be reconstructed from Cloudflare and D1 at all, under time pressure, with the
user waiting on a live regression.

Every deploy gets, at minimum:

- the **wrangler version id** (only wrangler prints it — `/health`'s `version` field is a hard-coded
  string, not the deploy id),
- the **commit hash and branch** it was built from, and whether the tree was clean,
- the **highest migration applied**, and whether the deploy applied any,
- what shipped **beyond the previous live version**, and
- whether `secrets:sync` ran.

Record it on the `progress.md` board and in a `docs/history/session-log.md` Part, marked
*reference to re-verify* rather than ground truth. If you deployed from a branch that is not
`main`, say so in capital letters — that is the exact fact whose absence caused this.
