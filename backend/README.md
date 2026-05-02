# Backend Source Layout

The backend is an Express runtime plus background workers.

- `server.js` is the HTTP entrypoint.
- `src\routes\` contains API route modules.
- `src\services\` contains domain services for imports, uploads, media, history, storage, and sync.
- `src\workers\` contains background worker entrypoints for import and media jobs.
- `src\storage\` and `src\dataPath\` resolve local data paths.
- `frontend-dist\` is generated build output copied from the frontend.

Do not install packages in the repository root. Backend dependencies and `package-lock.json` live here.
