// Scanner S1a (6.0.922): the live loop decodes the area the on-screen guide
// outlines, not a fixed centre crop.
//
// Before: the grabber always cut the centre 60% x 60% of the camera frame. The
// video is shown object-fit: cover, so on a portrait phone the view is a short
// window onto a tall frame and the guide is wider than that crop: a code that
// fills the guide was cut off at both ends. Owner-visible symptom: "I held it
// inside the box and it would not read".
//
// The expected rect for the spec's example (portrait 1080x1920 video, 360x380
// view, 86% x 38% guide band) is about {x 76, y 743, w 929, h 433}. The oracle
// below is independent of the object-fit arithmetic in the source: it projects
// the returned source rect forward onto the screen and checks that the screen
// guide lies inside it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  SCAN_GUIDE_BOX,
  createFrameGrabber,
  guideRectInFrame,
  viewOf,
} from '../src/components/products/scanning/barcodeFrameDecoder.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// A canvas that only records what the grabber draws.
type Draw = { sx: number; sy: number; sw: number; sh: number }
const draws: Draw[] = []
const fakeCanvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    drawImage: (_source: unknown, sx: number, sy: number, sw: number, sh: number) => { draws.push({ sx, sy, sw, sh }) },
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  }),
}
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => fakeCanvas } })

function centreDraw(video: object, frameWidth: number, frameHeight: number, box?: { widthPercent: number; heightPercent: number }): Draw {
  draws.length = 0
  createFrameGrabber(box)(video as CanvasImageSource, frameWidth, frameHeight).centre()
  assert.equal(draws.length, 1, 'one centre grab draws exactly once')
  return draws[0]
}

const BAND = { widthPercent: 86, heightPercent: 38 }

runTest('portrait 1080x1920 video in a 360x380 view: the grabbed rect is the guide band, about {76, 743, 929, 433}', () => {
  const drawn = centreDraw({ clientWidth: 360, clientHeight: 380 }, 1080, 1920, BAND)
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 1, `${actual} is not within 1 of ${expected}`)
  near(drawn.sx, 76)
  near(drawn.sy, 743)
  near(drawn.sw, 929)
  near(drawn.sh, 433)
  // Exact guide in source pixels: x 75.6..1004.4, y 743.4..1176.6.
  assert.ok(drawn.sx <= 75.6 && drawn.sx + drawn.sw >= 1004.4, 'the rect must contain the guide across')
  assert.ok(drawn.sy <= 743.4 && drawn.sy + drawn.sh >= 1176.6, 'the rect must contain the guide down')
})

runTest('the fixed 60% crop the loop used before would have cut that guide off', () => {
  const photoStyle = centreDraw({}, 1080, 1920)
  assert.deepEqual(photoStyle, { sx: 216, sy: 384, sw: 648, sh: 1152 })
  assert.ok(photoStyle.sx > 75.6, 'the old crop starts to the right of the guide edge, so a code that fills the guide lost its ends')
})

// Forward oracle: where the returned rect lands on screen under object-fit: cover.
function screenEdges(rect: { x: number; y: number; width: number; height: number }, frame: [number, number], view: [number, number]) {
  const scale = Math.max(view[0] / frame[0], view[1] / frame[1])
  const offsetX = (frame[0] * scale - view[0]) / 2
  const offsetY = (frame[1] * scale - view[1]) / 2
  return {
    left: rect.x * scale - offsetX,
    right: (rect.x + rect.width) * scale - offsetX,
    top: rect.y * scale - offsetY,
    bottom: (rect.y + rect.height) * scale - offsetY,
    scale,
  }
}

runTest('the grabbed rect contains the on-screen guide, and wastes at most a pixel or two, for portrait, landscape and square views', () => {
  const cases: Array<{ frame: [number, number]; view: [number, number] }> = [
    { frame: [1080, 1920], view: [360, 380] },
    { frame: [1920, 1080], view: [360, 380] },
    { frame: [1920, 1080], view: [800, 450] },
    { frame: [1280, 720], view: [360, 640] },
    { frame: [640, 480], view: [300, 300] },
  ]
  for (const box of [SCAN_GUIDE_BOX, BAND]) {
    for (const { frame, view } of cases) {
      const rect = guideRectInFrame(frame[0], frame[1], { width: view[0], height: view[1] }, box)
      const edges = screenEdges(rect, frame, view)
      const guide = {
        left: (view[0] * (100 - box.widthPercent)) / 200,
        right: view[0] - (view[0] * (100 - box.widthPercent)) / 200,
        top: (view[1] * (100 - box.heightPercent)) / 200,
        bottom: view[1] - (view[1] * (100 - box.heightPercent)) / 200,
      }
      const label = `frame ${frame.join('x')} in ${view.join('x')} view, ${box.widthPercent}x${box.heightPercent} guide`
      // A source pixel is `scale` screen pixels; allow two of them either side.
      const slack = 2 * edges.scale + 1e-6
      assert.ok(edges.left <= guide.left + 1e-6 && edges.right >= guide.right - 1e-6, `${label}: rect must contain the guide across`)
      assert.ok(edges.top <= guide.top + 1e-6 && edges.bottom >= guide.bottom - 1e-6, `${label}: rect must contain the guide down`)
      assert.ok(guide.left - edges.left <= slack && edges.right - guide.right <= slack, `${label}: rect is wider than the guide`)
      assert.ok(guide.top - edges.top <= slack && edges.bottom - guide.bottom <= slack, `${label}: rect is taller than the guide`)
    }
  }
})

runTest('the live overlay guide (86% x 70%) maps to a taller rect than the band, from the same arithmetic', () => {
  const live = guideRectInFrame(1080, 1920, { width: 360, height: 380 }, SCAN_GUIDE_BOX)
  assert.ok(Math.abs(live.x - 76) <= 1 && Math.abs(live.width - 929) <= 1)
  assert.ok(Math.abs(live.y - 561) <= 1 && Math.abs(live.height - 798) <= 1, `got ${JSON.stringify(live)}`)
})

runTest('a view that is not laid out falls back to the guide percentages of the whole frame, clamped to it', () => {
  assert.equal(viewOf({}), null)
  assert.equal(viewOf({ clientWidth: 0, clientHeight: 380 }), null)
  assert.deepEqual(viewOf({ clientWidth: 360, clientHeight: 380 }), { width: 360, height: 380 })
  const whole = guideRectInFrame(64, 48, null, SCAN_GUIDE_BOX)
  assert.deepEqual(whole, { x: 4, y: 7, width: 56, height: 34 })
  const everything = guideRectInFrame(64, 48, null, { widthPercent: 100, heightPercent: 100 })
  assert.deepEqual(everything, { x: 0, y: 0, width: 64, height: 48 })
})

runTest('the whole-frame region and the still-photo centre are unchanged', () => {
  draws.length = 0
  createFrameGrabber(BAND)({ clientWidth: 360, clientHeight: 380 } as unknown as CanvasImageSource, 1080, 1920).full()
  assert.deepEqual(draws, [{ sx: 0, sy: 0, sw: 1080, sh: 1920 }])
  assert.deepEqual(centreDraw({}, 4000, 3000), { sx: 800, sy: 600, sw: 2400, sh: 1800 }, 'a photo has no guide: its centre 60% as before')
})

runTest('the grabber hands the worker camera RGBA pixels, capped at 1280 on the longest side, in a buffer it can take over', () => {
  const regions = createFrameGrabber(BAND)({ clientWidth: 360, clientHeight: 380 } as unknown as CanvasImageSource, 1080, 1920)
  const full = regions.full()
  assert.deepEqual([full.width, full.height], [720, 1280], 'a 1080x1920 frame is scaled down by 1280/1920')
  assert.equal(full.data.length, full.width * full.height * 4, 'four bytes (RGBA) per pixel: the greyscale conversion belongs to the worker')
  assert.ok(full.data.buffer instanceof ArrayBuffer, 'a plain ArrayBuffer, which postMessage can transfer instead of copying')
  const guide = regions.centre()
  assert.equal(guide.data.length, guide.width * guide.height * 4)
  assert.ok(Math.max(guide.width, guide.height) <= 1280)
  assert.notEqual(guide.data.buffer, full.data.buffer, 'two regions never share a buffer, or the second transfer would fail')
})

runTest('the overlay is drawn from the same box the grabber decodes', () => {
  const modal = fs.readFileSync(new URL('../src/components/products/scanning/BarcodeScannerModal.tsx', import.meta.url), 'utf8')
  const camera = fs.readFileSync(new URL('../src/components/products/scanning/useBarcodeCamera.ts', import.meta.url), 'utf8')
  assert.match(camera, /createFrameGrabber\(SCAN_GUIDE_BOX\)/, 'the live grabber decodes the shared guide box')
  assert.match(modal, /const GUIDE_STYLE = \{ width: `\$\{SCAN_GUIDE_BOX\.widthPercent\}%`, height: `\$\{SCAN_GUIDE_BOX\.heightPercent\}%` \}/, 'the overlay size comes from the shared guide box')
  assert.equal((modal.match(/style=\{GUIDE_STYLE\}/g) || []).length, 1, 'the one guide outline uses it (the corner frame was dropped with the compact sheet)')
  assert.doesNotMatch(modal, /h-\[70%\] w-\[86%\]/, 'no second, hand-copied guide size may remain in the overlay classes')
})

if (failed > 0) process.exitCode = 1
