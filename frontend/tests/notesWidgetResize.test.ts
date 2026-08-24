import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

type TestCallback = () => void | Promise<void>

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

let failed = 0

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// The floating Notes widget used to be pinned to a fixed h-[26rem]
// w-[min(360px,...)] with no way to resize it -- a real feature (drag to
// any size), not the close-bug that was already fixed. This covers the
// resize implementation added to close that gap.

await runTest('NotesWidget panel size is stateful, not a fixed Tailwind size class', () => {
  const source = readFrontend('src/components/shared/NotesWidget.tsx')
  assert.doesNotMatch(
    source,
    /className=\{[^}]*h-\[26rem\][^}]*w-\[min\(360px/,
    'the old fixed h-[26rem] w-[min(360px,...)] classes should be gone from actual JSX className usage once size is stateful (comments mentioning the old value are fine)',
  )
  assert.match(source, /const \[size, setSize\] = useState<PanelSize \| null>/, 'panel size should be React state, not a hard-coded class')
  assert.match(source, /width: `\$\{size\?\.width \?\? DEFAULT_WIDTH\}px`/, 'panel width should come from state with a default fallback')
  assert.match(source, /height: `\$\{size\?\.height \?\? DEFAULT_HEIGHT\}px`/, 'panel height should come from state with a default fallback')
})

await runTest('NotesWidget has a resize handle wired to its own pointer-drag session', () => {
  const source = readFrontend('src/components/shared/NotesWidget.tsx')
  assert.match(source, /cursor-nwse-resize/, 'should render a corner resize handle')
  assert.match(source, /onPointerDown=\{handleResizeHandlePointerDown\}/, 'resize handle should start its own pointer session')
  assert.match(source, /onPointerMove=\{handleResizeHandlePointerMove\}/, 'resize handle should track pointer movement independently of the header drag')
  assert.match(source, /onPointerUp=\{endResizeDrag\}/, 'resize handle should end its drag on pointer up')
  // Resize and reposition must be independent gestures -- distinct pointer
  // state refs, not one shared drag state that would let a reposition drag
  // accidentally also resize (or vice versa).
  assert.match(source, /const resizeStateRef = useRef</, 'resize should track its own drag state, separate from dragStateRef')
})

await runTest('NotesWidget resize is clamped to a minimum and to available viewport space', () => {
  const source = readFrontend('src/components/shared/NotesWidget.tsx')
  assert.match(source, /const MIN_WIDTH = \d+/, 'resize should have a floor so the panel cannot be shrunk to nothing')
  assert.match(source, /const MIN_HEIGHT = \d+/, 'resize should have a floor so the panel cannot be shrunk to nothing')
  assert.match(
    source,
    /function clampSize\(size: PanelSize, left: number, top: number\): PanelSize/,
    'clampSize should bound against the panel\'s actual position, not just raw viewport size, since only the bottom-right corner moves',
  )
})

await runTest('NotesWidget persists resized size across sessions, same pattern as remembered position', () => {
  const source = readFrontend('src/components/shared/NotesWidget.tsx')
  assert.match(source, /SIZE_STORAGE_KEY = 'businessos_notes_widget_size'/, 'size should persist to its own localStorage key')
  assert.match(source, /function readSize\(\): PanelSize \| null/, 'should read a remembered size back on mount')
  assert.match(source, /function writeSize\(size: PanelSize\): void/, 'should write the size once a resize drag actually moved the pointer')
  assert.match(
    source,
    /if \(current\) writeSize\(current\)/,
    'size should only be written to storage on drag end (after a real resize), not on every intermediate pointermove',
  )
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
