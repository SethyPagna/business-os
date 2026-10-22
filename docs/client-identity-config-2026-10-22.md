# Client identity from configuration (6.0.956, 22 Oct 2026)

One build of Business OS now serves more than one client. Everything that named Leang Cosmetics in
shared code comes from the deployment's wrangler `[vars]`; Leang's values live in
`cloudflare/wrangler.toml` and `wrangler.free.toml`, BM Shop's in `clients/bmshop/wrangler.toml`.
With Leang's config, the Leang hosts serve the identity they served before, byte for byte where it is
pinned (see Verification).

## The variables

| Var | Leang Cosmetics | BM Shop | Unset |
|---|---|---|---|
| `BUSINESS_OS_SHOP_NAME` | Leang Cosmetics | BM Shop | Business OS |
| `BUSINESS_OS_SHOP_NAME_KM` | លាង កូស្មេធីក | – | the name |
| `BUSINESS_OS_SHOP_ALIAS` | Leang Beauty | – | none ("Name/Alias" copy shows the name alone; `{shopAlias}` reads as the name) |
| `BUSINESS_OS_SHOP_CATEGORY` | beauty | – | general shop wording |
| `BUSINESS_OS_SHOP_ICON_PREFIX` | /leang-cosmetics- | – | the staff app's Business OS icons |
| `BUSINESS_OS_ADMIN_SHORT_NAME` | Leang Admin | – | "<name> Admin" |
| `BUSINESS_OS_MEMBERSHIP_PREFIX` | LC- | BM- | M- |
| `BUSINESS_OS_ORGANIZATION_NAME` (existing) | LeangBeauty | BM Shop | Business OS |
| `BUSINESS_OS_PUBLIC_URL` (existing) | https://leangbeauty.com | https://bm.khshop.workers.dev | request origin |
| `BUSINESS_OS_ADMIN_URL` (existing) | https://admin.leangbeauty.com | https://bm-admin.khshop.workers.dev | no configured staff host (admin.* and loopback only) |

Derived, never configured separately: the staff app is "<name> Admin"; the descriptions are
"Browse <name> products and contact the store." and "Till, stock and sales for <name> staff".
Staff can still override the visible business name in Settings (`business_name`); the vars are the
fallback and the install identity.

Never change `BUSINESS_OS_MEMBERSHIP_PREFIX` on a live deployment: existing numbers stop counting as
house numbers and the sequence starts again.

## Staff host

The staff app's hosts are `admin.*`, loopback and the host of `BUSINESS_OS_ADMIN_URL`. The last one
lets a `*.workers.dev` deployment have a staff host, because a workers.dev name cannot start with
`admin.`. The owner's scheme (22 Oct 2026) is shop `<client>.khshop.workers.dev` and staff
`<client>-admin.khshop.workers.dev`, served by a forwarder Worker that keeps the URL host. The
configured host matches by exact hostname, never by prefix or suffix. A staff URL whose host is the
public host, or its `www.` alias, counts as none (`staffHostFrom`). Leang's staff host is
`admin.leangbeauty.com`, which `admin.*` already covered, so Leang behaves as before.

One rule, every place it lives:
- Worker: `lib/publicHostGate.ts` `isStaffHostname(hostname, staffHost)` for the storefront API gate
  (src/index.ts), the document identity (`lib/documentIdentity.ts`) and robots.txt/sitemap
  (`lib/publicSeo.ts`).
- Page: `frontend/src/app/clientIdentity.ts` `isStaffHostname` / `isServedStaffHostname`, used by
  `app/pathRouting.ts` `isAdminHostname`, `api/http.ts`, `api/websocket.ts`,
  `components/catalog/catalogAssetUrls.ts` and `utils/publicAssetUrls.ts`. `index.html`'s bootstrap uses
  the same rule.
- Service worker: `isAdminHost(hostname, staffHost)`. It reads `staffHost` from the identity block in
  the shell it caches (install, the per-host precache plan, remembering the language pack).

The browser cannot read the Worker's configuration. The configured host reaches the page and the
service worker as `staffHost` in the identity block the Worker streams into every document. No
`run_worker_first` entry was added for it.

## How it flows

- `cloudflare/src/lib/clientIdentity.ts` resolves the identity from env (pure, no I/O) and builds both
  install manifests.
- `src/index.ts` rewrites every app document it serves with `lib/documentIdentity.ts` (streaming
  HTMLRewriter, no D1/KV): staff identity on a staff host (see Staff host), the shop's elsewhere, plus a
  `<script id="business-os-identity" type="application/json">` block and the loading-shell names.
  `/manifest.json` and `/portal-manifest.json` are now Worker routes (added to `run_worker_first`).
- `lib/documentRoutes.ts` (leaf module): the app document routes. The document identity used an exact
  host list naming admin.leangbeauty.com; it now uses the gate's staff-host rule.
- `frontend/index.html` names no client: its static head and identity block are the neutral
  Business OS identity. Its bootstrap reads the identity block. `frontend/src/app/clientIdentity.ts`
  reads the same block for the app (storefront branding, login, loading screens, copy with `{shop}`,
  `{shopNames}`, `{shopAlias}`, `{prefix}` tokens in both language packs; the shop name and alias are
  also the terms machine translation leaves in English).
- The service worker precaches the shop's icons named in the cached shell's identity block, and the
  staff identity on a configured staff host.
- Server copy: TOTP issuer and Google return pages (`routes/auth.ts`), portal config fallbacks, the AI
  persona (category-dependent), the sign-up reminder, the membership prefix in every minting path.
- Queue batches dispatch on the queue name's role suffix (`lib/queueRole.ts`), so a deployment may name
  its own queues.

## Known limits

- An unknown path that Cloudflare's asset layer answers on its own (not in `run_worker_first`, e.g. a
  typo URL on the shop host) gets the neutral static document until the service worker is installed; the
  app then shows the business name from Settings. Routing every navigation through the Worker would
  close this but costs a Worker invocation per bot probe on Free. On a configured staff host (not
  `admin.*`), such a typo URL renders the storefront until the service worker answers it from the
  cached shell. The staff API stays reachable there, because the gate reads the Worker's
  configuration.
- `run_worker_first` ships with the config, not the code. A deployment that adds the two manifest
  routes before it runs this code answers them 404 (BM Shop met this on 22 Oct 2026).
- Leang's icon files still ship in the shared build (unreferenced on other deployments).
- Data and history keep Leang-specific guards on purpose: migrations (`LC-` backfills), the retired
  leangcosmetics hosts list in `routes/portal.ts`, the legacy org slugs in `coreDataInvariants.ts`, the
  one-off General-customer repair (`LC-04971`: a manual, confirmed system step that only clears that
  exact value on that one customer, so on another deployment it finds nothing to do), ops tooling and
  deploy kit defaults (the multi-client deploy lane owns those).
- Beauty wording that `BUSINESS_OS_SHOP_CATEGORY` does not switch yet: the default AI page title
  "Beauty Assistant" (`routes/portal.ts`) and its Khmer pack title, and the beauty starter FAQ. A
  non-beauty shop sees them until staff edit them, or until the owner supplies general wording in both
  languages.

## Verification

- **Leang parity, real Worker.** `cloudflare/scripts/test-client-identity-document-native.cjs` runs the
  built Worker in Miniflare with Leang's `wrangler.toml` vars and the real `frontend/index.html` as the
  asset. It freezes what the Leang shop and staff hosts served before this change: title, apple title,
  description, theme colour, icons, manifest link, og tags, canonical. It also checks that both manifests
  deep-equal the old static `manifest.json` / `portal-manifest.json`. With BM Shop's vars, neither host
  nor any manifest contains `/leang|LC-0/i`.
- **Configuration is the only source.** Frontend tests that pin Leang's wording read it through
  `frontend/tests/leangClientIdentity.ts` (Leang's `[vars]` → the Worker's resolver → the identity block
  the page reads). Worker tests read it through `cloudflare/scripts/harness/wrangler_vars.cjs`. A
  mutation of `BUSINESS_OS_SHOP_NAME` in `wrangler.toml` turns them red.
- **Frontend and Worker share one identity.** `frontend/tests/clientIdentity.test.ts`: the same neutral
  default, field by field. Whatever the Worker writes, the app reads back unchanged. `index.html`'s static
  block is the neutral identity, and the document names no client.
- **Staff host, every layer.** Worker: `test-public-host-api-gate-pure.cjs` covers the configured host
  as staff by exact hostname, in any letter case. Look-alikes (`…workers.dev.evil.com`, `xbm-admin…`, a
  trailing dot), the public host, a `www.` alias, an unusable URL and an unset var are not staff.
  Controls: a gate blind to the configured host fails, and so does one matching it with includes,
  startsWith or endsWith. The document identity and robots/sitemap use the same rule
  (`test-admin-host-document-rewrite-pure.cjs`, `test-public-seo-pure.cjs`). The native Miniflare test
  runs BM Shop's config: `bm-admin` reaches the staff API, while `bm` and the look-alikes get the
  gate's 404. Page: `pwaIdentity` and `publicHostNeverAdmin` require the Worker gate, the bootstrap
  and the router to agree on every host. Service worker: `swPrecachePerHost` runs the real install
  (source and shipped `sw.js`), and `brandIcons` checks it against the bootstrap. Four mutations
  (bootstrap, router rule ignoring or loosely matching the host, service worker) are each caught.
- **Build.** `dist/` contains no `leang` string in HTML, JS or JSON (only the Leang icon file names). The
  storefront's catalog-products chunk closure equals the base build (31 chunks), because
  `src/app/clientIdentity.ts` is pinned to `app-constants`. The preloaded chunk list is identical to base.
- **Gates.** Frontend `typecheck`, `verify:i18n`, `build` and `verify:public-runtime` pass, and so do
  the Worker's `tsc --noEmit`, the frontend test chain and the Worker `scripts/test-*.cjs` sweep (results in
  the commit message).
- **Not verified here.** Live hosts: nothing was deployed. Leang's release goes through gate.yml,
  the Opus review and the deploy window.
