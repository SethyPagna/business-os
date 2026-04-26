# Services Folder Guide

Services isolate provider-specific logic from route files.

## How Services Run

Routes call service functions as dependency boundaries. The service owns provider configuration, API translation, and result normalization; the route owns authorization, persistence, and HTTP responses.

## Files

- `supabaseAuth.js`
  - Supabase Auth integration for email/password, provider login, provider linking, and admin-side ban state
  - keeps Supabase limited to identity concerns while local SQLite remains the app authority

- `firebaseAuth.js`
  - legacy Firebase Identity Toolkit integration kept for migration rollback/reference
  - no longer used by the active auth routes after the Supabase migration

- `verification.js`
  - one-time code issue/hash/store/verify/consume lifecycle
  - delivery abstraction for Resend / SendGrid / webhooks
  - capability reporting for email/SMS availability

## Service Rules

1. Return stable result objects for expected provider failures.
2. Throw only for truly exceptional failures.
3. Keep secrets in `.env` or release env files, never in frontend code.
