/**
 * Plugin-local translations.
 *
 * Keys are kept structurally identical to the host's
 * `src/i18n/locales/<locale>.json` `mindMap` namespace so a future
 * sync with the host's translation files is mechanical. The plugin
 * is fully self-contained: it does not depend on `react-i18next` or
 * any host translation pipeline.
 *
 * Locales are intentionally duplicated in this file (rather than
 * importing JSON) so the Vite build can inline them into a single
 * ES module without extra fetchers.
 */
export const TRANSLATIONS = {
  'zh-CN': {
    mindMap: {
      insertSibling: '插入同级节点',
      insertChild: '插入子节点',
      insertParent: '插入父节点',
      addSummary: '插入概要',
      moveUp: '上移节点',
      moveDown: '下移节点',
      collapseAll: '收起所有下级节点',
      expandAll: '展开所有下级节点',
      deleteNode: '删除节点',
      deleteOnlyCurrent: '仅删除当前节点',
      copyNode: '复制节点',
      cutNode: '剪切节点',
      pasteNode: '粘贴节点',
      toolbar: {
        formatBrush: '格式刷',
        icon: '图标',
        hyperlink: '超链接',
        remark: '备注',
        tag: '标签',
        summary: '概要',
        outline: '外框',
        layout: '布局',
        theme: '主题',
        basic: '基础',
        node: '节点',
        watermark: '水印',
        zoomIn: '放大',
        zoomOut: '缩小',
        fitCanvas: '适应画布',
        logicalStructure: '逻辑结构图',
        logicalStructureLeft: '向左逻辑结构图',
        mindMap: '思维导图',
        organizationStructure: '组织结构图',
        catalogOrganization: '目录组织图',
        timeline: '时间轴',
        timeline2: '时间轴2',
        verticalTimeline: '竖向时间轴',
        verticalTimeline2: '竖向时间轴2',
        verticalTimeline3: '竖向时间轴3',
        fishbone: '鱼骨图',
        fishbone2: '鱼骨图2',
        themeDefault: '默认',
        themeDark: '深色',
      },
      dialog: {
        setHyperlink: '设置超链接',
        linkUrl: '链接地址',
        linkTitle: '链接标题',
        setRemark: '设置备注',
        setIcon: '设置图标',
        setTag: '设置标签',
        tagPlaceholder: '输入标签后按回车添加',
        delete: '删除',
      },
      watermark: {
        title: '水印设置',
        text: '文字',
        textPlaceholder: '水印文字',
        color: '颜色',
        opacity: '透明度',
        fontSize: '字号',
        rotation: '旋转',
        lineSpacing: '行间距',
        letterSpacing: '字间距',
        layer: '层级',
        export: '导出',
      },
      style: {
        background: '背景',
        connection: '基础连线',
        connectionColor: '颜色',
      },
      colorPicker: {
        moreColors: '更多颜色',
      },
      loadFailed: '思维导图加载失败',
      loading: '加载思维导图...',
      defaultRootText: '中心主题',
      invalidContainer: '容器尺寸无效，无法初始化思维导图',
    },
    common: {
      cancel: '取消',
      confirm: '确定',
      close: '关闭',
      on: '开启',
      off: '关闭',
      only: '仅',
      show: '显示',
      normal: '普通',
    },
    editorSettings: {
      title: '排版设置',
    },
  },
  en: {
    mindMap: {
      insertSibling: 'Insert Sibling Node',
      insertChild: 'Insert Child Node',
      insertParent: 'Insert Parent Node',
      addSummary: 'Add Summary',
      moveUp: 'Move Node Up',
      moveDown: 'Move Node Down',
      collapseAll: 'Collapse All Children',
      expandAll: 'Expand All Children',
      deleteNode: 'Delete Node',
      deleteOnlyCurrent: 'Delete Only Current Node',
      copyNode: 'Copy Node',
      cutNode: 'Cut Node',
      pasteNode: 'Paste Node',
      toolbar: {
        formatBrush: 'Format Brush',
        icon: 'Icon',
        hyperlink: 'Hyperlink',
        remark: 'Remark',
        tag: 'Tag',
        summary: 'Summary',
        outline: 'Outline',
        layout: 'Layout',
        theme: 'Theme',
        basic: 'Basic',
        node: 'Node',
        watermark: 'Watermark',
        zoomIn: 'Zoom In',
        zoomOut: 'Zoom Out',
        fitCanvas: 'Fit Canvas',
        logicalStructure: 'Logical Structure',
        logicalStructureLeft: 'Left Logical Structure',
        mindMap: 'Mind Map',
        organizationStructure: 'Organization Chart',
        catalogOrganization: 'Catalog Organisation',
        timeline: 'Timeline',
        timeline2: 'Timeline 2',
        verticalTimeline: 'Vertical Timeline',
        verticalTimeline2: 'Vertical Timeline 2',
        verticalTimeline3: 'Vertical Timeline 3',
        fishbone: 'Fishbone',
        fishbone2: 'Fishbone 2',
        themeDefault: 'Default',
        themeDark: 'Dark',
      },
      dialog: {
        setHyperlink: 'Set Hyperlink',
        linkUrl: 'Link URL',
        linkTitle: 'Link Title',
        setRemark: 'Set Remark',
        setIcon: 'Set Icon',
        setTag: 'Set Tag',
        tagPlaceholder: 'Press Enter to add tag',
        delete: 'Delete',
      },
      watermark: {
        title: 'Watermark Settings',
        text: 'Text',
        textPlaceholder: 'Watermark text',
        color: 'Color',
        opacity: 'Opacity',
        fontSize: 'Font Size',
        rotation: 'Rotation',
        lineSpacing: 'Line Spacing',
        letterSpacing: 'Letter Spacing',
        layer: 'Layer',
        export: 'Export',
      },
      style: {
        background: 'Background',
        connection: 'Connection Line',
        connectionColor: 'Color',
      },
      colorPicker: {
        moreColors: 'More Colors',
      },
      loadFailed: 'Mind map load failed',
      loading: 'Loading mind map...',
      defaultRootText: 'Central Topic',
      invalidContainer: 'Invalid container size, cannot initialize mind map',
    },
    common: {
      cancel: 'Cancel',
      confirm: 'OK',
      close: 'Close',
      on: 'On',
      off: 'Off',
      only: 'Only',
      show: 'Show',
      normal: 'Normal',
    },
    editorSettings: {
      title: 'Typography',
    },
  },
} as const

export type Locale = keyof typeof TRANSLATIONS

/**
 * Resolve a dot-separated key path against an arbitrary object.
 * Returns the string at that path, or `fallback` if any segment
 * along the way is missing or the final value is not a string.
 *
 * Mirrors the behaviour of `t('a.b.c')` from i18next so the host
 * translations remain a drop-in reference.
 */
function resolveKey(map: Record<string, unknown>, key: string, fallback: string): string {
  const parts = key.split('.')
  let cur: unknown = map
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return fallback
    }
  }
  return typeof cur === 'string' ? cur : fallback
}

/**
 * The plugin's translation function. If `key` is missing in the
 * active locale we fall back to the zh-CN map, then to the key
 * itself, so the UI never crashes because of a missing string.
 */
export function translate(locale: Locale, key: string): string {
  const primary = TRANSLATIONS[locale] as Record<string, unknown> | undefined
  if (primary) {
    const v = resolveKey(primary, key, '')
    if (v) return v
  }
  const fallback = TRANSLATIONS['zh-CN'] as Record<string, unknown>
  const v = resolveKey(fallback, key, '')
  if (v) return v
  return key
}
