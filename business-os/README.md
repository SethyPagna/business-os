# 🏢 Business OS — Local Business Management Platform

A fully offline, local-first desktop application for small and medium businesses.
Built with **Electron + React + SQLite**.

---

## ✨ Features

- 🛒 **Point of Sale (POS)** — Fast checkout with barcode/name search, cart, discounts, tax, change calculation
- 📦 **Product Management** — Full CRUD with image uploads (JPG, PNG, WEBP)
- 🏭 **Inventory Management** — Stock tracking, low stock alerts, stock value, manual adjustments
- 💰 **Sales History** — All transactions with receipt reprint support
- 🧾 **Receipt Generation** — Printable receipts with business branding, auto-numbered
- 🧱 **Custom Tables** — Build your own data tables (contacts, expenses, suppliers, etc.)
- 👥 **Users & Roles** — Role-based permissions, custom roles, multi-user support
- 📋 **Audit Log** — Every action logged with user, timestamp, and change details
- 💾 **Full Backup System** — One-click export/import of entire business data
- 🌍 **Bilingual** — English & Khmer (switch instantly in settings)
- 🌙 **Dark Mode** — Full dark/light mode support

---

## 🚀 Getting Started

### Prerequisites
- **Node.js 18+** — Download from https://nodejs.org
- **Git** (optional)

### Installation

```bash
# 1. Navigate to project folder
cd business-os

# 2. Install dependencies (takes 2-3 minutes first time)
npm install

# 3. Start the app
npm start
```

### First Login
- **Username:** `admin`
- **Password:** `admin123`

> ⚠️ Change the default password immediately after first login!

---

## 📁 Project Structure

```
business-os/
├── main.js              # Electron main process (IPC handlers, SQLite)
├── preload.js           # Secure IPC bridge
├── src/
│   ├── App.jsx          # Main app + routing
│   ├── AppContext.jsx    # Global state (auth, settings, language)
│   ├── components/
│   │   ├── Login.jsx
│   │   ├── Sidebar.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Products.jsx     # Product CRUD + image upload
│   │   ├── POS.jsx          # Point of Sale
│   │   ├── Receipt.jsx      # Receipt viewer + print
│   │   ├── Sales.jsx        # Sales history
│   │   ├── Inventory.jsx    # Stock management
│   │   ├── CustomTables.jsx # Dynamic table builder
│   │   ├── Users.jsx        # User & role management
│   │   └── Utils.jsx        # AuditLog, Backup, Settings
│   ├── lang/
│   │   ├── en.json          # English translations
│   │   └── km.json          # Khmer translations
│   └── styles/
│       └── main.css         # Tailwind + custom styles
├── package.json
├── vite.config.js
└── tailwind.config.js
```

---

## 🗄 Data Storage

All data is stored **locally** on your computer:
- **Database:** `%AppData%/business-os/business.db` (Windows) or `~/.config/business-os/business.db` (Linux/Mac)
- **Images:** `%AppData%/business-os/uploads/products/`
- **No internet required** — works completely offline

---

## 💾 Backup & Restore

1. Go to **Backup** in the sidebar
2. Click **Export Backup** — saves to a folder you choose
3. To restore: Click **Import Backup** → select the backup folder
4. The app will restart and restore all data + images

---

## 🔧 Building for Distribution

```bash
# Build installable .exe / .dmg / .AppImage
npm run build
# Output in: dist-electron/
```

---

## 📦 Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Framework | Electron 29 |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| Database | SQLite via better-sqlite3 |
| IPC | Electron contextBridge |

---

## 🛣 Roadmap (Future Enhancements)

- [ ] CSV import/export for products
- [ ] Barcode scanner hardware integration
- [ ] Multiple business locations
- [ ] Sales reports & charts
- [ ] Customer management module
- [ ] Expense tracking
- [ ] Database encryption
- [ ] More languages (Thai, Vietnamese, Chinese)
