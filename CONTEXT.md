# Context

## Glossary

| Term | Meaning | Notes |
|---|---|---|
| LogLevel | 标准 5 级日志枚举：`trace` / `debug` / `info` / `warn` / `error` | 替代旧 `plugin-telemetry.ts` 的 `'info'\|'ok'\|'warn'\|'err'`；`'ok'` 映射为 `info`（成功事件=信息级） |
| LogEntry | 日志行结构：`{ timestamp, level, source, message, args? }` | 统一日志单元，存于 LogStore 内存缓冲 + app.log 文件 |
| Logger | 前端 TS API 层：`trace/debug/info/warn/error(source, message, ...args)` | 写入 LogStore + 文件（经 Tauri `append_log` 命令）+ 浏览器 console |
| LogStore | 前端内存环形缓冲（5000 条）+ 订阅机制 | 供 LogViewer 实时订阅；合并自旧 `plugin-telemetry.ts` 的环形缓冲 |
| PluginLogger | 插件 SDK 暴露的 logger 接口：`trace/debug/info/warn/error(message, ...args)` | 自动带 `plugin:<pluginId>` source 前缀，写入统一通道而非散落浏览器 console |
| LogViewer | 独立日志查看器 UI 组件 | `Ctrl+Shift+L` 打开；订阅 LogStore；支持级别/来源过滤、搜索、复制、导出 `.jsonl` |
| tauri-plugin-log | Tauri v2 官方日志插件 | 后端 Rust 日志后端，提供文件轮转 + 转发到前端 Webview console 能力 |
| app.log | 日志主文件路径：`{app_data_dir}/logs/app.log` | 5MB 上限，轮转为 `app.log.1`~`app.log.5`，磁盘上限 25MB |
| source | 日志来源标识字符串 | 如 `'ui'`、`'editor'`、`'git'`、`'plugin:com.foo'`；保留现有 `[module]` 前缀语义 |
| FindReplacePanel | 编辑器工具栏查找图标触发的内嵌下拉层(非弹框、非 popover) | 共用组件,按编辑器类型分发到 CodeMirror search API 或 ProseMirror Decoration 实现 |
| SearchQuery | 查找面板当前的查询参数:`{ text, caseSensitive, wholeWord, regexp }` | CodeMirror 与 BlockNote 各持一份,字段语义对齐 |
| MatchDecoration | BlockNote 查找高亮的 ProseMirror Decoration 实现 | 通过 `_tiptapEditor.view` 派发 transaction;高亮用 DecorationSet,替换用 ProseMirror transaction 的 replaceWith |
| ImagePreviewEditor | 只读图片查看器组件:滚轮缩放 + 拖拽平移 + 双击还原 | 注册为 `image-preview` descriptor 到 builtinEditorRegistry;图片路径经 `convertFileSrc` 转为 asset 协议 URL |
| FileType='image' | FileType 联合类型成员,用于浏览器可显示的图片格式 | detectFileType 对 `.png .jpg .jpeg .gif .webp .bmp .ico .svg .avif .apng` 返回此类型;SVG 从 `code` 改为 `image` 路由 |
| useIdleAutoPush | 空闲自动推送 hook:监听 `file-saved` 事件,防抖等待后推送 | 复用 `commitAndPushRepo`(commit+pull+push 全流程);设置项 `idleAutoPush` 默认开启、`idleAutoPushDelay` 默认 60s |
| idleAutoPush | 「保存后空闲自动推送」设置开关,默认 true(开箱即用) | 保存文件后经 `idleAutoPushDelay` 无新保存,即对涉及仓库自动 commit+push;关闭时已排期计时器一并取消 |
| idleAutoPushDelay | 空闲推送等待间隔(秒),默认 60,可选 30/60/120/300 | 每次保存重置计时;间隔修改对下一次保存生效 |
| file-saved | 文件保存完成事件:`{ detail: { path } }` | 手动保存(Ctrl+S)与 saveTab 均派发;useIdleAutoPush/CategoryView/HistoryView/FileTreeView 消费 |

