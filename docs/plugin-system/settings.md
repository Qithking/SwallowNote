# 设置面板

插件可以声明一个可选的 settings 组件，宿主在插件管理卡片右侧显示一个齿轮按钮，点击后弹窗显示。

## 声明 settings

```typescript
import type { PluginDefinition, PluginPanelProps } from '@/types/plugin'

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

## 源码引用

- 类型定义：[src/types/plugin.ts](../../src/types/plugin.ts) `PluginManifest.settings` / `PluginDefinition.settings`
- Dialog 渲染：[src/components/Plugin/PluginManagerView.tsx](../../src/components/Plugin/PluginManagerView.tsx)
- 加载逻辑：[src/lib/plugin-loader.ts](../../src/lib/plugin-loader.ts)（`manifest.settings` → `PluginDefinition.settings`）
