// ── ManageMenu ───────────────────────────────────────────────────────────────
// Unified dropdown to manage categories, units, and custom fields.
import PortalMenu from '../shared/PortalMenu'

export default function ManageMenu({ onCats, onUnits, onFields, t }) {
  return (
    <PortalMenu
      trigger={
        <button className="btn-secondary text-xs sm:text-sm" aria-haspopup="true">
          ⚙️ {t('manage')||'Manage'} ▾
        </button>
      }
      items={[
        { label: `🏷 ${t('categories')}`,                                onClick: onCats   },
        { label: `📏 ${t('units')}`,                                     onClick: onUnits  },
        { label: `🧩 ${t('custom_fields')||'Custom Fields'}`,            onClick: onFields },
      ]}
      align="right"
    />
  )
}
