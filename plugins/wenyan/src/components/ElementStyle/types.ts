/**
 * ElementStyle —— 通用元素样式数据模型。
 *
 * 13 个标准 CSS 属性的结构化表达。ElementStyleEditor 用它来驱动
 * 一组通用字段控件；conversion.ts 提供与单条 CSS 规则的双向转换。
 *
 * 所有字段都是 optional。`undefined` 表示"未设置"：
 *  - elementStyleToCss 会跳过对应声明
 *  - cssToElementStyle 对应字段会保持 undefined
 */

export type BoxShadow = 'none' | 'sm' | 'md' | 'lg'

export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'none'

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type Display =
  | 'block'
  | 'inline-block'
  | 'inline'
  | 'flex'
  | 'grid'
  | 'inline-flex'
  | 'none'

export interface BorderSpec {
  /** 边框宽度 (px) */
  width: number
  /** 边框样式 */
  style: BorderStyle
  /** 边框颜色（CSS 颜色字符串） */
  color: string
}

export interface BoxSpacing {
  /** 上 (px) */
  top: number
  /** 右 (px) */
  right: number
  /** 下 (px) */
  bottom: number
  /** 左 (px) */
  left: number
}

export interface ElementStyle {
  /** CSS font-family 字符串 */
  fontFamily?: string
  /** 字体大小 (px) */
  fontSize?: number
  /** 文字颜色 */
  color?: string
  /** 背景颜色 */
  backgroundColor?: string
  /** 背景图 (CSS background-image 的 value 部分，如 `url(...)` / `linear-gradient(...)`) */
  backgroundImage?: string
  /** 阴影档位 */
  boxShadow?: BoxShadow
  /** 四边同款边框 */
  border?: BorderSpec
  /** 内边距 (px) */
  padding?: BoxSpacing
  /** 外边距 (px) */
  margin?: BoxSpacing
  /** 圆角 (px) */
  borderRadius?: number
  /** 行高（无单位） */
  lineHeight?: number
  /** 字间距 (px) */
  letterSpacing?: number
  /** 文本对齐 */
  textAlign?: TextAlign
  /** display */
  display?: Display
}

/**
 * 控制 ElementStyleEditor 显示哪些字段；未列出的字段不出现在 UI
 * 上，但 value / onChange 仍操作完整 ElementStyle。
 */
export interface ElementStyleShow {
  fontFamily?: boolean
  fontSize?: boolean
  color?: boolean
  backgroundColor?: boolean
  backgroundImage?: boolean
  boxShadow?: boolean
  border?: boolean
  padding?: boolean
  margin?: boolean
  borderRadius?: boolean
  lineHeight?: boolean
  letterSpacing?: boolean
  textAlign?: boolean
  display?: boolean
}

export interface ElementStyleEditorProps {
  /** 当前受控值 */
  value: ElementStyle
  /** 受控 onChange；只对 value 中被用户改动的字段赋值 */
  onChange: (next: ElementStyle) => void
  /** 控制显示哪些字段（不传则全部显示） */
  show?: ElementStyleShow
  /** 自定义 className（应用到最外层容器） */
  className?: string
  /** label 点击回调（用于「跳转到手写 CSS 对应行」），可选 */
  onFieldClick?: () => void
}
