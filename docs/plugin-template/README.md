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
├── index.js           # ES module bundle（gzip 后约 12 kB，头部注入 // @swallow-manifest 元数据注释）
└── manifest.json      # 工程根 manifest.json（静态字段唯一来源）的拷贝
```

`npm run build` 底层是 [plugin-kit](../plugin-kit) 的 `swallow-plugin build`（kit 已作为 devDependency 内置）——`definePluginViteConfig` 工厂内置 library mode 与 manifest 注入。打包发布用：

```bash
npx swallow-plugin package   # 构建 dist/ 并打包为 zip
```

在 SwallowNote 中：**Settings → Plugins → Upload** 上传 zip。

## 项目结构

```
plugin-template/
├── index.html                 # vite dev 入口
├── manifest.json              # 插件静态字段唯一来源（工程根，kit 约定）
├── vite.config.ts             # kit 工厂 definePluginViteConfig（dev 预览 + 生产 library 双模式）
├── tsconfig.json              # 严格模式，include ../plugin-sdk/src
├── package.json
├── src/
│   ├── main.tsx               # dev 入口：挂载 <Preview />
│   ├── preview.tsx            # dev 框架，带事件按钮
│   ├── styles.css
│   └── index.tsx              # <-- 你的代码写在这里（definePlugin 入口）
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

工程根的 `manifest.json` 是插件静态字段（id / name / permissions / ...）的**唯一来源**；`src/index.tsx` 通过 `definePlugin(manifestJson, { icon, panel, ... })` 聚合运行时对象，在其中实现组件与 hooks。其余都是 dev 基础设施，可以保持不动。

如果想加新的 dev 工具按钮（比如带表单输入的自定义事件），编辑 `src/preview.tsx`。

## 从项目内开发迁移

如果你之前在 `SwallowNote/src/` 内部开发，迁移步骤如下：

1. 把 `index.tsx` 移到 `src/index.tsx`
2. 替换 import：

   ```typescript
   // 改前
   import type { PluginDefinition } from '@/types/plugin'
   import { usePluginStorage } from '@/lib/plugin-hooks'

   // 改后
   import { definePlugin, type PluginPanelProps, usePluginStorage } from '@swallow-note/plugin-sdk'
   // 必须 re-export setHost，宿主通过它注入真实实现
   export { setHost } from '@swallow-note/plugin-sdk'
   ```

3. 把 `@/lib/...` 运行时 import 替换为 SDK 的 re-export
4. 把 `manifest.json` 移到工程根目录（与 `vite.config.ts` 同级）
5. 入口改用 `definePlugin` 聚合：manifest.json 只保留静态字段（组件字段与生命周期钩子由 runtime 参数注入，钩子为顶层平铺字段），TS 内不再手写 manifest 对象：

   ```typescript
   import { definePlugin } from '@swallow-note/plugin-sdk'
   import manifestJson from '../manifest.json'

   export default definePlugin(manifestJson, {
     icon: MyIcon,
     panel: MyPanel,
     toolbarButton: MyToolbarButton,   // 按需注入
     settings: SettingsComponent,      // 按需注入
     editorComponent: MyEditor,        // 按需注入
     onLoad: () => registerActions(),  // 生命周期钩子同样是顶层平铺字段
   })
   ```

类型形状完全一致，迁移基本是 sed 替换。
