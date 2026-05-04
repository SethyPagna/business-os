import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../', import.meta.url)
const SOURCE_DIRS = ['public', 'src']
const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp4', '.webm', '.mov'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const IMAGE_BUDGET_BYTES = 40 * 1024

function collectMediaFiles(dirUrl, output = []) {
  const dirPath = dirUrl.pathname
  if (!fs.existsSync(dirPath)) return output
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl)
    if (entry.isDirectory()) collectMediaFiles(child, output)
    else if (MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(child)
  }
  return output
}

const mediaFiles = SOURCE_DIRS.flatMap((dir) => collectMediaFiles(new URL(`${dir}/`, ROOT)))
const oversizedImages = mediaFiles
  .filter((fileUrl) => IMAGE_EXTENSIONS.has(path.extname(fileUrl.pathname).toLowerCase()))
  .map((fileUrl) => ({ fileUrl, bytes: fs.statSync(fileUrl).size }))
  .filter((entry) => entry.bytes > IMAGE_BUDGET_BYTES)

assert.deepEqual(
  oversizedImages.map((entry) => `${path.relative(ROOT.pathname, entry.fileUrl.pathname)} (${entry.bytes} bytes)`),
  [],
  'frontend source images and logos must stay at or below 40KB',
)

console.log('PASS frontend media asset size budget')
