// Contacts
// Main Contacts page. All-in-one export/import lives here at the page level.

import { useState } from 'react'
import { BookUser, Download, Truck, Upload, Users, Warehouse } from 'lucide-react'
import { useApp } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { CustomersTab } from './CustomersTab'
import { SuppliersTab } from './SuppliersTab'
import { DeliveryTab } from './DeliveryTab'
import { ImportModal } from './shared'
import Modal from '../shared/Modal'
import PageHeader from '../shared/PageHeader'
import { getFirstLoaderError, settleLoaderMap } from '../../utils/loaders.mjs'

const TABS = (t) => [
  { id: 'customers', label: t('customers') || 'Customers', icon: Users },
  { id: 'suppliers', label: t('suppliers') || 'Suppliers', icon: Warehouse },
  { id: 'delivery', label: t('pos_delivery') || 'Delivery', icon: Truck },
]

function ImportTypePicker({ onSelect, onClose, t }) {
  const T = (key, fallback) => (typeof t === 'function' ? t(key) : fallback)

  return (
    <Modal
      title={(
        <span className="inline-flex items-center gap-2">
          <Upload className="h-4 w-4" />
          {T('import_all_contacts_title', 'Import All Contacts')}
        </span>
      )}
      onClose={onClose}
    >
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {T('import_all_select_type', 'Select the contact type to import:')}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <button className="card flex cursor-pointer flex-col items-center gap-2 p-4 hover:border-blue-400" onClick={() => onSelect('customer')}>
          <Users className="h-6 w-6 text-blue-600" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {T('import_customers_btn', 'Customers')}
          </span>
        </button>
        <button className="card flex cursor-pointer flex-col items-center gap-2 p-4 hover:border-purple-400" onClick={() => onSelect('supplier')}>
          <Warehouse className="h-6 w-6 text-purple-600" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {T('import_suppliers_btn', 'Suppliers')}
          </span>
        </button>
        <button className="card flex cursor-pointer flex-col items-center gap-2 p-4 hover:border-orange-400" onClick={() => onSelect('deliveryContact')}>
          <Truck className="h-6 w-6 text-orange-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {T('import_delivery_btn', 'Delivery')}
          </span>
        </button>
      </div>
    </Modal>
  )
}

export default function Contacts() {
  const { t, notify } = useApp()
  const [tab, setTab] = useState('customers')
  const [modal, setModal] = useState(null)
  const [importType, setImportType] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const handleExportAll = async () => {
    try {
      const result = await settleLoaderMap({
        customers: () => window.api.getCustomers(),
        suppliers: () => window.api.getSuppliers(),
        delivery: () => window.api.getDeliveryContacts(),
      })
      const customers = Array.isArray(result.values.customers) ? result.values.customers : []
      const suppliers = Array.isArray(result.values.suppliers) ? result.values.suppliers : []
      const delivery = Array.isArray(result.values.delivery) ? result.values.delivery : []
      const today = new Date().toISOString().slice(0, 10)

      if (Array.isArray(customers) && customers.length > 0) {
        downloadCSV(`contacts-customers-${today}.csv`, customers.map((c) => ({
          Name: c.name || '',
          Membership_Number: c.membership_number || '',
          Phone: c.phone || '',
          Email: c.email || '',
          Company: c.company || '',
          Address: c.address || '',
          Notes: c.notes || '',
          Created: c.created_at || '',
        })))
      }
      if (Array.isArray(suppliers) && suppliers.length > 0) {
        downloadCSV(`contacts-suppliers-${today}.csv`, suppliers.map((s) => ({
          Name: s.name || '',
          Phone: s.phone || '',
          Email: s.email || '',
          Company: s.company || '',
          Contact_Person: s.contact_person || '',
          Address: s.address || '',
          Notes: s.notes || '',
          Created: s.created_at || '',
        })))
      }
      if (Array.isArray(delivery) && delivery.length > 0) {
        downloadCSV(`contacts-delivery-${today}.csv`, delivery.map((d) => ({
          Name: d.name || '',
          Phone: d.phone || '',
          Area: d.area || '',
          Address: d.address || '',
          Notes: d.notes || '',
          Created: d.created_at || '',
        })))
      }

      const total = (customers?.length || 0) + (suppliers?.length || 0) + (delivery?.length || 0)
      if (!result.hasAnySuccess) {
        throw new Error(getFirstLoaderError(result.errors, 'Failed to export contacts'))
      }
      if (result.hasErrors) {
        notify(t('contacts_partial_export') || 'Some contact groups were unavailable, so only the ready data was exported.', 'warning')
      }
      notify(`${t('all_contacts_exported') || 'All contacts exported'} (${total} ${t('entries') || 'records'})`)
    } catch (error) {
      notify(`Export failed: ${error.message}`, 'error')
    }
  }

  const openImportPicker = () => setModal('pickImportType')

  const handleTypeSelected = (type) => {
    setImportType(type)
    setModal('import')
  }

  const handleImportDone = () => {
    setReloadKey((value) => value + 1)
    setModal(null)
    setImportType(null)
  }

  return (
    <div className="page-scroll p-3 sm:p-6">
      <PageHeader
        icon={BookUser}
        tone="blue"
        title={t('contacts')}
        subtitle={t('perm_contacts') || 'Manage customers, suppliers, and delivery contacts from one workspace.'}
        className="mb-4"
        actions={(
          <div className="flex min-w-0 flex-shrink gap-1.5 overflow-x-auto pb-0.5">
          <button
            className="btn-secondary flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-sm"
            onClick={openImportPicker}
            title={t('import_all_contacts_title') || 'Import contacts'}
            aria-label={t('import_contacts') || 'Import'}
          >
            <Upload className="h-4 w-4" />
            <span>{t('import_contacts') || 'Import'}</span>
          </button>
          <button
            className="btn-secondary flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-sm"
            onClick={handleExportAll}
            title={t('export_all_contacts') || 'Export all contacts as CSVs'}
            aria-label={t('export') || 'Export'}
          >
            <Download className="h-4 w-4" />
            <span>{t('export') || 'Export'}</span>
          </button>
          </div>
        )}
      />

      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS(t).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors sm:px-5 ${
              tab === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'customers' && <CustomersTab key={`c-${reloadKey}`} t={t} notify={notify} />}
      {tab === 'suppliers' && <SuppliersTab key={`s-${reloadKey}`} t={t} notify={notify} />}
      {tab === 'delivery' && <DeliveryTab key={`d-${reloadKey}`} t={t} notify={notify} />}

      {modal === 'pickImportType' ? (
        <ImportTypePicker onSelect={handleTypeSelected} onClose={() => setModal(null)} t={t} />
      ) : null}
      {modal === 'import' && importType ? (
        <ImportModal
          type={importType}
          onClose={() => {
            setModal(null)
            setImportType(null)
          }}
          onDone={handleImportDone}
        />
      ) : null}
    </div>
  )
}
