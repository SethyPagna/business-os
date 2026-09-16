// Membership numbers are minted by the SERVER (cloudflare/src/lib/
// membershipNumber.ts), never composed in the browser.
//
// This file used to export generateCustomerMembershipNumber(), which invented
// a random `LCMN-XXXXXXXX` in the Add Customer form and pre-filled the field
// with it. That made the browser a fourth independent minter on a column three
// server paths were already minting for -- and, worse, it defeated the house
// sequence entirely: the create route only mints when the submitted number is
// blank, so a pre-filled random value always won.
//
// The house format is `LC-#####` (Leang Cosmetic), zero-padded, and the
// sequence gap-fills -- a number freed by a deleted or merged customer is
// reused before the sequence grows. Neither of those is knowable from the
// browser, which is exactly why minting belongs on the server. What is left
// here is display and validation only.

export const CUSTOMER_MEMBERSHIP_PREFIX = 'LC'
export const CUSTOMER_MEMBERSHIP_DIGITS = 5
/** Example shown in the input, never submitted. */
export const CUSTOMER_MEMBERSHIP_PLACEHOLDER = 'LC-00001'

const MEMBERSHIP_PATTERN = /^LC-\d+$/

/** Trims and upper-cases, the same normalisation the server stores. */
export function normalizeCustomerMembershipNumber(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

/** True when the value already carries the house format. */
export function isHouseCustomerMembershipNumber(value: unknown): boolean {
  return MEMBERSHIP_PATTERN.test(normalizeCustomerMembershipNumber(value))
}
