import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

// Theme is applied synchronously by the inline script in index.html
// before any paint occurs, preventing the white→black flash.
// The useTheme() hook in App will reconcile with the Tauri backend settings.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
