// User avatars outside the sidebar fall back to the initials when the image
// fails (U-profile3, 27 Sep 2026; the R-uploads2 check).
//
// The sidebar got AccountAvatarImage in f72d7eff, but the Users table row,
// the Users mobile card, the user detail sheet, and My Profile's header
// preview and photo viewer still rendered a bare `<img src={avatar_path}>`:
// an avatar the server no longer serves (a deleted Library file, a legacy
// type, offline) showed a broken-image icon where the initials belong. Every
// spot now goes through UserAvatarImage (components/users/UserAvatar.tsx).
//
// Two halves:
//   - the five call sites: no raw avatar <img> is left, and each fallback is
//     that spot's own no-avatar markup (the initials);
//   - the component itself, compiled and driven through a minimal hook shim:
//     no src, onError, a sibling instance, a changed URL, the retry window.
//
// Run: node tests/userAvatarFallback.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const users = code(read('../src/components/users/Users.tsx'))
const sheet = code(read('../src/components/users/UserDetailSheet.tsx'))
const profile = code(read('../src/components/users/UserProfileModal.tsx'))

function usages(source: string): string[] {
  const found: string[] = []
  let from = 0
  for (;;) {
    const start = source.indexOf('<UserAvatarImage', from)
    if (start < 0) return found
    let depth = 0
    let end = start
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') depth -= 1
      else if (depth === 0 && source.startsWith('/>', i)) { end = i + 2; break }
    }
    found.push(source.slice(start, end))
    from = end
  }
}

await runTest('no raw avatar <img> is left on the Users page, the detail sheet or My Profile', () => {
  for (const [name, source] of [['Users.tsx', users], ['UserDetailSheet.tsx', sheet], ['UserProfileModal.tsx', profile]] as const) {
    assert.doesNotMatch(source, /<img[^>]*src=\{(?:user\.avatar_path|avatarPath)\}/, `${name} renders an avatar <img> with no fallback`)
    assert.match(source, /import \{ UserAvatarImage \} from '\.\/UserAvatar\.tsx'/, `${name} imports the shared avatar`)
  }
})

await runTest('each of the five spots falls back to its own initials markup', () => {
  const rows = usages(users)
  assert.equal(rows.length, 2, 'table row and mobile card')
  assert.match(rows[0], /src=\{user\.avatar_path\}[\s\S]*className="h-9 w-9 object-cover"[\s\S]*fallback=\{\(user\.name\?\.\[0\]\?\.toUpperCase\(\) \|\| 'U'\)\}/)
  assert.match(rows[1], /src=\{user\.avatar_path\}[\s\S]*className="h-10 w-10 object-cover"[\s\S]*fallback=\{\(user\.name\?\.\[0\]\?\.toUpperCase\(\) \|\| 'U'\)\}/)
  const [detail] = usages(sheet)
  assert.ok(detail, 'detail sheet header')
  assert.match(detail, /src=\{user\.avatar_path\}[\s\S]*fallback=\{\(user\.name\?\.\[0\]\?\.toUpperCase\(\) \|\| 'U'\)\}/)
  const modal = usages(profile)
  assert.equal(modal.length, 2, 'header preview and photo viewer')
  assert.match(modal[0], /src=\{avatarPath\}[\s\S]*h-12 w-12 rounded-xl object-cover[\s\S]*fallback=\{\(\s*<div className="flex h-12 w-12 [^"]*">\s*\{name\?\.\[0\]\?\.toUpperCase\(\) \|\| 'U'\}/)
  assert.match(modal[1], /src=\{avatarPath\}[\s\S]*object-contain[\s\S]*fallback=\{\(\s*<div className="flex aspect-square [^"]*">\s*\{name\?\.\[0\]\?\.toUpperCase\(\) \|\| 'U'\}/)
})

// --- the component itself ---------------------------------------------------
type Element = { type: unknown; props: Record<string, any> }
const Fragment = Symbol('Fragment')
const h = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: { ...(props || {}), children } })

async function loadComponent(clock: { now: number }) {
  const source = read('../src/components/users/UserAvatar.tsx')
    .replace(/^import .*$/m, '')
    .replace(/^export /gm, '')
  const { code: js } = await transform(source, { loader: 'tsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm' })
  let dispatcher: ((initial: unknown) => [unknown, (next: unknown) => void]) | null = null
  const useState = (initial: unknown) => dispatcher!(initial)
  const factory = new Function('useState', 'h', 'Fragment', 'Date', `${js}\nreturn { UserAvatarImage, brokenUserAvatarUrls, BROKEN_USER_AVATAR_RETRY_MS }`)
  const loaded = factory(useState, h, Fragment, { now: () => clock.now })
  const mount = (props: Record<string, unknown>) => {
    const slots: unknown[] = []
    let current = props
    return {
      setProps(next: Record<string, unknown>) { current = next },
      render(): Element {
        let index = 0
        dispatcher = (initial) => {
          const slot = index++
          if (!(slot in slots)) slots[slot] = initial
          return [slots[slot], (next) => { slots[slot] = next }]
        }
        return loaded.UserAvatarImage(current)
      },
    }
  }
  return { ...loaded, mount }
}

const initials = h('span', null, 'C')
const isFallback = (tree: Element) => tree.type === Fragment && tree.props.children[0] === initials
const props = (src: string | null) => ({ src, alt: 'Cashier', className: 'h-9 w-9 object-cover', fallback: initials })

await runTest('no avatar: the initials; an avatar: an <img> with an onError handler', async () => {
  const { mount } = await loadComponent({ now: 1_000_000 })
  for (const src of [null, '', '   ']) assert.ok(isFallback(mount(props(src)).render()), `src=${JSON.stringify(src)}`)
  const tree = mount(props('/uploads/cashier.jpg')).render()
  assert.equal(tree.type, 'img')
  assert.equal(tree.props.src, '/uploads/cashier.jpg')
  assert.equal(tree.props.alt, 'Cashier')
  assert.equal(typeof tree.props.onError, 'function')
})

await runTest('a failed image becomes the initials, and other spots skip it too', async () => {
  const { mount, brokenUserAvatarUrls } = await loadComponent({ now: 1_000_000 })
  const row = mount(props('/uploads/deleted.jpg'))
  row.render().props.onError()
  assert.ok(isFallback(row.render()), 'after onError the same spot shows the initials')
  assert.equal(brokenUserAvatarUrls.has('/uploads/deleted.jpg'), true)
  assert.ok(isFallback(mount(props('/uploads/deleted.jpg')).render()), 'the detail sheet never flashes a broken image')
})

await runTest('a changed avatar is tried afresh; a broken one is retried after the window', async () => {
  const clock = { now: 1_000_000 }
  const { mount, BROKEN_USER_AVATAR_RETRY_MS } = await loadComponent(clock)
  const avatar = mount(props('/uploads/old.jpg'))
  avatar.render().props.onError()
  avatar.setProps(props('/uploads/new.jpg'))
  assert.equal(avatar.render().type, 'img', 'a new URL loads')
  clock.now += BROKEN_USER_AVATAR_RETRY_MS - 1
  assert.ok(isFallback(mount(props('/uploads/old.jpg')).render()), 'still inside the window')
  clock.now += 2
  assert.equal(mount(props('/uploads/old.jpg')).render().type, 'img', 'retried after the window')
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
