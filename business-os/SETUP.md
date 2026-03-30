# 🛠 Setup Guide (Windows)

## The Problem
`better-sqlite3` is a native Node.js module. After `npm install`, it's compiled for
your system's Node.js version — but Electron uses its *own* Node.js version internally.
You must **rebuild** it specifically for Electron before the app will work.

---

## ✅ Step-by-Step Fix

Open a **Command Prompt** or **PowerShell** in the `business-os` folder, then run
these commands **in order**:

### Step 1 — Install packages
```
npm install
```

### Step 2 — Rebuild native modules for Electron ⬅ THIS IS THE KEY STEP
```
npm run rebuild
```
> This takes 1–2 minutes. You'll see compilation output. Wait for it to finish.

### Step 3 — Start the app
```
npm start
```

---

## What each command does

| Command | What it does |
|---------|-------------|
| `npm install` | Downloads all packages |
| `npm run rebuild` | Recompiles `better-sqlite3` specifically for Electron's Node version |
| `npm start` | Launches Vite (React) + Electron together |

---

## ❓ Troubleshooting

### "node-gyp" errors during rebuild
You need the Windows build tools. Run this **as Administrator**:
```
npm install --global --production windows-build-tools
```
Or install **Visual Studio Build Tools** from:
https://visualstudio.microsoft.com/visual-cpp-build-tools/

### App window doesn't open
Make sure you're running `npm start` from inside the `business-os` folder,
not from a parent directory.

### "electron not found"
Run `npm install` again, then retry.

---

## 🔁 You only need to rebuild once

After the first `npm run rebuild`, you can use `npm start` directly every time.
Only re-run `npm run rebuild` if you update Electron or better-sqlite3.
