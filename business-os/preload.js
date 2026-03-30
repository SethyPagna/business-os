const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('api', {
  // Auth & Settings
  login: c => ipcRenderer.invoke('auth:login', c),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: s => ipcRenderer.invoke('settings:set', s),
  // Branches
  getBranches: () => ipcRenderer.invoke('branches:getAll'),
  createBranch: d => ipcRenderer.invoke('branches:create', d),
  updateBranch: (id,data) => ipcRenderer.invoke('branches:update', {id,data}),
  deleteBranch: id => ipcRenderer.invoke('branches:delete', id),
  getBranchStock: id => ipcRenderer.invoke('branches:getStock', id),
  transferStock: d => ipcRenderer.invoke('branches:transfer', d),
  getTransfers: opts => ipcRenderer.invoke('branches:getTransfers', opts),
  // Categories / Units / Custom Fields
  getCategories: () => ipcRenderer.invoke('categories:getAll'),
  createCategory: d => ipcRenderer.invoke('categories:create', d),
  updateCategory: d => ipcRenderer.invoke('categories:update', d),
  deleteCategory: id => ipcRenderer.invoke('categories:delete', id),
  getUnits: () => ipcRenderer.invoke('units:getAll'),
  createUnit: name => ipcRenderer.invoke('units:create', name),
  deleteUnit: id => ipcRenderer.invoke('units:delete', id),
  getCustomFields: () => ipcRenderer.invoke('customFields:getAll'),
  createCustomField: d => ipcRenderer.invoke('customFields:create', d),
  updateCustomField: (id,data) => ipcRenderer.invoke('customFields:update', {id,data}),
  deleteCustomField: id => ipcRenderer.invoke('customFields:delete', id),
  // Products
  getProducts: () => ipcRenderer.invoke('products:getAll'),
  createProduct: d => ipcRenderer.invoke('products:create', d),
  updateProduct: (id,data,userId,userName) => ipcRenderer.invoke('products:update', {id,data,userId,userName}),
  deleteProduct: (id,userId,userName) => ipcRenderer.invoke('products:delete', {id,userId,userName}),
  uploadProductImage: d => ipcRenderer.invoke('products:uploadImage', d),
  adjustStock: d => ipcRenderer.invoke('products:adjustStock', d),
  bulkImportProducts: d => ipcRenderer.invoke('products:bulkImport', d),
  downloadImportTemplate: () => ipcRenderer.invoke('products:downloadTemplate'),
  // Sales
  createSale: d => ipcRenderer.invoke('sales:create', d),
  getSales: opts => ipcRenderer.invoke('sales:getAll', opts),
  getDashboard: () => ipcRenderer.invoke('sales:getDashboard'),
  getAnalytics: opts => ipcRenderer.invoke('sales:getAnalytics', opts),
  // Inventory
  getInventoryMovements: d => ipcRenderer.invoke('inventory:getMovements', d),
  getInventorySummary: opts => ipcRenderer.invoke('inventory:getSummary', opts),
  // Users & Roles
  getUsers: () => ipcRenderer.invoke('users:getAll'),
  createUser: d => ipcRenderer.invoke('users:create', d),
  updateUser: (id,data) => ipcRenderer.invoke('users:update', {id,data}),
  resetPassword: (id,pw) => ipcRenderer.invoke('users:resetPassword', {id,password:pw}),
  getRoles: () => ipcRenderer.invoke('roles:getAll'),
  createRole: d => ipcRenderer.invoke('roles:create', d),
  updateRole: (id,data) => ipcRenderer.invoke('roles:update', {id,data}),
  deleteRole: id => ipcRenderer.invoke('roles:delete', id),
  // Audit & Backup
  getAuditLogs: opts => ipcRenderer.invoke('audit:getAll', opts),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  // Dialogs
  openImageDialog: async () => {
    const result = await ipcRenderer.invoke('dialog:openImage')
    // Restore focus to renderer after dialog closes (fixes input not working bug)
    setTimeout(() => { try { document.activeElement?.blur(); window.focus() } catch(e){} }, 100)
    return result
  },
  openCSVDialog: async () => {
    const result = await ipcRenderer.invoke('dialog:openCSV')
    setTimeout(() => { try { document.activeElement?.blur(); window.focus() } catch(e){} }, 100)
    return result
  },
  openFolderDialog: async () => {
    const result = await ipcRenderer.invoke('dialog:openFolder')
    setTimeout(() => { try { document.activeElement?.blur(); window.focus() } catch(e){} }, 100)
    return result
  },
  openPath: p => ipcRenderer.invoke('shell:openPath', p),
  // Customers
  getCustomers: () => ipcRenderer.invoke('customers:getAll'),
  createCustomer: d => ipcRenderer.invoke('customers:create', d),
  updateCustomer: (id,data) => ipcRenderer.invoke('customers:update', {id,data}),
  deleteCustomer: id => ipcRenderer.invoke('customers:delete', id),
  bulkImportCustomers: d => ipcRenderer.invoke('customers:bulkImport', d),
  downloadCustomerTemplate: () => ipcRenderer.invoke('customers:downloadTemplate'),
  // Suppliers
  getSuppliers: () => ipcRenderer.invoke('suppliers:getAll'),
  createSupplier: d => ipcRenderer.invoke('suppliers:create', d),
  updateSupplier: (id,data) => ipcRenderer.invoke('suppliers:update', {id,data}),
  deleteSupplier: id => ipcRenderer.invoke('suppliers:delete', id),
  bulkImportSuppliers: d => ipcRenderer.invoke('suppliers:bulkImport', d),
  downloadSupplierTemplate: () => ipcRenderer.invoke('suppliers:downloadTemplate'),
})
