# SwallowNote 插件模板

一个**开箱即用**的起步项目，用于在不依赖宿主源码的前提下开发 [SwallowNote](https://github.com/) 插件。复制该目录到任意位置，然后开始改即可。

## 快速开始

```bash
cp -r docs/plugin-template ~/code/my-plugin
cd ~/code/my-plugin
npm install
npm run dev
```

打开 http://localhost:5173 即可看到独立预览。

预览框架（右侧面板）支持：

- 一键发射宿主事件（`note:open`、`note:save`、`theme:change` 等），实时观察你的插件响应
- 检查插件的 storage 键
- 在插件面板内**右键**，查看 `registerContextMenu` 注入的菜单项
- 切换 `isActive` 触发 `onActivate` / `onDeactivate`
- 实时事件日志

## 构建 & 上传

```bash
npm run build
```

产物：

```
dist/
├── plugin.js          # 38 kB IIFE bundle（gzip 后 12 kB）
└── manifest.json      # 从 src/plugin/manifest.json 拷贝
```

在 SwallowNote 中：**Settings → Plugins → Upload** 整个 `dist/` 目录（也可先打包成 zip）。

## 项目结构

```
plugin-template/
├── index.html                 # vite dev 入口
├── vite.config.ts             # dev（preview）+ build（library）双模式
├── tsconfig.json              # 严格模式，include ../plugin-sdk/src
├── package.json
├── src/
│   ├── main.tsx               # dev 入口：挂载 <Preview />
│   ├── preview.tsx            # dev 框架，带事件按钮
│   ├── styles.css
│   └── plugin/
│       ├── index.tsx          # <-- 你的代码写在这里
│       └── manifest.json
└── dist/                      # 构建产物（gitignore）
```

## 与 SDK 的连接

本模板通过本地 `file:` 引用依赖 `@swallow-note/plugin-sdk`：

```json
"dependencies": {
  "@swallow-note/plugin-sdk": "file:../plugin-sdk"
}
```

如果要发布到 npm 的真实插件项目，把这一项改成：

```json
"@swallow-note/plugin-sdk": "^0.1.0"
```

（或者把整个 `docs/plugin-sdk/src/index.ts` 直接 vendored 到项目里。）

## 需要编辑什么

只需要改 `src/plugin/index.tsx` 和 `src/plugin/manifest.json`。其余都是 dev 基础设施，可以保持不动。

如果想加新的 dev 工具按钮（比如带表单输入的自定义事件），编辑 `src/preview.tsx`。

## 从项目内开发迁移

如果你之前在 `SwallowNote/src/` 内部开发，迁移步骤如下：

1. 把 `index.tsx` 移到 `src/plugin/index.tsx`
2. 替换 import：

   ```typescript
   // 改前
   import type { PluginDefinition } from '@/types/plugin'
   import { usePluginStorage } from '@/lib/plugin-hooks'

   // 改后
   import { type PluginDefinition, usePluginStorage } from '@swallow-note/plugin-sdk'
   ```

3. 把 `@/lib/...` 运行时 import 替换为 SDK 的 re-export
4. 把 `manifest.json` 移到 `index.tsx` 同级目录

类型形状完全一致，迁移基本是 sed 替换。
