# Frontend Source Layout

The frontend is a Vite/React app.

- `src\app\` contains app-level shells and screens.
- `src\components\` contains reusable UI and feature components.
- `src\api\` contains API clients.
- `src\utils\` contains shared utilities such as import parsing, pagination, search, and history helpers.
- `src\lang\` contains first-party language resources.
- `dist\` is generated build output.

Do not install packages in the repository root. Frontend dependencies and `package-lock.json` live here.
