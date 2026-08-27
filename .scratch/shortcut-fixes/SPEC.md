# Spec: 快捷键系统缺陷修复

## Problem Statement

SwallowNote 的快捷键系统存在多个影响用户体验和功能正确性的缺陷：

- 插件命令快捷键的 bindingKey 解析策略不一致（`indexOf(':')` vs `lastIndexOf(':')`），导致使用 reverse-DNS 风格 ID 的插件快捷键在派发时无法正确匹配，功能完全失效
- `logViewer` 和冲突检测的 i18n 翻译键缺失，导致设置页面显示原始键名而非本地化文本
- Welcome 页面硬编码 macOS 风格快捷键符号（⌘），Windows/Linux 用户看到不符合平台习惯的提示
- macOS 上 Ctrl+Delete 的匹配逻辑存在误匹配风险
- ShortcutRecorder 录制时无条件阻止浏览器默认行为，与 PluginCommandRecorder 的更优实现不一致
- `newFolder` 中文翻译措辞有歧义

## Solution

统一快捷键系统的 bindingKey 解析策略、补全缺失的 i18n 翻译、修复平台相关的显示与匹配问题，使快捷键功能在所有平台和所有插件 ID 格式下正确工作。

## User Stories

1. As a plugin author using a reverse-DNS plugin ID (e.g. `com.example.notes:export`), I want my plugin's keyboard shortcut to fire when the user presses the bound key, so that my plugin feature is accessible via keyboard
2. As a plugin author, I want the conflict toast to show my correct plugin ID, so that users can identify which plugin is conflicting
3. As a user browsing the Shortcuts settings, I want every shortcut row to show a localized label and description, so that I understand what each shortcut does
4. As a user recording a shortcut that conflicts with a built-in or plugin command, I want to see a clear localized conflict message, so that I can make an informed decision about the binding
5. As a Windows user on the Welcome screen, I want to see `Ctrl+P` instead of `⌘P`, so that the shortcut hints match my platform
6. As a user who has customized shortcuts, I want the Welcome screen hints to reflect my custom bindings, so that I see accurate information
7. As a macOS user pressing Ctrl+Delete, I want the deleteFile shortcut to only fire when I press the actual Forward Delete key, not when I press Backspace
8. As a user recording a shortcut in the built-in ShortcutRecorder, I want modifier-only key presses (Ctrl, Shift, Alt) to not block browser default behavior, so that I can still use Ctrl+scroll etc. during recording
9. As a Chinese-speaking user, I want the "New Folder" shortcut label to say "新建文件夹" instead of the ambiguous "新建目录文件"
10. As a developer, I want all bindingKey parsing to use the same convention (`lastIndexOf(':')`), so that the codebase is consistent and reverse-DNS plugin IDs work everywhere
11. As a developer, I want the macOS platform detection to use a non-deprecated API, so that the app remains compatible with future browser/WebView updates
12. As a user, I want Escape to close any open overlay (not just the command palette), so that I can dismiss dialogs consistently
13. As a user, I want Ctrl+1-9 tab switching to be discoverable in the settings UI, so that I know this feature exists

## Implementation Decisions

### 1. bindingKey 解析策略统一

- **模块**: `useKeyboardShortcuts` hook
- **决策**: 将插件命令派发循环中的 `bindingKey.indexOf(':')` 改为 `bindingKey.lastIndexOf(':')`，与 `dispatchBuiltin`、`prunePluginCommandShortcuts`、测试文件中的约定保持一致
- **理由**: bindingKey 格式为 `<pluginId>:<commandId>`，pluginId 可能包含冒号（reverse-DNS 如 `com.foo.bar:baz`），最后一个冒号是 pluginId 与 commandId 的分隔符。`indexOf` 会在第一个冒号处截断，导致 pluginId 不完整、commandId 多余
- **影响范围**: 仅影响 pluginId 包含冒号的插件。现有不含冒号的 pluginId 不受影响（`indexOf` 和 `lastIndexOf` 结果相同）

### 2. i18n 翻译补全

- **模块**: `zh-CN.json`、`en.json`
- **新增键**:
  - `shortcuts.logViewer` / `shortcuts.logViewer.desc` — 日志查看器快捷键标签
  - `shortcuts.conflict.builtin` — 内置快捷键冲突提示（`findShortcutConflictDetailed` 使用）
  - `shortcuts.conflict.plugin` — 插件命令冲突提示（`findShortcutConflictDetailed` 使用）
- **修正键**: `shortcuts.newFolder` zh-CN 从 "新建目录文件" 改为 "新建文件夹"

### 3. Welcome 页面动态快捷键显示

- **模块**: `Editor.tsx` 的 `WelcomeScreen` 组件
- **决策**: 将硬编码的 `⌘P`/`⌘N`/`⌘S`/`⌘,` 替换为 `formatShortcutForDisplay(getShortcutKey(...))` 调用
- **理由**: `formatShortcutForDisplay` 已有 macOS 符号替换逻辑，`getShortcutKey` 已读取自定义绑定，两者结合即可同时解决平台适配和自定义绑定同步两个问题

### 4. macOS 平台检测 API 更新

- **模块**: `shortcuts.ts` 的 `formatShortcutForDisplay`
- **决策**: 将 `navigator.platform.toUpperCase().includes('MAC')` 替换为 `navigator.userAgent.toUpperCase().includes('MAC')`
- **理由**: `navigator.platform` 已被 MDN 标记为 deprecated；`navigator.userAgent` 在 Tauri WebView2 中稳定可用，且同样能区分 macOS
- **注意**: `StatusBar.tsx` 中也有类似的 `navigator.platform` 用法，但不在本 spec 范围内，可后续统一处理

### 5. macOS Delete/Backspace 误匹配修复

- **模块**: `shortcuts.ts` 的 `matchShortcut`
- **决策**: 移除 macOS Delete 与 Backspace 的无条件互相兼容逻辑；仅在 macOS 平台上且 `e.key === 'Backspace'` 时将 `mainKey === 'delete'` 视为匹配（模拟 Mac 的 Backspace 键标签为 Delete 的物理键盘布局差异）
- **理由**: 当前逻辑在 Windows 上会导致 `Ctrl+Backspace` 误匹配 `Ctrl+Delete`（deleteFile 快捷键），因为 Windows 的 Backspace 键 `e.key` 是 `'Backspace'`，但互换逻辑会将其匹配到 `'delete'`

### 6. ShortcutRecorder 录制行为优化

- **模块**: `ShortcutRecorder.tsx`
- **决策**: 将 `e.preventDefault()` 和 `e.stopPropagation()` 从 `handleKeyDown` 顶部移到 `parseKeyEvent` 返回非 null 之后，与 `PluginCommandRecorder` 的实现保持一致
- **理由**: 纯修饰键（Ctrl、Shift、Alt）不应阻止浏览器默认行为；仅在确认完整 chord 后才消费事件

### 7. Escape 浮层关闭与 Ctrl+1-9 可发现性

- **决策**: 这两项作为 future enhancement 记录，不在本 spec 实现范围内。Escape 浮层栈管理需要跨组件的统一状态设计，Ctrl+1-9 可发现性需要 UI 设计决策（是否加入 DEFAULT_SHORTCUTS、如何展示不可自定义的快捷键等）

## Testing Decisions

### 测试 seam

- **主 seam**: `src/lib/shortcuts.ts` 的纯函数层 — `matchShortcut`、`parseKeyEvent`、`findShortcutConflictDetailed`、`formatShortcutForDisplay`
- **辅助 seam**: `src/hooks/useKeyboardShortcuts.ts` 导出的 `dispatchBuiltin`（已有测试直接调用模式）
- **i18n seam**: 渲染 SettingsView 检查 t() 调用（已有 `Settings.shortcuts.i18n.test.tsx` 模式）

### 什么构成好测试

- 仅测试外部行为（函数输入/输出），不测试实现细节
- 不依赖 React 渲染、DOM 结构、store 状态（纯函数测试除外）
- 每个测试覆盖一个明确的行为契约

### 新增测试模块

1. **`matchShortcut` 单元测试** — 覆盖以下场景：
   - 基本 Ctrl+S 匹配
   - Ctrl+Shift+S 匹配
   - F2 单键匹配
   - Ctrl+Delete 匹配
   - macOS 上 Ctrl+Backspace 不应匹配 Ctrl+Delete
   - Windows 上 Ctrl+Backspace 不应匹配 Ctrl+Delete
   - 不带修饰键时不误匹配带修饰键的快捷键
   - 不需要的修饰键不存在时不应匹配

2. **`parseKeyEvent` 单元测试** — 覆盖以下场景：
   - 纯修饰键返回 null
   - Escape 返回 null
   - Ctrl+字母键生成 "Ctrl+X" 格式
   - Alt+字母键通过 e.code 归一化
   - 空格键映射为 "Space"

3. **bindingKey 解析一致性测试** — 覆盖以下场景：
   - 简单 pluginId（`com.foo:bar`）在 `dispatchBuiltin` 和派发循环中解析结果一致
   - 含冒号的 pluginId（`com.foo.bar:baz:cmd`）在两处解析结果一致

4. **i18n 完整性测试** — 扩展 `Settings.shortcuts.i18n.test.tsx`：
   - 验证 `shortcuts.logViewer` 和 `shortcuts.logViewer.desc` 在 locale 中存在
   - 验证 `shortcuts.conflict.builtin` 和 `shortcuts.conflict.plugin` 在 locale 中存在

### 已有测试先例

- `keyboard-shortcut-plugin-conflict.test.ts` — 直接调用 `dispatchBuiltin` 和 `findConflictingPluginCommandKey`，使用 `fakeKeyEvent` 构造事件
- `useKeyboardShortcuts.findReplace.test.ts` — 测试快捷键匹配和派发
- `Settings.shortcuts.i18n.test.tsx` — 渲染组件检查 t() 调用

## Out of Scope

- **Escape 统一浮层管理** — 需要设计跨组件的浮层栈状态，属于架构级变更
- **Ctrl+1-9 Tab 切换可发现性** — 需要产品决策（是否纳入 DEFAULT_SHORTCUTS、UI 呈现方式）
- **CodeMirror 内 Ctrl+F 双重处理风险** — 当前 `isCodeMirrorFocused` 检测在实测中工作正常，属于理论风险
- **`StatusBar.tsx` 中 `navigator.platform` 的替换** — 不在快捷键系统范围内，可后续统一处理
- **`FileTreeView` 与全局 listener 的 F2/Delete 双重注册审计** — 当前行为符合设计意图（仅在文件树挂载时生效），不构成 bug
- **`navigator.userAgentData` 迁移** — 当前 Tauri WebView2 不稳定支持此 API，使用 `userAgent` 即可

## Further Notes

- 所有修复均为向后兼容：`indexOf` → `lastIndexOf` 的变更对不含冒号的 pluginId 无影响，i18n 新增键不影响现有翻译
- `formatShortcutForDisplay` 中 `navigator.platform` → `navigator.userAgent` 的替换是安全降级：在 Tauri WebView2 环境下 `userAgent` 始终可用
- 建议在修复后运行全量测试确保无回归
