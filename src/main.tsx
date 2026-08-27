import React from 'react'
import { logger } from '@/lib/logger'
import * as ReactDOM from 'react-dom'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { App } from './App'
import './index.css'
import { initHealthMonitor } from '@/lib/plugin-health'

function logTime(stage: string, t0: number) {
  const elapsed = Math.round(performance.now() - t0)
  logger.info('main', `[STARTUP-TIME] ${stage} t=${elapsed}`)
  const tauri = (window as any).__TAURI__
  if (tauri?.invoke) {
    tauri.invoke('log_startup_time', { stage, elapsed_ms: elapsed }).catch((e: any) => {
      logger.error('main', '[STARTUP-TIME] invoke failed:', e)
    })
  } else {
    logger.error('main', '[STARTUP-TIME] __TAURI__.invoke not available')
  }
}

// 暴露 React 全局变量供插件共享宿主实例
;(window as unknown as Window).React = React
;(window as unknown as Window).ReactDOM = ReactDOM
// 暴露 jsx-runtime/sonner/i18next 供插件复用
;(window as unknown as Window).ReactJSXRuntime = ReactJSXRuntime
;(window as unknown as Window).SonnerToast = toast
;(window as unknown as Window).ReactI18Next = { useTranslation }

const mainT0 = performance.now()
logTime('main_script_begin', mainT0)

// Initialize plugin health monitor before rendering
initHealthMonitor()
logTime('health_monitor_init', mainT0)

// Theme is applied synchronously by the inline script in index.html
// before any paint occurs, preventing the white→black flash.
// The useTheme() hook in App will reconcile with the Tauri backend settings.

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
logTime('react_render_called', mainT0)
