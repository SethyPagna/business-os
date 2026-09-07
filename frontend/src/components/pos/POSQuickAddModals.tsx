import type { Dispatch, SetStateAction } from 'react'
import QuickAddModal from './QuickAddModal'
import { formatPhoneInputElement, handlePhoneInputBeforeInput, handlePhoneInputKeyDown } from '../../utils/phoneInput.ts'
import type { ContactDuplicateCheck, ContactDuplicateMatch } from '../contacts/contactDuplicates.ts'

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
  customerDuplicateCheck: ContactDuplicateCheck | null
  deliveryDuplicateCheck: ContactDuplicateCheck | null
  clearCustomerDuplicateCheck: () => void
  clearDeliveryDuplicateCheck: () => void
  handleAddCustomer: () => void
  handleAddDelivery: () => void
  handleCreateSeparateCustomer: () => void
  handleCreateSeparateDelivery: () => void
  handleUseExistingCustomer: (match: ContactDuplicateMatch) => void | Promise<void>
  handleUseExistingDelivery: (match: ContactDuplicateMatch) => void | Promise<void>
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

function DuplicateDecisionPanel({ check, entityLabel, saving, onUseExisting, onCreateSeparate, onBack, t }: {
  check: ContactDuplicateCheck | null
  entityLabel: string
  saving: boolean
  onUseExisting: (match: ContactDuplicateMatch) => void | Promise<void>
  onCreateSeparate: () => void
  onBack: () => void
  t: Translator
}) {
  if (!check?.matches.length) return null
  const hasPhoneConflict = check.matches.some((match) => match.severity === 'phone_conflict')
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
      <p className="font-semibold">{t('contact_duplicate_decision_title') || 'Possible duplicate'}</p>
      <p className="mt-1 text-xs">
        {hasPhoneConflict
          ? (t('contact_duplicate_phone_conflict_message') || `This phone belongs to an existing ${entityLabel}. Choose the correct record or enter a different phone.`)
          : (t('contact_duplicate_possible_message') || `An existing ${entityLabel} has this name and phone. Use it or explicitly create a separate record.`)}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {check.matches.map((match) => (
          <button key={match.id} type="button" className="btn-secondary justify-start" disabled={saving} onClick={() => { void onUseExisting(match) }}>
            {t('contact_duplicate_use_existing') || 'Use existing'}: {match.name || `#${match.id}`}{match.phone ? ` (${match.phone})` : ''}
          </button>
        ))}
        {check.allowedActions.includes('create_separate') ? (
          <button type="button" className="btn-primary" disabled={saving} onClick={onCreateSeparate}>
            {t('contact_duplicate_create_separately') || 'Create separately'}
          </button>
        ) : null}
        <button type="button" className="text-left text-xs font-semibold underline underline-offset-2" disabled={saving} onClick={onBack}>
          {t('contact_duplicate_back_to_edit') || 'Back to edit'}
        </button>
      </div>
    </div>
  )
}

export default function POSQuickAddModals({
  closeAddCustomerModal,
  closeAddDeliveryModal,
  customerDuplicateCheck,
  deliveryDuplicateCheck,
  clearCustomerDuplicateCheck,
  clearDeliveryDuplicateCheck,
  handleAddCustomer,
  handleAddDelivery,
  handleCreateSeparateCustomer,
  handleCreateSeparateDelivery,
  handleUseExistingCustomer,
  handleUseExistingDelivery,
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
        <QuickAddModal title={t('add_new_customer')} saving={savingCustomer} saveDisabled={!!customerDuplicateCheck} onSave={handleAddCustomer} t={t} onClose={closeAddCustomerModal}>
          <DuplicateDecisionPanel check={customerDuplicateCheck} entityLabel="customer" saving={savingCustomer} onUseExisting={handleUseExistingCustomer} onCreateSeparate={handleCreateSeparateCustomer} onBack={clearCustomerDuplicateCheck} t={t} />
          <div>
            <label htmlFor="pos-quick-customer-name" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('name')} *</label>
            <input id="pos-quick-customer-name" name="pos_quick_customer_name" className="input" value={newCustomerForm.name} onChange={(event) => setNewCustomerForm((form) => ({ ...form, name: event.target.value }))} autoComplete="name" autoFocus />
          </div>
          {/* Phone directly after the name -- the default/first contact
              information (user, Aug 28); membership follows. */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="pos-quick-customer-phone" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('phone_number') || 'Phone Number'}</label>
              <input id="pos-quick-customer-phone" name="pos_quick_customer_phone" className="input" value={newCustomerForm.phone} onChange={(event) => {
                const phone = formatPhoneInputElement(event.currentTarget)
                setNewCustomerForm((form) => ({ ...form, phone }))
              }} onKeyDown={(event) => handlePhoneInputKeyDown(event, (phone) => setNewCustomerForm((form) => ({ ...form, phone })))} onBeforeInput={(event) => handlePhoneInputBeforeInput(event, (phone) => setNewCustomerForm((form) => ({ ...form, phone })))} autoComplete="tel" inputMode="tel" />
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
        <QuickAddModal title={t('add_delivery_contact') || 'Add Delivery Contact'} saving={savingDelivery} saveDisabled={!!deliveryDuplicateCheck} onSave={handleAddDelivery} t={t} onClose={closeAddDeliveryModal}>
          <DuplicateDecisionPanel check={deliveryDuplicateCheck} entityLabel="delivery contact" saving={savingDelivery} onUseExisting={handleUseExistingDelivery} onCreateSeparate={handleCreateSeparateDelivery} onBack={clearDeliveryDuplicateCheck} t={t} />
          <div>
            <label htmlFor="pos-quick-delivery-name" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Driver / Rider Name</label>
            <input id="pos-quick-delivery-name" name="pos_quick_delivery_name" className="input" value={newDeliveryForm.name} onChange={(event) => setNewDeliveryForm((form) => ({ ...form, name: event.target.value }))} autoComplete="name" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="pos-quick-delivery-phone" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Phone</label>
              <input id="pos-quick-delivery-phone" name="pos_quick_delivery_phone" className="input" value={newDeliveryForm.phone} onChange={(event) => {
                const phone = formatPhoneInputElement(event.currentTarget)
                setNewDeliveryForm((form) => ({ ...form, phone }))
              }} onKeyDown={(event) => handlePhoneInputKeyDown(event, (phone) => setNewDeliveryForm((form) => ({ ...form, phone })))} onBeforeInput={(event) => handlePhoneInputBeforeInput(event, (phone) => setNewDeliveryForm((form) => ({ ...form, phone })))} placeholder="012 345 678" autoComplete="tel" inputMode="tel" />
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
