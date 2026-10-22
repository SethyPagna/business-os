// The client identity the frontend tests run as, resolved from a Worker config
// the way the Worker resolves it, so a test that pins what a shop's hosts show
// ("Install <shop>", the shop's icons, the house membership prefix) pins it
// through the configuration instead of a copy of it.
//
// cloudflare/wrangler.toml and wrangler.free.toml are generated per client and
// untracked: a fresh checkout, CI included, has neither, so nothing here reads
// them. The config is the committed template rendered (cloudflare/scripts/harness):
//
//   CLIENT_IDENTITY / fixtureVars()  the neutral fixture client ("Example Shop":
//                                    clients/example.env with the Example Shop
//                                    identity of harness/rendered_wrangler.cjs).
//                                    Runs everywhere; the structural checks use it.
//   leangVars()                      Leang Cosmetics' [vars] from the private
//                                    Records/Clients/leang.env, or null where this
//                                    machine does not have it. A pin of that client's
//                                    real strings runs only when it returns a value
//                                    and calls skipLeang() otherwise.
import { spawnSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { clientIdentityJson, resolveClientIdentity, type ClientIdentity } from '../../cloudflare/src/lib/clientIdentity.ts'

const IDENTITY_BLOCK_ID = 'business-os-identity'

type Harness = {
  wranglerVars(file?: string, client?: string): Record<string, string>
  leangVars(file?: string): Record<string, string> | null
  hasLeang(): boolean
  skipLeang(testName: string, what: string): void
}
const harness = createRequire(import.meta.url)('../../cloudflare/scripts/harness/wrangler_vars.cjs') as Harness

/** The strings a client's documents carry (cloudflare/scripts/harness/client_records.cjs), written out as frozen literals. */
export type ClientRecord = {
  id: string
  shopName: string
  shopNameKm: string
  shopAlias: string
  adminTitle: string
  adminShortName: string
  adminDescription: string
  shopDescription: string
  shopHost: string
  adminHost: string
  iconPrefix: string
  membershipPrefix: string
  wwwHost: string
  retiredHost: string
  lookalikeAdmin: string
  leak: RegExp
}
const records = createRequire(import.meta.url)('../../cloudflare/scripts/harness/client_records.cjs') as { EXAMPLE_RECORD: ClientRecord; LEANG_RECORD: ClientRecord }

/** The neutral fixture client's frozen strings. */
export const EXAMPLE_RECORD: ClientRecord = records.EXAMPLE_RECORD
/** Leang Cosmetics' frozen strings; use them only where leangVars() returns a value. */
export const LEANG_RECORD: ClientRecord = records.LEANG_RECORD

/** One client a test runs as: its frozen strings, its rendered [vars], and whether its own icon art is committed in frontend/public. */
export type ShopClient = { record: ClientRecord; vars: Record<string, string>; shipsIcons: boolean }

/**
 * The shops a test runs as: the neutral fixture client always, and Leang Cosmetics where the private
 * Records/Clients/leang.env exists (otherwise it prints the one SKIP line and carries on without it).
 */
export function shopClients(testName: string, what: string): ShopClient[] {
  const clients: ShopClient[] = [{ record: EXAMPLE_RECORD, vars: fixtureVars(), shipsIcons: false }]
  const leang = leangVars()
  if (leang) clients.push({ record: LEANG_RECORD, vars: leang, shipsIcons: true })
  else skipLeang(testName, what)
  return clients
}

/** The `[vars]` of the fixture client's rendered config ('wrangler.toml' = paid, 'wrangler.free.toml' = free). */
export function fixtureVars(file = 'wrangler.toml'): Record<string, string> {
  return harness.wranglerVars(file)
}

/** Leang Cosmetics' `[vars]` from the private render, or null where this machine does not have it. */
export function leangVars(file = 'wrangler.toml'): Record<string, string> | null {
  return harness.leangVars(file)
}

/** Prints the one line a Leang pin leaves where the private values are absent (CI). */
export function skipLeang(testName: string, what: string): void {
  harness.skipLeang(testName, what)
}

const CHILD_ENV = 'CLIENT_FIXTURE_AS'

/**
 * The client a test runs as when the page reads its identity once per process (a module-level cache that
 * cannot be swapped between clients): the fixture client, or Leang Cosmetics inside the re-run that
 * rerunAsLeang() starts.
 */
export function processClient(): ShopClient {
  if (process.env[CHILD_ENV] === 'leang') {
    const vars = leangVars()
    if (!vars) throw new Error('CLIENT_FIXTURE_AS=leang needs the private Records/Clients/leang.env')
    return { record: LEANG_RECORD, vars, shipsIcons: true }
  }
  return { record: EXAMPLE_RECORD, vars: fixtureVars(), shipsIcons: false }
}

/**
 * Runs the calling test file again as Leang Cosmetics, in its own process (so its own once-per-process
 * identity), where this machine has the private Records/Clients/leang.env; elsewhere prints the one SKIP line.
 * Call it last; a failing re-run ends this process with the same status. A no-op inside the re-run.
 */
export function rerunAsLeang(testUrl: string, testName: string, what: string): void {
  if (process.env[CHILD_ENV]) return
  if (!leangVars()) {
    skipLeang(testName, what)
    return
  }
  const run = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(testUrl)], { env: { ...process.env, [CHILD_ENV]: 'leang' }, stdio: 'inherit' })
  if (run.status !== 0) {
    console.error(`${testName}: the Leang run failed (exit ${run.status})`)
    process.exit(run.status || 1)
  }
}

/** A client's string as a regular expression source, for assertions built from a record's fields. */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The fixture client's identity, as the Worker writes it into every document. */
export const CLIENT_IDENTITY: ClientIdentity = resolveClientIdentity(fixtureVars())

type IdentityScript = { id: string; textContent: string | null; setAttribute(name: string, value: string): void; remove(): void }
type IdentityHost = {
  document?: {
    head?: { appendChild(node: unknown): unknown }
    createElement?(name: string): IdentityScript
    getElementById?(id: string): unknown
  }
}

/**
 * Puts the identity block the Worker writes into a document where
 * getClientIdentity() reads it: into the page's <head> when a (memory) DOM is
 * installed, otherwise behind a stand-in `document` that only answers
 * getElementById. Returns the undo. The app reads the block once per module
 * instance, so write it before the first read: before a bundle is imported or
 * a harness mounts, or around primeClientIdentity's first call.
 */
export function writeIdentityBlock(identity: ClientIdentity = CLIENT_IDENTITY): () => void {
  const host = globalThis as unknown as IdentityHost
  const json = clientIdentityJson(identity)
  const page = host.document
  if (page?.head && typeof page.createElement === 'function') {
    const script = page.createElement('script')
    script.id = IDENTITY_BLOCK_ID
    script.setAttribute('type', 'application/json')
    script.textContent = json
    page.head.appendChild(script)
    return () => script.remove()
  }
  const hadDocument = 'document' in host
  host.document = { getElementById: (id: string) => (id === IDENTITY_BLOCK_ID ? { textContent: json } : null) }
  return () => {
    if (hadDocument) host.document = page
    else delete host.document
  }
}

/**
 * Fills a getClientIdentity's per-page cache with the identity, then removes the
 * stand-in, so later reads in this process see the client's hosts. Pass the
 * getClientIdentity of the module instance the code under test imports.
 */
export function primeClientIdentity(getClientIdentity: () => unknown, identity: ClientIdentity = CLIENT_IDENTITY): void {
  const undo = writeIdentityBlock(identity)
  let read: unknown
  try {
    read = getClientIdentity()
  } finally {
    undo()
  }
  if (!isDeepStrictEqual(read, identity)) {
    throw new Error('getClientIdentity() had already read the page before the test primed it; prime before anything imports or renders the code under test')
  }
}
