# 右键菜单贡献

插件可以向宿主 5 个右键菜单位置注入自定义条目。

## 支持的位置

| `location` | 触发场景 | 注入位置 |
| --- | --- | --- |
| `fileTree` | 在文件树节点上右键 | `FileTreeContextMenu` 末尾 |
| `fileTreeEmpty` | 在文件树空白区右键 | （未接入，预留） |
| `editor` | 在编辑器内右键 | `EditorContextMenu` 末尾 |
| `tab` | 在 tab 上右键 | `TabBar` 末尾 |
| `tabBarEmpty` | 在 tab bar 空白处右键 | （未接入，预留） |

## API

```typescript
import { registerContextMenu, unregisterContextMenu } from '@/lib/plugin-menu'

interface ContextMenuItem {
  id: string                                  // 稳定 id（建议加 namespace）
  label: string                               // 菜单项文字
  iconName?: string                           // lucide icon 名
  locations?: ContextMenuLocation[]           // 缺省 = 全部
  when?: (ctx: ContextMenuContext) => boolean // 谓词，false 隐藏
  onClick: (ctx: ContextMenuContext) => void | Promise<void>
}

interface ContextMenuContext {
  location: ContextMenuLocation
  path?: string          // 触发处的路径（fileTree / tab / editor）
  isDirectory?: boolean  // 是否目录
  activePath?: string    // 当前激活的 tab 路径
  selection?: string     // 编辑器选中文本
}
```

## 完整示例

```typescript
import { registerContextMenu, unregisterContextMenu } from '@/lib/plugin-menu'
import { pluginEventBus } from '@/lib/plugin-host'

function onLoad(ctx: { pluginId: string }) {
  // 1. 文件树节点上的"复制路径"条目
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:copy-path',
    label: 'Copy path to clipboard',
    iconName: 'Copy',
    locations: ['fileTree', 'tab'],
    onClick: async (mctx) => {
      if (!mctx.path) return
      await navigator.clipboard.writeText(mctx.path)
    },
  })

  // 2. 编辑器选中文本时显示"翻译"
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:translate',
    label: 'Translate selection',
    iconName: 'ExternalLink',
    locations: ['editor'],
    when: (mctx) => !!mctx.selection && mctx.selection.length > 0,
    onClick: (mctx) => {
      console.log('Translating:', mctx.selection)
      // pluginEventBus.emit('ai:request', { ... })
    },
  })

  // 3. 只在 .md 文件上显示"插入模板"
  registerContextMenu(ctx.pluginId, {
    id: 'my-plugin:insert-template',
    label: 'Insert template',
    iconName: 'FilePlus',
    locations: ['fileTree', 'tab'],
    when: (mctx) => !!mctx.path && mctx.path.endsWith('.md'),
    onClick: (mctx) => console.log('Insert into', mctx.path),
  })
}

function onUnload(ctx: { pluginId: string }) {
  // 显式清理（host 卸载插件时也会自动调 clearPluginMenuItems）
  unregisterContextMenu(ctx.pluginId, 'my-plugin:copy-path')
  unregisterContextMenu(ctx.pluginId, 'my-plugin:translate')
  unregisterContextMenu(ctx.pluginId, 'my-plugin:insert-template')
}
```

## `when` 谓词

谓词在每次右键时调用，返回 `false` 隐藏该项。**双层过滤**：

1. `locations` 决定出现在哪些 surface
2. `when` 决定在该 surface 上具体何时显示

```typescript
when: (ctx) => {
  if (ctx.location !== 'fileTree') return false       // 显式限定 location
  if (!ctx.path?.endsWith('.md')) return false        // 只 .md 文件
  if (ctx.isDirectory) return false                   // 不是目录
  return true
}
```

## iconName 白名单

支持 32 个 lucide name（不区分大小写）：

```
FileText, Settings, Trash2, Edit3, Copy, Scissors, ClipboardPaste,
Save, Download, Upload, Search, Eye, Code, Terminal, Play, Square,
Pause, RefreshCw, FolderPlus, FilePlus, GitBranch, GitCommit,
GitMerge, Star, Heart, Bookmark, Link, ExternalLink, Plus, Minus,
Check, X
```

未知 name 渲染为 `FileText`。完整列表见 [PluginContextMenuItems.tsx](../../src/components/Plugin/PluginContextMenuItems.tsx) `ICON_MAP`。

## 生命周期

```
plugin onLoad        → registerContextMenu(pluginId, item)  立即生效
plugin onUnload      → unregisterContextMenu(pluginId, itemId)  显式清理
host unregisterPlugin → clearPluginMenuItems(pluginId)  自动清理
```

三道防线确保卸载插件后菜单不残留。

## 错误隔离

handler 抛异常被 host 吞掉，不影响菜单关闭或其他条目：

```typescript
onClick: async (ctx) => {
  throw new Error('oops')  // host 隔离，不会冒泡
}
```

## 源码引用

- 类型定义：[src/types/plugin.ts](../../src/types/plugin.ts) `ContextMenuItem` / `ContextMenuContext`
- 注册表实现：[src/lib/plugin-menu.ts](../../src/lib/plugin-menu.ts) `ContextMenuRegistryImpl`
- 渲染组件：[src/components/Plugin/PluginContextMenuItems.tsx](../../src/components/Plugin/PluginContextMenuItems.tsx)
- 卸载清理：[src/stores/plugin.ts](../../src/stores/plugin.ts) `unregisterPlugin`
- 注入点：
  - [src/components/FileTree/FileTreeContextMenu.tsx](../../src/components/FileTree/FileTreeContextMenu.tsx)
  - [src/components/TabBar.tsx](../../src/components/TabBar.tsx)
  - [src/components/editors/EditorContextMenu.tsx](../../src/components/editors/EditorContextMenu.tsx)
