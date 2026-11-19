import React from 'react'
import { logger } from '@/lib/logger'
import { createPluginLogger } from '@/lib/logger'
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
    // Tauri v2 参数按 camelCase 匹配 Rust 的 elapsed_ms
    tauri.invoke('log_startup_time', { stage, elapsedMs: elapsed }).catch((e: any) => {
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
// 插件专属 logger 工厂：loader 改写插件裸 console.* 时按模块注入调用（source=plugin:<id>）
;(window as unknown as { __snCreatePluginLogger: (id: string) => unknown }).__snCreatePluginLogger =
  (id: string) => createPluginLogger(id)

const mainT0 = performance.now()
logTime('main_script_begin', mainT0)

// 全局错误兜底：未被 ErrorBoundary / 局部 catch 捕获的错误统一进应用日志。
// React 渲染错误会同时被 ErrorBoundary 记录（source=error-boundary），日志里
// 两条并存（app-uncaught 为兜底视角），可按 source 过滤。
window.addEventListener('error', (e) => {
  // 资源加载错误（img/script 失败）无 error 对象细节，降噪跳过
  const err = e.error ?? e.message
  if (!err) return
  logger.error('app-uncaught', 'window.onerror:', err)
})
window.addEventListener('unhandledrejection', (e) => {
  logger.error('app-uncaught', 'unhandled promise rejection:', e.reason)
})

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
