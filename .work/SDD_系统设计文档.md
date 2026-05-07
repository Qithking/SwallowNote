# SwallowNote 系统设计文档 (SDD)

**文档版本**: v1.0  
**最后更新**: 2026-05-07  
**状态**: 待评审  
**基于**: SRS v2.0

---

## 1. 引言

### 1.1 文档目的
本文档详细描述 SwallowNote 的系统架构设计、模块设计、接口设计和数据设计,为开发团队提供实现指导。

### 1.2 范围
- 系统整体架构设计
- 技术栈选型与理由
- 核心模块详细设计
- 数据模型设计
- API 接口设计
- 安全设计方案

### 1.3 参考文档
- 《SwallowNote 软件需求规格说明书 (SRS) v2.0》

---

## 2. 系统架构设计

### 2.1 技术栈选型

#### 2.1.1 桌面框架:**Tauri 2.0**

**选型理由**:
- **极致性能**:后端 Rust 编译为原生二进制,内存占用极低(几 MB vs Electron 的上百 MB)
- **启动速度快**:比 Electron 快数倍,实现真正的"秒开"
- **包体积小**:最终安装包仅几 MB,便于分发
- **系统 WebView**:使用操作系统自带 WebView(Windows WebView2、macOS WebKit、Linux WebKitGTK),无需捆绑 Chromium
- **安全性**:Rust 内存安全,无 GC 停顿,避免 JS 引擎的性能瓶颈

**备选方案对比**:
| 框架 | 优势 | 劣势 | 决策 |
|------|------|------|------|
| Tauri 2.0 | 轻量、性能好、Rust生态 | 学习曲线较陡 | ✅ 选用 |
| Electron | 生态成熟、VSCode验证 | 内存占用高、包体积大 | ❌ 不选 |
| Flutter Desktop | 性能好、UI一致 | Markdown生态弱 | ❌ 不选 |

#### 2.1.2 前端框架:**Svelte 5**

**选型理由**:
- **无虚拟 DOM**:编译时响应式,直接操作真实 DOM,避免 React Fiber 调和带来的微卡顿
- **输入延迟低**:高频输入时无虚拟 DOM diff 开销,实现真正的"零延迟"编辑体验
- **包体积极小**:编译后代码量远小于 React/Vue
- **适合编辑器场景**:VS Code 自身也未使用框架,Svelte 5 是最接近原生性能的现代框架

**为什么不选 React**:
- React 的虚拟 DOM 和频繁调和会在高频输入时产生微小卡顿(输入延迟)
- 对于追求极致性能的编辑器,React 的开销不可接受

#### 2.1.3 状态管理:**Svelte 5 Runes (内置)**

**选型理由**:
- **无需额外库**:Svelte 5 内置 `$state`、`$derived`、`$effect` 等 Runes,提供细粒度响应式
- **编译时优化**:编译器自动追踪依赖,无需手动优化
- **零运行时开销**:相比 Zustand/Redux,无额外的 store 管理成本

#### 2.1.4 Markdown 引擎:**CodeMirror 6 + markdown-it**

**选型理由**:
- **CodeMirror 6**:采用六边形架构,可按需拆解,增量文档模型处理超大文件(10万+行)性能远超 Monaco
- **markdown-it**:高性能解析器,作为预览渲染引擎
- **Tree-sitter**:用于语法高亮和代码折叠,C 编写的增量解析库(WASM 版本),性能极低损耗

**为什么不选 Monaco**:
- Monaco(VS Code 核心)虽然强大但极其庞大沉重
- CodeMirror 6 更适合追求极致性能的场景

#### 2.1.5 Git 操作:**git2-rs (libgit2 Rust 绑定)**

**选型理由**:
- **纯 Rust 实现**:无需调用系统 Git 命令,性能更高
- **跨平台一致**:避免不同系统 Git 版本差异
- **降级方案**:如 git2-rs 不支持的特性,可 fallback 到系统 Git

#### 2.1.6 文件监控:**notify (Rust crate)**

**选型理由**:
- **原生 API**:直接调用操作系统底层 API(macOS FSEvents、Linux inotify、Windows ReadDirectoryChangesW)
- **零 CPU 开销**:事件驱动,非轮询机制
- **Rust 集成**:与 Tauri 后端无缝集成,无需跨语言通信

#### 2.1.7 AI 集成:**reqwest + SSE 流式处理**

**选型理由**:
- **Rust HTTP 客户端**:reqwest 性能优异,异步非阻塞
- **SSE 流式**:Server-Sent Events 实现 AI 流式响应,前端逐字显示
- **本地模型支持**:通过 HTTP 调用 Ollama、LM Studio 等本地服务

#### 2.1.8 同步协议库
- **WebDAV**:`webdav-client`
- **S3**:`@aws-sdk/client-s3`
- **FTP/SFTP**:`basic-ftp` / `ssh2-sftp-client`

#### 2.1.9 图片处理:**image-rs (Rust crate)**

**选型理由**:
- **纯 Rust 实现**:无需 Node.js sharp 库,直接在 Tauri 后端处理
- **格式支持**:PNG、JPEG、WebP、AVIF 等
- **高性能**:利用 Rust 零成本抽象,处理速度快

#### 2.1.10 国际化:**fluent (Mozilla i18n framework)**

**选型理由**:
- **Rust 原生支持**:fluent-rs 与 Tauri 无缝集成
- **上下文感知**:支持复数、性别等复杂语言规则
- **懒加载**:按需加载语言包

---

### 2.2 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri 应用                            │
├──────────────────────┬──────────────────────────────────┤
│   Rust 后端 (Main)   │     WebView 前端 (Renderer)       │
│                      │                                  │
│ ┌──────────────────┐ │ ┌──────────────────────────────┐│
│ │ 文件系统服务      │ │ │  UI 层 (Svelte 5 Components) ││
│ │ - 文件读写        │ │ │  - 编辑器组件                ││
│ │ - 目录扫描        │ │ │  - 文件树组件                ││
│ │ - 文件监听(notify)│ │ │  - 标签页组件                ││
│ └──────────────────┘ │ │  - 侧边栏组件                ││
│                      │ │ └──────────────────────────────┘│
│ ┌──────────────────┐ │ │                                  │
│ │ Git 服务(git2-rs)│ │ │ ┌──────────────────────────────┐│
│ │ - Git 操作        │◄─┼─┤  状态管理层 (Svelte Runes)    ││
│ │ - 差异计算        │ │ │  - $state: editorState         ││
│ │ - 提交管理        │ │ │  - $state: fileTreeState       ││
│ └──────────────────┘ │ │  - $state: gitState            ││
│                      │ │  - $state: syncState           ││
│ ┌──────────────────┐ │ │  - $state: aiState             ││
│ │ 同步服务          │ │ └──────────────────────────────┘│
│ │ - WebDAV(reqwest)│ │                                  │
│ │ - S3(reqwest)     │ │ │ ┌──────────────────────────────┐│
│ │ - FTP(reqwest)    │ │ │  业务逻辑层 (Svelte Services)  ││
│ └──────────────────┘ │ │  - MarkdownService             ││
│                      │ │  - FileService                 ││
│ ┌──────────────────┐ │ │  - GitService                  ││
│ │ AI 服务           │ │ │  - SyncService               ││
│ │ - reqwest HTTP    │◄─┼─┤  - AIService                 ││
│ │ - SSE 流式响应    │ │ │  - ClipboardService          ││
│ └──────────────────┘ │ └──────────────────────────────┘│
│                      │ │                                  │
│ ┌──────────────────┐ │ │ ┌──────────────────────────────┐│
│ │ Tauri IPC 通信    │◄─┼─┤  Markdown 引擎层             ││
│ │ - Commands        │ │ │  - CodeMirror 6 Editor         ││
│ │ - Events          │ │ │  - markdown-it Parser          ││
│ └──────────────────┘ │ │  - Tree-sitter Highlighter     ││
│                      │ │  - KaTeX Renderer              ││
│ ┌──────────────────┐ │ │  - Mermaid Renderer            ││
│ │ 配置管理          │ │ └──────────────────────────────┘│
│ │ - serde_json      │ │                                  │
│ │ - tauri::conf     │ │ ┌──────────────────────────────┐│
│ │ - 加密存储        │ │ │  外部服务适配层               ││
│ └──────────────────┘ │ │  - OpenAI Adapter(reqwest)     ││
│                      │ │  - Ollama Adapter(reqwest)     ││
│                      │ │  - WebDAV Adapter(reqwest)     ││
│                      │ │  - S3 Adapter(reqwest)         ││
│                      │ └──────────────────────────────┘│
└──────────────────────┴──────────────────────────────────┘
```

---

### 2.3 进程模型

#### 2.3.1 Rust 后端职责
- 文件系统操作(读写、监听,通过 notify crate)
- Git 命令执行(通过 git2-rs)
- 网络请求(同步、AI API,通过 reqwest)
- 窗口管理(Tauri Window API)
- 系统托盘
- 自动更新(Tauri Updater)

#### 2.3.2 WebView 前端职责
- UI 渲染(Svelte 5 组件)
- 用户交互(键盘、鼠标事件)
- Markdown 解析和预览(CodeMirror 6 + markdown-it)
- 本地状态管理(Svelte Runes)

#### 2.3.3 Tauri IPC 通信设计

**通信模式**:
1. **Commands**:前端调用 Rust 函数,返回 Promise
2. **Events**:Rust 推送事件到前端(文件变化、Git 状态)

**示例**:
```rust
// Rust 后端
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

// Svelte 前端
import { invoke } from '@tauri-apps/api/core';
const content = await invoke('read_file', { path: filePath });
```

---

## 3. 模块详细设计

### 3.1 编辑器模块 (Editor Module)

#### 3.1.1 模块职责
- Markdown 源码编辑
- 实时预览渲染
- 分屏模式管理
- 光标和选区管理

#### 3.1.2 核心组件

**EditorContainer.svelte**
```svelte
<script lang="ts">
  import SourceEditor from './SourceEditor.svelte';
  import PreviewRenderer from './PreviewRenderer.svelte';
  
  let { fileId, mode, onContentChange } = $props();
  let content = $state('');
  
  // 根据 mode 渲染不同视图
</script>

{#if mode === 'source'}
  <SourceEditor {content} onChange={handleContentChange} />
{:else if mode === 'preview'}
  <PreviewRenderer {content} />
{:else}
  <div class="split-view">
    <SourceEditor {content} onChange={handleContentChange} />
    <PreviewRenderer {content} />
  </div>
{/if}
```

**SourceEditor.svelte** - 基于 CodeMirror 6 封装
```svelte
<script lang="ts">
  import { EditorView, basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  
  let { value, onChange, theme } = $props();
  let editorContainer: HTMLDivElement;
  let view: EditorView;
  
  $effect(() => {
    if (!editorContainer) return;
    
    view = new EditorView({
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        })
      ],
      parent: editorContainer
    });
    
    return () => view.destroy();
  });
</script>

<div bind:this={editorContainer}></div>
```

**PreviewRenderer.svelte**
```svelte
<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import katex from 'katex';
  import mermaid from 'mermaid';
  
  let { content, scrollSync = false } = $props();
  let previewHtml = $derived(markdownParser.render(content));
  
  const markdownParser = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
  });
  
  // 防抖更新(200ms)
  let timeout: NodeJS.Timeout;
  $effect(() => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      // 渲染 KaTeX 和 Mermaid
      renderMathAndDiagrams();
    }, 200);
  });
</script>

<div class="preview" innerHTML={previewHtml}></div>
```

#### 3.1.3 大文件优化策略

**虚拟滚动实现**:
```typescript
class VirtualScrollEditor {
  private visibleLines: number = 50;
  private lineHeight: number = 20;
  
  render() {
    // 仅渲染可视区域的行
    const startLine = Math.floor(scrollTop / lineHeight);
    const endLine = startLine + visibleLines;
    
    return (
      <div style={{ height: totalHeight }}>
        <div style={{ transform: `translateY(${startLine * lineHeight}px)` }}>
          {lines.slice(startLine, endLine).map(renderLine)}
        </div>
      </div>
    );
  }
}
```

**分页渲染**:
```typescript
class PaginatedPreview {
  private pageSize: number = 1000;
  private renderedPages: Set<number> = new Set();
  
  async renderPage(pageNum: number) {
    if (this.renderedPages.has(pageNum)) return;
    
    const start = pageNum * this.pageSize;
    const end = start + this.pageSize;
    const chunk = content.slice(start, end);
    
    // 后台线程解析
    const html = await worker.parse(chunk);
    this.insertHTML(html, pageNum);
    this.renderedPages.add(pageNum);
  }
}
```

---

### 3.2 文件管理模块 (File Management Module)

#### 3.2.1 模块职责
- 文件树展示
- 文件操作(新建、删除、重命名)
- 文件系统监听
- 多标签页管理

#### 3.2.2 核心组件

**FileTree.svelte**
```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  
  let { rootPath, onSelect, onContextMenu } = $props();
  let treeData = $state<FileNode[]>([]);
  let expandedNodes = $state(new Set<string>());
  
  // 异步加载子目录
  async function loadDirectory(path: string): Promise<FileNode[]> {
    return await invoke('list_directory', { path });
  }
  
  // 监听文件系统变化
  $effect(() => {
    const unlisten = listen('file-changed', (event) => {
      refreshTree();
    });
    return () => unlisten.then(f => f());
  });
</script>

<!-- 虚拟列表实现 -->
<div class="file-tree">
  {#each treeData as node (node.id)}
    <FileTreeNode 
      {node}
      expanded={expandedNodes.has(node.id)}
      on:toggle={() => toggleNode(node.id)}
      on:select={() => onSelect(node)}
      on:contextmenu={(e) => onContextMenu(node, e)}
    />
  {/each}
</div>
```

**TabManager.svelte** - Svelte 5 Store
```typescript
// stores/tabStore.ts
import { writable } from 'svelte/store';

interface Tab {
  id: string;
  fileId: string;
  title: string;
  dirty: boolean;
  active: boolean;
}

export const tabs = writable<Tab[]>([]);
export const activeTabId = writable<string | null>(null);

export function openFile(fileId: string) {
  tabs.update(currentTabs => {
    // 检查是否已打开
    const existing = currentTabs.find(t => t.fileId === fileId);
    if (existing) {
      activeTabId.set(existing.id);
      return currentTabs;
    }
    
    // 检查最大标签数
    if (currentTabs.length >= 50) {
      alert('达到最大标签数限制');
      return currentTabs;
    }
    
    const newTab = createTab(fileId);
    activeTabId.set(newTab.id);
    return [...currentTabs, newTab];
  });
}

export function closeTab(tabId: string) {
  tabs.update(currentTabs => {
    const tab = currentTabs.find(t => t.id === tabId);
    if (tab?.dirty && !confirm('文件未保存,是否关闭?')) {
      return currentTabs;
    }
    return currentTabs.filter(t => t.id !== tabId);
  });
}
```

#### 3.2.3 文件监听实现 (Rust 后端)

```rust
// src-tauri/src/file_watcher.rs
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;

pub struct FileWatcher {
    watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let watcher = RecommendedWatcher::new(
            move |res| {
                if let Ok(event) = res {
                    // 发送事件到前端
                    app_handle.emit("file-changed", &event.paths).unwrap();
                }
            },
            Config::default()
        ).unwrap();
        
        Self { watcher }
    }
    
    pub fn watch(&mut self, path: &str) {
        self.watcher.watch(
            std::path::Path::new(path),
            RecursiveMode::Recursive
        ).unwrap();
    }
}
```

**Tauri Command - 列出目录**:
```rust
// src-tauri/src/commands.rs
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
struct FileNode {
    id: String,
    name: String,
    path: String,
    is_directory: bool,
}

#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<FileNode>, String> {
    let entries = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| e.to_string())?;
    
    let mut nodes = Vec::new();
    let mut entries = entries;
    
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        // 排除 node_modules、.git 等
        if file_name.starts_with('.') && file_name != ".git" {
            continue;
        }
        
        nodes.push(FileNode {
            id: generate_id(),
            name: file_name,
            path: entry.path().to_string_lossy().to_string(),
            is_directory: file_type.is_dir(),
        });
    }
    
    Ok(nodes)
}
```

---

### 3.3 Git 集成模块 (Git Module)

#### 3.3.1 模块职责
- Git 仓库检测和初始化
- 文件状态跟踪
- 差异计算和展示
- 提交和推送操作

#### 3.3.2 核心服务

**GitService**
```typescript
import simpleGit from 'simple-git';

class GitService {
  private git: ReturnType<typeof simpleGit>;
  
  constructor(repoPath: string) {
    this.git = simpleGit(repoPath);
  }
  
  async initRepo(): Promise<void> {
    await this.git.init();
    await this.git.addConfig('user.name', 'SwallowNote User');
    await this.git.addConfig('user.email', 'user@example.com');
    await this.git.checkoutLocalBranch('main');
  }
  
  async getStatus(): Promise<GitStatus> {
    const status = await this.git.status();
    return {
      branch: status.current,
      modified: status.modified,
      added: status.created,
      deleted: status.deleted,
      untracked: status.not_added
    };
  }
  
  async diff(filePath: string): Promise<string> {
    return await this.git.diff(['--', filePath]);
  }
  
  async commit(message: string): Promise<void> {
    await this.git.add('.');
    await this.git.commit(message);
  }
  
  async autoCommit(): Promise<void> {
    const status = await this.getStatus();
    
    // 无变更时跳过
    if (status.modified.length === 0 && 
        status.added.length === 0 &&
        status.deleted.length === 0) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const message = `auto commit: ${timestamp}`;
    
    try {
      await this.commit(message);
      this.logAutoCommit(message, status);
    } catch (error) {
      console.error('Auto commit failed:', error);
      // 失败不影响文件保存
    }
  }
}
```

**DiffViewer**
```typescript
interface DiffViewerProps {
  filePath: string;
  mode: 'side-by-side' | 'inline';
}

class DiffViewer extends React.Component<DiffViewerProps> {
  parseDiff(diffText: string): DiffHunk[] {
    // 解析 git diff 输出
    const hunks: DiffHunk[] = [];
    const lines = diffText.split('\n');
    
    let currentHunk: DiffHunk | null = null;
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        // 新的 hunk
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = { header: line, changes: [] };
      } else if (currentHunk) {
        currentHunk.changes.push({
          type: line.startsWith('+') ? 'add' : 
                line.startsWith('-') ? 'delete' : 'context',
          content: line.slice(1)
        });
      }
    }
    
    return hunks;
  }
  
  render() {
    const diff = await gitService.diff(this.props.filePath);
    const hunks = this.parseDiff(diff);
    
    return (
      <div className={`diff-viewer ${this.props.mode}`}>
        {hunks.map(hunk => (
          <DiffHunkComponent 
            key={hunk.header} 
            hunk={hunk}
            mode={this.props.mode}
          />
        ))}
      </div>
    );
  }
}
```

---

### 3.4 搜索模块 (Search Module)

#### 3.4.1 模块职责
- 快速文件搜索(Ctrl+P)
- 全局内容搜索(Ctrl+Shift+F)
- 模糊匹配算法
- 搜索结果展示

#### 3.4.2 核心实现

**FileSearchService** - 使用 Fuse.js 实现模糊搜索,构建文件索引,支持文件名和路径的加权匹配。

**ContentSearchService** - 并行搜索多文件内容,支持正则表达式、大小写敏感等选项,返回带行号的匹配结果。

---

### 3.5 剪切板处理模块 (Clipboard Module)

#### 3.5.1 模块职责
- 监听粘贴事件
- 保存图片到指定目录
- 生成相对路径链接
- 图片压缩和优化

#### 3.5.2 核心实现

**ClipboardService** - 使用 sharp 库进行图片压缩和格式转换,支持时间戳/UUID命名规则,自动生成 Markdown 图片链接。

---

### 3.6 同步模块 (Sync Module)

#### 3.6.1 模块职责
- 多协议同步支持(Git、WebDAV、S3、FTP)
- 增量同步
- 冲突检测和处理
- 同步队列管理

#### 3.6.2 架构设计

采用适配器模式,每个同步协议实现 SyncAdapter 接口,SyncService 统一管理多个同步目标,支持失败隔离和继续同步。

---

### 3.7 AI 模块 (AI Module)

#### 3.7.1 模块职责
- AI 模型配置和管理
- 对话助手
- 文本改写和生成
- URL 内容抓取和总结
- 智能补全

#### 3.7.2 核心实现

**OpenAIAdapter** - 使用 OpenAI SDK,支持流式响应,实现 chat 和 complete 方法。

**OllamaAdapter** - 调用本地 Ollama API,无需网络,适合隐私场景。

**URLCaptureService** - 使用 Puppeteer 抓取网页,cheerio 提取内容,AI 总结生成结构化 Markdown。

---

## 4. 数据设计

### 4.1 配置存储结构

**用户配置**:存储在 `%APPDATA%/SwallowNote/config.json`,包含编辑器设置、主题、语言、Git、剪切板、同步、AI 等配置项。

**工作区配置**:存储在 `.swallownote-workspace` JSON 文件,包含多个根目录信息和专属设置。

### 4.2 状态管理结构

使用 Zustand 创建多个 store:
- **EditorState**: 活跃文件、文件内容、标签页、视图模式
- **FileTreeState**: 根路径、树结构、展开节点、选中节点
- **GitState**: 仓库路径、分支、状态
- **SyncState**: 同步目标、同步状态、最后同步时间
- **AIState**: AI 提供商、对话历史

---

## 5. 接口设计

### 5.1 IPC 通信接口

**文件操作**:
- `file:read` - 读取文件内容
- `file:write` - 原子写入文件(先写临时文件再替换)
- `file:list` - 列出目录内容

**Git 操作**:
- `git:init` - 初始化仓库
- `git:status` - 获取状态
- `git:diff` - 获取差异
- `git:commit` - 提交更改

**AI 操作**:
- `ai:chat` - 发送对话消息,返回 MessageChannel 用于流式接收

---

## 6. 安全设计

### 6.1 敏感信息加密

使用 AES-256-GCM 加密 API Key、密码等敏感信息。密钥通过 Argon2 从主密码派生,salt 随机生成并存储在 Tauri 应用数据目录。

### 6.2 Tauri 安全配置

- **CSP**:启用 Content Security Policy,限制外部资源加载
- **协议白名单**:仅允许 `tauri://` 和 `asset://` 协议
- **隔离模式**:WebView 运行在沙箱环境,无法直接访问系统 API
- **权限控制**:通过 `tauri.conf.json` 精确控制后端 API 访问权限

---

## 7. 性能优化策略

### 7.1 文件树优化

- **虚拟列表**:Svelte {#each} 配合固定高度容器,仅渲染可视区域节点
- **懒加载**:子目录展开时异步调用 Tauri Command 加载
- **缓存**:Rust 后端缓存目录结构,减少重复扫描

### 7.2 编辑器优化

- **Web Worker**:Markdown 解析在前端 Web Worker 进行(避免阻塞 UI)
- **防抖更新**:预览更新延迟 200ms
- **分页渲染**:大文件分 1000 行一页渲染
- **标签卸载**:非活动标签销毁 CodeMirror 实例释放内存

### 7.3 Rust 后端优势

- **零 GC 停顿**:无垃圾回收,输入延迟稳定
- **原生文件系统**:直接调用 OS API,无中间层开销
- **异步 I/O**:Tokio 运行时处理并发文件操作

---

## 8. 测试策略

### 8.1 单元测试

- **Rust**:使用 cargo test 测试后端逻辑
- **Svelte**:使用 Vitest + @testing-library/svelte 测试组件渲染、用户交互、业务逻辑

### 8.2 E2E 测试

使用 Playwright 测试完整用户流程:新建文件、编辑、保存、预览。

### 8.3 性能测试

使用 Vitest benchmark 测试文件树加载、搜索等关键操作的性能。

---

## 9. 部署方案

### 9.1 打包配置

使用 Tauri CLI (`tauri build`),自动根据平台输出:
- Windows: `.msi` / `.exe`
- macOS: `.dmg` / `.app`
- Linux: `.deb` / `.rpm` / `.AppImage`

### 9.2 自动更新

使用 Tauri Updater,从 GitHub Releases 或自定义服务器检查更新,下载完成后提示用户重启安装。

---

## 10. 开发规范

### 10.1 代码规范

**Rust**:
- rustfmt 统一代码格式
- clippy 静态检查
- 遵循 Rust API Guidelines

**Svelte/TypeScript**:
- ESLint + Prettier 统一代码风格
- Svelte 5 Runes 最佳实践
- 80 字符行宽、单引号、分号

### 10.2 提交规范

遵循 Conventional Commits:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `refactor`: 重构
- `test`: 测试相关

---

## 11. 项目结构

```
swallownote/
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── main.rs           # Tauri 应用入口
│   │   ├── commands/         # Tauri Commands
│   │   │   ├── file.rs       # 文件操作
│   │   │   ├── git.rs        # Git 操作
│   │   │   ├── sync.rs       # 同步操作
│   │   │   └── ai.rs         # AI 操作
│   │   ├── services/         # 业务服务
│   │   │   ├── file_watcher.rs
│   │   │   ├── git_service.rs
│   │   │   └── sync_service.rs
│   │   └── utils/
│   ├── Cargo.toml            # Rust 依赖
│   └── tauri.conf.json       # Tauri 配置
├── src/                      # Svelte 5 前端
│   ├── lib/
│   │   ├── components/       # Svelte 组件
│   │   │   ├── Editor/
│   │   │   │   ├── EditorContainer.svelte
│   │   │   │   ├── SourceEditor.svelte
│   │   │   │   └── PreviewRenderer.svelte
│   │   │   ├── FileTree/
│   │   │   │   ├── FileTree.svelte
│   │   │   │   └── FileTreeNode.svelte
│   │   │   ├── Tabs/
│   │   │   └── Sidebar/
│   │   ├── stores/           # Svelte Stores
│   │   │   ├── editorStore.ts
│   │   │   ├── fileStore.ts
│   │   │   └── gitStore.ts
│   │   ├── services/         # 前端服务
│   │   └── types/            # TypeScript 类型
│   ├── routes/               # 页面路由
│   ├── app.html              # HTML 模板
│   └── app.css               # 全局样式
├── package.json              # Node.js 依赖
├── svelte.config.js          # Svelte 配置
├── vite.config.ts            # Vite 配置
└── tsconfig.json             # TypeScript 配置
```

---

## 12. 依赖配置

### 12.1 Rust 依赖 (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2.0", features = ["updater"] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
notify = "6"  # 文件监听
git2 = "0.18"  # Git 操作
reqwest = { version = "0.11", features = ["json", "stream"] }  # HTTP 客户端
image = "0.24"  # 图片处理
fluent = "0.16"  # 国际化
aes-gcm = "0.10"  # 加密
base64 = "0.21"
```

### 12.2 前端依赖 (package.json)

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.0",
    "codemirror": "^6.0",
    "@codemirror/lang-markdown": "^6.0",
    "markdown-it": "^14.0",
    "katex": "^0.16",
    "mermaid": "^10.0",
    "fuse.js": "^7.0",
    "@types/markdown-it": "^13.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.0",
    "@tsconfig/svelte": "^5.0",
    "svelte": "^5.0",
    "svelte-check": "^3.0",
    "typescript": "^5.0",
    "vite": "^5.0"
  }
}
```

---

## 13. 里程碑规划

### Phase 1: MVP (4-6周)
- [ ] FR-001 Markdown 实时预览
- [ ] FR-005 文件树极速加载
- [ ] FR-007 多标签页管理
- [ ] FR-008 Git 检测与初始化
- [ ] FR-011 快速文件搜索
- [ ] FR-013 中英文切换

### Phase 2: 增强 (6-8周)
- [ ] FR-009 Git 自动提交
- [ ] FR-010 Git 差异对比
- [ ] FR-012 全局内容搜索
- [ ] FR-014 粘贴图片自动保存
- [ ] FR-015 图片压缩
- [ ] FR-016 WebDAV 同步
- [ ] FR-020 AI 模型配置
- [ ] FR-021 AI 对话助手

### Phase 3: 完善 (8-10周)
- [ ] FR-017 S3 同步
- [ ] FR-018 混合同步
- [ ] FR-019 工作区模式
- [ ] FR-022 URL 抓取总结
- [ ] FR-023 AI 文本改写
- [ ] FR-024 AI 智能补全

---

**文档结束**
