# Several clients, one codebase

Business OS is one codebase that is deployed, unchanged, for several shops. Each shop (a **client**) has its
own Cloudflare account, its own data and its own approval. A release for one client cannot touch another.

Owner rules (22 Oct 2026):

- One clean public repository deploys updates uniformly to every client.
- Leang Cosmetics (LeangBeauty) has its own Cloudflare account. BM Shop and future clients share a second one.
- **A client's data is never fixed through the shared code.** No migration, seed, script or query that names one
  client's rows, ids or settings goes into this repository. A fix for one client is run against that client, by the
  person who owns it, through the ops workflow (read-only queries) or by hand with their own login, and is recorded
  in that client's own notes, not here.

## What is shared and what is the client's

| Shared (this repository) | The client's (nowhere in the repository) |
|---|---|
| The Worker code, the frontend, the migrations | Cloudflare account id, the API token, the Worker name |
| `cloudflare/wrangler.template.toml` (placeholders only) | D1 database names and ids, R2 bucket, KV id, Analytics dataset, queue prefix |
| `cloudflare/admin-forwarder/` template | Domains or workers.dev addresses, organization name, shop identity |
| `clients/example.env` (fake values, documents every variable) | Sentry, e-mail sender and Google client ids |
| The four workflows and the ops scripts | The GitHub **environment** of the client: reviewer, secrets, variables |

`cloudflare/wrangler.toml`, `cloudflare/wrangler.free.toml` and `cloudflare/admin-forwarder/wrangler.toml` do not
exist in the repository. They are **generated** from the template and one client's values, and are gitignored.

## How a run finds its client

Every workflow (Deploy, Deploy rollback, Ops, Metrics) first asks **which client**. That choice is the name of a GitHub
environment, and the run uses nothing else:

1. The job waits for that environment's **required reviewer** (one approval per client).
2. **Check the client** (the first step of every job): the environment's variable `CLIENT_SLUG` must equal the choice
   (compared byte for byte). A mistyped environment name is created empty by GitHub and stops here.
3. **Render the Worker config** from the environment's variables. A missing, unknown or invalid variable stops the run,
   listed by name and never by value.
4. **Check the target**, before anything is read or written: the rendered account id and main database id equal the
   environment's `CF_ACCOUNT_ID` and `D1_MAIN_ID`, the `CLOUDFLARE_ACCOUNT_ID` secret is the rendered account, the
   rendered admin address equals `ADMIN_URL`, the plan asked for is the client's `PLAN_TIER`, and the token can act in
   that account.
5. Only then do the release steps run. They take the account, databases, Worker, bucket and site from the rendered config;
   there is no client name, id or address in the scripts.

Every `wrangler` command names the rendered config with `--config`. Without it wrangler takes a `wrangler.toml` it finds in
the folder, and that file's account wins over `CLOUDFLARE_ACCOUNT_ID`: one command for BM once reached Leang's account that
way. The npm scripts, `deploy.cjs`, the release kit and the ops jobs pass it; `scripts/with-wrangler-auth.cjs` refuses a
command without it and a config of another account than the token's.

Concurrency is per client (`deploy-<client>`): a release of one client never waits for, or cancels, another's.
The `r2-apac-copy` and `branch-cutover` tasks of Ops are one-off moves of Leang and refuse any other client; `r2-apac-copy`
alone also reads the environment variable `R2_SOURCE_BUCKET` (the old bucket it copies from).

## What the owner creates

Nobody else handles these:

- **A Cloudflare API token per account** (My Profile, API Tokens), with Workers Scripts edit, D1 edit, Workers KV edit,
  R2 edit, Queues edit, Workers Observability read, Account Analytics read, Account Settings read (the target check asks
  which accounts the token can act in) and, for a client with its own domain, Zone read and Workers Routes edit on that
  zone only. Set it as the environment secret `CLOUDFLARE_API_TOKEN` of the client's environment. Do not paste it into a
  chat, a file or an issue.
- **The account id**, as the environment secret `CLOUDFLARE_ACCOUNT_ID` (and again as the variable `CF_ACCOUNT_ID`: the run
  compares the two).
- **The reviewer and the branch rule** of each environment: Required reviewers = the owner; Deployment branches = Selected
  branches, `main` only.

## Adding a client

1. **Cloudflare**, in the client's account: create the two D1 databases (main and import), the KV namespace, the R2 bucket
   and the four queues (`business-os-import`, `business-os-import-dlq`, `business-os-media`,
   `business-os-backup-assets` -- the names every release expects; another prefix needs release 6.0.959 or later and is only
   needed when two clients share one account). Enable Analytics Engine if the account allows it (otherwise set
   `ANALYTICS_DATASET=none`). Note the ids.
2. **A values file**, outside the repository, from `clients/example.env`. Check it renders:
   `node ops/scripts/client/render-wrangler.mjs --env-file <file> --check --all`.
3. **GitHub**, Settings, Environments, New environment, named exactly like `CLIENT_SLUG`: required reviewer, deployment
   branches `main`, the two secrets above, and one **variable** per line of the values file. GitHub variables cannot be
   empty: write `none` for an optional integration the client does not have, and leave an optional identity variable out.
4. **The workflows' client list**: add the slug to the `client` choice of `deploy.yml`, `deploy-rollback.yml`, `ops.yml` and
   `metrics.yml` (one small change; `cloudflare/scripts/test-ops-workflow-pure.cjs` keeps the four lists equal).
5. **First run**: the **Metrics** workflow for the client (read-only). It renders, proves the target and the token, and reads;
   if it is green the wiring is right. Then **Deploy**.
6. **Database**: a new client's databases start from the baseline provisioning of the migration-safety lane (it creates the
   schema and the guard state); the release kit accepts such a database and refuses to run migrations on anything else.

A client served on workers.dev (Free plan) uses `WORKERS_DEV=true`, `ROUTES=none` and `PLAN_TIER=free`; Deploy is then run with
plan `free`, which deploys `wrangler.free.toml`. The owner's URL scheme for such clients is `<client>.<subdomain>.workers.dev`
for the shop and `<client>-admin.<subdomain>.workers.dev` for staff. The staff address needs a Worker of its own that hands
requests to the client's Worker: set `FORWARDER_NAME=<client>-admin`, render, and deploy it once by hand, always naming the
file and the account:

```
node ops/scripts/client/render-wrangler.mjs --env-file <file>
cd cloudflare
node scripts/with-wrangler-auth.cjs wrangler deploy --config admin-forwarder/wrangler.toml
```

## Variables

### The client

| Variable | Needed | Meaning |
|---|---|---|
| `CLIENT_SLUG` | required | Short lowercase name of the client. It must equal the GitHub environment name, and the workflows refuse to run when the environment variable CLIENT_SLUG differs from the client chosen. |
| `PLAN_TIER` | required | Workers plan of the Cloudflare account: paid or free. free also renders wrangler.free.toml (the file `npm run deploy:free` uses). |

### The Worker and its resources

| Variable | Needed | Meaning |
|---|---|---|
| `CF_ACCOUNT_ID` | required | Cloudflare account id (32 hex). Dashboard, right-hand side of the account home page. |
| `WORKER_NAME` | required | Name of this client's Worker. Unique within its Cloudflare account. |
| `WORKERS_DEV` | optional, default `false` | true serves the Worker on its workers.dev address as well, which is the way in when the custom domain is down. |
| `ROUTES` | optional, `none` = off | Custom domains of the Worker, comma separated (the public host and the admin host). Each must be on a zone of this account. none when the client is served from workers.dev only. |
| `PLACEMENT_REGION` | required | Where the Worker is pinned to run, next to the D1 primary (Smart Placement region), for example aws:ap-southeast-1 for Singapore. |
| `D1_MAIN_NAME` | required | Name of the main D1 database. Unique within the account. |
| `D1_MAIN_ID` | required | Id of the main D1 database. The workflows refuse to write unless it equals the GitHub variable D1_MAIN_ID. |
| `D1_IMPORT_NAME` | required | Name of the import-staging D1 database. Unique within the account. |
| `D1_IMPORT_ID` | required | Id of the import-staging D1 database. |
| `R2_BUCKET` | required | R2 bucket that holds uploaded files (the ASSETS binding). Unique within the account. |
| `KV_CACHE_ID` | required | Id of the KV namespace used as the edge cache (the CACHE binding). |
| `ANALYTICS_DATASET` | optional, `none` = off | Analytics Engine dataset the Worker writes request metrics to. Unique within the account. none leaves the binding out (an account without Analytics Engine, error 10089); the code then skips analytics, and the Metrics workflow has nothing to read. |
| `RATELIMIT_NAMESPACE_ID` | optional, `none` = off | Rate-limit namespace id, an integer unique among the rate limiters of the account, so pick one no other client of that account uses. none leaves the limiter out (the code then skips the check). |
| `IMAGES_BINDING` | optional, default `true` | true binds Cloudflare Images (server-side resizing). false leaves the binding out; the code then serves originals. |
| `VERSION_METADATA` | optional, default `true` | true binds the deployed version id, which keys the storefront edge cache. false leaves the binding out. |
| `QUEUE_PREFIX` | optional, default `business-os` | Prefix of the four queues <prefix>-import, <prefix>-import-dlq, <prefix>-media and <prefix>-backup-assets. The code tells the four apart by that ending, so another prefix works from release 6.0.959 on (needed only when two clients share one Cloudflare account); the default is the name every older release expects. Create the queues before the first deploy. |
| `PUBLIC_URL` | required | Public storefront address, no trailing slash. |
| `ADMIN_URL` | required | Admin and till address, no trailing slash. The release live checks and the ops jobs call this site; the workflows refuse to run unless it equals the GitHub variable ADMIN_URL. |
| `ORG_SLUG` | required | Slug of the one organization this deployment serves (BUSINESS_OS_ORGANIZATION_SLUG). |
| `ORG_NAME` | required | Display name of that organization (BUSINESS_OS_ORGANIZATION_NAME). |
| `SENTRY_DSN` | optional, `none` = off | Sentry ingest DSN (a public key). none turns error reporting off. |
| `RESEND_FROM_EMAIL` | optional, `none` = off | Sender of password-reset and verification e-mail, on a domain verified in Resend. none turns e-mail off. |
| `GOOGLE_LOGIN_CLIENT_ID` | optional, `none` = off | Google OAuth client id for "Sign in with Google". none turns it off. |
| `GOOGLE_LOGIN_REDIRECT_URI` | optional, `none` = off | Redirect URI registered for that client: <ADMIN_URL>/api/auth/oauth/callback. none when sign-in is off. |
| `GOOGLE_DRIVE_CLIENT_ID` | optional, `none` = off | Google OAuth client id for the Drive backup mirror (a separate client from the login one). none turns it off. |
| `GOOGLE_DRIVE_REDIRECT_URI` | optional, `none` = off | Redirect URI registered for the Drive client: <ADMIN_URL>/api/system/drive-sync/oauth/callback. none when the mirror is off. |

### Shop identity, manifests and the admin forwarder (all optional)

| Variable | Needed | Meaning |
|---|---|---|
| `SHOP_NAME` | optional, `none` = off | Shop name: page title, install name, two-factor issuer and storefront copy. Optional. |
| `SHOP_NAME_KM` | optional, `none` = off | Shop name in Khmer. Optional. |
| `SHOP_ALIAS` | optional, `none` = off | Another name customers know the shop by. Optional. |
| `SHOP_CATEGORY` | optional, `none` = off | Kind of shop, for storefront wording (for example beauty). Left out: general-shop wording. Optional. |
| `SHOP_ICON_PREFIX` | optional, `none` = off | Path prefix of the shop's own icon files under frontend/public (for example /my-shop-). Left out: the neutral Business OS icons. Optional. |
| `ADMIN_SHORT_NAME` | optional, `none` = off | Name of the staff app on a phone home screen. Optional. |
| `MEMBERSHIP_PREFIX` | optional, `none` = off | Prefix of membership numbers, for example LC- gives LC-00001. Optional. |
| `FORWARDER_NAME` | optional, `none` = off | Name of a second, tiny Worker that hands every request to this client's Worker over a service binding, so the staff app has an address of its own on workers.dev (<client>-admin.<subdomain>.workers.dev). Rendered to cloudflare/admin-forwarder/wrangler.toml and deployed by hand (docs/setup/multi-client.md). Optional; none or empty: no forwarder. |

The Worker serves `/manifest.json` and `/portal-manifest.json` itself, built from this identity (release 6.0.956 and later), so the template always lists both routes in `run_worker_first`: no variable switches them, and a client that sets no identity variable gets the neutral Business OS manifests. `MANIFEST_ROUTES`, the switch release 6.0.959 had, was retired in 6.0.962; a client file that still sets it is refused with that message, so delete the line.

### Comment blocks (comments only, never configuration)

| Variable | Needed | Meaning |
|---|---|---|
| `NOTE_WORKERS_DEV` | optional, `none` = off | Comment block above workers_dev. Optional. Every line must start with #; write a line break as \n inside double quotes. |
| `NOTE_ROUTES` | optional, `none` = off | Comment block above routes. Optional. Every line must start with #; write a line break as \n inside double quotes. |
| `NOTE_PLACEMENT` | optional, `none` = off | Comment lines above [placement] in the paid file. Optional. Every line must start with #; write a line break as \n inside double quotes. |
| `NOTE_PLACEMENT_FREE` | optional, `none` = off | Comment lines above [placement] in the free file. Optional. Every line must start with #; write a line break as \n inside double quotes. |
| `NOTE_ORG` | optional, `none` = off | Comment lines above the organization slug. Optional. Every line must start with #; write a line break as \n inside double quotes. |
| `NOTE_RESEND` | optional, `none` = off | Comment lines below the e-mail sender. Optional. Every line must start with #; write a line break as \n inside double quotes. |

The values file is read with a strict reader: an unknown name, a duplicate and a value with a quote outside quotes are errors.
`none` means off for the optional integrations; an optional resource (`ANALYTICS_DATASET`, `RATELIMIT_NAMESPACE_ID`) set to `none`
leaves its binding out, and the code skips the feature (the Metrics workflow then reports there is no dataset to read).

## Public logs

The repository is public, so its Actions logs are. The target check and every ops job print PASS or FAIL and fixed codes, never
an id or a name. GitHub shows the environment a step runs with in the log, **variables** included (they are not masked, unlike
secrets; check the first run's log): they are identifiers (account id, database ids, addresses), not credentials. If a client wants them out of the public log, keep the
values file as one environment **secret** instead; the renderer would need a one-line change to read it.

## Local use

```
node ops/scripts/client/render-wrangler.mjs --env-file <the client's file>     # writes cloudflare/wrangler.toml (+ free file, + forwarder)
cd cloudflare && npm run deploy:full                                            # every wrangler command names --config
```

Keep each client's token in its own `.wrangler-auth.local` (never two clients' in one folder at once); the wrapper refuses a
token whose account is not the rendered config's. `cloudflare/scripts/test-client-wrangler-parity-pure.cjs` and
`test-client-bm-parity-pure.cjs` prove, where the private files exist, that the template renders Leang's and BM's configs as
they were deployed.
