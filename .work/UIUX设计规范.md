# SwallowNote UI 布局设计

> 基于截图重新设计

---

## 1. 整体布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│ ┌──────────────┬────────────────────────────────────────────────────────┤
│ │              │  [markdown.md] [markdown.md] [markdown.md]    [+]     │
│ │              ├────────────────────────────────────────────────────────┤
│ │              │  traeProjects/world_hello/Cargo.toml                   │
│ │   文件       │  大小: 13Kb    修改时间: 2026/5/16 11:12:00    字数: 1380│
│ │   资源       ├────────────────────────────────────────────────────────┤
│ │   管理器     │                                                        │
│ │              │  # Approach A: Structure-based Coordinates             │
│ │   svn        │  (Preferred)                                          │
│ │   ├─apache-  │                                                        │
│ │   │ activemq │  Use this when extract_form_structure.py found         │
│ │   ├─apache-  │  text labels in the PDF.                              │
│ │   │ tomcat   │                                                        │
│ │   ├─clients  │  ## A.1: Analyze the Structure                        │
│ │   ├─cloud-   │                                                        │
│ │   │ app-cls- │  Read form_structure.json and identify:               │
│ │   │ sh       │  1. Label groups: Adjacent text elements...           │
│ │   ├─cloudede-│  2. Row structure: Labels with similar top...         │
│ │   │ mo       │  3. Field columns: Entry areas start after...         │
│ │   ├─cnpm     │  4. Checkboxes: Use the checkbox coordinates...        │
│ │   ├─common   │                                                        │
│ │   ├─model    │  Coordinate system: PDF coordinates where y=0         │
│ │   ├─▸model-  │  is at TOP of page, y increases downward.             │
│ │   │ comps    │                                                        │
│ │   ├─▸model-  │  ## A.2: Check for Missing Elements                   │
│ │   │ comps-   │                                                        │
│ │   │ unused   │  The structure extraction may not detect all          │
│ │   ├─▸model-  │  form elements. Common cases:                        │
│ │   │ edu      │  • Circular checkboxes: Only square rectangles...     │
│ │   ├─▸model-  │  • Complex graphics: Decorative elements...           │
│ │   │ newdao   │  • Faded or light-colored elements...                 │
│ │   ├─▸model-  │                                                        │
│ │   │ paas     │                                                        │
│ │   ├─▸...     │                                                        │
│ │   │          │                                                        │
│ │   │          │                                                        │
│ └──────────────┴────────────────────────────────────────────────────────┘
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.1 布局结构

| 区域 | 位置 | 功能 |
|------|------|------|
| 文件资源管理器 | 左侧 | 以树形结构展示项目文件和文件夹 |
| Tab 栏 | 编辑区顶部 | 管理打开的文件标签 |
| 文件信息栏 | Tab 栏下方 | 显示当前文件路径、大小、修改时间、字数 |
| 编辑器 | 中央 | Markdown 内容编辑/显示 |

### 1.2 区域比例

```
┌──────────────────┬──────────────────────────────────────────────┐
│                  │                                              │
│    约 240px      │              剩余全部空间                      │
│   (可拖拽调整)    │                                              │
│                  │                                              │
│  文件资源管理器   │                 编辑器区域                     │
│                  │                                              │
│                  │                                              │
│                  │                                              │
└──────────────────┴──────────────────────────────────────────────┘
```

---

## 2. 文件资源管理器

### 2.1 布局

```
┌─────────────────┐
│ 资源管理器       │  ← 区域标题
├─────────────────┤
│ svn             │  ← 根目录/集合
│ ├─apache-activemq│
│ ├─apache-tomcat │
│ ├─clients       │
│ ├─cloud-app-cls-│
│ │ sh            │
│ ├─cloudedemo    │
│ ├─cnpm          │
│ ├─common        │
│ ├─model         │
│ ├─▸model-comps  │  ← 选中项（高亮）
│ ├─▸model-comps-│
│ │ unused        │
│ ├─▸model-edu    │
│ ├─▸model-newdao │
│ ├─▸model-paas   │
│ ├─▸model-       │
│ │ templates     │
│ ├─▸...          │
│ ├─dev-guide     │
│ ├─paas-trunk    │
│ ├─gox5-tools    │
│ └─opencart      │
│                 │
│                 │
└─────────────────┘
```

### 2.2 节点元素

| 元素 | 说明 |
|------|------|
| 文件夹(展开) | ▼ 箭头 + 文件夹图标 + 名称 |
| 文件夹(折叠) | ▶ 箭头 + 文件夹图标 + 名称 |
| 文件 | 文件图标 + 名称 |
| 选中项 | 高亮背景 |
| 层级缩进 | 每级缩进一定间距 |

### 2.3 选中状态

选中项背景与未选中项有明显区分，高亮色突出。

---

## 3. Tab 栏

### 3.1 布局

```
[markdown.md] [markdown.md] [markdown.md]    [+]
```

| 元素 | 说明 |
|------|------|
| Tab 标签 | 显示文件名 |
| 状态指示 | 未保存(红色圆点)、已保存(绿色圆点) |
| 关闭按钮 | Tab 上的 × 按钮 |
| 新建按钮 | + 号，创建新文件 |
| 溢出滚动 | Tab 过多时可左右滚动 |

### 3.2 Tab 状态

| 状态 | 视觉特征 |
|------|----------|
| 激活 | 底部有高亮线/选中色块 |
| 未保存 | 文件名旁红色圆点 |
| 已保存 | 文件名旁绿色圆点 |

---

## 4. 文件信息栏

### 4.1 布局

```
traeProjects/world_hello/Cargo.toml    大小: 13Kb    修改时间: 2026/5/16 11:12:00    字数: 1380
```

### 4.2 信息项

| 信息 | 格式 | 示例值 |
|------|------|--------|
| 文件路径 | 相对路径 | traeProjects/world_hello/Cargo.toml |
| 文件大小 | 大小: N Kb/Mb | 大小: 13Kb |
| 修改时间 | 修改时间: YYYY/M/D HH:mm:ss | 修改时间: 2026/5/16 11:12:00 |
| 字数统计 | 字数: N | 字数: 1380 |

---

## 5. 编辑器

### 5.1 内容展示

Markdown 格式编辑/显示：

```
# Approach A: Structure-based Coordinates
(Preferred)

Use this when extract_form_structure.py found text labels in the PDF.

## A.1: Analyze the Structure

Read form_structure.json and identify:
1. Label groups: Adjacent text elements that form a single label
2. Row structure: Labels with similar top values are in the same row
3. Field columns: Entry areas start after label ends
4. Checkboxes: Use the checkbox coordinates directly from the structure

## A.2: Check for Missing Elements

The structure extraction may not detect all form elements. Common cases:
• Circular checkboxes: Only square rectangles are detected as checkboxes
• Complex graphics: Decorative elements or non-standard form controls
• Faded or light-colored elements: May not be extracted
```

### 5.2 支持的格式

| 格式 | 标记 |
|------|------|
| 一级标题 | `# 标题` |
| 二级标题 | `## 标题` |
| 有序列表 | `1. item` |
| 无序列表 | `• item` 或 `- item` |
| 普通段落 | 直接文本 |
| 加粗 | `**文本**` |

---

## 6. 交互流程

### 6.1 文件浏览

```
用户操作                 界面响应
─────────               ────────
点击文件夹 ▶          → 展开显示子项，▶ 变为 ▼
点击文件夹 ▼          → 折叠收起子项，▼ 变为 ▶
点击文件              → 文件选中高亮
双击文件              → 在编辑区打开文件
```

### 6.2 Tab 管理

```
用户操作                 界面响应
─────────               ────────
点击 Tab              → 切换到对应文件
拖拽 Tab              → 重新排序
点击 Tab ×            → 关闭文件
点击 +                → 新建文件
Ctrl+Tab             → 切换到上一个 Tab
```

### 6.3 编辑器交互

```
用户操作                 界面响应
─────────               ────────
输入文本              → 实时编辑，显示未保存标记
保存 (Ctrl+S)        → 保存内容，显示已保存标记
```

---

## 7. 关键 UI 元素

### 7.1 折叠/展开箭头

| 状态 | 图标 | 说明 |
|------|------|------|
| 折叠 | ▶ | 隐藏子内容 |
| 展开 | ▼ | 显示子内容 |

### 7.2 文件状态标记

| 状态 | 标记 | 颜色 |
|------|------|------|
| 未保存 | ● | 红色 |
| 已保存 | ● | 绿色 |

### 7.3 拖拽

| 场景 | 行为 |
|------|------|
| Tab 拖拽 | 移动 Tab 位置 |
| 文件信息栏 | 可点击复制路径 |

---

## 8. 实现检查清单

### 文件资源管理器
- [ ] 左侧面板展示文件树
- [ ] 文件夹展开/折叠（▶/▼ 箭头）
- [ ] 文件选中高亮
- [ ] 层级缩进（子目录缩进）
- [ ] 文件/文件夹名称显示
- [ ] 垂直滚动

### Tab 栏
- [ ] 多个 Tab 平铺显示
- [ ] 激活 Tab 选中标识
- [ ] 未保存红色圆点
- [ ] 已保存绿色圆点
- [ ] 关闭按钮（×）
- [ ] 新建按钮（+）
- [ ] Tab 拖拽排序

### 文件信息栏
- [ ] 文件路径显示
- [ ] 文件大小显示
- [ ] 修改时间显示
- [ ] 字数统计显示

### 编辑器
- [ ] Markdown 内容显示
- [ ] 标题渲染（# / ##）
- [ ] 列表渲染（数字/符号）
- [ ] 段落和文本
