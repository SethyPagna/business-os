'use strict'
// Pure core of the per-client Worker config renderer. No network, no child
// process and nothing read from the disk except what readEnvFile() is told to.
//
// cloudflare/wrangler.template.toml is the only committed Worker config. It
// holds placeholders and never a client's value. A client's values live in a
// dotenv file outside this repository (clients/example.env documents the
// shape; real files are gitignored) or in a GitHub environment's variables.
// This module turns template + values into cloudflare/wrangler.toml and, for a
// Workers Free client, cloudflare/wrangler.free.toml.
//
// Template syntax (every directive sits alone on its line):
//   {{NAME}}              a variable or a computed value. Alone on its line, an
//                         empty value drops the line and a multi-line value
//                         becomes several lines. Inline, the value is spliced
//                         in and is always a single validated line.
//   {{#paid}} ... {{/paid}}   lines kept only in the paid file
//   {{#free}} ... {{/free}}   lines kept only in the free file
//   {{#if NAME}} ... {{/if}}  lines kept only when NAME (a variable or a
//                         computed value) is not empty, so a client that has no
//                         Sentry, no custom domain or no shop identity gets no
//                         empty entry for it. May sit inside paid / free.
//   {{! text }}           a template comment, never rendered
//
// Every problem is collected and reported together, and no message ever
// carries a value: this runs in public CI logs.

const fs = require('node:fs')

// A GitHub variable cannot be empty, so a client with no value for an optional
// integration writes this word instead of leaving the variable out. Absence
// stays an error, which keeps a forgotten variable from silently switching
// Sentry, e-mail or Google sign-in off.
const NONE = 'none'

const HOST = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}`
const NOT_TOML_UNSAFE = String.raw`[^"\\\u0000-\u001f\u007f]`
const NOT_TOML_UNSAFE_NAME = new RegExp(`^${NOT_TOML_UNSAFE}{1,100}$`)

// kind 'meta': read by the tooling, never spliced into the template.
// allowEmpty: the client may have none (NONE or an empty string render empty).
// default: used when the variable is not provided at all.
const VARIABLES = [
  { name: 'CLIENT_SLUG', kind: 'meta', pattern: /^[a-z0-9][a-z0-9-]{0,30}$/, example: 'example',
    doc: 'Short lowercase name of the client. It must equal the GitHub environment name, and the workflows refuse to run when the environment variable CLIENT_SLUG differs from the client chosen.' },
  { name: 'PLAN_TIER', kind: 'meta', pattern: /^(?:paid|free)$/, example: 'paid',
    doc: 'Workers plan of the Cloudflare account: paid or free. free also renders wrangler.free.toml (the file `npm run deploy:free` uses).' },
  { name: 'CF_ACCOUNT_ID', pattern: /^[0-9a-f]{32}$/, example: '00000000000000000000000000000000',
    doc: 'Cloudflare account id (32 hex). Dashboard, right-hand side of the account home page.' },
  { name: 'WORKER_NAME', pattern: /^[a-z0-9][a-z0-9-]{0,62}$/, example: 'example-shop',
    doc: 'Name of this client\'s Worker. Unique within its Cloudflare account.' },
  { name: 'WORKERS_DEV', pattern: /^(?:true|false)$/, default: 'false', example: 'false',
    doc: 'true serves the Worker on its workers.dev address as well, which is the way in when the custom domain is down.' },
  { name: 'ROUTES', list: true, allowEmpty: true, pattern: new RegExp(`^${HOST}$`), example: 'example.com,admin.example.com',
    doc: 'Custom domains of the Worker, comma separated (the public host and the admin host). Each must be on a zone of this account. none when the client is served from workers.dev only.' },
  { name: 'PLACEMENT_REGION', pattern: /^(?:aws|gcp|azure):[a-z0-9-]+$/, example: 'aws:ap-southeast-1',
    doc: 'Where the Worker is pinned to run, next to the D1 primary (Smart Placement region), for example aws:ap-southeast-1 for Singapore.' },
  { name: 'D1_MAIN_NAME', pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/, example: 'example-shop-db',
    doc: 'Name of the main D1 database. Unique within the account.' },
  { name: 'D1_MAIN_ID', pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, example: '00000000-0000-4000-8000-000000000001',
    doc: 'Id of the main D1 database. The workflows refuse to write unless it equals the GitHub variable D1_MAIN_ID.' },
  { name: 'D1_IMPORT_NAME', pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/, example: 'example-shop-import-db',
    doc: 'Name of the import-staging D1 database. Unique within the account.' },
  { name: 'D1_IMPORT_ID', pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, example: '00000000-0000-4000-8000-000000000002',
    doc: 'Id of the import-staging D1 database.' },
  { name: 'R2_BUCKET', pattern: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, example: 'example-shop-assets',
    doc: 'R2 bucket that holds uploaded files (the ASSETS binding). Unique within the account.' },
  { name: 'KV_CACHE_ID', pattern: /^[0-9a-f]{32}$/, example: '00000000000000000000000000000003',
    doc: 'Id of the KV namespace used as the edge cache (the CACHE binding).' },
  { name: 'ANALYTICS_DATASET', allowEmpty: true, pattern: /^[A-Za-z][A-Za-z0-9_]{0,62}$/, example: 'Example_Shop_Analytics',
    doc: 'Analytics Engine dataset the Worker writes request metrics to. Unique within the account. none leaves the binding out (an account without Analytics Engine, error 10089); the code then skips analytics, and the Metrics workflow has nothing to read.' },
  { name: 'RATELIMIT_NAMESPACE_ID', allowEmpty: true, pattern: /^[1-9][0-9]{0,8}$/, example: '2001',
    doc: 'Rate-limit namespace id, an integer unique among the rate limiters of the account, so pick one no other client of that account uses. none leaves the limiter out (the code then skips the check).' },
  { name: 'IMAGES_BINDING', pattern: /^(?:true|false)$/, default: 'true', example: 'true',
    doc: 'true binds Cloudflare Images (server-side resizing). false leaves the binding out; the code then serves originals.' },
  { name: 'VERSION_METADATA', pattern: /^(?:true|false)$/, default: 'true', example: 'true',
    doc: 'true binds the deployed version id, which keys the storefront edge cache. false leaves the binding out.' },
  { name: 'QUEUE_PREFIX', default: 'business-os', pattern: /^[a-z0-9][a-z0-9-]{0,40}$/, example: 'example-shop',
    doc: 'Prefix of the four queues <prefix>-import, <prefix>-import-dlq, <prefix>-media and <prefix>-backup-assets. The code tells the four apart by that ending, so another prefix works from release 6.0.959 on (needed only when two clients share one Cloudflare account); the default is the name every older release expects. Create the queues before the first deploy.' },
  { name: 'PUBLIC_URL', pattern: /^https:\/\/[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/, example: 'https://example.com',
    doc: 'Public storefront address, no trailing slash.' },
  { name: 'ADMIN_URL', pattern: /^https:\/\/[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/, example: 'https://admin.example.com',
    doc: 'Admin and till address, no trailing slash. The release live checks and the ops jobs call this site; the workflows refuse to run unless it equals the GitHub variable ADMIN_URL.' },
  { name: 'ORG_SLUG', pattern: /^[a-z0-9][a-z0-9-]{0,62}$/, example: 'example-shop',
    doc: 'Slug of the one organization this deployment serves (BUSINESS_OS_ORGANIZATION_SLUG).' },
  { name: 'ORG_NAME', pattern: new RegExp(`^${NOT_TOML_UNSAFE}{1,100}$`), example: 'Example Shop',
    doc: 'Display name of that organization (BUSINESS_OS_ORGANIZATION_NAME).' },
  { name: 'SENTRY_DSN', allowEmpty: true, pattern: /^https:\/\/[A-Za-z0-9]+@[A-Za-z0-9.-]+\/[0-9]+$/, example: 'https://0000000000000000@o0.ingest.example.invalid/0',
    doc: 'Sentry ingest DSN (a public key). none turns error reporting off.' },
  { name: 'RESEND_FROM_EMAIL', allowEmpty: true,
    pattern: /^(?:[^"\\<>\u0000-\u001f]+<[^\s"\\<>@]+@[^\s"\\<>@]+>|[^\s"\\<>@]+@[^\s"\\<>@]+)$/, example: 'Example Shop <no-reply@example.com>',
    doc: 'Sender of password-reset and verification e-mail, on a domain verified in Resend. none turns e-mail off.' },
  { name: 'GOOGLE_LOGIN_CLIENT_ID', allowEmpty: true, pattern: /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, example: '000000000000-example.apps.googleusercontent.com',
    doc: 'Google OAuth client id for "Sign in with Google". none turns it off.' },
  { name: 'GOOGLE_LOGIN_REDIRECT_URI', allowEmpty: true, pattern: /^https:\/\/[^\s"\\]+$/, example: 'https://admin.example.com/api/auth/oauth/callback',
    doc: 'Redirect URI registered for that client: <ADMIN_URL>/api/auth/oauth/callback. none when sign-in is off.' },
  { name: 'GOOGLE_DRIVE_CLIENT_ID', allowEmpty: true, pattern: /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, example: '000000000000-exampledrive.apps.googleusercontent.com',
    doc: 'Google OAuth client id for the Drive backup mirror (a separate client from the login one). none turns it off.' },
  { name: 'GOOGLE_DRIVE_REDIRECT_URI', allowEmpty: true, pattern: /^https:\/\/[^\s"\\]+$/, example: 'https://admin.example.com/api/system/drive-sync/oauth/callback',
    doc: 'Redirect URI registered for the Drive client: <ADMIN_URL>/api/system/drive-sync/oauth/callback. none when the mirror is off.' },
  // The shop's identity, shown to staff and customers (cloudflare/src/lib/clientIdentity.ts reads them). All
  // optional: one left out (or none) is left out of [vars] and the code keeps its neutral default. They are
  // the Worker variables BUSINESS_OS_<NAME>.
  ...[
    ['SHOP_NAME', 'Shop name: page title, install name, two-factor issuer and storefront copy. Also makes the Worker build /manifest.json and /portal-manifest.json from the identity.', NOT_TOML_UNSAFE_NAME, 'Example Shop'],
    ['SHOP_NAME_KM', 'Shop name in Khmer.', NOT_TOML_UNSAFE_NAME, '(the name in Khmer script)'],
    ['SHOP_ALIAS', 'Another name customers know the shop by.', NOT_TOML_UNSAFE_NAME, 'Example'],
    ['SHOP_CATEGORY', 'Kind of shop, for storefront wording (for example beauty). Left out: general-shop wording.', /^[a-z][a-z0-9_-]{0,31}$/, 'general'],
    ['SHOP_ICON_PREFIX', 'Path prefix of the shop\'s own icon files under frontend/public (for example /my-shop-). Left out: the neutral Business OS icons.', /^\/[a-z0-9][a-z0-9_/-]{0,60}$/, '/example-shop-'],
    ['ADMIN_SHORT_NAME', 'Name of the staff app on a phone home screen.', NOT_TOML_UNSAFE_NAME, 'Example Admin'],
    ['MEMBERSHIP_PREFIX', 'Prefix of membership numbers, for example LC- gives LC-00001.', /^[A-Za-z0-9]{1,8}-?$/, 'EX-'],
  ].map(([name, doc, pattern, shown]) => ({
    name, kind: 'identity', workerVar: `BUSINESS_OS_${name}`, default: '', allowEmpty: true, pattern, example: '', shown,
    doc: `${doc} Optional.`,
  })),
  {
    name: 'MANIFEST_ROUTES', kind: 'identity', default: 'false', pattern: /^(?:true|false)$/, example: 'false', shown: 'true',
    doc: 'true hands /manifest.json and /portal-manifest.json to the Worker (run_worker_first), which builds both from the shop identity. Set it only once the deployed code does (release 6.0.956 or later); before that those two paths are static files and a Worker route would 404 them. Optional.',
  },
  { name: 'FORWARDER_NAME', kind: 'forwarder', allowEmpty: true, default: '', pattern: /^[a-z0-9][a-z0-9-]{0,62}$/, example: '', shown: 'bm-admin',
    doc: 'Name of a second, tiny Worker that hands every request to this client\'s Worker over a service binding, so the staff app has an address of its own on workers.dev (<client>-admin.<subdomain>.workers.dev). Rendered to cloudflare/admin-forwarder/wrangler.toml and deployed by hand (docs/setup/multi-client.md). Optional; none or empty: no forwarder.' },
  // Free text that explains a client's history inside the rendered file. They
  // only change comments, never configuration, and exist so that a client's
  // story lives with the client and not in the shared template.
  ...[
    ['NOTE_WORKERS_DEV', 'Comment block above workers_dev.'],
    ['NOTE_ROUTES', 'Comment block above routes.'],
    ['NOTE_PLACEMENT', 'Comment lines above [placement] in the paid file.'],
    ['NOTE_PLACEMENT_FREE', 'Comment lines above [placement] in the free file.'],
    ['NOTE_ORG', 'Comment lines above the organization slug.'],
    ['NOTE_RESEND', 'Comment lines below the e-mail sender.'],
  ].map(([name, where]) => ({
    name, kind: 'note', default: '', allowEmpty: true, example: '',
    doc: `${where} Optional. Every line must start with #; write a line break as \\n inside double quotes.`,
  })),
]

// Placeholders the renderer computes from the variables above, and the
// variables each is computed from.
const IDENTITY_NAMES = ['SHOP_NAME', 'SHOP_NAME_KM', 'SHOP_ALIAS', 'SHOP_CATEGORY', 'SHOP_ICON_PREFIX', 'ADMIN_SHORT_NAME', 'MEMBERSHIP_PREFIX']
const COMPUTED_SOURCES = {
  ROUTE_LINES: ['ROUTES'],
  PREVIEW_URLS_LINE: ['WORKERS_DEV'],
  IDENTITY_VARS: IDENTITY_NAMES,
  MANIFEST_ROUTE_LINE: ['MANIFEST_ROUTES'],
  IMAGES_ON: ['IMAGES_BINDING'],
  VERSION_METADATA_ON: ['VERSION_METADATA'],
}
// Integrations whose two variables only make sense together.
const PAIRS = [['GOOGLE_LOGIN_CLIENT_ID', 'GOOGLE_LOGIN_REDIRECT_URI'], ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_REDIRECT_URI']]
const COMPUTED = Object.keys(COMPUTED_SOURCES)

const BY_NAME = new Map(VARIABLES.map((v) => [v.name, v]))
const PLANS = ['paid', 'free']

class RenderError extends Error {
  constructor(problems) {
    super(problems.join('\n'))
    this.name = 'RenderError'
    this.problems = problems
  }
}

// ----------------------------------------------------------------- dotenv

// Strict dotenv reader. KEY=value, one per line; "double quoted" values may
// span lines and understand \n \t \" \\ ; 'single quoted' values are literal;
// an unquoted value ends at an inline " #" comment. # lines and blank lines
// are skipped. Returns { values: Map, problems: [] }; values never appear in
// the problems.
function parseEnvText(text) {
  const values = new Map()
  const problems = []
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    if (/^\s*(?:#.*)?$/.test(raw)) continue
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw)
    if (!m) { problems.push(`env line ${i + 1}: expected NAME=value`); continue }
    const [, key, rest] = m
    let value
    if (rest.startsWith('"')) {
      let body = rest.slice(1)
      let closed = -1
      let at = i
      for (;;) {
        closed = closingQuote(body)
        if (closed >= 0 || at + 1 >= lines.length) break
        at += 1
        body += `\n${lines[at]}`
      }
      if (closed < 0) { problems.push(`env line ${i + 1}: ${key} has no closing double quote`); break }
      const after = body.slice(closed + 1)
      if (!/^\s*(?:#.*)?$/.test(after)) problems.push(`env line ${at + 1}: ${key} has text after the closing quote`)
      value = unescapeDouble(body.slice(0, closed))
      i = at
    } else if (rest.startsWith("'")) {
      let body = rest.slice(1)
      let closed = body.indexOf("'")
      let at = i
      while (closed < 0 && at + 1 < lines.length) {
        at += 1
        body += `\n${lines[at]}`
        closed = body.indexOf("'")
      }
      if (closed < 0) { problems.push(`env line ${i + 1}: ${key} has no closing single quote`); break }
      const after = body.slice(closed + 1)
      if (!/^\s*(?:#.*)?$/.test(after)) problems.push(`env line ${at + 1}: ${key} has text after the closing quote`)
      value = body.slice(0, closed)
      i = at
    } else {
      value = rest.replace(/\s+#.*$/, '').trim()
      if (/["']/.test(value)) problems.push(`env line ${i + 1}: ${key} holds a quote character outside quotes`)
    }
    if (values.has(key)) problems.push(`env line ${i + 1}: ${key} is set twice`)
    values.set(key, value)
  }
  return { values, problems }
}

function closingQuote(body) {
  for (let k = 0; k < body.length; k += 1) {
    if (body[k] === '\\') { k += 1; continue }
    if (body[k] === '"') return k
  }
  return -1
}

function unescapeDouble(s) {
  return s.replace(/\\(.)/gs, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === '"' ? '"' : c === '\\' ? '\\' : `\\${c}`))
}

function readEnvFile(file) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { throw new RenderError([`cannot read the env file ${file}`]) }
  const parsed = parseEnvText(text)
  if (parsed.problems.length) throw new RenderError(parsed.problems)
  return parsed.values
}

// ----------------------------------------------------------------- values

// Source maps -> checked values. `strict` also rejects names that are not
// declared (a typo in a client file); the process environment and GitHub's
// variable list carry unrelated names and are read leniently.
function resolveValues(source, { strict = false } = {}) {
  const get = source instanceof Map ? (k) => (source.has(k) ? source.get(k) : undefined) : (k) => (Object.prototype.hasOwnProperty.call(source, k) ? source[k] : undefined)
  const keys = source instanceof Map ? [...source.keys()] : Object.keys(source)
  const problems = []
  if (strict) {
    for (const k of keys) if (!BY_NAME.has(k)) problems.push(`${k} is not a variable this template knows`)
  }
  const out = {}
  for (const v of VARIABLES) {
    let raw = get(v.name)
    if (raw === undefined || raw === null) {
      if (v.default !== undefined) raw = v.default
      else { problems.push(`${v.name} is not set${v.allowEmpty ? ` (set it to ${NONE} if the client has none)` : ''}`); continue }
    }
    raw = String(raw).replace(/\r\n?/g, '\n')
    if (v.kind !== 'note') raw = raw.trim()
    if (raw === NONE && v.allowEmpty) raw = ''
    if (raw === '') {
      if (!v.allowEmpty) { problems.push(`${v.name} is empty`); continue }
      out[v.name] = ''
      continue
    }
    if (/\{\{|\}\}/.test(raw)) { problems.push(`${v.name} contains a template brace`); continue }
    if (v.kind === 'note') {
      if (raw.split('\n').some((l) => !l.startsWith('#'))) problems.push(`${v.name}: every line must start with #`)
      else out[v.name] = raw
      continue
    }
    const items = v.list ? raw.split(',').map((s) => s.trim()) : [raw]
    if (!items.every((s) => v.pattern.test(s))) { problems.push(`${v.name} has an invalid value (expected: ${describe(v)})`); continue }
    if (v.list && new Set(items).size !== items.length) { problems.push(`${v.name} lists a host twice`); continue }
    out[v.name] = v.list ? items.join(',') : raw
  }
  for (const [a, b] of PAIRS) {
    if (out[a] !== undefined && out[b] !== undefined && Boolean(out[a]) !== Boolean(out[b])) problems.push(`${a} and ${b} must both be set or both be ${NONE}`)
  }
  if (problems.length) throw new RenderError(problems)
  return out
}

function describe(v) {
  return `${v.list ? 'comma separated list of ' : ''}${v.pattern.source.length > 80 ? 'see clients/example.env' : v.pattern.source}`
}

function computed(values) {
  const hosts = values.ROUTES ? values.ROUTES.split(',') : []
  return {
    ROUTE_LINES: hosts.map((h) => `  { pattern = "${h}", custom_domain = true },`).join('\n'),
    // A Worker that is also served on workers.dev has no preview URLs: every version would otherwise be
    // reachable on an address of its own.
    PREVIEW_URLS_LINE: values.WORKERS_DEV === 'true' ? 'preview_urls = false' : '',
    // The identity variables that are set, as Worker [vars], in a fixed order.
    IDENTITY_VARS: IDENTITY_NAMES.filter((n) => values[n]).map((n) => `BUSINESS_OS_${n} = "${values[n]}"`).join('\n'),
    // Once the deployed code builds both manifests from the identity, the asset layer must hand those two
    // paths to the Worker instead of answering with the static files.
    MANIFEST_ROUTE_LINE: values.MANIFEST_ROUTES === 'true' ? '  "/manifest.json", "/portal-manifest.json",' : '',
    IMAGES_ON: values.IMAGES_BINDING === 'true' ? 'true' : '',
    VERSION_METADATA_ON: values.VERSION_METADATA === 'true' ? 'true' : '',
  }
}

// --------------------------------------------------------------- template

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const DIRECTIVE = /^\{\{(#|\/)(paid|free|if)(?:\s+([A-Z][A-Z0-9_]*))?\}\}$/
const COMMENT = /^\{\{!.*\}\}$/

function normaliseTemplate(text) {
  return String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

// Names used by the template (placeholders only), for the drift tests.
function templatePlaceholders(text) {
  const names = new Set()
  for (const line of normaliseTemplate(text).split('\n')) {
    const t = line.trim()
    const d = DIRECTIVE.exec(t)
    if (d) { if (d[3]) names.add(d[3]); continue }
    if (COMMENT.test(t)) continue
    for (const m of line.matchAll(PLACEHOLDER)) names.add(m[1])
  }
  return names
}

// Checks the template against the registry without any values.
function lintTemplate(text) {
  const problems = []
  const known = new Set([...VARIABLES.filter((v) => v.kind !== 'meta').map((v) => v.name), ...COMPUTED])
  const lines = normaliseTemplate(text).split('\n')
  const open = []
  lines.forEach((line, i) => {
    const t = line.trim()
    const n = i + 1
    if (COMMENT.test(t)) return
    const d = DIRECTIVE.exec(t)
    if (d) {
      const [, hash, kind, name] = d
      if (hash === '#') {
        if (kind === 'if' && !name) problems.push(`template line ${n}: {{#if}} needs a name`)
        else if (kind !== 'if' && name) problems.push(`template line ${n}: {{#${kind}}} takes no name`)
        else if (kind === 'if' && !known.has(name)) problems.push(`template line ${n}: {{#if ${name}}} names an unknown placeholder`)
        if (kind !== 'if' && open.some((o) => o.kind !== 'if')) problems.push(`template line ${n}: {{#${kind}}} opens inside {{#${open.find((o) => o.kind !== 'if').kind}}}`)
        open.push({ kind, name, line: n })
      } else {
        if (name) problems.push(`template line ${n}: {{/${kind}}} takes no name`)
        if (!open.length || open[open.length - 1].kind !== kind) problems.push(`template line ${n}: {{/${kind}}} closes nothing`)
        else open.pop()
      }
      return
    }
    for (const m of line.matchAll(PLACEHOLDER)) {
      if (!known.has(m[1])) problems.push(`template line ${n}: unknown placeholder {{${m[1]}}}`)
    }
    const stripped = line.replace(PLACEHOLDER, '')
    if (/\{\{|\}\}/.test(stripped)) problems.push(`template line ${n}: a malformed {{ }} directive`)
  })
  for (const o of open) problems.push(`template line ${o.line}: {{#${o.kind}}} is never closed`)
  return problems
}

// One variant of the template. values: the object resolveValues() returned.
function renderVariant(templateText, values, plan) {
  if (!PLANS.includes(plan)) throw new RenderError([`plan must be paid or free, not ${plan}`])
  const problems = lintTemplate(templateText)
  if (problems.length) throw new RenderError(problems)
  const all = { ...values, ...computed(values) }
  const lines = normaliseTemplate(templateText).split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const out = []
  const open = []
  const keeping = () => open.every((o) => (o.kind === 'if' ? Boolean(all[o.name]) : o.kind === plan))
  for (const line of lines) {
    const t = line.trim()
    if (COMMENT.test(t)) continue
    const d = DIRECTIVE.exec(t)
    if (d) {
      if (d[1] === '#') open.push({ kind: d[2], name: d[3] })
      else open.pop()
      continue
    }
    if (!keeping()) continue
    const own = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(t)
    if (own && line === t) {
      const value = all[own[1]]
      if (value === undefined) throw new RenderError([`no value for ${own[1]}`])
      if (value === '') continue
      out.push(...value.split('\n'))
      continue
    }
    out.push(line.replace(PLACEHOLDER, (_, name) => {
      const value = all[name]
      if (value === undefined) throw new RenderError([`no value for ${name}`])
      if (value.includes('\n')) throw new RenderError([`${name} spans several lines but sits inside a line of the template`])
      return value
    }))
  }
  const text = `${out.join('\n')}\n`
  if (/\{\{|\}\}/.test(text)) throw new RenderError(['a placeholder is still unresolved after rendering'])
  return text
}

// Which files a client needs: wrangler.toml always, wrangler.free.toml when
// the plan is free (or when `all` asks for both, for tests and parity), and
// admin-forwarder/wrangler.toml when the client names a forwarder and the
// forwarder's template is given.
const FORWARDER_FILE = 'admin-forwarder/wrangler.toml'
function renderFiles(templateText, values, { all = false, forwarderTemplate = null } = {}) {
  const files = { 'wrangler.toml': renderVariant(templateText, values, 'paid') }
  if (all || values.PLAN_TIER === 'free') files['wrangler.free.toml'] = renderVariant(templateText, values, 'free')
  if (forwarderTemplate && values.FORWARDER_NAME) files[FORWARDER_FILE] = renderVariant(forwarderTemplate, values, 'paid')
  return files
}

module.exports = {
  FORWARDER_FILE, NONE, VARIABLES, COMPUTED, COMPUTED_SOURCES, PLANS, RenderError,
  parseEnvText, readEnvFile, resolveValues, computed,
  normaliseTemplate, templatePlaceholders, lintTemplate, renderVariant, renderFiles,
}
