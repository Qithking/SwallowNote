# Context Menu Item 示例

向宿主三个右键菜单位置（fileTree / editor / tab）贡献自定义条目。

**学习目标**：
- `registerContextMenu` 注册条目
- `unregisterContextMenu` / `clearPluginMenuItems` 清理
- `when` 谓词控制可见性
- `iconName` 与 `locations` 配置
- 在 `onLoad` 注册、`onUnload` 清理的双层防线

## 文件

- [manifest.json](./manifest.json)
- [index.tsx](./index.tsx)

## 预期效果

右键点击文件树 / tab / editor 时，菜单底部出现本插件贡献的条目：

| 菜单项 | 位置 | 谓词 |
| --- | --- | --- |
| "Copy path" | fileTree / tab | 总是显示 |
| "Reveal in editor" | fileTree / tab | 总是显示 |
| "Show word count" | editor | 必须有选中文本 |

## 完整 API

参见 [context-menu.md](../../plugin-system/context-menu.md)
