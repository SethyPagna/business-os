#!/usr/bin/env node
// Renders one client's Worker config from cloudflare/wrangler.template.toml.
//
//   node ops/scripts/client/render-wrangler.mjs --env-file clients/leang.env
//   node ops/scripts/client/render-wrangler.mjs --vars-json-env CLIENT_VARS     (GitHub: env CLIENT_VARS = toJSON(vars))
//   node ops/scripts/client/render-wrangler.mjs                                  (variables from the process environment)
//
// Writes <out-dir>/wrangler.toml, and <out-dir>/wrangler.free.toml when the
// client's PLAN_TIER is free (or with --all), and <out-dir>/admin-forwarder/wrangler.toml
// when the client sets FORWARDER_NAME. All are generated and gitignored.
//
//   --env-file <path>       dotenv file with the client's values (strict: an unknown name is an error)
//   --vars-json-env <NAME>  read a JSON object of values from this environment variable
//   --template <path>       default: cloudflare/wrangler.template.toml of this checkout
//   --out-dir <dir>         default: cloudflare/ of this checkout
//   --plan paid|free        override PLAN_TIER (which files get written)
//   --all                   write both files whatever the plan
//   --check                 validate and render in memory, write nothing
//
// It fails, listing every problem at once, on a missing, unknown or invalid
// variable and on a template placeholder it does not know. It never prints a
// value: public CI logs show these messages.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const lib = require('./render-lib.cjs')

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

function isMain() {
  if (!process.argv[1]) return false
  const here = path.resolve(fileURLToPath(import.meta.url))
  const invoked = path.resolve(process.argv[1])
  return process.platform === 'win32' ? here.toLowerCase() === invoked.toLowerCase() : here === invoked
}

function parseArgs(argv) {
  const out = { _: [] }
  const takesValue = new Set(['env-file', 'vars-json-env', 'template', 'out-dir', 'plan'])
  const flags = new Set(['all', 'check', 'help'])
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(raw)
    if (!m) { out._.push(raw); continue }
    const [, key, inline] = m
    if (flags.has(key)) { out[key] = true; continue }
    if (!takesValue.has(key)) throw new lib.RenderError([`unknown option --${key}`])
    const value = inline !== undefined ? inline : argv[++i]
    if (value === undefined) throw new lib.RenderError([`--${key} needs a value`])
    out[key] = value
  }
  if (out._.length) throw new lib.RenderError([`unexpected argument ${out._[0]}`])
  if (out['env-file'] && out['vars-json-env']) throw new lib.RenderError(['use --env-file or --vars-json-env, not both'])
  return out
}

// Values from the chosen source, checked.
export function loadValues(args, env = process.env) {
  if (args['env-file']) return lib.resolveValues(lib.readEnvFile(args['env-file']), { strict: true })
  if (args['vars-json-env']) {
    const text = env[args['vars-json-env']]
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new lib.RenderError([`${args['vars-json-env']} is not a JSON object`]) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new lib.RenderError([`${args['vars-json-env']} is not a JSON object`])
    return lib.resolveValues(parsed)
  }
  return lib.resolveValues(env)
}

export function run(argv, env = process.env, say = (line) => process.stdout.write(`${line}\n`)) {
  const args = parseArgs(argv)
  if (args.help) {
    say(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    return 0
  }
  const templatePath = path.resolve(args.template || path.join(REPO_ROOT, 'cloudflare', 'wrangler.template.toml'))
  const outDir = path.resolve(args['out-dir'] || path.join(REPO_ROOT, 'cloudflare'))
  let template
  try { template = fs.readFileSync(templatePath, 'utf8') } catch { throw new lib.RenderError([`cannot read the template ${templatePath}`]) }
  // The optional forwarder's template sits next to the main one.
  const forwarderPath = path.join(path.dirname(templatePath), 'admin-forwarder', 'wrangler.template.toml')
  const forwarderTemplate = fs.existsSync(forwarderPath) ? fs.readFileSync(forwarderPath, 'utf8') : null
  const values = loadValues(args, env)
  if (values.FORWARDER_NAME && !forwarderTemplate) throw new lib.RenderError(['FORWARDER_NAME is set but the forwarder template is missing'])
  if (args.plan) {
    if (!lib.PLANS.includes(args.plan)) throw new lib.RenderError([`--plan must be paid or free, not ${args.plan}`])
    values.PLAN_TIER = args.plan
  }
  const files = lib.renderFiles(template, values, { all: !!args.all, forwarderTemplate })
  if (args.check) {
    say(`render ok (check only): ${Object.keys(files).join(', ')} for the ${values.PLAN_TIER} plan; nothing written`)
    return 0
  }
  fs.mkdirSync(outDir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(outDir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
    say(`rendered ${name} (${text.split('\n').length - 1} lines)`)
  }
  // A free file left over from another client must never be deployable.
  const stale = path.join(outDir, 'wrangler.free.toml')
  if (!files['wrangler.free.toml'] && fs.existsSync(stale)) {
    fs.rmSync(stale)
    say('removed a wrangler.free.toml left from an earlier render (this client is on the paid plan)')
  }
  // Likewise a forwarder config of another client.
  const staleForwarder = path.join(outDir, lib.FORWARDER_FILE)
  if (!files[lib.FORWARDER_FILE] && fs.existsSync(staleForwarder)) {
    fs.rmSync(staleForwarder)
    say('removed an admin forwarder config left from an earlier render (this client has none)')
  }
  return 0
}

if (isMain()) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (err) {
    if (err instanceof lib.RenderError) {
      process.stderr.write(`render-wrangler: refused\n${err.problems.map((p) => `  - ${p}`).join('\n')}\n`)
    } else {
      process.stderr.write(`render-wrangler: ${err && err.message ? err.message : err}\n`)
    }
    process.exitCode = 1
  }
}
