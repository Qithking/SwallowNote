import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { getAppSettings } from '@/lib/tauri'
import './index.css'

async function initTheme() {
  try {
    const settings = await getAppSettings()
    const root = document.documentElement
    if (settings.theme === 'dark') {
      root.classList.add('dark')
    } else if (settings.theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.toggle('dark', prefersDark)
    }
  } catch {
    // DB not ready, use default light theme (no .dark class)
  }
}

initTheme().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
