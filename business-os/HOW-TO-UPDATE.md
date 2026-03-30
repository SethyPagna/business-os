# How to Update Your Business OS

## ⚡ Quick Fix (2 steps)

### Step 1 — Run the database patch (fixes the sales/column crash)
Open a terminal in your project folder and run:
```
node fix-database.js
```
You should see checkmarks for each column added. This is safe — it never deletes data.

### Step 2 — Replace these files from this zip into your project folder:
Copy these files, overwriting your existing ones:

```
main.js                              ← fixes crash + all new features
preload.js                           ← new API methods
fix-database.js                      ← one-time DB patch (already ran above)
src/AppContext.jsx                   ← dual currency, precise math
src/lang/en.json                     ← full translations
src/lang/km.json                     ← full Khmer translations
src/components/POS.jsx               ← free-text payment, mixed USD+KHR
src/components/Products.jsx          ← multi-search, no rounding
src/components/Inventory.jsx         ← dual currency, cost in/out, profit
src/components/Users.jsx             ← working roles with delete + permissions
src/components/Sales.jsx             ← dual currency, multi-search
src/components/Dashboard.jsx         ← dual currency
src/components/Receipt.jsx           ← dual currency receipts
src/components/Utils.jsx             ← settings, backup, audit
src/components/Sidebar.jsx           ← removed Custom Tables tab
```

### Step 3 — Restart
```
npm start
```

## What was fixed
| Issue | Fix |
|-------|-----|
| `no such column: total_usd` crash | Migration adds columns to existing DB |
| Roles not saving / can't delete | Full rewrite of role editor + backend |
| POS payment type fixed | Free-text + preset buttons |
| USD+KHR mixed payment | Single amount-paid section with both fields |
| Rounding on KHR prices | Removed all Math.round from calculations |
| Search only "all" | Multi-word search everywhere (type "red shirt" to find both words) |
| Inventory USD-only | All columns show USD + KHR |
| Products missing Cost In | Now visible in Inventory → Products tab |
