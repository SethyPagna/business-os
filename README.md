# Business OS

Business OS is meant to run like a normal Windows business app.

## Everyday Use

1. Run `run\setup.bat` once on a new laptop.
2. Run `run\start-server.bat` whenever you want to open the app.
3. Open the local URL printed by the start window, usually `http://localhost:4000`.
4. Use `https://admin.leangcosmetics.dpdns.org` for staff/admin access once the admin hostname is added in Cloudflare.
5. Use `https://leangcosmetics.dpdns.org/public` for the public customer portal.
6. Run `run\stop-server.bat` to stop the app.

That is the normal workflow. You do not need to run Redis, Postgres, MinIO, Docker Compose, or import workers by hand.

If the start window says the public URL check failed, the app still started locally, but Cloudflare Tunnel is not connected to the custom domain yet. Check the tunnel token file and Cloudflare tunnel health before using public devices.

Cloudflare setup details are in `ops\docs\cloudflare-ready-setup.md`.

## What Setup Does

`run\setup.bat` checks for Node.js, Docker Desktop, Git, and OpenSSL. When Windows allows it, missing tools are installed with `winget`. If Windows needs administrator approval or a restart, the script tells you what to do and stops clearly.

Docker Desktop is required because Business OS uses Redis, Postgres, and MinIO for large imports and future scale features. The live business database still stays local SQLite until an admin explicitly runs the in-app migration wizard.

## Data Safety

Your business data remains on this computer by default:

`business-os-data\organizations\<organization-id> (<business-name>)\`

Backups, uploaded files, imports, and the SQLite database live under that organization folder. The app does not silently switch your live data to Postgres or MinIO.

In Settings > Backup, the Data migration panel has a one-button safety step. It automatically creates a local safety backup beside `business-os-data`, then syncs the same live data to Google Drive when Drive is connected. No live data is moved during that step, and the app keeps using SQLite/local files until the verified migration runner is enabled and explicitly confirmed.

## Support Commands

Only use these if support asks:

- `run\scale-services.bat status`
- `run\scale-services.bat logs`
- `run\stop-server.bat --with-services`

Technical notes are in `ops\readme\README.md`.
