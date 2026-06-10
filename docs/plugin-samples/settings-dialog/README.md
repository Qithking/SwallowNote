# Settings Dialog 示例

带齿轮按钮的插件：用户在主面板和设置面板之间切换。

**学习目标**：
- 在 manifest 上声明 `settings: MySettingsComponent`
- 理解 settings 组件接收的 props（与 panel 相同）
- 用 `panel.close` 关闭 dialog
- `onMount` / `onUnmount` 钩子在 settings 中也会触发

## 文件

- [manifest.json](./manifest.json)
- [index.tsx](./index.tsx)

## 预期效果

- 侧边栏图标 + 右键菜单
- 卡片右侧出现齿轮按钮（**仅当 settings 字段存在时**）
- 点击齿轮 → 弹窗显示设置面板
- 设置面板内可修改 API key、勾选 auto-sync、保存关闭

## 关键点

| 项目 | 主面板 | 设置面板 |
| --- | --- | --- |
| 接收 props | `PluginPanelProps` | `PluginPanelProps`（相同） |
| `isActive` | `true` / `false` | 始终 `false` |
| 关闭方式 | `panel.close`（不影响其他面板） | `panel.close`（关闭 dialog） |
| 触发 `onMount` | ✅ | ✅ |

## 完整 API

参见 [settings.md](../../plugin-system/settings.md)
