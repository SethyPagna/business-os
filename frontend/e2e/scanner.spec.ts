import { expect, test } from '@playwright/test'
import { collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * scanner.spec.ts -- the POS barcode scanner, and the ONE-TAP contract.
 *
 * WHAT THIS PROVES
 *  - Pressing the scan button beside the POS search box starts the camera with
 *    no further tap (the one-tap contract). EXPECTED RED on this source -- see
 *    the fixme below, which names the exact lines that decide it.
 *  - The camera really can start here, so the red above is a statement about
 *    the product and not about the harness.
 *  - The scanner modal is never a blank black box: every state it can land in
 *    carries a message and at least one control.
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
    // This test exists to make the fixme below TRUSTWORTHY. If the camera could
    // not start here at all, "one tap does not start the camera" would be a
    // statement about Playwright, not about the product. So: take the extra
    // tap the current implementation demands, and prove a real MediaStream
    // arrives and paints.
    test.skip(browserName === 'webkit', 'Playwright WebKit exposes no camera; the WebKit contract is asserted in its own test below')
    await context.grantPermissions(['camera'])
    const health = collectPageHealth(page)
    await openPosScanner(page)

    await page.locator(CAMERA_ACTION).first().click()

    const video = page.locator(SCANNER_VIDEO).first()
    await expect(video).toBeVisible({ timeout: 30_000 })
    // Visible is not running. A <video> with no stream is an invisible-to-tests
    // black rectangle of exactly the right size, which is precisely what a
    // broken camera path looks like.
    await expect.poll(
      () => video.evaluate((node: HTMLVideoElement) => ({
        hasStream: !!node.srcObject,
        width: node.videoWidth,
        ready: node.readyState,
      })),
      { message: 'the fake camera must produce a real stream', timeout: 30_000 },
    ).toMatchObject({ hasStream: true })
    expect(await video.evaluate((node: HTMLVideoElement) => node.videoWidth), 'decoded frame width').toBeGreaterThan(0)

    expectNoRuntimeErrors(health)
  })

  test.fixme('one tap on the scan button starts the camera', async ({ page, context, browserName }) => {
    // EXPECTED RED ON THIS SOURCE -- deliberately, and not because of the
    // harness. The test immediately above proves the camera starts here.
    //
    // The current implementation requires a SECOND tap by design.
    // frontend/src/components/products/scanning/BarcodeScannerModal.tsx:426
    //
    //     // Permission is durable browser state; a MediaStream is not. Never
    //     // start the camera just because permission is already granted.
    //     // getUserMedia is reached only from the visible Start/Request
    //     // camera button below.
    //     setStatus('manual')
    //
    // So opening the modal lands on status 'manual' with a "Start camera"
    // button, even when permission is already 'granted'.
    //
    // The owner's contract is ONE TAP: a cashier holding a product and a phone
    // should not have to tap twice. A parallel lane is changing the modal from
    // two-step to one-tap. When it lands, the branch above becomes
    // "permission granted -> start immediately", DELETE THE `.fixme` HERE --
    // every assertion below is already written against the intended behaviour
    // and needs no other change.
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

    // ...and a control that does something about it. "Scan from photo" is
    // always offered, so this can never be vacuously satisfied by the close
    // button alone.
    await expect(dialog.getByRole('button', { name: 'Scan from photo' })).toBeVisible()

    expectNoRuntimeErrors(health)
  })

  test('explains itself when the browser gives no camera', async ({ page, browserName }) => {
    // The iPhone contract. Playwright's WebKit has no camera device, which is
    // the same shape as a real iOS user who denied access or opened the page
    // in a view without camera permission -- and on that path the cashier must
    // get a sentence they can act on plus a retry, never a dead modal.
    //
    // Chromium runs this too, with permission deliberately NOT granted, so the
    // contract is covered on both engines rather than only where it is easy.
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
