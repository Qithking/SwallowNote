# 设置面板

插件可以声明一个可选的 settings 组件，宿主在插件管理卡片右侧显示一个齿轮按钮，点击后弹窗显示。

## 声明 settings

```typescript
import type { PluginDefinition, PluginPanelProps } from '@swallow-note/plugin-sdk'
import { usePluginStorage } from '@swallow-note/plugin-sdk'

function MySettings(panel: PluginPanelProps) {
  const [apiKey, setApiKey] = usePluginStorage(panel, 'apiKey', '')

  return (
    <div className="p-4 space-y-3">
      <label>
        API key
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="border px-2 py-1 ml-2"
        />
      </label>
      <button onClick={panel.close}>Close</button>
    </div>
  )
}

const manifest: PluginDefinition = {
  id: 'com.example.api',
  name: 'API Plugin',
  // ...
  panel: MyMainPanel,
  settings: MySettings,  // ← 声明后齿轮按钮才会出现
}
```

## 接收的 props

settings 组件和 panel 组件接收**完全相同**的 `PluginPanelProps`：

```typescript
interface PluginPanelProps {
  pluginId: string
  isActive: boolean           // 对 settings 而言始终为 false
  close: () => void            // 关闭 dialog
  invokeBackend: (cmd, args?) => Promise<unknown>
  store: PluginStorage
  events: PluginEventBus
  activeNoteContent: string   // 当前活动笔记内容，无笔记时为空
  activeNotePath: string      // 当前活动笔记路径，无笔记时为空
  // 设置 API（详见下方“设置 API”小节）
  getSetting<T>(key: string): Promise<T | null>
  setSetting<T>(key: string, value: T): Promise<void>
  getAllSettings(): Promise<Record<string, unknown>>
  onSettingsChange(handler): () => void
  // Frontmatter API（详见下方“Frontmatter API”小节）
  getActiveNoteFrontmatter(): Record<string, unknown> | null
  setActiveNoteFrontmatter(data: Record<string, unknown>): void
  onNoteFrontmatterChanged(callback): () => void
}
```

**唯一区别**：`isActive` 在 settings dialog 中始终为 `false`（因为 dialog 是 modal，不是 tab），但**实际影响为 0**——`isActive` 只用于 host 内部触发 `onActivate/onDeactivate`，而 settings 组件本身不会注册这两个钩子。

## Dialog 行为

- 宽度：`max-w-2xl`（默认）
- 高度：`max-h-[80vh]`，内部 scroll
- 标题：`{plugin.name} — {t('plugin.settings')}`
- 副标题：`{plugin.description}`
- 关闭：点击遮罩 / ESC / `panel.close()`

## 完整示例：含预览的 theme 切换

```typescript
import type { PluginPanelProps } from '@/types/plugin'
import { usePluginStorage } from '@/lib/plugin-hooks'

type Theme = 'light' | 'dark' | 'auto'

function ThemeSettings(panel: PluginPanelProps) {
  const [theme, setTheme] = usePluginStorage<Theme>(panel, 'theme', 'auto')

  return (
    <div className="p-4 space-y-4">
      <h2 className="font-medium">Appearance</h2>
      <div className="flex gap-2">
        {(['light', 'dark', 'auto'] as Theme[]).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className={theme === t ? 'font-bold' : ''}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Current: {theme}. Changes apply immediately.
      </p>
      <div className="flex justify-end pt-2">
        <button onClick={panel.close} className="px-3 py-1 bg-muted rounded">
          Close
        </button>
      </div>
    </div>
  )
}
```

## 生命周期

- 打开：宿主 mount settings 组件 → 自动触发 `onMount(ctx)`
- 关闭：宿主 unmount → 自动触发 `onUnmount(ctx)`
- 由于 `onMount` 接收的 `ctx` 是 `PluginContext`（无 `close`），组件内要用 `panel.close` 而不是 `ctx.close`

## 多 tab 复杂设置

settings 组件本身没有 UI 框架约束，可以用项目里的 `Tabs` / `Card`：

```typescript
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

function ComplexSettings(panel: PluginPanelProps) {
  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
      </TabsList>
      <TabsContent value="general">{/* ... */}</TabsContent>
      <TabsContent value="advanced">{/* ... */}</TabsContent>
    </Tabs>
  )
}
```

## 设置 API

`PluginPanelProps`（以及 `ToolbarButtonProps`）注入了四个设置读写方法，背后由宿主的 SQLite 层支撑（独立预览模式下回退到 SDK 的内存 + localStorage stub）。这些方法**独立于 `store`**：`store` 是插件自由键值存储，而设置 API 走 `plugin_settings_<id>` 表，受 `settings.json` schema 约束。

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `getSetting` | `<T>(key) => Promise<T \| null>` | 按 schema 读取单个设置值，缺失时回退到 schema 默认值并返回 `null` |
| `setSetting` | `<T>(key, value) => Promise<void>` | 持久化单个设置键（写穿 SQLite），并 emit `plugin-settings:change` |
| `getAllSettings` | `() => Promise<Record<string, unknown>>` | 读取所有设置为扁平 key/value map，缺失键回退到 schema 默认值 |
| `onSettingsChange` | `(handler) => () => void` | 订阅设置变化，handler 收到完整设置 map；返回取消订阅函数 |

```typescript
import type { PluginPanelProps } from '@/types/plugin'
// 独立开发可改用：import type { PluginPanelProps } from '@swallow-note/plugin-sdk'

function SettingsPanel(panel: PluginPanelProps) {
  const load = async () => {
    // 读取单个值
    const apiKey = await panel.getSetting<string>('apiKey')
    // 读取全部设置
    const all = await panel.getAllSettings()
    console.log(apiKey, all)
  }

  // 订阅外部修改（例如用户在另一处 dialog 改了设置）
  useEffect(() => {
    return panel.onSettingsChange((next) => {
      console.log('settings changed:', next)
    })
  }, [panel])

  const save = () => panel.setSetting('apiKey', 'sk-new')

  return <button onClick={save}>Save</button>
}
```

> **模块级 API**：SDK 还导出 `getSetting(pluginId, key)` / `setSetting(pluginId, key, value)` / `getAllSettings(pluginId)` / `onSettingsChange(pluginId, handler)` / `emitPluginSettingsChanged(pluginId, values)`，适合在生命周期钩子等非组件场景使用。host 模式下转发到 SQLite，独立模式回退到 stub。

## Frontmatter API

`PluginPanelProps` / `ToolbarButtonProps` 还提供三个操作当前笔记 frontmatter 的方法，便于插件读写笔记元数据（如 tags、title、自定义字段）。

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `getActiveNoteFrontmatter` | `() => Record<string, unknown> \| null` | 获取当前活动笔记的 frontmatter 对象，无活动笔记时返回 `null` |
| `setActiveNoteFrontmatter` | `(data: Record<string, unknown>) => void` | **合并**更新当前笔记的 frontmatter（浅合并），无活动笔记时为空操作 |
| `onNoteFrontmatterChanged` | `(callback) => () => void` | 监听 frontmatter 变更事件，返回取消订阅函数 |

```typescript
import type { PluginPanelProps } from '@/types/plugin'

function FrontmatterPanel(panel: PluginPanelProps) {
  const read = () => {
    const fm = panel.getActiveNoteFrontmatter()
    if (!fm) return
    console.log('tags:', fm.tags)
  }

  // 监听 frontmatter 变更（例如用户在属性面板编辑了 tag）
  useEffect(() => {
    return panel.onNoteFrontmatterChanged((data) => {
      console.log('frontmatter updated:', data)
    })
  }, [panel])

  const addTag = () => {
    // 浅合并：仅覆盖传入的键，其余保留
    panel.setActiveNoteFrontmatter({ tags: ['note', 'demo'] })
  }

  return <button onClick={addTag}>Add tag</button>
}
```

> `setActiveNoteFrontmatter` 是**合并写**：传入 `{ tags: [...] }` 只更新 `tags` 字段，不触碰 frontmatter 中其他键。无活动笔记时调用为空操作（不抛错）。

## Settings Schema

插件可以通过 `settings.json` 文件声明设置的 schema，定义每个设置项的类型、默认值、可见性约束等。schema 在安装/更新时由 Rust 端读取并应用到 SQLite，运行时由 `getSetting` 等 API 消费。

### 文件位置

`settings.json` 放在插件根目录（与 `manifest.json` 同级），随插件 zip 一起分发：

```
my-plugin/
├── manifest.json
├── settings.json    ← 设置 schema（可选 sidecar）
├── index.tsx
└── dist/
    └── index.js
```

> 安装时 Rust 端会检测 active version dir 下是否存在 `settings.json`（见 [`plugin.rs`](../../src-tauri/src/commands/plugin.rs) 的 `has_settings_schema` 字段）。存在则由 `apply_settings_schema_on_disk` 读取并写入 SQLite。

### Schema 格式

`settings.json` 是一个对象，包含 `version`、可选的 `title` / `description`，以及 `fields` 数组。每个 field 描述一个设置项：

```json
{
  "version": 2,
  "title": "图床设置",
  "description": "配置默认图床、上传格式等选项。",
  "fields": [
    {
      "key": "defaultProvider",
      "label": "默认图床",
      "type": "select",
      "options": [
        { "value": "smms", "label": "SM.MS" },
        { "value": "imgur", "label": "Imgur" }
      ],
      "default": "smms",
      "required": true,
      "description": "选择默认图床。"
    },
    {
      "key": "maxFileSizeMB",
      "label": "最大文件大小 (MB)",
      "type": "number",
      "default": 10,
      "min": 1,
      "max": 100,
      "required": true
    },
    {
      "key": "enableHistory",
      "label": "启用上传历史",
      "type": "boolean",
      "default": true
    },
    {
      "key": "smmsToken",
      "label": "SM.MS Token",
      "type": "password",
      "secret": true,
      "visibleWhen": { "key": "defaultProvider", "equals": "smms" }
    }
  ]
}
```

### Schema 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `version` | `number` | 是 | schema 版本号。变化时触发 Rust 端 `migrate_values` 按新 schema diff 旧值并写回 |
| `title` | `string` | 否 | 设置面板标题 |
| `description` | `string` | 否 | 设置面板描述 |
| `fields` | `PluginSettingsField[]` | 是 | 设置项定义数组 |

### Field 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `key` | `string` | 是 | 设置项唯一键名，`getSetting(key)` 据此读取 |
| `type` | `PluginSettingsFieldType` | 是 | 设置项类型（见下表） |
| `label` | `string` | 是 | 设置面板中显示的标签 |
| `default` | `any` | 否 | 默认值。未设置时 `getSetting` 回退到此值；缺失则为 `null` |
| `required` | `boolean` | 否 | 是否必填（默认 false） |
| `secret` | `boolean` | 否 | 是否为敏感字段（如 Token），前端做脱敏展示 |
| `placeholder` | `string` | 否 | 输入框占位文本 |
| `options` | `{ value, label }[]` | 否 | `select` 类型的可选项，`value` 为存储值、`label` 为显示文本 |
| `visibleWhen` | `{ key, equals }` | 否 | 条件可见性：当 `values[key] === equals` 时才显示该字段 |
| `min` / `max` | `number` | 否 | `number` 类型的最小/最大值约束 |

### 支持的字段类型（`type`）

| 类型 | 说明 |
|------|------|
| `string` | 单行文本 |
| `string-multiline` | 多行文本 |
| `number` | 数字（可配 `min` / `max`） |
| `boolean` | 开关 |
| `select` | 下拉选择（需配 `options`） |
| `color` | 颜色选择器 |
| `directory` | 目录路径选择 |
| `password` | 密码输入（建议同时设 `secret: true`） |

### 与 getSetting 的关系

`readSetting`（[src/lib/plugin-settings/index.ts](../../src/lib/plugin-settings/index.ts)）读取设置时的回退顺序：

1. 先从 `values`（SQLite 持久化的值，host 模式）或内存缓存（standalone 模式）读取
2. 如果未找到，回退到 schema 中该 field 的 `default` 值
3. 如果 schema 中也没有定义 `default`，返回 `null`

因此，即使用户从未设置过某个值，只要 schema 中有 `default`，`getSetting` 就会返回默认值而非 `null`。安装时 Rust 端的 `defaults_from_schema` 会用每个 field 的 `default`（或 `Null`）初始化 SQLite 行。

### schema 版本与迁移

`version` 字段用于 schema 演进。当插件更新且 `settings.json` 的 `version` 变化时，Rust 端 `apply_settings_schema_on_disk` 会：

- **首次安装**：用 schema defaults 填充 SQLite 行
- **版本相同**：保留用户已有值不动
- **版本变化**：按新 schema diff 旧值——保留用户值（类型漂移会记录 `~key`），新字段填 default，丢弃新 schema 未声明的 key（降级为破坏性）

### 与 manifest.settings 组件的关系

`manifest.settings` 指定的是**设置面板 UI 组件**，而 `settings.json` 定义的是**设置数据 schema**。两者独立：

- **有 schema 无 UI 组件**：设置通过代码（`setSetting`）管理，宿主不会显示齿轮按钮，但 `getSetting` 仍能读取 schema 默认值
- **有 UI 组件无 schema**：UI 组件自行管理设置读写（如直接用 `usePluginStorage`），无默认值回退、无类型约束
- **推荐两者配合使用**：schema 定义数据与默认值，UI 组件提供用户编辑界面（参考 [picgo 插件](../../plugins/picgo/settings.json)）

## 源码引用

- 类型定义：[src/types/plugin.ts](../../src/types/plugin.ts) `PluginManifest.settings` / `PluginDefinition.settings`
- Dialog 渲染：[src/components/Plugin/PluginManagerView.tsx](../../src/components/Plugin/PluginManagerView.tsx)
- 加载逻辑：[src/lib/plugin-loader.ts](../../src/lib/plugin-loader.ts)（`manifest.settings` → `PluginDefinition.settings`）
