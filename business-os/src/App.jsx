import { useEffect } from 'react'
import { useApp } from './AppContext'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import Products from './components/Products'
import POS from './components/POS'
import Sales from './components/Sales'
import Inventory from './components/Inventory'
import Branches from './components/Branches'
import Users from './components/Users'
import ReceiptSettings from './components/ReceiptSettings'
import { AuditLog, Backup, Settings } from './components/Utils'
import Contacts from './components/Contacts'

function Notification({ notification }) {
  if (!notification) return null
  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600', warning: 'bg-yellow-600' }
  return (
    <div className={`fixed bottom-5 right-5 z-[100] ${colors[notification.type] || 'bg-gray-800'} text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium fade-in max-w-xs`}>
      {notification.type === 'success' ? '✓ ' : notification.type === 'error' ? '✗ ' : 'ℹ '}{notification.message}
    </div>
  )
}

const PAGE_COMPONENTS = {
  dashboard:        Dashboard,
  products:         Products,
  pos:              POS,
  sales:            Sales,
  inventory:        Inventory,
  branches:         Branches,
  contacts:         Contacts,
  users:            Users,
  audit_log:        AuditLog,
  receipt_settings: ReceiptSettings,
  backup:           Backup,
  settings:         Settings,
}

export default function App() {
  const { user, page, notification, canAccessPage, AccessDenied } = useApp()

  // Fix: restore renderer focus after Electron native dialogs (file picker, save dialog, etc.)
  // These dialogs steal focus from the window and inputs stop responding until restart.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to let Electron finish transition
        setTimeout(() => {
          const focused = document.activeElement
          if (!focused || focused === document.body) {
            // Try to find a focusable element or just ensure window is interactive
            document.dispatchEvent(new MouseEvent('mousemove'))
          }
        }, 150)
      }
    }
    const handleWindowFocus = () => {
      // When Electron window regains focus (after dialog), ensure renderer is interactive
      setTimeout(() => {
        if (document.activeElement === document.body) {
          document.body.click()
          // Don't steal focus from body; just trigger a safe interaction reset
        }
      }, 50)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [])

  if (!user) return <Login />

  const PageComponent = PAGE_COMPONENTS[page] || Dashboard
  const allowed = canAccessPage(page)

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {allowed ? <PageComponent /> : <AccessDenied />}
      </main>
      <Notification notification={notification} />
    </div>
  )
}
