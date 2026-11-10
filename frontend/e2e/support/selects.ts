import type { Locator, Page } from '@playwright/test'

/**
 * The app's own select control (AppSelect), by its accessible name.
 *
 * Locating it by role and name (getByRole 'button' named Branch, exact) is NOT safe: the sidebar has a navigation item with the same accessible name ("Branch"; Khmer "សាខា"), and the
 * sidebar paints once the signed-in account's pages are resolved, while the select paints with the page. So the same locator found one element on a fast boot and two (a strict-mode
 * violation) on a slow one -- cutover-branch-collapse.spec.ts:93 failed that way intermittently. Every select carries data-app-select-button, which no navigation item does.
 */
export const appSelect = (page: Page, label: string): Locator => page.locator(`button[data-app-select-button][aria-label="${label}"]`)
