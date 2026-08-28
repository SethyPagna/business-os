import type { Dispatch, SetStateAction } from 'react'
import QuickAddModal from './QuickAddModal'

type Translator = (key: string) => string
type PosCopy = (en: string, km?: string) => string

type CustomerFormState = {
  address: string
  membership_number: string
  name: string
  phone: string
}

type DeliveryFormState = {
  area: string
  name: string
  phone: string
}

type POSQuickAddModalsProps = {
  closeAddCustomerModal: () => void
  closeAddDeliveryModal: () => void
  handleAddCustomer: () => void
  handleAddDelivery: () => void
  newCustomerForm: CustomerFormState
  newDeliveryForm: DeliveryFormState
  posCopy: PosCopy
  savingCustomer: boolean
  savingDelivery: boolean
  setNewCustomerForm: Dispatch<SetStateAction<CustomerFormState>>
  setNewDeliveryForm: Dispatch<SetStateAction<DeliveryFormState>>
  showAddCustomer: boolean
  showAddDelivery: boolean
  t: Translator
}

export default function POSQuickAddModals({
  closeAddCustomerModal,
  closeAddDeliveryModal,
  handleAddCustomer,
  handleAddDelivery,
  newCustomerForm,
  newDeliveryForm,
  posCopy,
  savingCustomer,
  savingDelivery,
  setNewCustomerForm,
  setNewDeliveryForm,
  showAddCustomer,
  showAddDelivery,
  t,
}: POSQuickAddModalsProps) {
  if (!showAddCustomer && !showAddDelivery) return null

  return (
    <>
      {showAddCustomer ? (
        <QuickAddModal title={t('add_new_customer')} saving={savingCustomer} onSave={handleAddCustomer} t={t} onClose={closeAddCustomerModal}>
          <div>
            <label htmlFor="pos-quick-customer-name" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('name')} *</label>
            <input id="pos-quick-customer-name" name="pos_quick_customer_name" className="input" value={newCustomerForm.name} onChange={(event) => setNewCustomerForm((form) => ({ ...form, name: event.target.value }))} autoComplete="name" autoFocus />
          </div>
          {/* Phone directly after the name -- the default/first contact
              information (user, Aug 28); membership follows. */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="pos-quick-customer-phone" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('phone_number') || 'Phone Number'}</label>
              <input id="pos-quick-customer-phone" name="pos_quick_customer_phone" className="input" value={newCustomerForm.phone} onChange={(event) => setNewCustomerForm((form) => ({ ...form, phone: event.target.value }))} autoComplete="tel" />
            </div>
            <div>
              <label htmlFor="pos-quick-customer-address" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('address')}</label>
              <input id="pos-quick-customer-address" name="pos_quick_customer_address" className="input" value={newCustomerForm.address} onChange={(event) => setNewCustomerForm((form) => ({ ...form, address: event.target.value }))} autoComplete="street-address" />
            </div>
          </div>
          <div>
            <label htmlFor="pos-quick-customer-membership" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {posCopy('Membership ID', 'Membership ID')} <span className="font-normal text-gray-400">({posCopy('optional', 'optional')})</span>
            </label>
            <input id="pos-quick-customer-membership" name="pos_quick_customer_membership" className="input" value={newCustomerForm.membership_number} onChange={(event) => setNewCustomerForm((form) => ({ ...form, membership_number: event.target.value }))} placeholder={posCopy('Auto-generated if blank', 'Auto-generated if blank')} autoComplete="off" />
          </div>
        </QuickAddModal>
      ) : null}

      {showAddDelivery ? (
        <QuickAddModal title={t('add_delivery_contact') || 'Add Delivery Contact'} saving={savingDelivery} onSave={handleAddDelivery} t={t} onClose={closeAddDeliveryModal}>
          <div>
            <label htmlFor="pos-quick-delivery-name" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Driver / Rider Name</label>
            <input id="pos-quick-delivery-name" name="pos_quick_delivery_name" className="input" value={newDeliveryForm.name} onChange={(event) => setNewDeliveryForm((form) => ({ ...form, name: event.target.value }))} autoComplete="name" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="pos-quick-delivery-phone" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Phone</label>
              <input id="pos-quick-delivery-phone" name="pos_quick_delivery_phone" className="input" value={newDeliveryForm.phone} onChange={(event) => setNewDeliveryForm((form) => ({ ...form, phone: event.target.value }))} placeholder="012 345 678" autoComplete="tel" />
            </div>
            <div>
              <label htmlFor="pos-quick-delivery-area" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Area / Zone</label>
              <input id="pos-quick-delivery-area" name="pos_quick_delivery_area" className="input" value={newDeliveryForm.area} onChange={(event) => setNewDeliveryForm((form) => ({ ...form, area: event.target.value }))} placeholder="Central, North" autoComplete="address-level2" />
            </div>
          </div>
          <p className="text-xs text-gray-400">Enter at least a driver name or phone number.</p>
        </QuickAddModal>
      ) : null}
    </>
  )
}
