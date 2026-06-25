/**
 * ElementStyle —— 通用元素设置组件的对外出口。
 */
export { ElementStyleEditor } from './ElementStyleEditor'
export type {
  BorderSpec,
  BorderStyle,
  BoxShadow,
  BoxSpacing,
  Display,
  ElementStyle,
  ElementStyleEditorProps,
  ElementStyleShow,
  TextAlign,
} from './types'
export { elementStyleToCss, cssToElementStyle } from './conversion'
