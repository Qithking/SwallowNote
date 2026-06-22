# Debug Session: Plugin Manager Load Performance

## 症状
- 打开插件管理页加载速度较慢

## 重现步骤
1. 启动 SwallowNote
2. 打开插件管理面板（Plugin Manager）
3. 观察从点击到卡片渲染完成的耗时

## 环境
- macOS, Tauri 桌面应用
- 前端: React + Zustand
- 后端: Rust (Tauri commands)

## 假设 (Hypotheses)
1. H1: 串行的 `await scanPlugins()` → `await loadAllPlugins()` → `setPlugins()` 阻塞渲染 — **确认成立**
2. H2: 大量插件加载时 `loadAllPlugins` 内的 Blob URL 动态导入序列化执行 — **已部分缓解（自适应并发度）**
3. H3: 4 方向的全表 stats 计算在每次渲染重新执行 — **已优化（O(4NM) → O(4M+N)）**
4. H4: 全量加载的插件立刻 fire onLoad hook，阻塞 store 更新 — **未变，async 已经是 fire-and-forget**
5. H5: `metricsSnapshot` 的初始 `getAllPluginMetrics` 同步扫描阻塞首屏 — **未变（已用 requestIdleCallback 延迟）**
6. H6: `VirtualizedCardGrid` 在 `ManageTab` 不可见时仍渲染并预计算 — **未确认（不是本次审查重点）**

## 进度
- [x] 静态分析完成
- [x] 性能瓶颈分析
- [x] 修复完成
- [x] 类型检查通过
- [x] lint 通过（0 errors）
