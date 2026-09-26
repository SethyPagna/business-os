// The sidebar account avatar falls back to the initials when its image fails.
//
// The avatar rendered `<img src={user.avatar_path}>` in three places (desktop
// account row, mobile header button, mobile account panel) with no onError,
// so an avatar the server no longer serves -- a legacy file type, a deleted
// Library file, offline -- showed a broken-image icon where the initials
// belong. Every spot now goes through AccountAvatarImage, which mirrors
// ProductImage: onError remembers the URL as broken (for 5 minutes, shared by
// all three spots) and renders the same initials the sidebar shows with no
// avatar at all; a new URL is tried afresh.
//
// Two halves:
//   - a source lock on the three call sites (no raw avatar <img> left, each
//     fallback is exactly that spot's no-avatar markup);
//   - the component's own source, compiled and driven through a minimal hook
//     shim: initial render, onError, a sibling instance, a changed URL, and
//     the retry window.
//
// Run: node tests/sidebarAvatarFallback.test.ts
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

const sidebar = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const sidebarCode = code(sidebar)

// Each `<AccountAvatarImage ... />` usage, as source text.
function avatarUsages(source: string): string[] {
  const usages: string[] = []
  let from = 0
  for (;;) {
    const start = source.indexOf('<AccountAvatarImage', from)
    if (start < 0) return usages
    const end = source.indexOf('/>\n', source.indexOf('fallback=', start))
    usages.push(source.slice(start, end + 2))
    from = end + 2
  }
}

await runTest('no raw avatar <img> is left: all three spots use AccountAvatarImage', () => {
  assert.doesNotMatch(sidebarCode, /<img[^>]*src=\{user\??\.avatar_path\}/, 'an avatar <img> without a fallback')
  const usages = avatarUsages(sidebarCode)
  assert.equal(usages.length, 3, 'desktop row, mobile header, mobile panel')
  for (const usage of usages) {
    assert.match(usage, /src=\{user\?\.avatar_path\}/)
    assert.match(usage, /alt=\{user\?\.name \|\| 'User'\}/)
    assert.match(usage, /fallback=\{\(?\s*<span className="[^"]*font-bold"[^>]*>\s*\{user\?\.name\?\.\[0\]\?\.toUpperCase\(\)\}\s*<\/span>\s*\)?\}/,
      'the fallback is the initials')
  }
})

await runTest('each fallback is exactly that spot\'s no-avatar markup', () => {
  const [desktop, header, panel] = avatarUsages(sidebarCode)
  assert.match(desktop, /className="h-8 w-8 rounded-full object-cover"/)
  assert.match(desktop, /<span className="text-sm font-bold" style=\{\{ color: 'var\(--ui-accent\)' \}\}>/)
  assert.match(header, /className="h-10 w-10 object-cover"/)
  assert.match(header, /<span className="text-base font-bold">/)
  assert.match(panel, /className="h-8 w-8 object-cover"/)
  assert.match(panel, /<span className="text-sm font-bold">/)
})

// --- the component itself ---------------------------------------------------
type Element = { type: unknown; props: Record<string, any> }
const Fragment = Symbol('Fragment')
const h = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: { ...(props || {}), children } })

async function loadAvatarComponent(clock: { now: number }) {
  const start = sidebar.indexOf('const BROKEN_AVATAR_RETRY_MS')
  const fnStart = sidebar.indexOf('function AccountAvatarImage(')
  assert.ok(start >= 0 && fnStart > start, 'AccountAvatarImage and its broken-URL memo exist in Sidebar.tsx')
  const end = sidebar.indexOf('\n}\n', fnStart)
  const { code: js } = await transform(sidebar.slice(start, end + 2), { loader: 'tsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment', format: 'esm' })
  let dispatcher: ((initial: unknown) => [unknown, (next: unknown) => void]) | null = null
  const useState = (initial: unknown) => dispatcher!(initial)
  const factory = new Function('useState', 'h', 'Fragment', 'Date', `${js}\nreturn { AccountAvatarImage, brokenAvatarUrls, BROKEN_AVATAR_RETRY_MS }`)
  const loaded = factory(useState, h, Fragment, { now: () => clock.now })
  // One mounted instance: hook state survives re-renders, like React's.
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
        return loaded.AccountAvatarImage(current)
      },
    }
  }
  return { ...loaded, mount }
}

const initials = h('span', { className: 'text-base font-bold' }, 'A')
const isFallback = (tree: Element) => tree.type === Fragment && tree.props.children[0] === initials
const props = (src: string | null) => ({ src, alt: 'Admin', className: 'h-10 w-10 object-cover', fallback: initials })

await runTest('no avatar: the initials; an avatar: an <img> with an onError handler', async () => {
  const clock = { now: 1_000_000 }
  const { mount } = await loadAvatarComponent(clock)
  for (const src of [null, '', '   ']) assert.ok(isFallback(mount(props(src)).render()), `src=${JSON.stringify(src)}`)
  const tree = mount(props('/uploads/me.jpg')).render()
  assert.equal(tree.type, 'img')
  assert.equal(tree.props.src, '/uploads/me.jpg')
  assert.equal(tree.props.alt, 'Admin')
  assert.equal(tree.props.className, 'h-10 w-10 object-cover')
  assert.equal(typeof tree.props.onError, 'function')
})

await runTest('a failed image becomes the initials, and the other avatar spots skip it too', async () => {
  const clock = { now: 1_000_000 }
  const { mount, brokenAvatarUrls } = await loadAvatarComponent(clock)
  const headerAvatar = mount(props('/uploads/legacy-avatar.bmp'))
  const img = headerAvatar.render()
  assert.equal(img.type, 'img')
  img.props.onError()
  assert.ok(isFallback(headerAvatar.render()), 'after onError the same spot shows the initials')
  assert.equal(brokenAvatarUrls.has('/uploads/legacy-avatar.bmp'), true)
  assert.ok(isFallback(mount(props('/uploads/legacy-avatar.bmp')).render()), 'the panel avatar never flashes a broken image')
})

await runTest('a changed avatar is tried afresh; a broken one is retried after the window', async () => {
  const clock = { now: 1_000_000 }
  const { mount, BROKEN_AVATAR_RETRY_MS } = await loadAvatarComponent(clock)
  const avatar = mount(props('/uploads/old.jpg'))
  avatar.render().props.onError()
  assert.ok(isFallback(avatar.render()))
  avatar.setProps(props('/uploads/new.jpg'))
  assert.equal(avatar.render().type, 'img', 'a new URL (the user changed their avatar) loads')
  clock.now += BROKEN_AVATAR_RETRY_MS - 1
  assert.ok(isFallback(mount(props('/uploads/old.jpg')).render()), 'still inside the window')
  clock.now += 2
  assert.equal(mount(props('/uploads/old.jpg')).render().type, 'img', 'retried after the window, like ProductImage')
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
