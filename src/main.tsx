import React from 'react'
import ReactDOM from 'react-dom'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { App } from './App'
import './index.css'
import { initHealthMonitor } from '@/lib/plugin-health'

// Expose React and ReactDOM as globals so external plugins can share
// the host's React instance instead of bundling their own copy.
// Without this, plugins that use hooks crash with
// "null is not an object (evaluating 'React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.current.useState')"
// because two separate React instances cannot share hook state.
// NOTE: We expose the full `react-dom` (not `react-dom/client`) because
// plugins may use ReactDOM.createPortal, ReactDOM.flushSync, etc.
;(window as unknown as Window).React = React
;(window as unknown as Window).ReactDOM = ReactDOM
// Expose react/jsx-runtime so plugins using the automatic JSX transform
// can reference the host's runtime instead of bundling their own copy.
;(window as unknown as Window).ReactJSXRuntime = ReactJSXRuntime
// Expose sonner and react-i18next so plugins can share the host's
// instances instead of bundling their own copies (which would create
// separate toast containers / i18n instances that don't work correctly).
;(window as unknown as Window).SonnerToast = toast
;(window as unknown as Window).ReactI18Next = { useTranslation }

// Initialize plugin health monitor before rendering
initHealthMonitor()

// Theme is applied synchronously by the inline script in index.html
// before any paint occurs, preventing the white→black flash.
// The useTheme() hook in App will reconcile with the Tauri backend settings.

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
