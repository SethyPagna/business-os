# Business OS Supabase Auth Setup

This project now treats Supabase as the external identity provider only.

Business OS keeps:
- local SQLite users, roles, permissions, audit history, inventory, sales, and settings
- admin-created users as the only way accounts begin
- local OTP/TOTP 2FA for the app session

Supabase now handles:
- email/password identity sync
- Google login
- Facebook login
- magic-link / email-auth readiness on the Supabase side
- password/provider state for linked accounts

## Final architecture

1. Admin creates users inside Business OS.
2. Local `users` remains the authority for active/disabled/deleted status.
3. When a local user has an email address, the backend can provision a matching Supabase auth user.
4. Google and Facebook sign-in are allowed only when the provider email matches the local account email.
5. If a local user is disabled or deleted, Business OS blocks access locally and also bans the linked Supabase auth user.

## Organization-aware login

The current app now has an organization/group foundation.

Right now this server still runs one default organization:
- `LeangCosmetics`

Users sign in against that organization context, and the public portal path is now shaped for future scale-up:
- `/<organization>/public`

For a future centralized rollout, keep Supabase redirect URLs broad enough to include:
- the root host
- the organization admin path you actively use
- localhost development

See [README-organization-versions.md](C:/Users/mrkl6/Downloads/business-os/ops/readme/README-organization-versions.md) for the v1/v2/v3 deployment profiles.

## Important design decision

Supabase does not provide native username-first auth the same way Business OS does.

Because your app requires this flow:
- admin creates `james`
- admin gives `james` a preset password
- `james` logs in immediately
- `james` later adds email / Google / Facebook / OTP

Business OS keeps the bootstrap username/password flow locally, then layers Supabase identities on top.

That preserves your product logic cleanly without forcing fake email addresses or breaking admin-owned user creation.

## Required backend env values

Edit [backend/.env](C:/Users/mrkl6/Downloads/business-os/backend/.env):

```env
SUPABASE_AUTH_ENABLED=true
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
SUPABASE_EMAIL_AUTH_ENABLED=true
SUPABASE_MAGIC_LINK_ENABLED=true
SUPABASE_INVITE_ENABLED=true
SUPABASE_GOOGLE_OAUTH_ENABLED=true
SUPABASE_FACEBOOK_OAUTH_ENABLED=true
SUPABASE_MFA_TOTP_ENABLED=false
```

Notes:
- `SUPABASE_ANON_KEY` is used only for public auth verification calls.
- `SUPABASE_SERVICE_ROLE_KEY` must stay on the backend only.
- The Google/Facebook `*_ENABLED` flags are app-side switches. Turn them on after the provider is configured in Supabase.

## Supabase dashboard setup

### 1. Project basics

1. Open your Supabase project.
2. Copy:
   - Project URL
   - publishable/anon key
   - service role key
3. Put those into [backend/.env](C:/Users/mrkl6/Downloads/business-os/backend/.env).

### 2. Site URL and redirect URLs

In `Authentication -> URL Configuration`:

1. Set `Site URL` to the main URL you actually use to open Business OS.
2. Add redirect URLs for every real entry point you use, for example:
   - `http://localhost:4000`
   - `http://127.0.0.1:4000`
   - your Tailscale / tunnel URL

The app sends users back to the current Business OS page with:
- `?auth_mode=login&auth_provider=google`
- `?auth_mode=link&auth_provider=facebook`

So the base origin must be allowed in Supabase.

### 3. Run the SQL

Run [001-auth-only-setup.sql](C:/Users/mrkl6/Downloads/business-os/ops/config/supabase/001-auth-only-setup.sql) in the Supabase SQL Editor.

This creates:
- `public.business_os_profiles`
- a trigger from `auth.users`
- RLS policies so authenticated users can read/update only their own mirrored auth profile

Business data is still not stored in Supabase.

### Should you use the made policies?

Yes. Use the SQL file we made and paste/run it in the Supabase SQL Editor for your project.

That is the correct place for the policies, trigger, indexes, and grants because Supabase RLS lives in Postgres, not in the app UI code.

For this architecture:
- Business OS local SQLite enforces admin/user permissions and account lifecycle.
- Supabase policies only protect the lightweight `public.business_os_profiles` mirror table.
- Do not try to move your full app role system into Supabase RLS unless you also move the full business data model there.

In short:
1. run the SQL in Supabase
2. keep Business OS as the source of truth for roles and disabling/deleting users
3. let the backend service-role calls manage Supabase auth users

This separation is simpler, faster, and safer for your current product design.

## Google setup

Use the official Supabase Google provider flow:
- https://supabase.com/docs/guides/auth/social-login/auth-google

Your Supabase callback URL is:

`https://jaqabakntgtgregtxotu.supabase.co/auth/v1/callback`

In Google Cloud / Google Auth Platform:

1. Create or open the Google project for this app.
2. Create a `Web application` OAuth client.
3. Add authorized JavaScript origins for each real app origin:
   - local backend origin
   - local 127.0.0.1 origin
   - production/tunnel origin
4. Add the Supabase callback URL exactly:
   - `https://jaqabakntgtgregtxotu.supabase.co/auth/v1/callback`
5. Copy the Google client ID and client secret into the Supabase Google provider screen.
6. Save the provider in Supabase.
7. Set `SUPABASE_GOOGLE_OAUTH_ENABLED=true` in [backend/.env](C:/Users/mrkl6/Downloads/business-os/backend/.env).

## Facebook Meta setup

Use the official Supabase Facebook provider flow:
- https://supabase.com/docs/guides/auth/social-login/auth-facebook

Your Supabase callback URL is:

`https://jaqabakntgtgregtxotu.supabase.co/auth/v1/callback`

In Facebook Developers / Meta:

1. Create or open the Facebook app.
2. Add the login/authentication use case.
3. Make sure `email` and `public_profile` permissions are enabled for testing.
4. Add the Supabase callback URL where Facebook login requires it.
5. Copy the Facebook app ID and app secret into the Supabase Facebook provider screen.
6. Save the provider in Supabase.
7. Add test users/roles while the Facebook app is still in development mode.
8. Set `SUPABASE_FACEBOOK_OAUTH_ENABLED=true` in [backend/.env](C:/Users/mrkl6/Downloads/business-os/backend/.env).

## Email auth setup

Supabase email auth docs:
- https://supabase.com/docs/guides/auth/auth-email-passwordless

Recommended dashboard setup:

1. `Authentication -> Providers -> Email`
2. Keep email auth enabled.
3. Enable:
   - confirm signup
   - reset password
   - change email confirmation
   - reauthentication for sensitive actions
4. Configure SMTP if you want branded email delivery instead of the default sender.
5. Update email templates for:
   - confirm signup
   - magic link / OTP
   - reset password
   - password changed
   - email changed
   - identity linked
   - identity unlinked
   - MFA method added / removed

### Recommendation for this app

Use Supabase as the email delivery and provider system, but keep the Business OS local recovery and OTP flow active until you fully switch your user-facing reset screens to Supabase-hosted links.

That is the lowest-risk path for your current admin-created-user model.

## What is already automated in code

The current code now:

1. syncs local users with Supabase when email/password changes happen
2. bans linked Supabase users when local accounts are disabled/deleted
3. supports Google/Facebook OAuth start and completion
4. only allows provider login when a local active account exists
5. only links social identities when the provider email matches the local account email
6. exposes auth-method status in the profile modal

## What still requires manual dashboard setup

You still need to do these yourself because they live outside the repo:

1. create/configure the Supabase project
2. paste provider secrets into the Supabase dashboard
3. configure Google OAuth app origins and redirect URI
4. configure Facebook/Meta app, roles, email permission, and any review/live-mode requirements
5. paste the Supabase anon and service role keys into [backend/.env](C:/Users/mrkl6/Downloads/business-os/backend/.env)

## Suggested rollout order

1. Fill in Supabase env keys.
2. Run the SQL file.
3. Configure Google in Supabase and Google Cloud.
4. Configure Facebook in Supabase and Meta.
5. Turn on the `SUPABASE_*_ENABLED` flags.
6. Restart the backend.
7. Test in this order:
   - admin local login
   - create a non-admin user with email + password
   - password login by username
   - password login by email
   - verify email
   - connect Google
   - connect Facebook
   - disable user and confirm provider login is blocked
