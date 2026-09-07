# Public portal policy and publication readiness

This implementation provides bilingual English and Khmer privacy, terms, cookie, consent, and accessibility surfaces for the public catalogue. It is an implementation record, not legal advice or a claim of universal legal compliance.

## Confirmed seller details

The read-only production settings check on 7 September 2026 confirmed the trade name **Leang Cosmetics**, address **136 St 215, Phnom Penh**, and phone **017 611 168**. The business email is blank. No verified registered legal name or registration number was found in the queried settings. The trade name is not substituted for a registered identity.

Catalogue browsing remains available while those details are incomplete and shows a visible readiness warning. AI requests and customer screenshot submissions fail closed while publication readiness is incomplete. Before public release, the operator must verify and enter the registered name, registration number, address, phone, and email, confirm the target markets, and obtain qualified legal review appropriate to those markets.

## Data and consent behavior

- Account creation and sign-in require an unticked Terms and Privacy consent checkbox. The server records policy version, timestamp, and locale and refuses the write if migration 0130 is absent.
- Screenshot submissions require a signed-in account plus separate rights and privacy consent. The server resolves the CRM customer from the session, ignores any submitted membership number, records both consent versions, and refuses success until the row persists. Customer screenshots stay in private R2 storage and do not enter the shared Cloudinary-capable image pipeline.
- AI requests require an explicit data-use checkbox before each request flow. The notice names the configured provider and says processing may occur outside Cambodia. Questions and optional shopping preferences are sent only after that choice.
- Google Maps remains blocked until the visitor chooses to load it. External translation options disclose that page text goes to Google Translate and Google may set cookies before the visitor selects one.
- Required and requested browser storage is listed in the Cookie Policy, including the session cookie, app-managed local/session storage, and service-worker Cache Storage. The page does not claim that one banner rule applies in every country.

## Collection, retention, and third parties

Browsing requires no account. Abuse controls store HMAC-derived identifiers and fail closed without a strong `PORTAL_ABUSE_HMAC_SECRET`; raw IP addresses and phone numbers are not retained in those records. Migration 0131 clears legacy raw portal-session IP/user-agent fields and legacy unsalted portal abuse rows.

Expired rate-limit and inactive sign-in-protection rows are removed after about one day. AI logs are removed after about 30 days. Reviewed screenshot images are removed after about 90 days while the reviewed points row may remain; unreviewed submissions and images are removed after about 180 days. Sessions can last up to 399 days and are removed after expiry or revocation. Account and membership records remain until the business resolves a verified request or must retain them for an operational or legal reason.

Cloudflare hosts the Worker, D1 data, R2 images, and security infrastructure. Minimized error reports may be sent to the configured Sentry project; Sentry applies its configured event retention. Product images may use Cloudinary. Google receives map or translation requests only after the visitor chooses those features. The configured AI provider receives an assistant request only after the visitor confirms its notice. Social links open the selected external service under that service's own policy.

## Prepared release prerequisites

Migrations 0130 and 0131 are append-only prepared files only. Production was verified at migration 0127; 0128, 0129, 0130, and 0131 were not applied. After explicit production authorization, apply pending migrations in order, provision a strong `PORTAL_ABUSE_HMAC_SECRET`, persist the verified seller identity fields, verify the AI provider disclosure and retention, merge the exact language-pack delta, and run authenticated mobile/keyboard/browser checks on the integrated build. No migration, secret write, deployment, or remote database write was performed in this slice.
