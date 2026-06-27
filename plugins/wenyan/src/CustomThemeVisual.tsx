/**
 * 可视化设计面板：4 个分类（全局 / 标题 / 段落 / 引用）的 Tabs 与
 * ElementStyleEditor 渲染。
 *
 * 桥接函数（map / merge / CATEGORY_FIELD_SHOW）从 ./themeConfigBridges 导入。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { ElementStyleEditor } from './components/ElementStyle'
import type { ThemeConfig, HeadingLevel } from './themeConfig'
import {
  mapGlobalToElementStyle,
  mergeGlobalFromElementStyle,
  mapHeadingToElementStyle,
  mergeHeadingFromElementStyle,
  mapParagraphToElementStyle,
  mergeParagraphFromElementStyle,
  mapQuoteToElementStyle,
  mergeQuoteFromElementStyle,
  CATEGORY_FIELD_SHOW,
} from './themeConfigBridges'

/** 4 个可视化分类 */
export type VisualCategory = 'global' | 'heading' | 'paragraph' | 'quote'

/** 嵌套分类 tab（全局 / 标题 / 段落 / 引用） */
function VisualCategoryTabs({
  category,
  onChange,
}: {
  category: VisualCategory
  onChange: (c: VisualCategory) => void
}): ReactNode {
  const items: Array<{ id: VisualCategory; label: string }> = [
    { id: 'global', label: '全局' },
    { id: 'heading', label: '标题' },
    { id: 'paragraph', label: '段落' },
    { id: 'quote', label: '引用' },
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        padding: '10px 16px',
        borderBottom: '1px solid #e5e7eb',
        background: '#fafafa',
        flexShrink: 0,
      }}
    >
      {items.map((it) => {
        const active = category === it.id
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? '#fff' : '#374151',
              background: active ? '#1aad19' : '#fff',
              border: active ? '1px solid #1aad19' : '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/** 可视化设计编辑器主组件 */
export function VisualEditor({
  config,
  category,
  onCategoryChange,
  onChange,
  onFieldClick,
}: {
  config: ThemeConfig
  category: VisualCategory
  onCategoryChange: (c: VisualCategory) => void
  onChange: (updater: (cfg: ThemeConfig) => ThemeConfig) => void
  onFieldClick?: (cat: VisualCategory) => void
}): ReactNode {
  // 标题级别选择（仅在 heading 分类下生效）
  const [headingLevel, setHeadingLevel] = useState<HeadingLevel>('all')

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // 横向不滚动（与 overflowY 区分；子控件用 box model 布局不再撑破）
        maxWidth: '100%',
      }}
    >
      <VisualCategoryTabs category={category} onChange={onCategoryChange} />
      {category === 'heading' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px 0',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: '#6b7280' }}>标题级别</span>
          <select
            value={headingLevel}
            onChange={(e) => setHeadingLevel(e.target.value as HeadingLevel)}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#fff',
              outline: 'none',
            }}
          >
            <option value="all">全部 (h1..h6)</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
            <option value="h4">H4</option>
            <option value="h5">H5</option>
            <option value="h6">H6</option>
          </select>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {headingLevel === 'all'
              ? '编辑将应用到所有 h1-h6 标题'
              : `仅编辑 ${headingLevel} 标题，其它继承自「全部」`}
          </span>
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: 16,
        }}
      >
        {category === 'global' && (
          <ElementStyleEditor
            value={mapGlobalToElementStyle(config)}
            onChange={(next) => onChange((cfg) => mergeGlobalFromElementStyle(cfg, next))}
            onFieldClick={onFieldClick ? () => onFieldClick('global') : undefined}
            show={CATEGORY_FIELD_SHOW.global}
          />
        )}
        {category === 'heading' && (
          <ElementStyleEditor
            value={mapHeadingToElementStyle(config, headingLevel)}
            onChange={(next) =>
              onChange((cfg) => mergeHeadingFromElementStyle(cfg, headingLevel, next))
            }
            onFieldClick={onFieldClick ? () => onFieldClick('heading') : undefined}
            show={CATEGORY_FIELD_SHOW.heading}
          />
        )}
        {category === 'paragraph' && (
          <ElementStyleEditor
            value={mapParagraphToElementStyle(config)}
            onChange={(next) =>
              onChange((cfg) => mergeParagraphFromElementStyle(cfg, next))
            }
            onFieldClick={onFieldClick ? () => onFieldClick('paragraph') : undefined}
            show={CATEGORY_FIELD_SHOW.paragraph}
          />
        )}
        {category === 'quote' && (
          <ElementStyleEditor
            value={mapQuoteToElementStyle(config)}
            onChange={(next) => onChange((cfg) => mergeQuoteFromElementStyle(cfg, next))}
            onFieldClick={onFieldClick ? () => onFieldClick('quote') : undefined}
            show={CATEGORY_FIELD_SHOW.quote}
          />
        )}
      </div>
    </div>
  )
}
