# 调试会话：wenyan-empty-themeid

**会话 ID**：`wenyan-empty-themeid`
**状态**：[CLOSED — 已修复并由用户验证]

## 症状

打开文颜排版对话框时，浏览器报出两类错误：

1. **React 重复 key 警告**：
   ```
   Encountered two children with the same key, ``. Keys should be unique ...
   ```

2. **文颜渲染错误**：
   ```
   [Error] [wenyan] render failed: – Error: 主题不存在: 
   ```

3. **预览内容空白**（首轮修复后）
4. **二次打开预览空白**（第二轮修复后）

## 根本原因（三个独立 bug）

### Bug 1：主题字段路径错误
- `@wenyan-md/core` 公众号主题结构为 `{ meta: { id, name, ... }, getCss }`，代码错误读取了 `theme.id` 而非 `theme.meta.id`，导致 `<option key>` 全部为空。
- **修复**：使用 `t.meta?.id` / `t.meta?.name`（gzh）与 `t.id`（hl）。

### Bug 2：传给 `applyStylesWithTheme` 的元素携带了隐藏样式
- 代码把带 `visibility: hidden; transform: translateX(-200vw)` 的外层 div 直接传给了库，库返回的 `outerHTML` 继承了这些样式，预览区被推到屏幕外。
- **修复**：拆分为「外层 wrapper（隐藏）」与「内层 article（id=wenyan，无隐藏样式）」；库只接触 article。

### Bug 3：预览 div 重挂载时 innerHTML 未设置
- `useEffect([html])` 只在 `html` 变化时触发，关闭再打开时 `html` 不变 → 新挂载的 div 永远是空。
- **修复**：使用 `dangerouslySetInnerHTML={{ __html: html }}` 让 React 在 mount/update 时自动同步。

## 验证

- `npx tsc --noEmit` 退出码 0
- `npx vite build` 成功
- `bash package.sh` 成功生成新 zip
- 用户确认：打开 → 关闭 → 再打开，预览均正常显示

## 修复文件

- `plugins/wenyan/src/WenyanDialog.tsx` — 主题映射、`dangerouslySetInnerHTML`
- `plugins/wenyan/src/useWenyanRenderer.ts` — wrapper/article 拆分

---

## 后续追加：Mermaid 图表支持（2026-06-16）

**新增需求**：用户报告排版插件未渲染 mermaid 图表（仅显示为代码块）。

### 根因

`@wenyan-md/core` 的 `createWenyanCore` 在传入 `mermaid: true` 时要求提供 `renderer`，否则遇到 ```mermaid``` 代码块会抛错。原代码未传 mermaid 配置。

### 修复

`plugins/wenyan/src/useWenyanRenderer.ts` 在 `createWenyanCore` 时传入库自带的浏览器实现：

```ts
const mermaidRenderer = mod.createBrowserMermaidRenderer()
const instance = await mod.createWenyanCore({
  isConvertMathJax: true,
  isWechat: true,
  mermaid: { renderer: mermaidRenderer },
})
```

### 验证

- `npx tsc --noEmit` 退出码 0
- `bash package.sh` 成功生成新 zip（sha256: `68ef2e517b8318529f69adc3f2490145ebf35fb137cb71ab46e5cd697046e13b`）


