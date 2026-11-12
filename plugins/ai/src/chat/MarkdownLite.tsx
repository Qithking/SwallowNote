/**
 * MarkdownLite — P2.4 轻量 Markdown 渲染（用户决策：完整 shiki/katex/mermaid 平移挪 P2.7）。
 * react-markdown + remark-gfm；仅定制段落/代码块/表格基础样式。
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CSSProperties } from 'react'

const wrapStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  wordBreak: 'break-word',
}

const codeInlineStyle: CSSProperties = {
  padding: '1px 4px',
  borderRadius: 4,
  background: 'rgba(128,128,128,0.15)',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

const preStyle: CSSProperties = {
  margin: '8px 0',
  padding: 10,
  borderRadius: 8,
  background: 'rgba(128,128,128,0.12)',
  overflowX: 'auto',
}

const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  margin: '8px 0',
  fontSize: 12,
}

const cellStyle: CSSProperties = {
  border: '1px solid var(--border-color, #d2d2d7)',
  padding: '4px 8px',
}

export function MarkdownLite({ content }: { content: string }) {
  return (
    <div style={wrapStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
          // 无 language- 标记的视为行内 code（轻量渲染的已知限制，块级统一带标记）
          code: ({ className, children }) =>
            className?.includes('language-') ? (
              <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{children}</code>
            ) : (
              <code style={codeInlineStyle}>{children}</code>
            ),
          pre: ({ children }) => <pre style={preStyle}>{children}</pre>,
          ul: ({ children }) => <ul style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{children}</ol>,
          a: ({ children, href }) => (
            <a href={href} style={{ color: 'var(--theme-color, #0a84ff)' }} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => <table style={tableStyle}>{children}</table>,
          th: ({ children }) => <th style={cellStyle}>{children}</th>,
          td: ({ children }) => <td style={cellStyle}>{children}</td>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '8px 0',
                padding: '2px 10px',
                borderLeft: '3px solid var(--border-color, #d2d2d7)',
                color: 'var(--text-secondary, #6e6e73)',
              }}
            >
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
