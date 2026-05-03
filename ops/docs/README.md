# Ops Docs

Use `Start Business OS.bat` for normal startup. Use `run\docker\doctor.bat` for support diagnostics.

The supported release is a local portable Docker folder with `images\business-os-image.tar`. Distribution is by local copy, USB, or Google Drive sync of the full `release\business-os` folder.

Release branches should update these docs when backend routes, Docker runtime behavior, import processing, backup diagnostics, permissions, audit retention, or receipt rendering changes. Verification evidence should include backend tests, frontend tests/build, frontend UI/i18n/performance checks, backend integrity checks, Docker doctor, and health checks for both local and public admin URLs.
