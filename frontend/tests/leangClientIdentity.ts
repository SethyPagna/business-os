// Leang Cosmetics' client identity, resolved from cloudflare/wrangler.toml the
// way the Worker resolves it. Tests that pin what Leang's hosts show ("Leang
// Cosmetics", the LC- prefix, the leang-cosmetics-* icons) pin it through the
// configuration, so the values live in one place and a test fails when the
// Leang config, not a copy of it, changes.
import { isDeepStrictEqual } from 'node:util'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { clientIdentityJson, resolveClientIdentity, type ClientIdentity } from '../../cloudflare/src/lib/clientIdentity.ts'

const IDENTITY_BLOCK_ID = 'business-os-identity'

/** The one-line `KEY = "value"` entries of a wrangler config's [vars] table. */
export function wranglerVars(relPath = '../../cloudflare/wrangler.toml'): Record<string, string> {
  const text = fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  const start = text.indexOf('\n[vars]\n')
  if (start < 0) throw new Error(`${relPath} has no [vars] table`)
  const vars: Record<string, string> = {}
  for (const line of text.slice(start + '\n[vars]\n'.length).split('\n')) {
    if (line.startsWith('[')) break
    const match = /^([A-Z][A-Z0-9_]*) = "([^"]*)"$/.exec(line)
    if (match) vars[match[1]] = match[2]
  }
  return vars
}

export const LEANG_CLIENT_IDENTITY: ClientIdentity = resolveClientIdentity(wranglerVars())

type IdentityScript = { id: string; textContent: string | null; setAttribute(name: string, value: string): void; remove(): void }
type IdentityHost = {
  document?: {
    head?: { appendChild(node: unknown): unknown }
    createElement?(name: string): IdentityScript
    getElementById?(id: string): unknown
  }
}

/**
 * Puts the identity block the Worker writes into a Leang document where
 * getClientIdentity() reads it: into the page's <head> when a (memory) DOM is
 * installed, otherwise behind a stand-in `document` that only answers
 * getElementById. Returns the undo. The app reads the block once per module
 * instance, so write it before the first read: before a bundle is imported or
 * a harness mounts, or around primeClientIdentity's first call.
 */
export function writeIdentityBlock(identity: ClientIdentity = LEANG_CLIENT_IDENTITY): () => void {
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
 * stand-in, so later reads in this process see Leang's hosts. Pass the
 * getClientIdentity of the module instance the code under test imports.
 */
export function primeClientIdentity(getClientIdentity: () => unknown, identity: ClientIdentity = LEANG_CLIENT_IDENTITY): void {
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
