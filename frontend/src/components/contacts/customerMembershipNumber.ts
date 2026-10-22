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
// The house format is the deployment's prefix plus a zero-padded number
// (`LC-00042` at Leang Cosmetics; the prefix comes from the client identity),
// and the sequence gap-fills -- a number freed by a deleted or merged customer
// is reused before the sequence grows. Neither of those is knowable from the
// browser, which is exactly why minting belongs on the server. What is left
// here is display and validation only.
import { getClientIdentity } from '../../app/clientIdentity.ts'

export const CUSTOMER_MEMBERSHIP_DIGITS = 5

/** Example shown in the input, never submitted. */
export function customerMembershipPlaceholder(prefix: string = getClientIdentity().membershipPrefix): string {
  return `${prefix}${'1'.padStart(CUSTOMER_MEMBERSHIP_DIGITS, '0')}`
}

/** Trims and upper-cases, the same normalisation the server stores. */
export function normalizeCustomerMembershipNumber(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

/** True when the value already carries the house format. */
export function isHouseCustomerMembershipNumber(value: unknown, prefix: string = getClientIdentity().membershipPrefix): boolean {
  const normalized = normalizeCustomerMembershipNumber(value)
  return normalized.startsWith(prefix) && /^\d+$/.test(normalized.slice(prefix.length))
}
