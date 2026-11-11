# @swallow-note/plugin-kit

SwallowNote 插件共享构建工具。把原先每个插件各自复制一份的 `package.sh`（331~423 行）、
`vite.config.ts`、`build.sh`、`tsconfig.json` 样板收敛为一个 CLI + 一个 Vite 配置工厂。

## 安装（插件工程内）

```jsonc
// package.json
{
  "devDependencies": {
    "@swallow-note/plugin-kit": "file:../../docs/plugin-kit"
  }
}
```

## 三个命令

### `swallow-plugin create [targetDir]`

交互式问询（插件名 → 默认 id `com.swallownote.<kebab-name>` → 是否 Rust 后端 → 权限多选），
从内嵌模板渲染生成插件工程。非交互模式：

```bash
swallow-plugin create /tmp/demo --name 示例插件 --id com.swallownote.demo --backend
swallow-plugin create /tmp/demo --name Demo --permissions storage,events,backend
```

生成的工程：`package.json`（scripts 已接 kit）、`vite.config.ts`（3 行调
`definePluginViteConfig`）、`tsconfig.json`（SDK 类型从 node_modules 解析）、
`manifest.json`、`src/index.tsx`（最小面板 + standalone 预览入口）；`--backend` 时
额外生成 `src-tauri/`（`swallow-plugin-rpc` path 依赖 + echo 示例命令）。

### `swallow-plugin build`

在插件工程根目录执行：`vite build` → 工程含 `src-tauri/` 时 `cargo build --release`，
二进制复制到 `<pluginDir>/backend/plugin_<id>`（build.sh 约定，宿主 invoke_plugin 的查找位置）。

### `swallow-plugin package [--bump patch|minor|patch] [--no-bump]`

等价平移原 `package.sh` 全流程：

```
版本 bump（manifest.json / package.json / Cargo.toml 同步）
→ vite build →（有后端）cargo build --release → dist/backend/plugin_<id>
→ 确定性 zip（<pluginDir>/<id>.zip，固定顺序/mtime/压缩，两次构建字节一致）
→ sha256 → ed25519 签名（调用宿主 cargo example sign_plugin，方式同 sign-common.sh）
→ plugins/repo.json 同步（version/sha256/published_at/signature_b64 回填，静态字段保留）
```

其他选项：`--version X.Y.Z` 钉住版本（隐含 `--no-bump`）、`--skip-repo` 跳过索引同步、
`--dry-run` 只打印计划与 repo.json 回填预览。

签名密钥查找由宿主 `sign_plugin` 工具负责：`SWALLOWNOTE_PLUGIN_SIGNING_KEY`
环境变量，或自当前目录向上寻找 `plugins/.signing-key`；密钥缺失时警告并跳过签名
（未签名 zip 仅过不了市场校验，本地拖拽安装不受影响）。

## 与原 package.sh 的差异（必要偏离）

1. **publishedAt 仅在版本变化时刷新**：原脚本 `--no-bump` 也会刷新 publishedAt 并烘焙进
   产物，导致两次构建字节不同；kit 为满足确定性要求改为仅随版本变更。
2. **repo.json 缺少插件条目时报错退出**：原脚本仅警告后照常结束。
3. **不再同步 `src/index.tsx` 中的版本字面量**：入口统一从 `../manifest.json` 读取版本。

## Vite 配置工厂

```ts
// vite.config.ts
import { definePluginViteConfig } from '@swallow-note/plugin-kit'
export default definePluginViteConfig({ externals: ['some-host-lib'], port: 5180 })
```

`externals` 追加到宿主内置依赖（react 全家桶 / blocknote / codemirror）之后合并去重；
`port` 默认 5177。manifest 注入注释（`// @swallow-manifest {...}`）等插件工程样板全部内置。

## 迁移现有插件（以 secret-disk 为例）

1. `package.json` 增加 `@swallow-note/plugin-kit` 的 file: 依赖；
2. `vite.config.ts` 换成上面的 3 行（externals 有增量时传入 `externals`）；
3. `scripts.build` → `swallow-plugin build`，`scripts.package` → `swallow-plugin package`；
4. `package.sh` / `build.sh` 可删除；entry 的 manifest 从 `../manifest.json` 读取（现状即是）。
