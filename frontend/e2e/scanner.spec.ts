import { expect, test } from '@playwright/test'
import { collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * scanner.spec.ts -- the POS barcode scanner, and the ONE-TAP contract.
 *
 * WHAT THIS PROVES
 *  - Pressing the scan button beside the POS search box starts the camera with
 *    no further tap (the one-tap contract, 8e6371cb + c2185071): the modal
 *    opens in status 'starting' and calls getUserMedia from the open gesture.
 *  - The camera really can start here: a real MediaStream arrives and decodes
 *    on the fake device, so "one tap" is measured, not assumed.
 *  - The scanner modal is never a blank black box: every state it can land in
 *    carries a message and at least one control -- the live view counts its
 *    video as the control, every other state offers "Scan from photo".
 *  - On WebKit, where Playwright grants no camera, the unsupported/denied state
 *    is explained and offers a way forward.
 *
 * ERROR CLASS GUARDED: 57d8f1a2 (scanner), plus the general "modal opens onto
 * nothing" class -- a cashier holding a product at the till has no way to tell
 * a slow camera from a dead one.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test scanner
 *
 * The chromium projects launch with --use-fake-ui-for-media-stream and
 * --use-fake-device-for-media-stream (playwright.config.ts), so getUserMedia
 * resolves against a synthetic camera. No hardware, no prompt, no human.
 */

const SCAN_BUTTON = 'button[aria-label="Scan Barcode"]'
const SCANNER_VIDEO = 'video'
// barcodeScannerState.ts deriveScannerPresentation(): which of the three
// labels appears IS the state, so they are listed together deliberately.
const CAMERA_ACTION = 'button:text-is("Start camera"), button:text-is("Request camera access"), button:text-is("Try camera again")'

/**
 * Every message deriveScannerPresentation() can put under the state label.
 *
 * These are the SHIPPED strings from frontend/src/lang/en.json, not the English
 * fallbacks written inline in BarcodeScannerModal.tsx -- the two have drifted
 * apart and the pack wins at runtime. Measured: the modal renders en.json:1004
 * "We need camera access to scan barcodes. Tap below and allow camera
 * permission when your browser asks.", while BarcodeScannerModal.tsx:164 still
 * carries the shorter fallback "Camera access is needed to scan barcodes.".
 * A spec written from the .tsx fallback passes only on the states whose two
 * strings happen to agree, which is how this file was wrong before.
 *
 *   camera_permission_needed        en.json:1004
 *   camera_permission_ready         en.json:5606
 *   camera_permission_blocked       en.json:1003
 *   camera_document_blocked         en.json:1002
 *   scan_unsupported                en.json:4596
 *   scan_ready                      en.json:4594
 *   requesting_camera               en.json:4154
 *   scan_prompt_dismissed           en.json:4593
 *   scan_permission_denied          en.json:4588
 *   scan_failed                     en.json:4584
 */
const SCANNER_MESSAGE = new RegExp([
  // The LIVE view (status 'scanning' / 'starting') renders none of the
  // deriveScannerPresentation() strings: its one instruction line is the
  // overlay hint scanner_live_hint (en.json "Center the barcode inside the
  // frame. We will scan it automatically.") -- BarcodeScannerModal.tsx, the
  // comment above the video shell explains why the status bar was removed.
  'Center the barcode inside the frame',
  'We need camera access to scan barcodes',
  'Camera permission is saved',
  'Camera access is blocked',
  'does not allow camera access',
  'Camera scanning is not supported',
  'Point the camera at a barcode',
  'Requesting camera access',
  'The camera prompt was dismissed',
  'Camera access was denied',
  'Unable to start camera scanning',
].join('|'))

async function openPosScanner(page: Parameters<typeof signIn>[0]) {
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await gotoAdminPage(page, '/pos')
  // A real product grid, not an empty page: the scan button lives in the POS
  // search row and that row only exists once the catalogue surface is up.
  await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })
  await page.locator(SCAN_BUTTON).first().click()
}

test.describe('POS barcode scanner', () => {
  test('grants the camera and can actually start it', async ({ page, context, browserName }) => {
    // Proves the camera path is real on this harness: the ONE tap in
    // openPosScanner() must end with a MediaStream that decodes frames. Without
    // this, the one-tap test below could pass on a <video> that never played.
    test.skip(browserName === 'webkit', 'Playwright WebKit exposes no camera; the WebKit contract is asserted in its own test below')
    test.setTimeout(120_000)
    await context.grantPermissions(['camera'])
    const health = collectPageHealth(page)
    await openPosScanner(page)

    const video = page.locator(SCANNER_VIDEO).first()
    await expect(video).toBeVisible({ timeout: 30_000 })
    // Visible is not running. A <video> with no stream is an invisible-to-tests
    // black rectangle of exactly the right size, which is precisely what a
    // broken camera path looks like. Nothing is re-tapped here: the modal owns
    // the start, and a "Start camera" button appearing would be the one-tap
    // regression the next test exists to catch.
    //
    // Both facts are polled together: srcObject is set the instant getUserMedia
    // resolves, while videoWidth stays 0 until the first frame decodes a few
    // hundred ms later. Measured at --workers=4 on android-chromium: a poll that
    // stopped at hasStream saw width 0 on the very next evaluate.
    await expect.poll(
      async () => video.evaluate((node: HTMLVideoElement) => ({
        hasStream: !!node.srcObject,
        decodedFrame: node.videoWidth > 0,
        ready: node.readyState,
      })),
      { message: 'the fake camera must produce a real stream that decodes a frame', timeout: 60_000 },
    ).toMatchObject({ hasStream: true, decodedFrame: true })

    expectNoRuntimeErrors(health)
  })

  test('one tap on the scan button starts the camera', async ({ page, context, browserName }) => {
    // The owner's contract: a cashier holding a product and a phone taps ONCE.
    // BarcodeScannerModal.tsx opens in status 'starting' and its open effect
    // calls startCamera() from the tap gesture (8e6371cb); before that it
    // parked on status 'manual' behind a "Start camera" button and this test
    // was an expected red.
    //
    // The discriminating detail is the word "without": the test never clicks
    // the camera action, so an implementation that still shows it fails here
    // while passing every other test in this file.
    test.skip(browserName === 'webkit', 'no camera on WebKit; see the WebKit contract test')
    await context.grantPermissions(['camera'])
    const health = collectPageHealth(page)
    await openPosScanner(page)

    await expect(page.locator(SCANNER_VIDEO).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(CAMERA_ACTION), 'a one-tap scanner shows no "start" button at all').toHaveCount(0)

    expectNoRuntimeErrors(health)
  })

  test('never opens onto a blank modal', async ({ page, context, browserName }) => {
    // CATCHES: the failure mode a cashier cannot diagnose -- the modal opens,
    // the panel is black, and nothing says whether the camera is coming, was
    // refused, or is unsupported. Asserted on EVERY project, including the one
    // with no camera at all, because "it works on my Chrome" is exactly how
    // this ships broken to the iPhones on the counter.
    //
    // Discriminating because it asserts the modal carries BOTH an explanation
    // and an actionable control: a spinner alone, or a lone Close button,
    // fails it.
    if (browserName === 'chromium') await context.grantPermissions(['camera'])
    const health = collectPageHealth(page)
    await openPosScanner(page)

    const dialog = page.getByRole('dialog').filter({ hasText: 'Scan Barcode' }).first()
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    // One of the states deriveScannerPresentation() can produce -- never none.
    await expect(dialog.getByText(SCANNER_MESSAGE).first()).toBeVisible({ timeout: 15_000 })

    // ...and a control that does something about it. Every non-live state
    // offers "Scan from photo"; the live view offers the camera itself, whose
    // <video> is the only thing a cashier needs. Either way the close button
    // alone can never satisfy this.
    const photo = dialog.getByRole('button', { name: 'Scan from photo' })
    const video = dialog.locator(SCANNER_VIDEO)
    await expect(photo.or(video).first()).toBeVisible({ timeout: 15_000 })

    expectNoRuntimeErrors(health)
  })

  test('explains itself when the browser gives no camera', async ({ page, browserName }) => {
    // The iPhone contract. Playwright's WebKit has no camera device, which is
    // the same shape as a real iOS user who denied access or opened the page
    // in a view without camera permission -- and on that path the cashier must
    // get a sentence they can act on plus a retry, never a dead modal.
    //
    // Chromium runs this too. Its projects launch with a fake camera that
    // auto-accepts the prompt, so "not granted" would silently become "live";
    // instead getUserMedia is made to reject with the browser's own denial
    // shape (NotAllowedError), which is what a real refused prompt produces.
    if (browserName === 'chromium') {
      await page.addInitScript(() => {
        const devices = navigator.mediaDevices
        if (!devices) return
        devices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
      })
    }
    const health = collectPageHealth(page)
    await openPosScanner(page)

    const dialog = page.getByRole('dialog').filter({ hasText: 'Scan Barcode' }).first()
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    // A message that names the problem...
    await expect(dialog.getByText(SCANNER_MESSAGE).first()).toBeVisible({ timeout: 15_000 })

    // ...and a way forward. Either the camera can still be asked for, or -- on
    // a browser where it cannot -- the photo path stands in for it. An empty
    // panel satisfies neither.
    const ways = await page.locator(`${CAMERA_ACTION}, button:text-is("Scan from photo")`).count()
    expect(ways, 'the denied/unsupported state must offer at least one way forward').toBeGreaterThan(0)

    // Not blank: the panel has real content, measured rather than eyeballed.
    const panelText = (await dialog.innerText()).replace(/\s+/g, ' ').trim()
    expect(panelText.length, `scanner panel text (saw "${panelText}")`).toBeGreaterThan(20)

    if (browserName === 'webkit') {
      // Record what WebKit actually does here, so a future change of behaviour
      // shows up as a diff in this file rather than as a silent shift.
      expect(panelText).toMatch(/Camera/)
    }

    expectNoRuntimeErrors(health)
  })
})
