# 图床插件 (com.swallownote.picgo)

基于 PicGo 设计理念实现的 SwallowNote 图床插件。支持将本地/剪贴板图片一键上传到 SM.MS / Imgur / GitHub / 自定义 HTTP 端点，并把返回的图片 URL 自动插入到当前笔记。

## 功能特性

- **多图床支持**：内置 SM.MS（支持匿名）、Imgur、GitHub Contents API，并提供通用 HTTP 端点适配 WebDAV / S3 兼容 / 自建图床
- **多种上传入口**：工具栏按钮 + 右侧面板 + 拖拽 + 剪贴板粘贴
- **客户端预处理**：MIME 校验、尺寸校验、WebP/JPG/PNG canvas 转码
- **文件名策略**：保留原名 / UUID / 时间戳前缀
- **链接格式**：Markdown `![name](url)` / HTML `<img>` / 裸 URL
- **上传历史**：本地缓存（plugin storage），支持回查、复制、再插入、清空
- **超时与取消**：30s 超时 + AbortController

## 安装

1. 在 SwallowNote 打开「插件」→ 拖拽 `com.swallownote.picgo.zip` 到窗口，或点击「从本地 zip 安装」选择该文件
2. 安装后点击插件卡片工具栏的 ⚙ 按钮配置图床参数
3. 编辑器工具栏出现「图床」按钮，点击激活右侧面板

## 配置项

所有配置都通过插件根目录的 `settings.json` 暴露，由宿主 PluginSettingsDialog 渲染。

### 全局

| 字段 | 类型 | 默认 | 说明 |
| ---- | ---- | ---- | ---- |
| `defaultProvider` | select | `smms` | 默认图床 |
| `uploadFormat` | select | `original` | 上传前客户端转码（webp/jpg/png） |
| `maxFileSizeMB` | number | 10 | 单文件大小上限，1-100 |
| `filenameStrategy` | select | `original` | 远程文件名生成策略 |
| `linkFormat` | select | `markdown` | 插入到笔记的链接格式 |
| `enableHistory` | boolean | true | 是否缓存上传历史 |
| `historyRetention` | number | 200 | 历史保留条数，10-2000 |

### SM.MS

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `smmsToken` | password | 否 | 留空表示匿名上传（受 SM.MS 频率限制） |

### Imgur

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `imgurClientId` | password | 是 | 注册 [Imgur 应用](https://api.imgur.com/oauth2/addclient) 获取 |

### GitHub

| 字段 | 类型 | 必填 | 默认 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `githubToken` | password | 是 |  | [Personal Access Token](https://github.com/settings/tokens)，需要 `repo` 权限 |
| `githubOwner` | string | 是 |  | 仓库 Owner |
| `githubRepo` | string | 是 |  | 仓库名 |
| `githubBranch` | string | 否 | `main` | 分支名 |
| `githubPathPrefix` | string | 否 | `images/` | 路径前缀 |

### 自定义端点

| 字段 | 类型 | 必填 | 默认 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `customEndpoint` | string | 是 |  | 完整 URL |
| `customMethod` | select | 是 | `POST` | HTTP 方法 |
| `customHeaders` | string-multiline | 否 |  | 每行 `Key: Value` |
| `customBodyTemplate` | string-multiline | 是 |  | 支持占位符 `{filename}` `{base64}` `{mime}` `{size}` |
| `customResponseUrlPath` | string | 是 |  | 点分路径，从响应 JSON 中取出图片 URL |

#### customBodyTemplate 占位符示例

```json
{"filename":"{filename}","image":"{base64}","mime":"{mime}","size":{size}}
```

#### customResponseUrlPath 示例

- `data.url` —— 取 `response.data.url`
- `result.image` —— 取 `response.result.image`
- 留空 —— 响应体作为裸 URL（适用于「返回纯文本 URL」的端点）

#### 常用端点参考

- **WebDAV**：`PUT https://your-server/dav/images/{filename}`，body 直接放二进制流
- **S3 兼容**（如 MinIO / R2）：使用预签名 URL + `PUT` 方法
- **自建服务**：参考 `customBodyTemplate` 示例

## 使用流程

### 通过右侧面板

1. 点击编辑器工具栏的「图床」图标
2. 面板顶部选择 provider（默认取 `defaultProvider`）
3. 「上传」tab 三种入口任选：
   - 拖拽图片到虚线框
   - 点击「从剪贴板粘贴」读取剪贴板图片
   - 点击「选择本地文件」调系统文件选择器
4. 等待进度条 100%
5. 结果卡片提供「复制 URL」「插入到笔记」两个操作

### 通过剪贴板自动上传

1. 打开任意 Markdown 文件，编辑器获得焦点
2. `Ctrl/Cmd + V` 粘贴剪贴板图片
3. 插件自动调用当前 provider 上传，结束后在光标位置插入 `![](url)`

## CORS 配置提示

如果使用自建图床或第三方端点出现 CORS 错误，需要在服务端允许以下来源：

- Tauri Webview 内的请求源（Tauri 默认较宽松，但部分 CDN 仍可能拦截）
- 自建服务需配置 `Access-Control-Allow-Origin: *` 或具体的 SwallowNote 域

SM.MS / Imgur / GitHub 默认支持跨域请求，可直接使用。

## 错误处理

所有失败路径都会通过 toast 弹出可读错误信息，格式为 `<Provider>: <原因>`：

- `SM.MS: 鉴权失败，请检查 Token 设置` —— 401/403
- `SM.MS: image_repeated` —— 业务 code 失败
- `GitHub: Bad credentials` —— Token 错误
- `Custom: 响应中未找到 URL（路径：data.url）` —— customResponseUrlPath 解析失败

## 开发

```bash
cd plugins/picgo
npm install
npm run dev        # Vite 独立预览（localhost:5176）
npm run build      # 输出 dist/index.js
npm run typecheck  # tsc --noEmit
npm run package    # 打包为 com.swallownote.picgo.zip
```

## 权限声明

插件 manifest 声明以下权限：

- `network` —— fetch 调用各 provider API
- `clipboard` —— 读取剪贴板图片
- `storage` —— 缓存上传历史到 plugin storage
- `events` —— 接收宿主事件总线通知

## 限制

- **大文件**：超过 provider 单文件限制（如 SM.MS 5MB）由 provider 拒绝，错误信息透传
- **历史同步**：仅本地缓存，不跨设备同步
- **CORS**：自建图床需服务端配置 CORS，宿主 Tauri Webview 默认对 SM.MS / Imgur / GitHub 放行

## License

MIT
