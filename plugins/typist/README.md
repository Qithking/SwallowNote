# 公众号排版插件（typist）

> 把 Markdown 排成公众号 / 小红书等平台主题的富文本，一键复制到目标平台编辑器。  
> 参考 [mdnice/markdown-nice](https://github.com/mdnice/markdown-nice) 的设计，但作为 **SwallowNote 外部插件** 复用现有插件体系。  
> **MVP 阶段仅覆盖 WeChat 公众号** —— 公众号编辑器是排版工具最难适配的平台（禁止外链样式表、要求内联 CSS、剪贴板 HTML 兼容性差），做透后再扩展小红书 / 知乎 / 掘金。

---

## 目录

1. [插件简介](#1-插件简介)
2. [架构概览](#2-架构概览)
3. [目录结构](#3-目录结构)
4. [manifest.json 字段说明](#4-manifestjson-字段说明)
5. [使用方法（端到端 4 步）](#5-使用方法端到端-4-步)
6. [剪贴板兼容性](#6-剪贴板兼容性)
7. [内置主题](#7-内置主题)
8. [已知限制（MVP）](#8-已知限制mvp)
9. [二次开发](#9-二次开发)
10. [构建与打包](#10-构建与打包)
11. [常见问题](#11-常见问题)

---

## 1. 插件简介

微信公众号编辑器粘贴外链样式表和 `<style>` 块的内容会被自动清理，第三方排版工具必须把所有 CSS **内联到元素的 `style` 属性**。同时，公众号后台是 Chromium 内核 WebView，富文本粘贴走 `ClipboardItem` 接口；其他平台或老 WebKit 上需要降级到纯文本或截图。

本插件把 **Markdown → 带主题的内联 CSS HTML → 剪贴板** 三步打包：

- **后端（Rust）** 用 `pulldown-cmark` 解析 Markdown，把主题色 / 字号 / 边距等视觉规则直接内联到每个标签的 `style="..."` 上
- **前端（React）** 在编辑器工具栏下挂一个「公众号排版」下拉按钮，浮窗面板实时预览所选主题
- **剪贴板** 三级降级：`ClipboardItem` 富文本 → `writeText` 纯文本 → `modern-screenshot` 截图 PNG

---

## 2. 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│  SwallowNote 宿主                                                    │
│                                                                      │
│  ┌──────────────────┐   invoke('invoke_plugin', ...)  ┌───────────┐ │
│  │  前端 (index.js)  │ ───────────────────────────────▶│ Rust 后端 │ │
│  │  • toolbarButton  │   JSON-RPC over stdin/stdout     │ 二进制    │ │
│  │  • panel (浮窗)   │◀────────────────────────────────│ markdown  │ │
│  │  • lib/copyTo     │   HTML fragment                  │ → themed  │ │
│  │    Clipboard.ts   │                                   │ HTML      │ │
│  └──────────────────┘                                   └───────────┘ │
│         │                                                          │   │
│         │  props.activeNoteContent / activeNotePath                │   │
│         ▼                                                          │   │
│  ┌──────────────────┐                                              │   │
│  │  宿主编辑器状态    │                                              │   │
│  └──────────────────┘                                              │   │
└──────────────────────────────────────────────────────────────────────┘
```

**关键原则**：插件完全自包含，与宿主零耦合。

- **前端**：React 组件，通过 SDK 拿到 `ToolbarButtonProps` / `PluginPanelProps`，包含 `activeNoteContent` / `activeNotePath` / `invokeBackend` / `store` / `events`
- **后端**：独立 Rust 二进制，不依赖 Tauri，通过 JSON-RPC over stdin/stdout 通信
- **宿主** 只提供通用机制（`invoke_plugin`、事件总线、存储），不包含任何插件专属代码

---

## 3. 目录结构

```
plugins/typist/
├── manifest.json               # 插件清单（宿主从磁盘读）
├── package.json                # npm 配置（前端构建依赖）
├── tsconfig.json               # TypeScript 配置
├── vite.config.ts              # Vite 构建（ES + @swallow-manifest 注释）
├── build.sh                    # 后端构建脚本
├── package.sh                  # 完整打包脚本（前端+后端→zip）
├── README.md                   # 本文档
├── src/                        # 前端
│   ├── index.tsx               # 主入口，导出 manifest
│   ├── panel/
│   │   ├── TypistPanel.tsx     # editorArea 浮窗面板
│   │   └── icons.tsx           # 4 个 SVG 图标
│   ├── toolbar/
│   │   └── TypistToolbarButton.tsx  # 工具栏下拉按钮
│   └── lib/
│       ├── copyToClipboard.ts  # 三级降级剪贴板写入
│       ├── htmlSanitizer.ts    # 防御性过滤（去 script/iframe/on*）
│       └── themes.ts           # 主题元数据（id/name 与后端同步）
└── src-tauri/                  # Rust 后端
    ├── Cargo.toml
    └── src/
        ├── main.rs             # JSON-RPC 入口（stdin/stdout 通信）
        ├── convert.rs          # Markdown → themed HTML 转换
        ├── themes.rs           # 5 套 WeChat 主题（颜色 + 字体常量）
        └── highlight.rs        # 轻量代码高亮（关键词着色）
```

构建产物：

```
dist/                          # Vite 构建输出
├── index.js                   # ES module bundle
└── manifest.json              # 复制的清单

com.swallownote.typist-0.1.0.zip  # 最终可安装的插件包
├── index.js
├── manifest.json
└── backend/
    └── plugin_com.swallownote.typist  # Rust 二进制
```

---

## 4. manifest.json 字段说明

```json
{
  "id": "com.swallownote.typist",
  "name": "公众号排版",
  "description": "将 Markdown 文档按微信公众号等平台主题排版，一键复制带样式的富文本",
  "version": "0.1.0",
  "author": "SwallowNote",
  "publishedAt": "2026-06-14",
  "iconPosition": "editorToolbar",
  "contentPosition": "editorArea",
  "order": 40,
  "enabled": true,
  "hasBackend": true,
  "entry": "index.tsx"
}
```

| 字段 | 值 | 说明 |
|---|---|---|
| `id` | `com.swallownote.typist` | 全局唯一标识，反向域名格式；ZIP 包名与二进制查找路径都依赖此 id |
| `iconPosition` | `editorToolbar` | 图标放在编辑器工具栏（也可选 `sidebar` / `titleBar`） |
| `contentPosition` | `editorArea` | 浮窗面板在编辑器上方（也可选 `fullPanel` 等） |
| `hasBackend` | `true` | **必须** 设为 true，否则宿主不会查找 `backend/` 目录 |
| `order` | `40` | 工具栏图标排序，排在 export(50) 之前 |
| `entry` | `index.tsx` | 源码入口；构建后宿主加载 `index.js` |
| `permissions` | `['storage', 'events', 'backend', 'clipboard']` | 运行时权限声明：持久化、事件订阅、调用后端、写入剪贴板 |

> 备注：`hasBackend` 字段仅在磁盘上的 `manifest.json` 出现；TypeScript 端 `PluginManifest` 类型不包含此字段（宿主从 JSON 文件读取），前端 manifest 对象中**不要** 添加。

---

## 5. 使用方法（端到端 4 步）

### 第 1 步：编辑器写 Markdown

在 SwallowNote 中正常编辑笔记即可，**无需任何特殊语法**。插件支持的 Markdown 元素：

- 标题（H1-H6）
- 段落、加粗、斜体、删除线
- 有序 / 无序列表、任务列表
- 引用块
- 行内代码、围栏代码块（带语言标识）
- 表格
- 链接、图片
- 分割线
- 软换行 / 硬换行

### 第 2 步：点击工具栏「公众号排版」图标

在编辑器工具栏找到新增的「公众号排版」图标（位置在 export 导出图标之前），点击后弹出下拉菜单：

- **打开排版面板** → 显示浮窗（含 Markdown 源码 + 主题预览）
- **复制到公众号** → 不打开浮窗，直接把当前笔记按已选主题渲染并复制
- **保存为 HTML** → 把当前笔记按已选主题渲染为独立 HTML 文件，写入磁盘

### 第 3 步：浮窗选主题 + 预览

浮窗加载后：

- **左侧** 只读 Markdown 源码
- **右侧** 实时预览所选主题的渲染结果（800ms 防抖，与 mdnice 节奏一致）
- **顶部** 主题下拉（5 套 WeChat 主题）
- **底部** 统计：字数、代码块数、图片数
- **顶部右侧** 渲染耗时（毫秒）

切换主题后预览会重新渲染。

### 第 4 步：点「复制到公众号」→ 公众号编辑器粘贴

点击「复制到公众号」按钮：

- **成功**：toast 提示「已复制到剪贴板（带样式）」
- **降级**：toast 提示「仅写入纯文本」或「已保存为 PNG，请拖入公众号编辑器」

打开微信公众号后台编辑器（Chrome / Edge / 公众号助手），`Cmd/Ctrl + V` 粘贴即可看到完整排版结果。

---

## 6. 剪贴板兼容性

本插件采用**三级降级**策略，按环境能力自动选择最优路径：

| 级别 | API | 适用环境 | 效果 |
|---|---|---|---|
| **L1** | `navigator.clipboard.write([new ClipboardItem({ 'text/html', 'text/plain' })])` | Tauri WebView（Chromium 内核）、Chrome、Edge | 公众号编辑器粘贴后**完整保留样式** |
| **L2** | `navigator.clipboard.writeText(plainText)` | 老 WebKit、权限被禁 | 仅写入去标签的纯文本；公众号编辑器用纯文本模式粘贴 |
| **L3** | `modern-screenshot` 截图 → 保存 PNG | L1 / L2 都不可用 | 弹保存对话框，用户保存后拖入公众号编辑器，效果等同图片粘贴 |

**实现位置**：`src/lib/copyToClipboard.ts` 顺序尝试 L1 → L2 → L3，前两层异常自动进入下一层。

**为什么必须三级降级**：

- L1 是理想路径，但需要 WebView 暴露 `ClipboardItem` 全局；部分 Tauri 版本（尤其 Linux WebKitGTK）不支持
- L2 会丢失全部样式，只在 L1 不可用时使用
- L3 是最后兜底，把预览 DOM 渲染成 PNG，效果与 L1 等同（图片形式），但需要用户多一步操作

---

## 7. 内置主题

5 套 WeChat 主题，颜色值参考 mdnice 主题重制（不照搬源码以规避 GPL 传染）：

| 主题 id | 名称 | 适用场景 |
|---|---|---|
| `wechat-default` | 公众号默认 | 蓝灰文字 + 蓝链接，最接近公众号原生风格 |
| `wechat-rose` | 蔷薇紫 | 紫色调（`#c027d6` accent），适合情感 / 女性向主题 |
| `wechat-geek` | 极客黑 | 深色背景 + 亮色字，适合技术向、代码截图向 |
| `wechat-tech` | 科技蓝 | 深蓝调（`#0066cc` accent），适合产品 / 技术教程 |
| `wechat-minimal` | 简约白 | 纯黑文字 + 大量留白，适合长文 / 严肃内容 |

主题的**所有 CSS 都在后端**（`src-tauri/src/themes.rs`），前端 `src/lib/themes.ts` 仅同步 id / name 元数据用于下拉显示。

---

## 8. 已知限制（MVP）

以下功能 **不在 MVP 范围**，列入 v0.2 或后续版本：

- **数学公式**（`$...$` / `$$...$$`）：pulldown-cmark 默认不解析；公众号支持度也差
- **TOC / 脚注 / 注音**：非公众号常见语法
- **图床**（GitHub / SMMS / 七牛）：图片需要外链才能在公众号里稳定显示，但本插件不做图床凭据存储与上传
- **Mermaid / 思维导图**：公众号不支持内嵌交互图表
- **自定义主题编辑器**：用户不能上传 CSS；主题需改后端常量
- **小红书 / 知乎 / 掘金**等平台：当前 `convert.rs` 只走 wechat 分支；v0.2 扩展
- **多语言 i18n**：UI 文案直接用中文，不接 i18n key
- **主题预览截图**：本 README 不含截图（需宿主环境渲染，MVP 不生成）

---

## 9. 二次开发

### 加主题

1. 在 `src-tauri/src/themes.rs` 新增 `Theme` 常量（参考 `WECHAT_ROSE`），并 append 到 `ALL_THEMES` 切片
2. 在 `src/lib/themes.ts` 的 `STATIC_THEMES` 数组同步追加 `{ id, name, platform }`
3. 重新执行 `bash build.sh release` + `npm run build`

### 加平台

1. 在 `src-tauri/src/convert.rs` 的 `start_tag` / `end_tag` 中按 `self.platform` 加分支（如 `"xhs"` 图片强制 4:3 居中）
2. 在 `src-tauri/src/themes.rs` 中为新平台加主题常量
3. 前端 `src/lib/themes.ts` 的 `DEFAULT_PLATFORM` 同步切换

### 加高亮语言

1. 在 `src-tauri/src/highlight.rs` 的 `normalize_lang` 加语言别名
2. 在 `highlight_with_lang` 的 `keywords` match 中加新语言的关键词列表
3. 在 `line_comment` / `block_comment_open` / `block_comment_close` match 中加注释符号

### 加后端命令

1. 在 `src-tauri/src/convert.rs`（或新建模块）实现转换函数
2. 在 `src-tauri/src/main.rs` 的 `handle_request()` 中加 `match` 分支
3. 前端通过 `invokeBackend('new_command', { ... })` 调用

---

## 10. 构建与打包

### 10.1 前端类型检查

```bash
cd plugins/typist
npx tsc --noEmit
# 或
npm run typecheck
```

### 10.2 前端构建

```bash
cd plugins/typist
npm run build
# 产物：dist/index.js + dist/manifest.json
```

### 10.3 后端构建

```bash
cd plugins/typist
bash build.sh          # debug
bash build.sh release  # release（推荐，体积更小）
# 产物：backend/plugin_com.swallownote.typist
```

### 10.4 完整打包

```bash
cd plugins/typist
bash package.sh release
# 产物：./com.swallownote.typist-0.1.0.zip
```

`package.sh` 自动完成：Vite 前端构建 → Cargo 后端构建 → 复制二进制到 `dist/backend/` → `zip` 打包。

### 10.5 安装

1. 打开 SwallowNote → 设置 → 插件管理
2. 拖拽 `com.swallownote.typist-0.1.0.zip` 到上传区域，或点击上传按钮选择文件
3. 插件出现在列表中，启用即可

---

## 11. 常见问题

### Q: 复制到公众号没生效 / 样式丢失？

按顺序检查：

1. 浏览器控制台是否报错？→ 打开 DevTools 看具体错误
2. WebView 版本是否支持 `ClipboardItem`？→ 在控制台输入 `typeof ClipboardItem` 检查
3. `manifest.json` 的 `permissions` 是否包含 `'clipboard'`？
4. 是否走了降级？→ toast 会明确提示「仅写入纯文本」或「保存为 PNG」

### Q: 主题切换了但预览没变？

- 浮窗有 800ms 防抖，等待后会自动重渲
- 确认后端返回成功（看顶部右侧 ms 数）
- 如果 ms 是 0 且无变化，看控制台是否有 `[typist] render failed:` 错误

### Q: 代码块没高亮？

- 当前支持的语言：`js` / `ts` / `py` / `rust` / `go` / `json` / `bash`（含 `javascript` / `typescript` / `python` / `rs` / `sh` / `shell` / `zsh` 别名）
- 其他语言（Java / C++ / Ruby / PHP 等）走纯转义，不着色
- 在 `src-tauri/src/highlight.rs` 加新语言的关键词列表即可（见 §9）

### Q: 图片在公众号里看不到？

- 公众号会过滤 `data:` 内联 base64 图片
- 必须是 HTTPS / 可被微信 CDN 缓存的 URL
- 本插件 MVP 不做图床上传，需先在编辑器里用图床工具把图片转成外链，再粘回 Markdown
- v0.2 计划集成图床

### Q: 数学公式 / 流程图 / 思维导图没渲染？

MVP 不支持（见 §8）。v0.2 列入计划。

### Q: 如何调试后端？

1. 在 `main.rs` / `convert.rs` 中用 `eprintln!()` 输出调试信息（宿主会记录到日志）
2. 手动运行二进制并输入 JSON-RPC 请求：

   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"markdown_to_themed_html","params":{"markdown":"# Hello","theme":"wechat-rose","platform":"wechat"}}' | \
     ./backend/plugin_com.swallownote.typist
   ```

### Q: 插件独立性能否保证？

| 检查项 | 验证方法 |
|---|---|
| 主应用 `src/` 中无插件代码 | `grep -r "com.swallownote.typist" src/` 应无结果 |
| 主应用 `src-tauri/` 中无插件代码 | `grep -r "swallownote_plugin_typist" src-tauri/src/` 应无结果 |
| 主应用 `Cargo.toml` 无插件依赖 | 不含 `swallownote-plugin-typist` / `pulldown-cmark`（pulldown-cmark 已被 export 间接引入，typist 不重复添加） |
| 删除插件目录后主应用可编译 | `mv plugins/typist /tmp/typist-bak && npx tsc --noEmit && cd src-tauri && cargo check` |

### Q: 二进制命名规则是什么？

| 阶段 | 文件名 | 说明 |
|---|---|---|
| Cargo 编译产物 | `plugin_com_swallownote_typist` | `_` 替代 `.` |
| 宿主期望的文件名 | `plugin_com.swallownote.typist` | 保留 `.` |
| Windows | `plugin_com.swallownote.typist.exe` | 自动加 `.exe` |

宿主查找路径：`<plugin_path>/backend/plugin_<plugin_id>[.exe]`

---

**关联文档**：[`.trae/documents/platform-typist-plugin-plan.md`](../../.trae/documents/platform-typist-plugin-plan.md) — 设计阶段的完整方案
