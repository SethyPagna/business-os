const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'business.db')
const uploadsPath = path.join(userDataPath, 'uploads')
const receiptsPath = path.join(userDataPath, 'receipts')
;[uploadsPath, path.join(uploadsPath, 'products'), receiptsPath].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
})

let db, mainWindow

function addCol(table, col, typedef) {
  try {
    const exists = db.prepare(`PRAGMA table_info("${table}")`).all().some(c => c.name === col)
    if (!exists) { db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col} ${typedef}`); console.log(`[migrate] + ${table}.${col}`) }
  } catch(e) { console.error(`[migrate] failed ${table}.${col}:`, e.message) }
}

function initDatabase() {
  const Database = require('better-sqlite3')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      role_id INTEGER, is_primary INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '{}', is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, location TEXT DEFAULT '', phone TEXT DEFAULT '',
      manager TEXT DEFAULT '', notes TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1, is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#3b82f6', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_custom_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      field_type TEXT DEFAULT 'text', options TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      sku TEXT UNIQUE, barcode TEXT, category TEXT, description TEXT,
      purchase_price_usd REAL DEFAULT 0, purchase_price_khr REAL DEFAULT 0,
      cost_price_usd REAL DEFAULT 0, cost_price_khr REAL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0, selling_price_khr REAL DEFAULT 0,
      stock_quantity REAL DEFAULT 0,
      low_stock_threshold REAL DEFAULT 10, out_of_stock_threshold REAL DEFAULT 0,
      unit TEXT DEFAULT 'pcs', supplier TEXT, image_path TEXT,
      custom_fields TEXT DEFAULT '{}', is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_branch_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
      quantity REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, branch_id)
    );

    CREATE TABLE IF NOT EXISTS stock_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_branch_id INTEGER, to_branch_id INTEGER,
      product_id INTEGER NOT NULL, product_name TEXT,
      quantity REAL NOT NULL, note TEXT,
      user_id INTEGER, user_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT UNIQUE NOT NULL,
      cashier_id INTEGER, cashier_name TEXT, branch_id INTEGER,
      items TEXT NOT NULL DEFAULT '[]',
      subtotal_usd REAL DEFAULT 0, subtotal_khr REAL DEFAULT 0,
      discount_usd REAL DEFAULT 0, discount_khr REAL DEFAULT 0,
      tax_usd REAL DEFAULT 0, tax_khr REAL DEFAULT 0,
      total_usd REAL DEFAULT 0, total_khr REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash', payment_currency TEXT DEFAULT 'USD',
      amount_paid_usd REAL DEFAULT 0, amount_paid_khr REAL DEFAULT 0,
      change_usd REAL DEFAULT 0, change_khr REAL DEFAULT 0,
      exchange_rate REAL DEFAULT 4100, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT,
      movement_type TEXT NOT NULL, quantity REAL NOT NULL,
      unit_cost_usd REAL DEFAULT 0, unit_cost_khr REAL DEFAULT 0,
      total_cost_usd REAL DEFAULT 0, total_cost_khr REAL DEFAULT 0,
      sale_id INTEGER, branch_id INTEGER, reason TEXT,
      user_id INTEGER, user_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, user_name TEXT,
      action TEXT NOT NULL, table_name TEXT, record_id INTEGER,
      old_value TEXT, new_value TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
      company TEXT, notes TEXT, is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
      company TEXT, contact_person TEXT, notes TEXT, is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // ── Migrations ──────────────────────────────────────────────────────────────
  addCol('products','purchase_price_usd','REAL DEFAULT 0')
  addCol('products','purchase_price_khr','REAL DEFAULT 0')
  addCol('products','cost_price_usd','REAL DEFAULT 0')
  addCol('products','cost_price_khr','REAL DEFAULT 0')
  addCol('products','selling_price_usd','REAL DEFAULT 0')
  addCol('products','selling_price_khr','REAL DEFAULT 0')
  addCol('products','low_stock_threshold','REAL DEFAULT 10')
  addCol('products','out_of_stock_threshold','REAL DEFAULT 0')
  addCol('products','custom_fields',"TEXT DEFAULT '{}'")

  const pCols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name)
  if (pCols.includes('cost_price')) {
    try {
      db.exec(`UPDATE products SET purchase_price_usd=COALESCE(cost_price,0), cost_price_usd=COALESCE(cost_price,0) WHERE COALESCE(cost_price,0)>0 AND purchase_price_usd=0`)
      db.exec(`UPDATE products SET selling_price_usd=COALESCE(selling_price,0) WHERE COALESCE(selling_price,0)>0 AND selling_price_usd=0`)
    } catch(e) {}
  }

  addCol('sales','branch_id','INTEGER')
  addCol('sales','subtotal_usd','REAL DEFAULT 0')
  addCol('sales','subtotal_khr','REAL DEFAULT 0')
  addCol('sales','discount_usd','REAL DEFAULT 0')
  addCol('sales','discount_khr','REAL DEFAULT 0')
  addCol('sales','tax_usd','REAL DEFAULT 0')
  addCol('sales','tax_khr','REAL DEFAULT 0')
  addCol('sales','total_usd','REAL DEFAULT 0')
  addCol('sales','total_khr','REAL DEFAULT 0')
  addCol('sales','payment_currency',"TEXT DEFAULT 'USD'")
  addCol('sales','amount_paid_usd','REAL DEFAULT 0')
  addCol('sales','amount_paid_khr','REAL DEFAULT 0')
  addCol('sales','change_usd','REAL DEFAULT 0')
  addCol('sales','change_khr','REAL DEFAULT 0')
  addCol('sales','exchange_rate','REAL DEFAULT 4100')

  const sCols = db.prepare('PRAGMA table_info(sales)').all().map(c => c.name)
  if (sCols.includes('total') && sCols.includes('total_usd')) {
    try {
      db.exec(`UPDATE sales SET total_usd=COALESCE(total,0) WHERE total_usd=0 AND COALESCE(total,0)>0`)
      db.exec(`UPDATE sales SET subtotal_usd=COALESCE(subtotal,0) WHERE subtotal_usd=0 AND COALESCE(subtotal,0)>0`)
    } catch(e) {}
  }

  addCol('stock_movements','unit_cost_usd','REAL DEFAULT 0')
  addCol('stock_movements','unit_cost_khr','REAL DEFAULT 0')
  addCol('stock_movements','total_cost_usd','REAL DEFAULT 0')
  addCol('stock_movements','total_cost_khr','REAL DEFAULT 0')
  addCol('stock_movements','sale_id','INTEGER')
  addCol('stock_movements','branch_id','INTEGER')
  // Customer info on sales
  addCol('sales','customer_name','TEXT')
  addCol('sales','customer_phone','TEXT')
  addCol('sales','customer_address','TEXT')

  // ── Seed defaults ───────────────────────────────────────────────────────────
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get()
  if (userCount.c === 0) {
    const roles = [
      { name:'Administrator', permissions:JSON.stringify({all:true}), is_system:1 },
      { name:'Inventory Manager', permissions:JSON.stringify({products:true,inventory:true}), is_system:1 },
      { name:'Sales Operator', permissions:JSON.stringify({pos:true}), is_system:1 },
      { name:'Viewer', permissions:JSON.stringify({view_only:true}), is_system:1 }
    ]
    const insRole = db.prepare('INSERT INTO roles (name,permissions,is_system) VALUES (?,?,?)')
    roles.forEach(r => insRole.run(r.name, r.permissions, r.is_system))
    db.prepare('INSERT INTO users (name,username,password,role_id,is_primary) VALUES (?,?,?,?,?)').run('Admin','admin','admin123',1,1)
    const defaults = {
      business_name:'My Business', business_address:'', business_phone:'',
      business_email:'', tax_id:'', currency_usd_symbol:'$', currency_khr_symbol:'៛',
      exchange_rate:'4100', display_currency:'USD', tax_rate:'0',
      receipt_footer:'Thank you for your business!', receipt_template:'',
      language:'en', theme:'light', receipt_counter:'1000'
    }
    const ins = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)')
    Object.entries(defaults).forEach(([k,v]) => ins.run(k,v))
    const cats = ['Electronics','Food & Beverage','Clothing','Health & Beauty','Home & Garden','Office Supplies','Other']
    cats.forEach(c => db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)').run(c))
    const units = ['pcs','kg','g','L','mL','box','pack','pair','set','dozen','m','cm']
    units.forEach(u => db.prepare('INSERT OR IGNORE INTO product_units (name) VALUES (?)').run(u))
    // Seed a default branch
    db.prepare('INSERT INTO branches (name,location,is_default) VALUES (?,?,1)').run('Main Store','')
  } else {
    const newSettings = { currency_usd_symbol:'$', currency_khr_symbol:'៛', exchange_rate:'4100', display_currency:'USD', receipt_template:'' }
    const ins2 = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)')
    Object.entries(newSettings).forEach(([k,v]) => ins2.run(k,v))
    // Ensure at least one branch exists
    const bc = db.prepare('SELECT COUNT(*) as c FROM branches').get()
    if (bc.c === 0) db.prepare('INSERT INTO branches (name,location,is_default,is_active) VALUES (?,?,1,1)').run('Main Store','')
  }
  console.log('[DB] Ready')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:1400, height:900, minWidth:1024, minHeight:700,
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, webSecurity:!isDev },
    frame:true, show:false, backgroundColor:'#ffffff'
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })
  // Restore focus to renderer after any dialog closes (fixes input not working bug)
  mainWindow.on('focus', () => {
    mainWindow.webContents.focus()
  })
  isDev ? mainWindow.loadURL('http://localhost:5173') : mainWindow.loadFile(path.join(__dirname,'dist','index.html'))
}

app.whenReady().then(() => { initDatabase(); createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

function auditLog(userId, userName, action, table, id, oldV, newV) {
  try { db.prepare('INSERT INTO audit_logs (user_id,user_name,action,table_name,record_id,old_value,new_value) VALUES (?,?,?,?,?,?,?)').run(userId, userName, action, table, id, oldV?JSON.stringify(oldV):null, newV?JSON.stringify(newV):null) } catch(e) {}
}

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
ipcMain.handle('auth:login', (_, {username,password}) => {
  const u = db.prepare('SELECT u.*, r.name as role_name, r.permissions FROM users u LEFT JOIN roles r ON u.role_id=r.id WHERE u.username=? AND u.password=? AND u.is_active=1').get(username, password)
  if (!u) return {success:false, error:'Invalid credentials'}
  const {password:pw, ...safe} = u
  return {success:true, user:safe}
})

// ════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════
ipcMain.handle('settings:get', () => Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r => [r.key, r.value])))
ipcMain.handle('settings:set', (_, s) => {
  const u = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')
  db.transaction(() => Object.entries(s).forEach(([k,v]) => u.run(k,String(v))))()
  return {success:true}
})

// ════════════════════════════════════════════════════════
// BRANCHES
// ════════════════════════════════════════════════════════
ipcMain.handle('branches:getAll', () => db.prepare('SELECT * FROM branches ORDER BY is_default DESC, name').all())

ipcMain.handle('branches:create', (_, d) => {
  const r = db.prepare('INSERT INTO branches (name,location,phone,manager,notes,is_default) VALUES (?,?,?,?,?,?)').run(
    d.name, d.location||'', d.phone||'', d.manager||'', d.notes||'', d.is_default?1:0
  )
  if (d.is_default) db.prepare('UPDATE branches SET is_default=0 WHERE id!=?').run(r.lastInsertRowid)
  // Auto-create stock entries for all existing products
  const products = db.prepare('SELECT id FROM products WHERE is_active=1').all()
  const ins = db.prepare('INSERT OR IGNORE INTO product_branch_stock (product_id,branch_id,quantity) VALUES (?,?,0)')
  products.forEach(p => ins.run(p.id, r.lastInsertRowid))
  return {success:true, id:r.lastInsertRowid}
})

ipcMain.handle('branches:update', (_, {id, data}) => {
  db.prepare('UPDATE branches SET name=?,location=?,phone=?,manager=?,notes=?,is_active=? WHERE id=?').run(
    data.name, data.location||'', data.phone||'', data.manager||'', data.notes||'', data.is_active?1:0, id
  )
  if (data.is_default) {
    db.prepare('UPDATE branches SET is_default=0').run()
    db.prepare('UPDATE branches SET is_default=1 WHERE id=?').run(id)
  }
  return {success:true}
})

ipcMain.handle('branches:delete', (_, id) => {
  const def = db.prepare('SELECT is_default FROM branches WHERE id=?').get(id)
  if (def?.is_default) return {success:false, error:'Cannot delete the default branch'}
  const stock = db.prepare('SELECT SUM(quantity) as s FROM product_branch_stock WHERE branch_id=?').get(id)
  if ((stock?.s||0) > 0) return {success:false, error:'Branch still has stock. Transfer all items first.'}
  db.prepare('DELETE FROM product_branch_stock WHERE branch_id=?').run(id)
  db.prepare('UPDATE branches SET is_active=0 WHERE id=?').run(id)
  return {success:true}
})

ipcMain.handle('branches:getStock', (_, branchId) => {
  return db.prepare(`
    SELECT p.id, p.name, p.sku, p.unit, p.image_path,
           p.selling_price_usd, p.selling_price_khr,
           p.purchase_price_usd, p.purchase_price_khr,
           p.low_stock_threshold, p.out_of_stock_threshold,
           COALESCE(pbs.quantity,0) as branch_quantity
    FROM products p
    LEFT JOIN product_branch_stock pbs ON p.id=pbs.product_id AND pbs.branch_id=?
    WHERE p.is_active=1 ORDER BY p.name
  `).all(branchId)
})

ipcMain.handle('branches:transfer', (_, {fromBranchId, toBranchId, productId, productName, quantity, note, userId, userName}) => {
  const qty = parseFloat(quantity)
  if (qty <= 0) return {success:false, error:'Quantity must be positive'}

  // Check source has enough
  if (fromBranchId) {
    const src = db.prepare('SELECT quantity FROM product_branch_stock WHERE product_id=? AND branch_id=?').get(productId, fromBranchId)
    if (!src || src.quantity < qty) return {success:false, error:`Not enough stock in source branch (have ${src?.quantity||0})`}
    db.prepare('UPDATE product_branch_stock SET quantity=quantity-?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND branch_id=?').run(qty, productId, fromBranchId)
  }

  // Add to destination
  db.prepare('INSERT OR IGNORE INTO product_branch_stock (product_id,branch_id,quantity) VALUES (?,?,0)').run(productId, toBranchId)
  db.prepare('UPDATE product_branch_stock SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND branch_id=?').run(qty, productId, toBranchId)

  // Record transfer
  db.prepare('INSERT INTO stock_transfers (from_branch_id,to_branch_id,product_id,product_name,quantity,note,user_id,user_name) VALUES (?,?,?,?,?,?,?,?)').run(
    fromBranchId||null, toBranchId, productId, productName, qty, note||'', userId, userName
  )
  auditLog(userId, userName, 'TRANSFER', 'product_branch_stock', productId, {from:fromBranchId,qty}, {to:toBranchId})
  return {success:true}
})

ipcMain.handle('branches:getTransfers', (_, {productId}={}) => {
  let q = `SELECT t.*, bf.name as from_name, bt.name as to_name 
           FROM stock_transfers t 
           LEFT JOIN branches bf ON t.from_branch_id=bf.id 
           LEFT JOIN branches bt ON t.to_branch_id=bt.id`
  if (productId) q += ' WHERE t.product_id=?'
  q += ' ORDER BY t.created_at DESC LIMIT 200'
  return productId ? db.prepare(q).all(productId) : db.prepare(q).all()
})

// ════════════════════════════════════════════════════════
// CATEGORIES / UNITS / CUSTOM FIELDS
// ════════════════════════════════════════════════════════
ipcMain.handle('categories:getAll', () => db.prepare('SELECT * FROM product_categories ORDER BY name').all())
ipcMain.handle('categories:create', (_, {name,color}) => { const r=db.prepare('INSERT INTO product_categories (name,color) VALUES (?,?)').run(name,color||'#3b82f6'); return {success:true,id:r.lastInsertRowid} })
ipcMain.handle('categories:update', (_, {id,name,color}) => { db.prepare('UPDATE product_categories SET name=?,color=? WHERE id=?').run(name,color,id); return {success:true} })
ipcMain.handle('categories:delete', (_, id) => { db.prepare('DELETE FROM product_categories WHERE id=?').run(id); return {success:true} })

ipcMain.handle('units:getAll', () => db.prepare('SELECT * FROM product_units ORDER BY name').all())
ipcMain.handle('units:create', (_, name) => { const r=db.prepare('INSERT INTO product_units (name) VALUES (?)').run(name); return {success:true,id:r.lastInsertRowid} })
ipcMain.handle('units:delete', (_, id) => { db.prepare('DELETE FROM product_units WHERE id=?').run(id); return {success:true} })

ipcMain.handle('customFields:getAll', () => db.prepare('SELECT * FROM product_custom_fields ORDER BY sort_order,name').all())
ipcMain.handle('customFields:create', (_, d) => { const r=db.prepare('INSERT INTO product_custom_fields (name,field_type,options,sort_order) VALUES (?,?,?,?)').run(d.name,d.field_type||'text',JSON.stringify(d.options||[]),d.sort_order||0); return {success:true,id:r.lastInsertRowid} })
ipcMain.handle('customFields:update', (_, {id,data}) => { db.prepare('UPDATE product_custom_fields SET name=?,field_type=?,options=?,sort_order=? WHERE id=?').run(data.name,data.field_type,JSON.stringify(data.options||[]),data.sort_order||0,id); return {success:true} })
ipcMain.handle('customFields:delete', (_, id) => { db.prepare('DELETE FROM product_custom_fields WHERE id=?').run(id); return {success:true} })

// ════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════
ipcMain.handle('products:getAll', () => {
  const products = db.prepare('SELECT * FROM products WHERE is_active=1 ORDER BY name').all()
  // Attach per-branch stock to each product
  const branchStock = db.prepare('SELECT pbs.product_id, pbs.branch_id, pbs.quantity, b.name as branch_name FROM product_branch_stock pbs JOIN branches b ON pbs.branch_id=b.id WHERE b.is_active=1').all()
  const stockMap = {}
  branchStock.forEach(r => {
    if (!stockMap[r.product_id]) stockMap[r.product_id] = []
    stockMap[r.product_id].push({branch_id:r.branch_id, branch_name:r.branch_name, quantity:r.quantity})
  })
  return products.map(p => ({ ...p, branch_stock: stockMap[p.id] || [] }))
})

ipcMain.handle('products:create', (_, data) => {
  const r = db.prepare(`INSERT INTO products
    (name,sku,barcode,category,description,
     purchase_price_usd,purchase_price_khr,cost_price_usd,cost_price_khr,
     selling_price_usd,selling_price_khr,
     stock_quantity,low_stock_threshold,out_of_stock_threshold,
     unit,supplier,image_path,custom_fields)
    VALUES (@name,@sku,@barcode,@category,@description,
     @purchase_price_usd,@purchase_price_khr,@purchase_price_usd,@purchase_price_khr,
     @selling_price_usd,@selling_price_khr,
     @stock_quantity,@low_stock_threshold,@out_of_stock_threshold,
     @unit,@supplier,@image_path,@custom_fields)`).run({
    ...data,
    purchase_price_usd: data.purchase_price_usd||0, purchase_price_khr: data.purchase_price_khr||0,
    custom_fields: typeof data.custom_fields==='object' ? JSON.stringify(data.custom_fields) : (data.custom_fields||'{}')
  })
  // Init branch stock rows for all active branches
  const branches = db.prepare('SELECT id FROM branches WHERE is_active=1').all()
  const insBs = db.prepare('INSERT OR IGNORE INTO product_branch_stock (product_id,branch_id,quantity) VALUES (?,?,0)')
  branches.forEach(b => insBs.run(r.lastInsertRowid, b.id))
  // If a specific branch + quantity was given, set it
  if (data.branch_id && data.stock_quantity > 0) {
    db.prepare('UPDATE product_branch_stock SET quantity=? WHERE product_id=? AND branch_id=?').run(data.stock_quantity, r.lastInsertRowid, data.branch_id)
  }
  auditLog(data.userId, data.userName, 'CREATE', 'products', r.lastInsertRowid, null, data)
  return {success:true, id:r.lastInsertRowid}
})

ipcMain.handle('products:update', (_, {id,data,userId,userName}) => {
  const old = db.prepare('SELECT * FROM products WHERE id=?').get(id)
  db.prepare(`UPDATE products SET name=@name,sku=@sku,barcode=@barcode,category=@category,description=@description,
    purchase_price_usd=@purchase_price_usd,purchase_price_khr=@purchase_price_khr,
    cost_price_usd=@purchase_price_usd,cost_price_khr=@purchase_price_khr,
    selling_price_usd=@selling_price_usd,selling_price_khr=@selling_price_khr,
    stock_quantity=@stock_quantity,low_stock_threshold=@low_stock_threshold,
    out_of_stock_threshold=@out_of_stock_threshold,
    unit=@unit,supplier=@supplier,image_path=@image_path,custom_fields=@custom_fields,
    updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({
    ...data, id,
    purchase_price_usd: data.purchase_price_usd||0, purchase_price_khr: data.purchase_price_khr||0,
    custom_fields: typeof data.custom_fields==='object' ? JSON.stringify(data.custom_fields) : (data.custom_fields||'{}')
  })
  auditLog(userId, userName, 'UPDATE', 'products', id, old, data)
  return {success:true}
})

ipcMain.handle('products:delete', (_, {id,userId,userName}) => {
  const old = db.prepare('SELECT * FROM products WHERE id=?').get(id)
  // Hard delete so SKU can be reused on future imports. Clean up related data.
  db.prepare('DELETE FROM product_branch_stock WHERE product_id=?').run(id)
  db.prepare('DELETE FROM products WHERE id=?').run(id)
  auditLog(userId, userName, 'DELETE', 'products', id, old, null)
  return {success:true}
})

ipcMain.handle('products:uploadImage', async (_, {productId,filePath,fileName}) => {
  const dest = path.join(uploadsPath,'products',`product_${productId}_${Date.now()}${path.extname(fileName)}`)
  fs.copyFileSync(filePath, dest)
  db.prepare('UPDATE products SET image_path=? WHERE id=?').run(dest, productId)
  return {success:true, imagePath:dest}
})

ipcMain.handle('products:adjustStock', (_, {productId,productName,type,quantity,unitCostUsd,unitCostKhr,reason,branchId,userId,userName}) => {
  const qty = parseFloat(quantity)
  const op = type==='add' ? '+' : '-'

  // Update global stock
  db.prepare(`UPDATE products SET stock_quantity=stock_quantity${op}?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(qty, productId)

  // Update branch stock if specified
  if (branchId) {
    db.prepare('INSERT OR IGNORE INTO product_branch_stock (product_id,branch_id,quantity) VALUES (?,?,0)').run(productId, branchId)
    db.prepare(`UPDATE product_branch_stock SET quantity=quantity${op}?,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND branch_id=?`).run(qty, productId, branchId)
  }

  const totalUsd = (unitCostUsd||0)*qty, totalKhr = (unitCostKhr||0)*qty
  db.prepare('INSERT INTO stock_movements (product_id,product_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,branch_id,reason,user_id,user_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(productId, productName, type==='add'?'purchase':'adjustment', qty, unitCostUsd||0, unitCostKhr||0, totalUsd, totalKhr, branchId||null, reason, userId, userName)
  auditLog(userId, userName, `STOCK_${type.toUpperCase()}`, 'products', productId, null, {qty,reason,branchId})
  return {success:true}
})

function parseCSVLine(line) {
  const r=[]; let cur='', inQ=false
  for (const ch of line) {
    if (ch==='"') { inQ=!inQ } else if (ch===','&&!inQ) { r.push(cur); cur='' } else { cur+=ch }
  }
  r.push(cur); return r
}

ipcMain.handle('products:bulkImport', async (_, {csvText,imageDir,userId,userName,exchangeRate}) => {
  const lines = csvText.split('\n').map(l=>l.trim()).filter(Boolean)
  if (lines.length < 2) return {success:false, error:'No data rows'}
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''))
  const results = {imported:0, errors:[]}
  const branches = db.prepare('SELECT id, name FROM branches WHERE is_active=1').all()
  const defaultBranch = db.prepare('SELECT id FROM branches WHERE is_default=1 AND is_active=1').get() || branches[0]
  for (let i=1; i<lines.length; i++) {
    try {
      const vals = parseCSVLine(lines[i])
      if (!vals.length||!vals[0]) continue
      const row = {}; headers.forEach((h,idx) => { row[h]=(vals[idx]||'').trim() })
      const name = row.name||row.product_name||''; if (!name) { results.errors.push(`Row ${i}: missing name`); continue }
      const pu = parseFloat(row.purchase_price_usd||row.cost_price_usd||row.cost_price||row.cost||0)
      const pk = parseFloat(row.purchase_price_khr||0)||(pu*exchangeRate)
      const su = parseFloat(row.selling_price_usd||row.selling_price||row.price||0)
      const sk = parseFloat(row.selling_price_khr||0)||(su*exchangeRate)
      let imgPath=''
      const imgFile=row.image||row.image_file||row.image_filename||''
      if (imgFile&&imageDir) { const src=path.join(imageDir,imgFile); if (fs.existsSync(src)) { const d=path.join(uploadsPath,'products',`bulk_${Date.now()}_${i}${path.extname(imgFile)}`); fs.copyFileSync(src,d); imgPath=d } }
      const skuVal=row.sku||null
      // Check for active duplicate SKU
      if (skuVal&&db.prepare('SELECT id FROM products WHERE sku=? AND is_active=1').get(skuVal)) { results.errors.push(`Row ${i}: SKU "${skuVal}" already exists (active product)`); continue }
      const qty=parseFloat(row.stock||row.stock_quantity||row.quantity||0)
      // Resolve branch from CSV column (match by name or id)
      const branchCol = (row.branch||row.branch_name||'').trim()
      let targetBranchId = defaultBranch?.id || null
      if (branchCol) {
        const matched = branches.find(b => b.name.toLowerCase()===branchCol.toLowerCase() || String(b.id)===branchCol)
        if (matched) targetBranchId = matched.id
        else results.errors.push(`Row ${i}: branch "${branchCol}" not found — used default`)
      }
      // If a soft-deleted product with this SKU exists, reactivate it instead of inserting
      const existingSoftDeleted = skuVal ? db.prepare('SELECT id FROM products WHERE sku=? AND is_active=0').get(skuVal) : null
      let r2
      if (existingSoftDeleted) {
        db.prepare(`UPDATE products SET name=?,barcode=?,category=?,description=?,purchase_price_usd=?,purchase_price_khr=?,cost_price_usd=?,cost_price_khr=?,selling_price_usd=?,selling_price_khr=?,stock_quantity=?,low_stock_threshold=?,out_of_stock_threshold=?,unit=?,supplier=?,image_path=?,is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(name,row.barcode||null,row.category||'',row.description||'',pu,pk,pu,pk,su,sk,qty,parseFloat(row.low_stock_threshold||10),parseFloat(row.out_of_stock_threshold||0),row.unit||'pcs',row.supplier||'',imgPath,existingSoftDeleted.id)
        r2 = { lastInsertRowid: existingSoftDeleted.id }
      } else {
        r2=db.prepare(`INSERT INTO products (name,sku,barcode,category,description,purchase_price_usd,purchase_price_khr,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,stock_quantity,low_stock_threshold,out_of_stock_threshold,unit,supplier,image_path,custom_fields) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'{}')`).run(name,skuVal,row.barcode||null,row.category||'',row.description||'',pu,pk,pu,pk,su,sk,qty,parseFloat(row.low_stock_threshold||10),parseFloat(row.out_of_stock_threshold||0),row.unit||'pcs',row.supplier||'',imgPath)
      }
      const insBs=db.prepare('INSERT OR IGNORE INTO product_branch_stock (product_id,branch_id,quantity) VALUES (?,?,0)')
      branches.forEach(b=>insBs.run(r2.lastInsertRowid,b.id))
      // Set stock for target branch
      if (targetBranchId && qty > 0) {
        db.prepare('UPDATE product_branch_stock SET quantity=? WHERE product_id=? AND branch_id=?').run(qty, r2.lastInsertRowid, targetBranchId)
      }
      results.imported++
    } catch(e) { results.errors.push(`Row ${i}: ${e.message}`) }
  }
  auditLog(userId,userName,'BULK_IMPORT','products',null,null,{imported:results.imported})
  return {success:true,...results}
})

ipcMain.handle('products:downloadTemplate', async () => {
  const {filePath}=await dialog.showSaveDialog(mainWindow,{title:'Save CSV Template',defaultPath:'product_import_template.csv',filters:[{name:'CSV',extensions:['csv']}]})
  if (!filePath) return {success:false}
  fs.writeFileSync(filePath,'name,sku,barcode,category,description,selling_price_usd,selling_price_khr,purchase_price_usd,purchase_price_khr,stock_quantity,low_stock_threshold,out_of_stock_threshold,unit,supplier,branch,image_filename\nExample Product,SKU001,1234567890,Electronics,A great product,9.99,41000,5.00,20500,100,10,0,pcs,My Supplier,Main Branch,product1.jpg\n')
  return {success:true}
})

// ════════════════════════════════════════════════════════
// SALES
// ════════════════════════════════════════════════════════
ipcMain.handle('sales:create', (_, d) => {
  // Ensure receipt_counter row exists
  db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('receipt_counter','1000')").run()

  // Use a transaction to atomically increment counter and insert sale
  let receiptNumber, r
  const createSaleTx = db.transaction(() => {
    const cRow = db.prepare("SELECT value FROM settings WHERE key='receipt_counter'").get()
    let counter = parseInt(cRow?.value||'1000') + 1
    // Skip any receipt numbers that already exist (handles DB counter drift)
    while (db.prepare("SELECT id FROM sales WHERE receipt_number=?").get(`RCP-${counter}`)) {
      counter++
    }
    db.prepare("UPDATE settings SET value=? WHERE key='receipt_counter'").run(String(counter))
    receiptNumber = `RCP-${counter}`
    r = db.prepare(`INSERT INTO sales
    (receipt_number,cashier_id,cashier_name,branch_id,items,
     subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
     total_usd,total_khr,payment_method,payment_currency,
     amount_paid_usd,amount_paid_khr,change_usd,change_khr,exchange_rate,notes,
     customer_name,customer_phone,customer_address)
    VALUES (@receipt_number,@cashier_id,@cashier_name,@branch_id,@items,
     @subtotal_usd,@subtotal_khr,@discount_usd,@discount_khr,@tax_usd,@tax_khr,
     @total_usd,@total_khr,@payment_method,@payment_currency,
     @amount_paid_usd,@amount_paid_khr,@change_usd,@change_khr,@exchange_rate,@notes,
     @customer_name,@customer_phone,@customer_address)`).run({
      receipt_number:receiptNumber, cashier_id:d.cashier_id, cashier_name:d.cashier_name,
      branch_id:d.branch_id||null, items:JSON.stringify(d.items),
      subtotal_usd:d.subtotal_usd||0, subtotal_khr:d.subtotal_khr||0,
      discount_usd:d.discount_usd||0, discount_khr:d.discount_khr||0,
      tax_usd:d.tax_usd||0, tax_khr:d.tax_khr||0,
      total_usd:d.total_usd||0, total_khr:d.total_khr||0,
      payment_method:d.payment_method||'cash', payment_currency:d.payment_currency||'USD',
      amount_paid_usd:d.amount_paid_usd||0, amount_paid_khr:d.amount_paid_khr||0,
      change_usd:d.change_usd||0, change_khr:d.change_khr||0,
      exchange_rate:d.exchange_rate||4100, notes:d.notes||'',
      customer_name:d.customer_name||null, customer_phone:d.customer_phone||null,
      customer_address:d.customer_address||null
    })
    return r
  })
  r = createSaleTx()
  // Cache default branch for fallback
  const _defBranch = db.prepare('SELECT id FROM branches WHERE is_default=1 AND is_active=1').get()
    || db.prepare('SELECT id FROM branches WHERE is_active=1 ORDER BY id ASC LIMIT 1').get()

  d.items.forEach(item => {
    // Deduct from global product stock
    db.prepare('UPDATE products SET stock_quantity=MAX(0,stock_quantity-?),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.quantity, item.id)

    // Determine which branch to deduct from for this specific item:
    // - item.branch_id if cashier selected a specific branch for this item
    // - d.branch_id if a sale-level branch is set
    // - Otherwise fall back to the default branch
    let deductBranchId = item.branch_id || d.branch_id || null
    if (!deductBranchId && _defBranch) deductBranchId = _defBranch.id

    if (deductBranchId) {
      db.prepare('INSERT OR IGNORE INTO product_branch_stock (product_id,branch_id,quantity) VALUES (?,?,0)').run(item.id, deductBranchId)
      db.prepare('UPDATE product_branch_stock SET quantity=MAX(0,quantity-?) WHERE product_id=? AND branch_id=?').run(item.quantity, item.id, deductBranchId)
    }
    db.prepare('INSERT INTO stock_movements (product_id,product_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,sale_id,branch_id,reason,user_id,user_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(item.id,item.name,'sale',item.quantity,item.price_usd||0,item.price_khr||0,(item.price_usd||0)*item.quantity,(item.price_khr||0)*item.quantity,r.lastInsertRowid,deductBranchId||null,'Sale',d.cashier_id,d.cashier_name)
    // Record cost_in (purchase cost) movement separately for P&L tracking
    const prodRow = db.prepare('SELECT purchase_price_usd, purchase_price_khr, cost_price_usd, cost_price_khr FROM products WHERE id=?').get(item.id)
    if (prodRow) {
      const costUsd = prodRow.purchase_price_usd || prodRow.cost_price_usd || 0
      const costKhr = prodRow.purchase_price_khr || prodRow.cost_price_khr || 0
      if (costUsd > 0 || costKhr > 0) {
        db.prepare('INSERT INTO stock_movements (product_id,product_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,sale_id,branch_id,reason,user_id,user_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(item.id,item.name,'cost_in',item.quantity,costUsd,costKhr,costUsd*item.quantity,costKhr*item.quantity,r.lastInsertRowid,deductBranchId||null,'Cost of Sale',d.cashier_id,d.cashier_name)
      }
    }
  })
  auditLog(d.cashier_id,d.cashier_name,'SALE','sales',r.lastInsertRowid,null,{total_usd:d.total_usd})
  return {success:true, id:r.lastInsertRowid, receiptNumber}
})

ipcMain.handle('sales:getAll', (_, {limit=300,offset=0}={}) =>
  db.prepare('SELECT s.*, b.name as branch_name FROM sales s LEFT JOIN branches b ON s.branch_id=b.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?').all(limit,offset))

// ── Analytics handler — time-ranged queries for dashboard ──────────────────
ipcMain.handle('sales:getAnalytics', (_, { startDate, endDate, granularity = 'day' }) => {
  const start = startDate || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0]
  const end   = endDate   || new Date().toISOString().split('T')[0]

  // Sales by day/week/month
  const fmtMap = { day: '%Y-%m-%d', week: '%Y-%W', month: '%Y-%m' }
  const fmt = fmtMap[granularity] || '%Y-%m-%d'

  const salesByPeriod = db.prepare(`
    SELECT strftime('${fmt}', created_at) as period,
      COUNT(*) as count,
      COALESCE(SUM(total_usd),0) as revenue_usd,
      COALESCE(SUM(total_khr),0) as revenue_khr,
      COALESCE(SUM(discount_usd),0) as discount_usd,
      COALESCE(SUM(tax_usd),0) as tax_usd
    FROM sales
    WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY period ORDER BY period ASC
  `).all(start, end)

  // Cost In by period (purchase cost of items sold)
  const costByPeriod = db.prepare(`
    SELECT strftime('${fmt}', m.created_at) as period,
      COALESCE(SUM(m.total_cost_usd),0) as cost_usd
    FROM stock_movements m
    WHERE m.movement_type='cost_in' AND date(m.created_at) BETWEEN ? AND ?
    GROUP BY period ORDER BY period ASC
  `).all(start, end)
  const costMap = Object.fromEntries(costByPeriod.map(r => [r.period, r.cost_usd]))

  // Merge cost into sales periods
  const periodData = salesByPeriod.map(r => ({
    ...r,
    cost_usd: costMap[r.period] || 0,
    profit_usd: r.revenue_usd - (costMap[r.period] || 0)
  }))

  // Top products by revenue
  const topProducts = db.prepare(`
    SELECT m.product_id, m.product_name,
      SUM(m.quantity) as qty_sold,
      SUM(m.total_cost_usd) as revenue_usd
    FROM stock_movements m
    WHERE m.movement_type='sale' AND date(m.created_at) BETWEEN ? AND ?
    GROUP BY m.product_id ORDER BY revenue_usd DESC LIMIT 10
  `).all(start, end)

  // Top products by quantity
  const topProductsQty = db.prepare(`
    SELECT m.product_id, m.product_name,
      SUM(m.quantity) as qty_sold,
      SUM(m.total_cost_usd) as revenue_usd
    FROM stock_movements m
    WHERE m.movement_type='sale' AND date(m.created_at) BETWEEN ? AND ?
    GROUP BY m.product_id ORDER BY qty_sold DESC LIMIT 10
  `).all(start, end)

  // Revenue by branch
  const byBranch = db.prepare(`
    SELECT COALESCE(b.name,'No Branch') as branch_name,
      COUNT(s.id) as count,
      COALESCE(SUM(s.total_usd),0) as revenue_usd
    FROM sales s LEFT JOIN branches b ON s.branch_id=b.id
    WHERE date(s.created_at) BETWEEN ? AND ?
    GROUP BY s.branch_id ORDER BY revenue_usd DESC
  `).all(start, end)

  // Payment method breakdown
  const byPayment = db.prepare(`
    SELECT payment_method,
      COUNT(*) as count,
      COALESCE(SUM(total_usd),0) as revenue_usd
    FROM sales
    WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY payment_method ORDER BY revenue_usd DESC
  `).all(start, end)

  // Summary totals for range
  const totals = db.prepare(`
    SELECT
      COUNT(*) as tx_count,
      COALESCE(SUM(total_usd),0) as revenue_usd,
      COALESCE(SUM(total_khr),0) as revenue_khr,
      COALESCE(SUM(discount_usd),0) as discount_usd,
      COALESCE(AVG(total_usd),0) as avg_order_usd
    FROM sales WHERE date(created_at) BETWEEN ? AND ?
  `).get(start, end)

  const costTotals = db.prepare(`
    SELECT COALESCE(SUM(total_cost_usd),0) as cost_usd
    FROM stock_movements WHERE movement_type='cost_in' AND date(created_at) BETWEEN ? AND ?
  `).get(start, end)

  // Hourly distribution (what hours are busiest)
  const hourlyDist = db.prepare(`
    SELECT strftime('%H', created_at) as hour, COUNT(*) as count, COALESCE(SUM(total_usd),0) as revenue_usd
    FROM sales WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY hour ORDER BY hour
  `).all(start, end)

  // Daily avg comparison: this period vs previous period of same length
  const daysDiff = Math.ceil((new Date(end) - new Date(start)) / (1000*60*60*24)) + 1
  const prevEnd   = new Date(new Date(start) - 1000*60*60*24).toISOString().split('T')[0]
  const prevStart = new Date(new Date(start) - daysDiff*1000*60*60*24).toISOString().split('T')[0]
  const prevTotals = db.prepare(`
    SELECT COALESCE(SUM(total_usd),0) as revenue_usd, COUNT(*) as tx_count
    FROM sales WHERE date(created_at) BETWEEN ? AND ?
  `).get(prevStart, prevEnd)

  return {
    period: { start, end, granularity },
    periodData,
    topProducts,
    topProductsQty,
    byBranch,
    byPayment,
    totals: { ...totals, cost_usd: costTotals.cost_usd, profit_usd: totals.revenue_usd - costTotals.cost_usd },
    prevTotals,
    hourlyDist,
  }
})

ipcMain.handle('sales:getDashboard', () => {
  const today = new Date().toISOString().split('T')[0]
  const todayTotal  = db.prepare("SELECT COALESCE(SUM(COALESCE(total_usd,0)),0) as val FROM sales WHERE date(created_at)=?").get(today)
  const todayCount  = db.prepare("SELECT COUNT(*) as val FROM sales WHERE date(created_at)=?").get(today)
  const allTotal    = db.prepare("SELECT COALESCE(SUM(COALESCE(total_usd,0)),0) as val FROM sales").get()
  const allKhr      = db.prepare("SELECT COALESCE(SUM(COALESCE(total_khr,0)),0) as val FROM sales").get()
  const lowStock    = db.prepare("SELECT * FROM products WHERE stock_quantity<=low_stock_threshold AND is_active=1 ORDER BY stock_quantity ASC LIMIT 20").all()
  const recentSales = db.prepare('SELECT s.*, b.name as branch_name FROM sales s LEFT JOIN branches b ON s.branch_id=b.id ORDER BY s.created_at DESC LIMIT 5').all()
  const productCount= db.prepare("SELECT COUNT(*) as val FROM products WHERE is_active=1").get()
  const branchCount = db.prepare("SELECT COUNT(*) as val FROM branches WHERE is_active=1").get()
  // Cost In (Purchase) = cost of goods sold, recorded as 'cost_in' movements on each sale
  const costInRow   = db.prepare("SELECT COALESCE(SUM(COALESCE(total_cost_usd,0)),0) as usd, COALESCE(SUM(COALESCE(total_cost_khr,0)),0) as khr FROM stock_movements WHERE movement_type='cost_in'").get()
  const cost_in     = costInRow?.usd || 0
  const cost_in_khr = costInRow?.khr || 0
  const cost_out    = allTotal.val
  const cost_out_khr= allKhr.val
  return {
    today_total:todayTotal.val, today_count:todayCount.val,
    all_total:allTotal.val, all_total_khr:allKhr.val,
    cost_in, cost_in_khr, cost_out, cost_out_khr,
    low_stock:lowStock, recent_sales:recentSales,
    product_count:productCount.val, branch_count:branchCount.val
  }
})

// ════════════════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════════════════
ipcMain.handle('inventory:getMovements', (_, {productId,branchId,limit=500}={}) => {
  let q = 'SELECT m.*, b.name as branch_name FROM stock_movements m LEFT JOIN branches b ON m.branch_id=b.id WHERE 1=1'
  const params = []
  if (productId) { q += ' AND m.product_id=?'; params.push(productId) }
  if (branchId)  { q += ' AND m.branch_id=?'; params.push(branchId) }
  q += ' ORDER BY m.created_at DESC LIMIT ?'; params.push(limit)
  return db.prepare(q).all(...params)
})

ipcMain.handle('inventory:getSummary', (_, {branchId}={}) => {
  const products = db.prepare('SELECT * FROM products WHERE is_active=1 ORDER BY name').all()
  // Per-product branch stock
  const bStock = db.prepare('SELECT pbs.product_id, pbs.branch_id, pbs.quantity, b.name as bname FROM product_branch_stock pbs JOIN branches b ON pbs.branch_id=b.id WHERE b.is_active=1').all()
  const bMap = {} // product_id -> [{branch_id, bname, quantity}]
  bStock.forEach(r => { if (!bMap[r.product_id]) bMap[r.product_id]=[]; bMap[r.product_id].push(r) })

  const sold = db.prepare("SELECT product_id,SUM(total_cost_usd) as usd,SUM(total_cost_khr) as khr,SUM(quantity) as qty FROM stock_movements WHERE movement_type='sale' GROUP BY product_id").all()
  const soMap = Object.fromEntries(sold.map(r=>[r.product_id,r]))
  // COGS: sum of cost_in movements (purchase cost × qty sold) per product
  const cogsRows = db.prepare("SELECT product_id,SUM(total_cost_usd) as usd,SUM(total_cost_khr) as khr FROM stock_movements WHERE movement_type='cost_in' GROUP BY product_id").all()
  const cogsMap = Object.fromEntries(cogsRows.map(r=>[r.product_id,r]))

  return products.map(p => {
    const pu = p.purchase_price_usd || p.cost_price_usd || 0
    const pk = p.purchase_price_khr || p.cost_price_khr || 0
    const displayQty = branchId
      ? (bMap[p.id]?.find(b=>b.branch_id===branchId)?.quantity || 0)
      : p.stock_quantity
    return {
      ...p,
      branch_stock: bMap[p.id] || [],
      display_quantity: displayQty,
      revenue_usd: soMap[p.id]?.usd || 0,
      revenue_khr: soMap[p.id]?.khr || 0,
      qty_sold: soMap[p.id]?.qty || 0,
      cogs_usd: cogsMap[p.id]?.usd || 0,
      cogs_khr: cogsMap[p.id]?.khr || 0,
      stock_value_usd: displayQty * pu,
      stock_value_khr: displayQty * pk,
    }
  }).filter(p => !branchId || p.display_quantity > 0 || !branchId)
})

// ════════════════════════════════════════════════════════
// USERS & ROLES
// ════════════════════════════════════════════════════════
ipcMain.handle('users:getAll', () => db.prepare('SELECT u.id,u.name,u.username,u.role_id,u.is_primary,u.is_active,u.created_at,r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id=r.id').all())
ipcMain.handle('users:create', (_, d) => { const r=db.prepare('INSERT INTO users (name,username,password,role_id) VALUES (?,?,?,?)').run(d.name,d.username,d.password,d.role_id); return {success:true,id:r.lastInsertRowid} })
ipcMain.handle('users:update', (_, {id,data}) => { db.prepare('UPDATE users SET name=?,username=?,role_id=?,is_active=? WHERE id=?').run(data.name,data.username,data.role_id,data.is_active,id); return {success:true} })
ipcMain.handle('users:resetPassword', (_, {id,password}) => { db.prepare('UPDATE users SET password=? WHERE id=?').run(password,id); return {success:true} })

ipcMain.handle('roles:getAll', () => db.prepare('SELECT * FROM roles ORDER BY is_system DESC,name').all())
ipcMain.handle('roles:create', (_, d) => { const r=db.prepare('INSERT INTO roles (name,permissions) VALUES (?,?)').run(d.name,JSON.stringify(d.permissions||{})); return {success:true,id:r.lastInsertRowid} })
ipcMain.handle('roles:update', (_, {id,data}) => { db.prepare('UPDATE roles SET name=?,permissions=? WHERE id=?').run(data.name,typeof data.permissions==='string'?data.permissions:JSON.stringify(data.permissions||{}),id); return {success:true} })
ipcMain.handle('roles:delete', (_, id) => {
  const c=db.prepare('SELECT COUNT(*) as c FROM users WHERE role_id=?').get(id)
  if (c.c>0) return {success:false,error:`${c.c} user(s) still assigned — reassign first`}
  db.prepare('DELETE FROM roles WHERE id=?').run(id); return {success:true}
})

// ════════════════════════════════════════════════════════
// AUDIT / BACKUP / DIALOGS
// ════════════════════════════════════════════════════════
ipcMain.handle('audit:getAll', (_, {limit=300}={}) => db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit))

ipcMain.handle('backup:export', async () => {
  const {filePath}=await dialog.showSaveDialog(mainWindow,{title:'Export Backup',defaultPath:`backup_${new Date().toISOString().split('T')[0]}`,filters:[{name:'Folder',extensions:[]}]})
  if (!filePath) return {success:false}
  fs.mkdirSync(filePath,{recursive:true})
  fs.copyFileSync(dbPath,path.join(filePath,'database.db'))
  if (fs.existsSync(uploadsPath)) fs.cpSync(uploadsPath,path.join(filePath,'uploads'),{recursive:true})
  shell.showItemInFolder(filePath); return {success:true}
})
ipcMain.handle('backup:import', async () => {
  const {filePaths}=await dialog.showOpenDialog(mainWindow,{title:'Import Backup',properties:['openDirectory']})
  if (!filePaths?.[0]) return {success:false}
  const bDb=path.join(filePaths[0],'database.db')
  if (!fs.existsSync(bDb)) return {success:false,error:'Invalid backup folder'}
  db.close(); fs.copyFileSync(bDb,dbPath)
  app.relaunch(); app.exit(0); return {success:true}
})

ipcMain.handle('dialog:openImage', async () => { const {filePaths}=await dialog.showOpenDialog(mainWindow,{title:'Select Image',filters:[{name:'Images',extensions:['jpg','jpeg','png','webp']}],properties:['openFile']}); return filePaths?.[0]||null })
ipcMain.handle('dialog:openCSV', async () => { const {filePaths}=await dialog.showOpenDialog(mainWindow,{title:'Select CSV',filters:[{name:'CSV',extensions:['csv']}],properties:['openFile']}); if (!filePaths?.[0]) return null; return {filePath:filePaths[0],content:fs.readFileSync(filePaths[0],'utf-8')} })
ipcMain.handle('dialog:openFolder', async () => { const {filePaths}=await dialog.showOpenDialog(mainWindow,{title:'Select Folder',properties:['openDirectory']}); return filePaths?.[0]||null })
ipcMain.handle('shell:openPath', (_,p) => shell.openPath(p))

// ════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════
ipcMain.handle('customers:getAll', () => db.prepare('SELECT * FROM customers WHERE is_active=1 ORDER BY name').all())
ipcMain.handle('customers:create', (_, d) => {
  const r = db.prepare('INSERT INTO customers (name,phone,email,address,company,notes) VALUES (?,?,?,?,?,?)').run(d.name,d.phone||'',d.email||'',d.address||'',d.company||'',d.notes||'')
  return {success:true, id:r.lastInsertRowid}
})
ipcMain.handle('customers:update', (_, {id,data}) => {
  db.prepare('UPDATE customers SET name=?,phone=?,email=?,address=?,company=?,notes=? WHERE id=?').run(data.name,data.phone||'',data.email||'',data.address||'',data.company||'',data.notes||'',id)
  return {success:true}
})
ipcMain.handle('customers:delete', (_, id) => {
  db.prepare('UPDATE customers SET is_active=0 WHERE id=?').run(id)
  return {success:true}
})
ipcMain.handle('customers:bulkImport', (_, {csvText}) => {
  const lines = csvText.split('\n').map(l=>l.trim()).filter(Boolean)
  if (lines.length < 2) return {imported:0, errors:['Empty CSV']}
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,''))
  let imported = 0; const errors = []
  const stmt = db.prepare('INSERT INTO customers (name,phone,email,address,company,notes) VALUES (?,?,?,?,?,?)')
  for (let i=1;i<lines.length;i++) {
    const cols = lines[i].split(',').map(c=>c.trim().replace(/^"|"$/g,''))
    const row = Object.fromEntries(headers.map((h,j)=>[h,cols[j]||'']))
    if (!row.name) { errors.push(`Row ${i+1}: missing name`); continue }
    try { stmt.run(row.name,row.phone||'',row.email||'',row.address||'',row.company||'',row.notes||''); imported++ } catch(e) { errors.push(`Row ${i+1}: ${e.message}`) }
  }
  return {imported, errors}
})
ipcMain.handle('customers:downloadTemplate', async () => {
  const {filePath} = await dialog.showSaveDialog(mainWindow,{title:'Save Template',defaultPath:'customer_import_template.csv',filters:[{name:'CSV',extensions:['csv']}]})
  if (!filePath) return {success:false}
  fs.writeFileSync(filePath,'name,phone,email,address,company,notes\nJohn Doe,012345678,john@email.com,123 Main St,ACME Corp,VIP customer\n')
  shell.showItemInFolder(filePath); return {success:true}
})

// ════════════════════════════════════════════════════════
// SUPPLIERS
// ════════════════════════════════════════════════════════
ipcMain.handle('suppliers:getAll', () => db.prepare('SELECT * FROM suppliers WHERE is_active=1 ORDER BY name').all())
ipcMain.handle('suppliers:create', (_, d) => {
  const r = db.prepare('INSERT INTO suppliers (name,phone,email,address,company,contact_person,notes) VALUES (?,?,?,?,?,?,?)').run(d.name,d.phone||'',d.email||'',d.address||'',d.company||'',d.contact_person||'',d.notes||'')
  return {success:true, id:r.lastInsertRowid}
})
ipcMain.handle('suppliers:update', (_, {id,data}) => {
  db.prepare('UPDATE suppliers SET name=?,phone=?,email=?,address=?,company=?,contact_person=?,notes=? WHERE id=?').run(data.name,data.phone||'',data.email||'',data.address||'',data.company||'',data.contact_person||'',data.notes||'',id)
  return {success:true}
})
ipcMain.handle('suppliers:delete', (_, id) => {
  db.prepare('UPDATE suppliers SET is_active=0 WHERE id=?').run(id)
  return {success:true}
})
ipcMain.handle('suppliers:bulkImport', (_, {csvText}) => {
  const lines = csvText.split('\n').map(l=>l.trim()).filter(Boolean)
  if (lines.length < 2) return {imported:0, errors:['Empty CSV']}
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,''))
  let imported = 0; const errors = []
  const stmt = db.prepare('INSERT INTO suppliers (name,phone,email,address,company,contact_person,notes) VALUES (?,?,?,?,?,?,?)')
  for (let i=1;i<lines.length;i++) {
    const cols = lines[i].split(',').map(c=>c.trim().replace(/^"|"$/g,''))
    const row = Object.fromEntries(headers.map((h,j)=>[h,cols[j]||'']))
    if (!row.name) { errors.push(`Row ${i+1}: missing name`); continue }
    try { stmt.run(row.name,row.phone||'',row.email||'',row.address||'',row.company||'',row.contact_person||'',row.notes||''); imported++ } catch(e) { errors.push(`Row ${i+1}: ${e.message}`) }
  }
  return {imported, errors}
})
ipcMain.handle('suppliers:downloadTemplate', async () => {
  const {filePath} = await dialog.showSaveDialog(mainWindow,{title:'Save Template',defaultPath:'supplier_import_template.csv',filters:[{name:'CSV',extensions:['csv']}]})
  if (!filePath) return {success:false}
  fs.writeFileSync(filePath,'name,phone,email,address,company,contact_person,notes\nSupplier Co,012345678,info@supplier.com,456 Trade St,Supplier Co Ltd,Jane Smith,Main supplier\n')
  shell.showItemInFolder(filePath); return {success:true}
})
