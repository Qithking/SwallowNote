/**
 * 文颜插件共享常量与默认值。
 *
 * 设计原则：
 * - 跨文件（CustomThemeDialog / WenyanDialog）共享的常量集中在此，避免重复声明
 *   导致的数据漂移（例如 STORAGE_KEY / PREVIEW_OPTIONS）。
 * - DEFAULT_RENDER_OPTIONS 是「无主题覆盖 + 全部跟随主题」的预览配置，
 *   CustomThemeDialog 的实时预览直接复用。
 */
import type { RenderOptions } from './useWenyanRenderer'

/** 插件存储中自定义主题列表使用的 key。CustomThemeDialog 与 WenyanDialog 共用。 */
export const STORAGE_KEY = 'wenyan-custom-themes'

/**
 * 实时预览用的 RenderOptions：固定平台为 wechat、代码高亮主题为 solarized-light，
 * 主题 / 段落 / 代码块全部「跟随主题」（不叠加 overrides）。CustomThemeDialog 预览
 * 完全由 customThemeCss 决定，不读 themeOverrides / paragraphOptions / codeBlockOptions。
 */
export const PREVIEW_OPTIONS: RenderOptions = {
  platform: 'wechat',
  themeId: 'default',
  hlThemeId: 'solarized-light',
  customThemeCss: null,
  isAddFootnote: true,
  themeFollowTheme: true,
  themeOverrides: {
    primaryColor: '#1aad19',
    blockquoteBg: '#afb8c133',
    textColor: '#3f3f3f',
  },
  paragraphFollowTheme: true,
  paragraphOptions: {
    fontSize: 16,
    lineHeight: 1.75,
    lineSpacing: 0,
    fontFamily: 'sans-serif',
    letterSpacing: 'normal',
    paragraphSpacing: 'standard',
    textAlign: 'left',
    textIndent: 0,
  },
  codeBlockFollowTheme: true,
  codeBlockOptions: {
    borderRadius: 5,
    fontSize: 12,
    shadow: 'heavy',
    isMacStyle: true,
  },
}

/**
 * 默认 CSS 模板：新建自定义主题时填入编辑区。
 * - 覆盖 #wenyan 及其子元素的常见选择器
 * - 注释标注每个块对应的 Markdown 元素，方便用户参考
 */
export const EXAMPLE_CUSTOM_CSS = `/* 自定义主题示例 —— 选择器参考
   主题 CSS 通过 applyStylesWithTheme 注入到文章根元素 #wenyan。
   可用的选择器（按 Markdown 元素分组）： */

/* === 整篇文章 === */
/* #wenyan                —— 文章根元素
   #wenyan *              —— 任意后代 */

/* === 标题（# / ## / ### ...） === */
#wenyan h1 { color: #2c3e50; font-weight: 700; }
#wenyan h2 { color: #34495e; font-weight: 700; }
#wenyan h3 { color: #34495e; font-weight: 600; }
#wenyan h4 { color: #555;    font-weight: 600; }
#wenyan h5 { color: #666;    font-weight: 600; }
#wenyan h6 { color: #777;    font-weight: 600; }

/* === 段落（普通段落） === */
#wenyan p { color: #3f3f3f; }

/* === 引用块（> ...） === */
#wenyan blockquote {
  color: #6a737d;
  background: #f5f5f5;
  border-left: 4px solid #dfe2e5;
  padding: 0.5em 1em;
  margin: 1em 0;
}

/* === 链接（[text](url)） === */
#wenyan a { color: #1aad19; text-decoration: none; }

/* === 列表（- / 1.） === */
#wenyan ul, #wenyan ol { color: #3f3f3f; }
#wenyan li { margin: 0.3em 0; }

/* === 表格 === */
#wenyan table { border-collapse: collapse; }
#wenyan th, #wenyan td {
  border: 1px solid #ddd;
  padding: 0.5em 0.8em;
}
#wenyan th { background: #f7f7f7; font-weight: 600; }

/* === 代码块（\`\`\`） === */
#wenyan pre {
  background: #282c34;
  color: #abb2bf;
  border-radius: 5px;
  padding: 1em;
  font-size: 12px;
  overflow-x: auto;
}

/* === 行内代码（\`code\`） === */
#wenyan code {
  background: #f0f0f0;
  color: #d6336c;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 0.9em;
}
/* pre 内的 code 不要套用行内样式 */
#wenyan pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

/* === 脚注 === */
#wenyan .footnote { color: #1aad19; font-size: 0.9em; }

/* === 图片 === */
#wenyan img { max-width: 100%; border-radius: 4px; }

/* === 分隔线（---） === */
#wenyan hr {
  border: none;
  border-top: 1px dashed #ccc;
  margin: 1.5em 0;
}
`
