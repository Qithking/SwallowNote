/**
 * ElementStyleEditor —— 通用元素样式编辑器。
 *
 * 纵向布局，每行一个字段（label 在左 / 控件在右）。可通过 `show`
 * 过滤显示的字段；value / onChange 始终操作完整 ElementStyle。
 *
 * 返回类型使用 `JSX.Element`（React 18/19 通用）而非 `ReactNode`，
 * 以便文颜插件（React 18 类型）通过 @/* 别名引用本组件时能通过类型检查。
 */
import type { JSX } from 'react'
import { cn } from '@/lib/utils'
import { FieldRow } from './FieldRow'
import { FontFamilyField } from './fields/FontFamilyField'
import { FontSizeField } from './fields/FontSizeField'
import { ColorField } from './fields/ColorField'
import { BackgroundField } from './fields/BackgroundField'
import { BoxShadowField } from './fields/BoxShadowField'
import { BorderField } from './fields/BorderField'
import { BoxModelField } from './fields/BoxModelField'
import { BorderRadiusField } from './fields/BorderRadiusField'
import { LineHeightField } from './fields/LineHeightField'
import { LetterSpacingField } from './fields/LetterSpacingField'
import { TextAlignField } from './fields/TextAlignField'
import { DisplayField } from './fields/DisplayField'
import type {
  ElementStyleEditorProps,
  ElementStyleShow,
} from './types'

const ALL_SHOW: ElementStyleShow = {
  fontFamily: true,
  fontSize: true,
  color: true,
  backgroundColor: true,
  backgroundImage: true,
  boxShadow: true,
  border: true,
  padding: true,
  margin: true,
  borderRadius: true,
  lineHeight: true,
  letterSpacing: true,
  textAlign: true,
  display: true,
}

function isShown(show: ElementStyleShow | undefined, key: keyof ElementStyleShow): boolean {
  if (!show) return true
  return Boolean(show[key])
}

export function ElementStyleEditor({
  value,
  onChange,
  show,
  className,
  onFieldClick,
}: ElementStyleEditorProps): JSX.Element {
  const mergedShow: ElementStyleShow = { ...ALL_SHOW, ...show }

  return (
    <div className={cn('flex w-full flex-col', className)}>
      {isShown(mergedShow, 'fontFamily') && (
        <FieldRow label="字体" onLabelClick={onFieldClick}>
          <FontFamilyField
            value={value.fontFamily}
            onChange={(v) => onChange({ ...value, fontFamily: v })}
            className="h-7 w-32 text-xs"
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'fontSize') && (
        <FieldRow label="字号" onLabelClick={onFieldClick}>
          <FontSizeField
            value={value.fontSize}
            onChange={(v) => onChange({ ...value, fontSize: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'color') && (
        <FieldRow label="文字色" onLabelClick={onFieldClick}>
          <ColorField
            value={value.color ?? ''}
            onChange={(v) => onChange({ ...value, color: v })}
          />
        </FieldRow>
      )}

      {(isShown(mergedShow, 'backgroundColor') || isShown(mergedShow, 'backgroundImage')) && (
        <FieldRow label="背景" onLabelClick={onFieldClick}>
          <BackgroundField
            backgroundColor={value.backgroundColor}
            backgroundImage={value.backgroundImage}
            onChange={(next) => {
              const { backgroundColor, backgroundImage } = next
              onChange({
                ...value,
                backgroundColor,
                backgroundImage,
              })
            }}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'boxShadow') && (
        <FieldRow label="阴影" onLabelClick={onFieldClick}>
          <BoxShadowField
            value={value.boxShadow}
            onChange={(v) => onChange({ ...value, boxShadow: v })}
            className="h-7 w-28 text-xs"
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'border') && (
        <FieldRow label="边框" onLabelClick={onFieldClick}>
          <BorderField
            value={value.border}
            onChange={(v) => onChange({ ...value, border: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'padding') && (
        <FieldRow label="内边距" onLabelClick={onFieldClick}>
          <BoxModelField
            value={value.padding}
            onChange={(v) => onChange({ ...value, padding: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'margin') && (
        <FieldRow label="外边距" onLabelClick={onFieldClick}>
          <BoxModelField
            value={value.margin}
            onChange={(v) => onChange({ ...value, margin: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'borderRadius') && (
        <FieldRow label="圆角" onLabelClick={onFieldClick}>
          <BorderRadiusField
            value={value.borderRadius}
            onChange={(v) => onChange({ ...value, borderRadius: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'lineHeight') && (
        <FieldRow label="行高" onLabelClick={onFieldClick}>
          <LineHeightField
            value={value.lineHeight}
            onChange={(v) => onChange({ ...value, lineHeight: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'letterSpacing') && (
        <FieldRow label="字间距" onLabelClick={onFieldClick}>
          <LetterSpacingField
            value={value.letterSpacing}
            onChange={(v) => onChange({ ...value, letterSpacing: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'textAlign') && (
        <FieldRow label="对齐" onLabelClick={onFieldClick}>
          <TextAlignField
            value={value.textAlign}
            onChange={(v) => onChange({ ...value, textAlign: v })}
          />
        </FieldRow>
      )}

      {isShown(mergedShow, 'display') && (
        <FieldRow label="display" onLabelClick={onFieldClick}>
          <DisplayField
            value={value.display}
            onChange={(v) => onChange({ ...value, display: v })}
            className="h-7 w-32 text-xs"
          />
        </FieldRow>
      )}
    </div>
  )
}
