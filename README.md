# Business OS

Business OS is meant to run like a normal Windows business app.

## Everyday Use

1. Run `setup.bat` once on a new laptop.
2. Run `start-server.bat` whenever you want to open the app.
3. Open the local URL printed by the start window, usually `http://localhost:4000`.
4. Use the printed customer URL for phones or other devices when Tailscale Funnel is available.
5. Run `stop-server.bat` to stop the app.

That is the normal workflow. You do not need to run Redis, Postgres, MinIO, Docker Compose, or import workers by hand.

If the start window says the public URL check failed, the app still started locally, but Tailscale has not provided a public Funnel ingress for that hostname yet. Devices signed into the same tailnet may still work; public internet devices need Funnel enabled in the Tailscale account.

## What Setup Does

`setup.bat` checks for Node.js, Docker Desktop, Tailscale, Git, and OpenSSL. When Windows allows it, missing tools are installed with `winget`. If Windows needs administrator approval or a restart, the script tells you what to do and stops clearly.

Docker Desktop is required because Business OS uses Redis, Postgres, and MinIO for large imports and future scale features. The live business database still stays local SQLite until an admin explicitly runs the in-app migration wizard.

## Data Safety

Your business data remains on this computer by default:

`business-os-data\organizations\<organization-id> (<business-name>)\`

Backups, uploaded files, imports, and the SQLite database live under that organization folder. The app does not silently move data to Postgres or MinIO. In Settings > Backup, the Data migration panel shows the current storage status and only allows migration after a verified precheck.

## Support Commands

Only use these if support asks:

- `ops\run\bat\scale-services.bat status`
- `ops\run\bat\scale-services.bat logs`
- `stop-server.bat --with-services`

Technical notes are in `ops\readme\README.md`.
