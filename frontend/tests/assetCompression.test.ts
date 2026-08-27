import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const SOURCE_DIRS = ['public', 'src']
const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp4', '.webm', '.mov'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const IMAGE_BUDGET_BYTES = 40 * 1024

// App/PWA icons are a deliberate exception to the page-weight budget below
// (product decision, Aug 23 2026 chat session -- "they don't need
// compression, they are an exception, even encourage better quality").
// Unlike in-page content images, these are: (a) each fetched at most once
// per install and then cached indefinitely by the OS/browser as the
// home-screen/app-switcher icon, never re-downloaded on every page load,
// and (b) something the user stares at as a static, zoomed-in image (an
// app icon, not a thumbnail in a scrolling list), where visible palette-
// reduction banding or softness reads as cheap. Trading a few hundred KB
// of one-time, long-cached download for a crisp icon is the right trade
// here even though it would be the wrong one for a hero photo or product
// gallery image. Exempted by exact relative path (not a loose filename
// pattern like `*icon*`) so this stays a short, deliberate, reviewable
// list rather than something that silently swallows a future oversized
// content image just because "icon" appears in its name.
const ICON_BUDGET_EXEMPTIONS = new Set([
  'public/apple-touch-icon.png',
  'public/icon-192.png',
  'public/icon-192-maskable.png',
  'public/icon-512.png',
  'public/icon-512-maskable.png',
  'public/icon.png',
  'public/leang-cosmetics-icon-192.png',
  'public/leang-cosmetics-icon-512.png',
  'public/leang-cosmetics-icon-192-maskable.png',
  'public/leang-cosmetics-icon-512-maskable.png',
  'public/leang-cosmetics-apple-touch-icon-v1.png',
])

function collectMediaFiles(dirUrl: URL, output: URL[] = []): URL[] {
  const dirPath = fileURLToPath(dirUrl)
  if (!fs.existsSync(dirPath)) return output
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl)
    if (entry.isDirectory()) collectMediaFiles(child, output)
    else if (MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(child)
  }
  return output
}

// ICON_BUDGET_EXEMPTIONS is written with forward slashes, but path.relative
// returns the PLATFORM separator -- backslashes on Windows. Without this
// normalization every exemption silently failed to match on a Windows
// checkout, so all 8 exempted app icons were reported as budget violations
// and this whole test failed there while passing on Linux/macOS. Real,
// confirmed cross-platform bug (reproduced on Windows 11), not a genuine
// oversized-asset finding.
function toPosixRelative(fileUrl: URL): string {
  return path.relative(fileURLToPath(ROOT), fileURLToPath(fileUrl)).split(path.sep).join('/')
}

const mediaFiles = SOURCE_DIRS.flatMap((dir) => collectMediaFiles(new URL(`${dir}/`, ROOT)))
const oversizedImages = mediaFiles
  .filter((fileUrl) => IMAGE_EXTENSIONS.has(path.extname(fileUrl.pathname).toLowerCase()))
  .filter((fileUrl) => !ICON_BUDGET_EXEMPTIONS.has(toPosixRelative(fileUrl)))
  .map((fileUrl) => ({ fileUrl, bytes: fs.statSync(fileUrl).size }))
  .filter((entry) => entry.bytes > IMAGE_BUDGET_BYTES)

assert.deepEqual(
  oversizedImages.map((entry) => `${toPosixRelative(entry.fileUrl)} (${entry.bytes} bytes)`),
  [],
  'frontend source images and logos must stay at or below 40KB',
)

// Guard the exemption list itself so it can't silently go stale: every
// path in it must actually exist on disk (catches a typo or a since-
// deleted/renamed icon) so this test still tells you something real
// rather than exempting a path that no longer matches anything.
const missingExemptions = [...ICON_BUDGET_EXEMPTIONS].filter(
  (relPath) => !fs.existsSync(fileURLToPath(new URL(relPath, ROOT))),
)
assert.deepEqual(
  missingExemptions,
  [],
  'ICON_BUDGET_EXEMPTIONS lists a path that no longer exists -- fix or remove the stale entry',
)

console.log('PASS frontend media asset size budget')
