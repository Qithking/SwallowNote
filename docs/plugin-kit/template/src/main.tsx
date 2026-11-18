import React from 'react'
import ReactDOM from 'react-dom/client'
import { Preview } from './preview'

// Standalone 开发模式入口：仅本地预览；打包产物入口为 src/index.tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>
)
