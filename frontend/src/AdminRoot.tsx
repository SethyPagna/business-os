import type { ReactElement } from 'react'
import './web-api.ts'
import App from './App.tsx'
import { AppProvider } from './AppContext.tsx'

export default function AdminRoot(): ReactElement {
  return (
    <AppProvider publicMode={false}>
      <App />
    </AppProvider>
  )
}
