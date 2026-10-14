import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const en = JSON.parse(read('../src/lang/en.json')) as Record<string, any>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, any>
const login = read('../src/components/auth/Login.tsx')
const profile = read('../src/components/users/UserProfileModal.tsx')
const vite = read('../vite.config.ts')

const code = transformSync(read('../src/components/shared/GoogleSignInButton.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
const mod = { exports: {} as Record<string, any> }
new Function('require', 'module', 'exports', code)((id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  throw new Error(`GoogleSignInButton.tsx imports ${id}, which this harness does not provide`)
}, mod, mod.exports)
const GoogleSignInButton = mod.exports.default as (props: Record<string, unknown>) => unknown
const GoogleGMark = mod.exports.GoogleGMark as (props: Record<string, unknown>) => unknown

const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(GoogleSignInButton, { onClick() {}, ...props }))
const textOf = (markup: string) => markup.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim()

const GOOGLE_COLOURS = ['#4285F4', '#34A853', '#FBBC05', '#EA4335']

const failures: string[] = []
function runCase(name: string, body: () => void): void {
  try {
    body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

runCase('the button draws the Google G in all four official colours as inline SVG, hidden from screen readers', () => {
  const markup = render({ label: 'Sign in with Google' })
  const svg = markup.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? ''
  assert.ok(svg, 'no inline SVG in the button')
  assert.match(svg, /viewBox="0 0 48 48"/)
  for (const colour of GOOGLE_COLOURS) assert.ok(svg.includes(`fill="${colour}"`), `the G is missing ${colour}`)
  assert.equal((svg.match(/<path /g) || []).length, 4, 'the G is four paths')
  assert.match(svg, /aria-hidden="true"/)
  assert.doesNotMatch(markup, /lucide/i)
})

runCase('English reads "Sign in with Google" on sign-in and "Continue with Google" on connect, never the single word Google', () => {
  assert.equal(en.login_with_google, 'Sign in with Google')
  assert.equal(en.continue_with_google, 'Continue with Google')
  assert.equal(textOf(render({ label: en.login_with_google })), 'Sign in with Google')
  assert.equal(textOf(render({ label: en.continue_with_google })), 'Continue with Google')
  for (const text of [en.login_with_google, en.continue_with_google]) assert.notEqual(text.trim().toLowerCase(), 'google')
})

runCase('Khmer keeps Google in Latin script inside a Khmer sentence, on both buttons', () => {
  assert.equal(km.login_with_google, 'ចូលជាមួយ Google')
  assert.equal(km.continue_with_google, 'បន្តជាមួយ Google')
  for (const text of [km.login_with_google, km.continue_with_google]) {
    assert.match(text, /[ក-៿]/)
    assert.ok(text.endsWith(' Google'), `${text}: Google must stay in Latin script`)
    assert.notEqual(text.trim(), 'Google')
    assert.ok(!/ហ្គូហ្គល|ហ្គូហ្គ្លេ/.test(text), `${text}: Google must not be transliterated`)
  }
  assert.equal(textOf(render({ label: km.login_with_google })), km.login_with_google)
})

runCase('the sign-in label has one value in every place the pack declares it, so whichever copy the app reads is the branded one', () => {
  const nested = (pack: Record<string, any>): string[] => Object.values(pack).flatMap((value) => (value && typeof value === 'object' ? Object.entries(value).filter(([key]) => key === 'login_with_google').map(([, text]) => String(text)) : []))
  assert.deepEqual(nested(en), ['Sign in with Google'])
  assert.deepEqual(nested(km), [km.login_with_google])
})

runCase('light and dark follow Google branding: white with a #747775 outline and #1f1f1f text; #131314 with a #8e918f outline and #e3e3e3 text; at least 40px tall', () => {
  const button = render({ label: 'Sign in with Google' }).match(/<button[^>]*>/)?.[0] ?? ''
  for (const token of ['bg-white', 'border-[#747775]', 'text-[#1f1f1f]', 'dark:bg-[#131314]', 'dark:border-[#8e918f]', 'dark:text-[#e3e3e3]', 'min-h-10', 'leading-relaxed']) {
    assert.ok(button.includes(token), `button class lacks ${token}`)
  }
  assert.doesNotMatch(button, /btn-secondary|btn-primary/, 'the app button theme must not restyle the Google button')
})

runCase('while connecting, the G gives way to a spinner and the button is disabled; the label stays', () => {
  const idle = render({ label: 'Continue with Google' })
  const busy = render({ label: 'Continue with Google', loading: true, disabled: true })
  assert.ok(idle.includes('data-google-g'))
  assert.ok(!busy.includes('data-google-g'))
  assert.match(busy, /animate-spin/)
  assert.match(busy.match(/<button[^>]*>/)?.[0] ?? '', / disabled=""/)
  assert.equal(textOf(busy), 'Continue with Google')
  assert.doesNotMatch(idle.match(/<button[^>]*>/)?.[0] ?? '', / disabled=""/)
})

runCase('Login uses the Google button with the pack label and no longer carries the browser glyph, the one-off button or the "Login with" heading', () => {
  assert.doesNotMatch(login, /icons\/chrome\.js|\bChrome\b/)
  assert.doesNotMatch(login, /OauthButton/)
  assert.match(login, /<GoogleSignInButton[\s\S]*?label=\{tr\('login_with_google', 'Sign in with Google'\)\}[\s\S]*?onClick=\{\(\) => handleStartOauth\('google'\)\}/)
  assert.doesNotMatch(login, /tr\('login_with_google', 'Google'\)/)
  assert.doesNotMatch(login, /tr\('login_with', /)
  assert.match(login, /tr\('login_or', 'or'\)/)
  assert.equal(en.login_or, 'or')
  assert.equal(km.login_or, 'ឬ')
  assert.equal('login_with' in en, false)
  assert.equal('login_with' in km, false)
})

runCase('the profile shows the G beside the Google method, and its connect action is the branded Continue with Google button', () => {
  assert.doesNotMatch(profile, /icons\/chrome\.js|\bChrome\b/)
  assert.match(profile, /import GoogleSignInButton, \{ GoogleGMark \} from '\.\.\/shared\/GoogleSignInButton\.tsx'/)
  assert.match(profile, /<GoogleGMark className="h-4 w-4 shrink-0" \/>\s*<span>\{tr\('google_signin', 'Google'\)\}<\/span>/)
  assert.match(profile, /<GoogleSignInButton[\s\S]*?label=\{tr\('continue_with_google', 'Continue with Google'\)\}[\s\S]*?loading=\{oauthConnecting === 'google'\}[\s\S]*?handleStartOauthLink\('google'\)/)
  assert.match(profile, /handleDisconnectOauthProvider\('google'\)/, 'Disconnect Google is untouched')
  assert.match(profile, /continue_with_google: 'បន្តជាមួយ Google'/, 'the profile\'s own Khmer fallback matches the pack')
})

runCase('no browser glyph is left in src or pinned in the build config, and the G component renders on its own', () => {
  const offenders: string[] = []
  const walk = (dir: URL): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) { walk(child); continue }
      if (/\.(ts|tsx)$/.test(entry.name) && /lucide-react\/dist\/esm\/icons\/chrome\.js/.test(fs.readFileSync(child, 'utf8'))) offenders.push(entry.name)
    }
  }
  walk(new URL('../src/', import.meta.url))
  assert.deepEqual(offenders, [])
  assert.doesNotMatch(vite.match(/const authLoginIconNames = new Set\(\[[\s\S]*?\]\)/)?.[0] || '', /'chrome'/)
  assert.match(renderToStaticMarkup(React.createElement(GoogleGMark, { className: 'h-4 w-4' })), /^<svg[^>]*class="h-4 w-4"/)
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS Google sign-in branding: official G, "Sign in with Google" / "Continue with Google", Khmer keeps Google in Latin script')
