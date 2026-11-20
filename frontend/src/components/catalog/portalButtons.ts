// The one recipe for every primary button on the storefront: ink fill with ivory text; in dark mode the colours swap.
// The colours are arbitrary values on purpose: main.css remaps `dark:bg-neutral-100`, `bg-slate-900` and the like to the
// app's own dark surfaces with !important, which turned the header Contact button charcoal on black.
// Literal strings, because Tailwind only emits classes it can read in the source; tests/portalPrimaryButton.test.ts
// checks the hex values against PORTAL_TOKENS and the contrast of both pairs.
export const PORTAL_PRIMARY_COLORS = 'bg-[#23201b] text-[#f4f1ea] hover:bg-[#3a352c] dark:bg-[#f5f1e8] dark:text-[#23201b] dark:hover:bg-[#d9d4c7]'

export const PORTAL_PRIMARY_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition ${PORTAL_PRIMARY_COLORS}`
